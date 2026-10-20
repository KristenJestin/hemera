/**
 * What every variant of the test runner draws: a repository's guess and the rule that made it, the
 * value written by hand that replaces it, and the check of that value on save. The runners and the
 * formats are a short copy of `TEST_RUNNERS` and `REPORT_FORMATS` in `@hemera/core`, which the
 * design system does not import.
 */

export const RUNNERS = [
  'vitest',
  'jest',
  'node',
  'mocha',
  'pytest',
  'unittest',
  'go',
  'cargo',
  'nextest',
] as const
export type Runner = (typeof RUNNERS)[number]

export const RUNNER_WORDS: Readonly<Record<Runner, string>> = {
  vitest: 'vitest',
  jest: 'jest',
  node: 'node --test',
  mocha: 'mocha',
  pytest: 'pytest',
  unittest: 'unittest',
  go: 'go test',
  cargo: 'cargo test',
  nextest: 'cargo nextest',
}

/** The runners Hemera asks for a report itself, at each run (`withReporting` in the core). */
const ASKED = new Set<Runner>(['vitest', 'pytest', 'node'])

/** The runners whose JSON report the reader reads: jest's shape, which vitest writes too. */
const JSON_READ = new Set<Runner>(['vitest', 'jest'])

export type ReportFormat = 'junit' | 'json'

export const FORMAT_WORDS: Readonly<Record<ReportFormat, string>> = {
  junit: 'JUnit XML',
  json: 'JSON',
}

/** What a guess found: the runner, and the file that named it. Its report is Hemera's own. */
export interface Guess {
  runner: Runner
  /** The file of the repository the rule read: `vite.config.ts`, `go.mod`. */
  from: string
}

/** A value written by hand: the runner, and the report it writes, at a path of the repository. */
export interface Custom {
  runner: Runner
  report: { format: ReportFormat; path: string } | null
}

/** One repository's tests: its guess (null when no rule found one) and its own value, if any. */
export interface RepositoryTests {
  repository: string
  guess: Guess | null
  custom: Custom | null
}

/** The report a draft names: Hemera's own (asked at each run, or none), or one at a path. */
export type ReportChoice = 'hemera' | ReportFormat

/** What the fields hold while a value is written. */
export interface TestsDraft {
  runner: Runner | null
  report: ReportChoice
  path: string
}

/** A draft, opened on a repository. */
export interface Opened {
  repository: string
  draft?: TestsDraft | undefined
}

/** What a save refused, and the field it belongs under. */
export interface Refusal {
  field: 'runner' | 'report' | 'path'
  words: string
}

/** What the report of a runner Hemera reports for itself is, in words. */
export function hemeraReportWords(runner: Runner): string {
  if (!ASKED.has(runner)) return 'no report'
  return `${runner === 'vitest' ? 'JSON' : 'JUnit XML'} report asked by Hemera`
}

/** What the value in use says of the report, in words. */
export function reportWords(tests: RepositoryTests): string {
  const { custom, guess } = tests
  if (custom !== null) {
    return custom.report === null
      ? hemeraReportWords(custom.runner)
      : `${FORMAT_WORDS[custom.report.format]} report at ${custom.report.path}`
  }
  return guess === null ? '' : hemeraReportWords(guess.runner)
}

/** The runner in use: the value written by hand, else the guess, else none. */
export function runnerOf(tests: RepositoryTests): Runner | null {
  return tests.custom?.runner ?? tests.guess?.runner ?? null
}

/** The whole line, as a reader hears it: `web, vitest, guessed from vite.config.ts, …`. */
export function testsWords(tests: RepositoryTests): string {
  const runner = runnerOf(tests)
  if (runner === null) return `${tests.repository}, no runner found`
  const where = tests.custom === null ? `guessed from ${tests.guess?.from ?? ''}` : 'your own value'
  return `${tests.repository}, ${RUNNER_WORDS[runner]}, ${where}, ${reportWords(tests)}`
}

/** The fields filled from what is in use: the value written by hand, or the guess. */
export function draftOf(tests: RepositoryTests): TestsDraft {
  const { custom } = tests
  if (custom === null) return { runner: tests.guess?.runner ?? null, report: 'hemera', path: '' }
  return {
    runner: custom.runner,
    report: custom.report?.format ?? 'hemera',
    path: custom.report?.path ?? '',
  }
}

/** Whether a path, from the root of the repository, stays inside it. */
function inside(path: string): boolean {
  if (/^(?:[/\\~]|[A-Za-z]:)/.test(path)) return false
  let depth = 0
  for (const part of path.split(/[/\\]/)) {
    if (part === '..') depth -= 1
    else if (part !== '' && part !== '.') depth += 1
    if (depth < 0) return false
  }
  return true
}

/** Why a draft is refused on save, under the field it belongs to; undefined when it is kept. */
export function refusalOf(repository: string, draft: TestsDraft): Refusal | undefined {
  const { runner, report, path } = draft
  if (runner === null) return { field: 'runner', words: `Choose the runner of ${repository}.` }
  if (report === 'hemera') return undefined
  if (report === 'json' && !JSON_READ.has(runner)) {
    return {
      field: 'report',
      words: `Hemera reads no JSON report from ${RUNNER_WORDS[runner]}: choose JUnit XML.`,
    }
  }
  const written = path.trim()
  if (written === '') {
    return { field: 'path', words: `Where the runner writes it, from the root of ${repository}.` }
  }
  if (!inside(written)) {
    return {
      field: 'path',
      words: `${written} is outside ${repository}: the report must be written inside it.`,
    }
  }
  return undefined
}

/**
 * What a kept draft becomes: no value of its own when it says what the guess says, the value
 * written by hand otherwise.
 */
export function savedOf(tests: RepositoryTests, draft: TestsDraft): RepositoryTests {
  const { runner } = draft
  if (runner === null) return tests
  const report =
    draft.report === 'hemera' ? null : { format: draft.report, path: draft.path.trim() }
  const guessed = tests.guess !== null && tests.guess.runner === runner && report === null
  return { ...tests, custom: guessed ? null : { runner, report } }
}

/** The report choices offered for a runner: Hemera's own first, then a file at a path. */
export function reportChoices(runner: Runner | null): { value: ReportChoice; label: string }[] {
  return [
    {
      value: 'hemera',
      label:
        runner !== null && ASKED.has(runner)
          ? 'Asked by Hemera at each run'
          : 'None: read from the console',
    },
    { value: 'junit', label: 'JUnit XML, at a path' },
    { value: 'json', label: 'JSON, at a path' },
  ]
}
