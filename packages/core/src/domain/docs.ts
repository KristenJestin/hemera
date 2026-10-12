/**
 * The documenter (#146): the Project's doc recipes, which name the files the documenter keeps in
 * line with the code at the end of every Building, and what its report must carry.
 *
 * A recipe names a file or a pattern inside one repository (or the Workspace root), says in one
 * sentence what the files are for, and applies always or only when the Spec's Impact names one of
 * its words (an interface contract is rewritten only when the Spec touches it). The documenter
 * writes only the files the applicable recipes name; a report that changes nothing carries a
 * reason specific to the change.
 *
 * Pure rules: the engine keeps the recipes, copies them into a mission at launch and runs the
 * documenter.
 */

import { Schema } from 'effect'

import { globMatcher } from './checks.ts'
import { ROOT_REPOSITORY } from './project.ts'

/** When a recipe applies: always, or when the Spec's Impact names one of its words. */
export const DOC_RECIPE_APPLIES = ['always', 'when_impact_names'] as const
export const DocRecipeApplies = Schema.Literals(DOC_RECIPE_APPLIES)
export type DocRecipeApplies = typeof DocRecipeApplies.Type

/**
 * A recipe as the settings write it: its repository by path (`.` for the Workspace root, which is
 * the repository of a single-repository Project), the file or pattern inside it, what the files
 * are for, and when it applies.
 */
export const DocRecipeDraft = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  purpose: Schema.String,
  applies: DocRecipeApplies,
  /** The words the Impact must name, for `when_impact_names`; none otherwise. */
  words: Schema.Array(Schema.String),
})
export type DocRecipeDraft = typeof DocRecipeDraft.Type

/** A recipe of a Project: a draft kept, ordered by its rank. */
export const DocRecipe = Schema.Struct({
  ...DocRecipeDraft.fields,
  id: Schema.String,
  projectId: Schema.String,
  rank: Schema.Number,
})
export type DocRecipe = typeof DocRecipe.Type

/** How many passes the documenter makes at most in one Building, or one round (CT-39). */
export const DOCUMENTER_PASSES = 2

/** The subject of the `end` attempt the documenter's writes are attributed to. */
export const DOCUMENTATION = 'documentation'

