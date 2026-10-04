/**
 * What the settings of a Project show of the engine's records, and what they write back: each
 * section's rows, read off the engine's values, and each form's draft, turned into the engine's.
 */

import {
  FetchedNow,
  LocalBranch,
  NotFetchedSince,
  Readable,
  Unreadable,
  type Command,
  type RecipeStep,
  type Repository,
  type Run,
} from '@hemera/ipc'
import { NEW_COMMAND } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import {
  commandDraftOf,
  commandRowOf,
  freshnessOf,
  recipeDraftOf,
  repositoryRowOf,
  runRowsOf,
  stepDraftOf,
  stepRowsOf,
  whenOf,
} from '../src/renderer/settings-model.ts'

const NOW = new Date('2026-10-04T10:30:00')

const repository = (id: string, path: string, more: Partial<Repository> = {}): Repository => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'main',
  lastFetchedAt: null,
  ...more,
})

const API = repository('r-api', 'api')
const WEB = repository('r-web', 'web', { lastFetchedAt: '2026-10-04T09:02:00' })
const REPOSITORIES = [API, WEB]

const command = (id: string, name: string, more: Partial<Command> = {}): Command => ({
  id,
  projectId: 'acme',
  name,
  type: 'script',
  line: `pnpm ${name}`,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...more,
})

const run = (id: string, commandId: string | null, more: Partial<Run> = {}): Run => ({
  id,
  projectId: 'acme',
  workspaceId: null,
  commandId,
  name: commandId ?? 'node',
  type: 'script',
  line: 'pnpm dev',
  folder: '/work/acme',
  startedBy: 'user',
  sessionId: null,
  state: 'running',
  exitCode: null,
  url: null,
  portConflict: null,
  startedAt: '2026-10-04T10:29:00.000Z',
  endedAt: null,
  ...more,
})

describe('When something happened, as a line of the settings says it', () => {
  test('today by its time, yesterday as such, and earlier by its day', () => {
    expect(whenOf('2026-10-04T09:02:00', NOW)).toBe('09:02')
    expect(whenOf('2026-10-03T22:15:00', NOW)).toBe('yesterday')
    expect(whenOf('2026-09-28T08:00:00', NOW)).toBe('28 Sept')
  })
})

describe('A repository’s line', () => {
  test('its path, its base, and when its base was last fetched', () => {
    expect(repositoryRowOf(WEB, {}, NOW)).toEqual({
      id: 'r-web',
      path: 'web',
      includedByDefault: true,
      remote: 'origin',
      baseBranch: 'main',
      freshness: { kind: 'fetched', when: '09:02' },
    })
    expect(repositoryRowOf(API, {}, NOW).freshness).toEqual({ kind: 'never' })
  })

  test('a repository Git cannot read says Git’s own reason', () => {
    const row = repositoryRowOf(
      API,
      { status: Unreadable.make({ reason: 'fatal: not a git repository' }) },
      NOW,
    )
    expect(row.unreadable).toBe('fatal: not a git repository')
    const readable = repositoryRowOf(
      API,
      { status: Readable.make({ branch: 'main', commit: 'abc', dirty: false }) },
      NOW,
    )
    expect(readable.unreadable).toBeUndefined()
  })

  test('a fetch that failed says since when, and why, in the engine’s words', () => {
    expect(
      freshnessOf(
        WEB,
        NotFetchedSince.make({ since: '2026-10-03T08:00:00', reason: 'Could not resolve host' }),
        NOW,
      ),
    ).toEqual({ kind: 'old', since: 'yesterday', reason: 'Could not resolve host' })
    expect(freshnessOf(API, NotFetchedSince.make({ since: null, reason: 'offline' }), NOW)).toEqual(
      { kind: 'old', since: 'it was added', reason: 'offline' },
    )
  })

  test('a fetch just made is the date shown, and a repository without a remote says so', () => {
    expect(freshnessOf(API, FetchedNow.make({ at: '2026-10-04T10:29:00' }), NOW)).toEqual({
      kind: 'fetched',
      when: '10:29',
    })
    expect(freshnessOf(repository('r', 'docs', { remote: null }), undefined, NOW)).toEqual({
      kind: 'local',
    })
    expect(freshnessOf(API, LocalBranch.make({}), NOW)).toEqual({ kind: 'local' })
  })
})

describe('A command of the catalogue', () => {
  test('its line says where it runs by its repository’s path, the root for none', () => {
    expect(commandRowOf(command('c1', 'lint', { repositoryId: 'r-api' }), REPOSITORIES)).toEqual(
      expect.objectContaining({ id: 'c1', name: 'lint', place: 'api', folder: null }),
    )
    expect(commandRowOf(command('c2', 'install'), REPOSITORIES).place).toBe('.')
  })

  test('its form writes the repository by its identifier, and keeps what the form does not show', () => {
    const saved = commandDraftOf(
      {
        ...NEW_COMMAND,
        name: 'web',
        type: 'serve',
        line: 'pnpm dev',
        place: 'web',
        writeGlobs: ['dist/**', '', ' '],
      },
      command('c3', 'web', { portless: true, portlessName: 'acme-web' }),
      REPOSITORIES,
    )
    expect(saved).toEqual(
      expect.objectContaining({
        name: 'web',
        repositoryId: 'r-web',
        portless: true,
        portlessName: 'acme-web',
        writeGlobs: ['dist/**'],
      }),
    )
    expect(commandDraftOf(NEW_COMMAND, null, REPOSITORIES)).toEqual(
      expect.objectContaining({ repositoryId: null, portless: false, portlessName: null }),
    )
  })
})

