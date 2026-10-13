/**
 * The followers of the Ready and Building pages: what they read and follow, what the user's
 * gestures send to the engine, and how a launch goes on by itself once the check holds.
 */

import { CHECK_EXPIRED } from '@hemera/core/domain'
import {
  BuildingRefused,
  CheckChanged,
  PreparationChanged,
  type BuildingChange,
  type BuildingView,
  type MemoryChanged,
  type Run,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  followBuilding,
  followReady,
  type BuildingFollowView,
  type ReadyFollowView,
} from '../src/renderer/building-follow.ts'
import type { Link } from '../src/renderer/link.ts'
import {
  AGENTS,
  NOW,
  budget,
  building,
  check,
  command,
  diff,
  grant,
  line,
  model,
  now,
  preparation,
  service,
  spec,
} from './building-fixtures.ts'
import { SILENT_LINK } from './fake-link.ts'

const MISSION = { id: 'm12', projectId: 'acme', frozenAt: '2026-10-11T15:02:00.000Z' }

/** Lets the promises the follower chained settle. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A link that answers the reads both pages share, and records every call a gesture makes. */
function linkOf(more: Partial<Link> = {}) {
  const calls: string[] = []
  const launchListeners: Array<(change: BuildingChange) => void> = []
  const buildingListeners: Array<(view: BuildingView | null) => void> = []
  const memoryListeners: Array<(change: MemoryChanged) => void> = []
  const link: Link = {
    ...SILENT_LINK,
    spec: () => Promise.resolve(spec()),
    dependencies: () => Promise.resolve({ dependsOn: [], dependedOnBy: [] }),
    missions: () => Promise.resolve([]),
    missionGrants: () => Promise.resolve([grant()]),
    missionBudget: () => Promise.resolve(budget()),
    agents: () => Promise.resolve(AGENTS),
    modelMarks: () => Promise.resolve([]),
    onLaunch: (_missionId, listener) => {
      launchListeners.push(listener)
      return () => undefined
    },
    onBuilding: (_missionId, listener) => {
      buildingListeners.push(listener)
      return () => undefined
    },
    onMemory: (_missionId, listener) => {
      memoryListeners.push(listener)
      return () => undefined
    },
    memoryNow: () => Promise.resolve(now()),
    journal: (_missionId, before) => {
      calls.push(`journal ${String(before)}`)
      return Promise.resolve(
        before === null
          ? { lines: [line({ sequence: 12 })], before: 12 }
          : { lines: [line({ sequence: 3, text: 'You launched ACME-12' })], before: null },
      )
    },
    missionServices: () => Promise.resolve([service()]),
    catalogue: () => Promise.resolve([command()]),
    liveDiff: () => Promise.resolve(diff()),
    checkLaunch: () => {
      calls.push('check')
      return Promise.resolve(check())
    },
    launch: (_missionId, checkId, choice) => {
      calls.push(`launch ${checkId} ${choice}`)
      return Promise.resolve(preparation())
    },
    backToPlanning: (_missionId, checkId) => {
      calls.push(`back ${checkId}`)
      return Promise.reject(new Error('not played'))
    },
    chooseBuilderModel: (_missionId, setting) => {
      calls.push(
        `model ${setting === null ? 'default' : `${setting.agent} ${String(setting.model)}`}`,
      )
      return Promise.resolve(setting === null ? model() : model({ level: 'mission', setting }))
    },
    revokeGrant: (grantId) => {
      calls.push(`revoke ${grantId}`)
      return Promise.resolve()
    },
    stopService: (_missionId, runId) => {
      calls.push(`stop ${runId}`)
      return Promise.resolve(service({ state: 'stopped' }))
    },
    restartService: (_missionId, runId) => {
      calls.push(`restart ${runId}`)
      return Promise.resolve(service())
    },
    startService: (_missionId, commandId) => {
      calls.push(`start ${commandId}`)
      return Promise.resolve(service())
    },
    dismissService: (_missionId, runId) => {
      calls.push(`dismiss ${runId}`)
      return Promise.resolve()
    },
    ...more,
  }
  return { link, calls, launchListeners, buildingListeners, memoryListeners }
}

const ready = (link: Link) => {
  const views: ReadyFollowView[] = []
  const following = followReady(
    link,
    MISSION,
    (view) => views.push(view),
    () => NOW,
  )
  return { following, last: () => views.at(-1) }
}

const followed = (link: Link) => {
  const views: BuildingFollowView[] = []
  const following = followBuilding(
    link,
    MISSION,
    (view) => views.push(view),
    () => NOW,
  )
  return { following, last: () => views.at(-1) }
}

