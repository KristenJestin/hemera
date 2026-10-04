import type { SettingsCommand } from './commands.tsx'
import type { SettingsStep } from './recipe.tsx'
import type { RemoteChoice, SettingsRepository } from './repositories.tsx'
import type { RunnableCommand, SettingsRun } from './services.tsx'
import type { SettingsVariable } from './variables.tsx'

/**
 * The neutral case the stories of a Project's settings are drawn on: Acme, its repositories `api`,
 * `web` and `shared` (and `ui-kit` and `billing` when dense), its catalogue, its recipe, its
 * variables and what runs in its main checkout. Nothing here is a real Project; the addresses are
 * on `localhost` and the forge on `acme.test`, a name no one can own.
 */
export const MAIN_CHECKOUT = '~/work/acme'

export const DEFAULT_FOLDER = '~/.local/share/hemera/workspaces/acme'

export const DEFAULT_PREFIX = 'acme'

/** A long path in every field: what a real disk can hold. */
export const LONG_PATH =
  '~/work/clients/acme-platform-services-and-internal-tooling/checkouts/2026/main-checkout'

/** A long command line: what a real catalogue holds. */
export const LONG_LINE =
  'pnpm --filter @acme/platform-api-and-background-workers exec vitest run --coverage --reporter=verbose --project integration'

export const REPOSITORIES: readonly SettingsRepository[] = [
  {
    id: 'api',
    path: 'api',
    includedByDefault: true,
    remote: 'origin',
    baseBranch: 'main',
    freshness: { kind: 'fetched', when: '09:02' },
  },
  {
    id: 'web',
    path: 'web',
    includedByDefault: true,
    remote: 'origin',
    baseBranch: 'main',
    freshness: { kind: 'fetched', when: '09:02' },
  },
  {
    id: 'shared',
    path: 'shared',
    includedByDefault: true,
    remote: 'origin',
    baseBranch: 'main',
    freshness: {
      kind: 'old',
      since: 'Monday',
      reason: 'Could not resolve host: forge.acme.test',
    },
  },
]

/** The repository Git cannot read, in its own words. */
export const UNREADABLE: SettingsRepository = {
  id: 'billing',
  path: 'billing',
  includedByDefault: false,
  remote: 'origin',
  baseBranch: 'main',
  freshness: { kind: 'never' },
  unreadable: 'fatal: not a git repository (or any of the parent directories): .git',
}

/** Five repositories, one of them unreadable, one with no remote, one left out of Workspaces. */
export const DENSE_REPOSITORIES: readonly SettingsRepository[] = [
  ...REPOSITORIES,
  {
    id: 'ui-kit',
    path: 'packages/ui-kit',
    includedByDefault: false,
    remote: null,
    baseBranch: 'develop',
    freshness: { kind: 'local' },
  },
  UNREADABLE,
]

/** Hemera itself, whose base branch is `dev`. */
export const HEMERA_REPOSITORIES: readonly SettingsRepository[] = [
  {
    id: 'hemera',
    path: '.',
    includedByDefault: true,
    remote: 'origin',
    baseBranch: 'dev',
    freshness: { kind: 'fetched', when: '08:47' },
  },
]

/** The remotes each repository has, by id. */
export const REMOTES = new Map<string, readonly RemoteChoice[]>(
  Object.entries({
    api: [
      { name: 'origin', url: 'git@forge.acme.test:acme/api.git' },
      { name: 'upstream', url: 'git@forge.acme.test:platform/api.git' },
    ],
    web: [{ name: 'origin', url: 'git@forge.acme.test:acme/web.git' }],
    shared: [{ name: 'origin', url: 'git@forge.acme.test:acme/shared.git' }],
    'ui-kit': [],
    billing: [{ name: 'origin', url: 'git@forge.acme.test:acme/billing.git' }],
    hemera: [{ name: 'origin', url: 'https://forge.acme.test/hemera/hemera.git' }],
  }),
)

/** A command with every role off, for building the catalogue below. */
function command(
  part: Partial<SettingsCommand> & Pick<SettingsCommand, 'id' | 'name' | 'type' | 'line' | 'place'>,
): SettingsCommand {
  return {
    lineWindows: null,
    lineLinux: null,
    folder: null,
    scope: 'workspace',
    check: false,
    atOpen: false,
    askBeforeRunning: false,
    readOnly: false,
    writeGlobs: [],
    ...part,
  }
}

