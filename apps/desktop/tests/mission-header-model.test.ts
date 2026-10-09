/** What a mission's header shows beyond its line: the lock, Freeze, Cancel, the names and the needs. */

import {
  AgentWorking,
  DecisionFields,
  MissionOwner,
  OutdatedMark,
  FixingMark,
  markIdentity,
  type Mark,
} from '@hemera/core/domain'
import type { FreezeReadiness, Mission, MissionMark, Need, Project } from '@hemera/ipc'
import { STAGE_LIFE, stageWords, type MissionStage } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import {
  cancelOffered,
  differenceOf,
  freezeOffered,
  freezeShown,
  frozenOf,
  headerOf,
  needHandlersOf,
  needRowsOfMission,
  oneAtATime,
  pageOf,
  repositoryNamer,
} from '../src/renderer/mission-header-model.ts'
import { SILENT_LINK } from './fake-link.ts'

const readiness = (ready: boolean): FreezeReadiness => ({
  ready,
  unsettled: ready ? [] : ['A question is still open'],
  freshness: { readVersion: 3, specVersion: 3, changes: [] },
  dependencies: [],
})

const markOf = (mark: Mark): MissionMark => ({
  id: `mark-${markIdentity(mark)}`,
  mark,
  sentence: '',
  setAt: '2026-10-05T09:00:00.000Z',
})

const need = (id: string, question: string): Need => ({
  id,
  owner: MissionOwner.make({ projectId: 'acme', missionId: 'm14', taskId: null }),
  fields: DecisionFields.make({
    question,
    options: ['Admins only', 'Every member'],
    recommended: null,
  }),
  choices: [],
  requestedBy: null,
  state: 'pending',
  answer: null,
  endedReason: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  endedAt: null,
})

const mission = (more: Partial<Mission> = {}): Mission => ({
  id: 'm14',
  projectId: 'acme',
  key: 'ACME-14',
  title: 'An audit log of who read what',
  idea: { sentence: 'An audit log', ticket: null },
  type: 'feature',
  ticketLink: null,
  origin: null,
  stage: 'planning',
  round: 0,
  frozen: false,
  freeze: null,
  marks: [],
  ball: AgentWorking.make({}),
  needs: [],
  cleanup: null,
  unstopped: [],
  triage: null,
  createdAt: '2026-10-05T08:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
  ...more,
})

describe('The stage in words', () => {
  test('Building and Review say their round, the other stages do not', () => {
    expect(stageWords('Building', 2)).toBe('Building · round 2')
    expect(stageWords('Review', 1)).toBe('Review · round 1')
    expect(stageWords('Building', 0)).toBe('Building')
    expect(stageWords('Planning', 0)).toBe('Planning')
  })
})

describe('The frozen lock', () => {
  const stages: readonly MissionStage[] = [...STAGE_LIFE, 'Cancelled']

  test('stands from Ready on, whatever the mission’s own flag says', () => {
    expect(stages.filter((stage) => frozenOf({ stage, frozen: false }))).toEqual([
      'Ready',
      'Building',
      'Review',
      'Shipping',
      'Done',
    ])
  })

  test('stands in Planning or Cancelled only when the Spec is frozen', () => {
    expect(frozenOf({ stage: 'Planning', frozen: true })).toBe(true)
    expect(frozenOf({ stage: 'Cancelled', frozen: true })).toBe(true)
    expect(frozenOf({ stage: 'Planning', frozen: false })).toBe(false)
  })
})

describe('Freeze', () => {
  test('is offered in Planning once the engine says everything is settled', () => {
    expect(freezeOffered('Planning', readiness(true))).toBe(true)
  })

  test('is absent while something is unsettled, before the engine answers, and past Planning', () => {
    expect(freezeOffered('Planning', readiness(false))).toBe(false)
    expect(freezeOffered('Planning', null)).toBe(false)
    expect(freezeOffered('Ready', readiness(true))).toBe(false)
    expect(freezeOffered('Review', readiness(true))).toBe(false)
  })
})

describe('Cancel', () => {
  test('is offered at every stage before Done', () => {
    expect(
      (['Planning', 'Ready', 'Building', 'Review', 'Shipping'] as const).every(cancelOffered),
    ).toBe(true)
  })

  test('is absent at Done and at Cancelled', () => {
    expect(cancelOffered('Done')).toBe(false)
    expect(cancelOffered('Cancelled')).toBe(false)
  })
})

describe('The header as a whole', () => {
  test('puts the lock, Freeze and Cancel together', () => {
    expect(headerOf({ stage: 'Planning', frozen: false }, readiness(true))).toEqual({
      frozen: false,
      freeze: true,
      cancel: true,
    })
    expect(headerOf({ stage: 'Done', frozen: true }, null)).toEqual({
      frozen: true,
      freeze: false,
      cancel: false,
    })
  })
})

