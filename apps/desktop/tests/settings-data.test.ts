/**
 * The settings of a Project as the page follows them: each section read once, kept up by the
 * engine's changes and by what each save answers; a save refused with the engine's own refusal;
 * a variable's value read only when the user asks.
 */

import {
  InvalidBranchName,
  NotFetchedSince,
  Readable,
  ShellSyntax,
  StaleVersion,
  Unreadable,
  type Command,
  type CommandDraft,
  type Project,
  type RepositoryStatusChange,
  type Run,
} from '@hemera/ipc'
import { describe, expect, test, vi } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import { followSettings, type SettingsData } from '../src/renderer/settings-data.ts'
import { SILENT_LINK } from './fake-link.ts'

const repository = (id: string, path: string) => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'main',
  lastFetchedAt: null,
})

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 3,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [repository('r-api', 'api'), repository('r-web', 'web')],
}

const DRAFT: CommandDraft = {
  name: 'web',
  type: 'serve',
  line: 'pnpm dev',
  lineWindows: null,
  lineLinux: null,
  repositoryId: 'r-web',
  folder: null,
  scope: 'project',
  portless: false,
  portlessName: null,
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
}

const WEB: Command = { ...DRAFT, id: 'c-web', projectId: 'acme' }

const run = (id: string, more: Partial<Run> = {}): Run => ({
  id,
  projectId: 'acme',
  workspaceId: null,
  commandId: 'c-web',
  name: 'web',
  type: 'serve',
  line: 'pnpm dev',
  folder: '/work/acme/web',
  startedBy: 'user',
  sessionId: null,
  missionId: null,
  state: 'starting',
  exitCode: null,
  url: null,
  portConflict: null,
  startedAt: '2026-10-04T08:00:00.000Z',
  endedAt: null,
  ...more,
})

/** An engine with Acme in it, which answers at once and lets a test play its changes. */
function engine(overrides: Partial<Link> = {}) {
  const runListeners = new Set<(run: Run) => void>()
  const repositoryListeners = new Set<(change: RepositoryStatusChange) => void>()
  const asked: string[] = []
  const link: Link = {
    ...SILENT_LINK,
    project: async () => ACME,
    repositoryStatus: async () => Readable.make({ branch: 'main', commit: 'abc', dirty: false }),
    catalogue: async () => [WEB],
    recipe: async () => [
      {
        id: 's1',
        position: 1,
        kind: 'copy',
        repositoryId: 'r-web',
        path: '.env.local',
        commandId: null,
        line: null,
      },
    ],
    checkRecipe: async () => [{ position: 1, problem: 'Step 1 is refused: it is missing.' }],
    variables: async () => [{ key: 'API_TOKEN', value: '••••' }],
    revealVariable: async ({ key }) => {
      asked.push(`reveal ${key}`)
      return 'acme-local-6f1c2a'
    },
    runs: async () => [],
    runOutput: async () => ({ output: 'ready\nLocal: http://localhost:5173\n', dropped: 0 }),
    onRunChanges: (listener) => {
      runListeners.add(listener)
      return () => runListeners.delete(listener)
    },
    onRepositoryChanges: (listener) => {
      repositoryListeners.add(listener)
      return () => repositoryListeners.delete(listener)
    },
    ...overrides,
  }
  const states: SettingsData[] = []
  const settings = followSettings(link, 'acme', (data) => states.push(data))
  const last = (): SettingsData => {
    const data = states.at(-1)
    if (data === undefined) throw new Error('nothing was heard yet')
    return data
  }
  const ready = () =>
    vi.waitFor(() => {
      const data = last()
      expect(data.project.kind).toBe('ready')
      expect(data.catalogue.kind).toBe('ready')
      expect(data.recipe.kind).toBe('ready')
      expect(data.variables.kind).toBe('ready')
      expect(data.runs.kind).toBe('ready')
    })
  return {
    settings,
    last,
    ready,
    asked,
    runChanges: (changed: Run) => {
      for (const listener of runListeners) listener(changed)
    },
    repositoryChanges: (change: RepositoryStatusChange) => {
      for (const listener of repositoryListeners) listener(change)
    },
  }
}

