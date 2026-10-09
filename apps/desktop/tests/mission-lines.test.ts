/**
 * A mission as the screens' lists read it: its stage in the screens' words, the ball in the
 * design system's, its marks as rows draw them, and the lists grouped by stage, newest first.
 */

import {
  AgentWorking,
  ApplicationOwner,
  Blocked,
  BlockedMark,
  CanonicalTicket,
  ChangedOutsideMark,
  DecisionFields,
  Dependency,
  FixingMark,
  Idle,
  markIdentity,
  OutdatedMark,
  Resource,
  WaitingOnSomeone,
  WaitingOnSomeoneMark,
  WaitingOnYou,
  type Mark,
} from '@hemera/core/domain'
import { MissionChanged, NeedChanged, type Mission, type MissionMark, type Need } from '@hemera/ipc'
import { STAGE_ORDER } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import {
  afterChange,
  ballOf,
  byStage,
  lineOf,
  marksOf,
  stageOf,
  type MissionLine,
} from '../src/renderer/missions.ts'

const repositoryName = (id: string): string => ({ r1: 'acme/api', r2: 'acme/web' })[id] ?? id

const markOf = (mark: Mark): MissionMark => ({
  id: `mark-${markIdentity(mark)}`,
  mark,
  sentence: '',
  setAt: '2026-10-05T09:00:00.000Z',
})