/** A run of a service, as the engine announces it when its address is published. */
const serveRun: Run = {
  id: 'run-api',
  projectId: 'acme',
  workspaceId: 'w1',
  commandId: 'cmd-api',
  name: 'api',
  type: 'serve',
  line: 'pnpm --filter api dev',
  folder: '/work/acme/api',
  startedBy: 'user',
  sessionId: null,
  missionId: 'm12',
  state: 'running',
  exitCode: null,
  url: 'http://127.0.0.1:41873',
  portConflict: null,
  startedAt: '2026-10-11T15:10:00.000Z',
  endedAt: null,
}

describe('Launching from the Ready page', () => {
  test('Build checks, and the launch goes on by itself when nothing moved', async () => {
    const { link, calls } = linkOf()
    const { following, last } = ready(link)
    await settled()
    expect(last()?.moment?.check).toEqual({ state: 'idle' })
    expect(last()?.launchable).toBe(true)
    const pressed = following.launch()
    expect(last()?.moment?.check.state).toBe('checking')
    expect(last()?.launchable).toBe(false)
    await pressed
    expect(calls).toEqual(['check', 'launch c1 launch'])
  })

  test('outdated: nothing launches until Launch anyway, or Back to Planning sends the check', async () => {
    const outdated = check({
      verdict: {
        outdated: true,
        blockedBy: [],
        actions: ['launch_anyway', 'back_to_planning'],
        said: 'Outdated',
      },
    })
    const { link, calls } = linkOf({ checkLaunch: () => Promise.resolve(outdated) })
    const { following, last } = ready(link)
    await following.launch()
    expect(last()?.moment?.check.state).toBe('outdated')
    expect(calls).toEqual([])
    await following.launchAnyway()
    await following.backToPlanning()
    expect(calls).toEqual(['launch c1 launch_anyway', 'back c1'])
    expect(last()?.refused).toBe('not played')
  })

  test('a check still under way launches once its end arrives, and only once', async () => {
    const running = check({ state: 'running', endedAt: null })
    const { link, calls, launchListeners } = linkOf({
      checkLaunch: () => {
        calls.push('check')
        return Promise.resolve(running)
      },
    })
    const { following } = ready(link)
    await following.launch()
    expect(calls).toEqual(['check'])
    for (const listener of launchListeners) listener(CheckChanged.make({ check: check() }))
    for (const listener of launchListeners) listener(CheckChanged.make({ check: check() }))
    await settled()
    expect(calls).toEqual(['check', 'launch c1 launch'])
  })

  test('a launch refused because something moved since the check says check again', async () => {
    const silent = check({
      agent: { state: 'unanswered', summary: null, said: 'No answer' },
      verdict: { outdated: false, blockedBy: [], actions: ['launch', 'check_again'], said: '' },
    })
    const { link } = linkOf({
      checkLaunch: () => Promise.resolve(silent),
      launch: () => Promise.reject(new BuildingRefused({ reasons: [CHECK_EXPIRED, 'api moved'] })),
    })
    const { following, last } = ready(link)
    await following.launch()
    expect(last()?.moment?.check.state).toBe('silent')
    await following.launchAnyway()
    expect(last()?.moment?.check).toEqual({ state: 'expired' })
    expect(last()?.refused).toBeUndefined()
  })

  test('the preparation’s steps arrive as they move', async () => {
    const { link, launchListeners } = linkOf()
    const { last } = ready(link)
    await settled()
    for (const listener of launchListeners) {
      listener(PreparationChanged.make({ preparation: preparation() }))
    }
    expect(last()?.moment?.preparation?.map((step) => step.state)).toEqual([
      'done',
      'done',
      'running',
    ])
  })

  test('the model chosen is the mission’s own; the default chosen again inherits', async () => {
    const { link, calls } = linkOf()
    const { following, last } = ready(link)
    await settled()
    await following.chooseModel({ agent: 'claude', model: 'sonnet' })
    expect(last()?.moment?.model.value).toEqual({ agent: 'claude', model: 'sonnet' })
    await following.chooseModel(null)
    expect(last()?.moment?.model.value).toBeNull()
    expect(calls).toEqual(['model claude sonnet', 'model default'])
  })

  test('a model starred or hidden in the picker is marked, over its earlier mark', async () => {
    const marked: string[] = []
    const { link } = linkOf({
      modelMarks: () =>
        Promise.resolve([{ agent: 'claude', model: 'opus', favourite: false, hidden: true }]),
      markModel: (mark) => {
        marked.push(`${mark.model} ${String(mark.favourite)} ${String(mark.hidden)}`)
        return Promise.resolve()
      },
    })
    const { following } = ready(link)
    await settled()
    await following.mark('claude', 'opus', { favourite: true })
    await following.mark('ghost', 'opus', { favourite: true })
    expect(marked).toEqual(['opus true true'])
  })

  test('a grant revoked is read again, and leaves the list', async () => {
    let grants = [grant()]
    const { link, calls } = linkOf({
      missionGrants: () => Promise.resolve(grants),
      revokeGrant: (grantId) => {
        calls.push(`revoke ${grantId}`)
        grants = [grant({ state: 'revoked' })]
        return Promise.resolve()
      },
    })
    const { following, last } = ready(link)
    await settled()
    expect(last()?.moment?.mission.grants).toHaveLength(1)
    await following.revoke('g1')
    await settled()
    expect(calls).toEqual(['revoke g1'])
    expect(last()?.moment?.mission.grants).toEqual([])
  })
})

