import type { CheckDraft, CheckRefusals, SettingsCheck } from './checks.tsx'
import type { CatalogueChoice } from './command-line.tsx'
import type { DocRecipeDraft, DocRecipeRefusals, SettingsDocRecipe } from './doc-recipes.tsx'
import { shellRefusal } from './project-settings-fixtures.ts'

/**
 * Acme's checks and documentation recipes, as their settings sections show them, and the engine's
 * refusals of a draft, in its words. Neutral data only: this repository is public.
 */

/** The repositories of Acme a check or a recipe may name. */
export const PLACES = ['api', 'web', 'shared'] as const

/** The commands of Acme's catalogue that may be used as a check. */
export const CHECK_COMMANDS: readonly CatalogueChoice[] = [
  { id: 'lint', name: 'lint', type: 'lint', line: 'pnpm lint' },
  { id: 'typecheck', name: 'typecheck', type: 'typecheck', line: 'pnpm -r typecheck' },
  { id: 'test', name: 'test', type: 'test', line: 'pnpm --filter api test' },
  { id: 'web-test', name: 'web-test', type: 'test', line: 'pnpm --filter web test' },
  { id: 'build', name: 'build', type: 'build', line: 'pnpm build' },
  {
    id: 'e2e',
    name: 'e2e',
    type: 'e2e',
    line: 'pnpm --filter web e2e --project chromium',
    askBeforeRunning: true,
  },
]

function command(id: string): CatalogueChoice | null {
  return CHECK_COMMANDS.find((one) => one.id === id) ?? null
}

function check(part: Partial<SettingsCheck> & Pick<SettingsCheck, 'id' | 'name'>): SettingsCheck {
  return {
    command: command(part.id),
    line: null,
    where: 'changed',
    repository: null,
    when: 'task',
    expect: null,
    files: null,
    ...part,
  }
}

/** Acme as it is lived in: every moment holds checks, one of them asks before running. */
export const CHECKS: readonly SettingsCheck[] = [
  check({ id: 'lint', name: 'lint' }),
  check({ id: 'typecheck', name: 'typecheck' }),
  check({
    id: 'unit',
    name: 'tests the task wrote',
    command: null,
    line: 'pnpm vitest run {files}',
    files: '**/*.test.ts',
  }),
  check({ id: 'test', name: 'test', when: 'requirement' }),
  check({
    id: 'coverage',
    name: 'coverage',
    command: null,
    line: 'pnpm --filter api test --coverage',
    where: 'repository',
    repository: 'api',
    when: 'requirement',
    expect: { pattern: 'All files\\s*\\|\\s*([0-9.]+)', minimum: '70' },
  }),
  check({ id: 'build', name: 'build', where: 'root', when: 'end' }),
  check({ id: 'e2e', name: 'e2e', where: 'repository', repository: 'web', when: 'end' }),
]

/** What Hemera proposes from the catalogue for a Project that has no check yet. */
export const PROPOSED_CHECKS: readonly SettingsCheck[] = [
  check({ id: 'proposed-lint', name: 'lint', command: command('lint') }),
  check({ id: 'proposed-typecheck', name: 'typecheck', command: command('typecheck') }),
  check({ id: 'proposed-test', name: 'test', command: command('test'), when: 'requirement' }),
  check({
    id: 'proposed-web-test',
    name: 'web-test',
    command: command('web-test'),
    when: 'requirement',
  }),
  check({
    id: 'proposed-build',
    name: 'build',
    command: command('build'),
    where: 'root',
    when: 'end',
  }),
  check({ id: 'proposed-e2e', name: 'e2e', command: command('e2e'), where: 'root', when: 'end' }),
]

