/**
 * A Project's preparation recipe, as its settings write it: an ordered list of steps that prepare
 * each Workspace it makes.
 *
 * A copy or a link names a file or a folder of the main checkout by its path under one of the
 * Project's repositories, or under the main checkout's root; it lands at the same place in the
 * Workspace. Its source must be there when the step is saved, and is checked again when it runs.
 * A run starts a catalogue command, or a line of its own, in a folder under its repository or the
 * root. Paths and lines may name the template names Hemera fills; any other `{name}` is refused.
 *
 * The recipe is written whole, at the Project's version, and takes the Project to its next one.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  RECIPE_KINDS,
  ROOT_REPOSITORY,
  type RecipeKind,
  checkedTemplate,
  fillTemplate,
  repositoryPath,
} from '@hemera/core/domain'
import {
  InvalidRecipeStep,
  type Project,
  type RecipeCheck,
  type RecipeEdit,
  type RecipeStep,
  type RecipeStepDraft,
} from '@hemera/ipc'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { bump, getProject } from './projects.ts'
import { Database, refusedWhile } from './storage/database.ts'
import { projectPreparationSteps } from './storage/schema.ts'
import { mutate } from './transaction.ts'
import { mainCheckoutPlace, templateValuesOf } from './workspaces.ts'

const recipeKind = (kind: string): RecipeKind => RECIPE_KINDS.find((one) => one === kind) ?? 'run'

/** A Project's recipe, in its order. */
export const getRecipe = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(projectPreparationSteps)
      .where(eq(projectPreparationSteps.projectId, projectId))
      .orderBy(asc(projectPreparationSteps.position))
      .pipe(Effect.mapError(refusedWhile('reading the recipe')))
    return rows.map((row): RecipeStep => ({
      id: row.id,
      position: row.position,
      kind: recipeKind(row.kind),
      repositoryId: row.repositoryId,
      path: row.path,
      commandId: row.commandId,
      line: row.line,
    }))
  })

const refused = (position: number, reason: string) =>
  Effect.fail(new InvalidRecipeStep({ position, reason }))

/** A path under a step's base, in one spelling, refused when it climbs out. */
const underBase = (path: string) =>
  Effect.gen(function* () {
    const checked = yield* Effect.fromResult(repositoryPath(path))
    return yield* Effect.fromResult(checkedTemplate(checked))
  })

/**
 * One step as it will be written, or the reason it cannot be: its repository is one of the
 * Project's, its path stays under it, its templates name what Hemera fills, and the source of a
 * copy or a link is in the main checkout now.
 */
const checkedStep = (project: Project, draft: RecipeStepDraft, position: number) =>
  Effect.gen(function* () {
    const repository =
      draft.repositoryId === null
        ? null
        : project.repositories.find((one) => one.id === draft.repositoryId)
    if (repository === undefined) {
      return yield* refused(position, 'its repository is not one of this Project')
    }
    const base = repository?.path ?? ROOT_REPOSITORY
    const blank = (text: string | null) => text === null || text.trim() === ''

    if (draft.kind === 'run') {
      if (blank(draft.commandId) === blank(draft.line)) {
        return yield* refused(position, 'a run starts a catalogue command or a line of its own')
      }
      const line = blank(draft.line)
        ? null
        : yield* Effect.fromResult(checkedTemplate(draft.line ?? ''))
      const path = blank(draft.path) ? null : yield* underBase(draft.path ?? '')
      return {
        kind: draft.kind,
        repositoryId: draft.repositoryId,
        path: path === ROOT_REPOSITORY ? null : path,
        commandId: blank(draft.commandId) ? null : (draft.commandId ?? null),
        line: line === null ? null : line.trim(),
      } satisfies RecipeStepDraft
    }

    if (blank(draft.path)) {
      return yield* refused(position, `a ${draft.kind} names the file or folder it places`)
    }
    const path = yield* underBase(draft.path ?? '')
    if (path === ROOT_REPOSITORY) {
      return yield* refused(position, `a ${draft.kind} names a file or folder, not its repository`)
    }
    const source = join(
      project.mainCheckout,
      base,
      // Checked as the main checkout fills it: that is where the source is read.
      fillTemplate(path, templateValuesOf(mainCheckoutPlace(project))),
    )
    if (!existsSync(source)) {
      return yield* refused(position, `${source} is not in the main checkout`)
    }
    return {
      kind: draft.kind,
      repositoryId: draft.repositoryId,
      path,
      commandId: null,
      line: null,
    } satisfies RecipeStepDraft
  })

/** Writes the whole recipe, every step checked first, at the Project's version. */
export const saveRecipe = (edit: RecipeEdit) =>
  Effect.gen(function* () {
    const project = yield* getProject(edit.projectId)
    const steps = yield* Effect.forEach(edit.steps, (draft, at) =>
      checkedStep(project, draft, at + 1),
    )
    yield* mutate('writing the recipe', (transaction) =>
      Effect.gen(function* () {
        yield* bump(transaction, project.id, edit.version, {})
        yield* transaction
          .delete(projectPreparationSteps)
          .where(eq(projectPreparationSteps.projectId, project.id))
          .pipe(Effect.mapError(refusedWhile('writing the recipe')))
        if (steps.length > 0) {
          yield* transaction
            .insert(projectPreparationSteps)
            .values(
              steps.map((step, at) => ({
                id: crypto.randomUUID(),
                projectId: project.id,
                position: at + 1,
                ...step,
              })),
            )
            .pipe(Effect.mapError(refusedWhile('writing the recipe')))
        }
        return {
          result: undefined,
          events: [
            {
              type: 'project.recipe_changed',
              entityKind: 'project',
              entityId: project.id,
              source: 'ui' as const,
              author: 'human' as const,
              payload: { steps: steps.map((step) => step.kind) },
            },
          ],
        }
      }),
    )
    return yield* getRecipe(project.id)
  })

/** What saving each step would refuse, by position, without writing anything. */
export const checkRecipe = (projectId: string, drafts: ReadonlyArray<RecipeStepDraft>) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    return yield* Effect.forEach(drafts, (draft, at) =>
      checkedStep(project, draft, at + 1).pipe(
        Effect.match({
          onFailure: (refusal): RecipeCheck => ({ position: at + 1, problem: refusal.message }),
          onSuccess: (): RecipeCheck => ({ position: at + 1, problem: null }),
        }),
      ),
    )
  })
