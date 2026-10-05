import type { Proposal, SetupKind } from './proposal.tsx'

/**
 * What the setup agent proposes for Acme, read from `~/work/acme`: its three repositories, its
 * catalogue, its recipe, its variables and what it should never run. Nothing here is a real
 * Project.
 */
export const ACME_FOLDER = '~/work/acme'

export const PROPOSALS: Record<SetupKind, Proposal> = {
  repositories: {
    kind: 'repositories',
    items: [
      { id: 'api', path: 'api', base: 'origin/main' },
      { id: 'web', path: 'web', base: 'origin/main' },
      { id: 'shared', path: 'shared', base: 'origin/main' },
    ],
  },
  commands: {
    kind: 'commands',
    items: [
      {
        id: 'dev',
        name: 'dev',
        type: 'serve',
        line: 'pnpm --filter web dev',
        check: false,
        service: true,
        atOpen: false,
        ask: false,
      },
      {
        id: 'test',
        name: 'test',
        type: 'test',
        line: 'pnpm test',
        check: true,
        service: false,
        atOpen: false,
        ask: false,
      },
      {
        id: 'lint',
        name: 'lint',
        type: 'lint',
        line: 'pnpm lint',
        check: true,
        service: false,
        atOpen: false,
        ask: false,
      },
      {
        id: 'db',
        name: 'db',
        type: 'configure',
        line: 'docker compose up db',
        check: false,
        service: true,
        atOpen: true,
        ask: true,
      },
    ],
  },
  preparation: {
    kind: 'preparation',
    items: [
      { id: 's1', kind: 'copy', place: 'api', what: '.env.local' },
      { id: 's2', kind: 'link', place: 'web', what: 'node_modules/.cache' },
      { id: 's3', kind: 'run', place: '.', what: 'pnpm install --frozen-lockfile' },
    ],
  },
  variables: {
    kind: 'variables',
    items: [
      { id: 'v1', key: 'DATABASE_URL', value: 'postgres://acme@localhost:5432/acme_{workspace}' },
      { id: 'v2', key: 'API_PORT', value: '4000' },
      { id: 'v3', key: 'SMTP_URL', value: 'smtp://localhost:1025' },
    ],
  },
  never: {
    kind: 'never',
    items: [
      { id: 'n1', line: 'git push --force' },
      { id: 'n2', line: 'pnpm publish' },
      { id: 'n3', line: 'docker system prune --all' },
    ],
  },
}

/**
 * The folder is not a repository and Hemera found none in it when it was chosen; the agent looked
 * deeper and found one.
 */
export const NESTED_REPOSITORY: Proposal = {
  kind: 'repositories',
  items: [{ id: 'billing', path: 'services/billing', base: 'origin/main', found: true }],
}

/** The proposal the agent writes once the user said what should change in the variables. */
export const REVISED_VARIABLES: Proposal = {
  kind: 'variables',
  items: [
    { id: 'v1', key: 'DATABASE_URL', value: 'postgres://acme@localhost:5432/acme_{workspace}' },
    { id: 'v2', key: 'API_PORT', value: '4{workspace.port}' },
  ],
}

/** What the engine says when it refuses to accept a proposal, by kind. */
export const REFUSALS: Partial<Record<SetupKind, string>> = {
  preparation: 'api/.env.local is not in the main checkout: the copy would stop the preparation.',
}

/** A long path, a long line and a long name in every field that holds one. */
export const LONG_PROPOSALS: Record<SetupKind, Proposal> = {
  ...PROPOSALS,
  repositories: {
    kind: 'repositories',
    items: [
      ...(PROPOSALS.repositories.kind === 'repositories' ? PROPOSALS.repositories.items : []),
      {
        id: 'long',
        path: 'services/platform-api-and-background-workers',
        base: 'upstream-platform-team/release/2026-10-platform-consolidation',
      },
    ],
  },
  commands: {
    kind: 'commands',
    items: [
      {
        id: 'long',
        name: 'integration-tests-with-coverage',
        type: 'test',
        line: 'pnpm --filter @acme/platform-api-and-background-workers exec vitest run --coverage --reporter=verbose',
        check: true,
        service: false,
        atOpen: false,
        ask: true,
      },
      ...(PROPOSALS.commands.kind === 'commands' ? PROPOSALS.commands.items : []),
    ],
  },
  variables: {
    kind: 'variables',
    items: [
      {
        id: 'long',
        key: 'ACME_PLATFORM_BACKGROUND_WORKERS_QUEUE_CONNECTION_STRING',
        value: 'redis://localhost:6379/0',
      },
    ],
  },
  never: {
    kind: 'never',
    items: [
      {
        id: 'long',
        line: 'pnpm --filter @acme/platform-api-and-background-workers exec prisma migrate reset --force --skip-seed',
      },
    ],
  },
}
