/**
 * The variables of a Project, and those each Workspace sets over them (design D8-06, D8-16).
 *
 * What a run, a preparation step or an agent of a Workspace is given is the process's own
 * environment, then the Project's variables, then the Workspace's: the same key set in both is
 * the Workspace's value there and the Project's everywhere else. What Hemera gave — the Project's
 * overridden by the Workspace's, without the process's — is what a run keeps and shows.
 *
 * A value is never written to the Journal: a variable is often a secret, and the Journal says
 * which key changed and where, not what it now holds.
 */

import { InvalidVariableKeyError, mergedEnvironment, variableKey } from '@hemera/core'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Database, DatabaseError, type EngineTransaction } from '../storage/database.ts'
import { environmentVariables, workspaces } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { UnknownWorkspaceError } from './described.ts'

/** One variable: the Project's when `workspaceId` is null, that Workspace's otherwise. */
export interface Variable {
  readonly key: string
  readonly value: string
  readonly workspaceId: string | null
}

export interface VariablesService {
  /** The variables of one scope — the Project's, or one Workspace's — sorted by key. */
  readonly list: (
    projectId: string,
    workspaceId: string | null,
  ) => Effect.Effect<Variable[], DatabaseError>
  /** Sets a variable in that scope, replacing its value when the key is already there. */
  readonly set: (
    projectId: string,
    workspaceId: string | null,
    key: string,
    value: string,
  ) => Effect.Effect<Variable, DatabaseError | InvalidVariableKeyError | UnknownWorkspaceError>
  readonly remove: (
    projectId: string,
    workspaceId: string | null,
    key: string,
  ) => Effect.Effect<void, DatabaseError>
  /** The whole environment a process of that Workspace starts with (D8-06). */
  readonly environmentFor: (
    projectId: string,
    workspaceId: string | null,
  ) => Effect.Effect<Record<string, string>, DatabaseError>
  /** What Hemera gives over the process's environment: what a run keeps and shows (D8-06). */
  readonly givenFor: (
    projectId: string,
    workspaceId: string | null,
  ) => Effect.Effect<Record<string, string>, DatabaseError>
}

export class Variables extends Context.Service<Variables, VariablesService>()('Variables') {}

const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

/** The rows of one scope: a Project's own, or one Workspace's. */
function scopeOf(projectId: string, workspaceId: string | null) {
  return and(
    eq(environmentVariables.projectId, projectId),
    workspaceId === null
      ? isNull(environmentVariables.workspaceId)
      : eq(environmentVariables.workspaceId, workspaceId),
  )
}

/** The event a change of a variable writes: on its Workspace, or on the Project (D8-16). */
function changed(projectId: string, workspaceId: string | null, key: string): NewEvent {
  return {
    type: 'workspace.variables_changed',
    entityKind: workspaceId === null ? 'project' : 'workspace',
    entityId: workspaceId ?? projectId,
    source: 'ui',
    author: 'human',
    projectId,
    payload: { key, scope: workspaceId === null ? 'project' : 'workspace' },
  }
}

export const variablesLayer = Layer.effect(
  Variables,
  Effect.gen(function* () {
    const database = yield* Database

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    const list = (projectId: string, workspaceId: string | null) =>
      database
        .select()
        .from(environmentVariables)
        .where(scopeOf(projectId, workspaceId))
        .orderBy(asc(environmentVariables.key))
        .pipe(
          Effect.mapError(failed('reading the variables')),
          Effect.map((rows) =>
            rows.map((row): Variable => ({
              key: row.key,
              value: row.value,
              workspaceId: row.workspaceId,
            })),
          ),
        )

    /** The Project's variables with the Workspace's over them, as a record. */
    const given = (projectId: string, workspaceId: string | null) =>
      Effect.gen(function* () {
        const project = yield* list(projectId, null)
        const workspace = workspaceId === null ? [] : yield* list(projectId, workspaceId)
        return mergedEnvironment(
          {},
          new Map(project.map((one) => [one.key, one.value])),
          new Map(workspace.map((one) => [one.key, one.value])),
        )
      })

    /** The Workspace a variable is set on, which has to be one of that Project's. */
    const ownedWorkspace = (
      transaction: EngineTransaction,
      projectId: string,
      workspaceId: string,
    ) =>
      transaction
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.projectId, projectId)))
        .pipe(
          Effect.mapError(failed('reading the Workspace')),
          Effect.flatMap((rows) =>
            rows.length === 0 ? Effect.fail(new UnknownWorkspaceError(workspaceId)) : Effect.void,
          ),
        )

    return {
      list,

      set: (projectId, workspaceId, candidate, value) =>
        withDatabase(
          mutate('setting a variable', (transaction) =>
            Effect.gen(function* () {
              const key = yield* Effect.try({
                try: () => variableKey(candidate),
                catch: (cause) =>
                  cause instanceof InvalidVariableKeyError
                    ? cause
                    : new InvalidVariableKeyError(candidate),
              })
              if (workspaceId !== null) yield* ownedWorkspace(transaction, projectId, workspaceId)
              const existing = yield* transaction
                .select({ id: environmentVariables.id })
                .from(environmentVariables)
                .where(and(scopeOf(projectId, workspaceId), eq(environmentVariables.key, key)))
                .pipe(Effect.mapError(failed('reading the variables')))
              if (existing[0] === undefined) {
                yield* transaction
                  .insert(environmentVariables)
                  .values({ id: crypto.randomUUID(), projectId, workspaceId, key, value })
                  .pipe(Effect.mapError(failed('writing the variable')))
              } else {
                yield* transaction
                  .update(environmentVariables)
                  .set({ value })
                  .where(eq(environmentVariables.id, existing[0].id))
                  .pipe(Effect.mapError(failed('writing the variable')))
              }
              return {
                result: { key, value, workspaceId } satisfies Variable,
                events: [changed(projectId, workspaceId, key)],
              }
            }),
          ),
        ),

      remove: (projectId, workspaceId, key) =>
        withDatabase(
          mutate('removing a variable', (transaction) =>
            transaction
              .delete(environmentVariables)
              .where(and(scopeOf(projectId, workspaceId), eq(environmentVariables.key, key)))
              .returning({ id: environmentVariables.id })
              .pipe(
                Effect.mapError(failed('removing the variable')),
                // A key that was not set is not a change, and the Journal has nothing to say.
                Effect.map((removed) => ({
                  result: undefined,
                  events: removed.length === 0 ? [] : [changed(projectId, workspaceId, key)],
                })),
              ),
          ),
        ),

      environmentFor: (projectId, workspaceId) =>
        given(projectId, workspaceId).pipe(
          Effect.map((variables) => mergedEnvironment(process.env, variables, {})),
        ),

      givenFor: given,
    } satisfies VariablesService
  }),
)