/** A long free line, a long name and a long pattern, in every field that holds one. */
export const LONG_CHECK: SettingsCheck = check({
  id: 'long',
  name: 'contract tests of the public payment and invoicing endpoints',
  command: null,
  line: 'pnpm --filter api exec vitest run --config vitest.contract.config.ts --reporter verbose --bail 1 {files}',
  where: 'repository',
  repository: 'shared',
  when: 'requirement',
  expect: { pattern: 'Contract coverage of the public endpoints:\\s+([0-9.]+)%', minimum: '85' },
  files: 'contracts/**/{payments,invoices,refunds}/*.contract.test.ts',
})

/** The checks of a Project that checks a lot: five repositories, nineteen checks. */
export const DENSE_CHECKS: readonly SettingsCheck[] = [
  ...CHECKS,
  LONG_CHECK,
  ...['ui-kit', 'billing'].flatMap((place) => [
    check({
      id: `${place}-lint`,
      name: `${place} lint`,
      command: null,
      line: `pnpm --filter ${place} lint`,
      where: 'repository',
      repository: place,
    }),
    check({
      id: `${place}-test`,
      name: `${place} test`,
      command: null,
      line: `pnpm --filter ${place} test`,
      where: 'repository',
      repository: place,
      when: 'requirement',
    }),
    check({
      id: `${place}-build`,
      name: `${place} build`,
      command: null,
      line: `pnpm --filter ${place} build`,
      where: 'repository',
      repository: place,
      when: 'end',
    }),
  ]),
  check({
    id: 'licences',
    name: 'licences',
    command: null,
    line: 'pnpm licenses list --prod',
    where: 'root',
    when: 'end',
  }),
  check({
    id: 'bundle',
    name: 'bundle size',
    command: null,
    line: 'pnpm --filter web size',
    where: 'repository',
    repository: 'web',
    when: 'end',
    expect: { pattern: 'Total:\\s+([0-9.]+) kB', minimum: '0' },
  }),
  check({
    id: 'migrations',
    name: 'migrations',
    command: null,
    line: 'pnpm --filter api db:check',
    where: 'repository',
    repository: 'api',
    when: 'requirement',
  }),
  check({ id: 'web-test', name: 'web-test', when: 'requirement' }),
]

/** A check as its dialog writes it. */
export function draftOf({ id: _id, command: chosen, ...rest }: SettingsCheck): CheckDraft {
  return { ...rest, command: chosen?.id ?? null }
}

/** What a line asks for that is a pattern of files: a `*` outside `{files}`. */
function globIn(line: string): string | undefined {
  return line.split(/\s+/).find((word) => word.includes('*'))
}

/** Whether the braces of a pattern close. */
function bracesClose(pattern: string): boolean {
  let depth = 0
  for (const character of pattern) {
    if (character === '{') depth += 1
    if (character === '}') depth -= 1
    if (depth < 0) return false
  }
  return depth === 0
}

/** Whether a pattern is a regular expression with exactly one capture group. */
function groupsOf(pattern: string): number | null {
  try {
    // Alone beside an empty alternative, the pattern always matches: its groups are all there.
    return (new RegExp(`${pattern}|`).exec('')?.length ?? 1) - 1
  } catch {
    return null
  }
}

/** What the engine refuses of a check's draft, in its words, at the field each concerns. */
export function checkRefusals(draft: CheckDraft, taken: readonly string[] = []): CheckRefusals {
  const line = draft.command === null ? (draft.line ?? '') : ''
  const glob = globIn(line.replaceAll('{files}', ''))
  const groups = draft.expect === null ? null : groupsOf(draft.expect.pattern)
  return {
    name: taken.includes(draft.name.trim())
      ? `A check named ${draft.name.trim()} already exists.`
      : undefined,
    line:
      shellRefusal(line) ??
      (glob === undefined
        ? undefined
        : `“${glob}” is a pattern of files: write it in Only files matching, and {files} in the line.`),
    pattern:
      draft.expect === null || draft.expect.pattern === ''
        ? undefined
        : groups === null
          ? 'This is not a pattern Hemera can read: a parenthesis or a bracket is left open.'
          : groups !== 1
            ? 'This pattern captures no number: put the number in parentheses, as in Coverage: ([0-9.]+)%.'
            : undefined,
    minimum:
      draft.expect === null ||
      draft.expect.minimum === '' ||
      !Number.isNaN(Number(draft.expect.minimum))
        ? undefined
        : `“${draft.expect.minimum}” is not a number.`,
    files:
      draft.files !== null && !bracesClose(draft.files)
        ? `“${draft.files}” opens a brace it does not close.`
        : line.includes('{files}') && (draft.files ?? '') === ''
          ? 'The line uses {files}: say which files here.'
          : undefined,
  }
}

