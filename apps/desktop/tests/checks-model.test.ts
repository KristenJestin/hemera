/**
 * What the Checks and Documentation sections of a Project's settings show of the engine's records
 * (#152), what their dialogs write back, where a refusal is said, and the one move a reorder is.
 */

import {
  CheckRefused,
  DocRecipeRefused,
  InvalidProofLimit,
  StorageFailed,
  type Command,
  type DocRecipe,
  type ProjectCheck,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  checkChoicesOf,
  checkDraftOf,
  checkFormOf,
  checkRefusalsOf,
  docRecipeDraftOf,
  docRecipeFormOf,
  docRecipeRefusalsOf,
  proofLimitRefusalOf,
  proofLimitWordsOf,
  proposedChecksOf,
  proposedDocRecipesOf,
  settingsCheckOf,
  settingsDocRecipeOf,
} from '../src/renderer/checks-model.ts'

const command = (over: Partial<Command>): Command => ({
  id: 'c-lint',
  projectId: 'acme',
  name: 'lint',
  type: 'lint',
  line: 'pnpm lint',
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: true,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...over,
})

const CATALOGUE: ReadonlyArray<Command> = [
  command({}),
  command({ id: 'c-e2e', name: 'e2e', type: 'e2e', line: 'pnpm e2e', askBeforeRunning: true }),
  command({ id: 'c-web', name: 'web', type: 'serve', line: 'pnpm dev', check: false }),
  command({ id: 'c-seed', name: 'seed', type: 'script', line: 'node seed.mjs', check: false }),
]

const coverage: ProjectCheck = {
  id: 'k1',
  projectId: 'acme',
  rank: 0,
  name: 'coverage',
  commandId: null,
  line: 'pnpm --filter api test --coverage',
  where: 'repository',
  repository: 'api',
  when: 'requirement',
  expect: { pattern: 'All files\\s*\\|\\s*([0-9.]+)', minimum: 70 },
  files: null,
}

describe('A check, as its line shows it', () => {
  test('a free line keeps its line, where it runs, and the number it expects as written', () => {
    expect(settingsCheckOf(coverage, CATALOGUE)).toEqual({
      id: 'k1',
      name: 'coverage',
      command: null,
      line: 'pnpm --filter api test --coverage',
      where: 'repository',
      repository: 'api',
      when: 'requirement',
      expect: { pattern: 'All files\\s*\\|\\s*([0-9.]+)', minimum: '70' },
      files: null,
    })
  })

  test('a catalogue command shows its line and its "ask before running" mark', () => {
    const e2e = { ...coverage, commandId: 'c-e2e', line: null, expect: null }
    expect(settingsCheckOf(e2e, CATALOGUE).command).toEqual({
      id: 'c-e2e',
      name: 'e2e',
      type: 'e2e',
      line: 'pnpm e2e',
      askBeforeRunning: true,
    })
  })

  test('the commands offered are those the catalogue marks as checks, never a service', () => {
    expect(checkChoicesOf(CATALOGUE).map((one) => one.name)).toEqual(['lint', 'e2e'])
  })

  test('the proposals are lines of their own, each with the id it was proposed under', () => {
    const lint = { ...coverage, name: 'lint', commandId: 'c-lint', line: null, expect: null }
    const proposed = proposedChecksOf([{ id: 'proposed-0', draft: lint }], CATALOGUE)
    expect(proposed.map((one) => [one.id, one.name, one.command?.line])).toEqual([
      ['proposed-0', 'lint', 'pnpm lint'],
    ])
  })
})

describe('A check, as its dialog writes it', () => {
  test('a check read into the dialog is written back as it was', () => {
    const form = checkFormOf(settingsCheckOf(coverage, CATALOGUE))
    const { id: _id, projectId: _project, rank: _rank, ...draft } = coverage
    expect(checkDraftOf(form)).toEqual(draft)
  })

  test('a catalogue command chosen sends no line', () => {
    const form = { ...checkFormOf(settingsCheckOf(coverage, CATALOGUE)), command: 'c-lint' }
    expect(checkDraftOf(form)).toMatchObject({ commandId: 'c-lint', line: null })
  })

  test('a minimum left empty or not a number is sent as no number, for the engine to refuse', () => {
    const form = checkFormOf(settingsCheckOf(coverage, CATALOGUE))
    for (const minimum of ['', 'seventy']) {
      expect(checkDraftOf({ ...form, expect: { pattern: 'x', minimum } }).expect?.minimum).toBe(
        Number.NaN,
      )
    }
  })
})

