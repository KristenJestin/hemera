/**
 * The documenter's rules (#146): a doc recipe refused with its sentence, when a recipe applies to a
 * Spec, which files the applicable recipes name, the defaults proposed from what a main checkout
 * holds, and the reason a "no change" report must carry.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type DocRecipeDraft,
  docRecipeProblem,
  noChangeReasonProblem,
  proposeDocRecipes,
  recipeApplies,
  recipesCover,
} from '../src/domain/index.ts'

const recipe = (over: Partial<DocRecipeDraft> = {}): DocRecipeDraft => ({
  repository: 'api',
  path: 'README.md',
  purpose: 'How to install and run the api.',
  applies: 'always',
  words: [],
  ...over,
})

describe('A doc recipe is refused with its sentence', () => {
  test('a recipe whose path leaves its repository is refused, naming it', () => {
    expect(docRecipeProblem(recipe({ path: '../secrets.md' }))).toBe(
      '../secrets.md leaves its repository: name a file inside it.',
    )
    expect(docRecipeProblem(recipe({ path: 'docs/../../web/README.md' }))).toBe(
      'docs/../../web/README.md leaves its repository: name a file inside it.',
    )
    expect(docRecipeProblem(recipe({ path: '/etc/README.md' }))).toBe(
      '/etc/README.md leaves its repository: name a file inside it.',
    )
    expect(docRecipeProblem(recipe({ repository: '.', path: 'C:\\notes.md' }))).toBe(
      'C:\\notes.md leaves the Workspace root: name a file inside it.',
    )
  })

  test('a recipe needs a path and a purpose', () => {
    expect(docRecipeProblem(recipe({ path: ' ' }))).toBe(
      'Write the file or the pattern the recipe names, as in README.md or docs/**/*.md.',
    )
    expect(docRecipeProblem(recipe({ purpose: '' }))).toBe(
      'Say in one sentence what the files are for.',
    )
  })

  test('a recipe that applies when the Impact names a word needs a word', () => {
    expect(docRecipeProblem(recipe({ applies: 'when_impact_names', words: [' '] }))).toBe(
      'Give the words the Spec’s Impact must name for this recipe to apply.',
    )
    expect(docRecipeProblem(recipe({ applies: 'always', words: ['API'] }))).toBe(
      'A recipe that always applies names no words.',
    )
  })

  test('a recipe inside its repository is kept', () => {
    expect(docRecipeProblem(recipe({ path: 'docs/**/*.md' }))).toBeNull()
    expect(
      docRecipeProblem(
        recipe({ path: 'openapi.yaml', applies: 'when_impact_names', words: ['API'] }),
      ),
    ).toBeNull()
  })
})

describe('A recipe when_impact_names applies when the Impact names one of its words', () => {
  const contract = recipe({ path: 'openapi.yaml', applies: 'when_impact_names', words: ['API'] })

  test('a recipe when_impact_names: API applies when the Impact says "API" and not otherwise', () => {
    expect(recipeApplies(contract, 'The public API of the invoices changes.')).toBe(true)
    expect(recipeApplies(contract, 'The api answers in CSV.')).toBe(true)
    expect(recipeApplies(contract, 'A rapid change of the invoices screen.')).toBe(false)
    expect(recipeApplies(contract, 'The invoices screen changes.')).toBe(false)
  })

  test('a recipe that always applies applies to any Impact', () => {
    expect(recipeApplies(recipe(), '')).toBe(true)
  })
})

describe('The applicable recipes name the files the documenter may write', () => {
  const recipes = [
    recipe(),
    recipe({ path: 'docs/**/*.md' }),
    recipe({ repository: '.', path: 'CHANGELOG.md' }),
  ]

  test('a file a recipe names, by path or by pattern, is covered', () => {
    expect(recipesCover(recipes, { repository: 'api', path: 'README.md' })).toBe(true)
    expect(recipesCover(recipes, { repository: 'api', path: 'docs/guide/export.md' })).toBe(true)
    expect(recipesCover(recipes, { repository: '.', path: 'CHANGELOG.md' })).toBe(true)
  })

  test('a file no recipe names is not covered', () => {
    expect(recipesCover(recipes, { repository: 'api', path: 'export.ts' })).toBe(false)
    expect(recipesCover(recipes, { repository: 'web', path: 'README.md' })).toBe(false)
    expect(recipesCover(recipes, { repository: '.', path: 'api/README.md' })).toBe(false)
  })
})

describe('The proposed recipes come from what the main checkout holds', () => {
  test('a readme, a docs folder and a contract are proposed, each in its repository', () => {
    const proposed = proposeDocRecipes([
      {
        repository: 'api',
        files: ['README.md', 'docs/guide.md', 'openapi.yaml', 'invoices.ts'],
      },
      { repository: 'web', files: ['index.ts', 'schema.graphql'] },
      { repository: 'tools', files: ['run.ts'] },
    ])
    expect(proposed).toEqual([
      {
        repository: 'api',
        path: 'README.md',
        purpose: 'What the api is, and how to install and run it.',
        applies: 'always',
        words: [],
      },
      {
        repository: 'api',
        path: 'docs/**/*.md',
        purpose: 'The documentation of the api.',
        applies: 'always',
        words: [],
      },
      {
        repository: 'api',
        path: 'openapi.yaml',
        purpose: 'The interface contract of the api.',
        applies: 'when_impact_names',
        words: ['API', 'interface', 'contract', 'schema'],
      },
      {
        repository: 'web',
        path: 'schema.graphql',
        purpose: 'The interface contract of the web.',
        applies: 'when_impact_names',
        words: ['API', 'interface', 'contract', 'schema'],
      },
    ])
  })

  test('nothing is proposed for a checkout with no documentation', () => {
    expect(proposeDocRecipes([{ repository: 'api', files: ['invoices.ts'] }])).toEqual([])
  })
})

describe('"No change" is accepted only with a reason specific to this change', () => {
  test('docs_report with no change and no reason, a five-character reason, or "nothing to document" is refused', () => {
    expect(noChangeReasonProblem(undefined)).toBe(
      'Name the files you changed, or say why this change needs no documentation: the user sees your reason.',
    )
    expect(noChangeReasonProblem('fine.')).toBe(
      'Say why this change needs no documentation, specifically: 20 characters at least.',
    )
    for (const generic of ['Nothing to document.', 'no change needed', 'N/A']) {
      expect(noChangeReasonProblem(generic)).toBe(
        `“${generic}” says nothing about this change: say why it needs no documentation.`,
      )
    }
  })

  test('a reason specific to this change is accepted', () => {
    expect(
      noChangeReasonProblem('The export is internal: no reader of the README calls it.'),
    ).toBeNull()
  })
})
