/**
 * The Project's doc recipes (#146), as they cross the links: the list, the defaults proposed from
 * what the main checkout holds (never saved until the user accepts them), a recipe written, removed
 * or moved. A recipe refused carries the sentence the settings show.
 */

import { DocRecipe, DocRecipeDraft, DocRecipeField } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export { DocRecipe, DocRecipeDraft, DocRecipeField }

/**
 * A recipe the settings cannot save, the sentence they show, and the field they show it under when
 * it concerns one.
 */
export class DocRecipeRefused extends Schema.TaggedError<DocRecipeRefused>()('DocRecipeRefused', {
  reason: Schema.String,
  field: Schema.optionalKey(DocRecipeField),
}) {
  override get message(): string {
    return this.reason
  }
}

export class UnknownDocRecipe extends Schema.TaggedError<UnknownDocRecipe>()('UnknownDocRecipe', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This recipe is no longer in the Project.'
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone, UnknownProject] as const

export const DocRecipesRpcs = RpcGroup.make(
  /** The Project's recipes, in their order. */
  Rpc.make('docRecipes.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(DocRecipe),
    error: failing(...always),
  }),
  /**
   * The recipes proposed from what the main checkout holds: none for a Project that has recipes,
   * unless `asked`. Nothing is saved.
   */
  Rpc.make('docRecipes.propose', {
    payload: { projectId: Schema.String, asked: Schema.Boolean },
    success: Schema.Array(DocRecipeDraft),
    error: failing(...always),
  }),
  /** Saves the proposals kept, edited or not, all at once: one refused refuses them all. */
  Rpc.make('docRecipes.accept', {
    payload: { projectId: Schema.String, proposals: Schema.Array(DocRecipeDraft) },
    success: Schema.Array(DocRecipe),
    error: failing(...always, DocRecipeRefused),
  }),
  /** Writes a recipe: a new one, last, when `id` is null; the one `id` names otherwise. */
  Rpc.make('docRecipes.save', {
    payload: {
      projectId: Schema.String,
      id: Schema.NullOr(Schema.String),
      recipe: DocRecipeDraft,
    },
    success: DocRecipe,
    error: failing(...always, DocRecipeRefused, UnknownDocRecipe),
  }),
  /** Takes a recipe out; a mission launched before keeps its copy. */
  Rpc.make('docRecipes.remove', {
    payload: { projectId: Schema.String, id: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownDocRecipe),
  }),
  /** Moves a recipe to `rank`, its 0-based place in the list; answers the list. */
  Rpc.make('docRecipes.move', {
    payload: { projectId: Schema.String, id: Schema.String, rank: Schema.Number },
    success: Schema.Array(DocRecipe),
    error: failing(...always, UnknownDocRecipe),
  }),
)