describe('The base of each stage', () => {
  test('is the page registered for the stage, and none for a stage without one', () => {
    const pages = { Planning: 'planning page' }
    expect(pageOf(pages, 'Planning')).toBe('planning page')
    expect(pageOf(pages, 'Building')).toBeUndefined()
  })
})

describe('The names of the repositories on a mark', () => {
  const project: Project = {
    id: 'acme',
    name: 'Acme',
    mainCheckout: '/work/acme',
    workspacesRoot: null,
    branchPrefix: null,
    keyPrefix: 'ACME',
    version: 1,
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:00:00.000Z',
    repositories: ['api', 'apps/web', '.'].map((path, index) => ({
      id: `r${String(index + 1)}`,
      projectId: 'acme',
      path,
      includedByDefault: true,
      remote: null,
      baseBranch: 'main',
      lastFetchedAt: null,
    })),
  }

  test('is the folder of the repository, the main checkout’s for the dot', () => {
    const name = repositoryNamer(project)
    expect(name('r1')).toBe('api')
    expect(name('r2')).toBe('web')
    expect(name('r3')).toBe('acme')
  })

  test('keeps the id of one it does not know, and before the Project is read', () => {
    expect(repositoryNamer(project)('zz')).toBe('zz')
    expect(repositoryNamer(null)('r1')).toBe('r1')
  })
})

describe('What the outdated mark says moved', () => {
  test('is the reason in a sentence and the difference as the mark keeps it', () => {
    const outdated = markOf(
      OutdatedMark.make({
        reason: 'ticket-changed',
        reference: 'acme/shop#38',
        difference: 'A second acceptance line',
      }),
    )
    expect(differenceOf(mission({ marks: [markOf(FixingMark.make({})), outdated] }))).toEqual({
      why: 'The ticket changed',
      difference: 'A second acceptance line',
    })
  })

  test('is nothing for a mission that is not outdated', () => {
    expect(differenceOf(mission())).toBeNull()
  })
})

describe('The needs at the top of a mission', () => {
  const waiting = mission({
    needs: [need('n1', 'Who may read the audit log?'), need('n2', 'How long is the log kept?')],
  })

  test('are one row each, under the Project’s name, with the mission’s key', () => {
    const rows = needRowsOfMission(waiting, 'Acme', new Date('2026-10-05T09:04:00.000Z'))
    expect(rows.map((row) => [row.id, row.project, row.need.title, row.need.missionKey])).toEqual([
      ['n1', 'Acme', 'Who may read the audit log?', 'ACME-14'],
      ['n2', 'Acme', 'How long is the log kept?', 'ACME-14'],
    ])
    expect(rows[0]?.need.when).toBe('4 min')
  })

  test('are none for a mission nothing waits on', () => {
    expect(needRowsOfMission(mission(), 'Acme', new Date())).toEqual([])
  })

  test('answer through the window: a choice sends the option under its own label', () => {
    const sent: Array<[string, string]> = []
    const handlers = needHandlersOf(waiting, {
      answer: (id, label) => sent.push([id, label]),
      recheck: () => undefined,
      openSettings: () => undefined,
    })('n2')
    handlers.onChoose?.('Every member')
    expect(sent).toEqual([['n2', 'Every member']])
    expect(
      needHandlersOf(waiting, {
        answer: () => undefined,
        recheck: () => undefined,
        openSettings: () => undefined,
      })('unknown'),
    ).toEqual({})
  })
})

describe('Freeze at the version the user was shown', () => {
  test('freezes the version of the readiness, not the Spec as it is at the click', async () => {
    const frozen: Array<[string, number]> = []
    const link = {
      ...SILENT_LINK,
      spec: () => Promise.reject(new Error('the Spec is not read at the click')),
      freeze: (id: string, version: number) => {
        frozen.push([id, version])
        return Promise.resolve(mission())
      },
    }
    const shown = {
      ...readiness(true),
      freshness: { readVersion: 3, specVersion: 4, changes: [] },
    }
    await freezeShown(link, 'm14', shown)
    expect(frozen).toEqual([['m14', 4]])
  })

  test('pressing twice while the first is in flight makes one call', async () => {
    const busy: boolean[] = []
    const once = oneAtATime((now) => busy.push(now))
    let calls = 0
    let finish: () => void = () => undefined
    const task = (): Promise<number> => {
      calls += 1
      return new Promise((resolve) => {
        finish = () => resolve(calls)
      })
    }
    const first = once(task)
    const second = once(task)
    expect(calls).toBe(1)
    expect(await second).toBeUndefined()
    finish()
    expect(await first).toBe(1)
    expect(busy).toEqual([true, false])
    const third = once(task)
    expect(calls).toBe(2)
    finish()
    await third
  })
})
