import type { Opened, RepositoryTests } from './test-runner-model.ts'

const API: RepositoryTests = {
  repository: 'api',
  guess: { runner: 'pytest', from: 'pyproject.toml' },
  custom: null,
}

const WEB: RepositoryTests = {
  repository: 'web',
  guess: { runner: 'vitest', from: 'vite.config.ts' },
  custom: null,
}

const SHARED: RepositoryTests = {
  repository: 'shared',
  guess: { runner: 'go', from: 'go.mod' },
  custom: null,
}

/** Acme's three repositories, each guessed by its own rule: pytest, vitest, go test. */
export const GUESSED: readonly RepositoryTests[] = [API, WEB, SHARED]

/** web's own value: its configuration already writes JUnit XML into the repository. */
export const CUSTOM: readonly RepositoryTests[] = [
  API,
  {
    ...WEB,
    custom: { runner: 'vitest', report: { format: 'junit', path: 'reports/junit.xml' } },
  },
  SHARED,
]

/** shared holds tests no rule recognises: a Makefile runs them. */
export const NO_RUNNER: readonly RepositoryTests[] = [API, WEB, { ...SHARED, guess: null }]

/** web, its report written one folder above the repository. */
export const PATH_OUTSIDE: Opened = {
  repository: 'web',
  draft: { runner: 'vitest', report: 'junit', path: '../reports/junit.xml' },
}

/** api, a JSON report asked of pytest, which writes none the reader reads. */
export const UNKNOWN_FORMAT: Opened = {
  repository: 'api',
  draft: { runner: 'pytest', report: 'json', path: 'reports/pytest.json' },
}
