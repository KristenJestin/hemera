import {
  FORMAT_WORDS,
  RUNNER_WORDS,
  type ReportFormat,
  type RepositoryTests,
  type Runner,
  type TestsDraft,
  type TestsRefusal,
} from './tests-model.ts'

/** Acme's repositories, each guessed by its own rule: pytest, vitest, go test. */
const API: RepositoryTests = {
  repository: 'api',
  icon: 'server',
  guess: { runner: 'pytest', from: 'pyproject.toml' },
  custom: null,
}

const WEB: RepositoryTests = {
  repository: 'web',
  icon: 'world',
  guess: { runner: 'vitest', from: 'vite.config.ts' },
  custom: null,
}

const SHARED: RepositoryTests = {
  repository: 'shared',
  icon: 'package',
  guess: { runner: 'go', from: 'go.mod' },
  custom: null,
}

export const GUESSED: readonly RepositoryTests[] = [API, WEB, SHARED]

/** web's own value: its configuration already writes vitest's JSON into the repository. */
export const CUSTOM: readonly RepositoryTests[] = [
  API,
  { ...WEB, custom: { runner: 'vitest', report: { format: 'json', path: 'reports/vitest.json' } } },
  SHARED,
]

/** shared holds tests no rule recognises: a Makefile runs them. */
export const NO_RUNNER: readonly RepositoryTests[] = [API, WEB, { ...SHARED, guess: null }]

/** A long repository path, and a long report path of its own. */
export const LONG: readonly RepositoryTests[] = [
  API,
  {
    repository: 'services/billing-invoices-and-payment-reconciliation',
    guess: { runner: 'pytest', from: 'pyproject.toml' },
    custom: {
      runner: 'pytest',
      report: {
        format: 'junit',
        path: 'build/test-results/integration/billing-invoices-and-payment-reconciliation.xml',
      },
    },
  },
]

/** A dialog opened when the story opens, and what is already written in its fields. */
export interface Opened {
  repository: string
  draft?: TestsDraft | undefined
}

/** web, its report written one folder above the repository. */
export const PATH_OUTSIDE: Opened = {
  repository: 'web',
  draft: { runner: 'vitest', report: 'json', path: '../reports/vitest.json' },
}

/** api, a JSON report asked of pytest, which writes none the reader reads. */
export const UNKNOWN_FORMAT: Opened = {
  repository: 'api',
  draft: { runner: 'pytest', report: 'json', path: 'reports/pytest.json' },
}

/** The format the reader reads from a runner, as the engine checks it; null for none. */
function readFrom(runner: Runner): ReportFormat | null {
  if (runner === 'vitest') return 'json'
  return runner === 'pytest' || runner === 'node' ? 'junit' : null
}

/** What the engine refuses on save, in its words, as a story stands in for it. */
export function refusedOnSave(tests: RepositoryTests, draft: TestsDraft): TestsRefusal | undefined {
  const { runner, report, path } = draft
  if (runner === null || report === 'hemera') return undefined
  const read = readFrom(runner)
  if (read !== report) {
    const instead =
      read !== null ? `choose ${FORMAT_WORDS[read]}` : 'its red is read from the console'
    return {
      field: 'report',
      words: `Hemera reads no ${FORMAT_WORDS[report]} report from ${RUNNER_WORDS[runner]}: ${instead}.`,
    }
  }
  const written = path.trim()
  if (written === '') {
    return {
      field: 'path',
      words: `Where the runner writes it, from the root of ${tests.repository}.`,
    }
  }
  if (written.startsWith('/') || written.split('/').includes('..')) {
    return {
      field: 'path',
      words: `${written} is outside ${tests.repository}: the report must be written inside it.`,
    }
  }
  return undefined
}

/** What a kept draft becomes: no value of its own when it says what the guess says. */
export function savedOf(tests: RepositoryTests, draft: TestsDraft): RepositoryTests {
  const { runner } = draft
  if (runner === null) return tests
  const report =
    draft.report === 'hemera' ? null : { format: draft.report, path: draft.path.trim() }
  const guessed = tests.guess?.runner === runner && report === null
  return { ...tests, custom: guessed ? null : { runner, report } }
}