describe('The settings of a Project, as the page follows them', () => {
  test('every section is on its way first, then read: the recipe with what is wrong in it', async () => {
    const acme = engine()
    expect(acme.last().catalogue).toEqual({ kind: 'loading' })
    await acme.ready()
    expect(acme.last().catalogue).toEqual({ kind: 'ready', value: [WEB] })
    await vi.waitFor(() =>
      expect(acme.last().problems.get(1)).toBe('Step 1 is refused: it is missing.'),
    )
    await vi.waitFor(() =>
      expect(acme.last().reads.get('r-web')?.status).toEqual(
        Readable.make({ branch: 'main', commit: 'abc', dirty: false }),
      ),
    )
  })

  test('a section that cannot be read says why, in the engine’s words', async () => {
    const acme = engine({
      catalogue: async () => {
        throw new StaleVersion({ entity: 'Project', id: 'acme', expected: 1 })
      },
    })
    await vi.waitFor(() =>
      expect(acme.last().catalogue).toEqual({
        kind: 'failed',
        sentence: 'This Project changed elsewhere; reopen it and try again.',
      }),
    )
  })

  test('a repository Git can no longer read says so as it happens, with Git’s reason', async () => {
    const acme = engine()
    await acme.ready()
    acme.repositoryChanges({
      repositoryId: 'r-api',
      projectId: 'acme',
      status: Unreadable.make({ reason: 'fatal: not a git repository' }),
    })
    expect(acme.last().reads.get('r-api')?.status).toEqual(
      Unreadable.make({ reason: 'fatal: not a git repository' }),
    )
  })

  test('a run that starts, then publishes its address, changes its line in place', async () => {
    const acme = engine()
    await acme.ready()
    acme.runChanges(run('run-1'))
    acme.runChanges(run('run-1', { state: 'ready', url: 'http://localhost:5173' }))
    acme.runChanges({ ...run('other'), projectId: 'elsewhere' })
    const { runs } = acme.last()
    expect(runs.kind === 'ready' ? runs.value : []).toEqual([
      run('run-1', { state: 'ready', url: 'http://localhost:5173' }),
    ])
    await vi.waitFor(() =>
      expect(acme.last().outputs.get('run-1')).toEqual(['ready', 'Local: http://localhost:5173']),
    )
  })

  test('a variable’s value is read only when the user asks to see it, and hidden again', async () => {
    const acme = engine()
    await acme.ready()
    expect(acme.asked).toEqual([])
    await acme.settings.reveal('API_TOKEN')
    expect(acme.asked).toEqual(['reveal API_TOKEN'])
    expect(acme.last().revealed.get('API_TOKEN')).toBe('acme-local-6f1c2a')
    acme.settings.hide('API_TOKEN')
    expect(acme.last().revealed.has('API_TOKEN')).toBe(false)
  })

  test('a save the engine refuses rejects with its refusal, and the catalogue stays as it was', async () => {
    const acme = engine({
      saveCommand: async () => {
        throw new ShellSyntax({ token: '&&' })
      },
    })
    await acme.ready()
    const refusal = await acme.settings.saveCommand(null, { ...DRAFT, line: 'a && b' }).then(
      () => new Error('saved'),
      (error: Error) => error,
    )
    expect(refusal).toBeInstanceOf(ShellSyntax)
    expect(acme.last().catalogue).toEqual({ kind: 'ready', value: [WEB] })
  })

  test('a command saved takes its place in the catalogue', async () => {
    const LINT: Command = { ...WEB, id: 'c-lint', name: 'lint', type: 'lint' }
    const acme = engine({ saveCommand: async () => LINT })
    await acme.ready()
    await acme.settings.saveCommand(null, DRAFT)
    expect(acme.last().catalogue).toEqual({ kind: 'ready', value: [WEB, LINT] })
  })

  test('an edit is made at the Project’s version, and its answer carries the next one', async () => {
    const versions: number[] = []
    const acme = engine({
      setBaseBranch: async ({ version, branch }) => {
        versions.push(version)
        return {
          ...ACME,
          version: version + 1,
          repositories: [{ ...repository('r-api', 'api'), baseBranch: branch }],
        }
      },
      upToDateBase: async () => {
        throw new InvalidBranchName({ name: 'dev', reason: 'it does not exist' })
      },
    })
    await acme.ready()
    await acme.settings.setBaseBranch('r-api', 'dev')
    await acme.settings.setBaseBranch('r-api', 'dev')
    expect(versions).toEqual([3, 4])
    await vi.waitFor(() =>
      expect(acme.last().reads.get('r-api')?.fetch).toEqual(
        NotFetchedSince.make({
          since: null,
          reason: '“dev” is not a branch name Git accepts: it does not exist.',
        }),
      ),
    )
  })

  test('a service of the main checkout is started, stopped and restarted by its line', async () => {
    const asked: string[] = []
    const acme = engine({
      startRun: async ({ commandId }) => {
        asked.push(`start ${String(commandId)}`)
        return run('run-1')
      },
      stopRun: async (id) => {
        asked.push(`stop ${id}`)
        return run(id, { state: 'stopped', endedAt: '2026-10-04T08:01:00.000Z' })
      },
      restartRun: async (id) => {
        asked.push(`restart ${id}`)
        return run('run-2')
      },
    })
    await acme.ready()
    await acme.settings.start('command:c-web')
    await acme.settings.stopLine('command:c-web')
    await acme.settings.restart('command:c-web')
    expect(asked).toEqual(['start c-web', 'stop run-1', 'restart run-1'])
    const { runs } = acme.last()
    expect(runs.kind === 'ready' ? runs.value.map((one) => one.id) : []).toEqual(['run-2', 'run-1'])
  })
})
