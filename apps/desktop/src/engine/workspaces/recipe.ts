/**
 * The recipe a Project prepares each dedicated Workspace with, as its settings edit it (D8-05).
 *
 * An ordered list of `copy`, `link` and `run` steps: a copy and a link name a file or a folder of
 * `main` by its path under a base — one of the Project's repositories, or the Workspace root — so
 * several repositories are several steps (D8-05 as amended by recette 1); a run starts a command
 * of the Project's catalogue, or carries a line of its own, which is not in the catalogue and that
 * no agent reads (recette 2). A copy or a link is accepted only when its source is in `main`: the step
 * dialog checks it before the step is written, not the day a Workspace is prepared. The order is a
 * rank, as the repositories' is, so moving one step never renumbers the others. A Workspace is
 * prepared from the recipe as it was when the Workspace was created: editing it afterwards changes
 * the next Workspace, not one already made.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  InvalidRepositoryPathError,
  MAIN_WORKSPACE,
  RECIPE_KINDS,
  ROOT_REPOSITORY,
  type RecipeKind,
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
import {
  projectCommands,
  projectPreparationSteps,
  projectRepositories,
  workspaces,
} from '../storage/schema.ts'
import { type Mutation, mutate } from '../transaction.ts'

/** A step the recipe cannot hold, or one it does not have. */
export class RecipeRefusedError extends Data.TaggedError('RecipeRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** What the settings hand over to add a step, or to rewrite one. */
export interface RecipeEdit {
  readonly kind: RecipeKind
  /**
   * Where a copy or a link applies, and where a run of a line of its own runs from: a repository
   * the Project declares, and null for the Workspace root. Nothing for a run of a command.
   */
  readonly base: string | null
  /**
   * The file or folder, relative to the base: for a copy and a link, and for a run of a line of
   * its own. Null for a run of a command, and for a run of a line of its own that runs in its base
   * itself.
   */
  readonly path: string | null
  /** The catalogue command a run starts, and null for a copy, a link and a run of a line. */
  readonly commandId: string | null
  /** The line a run of its own carries, and null for every other step (recette 2). */
  readonly line: string | null
  /** The line Windows runs instead of `line`, and null when it runs `line` (D8-07). */
  readonly lineWindows: string | null
  readonly lineLinux: string | null
}

export interface RecipeService {
  /** The recipe of a Project, in its order. */
  readonly list: (projectId: string) => Effect.Effect<RecipeStep[], DatabaseError>
  /** Adds a step at the end, and answers the recipe as it now is. */
  readonly add: (
    projectId: string,
    edit: RecipeEdit,
  ) => Effect.Effect<RecipeStep[], DatabaseError | InvalidRepositoryPathError | RecipeRefusedError>
  /** Rewrites a step where it stands, and answers the recipe as it now is. */
  readonly update: (
    projectId: string,
    id: string,
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

/** A step of the recipe read from its row, whose kind the table's check closed. */
export function recipeStepOf(row: typeof projectPreparationSteps.$inferSelect): RecipeStep {
  return {
    id: row.id,
    kind: RECIPE_KINDS.find((kind) => kind === row.kind) ?? 'run',
    base: row.base,
    path: row.path,
    commandId: row.commandId,
    line: row.line,
    lineWindows: row.lineWindows,
    lineLinux: row.lineLinux,
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

/** What a step is written with once checked: its base, its path, its command or its own line. */
interface Checked {
  readonly base: string | null
  readonly path: string | null
  readonly commandId: string | null
  readonly line: string | null
  readonly lineWindows: string | null
  readonly lineLinux: string | null
}

const refuse = (reason: string) => Effect.fail(new RecipeRefusedError({ reason }))

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

    /**
     * The base a step acts under (D8-05 as amended by recette 1): the Workspace root, or a
     * repository the Project declares. Read from the disk outside any transaction, as every disk
     * is.
     */
    const based = (projectId: string, edit: RecipeEdit) =>
      Effect.gen(function* () {
        const saidBase = edit.base?.trim() ?? ''
        if (saidBase === '' || saidBase === '.' || saidBase === './') return null
        const base = yield* Effect.try({
          try: () => repositoryPath(saidBase),
          catch: (cause) =>
            cause instanceof InvalidRepositoryPathError
              ? cause
              : new InvalidRepositoryPathError(saidBase, String(cause)),
        })
        const declared = yield* database
          .select({ relativePath: projectRepositories.relativePath })
          .from(projectRepositories)
          .where(
            and(
              eq(projectRepositories.projectId, projectId),
              eq(projectRepositories.relativePath, base),
            ),
          )
          .pipe(Effect.mapError(failed('reading the repositories')))
        if (declared.length === 0) {
          return yield* refuse(`${saidBase} is not a repository of this Project`)
        }
        return base
      })

    /**
     * A copy's or a link's base, path and source, checked before anything is written (D8-05 as
     * amended by recette 1): the base is the root or a repository the Project declares, the path
     * never leaves it, and the file or folder is in `main` there — read from the disk outside any
     * transaction, as every disk is.
     */
    const placed = (projectId: string, edit: RecipeEdit) =>
      Effect.gen(function* () {
        const base = yield* based(projectId, edit)
        // A copy and a link are relative to their base and never leave it (D8-05).
        const asked = edit.path ?? ''
        const path = yield* Effect.try({
          try: () => repositoryPath(asked),
          catch: (cause) =>
            cause instanceof InvalidRepositoryPathError
              ? cause
              : new InvalidRepositoryPathError(asked, String(cause)),
        })
        if (path === ROOT_REPOSITORY) {
          return yield* refuse(
            `a ${edit.kind} names a file or a folder under its base, not the base`,
          )
        }
        const mains = yield* database
          .select({ path: workspaces.path })
          .from(workspaces)
          .where(and(eq(workspaces.projectId, projectId), eq(workspaces.name, MAIN_WORKSPACE)))
          .pipe(Effect.mapError(failed('reading the Workspaces')))
        const source = join(mains[0]?.path ?? '', base ?? '', path)
        if (!existsSync(source)) {
          return yield* refuse(`${source} does not exist in main: a ${edit.kind} needs its source`)
        }
        return {
          base,
          path,
          commandId: null,
          line: null,
          lineWindows: null,
          lineLinux: null,
        } satisfies Checked
      })

    /**
     * The line a run carries itself, with the base and the folder it runs in (recette 2), checked
     * before anything is written: it is not in the catalogue, and no agent reads it. Its base and
     * its folder are kept as a command's are — the folder relative to the base, null for the base
     * itself — so that a step's own line runs exactly as a catalogue command runs.
     */
    const ownLine = (projectId: string, edit: RecipeEdit) =>
      Effect.gen(function* () {
        const line = (edit.line ?? '').trim()
        if (line.length === 0) {
          return yield* refuse(
            'a run step starts a command of this Project, or carries a line of its own, and neither was named',
          )
        }
        const base = yield* based(projectId, edit)
        const asked = edit.path?.trim() ?? ''
        const path =
          asked === ''
            ? null
            : yield* Effect.try({
                try: () => repositoryPath(asked),
                catch: (cause) =>
                  cause instanceof InvalidRepositoryPathError
                    ? cause
                    : new InvalidRepositoryPathError(asked, String(cause)),
              })
        return {
          base,
          path,
          commandId: null,
          line,
          lineWindows: edit.lineWindows,
          lineLinux: edit.lineLinux,
        } satisfies Checked
      })

    /** A run's line, checked inside the transaction that writes its step. */
    const commanded = (transaction: EngineTransaction, projectId: string, edit: RecipeEdit) =>
      Effect.gen(function* () {
        // A run starts a command of this Project's catalogue, and nothing else here: a run of a
        // line of its own has been checked outside the transaction, as a copy's source is.
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
          return yield* refuse('a run step starts a command of this Project, and none was named')
        }
        // A step waits for its command to end, and a service is up until it is stopped: a
        // `serve` in the recipe would hold the preparation for ever (D8-05, D8-07).
        if (found[0].type === 'serve') {
          return yield* refuse(
            'a service never ends: a preparation step waits for its command to end',
          )
        }
        return {
          base: null,
          path: null,
          commandId: found[0].id,
          line: null,
          lineWindows: null,
          lineLinux: null,
        } satisfies Checked
      })

    return {
      list: (projectId) => recipeOf(database, projectId),

      add: (projectId, edit) =>
        Effect.gen(function* () {
          // A copy, a link and a run of a line of its own are checked on the disk first; a run of
          // a command, inside the transaction.
          const place =
            edit.kind !== 'run'
              ? yield* placed(projectId, edit)
              : edit.commandId === null
                ? yield* ownLine(projectId, edit)
                : null
          return yield* withDatabase(
            mutate('adding a step to the recipe', (transaction) =>
              Effect.gen(function* () {
                const step = place ?? (yield* commanded(transaction, projectId, edit))
                const steps = yield* recipeOf(transaction, projectId)
                yield* transaction
                  .insert(projectPreparationSteps)
                  .values({
                    id: crypto.randomUUID(),
                    projectId,
                    kind: edit.kind,
                    ...step,
                    rank: rankBetween(steps.at(-1)?.rank ?? null, null),
                  })
                  .pipe(Effect.mapError(failed('writing the recipe')))
                return {
                  result: yield* recipeOf(transaction, projectId),
                  events: [changed(projectId, 'added', edit.kind)],
                } satisfies Mutation<RecipeStep[]>
              }),
            ),
          )
        }),

      update: (projectId, id, edit) =>
        Effect.gen(function* () {
          // A copy, a link and a run of a line of its own are checked on the disk first; a run of
          // a command, inside the transaction.
          const place =
            edit.kind !== 'run'
              ? yield* placed(projectId, edit)
              : edit.commandId === null
                ? yield* ownLine(projectId, edit)
                : null
          return yield* withDatabase(
            mutate('changing a step of the recipe', (transaction) =>
              Effect.gen(function* () {
                // Rewritten in its place: its rank is kept, and so is its order in the recipe.
                yield* stepIn(transaction, projectId, id)
                const step = place ?? (yield* commanded(transaction, projectId, edit))
                yield* transaction
                  .update(projectPreparationSteps)
                  .set({ kind: edit.kind, ...step })
                  .where(eq(projectPreparationSteps.id, id))
                  .pipe(Effect.mapError(failed('writing the recipe')))
                return {
                  result: yield* recipeOf(transaction, projectId),
                  events: [changed(projectId, 'updated', edit.kind)],
                } satisfies Mutation<RecipeStep[]>
              }),
            ),
          )
        }),

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