function recipe(
  part: Partial<SettingsDocRecipe> & Pick<SettingsDocRecipe, 'id' | 'path' | 'purpose'>,
): SettingsDocRecipe {
  return { place: '.', words: null, ...part }
}

/** Acme's documentation: a readme per repository, the usage docs, the API contract. */
export const DOC_RECIPES: readonly SettingsDocRecipe[] = [
  recipe({ id: 'readme', path: 'README.md', purpose: 'How to install, run and test Acme' }),
  recipe({
    id: 'api-readme',
    place: 'api',
    path: 'README.md',
    purpose: 'How to run the API locally',
  }),
  recipe({ id: 'docs', path: 'docs/**/*.md', purpose: 'How each feature is used' }),
  recipe({
    id: 'openapi',
    place: 'api',
    path: 'openapi.yaml',
    purpose: 'The HTTP API contract',
    words: ['API', 'interface', 'contract'],
  }),
  recipe({
    id: 'schema',
    place: 'shared',
    path: 'schema/*.json',
    purpose: 'The JSON Schemas the web and the API share',
    words: ['schema', 'contract'],
  }),
]

/** What Hemera found in the main checkout of a Project that has no recipe yet. */
export const PROPOSED_RECIPES: readonly SettingsDocRecipe[] = [
  recipe({ id: 'proposed-readme', path: 'README.md', purpose: 'The readme of Acme' }),
  recipe({ id: 'proposed-api', place: 'api', path: 'README.md', purpose: 'The readme of api' }),
  recipe({ id: 'proposed-web', place: 'web', path: 'README.md', purpose: 'The readme of web' }),
  recipe({ id: 'proposed-docs', path: 'docs/**/*.md', purpose: 'The documentation folder' }),
  recipe({
    id: 'proposed-openapi',
    place: 'api',
    path: 'openapi.yaml',
    purpose: 'An OpenAPI contract',
    words: ['API', 'interface', 'contract', 'schema'],
  }),
]

/** A long path, a long purpose and many words. */
export const LONG_RECIPE: SettingsDocRecipe = recipe({
  id: 'long',
  place: 'shared',
  path: 'docs/architecture/decisions/payments-and-invoicing/**/*.md',
  purpose:
    'The architecture decisions of payments and invoicing: why each one was taken, what it replaced, and what a change to the billing flow must keep true for the web and the API alike',
  words: ['payment', 'invoice', 'refund', 'billing', 'currency', 'tax', 'ledger'],
})

/** A recipe as its dialog writes it. */
export function recipeDraftOf({ id: _id, ...draft }: SettingsDocRecipe): DocRecipeDraft {
  return draft
}

/** What the engine refuses of a recipe's draft, in its words, at the field each concerns. */
export function recipeRefusals(draft: DocRecipeDraft): DocRecipeRefusals {
  const inside = draft.place === '.' ? 'the main checkout' : draft.place
  const leaves = draft.path.startsWith('/') || draft.path.split('/').some((part) => part === '..')
  return {
    path: leaves ? `${draft.path} leaves ${inside}: name files inside it.` : undefined,
    purpose:
      draft.path.trim() !== '' && draft.purpose.trim() === ''
        ? 'Say in one sentence what the files are for.'
        : undefined,
    words:
      draft.words !== null && draft.words.every((word) => word.trim() === '')
        ? 'Name at least one word the Impact may hold.'
        : undefined,
  }
}