describe('The preparation recipe', () => {
  const STEPS: RecipeStep[] = [
    {
      id: 's1',
      position: 1,
      kind: 'copy',
      repositoryId: 'r-web',
      path: '.env.local',
      commandId: null,
      line: null,
    },
    {
      id: 's2',
      position: 2,
      kind: 'run',
      repositoryId: null,
      path: 'tools',
      commandId: 'c-install',
      line: null,
    },
    {
      id: 's3',
      position: 3,
      kind: 'run',
      repositoryId: 'r-api',
      path: null,
      commandId: null,
      line: 'pnpm db:migrate',
    },
  ]
  const CATALOGUE = [command('c-install', 'install')]

  test('each step on its line: where it applies, what it does, and what is wrong with it', () => {
    const rows = stepRowsOf(STEPS, REPOSITORIES, CATALOGUE, new Map([[1, 'it is missing']]))
    expect(rows).toEqual([
      {
        id: 's1',
        kind: 'copy',
        place: 'web',
        path: '.env.local',
        command: null,
        line: null,
        problem: 'it is missing',
      },
      { id: 's2', kind: 'run', place: '.', path: null, command: 'install', line: null },
      { id: 's3', kind: 'run', place: 'api', path: null, command: null, line: 'pnpm db:migrate' },
    ])
  })

  test('a step opened in its form, and written back as the engine takes it', () => {
    const second = STEPS[1]!
    const draft = stepDraftOf(second, REPOSITORIES)
    expect(draft).toEqual({ kind: 'run', place: '.', path: null, command: 'c-install', line: null })
    expect(recipeDraftOf(draft, REPOSITORIES, second)).toEqual({
      kind: 'run',
      repositoryId: null,
      path: 'tools',
      commandId: 'c-install',
      line: null,
    })
    expect(
      recipeDraftOf(
        { kind: 'copy', place: 'api', path: '.env', command: 'c-install', line: 'x' },
        REPOSITORIES,
        null,
      ),
    ).toEqual({ kind: 'copy', repositoryId: 'r-api', path: '.env', commandId: null, line: null })
    expect(
      recipeDraftOf(
        { kind: 'run', place: 'api', path: null, command: null, line: 'pnpm seed' },
        REPOSITORIES,
        null,
      ),
    ).toEqual({
      kind: 'run',
      repositoryId: 'r-api',
      path: null,
      commandId: null,
      line: 'pnpm seed',
    })
  })
})

describe('What runs in the main checkout', () => {
  const WEB_SERVICE = command('c-web', 'web', {
    type: 'serve',
    scope: 'project',
    repositoryId: 'r-web',
  })
  const DB = command('c-db', 'db', { atOpen: true, askBeforeRunning: true })
  const LINT = command('c-lint', 'lint')
  const CATALOGUE = [LINT, WEB_SERVICE, DB]

  test('a service of the main checkout never started stands with Start', () => {
    expect(runRowsOf([], CATALOGUE, REPOSITORIES, new Map())).toEqual([
      {
        kind: 'idle',
        id: 'command:c-web',
        name: 'web',
        type: 'serve',
        line: 'pnpm web',
        place: 'web',
      },
    ])
  })

  test('each command shows its last run, in the order of the catalogue, its address and its output', () => {
    const rows = runRowsOf(
      [
        run('run-3', 'c-web', {
          type: 'serve',
          state: 'ready',
          url: 'http://localhost:5173',
          line: 'pnpm dev',
        }),
        run('run-2', 'c-lint', { state: 'done', endedAt: '2026-10-04T10:29:30.000Z' }),
        run('run-1', 'c-web', { type: 'serve', state: 'stopped' }),
        run('run-0', 'c-db', { state: 'waiting_for_permission' }),
      ],
      CATALOGUE,
      REPOSITORIES,
      new Map([['run-3', ['ready in 300 ms', 'Local: http://localhost:5173']]]),
    )
    expect(rows.map((row) => [row.id, row.kind])).toEqual([
      ['command:c-lint', 'live'],
      ['command:c-web', 'live'],
      ['command:c-db', 'waiting'],
    ])
    expect(rows[0]).toEqual(
      expect.objectContaining({
        state: 'finished',
        startedAt: Date.parse('2026-10-04T10:29:00.000Z'),
        endedAt: Date.parse('2026-10-04T10:29:30.000Z'),
      }),
    )
    expect(rows[1]).toEqual(
      expect.objectContaining({
        state: 'running',
        url: 'http://localhost:5173',
        output: ['ready in 300 ms', 'Local: http://localhost:5173'],
        place: 'web',
      }),
    )
  })

  test('a run ended by a stop, or by Hemera closing, is stopped; a failed one failed', () => {
    const states = (['stopped', 'interrupted', 'failed', 'starting'] as const).map(
      (state) => runRowsOf([run('r', 'c-lint', { state })], [LINT], REPOSITORIES, new Map())[0],
    )
    expect(states.map((row) => (row?.kind === 'live' ? row.state : row?.kind))).toEqual([
      'stopped',
      'stopped',
      'failed',
      'running',
    ])
  })

  test('a line of its own run in the main checkout is shown while it runs', () => {
    const rows = runRowsOf(
      [run('free-1', null, { name: 'node' }), run('free-0', null, { state: 'done' })],
      [],
      REPOSITORIES,
      new Map(),
    )
    expect(rows.map((row) => row.id)).toEqual(['run:free-1'])
  })
})
