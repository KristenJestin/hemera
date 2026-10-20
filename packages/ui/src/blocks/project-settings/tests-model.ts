import type { MarkIcon } from '../../components/project-mark/mark-icons.tsx'

/**
 * What the Tests of a Project's settings draw (#421): a repository's guess and the rule that made
 * it, the value written by hand that replaces it, and the fields that value is written in. The
 * runners and the formats are a short copy of `TEST_RUNNERS` and `REPORT_FORMATS` in
 * `@hemera/core`, which the design system does not import.
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

export type ReportFormat = 'junit' | 'json'

export const FORMAT_WORDS: Readonly<Record<ReportFormat, string>> = {
  junit: 'JUnit XML',
  json: 'JSON',
}

/** What a guess found: the runner, and the file that named it. Its report is Hemera's own. */
export interface Guess {
  runner: Runner
  /** The file at the repository's root the rule read: `vite.config.ts`, `go.mod`. */
  from: string
}

/** A value written by hand: the runner, and the report it writes at a path of the repository. */
export interface Custom {
  runner: Runner
  report: { format: ReportFormat; path: string } | null
}

/** One repository's tests: its guess (null when no rule found one) and its own value, if any. */
export interface RepositoryTests {
  repository: string
  /** The icon it wears before its path; a folder until one is chosen. */
  icon?: MarkIcon | undefined
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

/** What a save refused, and the field it belongs under. */
export interface TestsRefusal {
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
export function runnerInUse(tests: RepositoryTests): Runner | null {
  return tests.custom?.runner ?? tests.guess?.runner ?? null
}

/** The whole line, as a reader hears it: `web, vitest, guessed from vite.config.ts, …`. */
export function testsWords(tests: RepositoryTests): string {
  const runner = runnerInUse(tests)
  if (runner === null) return `${tests.repository}, no runner found`
  const where = tests.custom === null ? `guessed from ${tests.guess?.from ?? ''}` : 'your own value'
  return `${tests.repository}, ${RUNNER_WORDS[runner]}, ${where}, ${reportWords(tests)}`
}

/** The fields filled from what is in use: the value written by hand, or the guess. */
export function draftOfTests(tests: RepositoryTests): TestsDraft {
  const { custom } = tests
  if (custom === null) return { runner: tests.guess?.runner ?? null, report: 'hemera', path: '' }
  return {
    runner: custom.runner,
    report: custom.report?.format ?? 'hemera',
    path: custom.report?.path ?? '',
  }
}

/** A draft saved with no runner chosen: the only refusal said before the engine is asked. */
export function unchosen(repository: string, draft: TestsDraft): TestsRefusal | undefined {
  return draft.runner === null
    ? { field: 'runner', words: `Choose the runner of ${repository}.` }
    : undefined
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

/** The repositories whose runner no rule found, as the section's problem in the list. */
export function testsProblem(rows: readonly RepositoryTests[] | null): string | undefined {
  const none = (rows ?? []).filter((one) => one.guess === null && one.custom === null)
  return none.length === 0
    ? undefined
    : `no runner found for ${none.map((one) => one.repository).join(', ')}`
}
