/**
 * The environment variables of a Project, and those each Workspace sets over them.
 *
 * What a process of a Workspace is given is the process's own environment, then the Project's
 * variables, then the Workspace's, their template names filled for the place it runs in. A value
 * is often a secret: it is never written to a domain event, the diagnostic or an error. A list
 * answers names with a mask; one value is revealed only when it is asked for by name. Every value
 * is registered as a known secret, so it is masked wherever else it shows up.
 */

import {
  type TemplateValues,
  checkedTemplate,
  fillTemplate,
  mergedEnvironment,
  variableKey,
} from '@hemera/core/domain'
import {
  type MaskedVariable,
  UnknownVariable,
  type VariableEdit,
  type VariableKey,
  type VariableScope,
} from '@hemera/ipc'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Cause, Effect, Predicate } from 'effect'

import type { NewEvent } from './journal.ts'
import { Database, DatabaseError, refusedWhile } from './storage/database.ts'
import { environmentVariables } from './storage/schema.ts'
import { Secrets, placeSource, registerVariables } from './secrets.ts'
import { mutate } from './transaction.ts'
import { type Place, placeOf, templateValuesOf } from './workspaces.ts'

/** What a list shows in place of every value, the same whatever the value's length. */
export const MASK = '••••••••'

/**
 * A failure of the driver on a query that carries a value, said without the value: the query
 * builder's message prints every parameter, so only what the database itself said is kept.
 */
const refusedWithoutValues =
  (doing: string) =>
  <E>(failure: E): DatabaseError => {
    if (!Predicate.isTagged(failure, 'EffectDrizzleQueryError')) return refusedWhile(doing)(failure)
    const inner = Predicate.hasProperty(failure, 'cause') ? failure.cause : null
    let said = Cause.isCause(inner) ? Cause.squash(inner) : inner
    while (Predicate.hasProperty(said, 'cause') && said.cause instanceof Error) said = said.cause
    return said instanceof Error && said.message !== ''
      ? new DatabaseError({ doing, reason: said.message })
      : new DatabaseError({ doing, reason: 'the database refused the query' })
  }

/** The rows of one scope: a Project's own, or one Workspace's. */
const scopeOf = (projectId: string, workspaceId: string | null) =>
  and(
    eq(environmentVariables.projectId, projectId),
    workspaceId === null
      ? isNull(environmentVariables.workspaceId)
      : eq(environmentVariables.workspaceId, workspaceId),
  )

const rowsOf = (projectId: string, workspaceId: string | null) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(environmentVariables)
      .where(scopeOf(projectId, workspaceId))
      .orderBy(asc(environmentVariables.key))
      .pipe(Effect.mapError(refusedWithoutValues('reading the variables')))
  })

/** The event a change of a variable writes: its name and where, never its value. */
const changed = (
  type: string,
  { projectId, workspaceId }: VariableScope,
  key: string,
): NewEvent => ({
  type,
  entityKind: workspaceId === null ? 'project' : 'workspace',
  entityId: workspaceId ?? projectId,
  source: 'ui',
  author: 'human',
  payload: { projectId, workspaceId, key },
})

/** The variables of one scope, by name, each with the mask in place of its value. */
export const listVariables = (scope: VariableScope) =>
  Effect.gen(function* () {
    yield* placeOf(scope.projectId, scope.workspaceId)
    const rows = yield* rowsOf(scope.projectId, scope.workspaceId)
    return rows.map((row): MaskedVariable => ({ key: row.key, value: MASK }))
  })

/**
 * Sets a variable in its scope, replacing the value a key already has there. The name must be
 * one a shell takes, and the value may only name template names Hemera fills.
 */
export const setVariable = (edit: VariableEdit) =>
  Effect.gen(function* () {
    const key = yield* Effect.fromResult(variableKey(edit.key))
    const value = yield* Effect.fromResult(checkedTemplate(edit.value))
    yield* placeOf(edit.projectId, edit.workspaceId)
    yield* mutate('setting a variable', (transaction) =>
      Effect.gen(function* () {
        const existing = yield* transaction
          .select({ id: environmentVariables.id })
          .from(environmentVariables)
          .where(and(scopeOf(edit.projectId, edit.workspaceId), eq(environmentVariables.key, key)))
          .pipe(Effect.mapError(refusedWithoutValues('reading the variables')))
        const [found] = existing
        yield* (
          found === undefined
            ? transaction.insert(environmentVariables).values({
                id: crypto.randomUUID(),
                projectId: edit.projectId,
                workspaceId: edit.workspaceId,
                key,
                value,
              })
            : transaction
                .update(environmentVariables)
                .set({ value })
                .where(eq(environmentVariables.id, found.id))
        ).pipe(Effect.mapError(refusedWithoutValues('writing the variable')))
        return { result: undefined, events: [changed('variable.set', edit, key)] }
      }),
    )
    yield* registerVariables(edit.projectId, edit.workspaceId)
    return { key, value: MASK } satisfies MaskedVariable
  })

export const removeVariable = (asked: VariableKey) =>
  Effect.gen(function* () {
    yield* placeOf(asked.projectId, asked.workspaceId)
    yield* mutate('removing a variable', (transaction) =>
      Effect.gen(function* () {
        const removed = yield* transaction
          .delete(environmentVariables)
          .where(
            and(
              scopeOf(asked.projectId, asked.workspaceId),
              eq(environmentVariables.key, asked.key),
            ),
          )
          .returning({ id: environmentVariables.id })
          .pipe(Effect.mapError(refusedWithoutValues('removing the variable')))
        if (removed.length === 0) return yield* new UnknownVariable({ key: asked.key })
        return { result: undefined, events: [changed('variable.removed', asked, asked.key)] }
      }),
    )
    yield* registerVariables(asked.projectId, asked.workspaceId)
  })

/** One value, as it was set: what the settings page shows when the user asks to see it. */
export const revealVariable = (asked: VariableKey) =>
  Effect.gen(function* () {
    yield* placeOf(asked.projectId, asked.workspaceId)
    const rows = yield* rowsOf(asked.projectId, asked.workspaceId)
    const found = rows.find((row) => row.key === asked.key)
    if (found === undefined) return yield* new UnknownVariable({ key: asked.key })
    return found.value
  })

const filled = (
  rows: ReadonlyArray<{ readonly key: string; readonly value: string }>,
  values: TemplateValues,
): Record<string, string> =>
  Object.fromEntries(rows.map((row) => [row.key, fillTemplate(row.value, values)]))

/**
 * The Project's and the place's own variables, filled for that place. The values as they are
 * filled, which a template makes differ from the values written, are registered as known secrets
 * of the place before any process is given them.
 */
const variablesAt = (place: Place) =>
  Effect.gen(function* () {
    const values = templateValuesOf(place)
    const project = filled(yield* rowsOf(place.project.id, null), values)
    const workspace =
      place.workspace === null
        ? {}
        : filled(yield* rowsOf(place.project.id, place.workspace.id), values)
    const secrets = yield* Secrets
    secrets.register(placeSource(place.project.id, place.workspace?.id ?? null), [
      ...Object.values(project),
      ...Object.values(workspace),
    ])
    return { project, workspace }
  })

/** What Hemera sets over the process's environment in a place: the Project's, then its own. */
export const givenVariables = (place: Place) =>
  Effect.map(variablesAt(place), ({ project, workspace }) =>
    mergedEnvironment({}, project, workspace),
  )

/** The whole environment a process starts with in a place. */
export const environmentAt = (place: Place) =>
  Effect.map(variablesAt(place), ({ project, workspace }) =>
    mergedEnvironment(process.env, project, workspace),
  )
