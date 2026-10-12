/**
 * A Project's doc recipes (#146), as its settings keep them: the list, the defaults proposed from
 * what each repository of the main checkout holds (only proposed: nothing is saved until the user
 * accepts them), a recipe written, removed or moved.
 *
 * Saving checks the whole recipe first (`docRecipeProblem`), then what only the Project knows: a
 * repository it declares. A refusal carries the sentence the settings show. A running mission never
 * reads these rows: it reads the copy taken at its launch (CT-34).
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  DOC_RECIPE_APPLIES,
  type DocListing,
  type DocRecipe,
  type DocRecipeApplies,
  type DocRecipeDraft,
  docRecipeProblem,
  proposeDocRecipes,
} from '@hemera/core/domain'
import { DocRecipeRefused, type Project, UnknownDocRecipe } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import type { EventPayload } from './journal.ts'
import { getProject } from './projects.ts'
import { Database, type EngineTransaction, refusedWhile } from './storage/database.ts'
import { projectDocRecipes } from './storage/schema.ts'
import { mutate } from './transaction.ts'

type RecipeRow = typeof projectDocRecipes.$inferSelect

const WordsJson = Schema.fromJsonString(Schema.Array(Schema.String))
const readWords = Schema.decodeUnknownOption(WordsJson)
const writeWords = Schema.encodeSync(WordsJson)

const appliesOf = (value: string): DocRecipeApplies =>
  DOC_RECIPE_APPLIES.find((one) => one === value) ?? 'always'

const recipeOf = (row: RecipeRow): DocRecipe => ({
  id: row.id,
  projectId: row.projectId,
  repository: row.repository,
  path: row.path,
  purpose: row.purpose,
  applies: appliesOf(row.applies),
  words: Option.getOrElse(readWords(row.words), () => []),
  rank: row.rank,
})

/** The columns a recipe is written as: trimmed, its empty words left out. */
const columnsOf = (draft: DocRecipeDraft) => ({
  repository: draft.repository,
  path: draft.path.trim(),
  purpose: draft.purpose.trim(),
  applies: draft.applies,
  words: writeWords(draft.words.map((word) => word.trim()).filter((word) => word !== '')),
})

const rowsIn = (reader: EngineTransaction, projectId: string) =>
  reader
    .select()
    .from(projectDocRecipes)
    .where(eq(projectDocRecipes.projectId, projectId))
    .orderBy(asc(projectDocRecipes.rank))
    .pipe(Effect.mapError(refusedWhile('reading the doc recipes')))

const recipeEvent = (type: string, projectId: string, payload: EventPayload) => ({
  type,
  entityKind: 'project',
  entityId: projectId,
  source: 'ui' as const,
  author: 'human' as const,
  payload,
})

/** The Project's recipes, in their order. */
export const listDocRecipes = (projectId: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database.transaction((reader) => rowsIn(reader, projectId))
    return rows.map(recipeOf)
  })

/** How deep the proposals look into a repository, and how many entries they read at most. */
const LISTING_DEPTH = 4
const LISTING_MOST = 5000