describe('A refusal is said at the field it concerns', () => {
  test('a check refused at a field is said under it, the others at the foot', () => {
    expect(
      checkRefusalsOf(new CheckRefused({ reason: '“|” is shell syntax.', field: 'line' })),
    ).toEqual({ fields: { line: '“|” is shell syntax.' }, foot: undefined })
    expect(
      checkRefusalsOf(new CheckRefused({ reason: 'Choose the repository.', field: null })),
    ).toEqual({ fields: {}, foot: 'Choose the repository.' })
    expect(checkRefusalsOf(new StorageFailed({ sentence: 'disk full' })).foot).toContain(
      'disk full',
    )
  })

  test('a doc recipe refused at its path is said under it', () => {
    expect(
      docRecipeRefusalsOf(new DocRecipeRefused({ reason: '../x leaves api.', field: 'path' })),
    ).toEqual({ fields: { path: '../x leaves api.' }, foot: undefined })
  })
})

const readme: DocRecipe = {
  id: 'd1',
  projectId: 'acme',
  rank: 0,
  repository: 'api',
  path: 'openapi.yaml',
  purpose: 'The HTTP API contract.',
  applies: 'when_impact_names',
  words: ['API', 'contract'],
}

describe('A doc recipe, as its line shows it and its dialog writes it', () => {
  test('a recipe that applies when named shows its words, and is written back as it was', () => {
    const shown = settingsDocRecipeOf(readme)
    expect(shown).toEqual({
      id: 'd1',
      place: 'api',
      path: 'openapi.yaml',
      purpose: 'The HTTP API contract.',
      words: ['API', 'contract'],
    })
    const { id: _id, projectId: _project, rank: _rank, ...draft } = readme
    expect(docRecipeDraftOf(docRecipeFormOf(shown))).toEqual(draft)
  })

  test('a recipe that always applies names no words, and blank words are dropped', () => {
    const always = docRecipeDraftOf({ place: '.', path: 'README.md', purpose: 'p', words: null })
    expect(always).toMatchObject({ repository: '.', applies: 'always', words: [] })
    const named = docRecipeDraftOf({ place: '.', path: 'a', purpose: 'p', words: ['API', ' '] })
    expect(named).toMatchObject({ applies: 'when_impact_names', words: ['API'] })
  })

  test('the proposals keep the ids they were proposed under', () => {
    const { id: _id, projectId: _project, rank: _rank, ...draft } = readme
    const proposals = [
      { id: 'proposed-0', draft },
      { id: 'proposed-2', draft },
    ]
    expect(proposedDocRecipesOf(proposals).map((one) => one.id)).toEqual([
      'proposed-0',
      'proposed-2',
    ])
  })
})

describe('How long a proof may run, in its field', () => {
  test('an empty field keeps the default; a whole number from 1 to 1440 is written', () => {
    expect(proofLimitRefusalOf(null)).toBeUndefined()
    expect(proofLimitRefusalOf(' 25 ')).toBeUndefined()
    expect(proofLimitRefusalOf('1440')).toBeUndefined()
  })

  test('a refused value (0, negative, past the bound, not a number) is refused with its reason', () => {
    expect(['0', '-3', '1441', '2.5', 'ten'].map(proofLimitRefusalOf)).toEqual([
      'A proof needs at least 1 minute.',
      'A proof needs at least 1 minute.',
      'A proof may run 1440 minutes (24 hours) at most.',
      'Write a whole number of minutes.',
      'Write a whole number of minutes.',
    ])
  })

  test('the engine’s refusal is said in its own words; another failure says what was not kept', () => {
    expect(
      proofLimitWordsOf(new InvalidProofLimit({ reason: 'A proof needs at least 1 minute.' })),
    ).toBe('A proof needs at least 1 minute.')
    expect(proofLimitWordsOf(new StorageFailed({ sentence: 'the disk is full' }))).toMatch(
      /^The time limit could not be kept: /,
    )
  })
})