const mission = (more: Partial<Mission> = {}): Mission => ({
  id: 'm12',
  projectId: 'acme',
  key: 'ACME-12',
  title: 'Export invoices as CSV',
  idea: { sentence: 'Export invoices', ticket: null },
  type: 'feature',
  ticketLink: null,
  origin: null,
  stage: 'building',
  round: 0,
  frozen: true,
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

const aNeed: Need = {
  id: 'need-1',
  owner: ApplicationOwner.make({}),
  fields: DecisionFields.make({ question: 'Which table?', options: ['a', 'b'], recommended: null }),
  choices: [],
  requestedBy: null,
  state: 'pending',
  answer: null,
  endedReason: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  endedAt: null,
}

describe('The stage of a mission, in the screens’ words', () => {
  test('every engine stage has its capitalised word', () => {
    expect(
      (['planning', 'ready', 'building', 'review', 'shipping', 'done', 'cancelled'] as const).map(
        stageOf,
      ),
    ).toEqual(['Planning', 'Ready', 'Building', 'Review', 'Shipping', 'Done', 'Cancelled'])
  })
})

describe('Who has the ball, in the design system’s words', () => {
  test('each engine ball maps to its mark, and no ball at all is idle', () => {
    expect(ballOf(AgentWorking.make({}))).toBe('agent')
    expect(ballOf(WaitingOnYou.make({}))).toBe('you')
    expect(ballOf(WaitingOnSomeone.make({}))).toBe('someone')
    expect(ballOf(Blocked.make({ causes: [] }))).toBe('blocked')
    expect(ballOf(Idle.make({}))).toBe('idle')
    expect(ballOf(null)).toBe('idle')
  })
})

describe('The marks of a mission, as a row draws them', () => {
  test('a dependency blocks with the key of the mission waited on', () => {
    const blocked = markOf(BlockedMark.make({ cause: Dependency.make({ missionKey: 'ACME-9' }) }))
    expect(marksOf(mission({ marks: [blocked] }), repositoryName)).toEqual([
      { kind: 'blocked', cause: 'ACME-9' },
    ])
  })

  test('a resource blocks with its name and who holds it', () => {
    const blocked = markOf(
      BlockedMark.make({ cause: Resource.make({ name: 'shared database', heldBy: 'ACME-9' }) }),
    )
    expect(marksOf(mission({ marks: [blocked] }), repositoryName)).toEqual([
      { kind: 'blocked', cause: 'shared database · ACME-9' },
    ])
  })

  test('waiting on someone says the note when there is one, else the question', () => {
    const noted = markOf(
      WaitingOnSomeoneMark.make({ question: 'Who reads?', note: 'CI on acme/shop#52' }),
    )
    const asked = markOf(WaitingOnSomeoneMark.make({ question: 'Who reads?', note: null }))
    expect(marksOf(mission({ marks: [noted] }), repositoryName)).toEqual([
      { kind: 'waiting', on: 'CI on acme/shop#52' },
    ])
    expect(marksOf(mission({ marks: [asked] }), repositoryName)).toEqual([
      { kind: 'waiting', on: 'Who reads?' },
    ])
  })

  test('outdated, changed outside and fixing keep their kind, the repository by its name', () => {
    const marks = [
      markOf(
        OutdatedMark.make({
          reason: 'ticket-changed',
          reference: 'acme/shop#41',
          difference: 'The title changed',
        }),
      ),
      markOf(ChangedOutsideMark.make({ repositoryId: 'r2' })),
      markOf(FixingMark.make({})),
    ]
    expect(marksOf(mission({ marks }), repositoryName)).toEqual([
      { kind: 'outdated' },
      { kind: 'outside', repository: 'acme/web' },
      { kind: 'fixing' },
    ])
  })

  test('a need that waits on the user puts Needs you first', () => {
    const outdated = markOf(
      OutdatedMark.make({ reason: 'target-moved', reference: 'main', difference: 'main moved' }),
    )
    expect(marksOf(mission({ marks: [outdated], needs: [aNeed] }), repositoryName)).toEqual([
      { kind: 'needsYou' },
      { kind: 'outdated' },
    ])
  })
})

describe('A mission as a line of a list', () => {
  test('carries what a row needs, with the ticket by its key and page', () => {
    const line = lineOf(
      mission({
        stage: 'review',
        round: 1,
        needs: [aNeed],
        ball: WaitingOnYou.make({}),
        ticketLink: {
          provider: 'github',
          reference: CanonicalTicket.make('github:github.com/acme/shop#41'),
          key: 'acme/shop#41',
          url: 'https://github.com/acme/shop/issues/41',
        },
      }),
      repositoryName,
    )
    expect(line).toEqual({
      id: 'm12',
      projectId: 'acme',
      key: 'ACME-12',
      title: 'Export invoices as CSV',
      stage: 'Review',
      round: 1,
      frozen: true,
      ball: 'you',
      marks: [{ kind: 'needsYou' }],
      needs: 1,
      type: 'feature',
      ticket: { key: 'acme/shop#41', url: 'https://github.com/acme/shop/issues/41' },
      updatedAt: '2026-10-05T09:00:00.000Z',
    })
  })

  test('a mission without a ticket has none, and a finished one holds no ball', () => {
    const line = lineOf(mission({ stage: 'done', ball: null }), repositoryName)
    expect(line.ticket).toBeNull()
    expect(line.ball).toBe('idle')
    expect(line.stage).toBe('Done')
  })
})

const line = (key: string, stage: MissionLine['stage'], updatedAt: string): MissionLine => ({
  ...lineOf(mission({ key, id: key }), repositoryName),
  stage,
  updatedAt,
})

describe('Missions grouped by stage', () => {
  test('follow the stages’ order, drop the empty ones and put the newest first inside', () => {
    const groups = byStage([
      line('ACME-1', 'Done', '2026-10-01T00:00:00.000Z'),
      line('ACME-2', 'Planning', '2026-10-02T00:00:00.000Z'),
      line('ACME-3', 'Review', '2026-10-03T00:00:00.000Z'),
      line('ACME-4', 'Planning', '2026-10-04T00:00:00.000Z'),
      line('ACME-5', 'Cancelled', '2026-10-05T00:00:00.000Z'),
    ])
    expect(groups.map((group) => group.stage)).toEqual(['Review', 'Planning', 'Done', 'Cancelled'])
    expect(groups.map((group) => group.stage)).toEqual(
      STAGE_ORDER.filter((stage) => groups.some((group) => group.stage === stage)),
    )
    expect(groups[1]?.lines.map((one) => one.key)).toEqual(['ACME-4', 'ACME-2'])
  })

  test('no missions, no groups', () => {
    expect(byStage([])).toEqual([])
  })
})

describe('The missions of a Project as the engine’s changes leave them', () => {
  test('a changed mission of the Project replaces its earlier self in place', () => {
    const before = [mission({ id: 'a', key: 'ACME-1' }), mission({ id: 'b', key: 'ACME-2' })]
    const after = afterChange(
      before,
      MissionChanged.make({ mission: mission({ id: 'a', key: 'ACME-1', stage: 'review' }) }),
      'acme',
    )
    expect(after.map((one) => [one.id, one.stage])).toEqual([
      ['a', 'review'],
      ['b', 'building'],
    ])
  })

  test('a mission not yet known is added', () => {
    const after = afterChange(
      [mission({ id: 'a' })],
      MissionChanged.make({ mission: mission({ id: 'c', key: 'ACME-3' }) }),
      'acme',
    )
    expect(after.map((one) => one.id)).toEqual(['a', 'c'])
  })

  test('a mission of another Project and a need change nothing', () => {
    const before = [mission({ id: 'a' })]
    expect(
      afterChange(
        before,
        MissionChanged.make({ mission: mission({ id: 'z', projectId: 'labs' }) }),
        'acme',
      ),
    ).toBe(before)
    expect(afterChange(before, NeedChanged.make({ need: aNeed }), 'acme')).toBe(before)
  })
})