/** The files of a folder, relative and with `/`, its hidden folders and dependencies left out. */
const filesUnder = (root: string): string[] => {
  const found: string[] = []
  const walk = (folder: string, prefix: string, depth: number) => {
    if (depth > LISTING_DEPTH || found.length >= LISTING_MOST) return
    let entries
    try {
      entries = readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= LISTING_MOST) return
      const path = `${prefix}${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        walk(join(folder, entry.name), `${path}/`, depth + 1)
      } else if (entry.isFile()) {
        found.push(path)
      }
    }
  }
  walk(root, '', 1)
  return found.toSorted()
}

/**
 * The recipes proposed from what each repository of the main checkout holds, never saved: none for
 * a Project that already has recipes, unless the user asks.
 */
export const proposedDocRecipes = (projectId: string, asked: boolean) =>
  Effect.gen(function* () {
    const kept = yield* listDocRecipes(projectId)
    if (kept.length > 0 && !asked) return []
    const project = yield* getProject(projectId)
    const listings: DocListing[] = project.repositories.map((repository) => ({
      repository: repository.path,
      files: filesUnder(join(project.mainCheckout, repository.path)),
    }))
    return proposeDocRecipes(listings)
  })

/** Why a recipe cannot be written in the Project, or nothing. */
const refusal = (project: Project, draft: DocRecipeDraft) =>
  Effect.gen(function* () {
    const problem = docRecipeProblem(draft)
    if (problem !== null) return yield* new DocRecipeRefused({ reason: problem })
    if (
      draft.repository !== null &&
      !project.repositories.some((one) => one.path === draft.repository)
    ) {
      return yield* new DocRecipeRefused({
        reason: `${draft.repository} is not a repository of this Project.`,
      })
    }
  })

const inserted = (
  transaction: EngineTransaction,
  projectId: string,
  draft: DocRecipeDraft,
  rank: number,
) =>
  Effect.gen(function* () {
    const row: RecipeRow = {
      id: crypto.randomUUID(),
      projectId,
      ...columnsOf(draft),
      rank,
      createdAt: new Date().toISOString(),
    }
    yield* transaction
      .insert(projectDocRecipes)
      .values(row)
      .pipe(Effect.mapError(refusedWhile('writing the doc recipe')))
    return recipeOf(row)
  })

const named = (recipe: DocRecipe) => ({ recipeId: recipe.id, path: recipe.path })

/** Writes a recipe: a new one, last, when `id` is null; the one `id` names otherwise. */
export const saveDocRecipe = (projectId: string, id: string | null, draft: DocRecipeDraft) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database.transaction((reader) => rowsIn(reader, projectId))
    const existing = id === null ? undefined : rows.find((row) => row.id === id)
    if (id !== null && existing === undefined) return yield* new UnknownDocRecipe({ id })
    yield* refusal(project, draft)
    return yield* mutate('saving a doc recipe', (transaction) =>
      Effect.gen(function* () {
        if (existing === undefined) {
          const recipe = yield* inserted(
            transaction,
            projectId,
            draft,
            (rows.at(-1)?.rank ?? -1) + 1,
          )
          return {
            result: recipe,
            events: [recipeEvent('doc_recipe.created', projectId, named(recipe))],
          }
        }
        const columns = columnsOf(draft)
        yield* transaction
          .update(projectDocRecipes)
          .set(columns)
          .where(eq(projectDocRecipes.id, existing.id))
          .pipe(Effect.mapError(refusedWhile('writing the doc recipe')))
        const recipe = recipeOf({ ...existing, ...columns })
        return {
          result: recipe,
          events: [recipeEvent('doc_recipe.updated', projectId, named(recipe))],
        }
      }),
    )
  })

/** Saves the proposals kept, in their order and all at once: one refused refuses them all. */
export const acceptDocRecipes = (projectId: string, proposals: ReadonlyArray<DocRecipeDraft>) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const database = yield* Database
    const rows = yield* database.transaction((reader) => rowsIn(reader, projectId))
    for (const proposal of proposals) yield* refusal(project, proposal)
    return yield* mutate('accepting the proposed doc recipes', (transaction) =>
      Effect.gen(function* () {
        let rank = (rows.at(-1)?.rank ?? -1) + 1
        const saved: DocRecipe[] = []
        for (const proposal of proposals) {
          saved.push(yield* inserted(transaction, projectId, proposal, rank))
          rank += 1
        }
        return {
          result: saved,
          events: saved.map((recipe) =>
            recipeEvent('doc_recipe.created', projectId, named(recipe)),
          ),
        }
      }),
    )
  })

/** Takes a recipe out of the Project; a mission launched before keeps its copy. */
export const removeDocRecipe = (projectId: string, id: string) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    yield* mutate('removing a doc recipe', (transaction) =>
      Effect.gen(function* () {
        const [removed] = yield* transaction
          .delete(projectDocRecipes)
          .where(and(eq(projectDocRecipes.id, id), eq(projectDocRecipes.projectId, projectId)))
          .returning()
          .pipe(Effect.mapError(refusedWhile('removing the doc recipe')))
        if (removed === undefined) return yield* new UnknownDocRecipe({ id })
        return {
          result: undefined,
          events: [
            recipeEvent('doc_recipe.removed', projectId, { recipeId: id, path: removed.path }),
          ],
        }
      }),
    )
  })

/** Moves a recipe to its 0-based place in the list; answers the list. */
export const moveDocRecipe = (projectId: string, id: string, rank: number) =>
  Effect.gen(function* () {
    yield* getProject(projectId)
    yield* mutate('moving a doc recipe', (transaction) =>
      Effect.gen(function* () {
        const rows = yield* rowsIn(transaction, projectId)
        const moved = rows.find((row) => row.id === id)
        if (moved === undefined) return yield* new UnknownDocRecipe({ id })
        const others = rows.filter((row) => row.id !== id)
        const at = Math.max(0, Math.min(others.length, Math.trunc(rank)))
        const order = [...others.slice(0, at), moved, ...others.slice(at)]
        for (const [index, row] of order.entries()) {
          if (row.rank === index) continue
          yield* transaction
            .update(projectDocRecipes)
            .set({ rank: index })
            .where(eq(projectDocRecipes.id, row.id))
            .pipe(Effect.mapError(refusedWhile('moving the doc recipe')))
        }
        return {
          result: undefined,
          events: [recipeEvent('doc_recipe.moved', projectId, { recipeId: id, rank: at })],
        }
      }),
    )
    return yield* listDocRecipes(projectId)
  })
