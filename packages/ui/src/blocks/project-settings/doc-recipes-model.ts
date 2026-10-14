/**
 * The documentation recipes of a Project, in its settings: the files the documenter keeps in line
 * with the code at the end of every Building, and what each is for.
 *
 * One line per recipe, in its order: where it is (a repository or the root), which files (a path
 * or a pattern, in the mono face), what they are for, and whether it always applies or only when
 * the Spec's Impact names one of its words — an interface contract is rewritten only when the
 * Spec touches it. A recipe is moved by its handle, with the pointer or the arrows; a line opens
 * its dialog.
 *
 * A Project with no recipe is offered what Hemera found in its main checkout — the readmes, a
 * docs folder, a contract — in the quiet tone, each with Accept; Accept all stands in the head.
 * Nothing is kept before it is accepted. What arrives or leaves grows and folds on `fold`.
 */
export interface SettingsDocRecipe {
  id: string
  /** The repository it names files in, by path; `.` for the main checkout's root. */
  place: string
  /** A path or a pattern, inside its repository. */
  path: string
  /** What the files are for, in one sentence: the documenter reads it. */
  purpose: string
  /** Null: it always applies. Otherwise the words the Spec's Impact must name for it to apply. */
  words: readonly string[] | null
}

/** Where a recipe is, as its line says it: `api`, `root`. */
export function placeOfRecipe(recipe: Pick<SettingsDocRecipe, 'place'>): string {
  return recipe.place === '.' ? 'root' : recipe.place
}

/** What names a recipe in a title or a button: `README.md in api`. */
export function recipeName(recipe: Pick<SettingsDocRecipe, 'place' | 'path'>): string {
  return `${recipe.path} in ${placeOfRecipe(recipe)}`
}

export function wordsIn(recipe: Pick<SettingsDocRecipe, 'words'>): string[] {
  return (recipe.words ?? []).map((word) => word.trim()).filter((word) => word !== '')
}

/** When a recipe applies, in words. */
export function appliesOf(recipe: Pick<SettingsDocRecipe, 'words'>): string {
  const words = wordsIn(recipe)
  if (recipe.words === null) return 'always'
  const listed =
    words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1) ?? ''}`
  return `when the Spec’s Impact names ${listed}`
}

/** What the dialog of a recipe writes. */
export type DocRecipeDraft = Omit<SettingsDocRecipe, 'id'>

/** A recipe not written yet: at the root, always. */
export const NEW_DOC_RECIPE: DocRecipeDraft = { place: '.', path: '', purpose: '', words: null }