export const COMMANDS: readonly SettingsCommand[] = [
  command({
    id: 'api-dev',
    name: 'api-dev',
    type: 'serve',
    line: 'pnpm --filter api dev',
    place: 'api',
    writeGlobs: ['.cache/**'],
  }),
  command({
    id: 'web-dev',
    name: 'web-dev',
    type: 'serve',
    line: 'pnpm --filter web dev',
    place: 'web',
  }),
  command({
    id: 'db',
    name: 'db',
    type: 'serve',
    line: 'docker compose up db',
    place: '.',
    scope: 'project',
    atOpen: true,
    askBeforeRunning: true,
  }),
  command({
    id: 'test',
    name: 'test',
    type: 'test',
    line: 'pnpm --filter api test',
    place: 'api',
    check: true,
    writeGlobs: ['coverage/**'],
  }),
  command({
    id: 'typecheck',
    name: 'typecheck',
    type: 'typecheck',
    line: 'pnpm -r typecheck',
    place: '.',
    check: true,
    readOnly: true,
  }),
  command({
    id: 'lint',
    name: 'lint',
    type: 'lint',
    line: 'pnpm lint',
    place: '.',
    check: true,
    readOnly: true,
  }),
  command({
    id: 'build',
    name: 'build',
    type: 'build',
    line: 'pnpm build',
    lineWindows: 'pnpm build:windows',
    place: '.',
    writeGlobs: ['dist/**', '*/dist/**'],
  }),
  command({
    id: 'e2e',
    name: 'e2e',
    type: 'e2e',
    line: 'pnpm exec playwright test',
    place: 'web',
    folder: 'e2e',
    check: true,
    writeGlobs: ['test-results/**'],
  }),
  command({
    id: 'install',
    name: 'install',
    type: 'configure',
    line: 'pnpm install',
    place: '.',
    writeGlobs: ['node_modules/**'],
  }),
]

/** Twenty commands: the catalogue at its densest. */
export const DENSE_COMMANDS: readonly SettingsCommand[] = [
  ...COMMANDS,
  command({
    id: 'docs',
    name: 'docs',
    type: 'serve',
    line: 'pnpm --filter web docs',
    place: 'web',
    scope: 'project',
  }),
  command({
    id: 'mock-api',
    name: 'mock-api',
    type: 'serve',
    line: 'pnpm --filter shared mock',
    place: 'shared',
    scope: 'project',
  }),
  command({
    id: 'storybook',
    name: 'storybook',
    type: 'serve',
    line: 'pnpm --filter ui-kit storybook',
    place: 'packages/ui-kit',
  }),
  command({
    id: 'test-web',
    name: 'test-web',
    type: 'test',
    line: 'pnpm --filter web test',
    place: 'web',
    check: true,
  }),
  command({
    id: 'test-shared',
    name: 'test-shared',
    type: 'test',
    line: 'pnpm --filter shared test',
    place: 'shared',
    check: true,
  }),
  command({
    id: 'format',
    name: 'format',
    type: 'lint',
    line: 'pnpm fmt',
    place: '.',
    writeGlobs: ['**/*.ts', '**/*.tsx'],
  }),
  command({
    id: 'migrate',
    name: 'migrate',
    type: 'script',
    line: 'pnpm --filter api db:migrate',
    place: 'api',
    askBeforeRunning: true,
  }),
  command({
    id: 'seed',
    name: 'seed',
    type: 'script',
    line: 'pnpm --filter api db:seed',
    place: 'api',
    askBeforeRunning: true,
  }),
  command({
    id: 'codegen',
    name: 'codegen',
    type: 'configure',
    line: 'pnpm --filter shared codegen',
    place: 'shared',
    writeGlobs: ['src/generated/**'],
  }),
  command({
    id: 'inspect',
    name: 'inspect',
    type: 'debug',
    line: 'node --inspect api/dist/server.js',
    lineLinux: 'node --inspect=0.0.0.0 api/dist/server.js',
    place: '.',
  }),
  command({
    id: 'billing-test',
    name: 'billing-test',
    type: 'test',
    line: LONG_LINE,
    place: 'billing',
    check: true,
    readOnly: true,
  }),
]

export const STEPS: readonly SettingsStep[] = [
  { id: 's1', kind: 'copy', place: 'api', path: '.env.local', command: null, line: null },
  {
    id: 's2',
    kind: 'copy',
    place: 'web',
    path: '.env.local',
    command: null,
    line: null,
    problem: 'not in the main checkout',
  },
  { id: 's3', kind: 'link', place: 'shared', path: 'fixtures', command: null, line: null },
  { id: 's4', kind: 'run', place: '.', path: null, command: 'install', line: null },
  {
    id: 's5',
    kind: 'run',
    place: 'api',
    path: null,
    command: null,
    line: 'pnpm db:migrate --database acme_{workspace}',
  },
]

export const VARIABLES: readonly SettingsVariable[] = [
  { key: 'DATABASE_URL' },
  { key: 'API_TOKEN' },
  { key: 'PAYMENTS_KEY' },
  { key: 'PORT_OFFSET', value: '12' },
]