/** A path with its separators as `/`, its `.` and `..` resolved; null when it leaves its folder. */
function insidePath(path: string): string | null {
  const written = path.trim().replaceAll('\\', '/')
  if (written.startsWith('/') || /^[A-Za-z]:/.test(written)) return null
  const parts: string[] = []
  for (const part of written.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

/** The field of the settings a recipe's refusal is said under. */
export const DOC_RECIPE_FIELDS = ['path', 'purpose', 'words'] as const
export const DocRecipeField = Schema.Literals(DOC_RECIPE_FIELDS)
export type DocRecipeField = typeof DocRecipeField.Type

/** Why a recipe cannot be saved: the sentence the settings show, and the field it is said under. */
export interface DocRecipeRefusal {
  readonly field: DocRecipeField
  readonly sentence: string
}

/** Why a recipe cannot be saved, and where the settings say it, or null when it can be. */
export function docRecipeRefusal(draft: DocRecipeDraft): DocRecipeRefusal | null {
  const path = draft.path.trim()
  if (path === '') {
    return {
      field: 'path',
      sentence: 'Write the file or the pattern the recipe names, as in README.md or docs/**/*.md.',
    }
  }
  if (insidePath(path) === null) {
    const where = draft.repository === ROOT_REPOSITORY ? 'the Workspace root' : 'its repository'
    return { field: 'path', sentence: `${path} leaves ${where}: name a file inside it.` }
  }
  if (draft.purpose.trim() === '') {
    return { field: 'purpose', sentence: 'Say in one sentence what the files are for.' }
  }
  const words = draft.words.filter((word) => word.trim() !== '')
  if (draft.applies === 'when_impact_names' && words.length === 0) {
    return {
      field: 'words',
      sentence: 'Give the words the Spec’s Impact must name for this recipe to apply.',
    }
  }
  if (draft.applies === 'always' && words.length > 0) {
    return { field: 'words', sentence: 'A recipe that always applies names no words.' }
  }
  return null
}

/** Why a recipe cannot be saved, as the sentence the settings show, or null when it can be. */
export function docRecipeProblem(draft: DocRecipeDraft): string | null {
  return docRecipeRefusal(draft)?.sentence ?? null
}

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a recipe applies to a Spec whose Impact section reads `impact`: a whole word, any case. */
export function recipeApplies(
  recipe: Pick<DocRecipeDraft, 'applies' | 'words'>,
  impact: string,
): boolean {
  if (recipe.applies === 'always') return true
  return recipe.words
    .map((word) => word.trim())
    .filter((word) => word !== '')
    .some((word) =>
      new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped(word)}($|[^\\p{L}\\p{N}_])`, 'iu').test(impact),
    )
}

/** A file of the Workspace: its repository by path (`.` for the Workspace root), its path there. */
export interface DocFile {
  readonly repository: string
  readonly path: string
}

/** Whether one of the recipes names a file, by its path or its pattern. */
export function recipesCover(
  recipes: ReadonlyArray<Pick<DocRecipeDraft, 'repository' | 'path'>>,
  file: DocFile,
): boolean {
  const path = insidePath(file.path)
  if (path === null) return false
  return recipes.some((recipe) => {
    const pattern = insidePath(recipe.path)
    return recipe.repository === file.repository && pattern !== null && globMatcher(pattern)(path)
  })
}

/** What a repository of the main checkout holds, as the proposals read it: its files' paths. */
export interface DocListing {
  readonly repository: string
  readonly files: ReadonlyArray<string>
}

/** The words a proposed interface contract applies on. */
const CONTRACT_WORDS = ['API', 'interface', 'contract', 'schema'] as const

/** An OpenAPI or Swagger document, a GraphQL schema, a JSON Schema. */
const CONTRACT =
  /(^|\/)((openapi|swagger)\.(ya?ml|json)|[^/]+\.(graphql|gql)|[^/]+\.schema\.json)$/i

/**
 * The recipes proposed from what each repository of the main checkout holds: its readme and its
 * docs folder, always; its interface contracts, when the Impact names one of their words. Nothing
 * is kept by proposing.
 */
export function proposeDocRecipes(listings: ReadonlyArray<DocListing>): DocRecipeDraft[] {
  return listings.flatMap((listing) => {
    const name = listing.repository === ROOT_REPOSITORY ? 'project' : listing.repository
    const readme = listing.files.find((file) => /^readme\.md$/i.test(file))
    const docs = listing.files.some((file) => file.startsWith('docs/'))
    const contracts = listing.files.filter((file) => CONTRACT.test(file)).toSorted()
    const proposed: DocRecipeDraft[] = []
    if (readme !== undefined) {
      proposed.push({
        repository: listing.repository,
        path: readme,
        purpose: `What the ${name} is, and how to install and run it.`,
        applies: 'always',
        words: [],
      })
    }
    if (docs) {
      proposed.push({
        repository: listing.repository,
        path: 'docs/**/*.md',
        purpose: `The documentation of the ${name}.`,
        applies: 'always',
        words: [],
      })
    }
    for (const contract of contracts) {
      proposed.push({
        repository: listing.repository,
        path: contract,
        purpose: `The interface contract of the ${name}.`,
        applies: 'when_impact_names',
        words: [...CONTRACT_WORDS],
      })
    }
    return proposed
  })
}

/** The shortest reason a "no change" report is accepted with. */
export const NO_CHANGE_REASON_LEAST = 20

/** Reasons that say nothing about the change. */
const GENERIC_REASONS = ['nothing to document', 'no change needed', 'n/a']

/** Why a "no change" report's reason is refused, as the documenter reads it, or null. */
export function noChangeReasonProblem(reason: string | undefined): string | null {
  const said = reason?.trim() ?? ''
  if (said === '') {
    return 'Name the files you changed, or say why this change needs no documentation: the user sees your reason.'
  }
  const plain = said.toLowerCase().replace(/[.!\s]+$/, '')
  if (GENERIC_REASONS.includes(plain)) {
    return `“${said}” says nothing about this change: say why it needs no documentation.`
  }
  return said.length < NO_CHANGE_REASON_LEAST
    ? `Say why this change needs no documentation, specifically: ${String(NO_CHANGE_REASON_LEAST)} characters at least.`
    : null
}

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** A file the documenter changed, and why. */
export const DocChanged = Schema.Struct({
  repository: Bounded(
    200,
    'The repository of the file, as your brief names it; `.` for the Workspace root.',
  ),
  path: Bounded(1000, 'The file, relative to that repository.'),
  why: Bounded(2000, 'What you changed in it, and why the code needed it.'),
})
export type DocChanged = typeof DocChanged.Type

/** What `docs_report` carries. */
export const DocsReport = Schema.Struct({
  changed: Schema.Array(DocChanged).annotate({
    description: 'Every documentation file you changed in this pass, once each.',
  }),
  no_change_reason: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(2000)).annotate({
      description:
        'When you changed nothing: why this change needs no documentation, specific to it (never "nothing to document").',
    }),
  ),
}).annotate({
  description:
    'Report your pass once: the documentation files you changed and why, or why nothing needed to change. Then end your turn.',
})
export type DocsReport = typeof DocsReport.Type