describe('Following the Building page', () => {
  test('the Building, Now and the journal, as they change', async () => {
    const { link, buildingListeners, memoryListeners } = linkOf()
    const { last } = followed(link)
    await settled()
    expect(last()?.moment).toBeNull()
    for (const listener of buildingListeners) listener(building())
    await settled()
    expect(last()?.moment?.now).toBe('Writes the export button (T2)')
    expect(last()?.percent).toBe(33)
    for (const listener of memoryListeners) {
      listener({
        missionId: 'm12',
        now: now({
          doing: [],
          waiting: [{ needId: 'n1', kind: 'decision', sentence: 'T2 waits for your answer' }],
        }),
        added: [line({ sequence: 13, text: 'T1 done in api' })],
      })
    }
    expect(last()?.moment?.now).toBe('T2 waits for your answer')
    expect(last()?.moment?.journal.map((event) => event.text)).toEqual([
      'T1 done in api',
      'R1 proven: S1 green',
    ])
  })

  test('earlier journal events are read before the oldest line shown', async () => {
    const { link, calls, buildingListeners } = linkOf()
    const { following, last } = followed(link)
    for (const listener of buildingListeners) listener(building())
    await settled()
    expect(last()?.moment?.journalMore).toBe(true)
    await following.journalMore()
    expect(calls).toEqual(['journal null', 'journal 12'])
    expect(last()?.moment?.journal.map((event) => event.text)).toEqual([
      'R1 proven: S1 green',
      'You launched ACME-12',
    ])
    expect(last()?.moment?.journalMore).toBe(false)
  })

  test('a service is stopped, restarted, started again or from the catalogue, and dismissed', async () => {
    const stopped = service({
      runId: 'run-worker',
      commandId: 'cmd-worker',
      name: 'worker',
      state: 'stopped',
      url: null,
      dismissable: true,
    })
    const { link, calls, buildingListeners } = linkOf({
      missionServices: () => Promise.resolve([service(), stopped]),
      catalogue: () =>
        Promise.resolve([
          command(),
          command({ id: 'cmd-worker', name: 'worker' }),
          command({ id: 'cmd-mail', name: 'mailpit' }),
        ]),
    })
    const { following } = followed(link)
    for (const listener of buildingListeners) listener(building())
    await settled()
    await following.service('run-api', 'stop')
    await following.service('run-api', 'restart')
    await following.service('run-worker', 'start')
    await following.service('cmd-mail', 'start')
    await following.service('run-worker', 'dismiss')
    expect(calls.filter((one) => !one.startsWith('journal'))).toEqual([
      'stop run-api',
      'restart run-api',
      'start cmd-worker',
      'start cmd-mail',
      'dismiss run-worker',
    ])
  })

  test('a service shows its address once it publishes it, without a gesture', async () => {
    let read = service({ state: 'starting', url: null })
    const runListeners: Array<(run: Run) => void> = []
    const { link, buildingListeners } = linkOf({
      missionServices: () => Promise.resolve([read]),
      onRunChanges: (listener) => {
        runListeners.push(listener)
        return () => undefined
      },
    })
    const { last } = followed(link)
    for (const listener of buildingListeners) listener(building())
    await settled()
    expect(last()?.moment?.services.map((one) => one.url)).toEqual([undefined])
    read = service({ state: 'starting', url: 'http://127.0.0.1:41873' })
    for (const listener of runListeners) listener(serveRun)
    await settled()
    expect(last()?.moment?.services.map((one) => one.url)).toEqual(['http://127.0.0.1:41873'])
  })
})