/** What each variable holds, read when it is shown. */
export const VALUES = new Map<string, string>(
  Object.entries({
    DATABASE_URL: 'postgres://acme@localhost:5432/acme_{workspace}',
    API_TOKEN: 'acme-local-6f1c2a',
    PAYMENTS_KEY: 'test_key_0000000000000000',
    PORT_OFFSET: '12',
  }),
)

/** A minute and a half ago, and a few seconds ago. */
const AGO = Date.now() - 84_000
const JUST = Date.now() - 4_000

export const RUNS: readonly SettingsRun[] = [
  {
    kind: 'live',
    id: 'docs',
    name: 'docs',
    type: 'serve',
    line: 'pnpm --filter web docs',
    place: 'web',
    state: 'running',
    startedAt: AGO,
    endedAt: null,
    url: 'http://localhost:6100',
    output: ['  VITE v7.1.2  ready in 412 ms', '  ➜  Local:   http://localhost:6100/'],
  },
  {
    kind: 'live',
    id: 'mock-api',
    name: 'mock-api',
    type: 'serve',
    line: 'pnpm --filter shared mock',
    place: 'shared',
    state: 'running',
    startedAt: JUST,
    endedAt: null,
    output: ['> shared@0.0.0 mock', '> node mock/server.js', 'loading 214 fixtures…'],
  },
  {
    kind: 'waiting',
    id: 'db',
    name: 'db',
    type: 'serve',
    line: 'docker compose up db',
    place: '.',
  },
  {
    kind: 'idle',
    id: 'admin',
    name: 'admin',
    type: 'serve',
    line: 'pnpm --filter web admin',
    place: 'web',
  },
  {
    kind: 'live',
    id: 'typecheck',
    name: 'typecheck',
    type: 'typecheck',
    line: 'pnpm -r typecheck',
    place: '.',
    state: 'finished',
    startedAt: AGO - 30_000,
    endedAt: AGO - 18_000,
    output: ['api typecheck: Done', 'web typecheck: Done', 'shared typecheck: Done'],
  },
]

/** A service that stopped by itself: what it printed last, and Restart. */
export const FAILED_RUN: SettingsRun = {
  kind: 'live',
  id: 'search',
  name: 'search',
  type: 'serve',
  line: 'pnpm --filter api search',
  place: 'api',
  state: 'failed',
  startedAt: AGO,
  endedAt: AGO + 12_000,
  output: [
    '> api@0.0.0 search',
    '> node dist/search.js',
    'Error: listen EADDRINUSE: address already in use :::7700',
    '    at Server.setupListenHandle (node:net:1908:16)',
  ],
}

/** What the head of the running section offers to start. */
export const RUNNABLE: readonly RunnableCommand[] = COMMANDS.map((one) => ({
  id: one.id,
  name: one.name,
  type: one.type,
}))

/**
 * The first shell syntax in a line, as the engine names it, or null: a pipe, a list, a background
 * `&`, a redirection, a substitution or a variable, outside single quotes. The engine's own rule is
 * `shellSyntaxIn` in `@hemera/core`; the catalogue draws with this short copy of it.
 */
export function shellSyntaxOf(line: string): string | null {
  let quote: string | null = null
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at] ?? ''
    const rest = line.slice(at)
    if (quote === "'") {
      if (character === "'") quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : character
      continue
    }
    for (const token of ['&&', '||', '$(', '|', '&', ';', '>', '<', '`']) {
      if (rest.startsWith(token)) return token
    }
    const variable = /^\$[A-Za-z_]\w*/.exec(rest)
    if (variable !== null) return variable[0]
  }
  return null
}

/** What the engine says of a line holding shell syntax. */
export function shellRefusal(line: string): string | undefined {
  const token = shellSyntaxOf(line)
  return token === null
    ? undefined
    : `Hemera runs a command without a shell, and “${token}” is shell syntax: put it in a script of the repository and run the script.`
}

/** What Git says of a branch name it would refuse, in the engine's words, or undefined. */
export function branchRefusal(name: string): string | undefined {
  const reason = /\s/.test(name)
    ? 'it holds a space or a control character'
    : name.includes('..')
      ? 'it holds “..”'
      : /[~^:?*[\\]/.test(name)
        ? 'it holds one of ~ ^ : ? * [ \\'
        : name.endsWith('/') || name.startsWith('/')
          ? 'it starts or ends with “/”'
          : name.endsWith('.lock')
            ? 'a part of it ends with “.lock”'
            : null
  return reason === null ? undefined : `“${name}” is not a branch name Git accepts: ${reason}.`
}

/** What the engine says when a save meets a newer version of the Project. */
export const STALE = 'This Project changed elsewhere; reopen it and try again.'
