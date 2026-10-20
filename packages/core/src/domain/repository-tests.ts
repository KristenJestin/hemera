/**
 * A repository's test runner and report, as its Project's settings show and set them (#421). The
 * runner is guessed from the files at the repository's root, each rule naming the file it read; a
 * value written by hand replaces the guess for that repository. That value is a `TestReporting`
 * (#342): a runner, and a report the run writes at a path of the repository, in a format the
 * reader reads from that runner. Without a report, Hemera asks the runner for its own when the
 * proof's command runs it itself (`withReporting`), and reads the console otherwise.
 */

import { Schema } from 'effect'

import { repositoryFileRefusal } from './proofs.ts'
import {
  type ReportFormat,
  type TestReporting,
  type TestRunner,
  TestRunner as TestRunnerSchema,
} from './test-reports.ts'

/** A runner as the user knows it: the command that runs it. */
export const RUNNER_WORDS: Readonly<Record<TestRunner, string>> = {
  vitest: 'vitest',
  jest: 'jest',
  node: 'node --test',
  mocha: 'mocha',
  pytest: 'pytest',
  unittest: 'unittest',
  go: 'go test',
  cargo: 'cargo test',
  nextest: 'cargo nextest',
  unknown: 'unknown',
}

export const FORMAT_WORDS: Readonly<Record<ReportFormat, string>> = {
  junit: 'JUnit XML',
  json: 'JSON',
}

/** The formats the reader reads from each runner (`reportedTests`). */
export const READ_FORMATS: Readonly<Record<TestRunner, ReadonlyArray<ReportFormat>>> = {
  vitest: ['json'],
  jest: [],
  node: ['junit'],
  mocha: [],
  pytest: ['junit'],
  unittest: [],
  go: [],
  cargo: [],
  nextest: [],
  unknown: [],
}

/** The runners Hemera asks a report of itself, when the proof's command runs them. */
export const ASKED_RUNNERS: ReadonlySet<TestRunner> = new Set(['vitest', 'pytest', 'node'])

/** A runner guessed from a repository: the runner, and the file at its root whose rule named it. */
export const TestGuess = Schema.Struct({ runner: TestRunnerSchema, from: Schema.String })
export type TestGuess = typeof TestGuess.Type

const SCRIPT = String.raw`\.(?:ts|mts|cts|js|mjs|cjs)$`

/** The rules, the more precise first: the file each one looks for, and the runner it names. */
const RULES: ReadonlyArray<readonly [RegExp, TestRunner]> = [
  [new RegExp(String.raw`^vitest\.(?:config|workspace)${SCRIPT}`), 'vitest'],
  [new RegExp(String.raw`^jest\.config${SCRIPT}`), 'jest'],
  [/^\.mocharc\.(?:js|cjs|json|jsonc|yml|yaml)$/, 'mocha'],
  [new RegExp(String.raw`^vite\.config${SCRIPT}`), 'vitest'],
  [/^pytest\.ini$/, 'pytest'],
  [/^conftest\.py$/, 'pytest'],
  [/^pyproject\.toml$/, 'pytest'],
  [/^go\.mod$/, 'go'],
  [/^Cargo\.toml$/, 'cargo'],
]

/** The runner the names at a repository's root point to, with the file that named it; null when none does. */
export const guessedTests = (names: ReadonlyArray<string>): TestGuess | null => {
  const sorted = [...names].sort()
  for (const [rule, runner] of RULES) {
    const from = sorted.find((name) => rule.test(name))
    if (from !== undefined) return { runner, from }
  }
  return null
}

/** Why a value written by hand is refused, and the field it is said under. */
export interface TestReportingRefusal {
  readonly field: 'runner' | 'report' | 'path'
  readonly reason: string
}

/** A value refused on save: the field, and why. */
export class TestReportingRefused extends Schema.TaggedError<TestReportingRefused>()(
  'TestReportingRefused',
  { field: Schema.Literals(['runner', 'report', 'path']), reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

/**
 * Why a repository's value written by hand is refused, or null when it is kept: a runner the
 * reader does not know, a report format the reader does not read from that runner, or a path that
 * is not one of a file inside the repository. A report that does not exist yet is kept: the run
 * writes it. What the path leads to on disk (a link out) is the engine's to check.
 */
export const testReportingRefusal = (
  repository: string,
  reporting: TestReporting,
): TestReportingRefusal | null => {
  const { runner, report } = reporting
  if (runner === 'unknown')
    return { field: 'runner', reason: `Choose the runner of ${repository}.` }
  if (report === undefined) return null
  const read = READ_FORMATS[runner]
  if (!read.includes(report.format)) {
    const other = read[0]
    const instead =
      other === undefined ? 'its red is read from the console' : `choose ${FORMAT_WORDS[other]}`
    return {
      field: 'report',
      reason: `Hemera reads no ${FORMAT_WORDS[report.format]} report from ${RUNNER_WORDS[runner]}: ${instead}.`,
    }
  }
  const path = report.path.trim()
  if (path === '') {
    return { field: 'path', reason: `Where the runner writes it, from the root of ${repository}.` }
  }
  const refused = repositoryFileRefusal(path)
  if (refused === null) return null
  if (refused === 'it is absolute' || refused === 'it climbs out with ..' || path.startsWith('~')) {
    return {
      field: 'path',
      reason: `${path} is outside ${repository}: the report must be written inside it.`,
    }
  }
  return { field: 'path', reason: `${path} is not a file of ${repository}: ${refused}.` }
}
