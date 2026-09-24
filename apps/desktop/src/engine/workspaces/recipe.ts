/**
 * The recipe a Project prepares each dedicated Workspace with, as its settings edit it (D8-05).
 *
 * An ordered list of `copy`, `link` and `run` steps: a copy and a link name a file of `main` by
 * its path relative to the root, once at the root or in each repository; a run names a command of
 * the Project's catalogue. The order is a rank, as the repositories' is, so moving one step never
 * renumbers the others. A Workspace is prepared from the recipe as it was when the Workspace was
 * created: editing it afterwards changes the next Workspace, not one already made.
 */

import {
  InvalidRepositoryPathError,
  RECIPE_KINDS,
  RECIPE_SCOPES,
  type RecipeKind,
  type RecipeScope,
  type RecipeStep,
  rankBetween,
  repositoryPath,
} from '@hemera/core'
import { and, asc, eq } from 'drizzle-orm'
import { Context, Data, Effect, Layer } from 'effect'

import {
  Database,
  DatabaseError,
  type EngineDatabase,
  type EngineTransaction,
} from '../storage/database.ts'
import { projectCommands, projectPreparationSteps } from '../storage/schema.ts'
import { type Mutation, mutate } from '../transaction.ts'

/** A step the recipe cannot hold, or one it does not have. */
export class RecipeRefusedError extends Data.TaggedError('RecipeRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** What the settings hand over to add a step. */
export interface RecipeEdit {
  readonly kind: RecipeKind
  /** The file or folder, relative to the root: for a copy and a link, and null for a run. */
  readonly path: string | null
  readonly scope: RecipeScope
  /** The catalogue command a run starts, and null for a copy and a link. */
  readonly commandId: string | null
}

export interface RecipeService {
  /** The recipe of a Project, in its order. */
  readonly list: (projectId: string) => Effect.Effect<RecipeStep[], DatabaseError>
  /** Adds a step at the end, and answers the recipe as it now is. */
  readonly add: (
    projectId: string,
    edit: RecipeEdit,
  ) => Effect.Effect<RecipeStep[], DatabaseError | InvalidRepositoryPathError | RecipeRefusedError>
  readonly remove: (
    projectId: string,
    id: string,
  ) => Effect.Effect<RecipeStep[], DatabaseError | RecipeRefusedError>
  /** Moves a step one place; one already first or last stays where it is. */
  readonly move: (
    projectId: string,
    id: string,
    direction: 'up' | 'down',
  ) => Effect.Effect<RecipeStep[], DatabaseError | RecipeRefusedError>
}

export class Recipe extends Context.Service<Recipe, RecipeService>()('Recipe') {}

/** A step of the recipe read from its row, whose kind and scope the table's checks closed. */
export function recipeStepOf(row: typeof projectPreparationSteps.$inferSelect): RecipeStep {
  return {
    id: row.id,
    kind: RECIPE_KINDS.find((kind) => kind === row.kind) ?? 'run',
    path: row.path,
    scope: RECIPE_SCOPES.find((scope) => scope === row.scope) ?? 'root',
    commandId: row.commandId,
    rank: row.rank,
  }
}

const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

/** The recipe of a Project, in its order, read inside a transaction or out of one. */
export const recipeOf = (reader: EngineDatabase | EngineTransaction, projectId: string) =>
  reader
    .select()
    .from(projectPreparationSteps)
    .where(eq(projectPreparationSteps.projectId, projectId))
    .orderBy(asc(projectPreparationSteps.rank))
    .pipe(
      Effect.mapError(failed('reading the recipe')),
      Effect.map((rows) => rows.map(recipeStepOf)),
    )

/** The event every change of the recipe writes, on the Project. */
function changed(projectId: string, change: string, kind: RecipeKind) {
  return {
    type: 'project.recipe_changed',
    entityKind: 'project' as const,
    entityId: projectId,
    source: 'ui' as const,
    author: 'human' as const,
    projectId,
    payload: { change, kind },
  }
}

export const recipeLayer = Layer.effect(
  Recipe,
  Effect.gen(function* () {
    const database = yield* Database

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The one step a change is about, or a refusal naming the identifier. */
    const stepIn = (transaction: EngineTransaction, projectId: string, id: string) =>
      recipeOf(transaction, projectId).pipe(
        Effect.flatMap((steps) => {
          const index = steps.findIndex((step) => step.id === id)
          const step = steps[index]
          return step === undefined
            ? Effect.fail(new RecipeRefusedError({ reason: `the recipe has no step "${id}"` }))
            : Effect.succeed({ steps, index, step })
        }),
      )

    return {
      list: (projectId) => recipeOf(database, projectId),

      add: (projectId, edit) =>
        withDatabase(
          mutate('adding a step to the recipe', (transaction) =>
            Effect.gen(function* () {
              let path: string | null = null
              let commandId: string | null = null
              if (edit.kind === 'run') {
                // A run starts a command of this Project's catalogue, and nothing else.
                const found = yield* transaction
                  .select({ id: projectCommands.id, type: projectCommands.type })
                  .from(projectCommands)
                  .where(
                    and(
                      eq(projectCommands.projectId, projectId),
                      eq(projectCommands.id, edit.commandId ?? ''),
                    ),
                  )
                  .pipe(Effect.mapError(failed('reading the commands')))
                if (found[0] === undefined) {
                  return yield* Effect.fail(
                    new RecipeRefusedError({
                      reason: 'a run step starts a command of this Project, and none was named',
                    }),
                  )
                }
                // A step waits for its command to end, and a service is up until it is stopped:
                // a `serve` in the recipe would hold the preparation for ever (D8-05, D8-07).
                if (found[0].type === 'serve') {
                  return yield* Effect.fail(
                    new RecipeRefusedError({
                      reason:
                        'a service never ends: a preparation step waits for its command to end',
                    }),
                  )
                }
                commandId = found[0].id
              } else {
                // A copy and a link are relative to the root and never leave it (D8-05).
                const asked = edit.path ?? ''
                path = yield* Effect.try({
                  try: () => repositoryPath(asked),
                  catch: (cause) =>
                    cause instanceof InvalidRepositoryPathError
                      ? cause
                      : new InvalidRepositoryPathError(asked, String(cause)),
                })
              }
              const steps = yield* recipeOf(transaction, projectId)
              yield* transaction
                .insert(projectPreparationSteps)
                .values({
                  id: crypto.randomUUID(),
                  projectId,
                  kind: edit.kind,
                  path,
                  scope: edit.scope,
                  commandId,
                  rank: rankBetween(steps.at(-1)?.rank ?? null, null),
                })
                .pipe(Effect.mapError(failed('writing the recipe')))
              return {
                result: yield* recipeOf(transaction, projectId),
                events: [changed(projectId, 'added', edit.kind)],
              } satisfies Mutation<RecipeStep[]>
            }),
          ),
        ),

      remove: (projectId, id) =>
        withDatabase(
          mutate('removing a step of the recipe', (transaction) =>
            Effect.gen(function* () {
              const { step } = yield* stepIn(transaction, projectId, id)
              yield* transaction
                .delete(projectPreparationSteps)
                .where(eq(projectPreparationSteps.id, id))
                .pipe(Effect.mapError(failed('writing the recipe')))
              return {
                result: yield* recipeOf(transaction, projectId),
                events: [changed(projectId, 'removed', step.kind)],
              } satisfies Mutation<RecipeStep[]>
            }),
          ),
        ),

      move: (projectId, id, direction) =>
        withDatabase(
          mutate('moving a step of the recipe', (transaction) =>
            Effect.gen(function* () {
              const { steps, index, step } = yield* stepIn(transaction, projectId, id)
              // The new rank sorts between the two neighbours on the other side of the one it
              // passes: nothing else of the recipe is renumbered.
              const [before, after] =
                direction === 'up'
                  ? [steps[index - 2], steps[index - 1]]
                  : [steps[index + 1], steps[index + 2]]
              const passed = direction === 'up' ? after : before
              if (passed === undefined) return { result: steps, events: [] }
              const rank = rankBetween(before?.rank ?? null, after?.rank ?? null)
              yield* transaction
                .update(projectPreparationSteps)
                .set({ rank })
                .where(eq(projectPreparationSteps.id, id))
                .pipe(Effect.mapError(failed('writing the recipe')))
              return {
                result: yield* recipeOf(transaction, projectId),
                events: [changed(projectId, 'moved', step.kind)],
              } satisfies Mutation<RecipeStep[]>
            }),
          ),
        ),
    } satisfies RecipeService
  }),
)
