/**
 * What Home says from what the engine gave: the open questions grouped by mission, the pages of
 * Since you left merged, Recent's rows from missions, and when Home counts as looked at.
 */

import { AgentWorking, ChangedOutsideMark, markIdentity, WaitingOnYou } from '@hemera/core/domain'
import type {
  JournalTail,
  Mission,
  MissionMark,
  OpenQuestion,
  Project,
  SinceEvent,
  SinceGroup,
  SincePage,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  UNSEEN,
  leavesLooked,
  mergeSince,
  questionRowsOf,
  recentRowsOf,
  sightAfter,
  sinceCursorOf,
  sinceGroupsOf,
} from '../src/renderer/home-model.ts'

const NOW = new Date('2026-10-09T09:00:00.000Z')

const question = (more: Partial<OpenQuestion> = {}): OpenQuestion => ({
  missionId: 'm14',
  missionKey: 'ACME-14',
  projectId: 'acme',
  projectName: 'Acme',
  wave: 1,
  questionId: 'q1',
  text: 'Who may read the audit log?',
  recommended: { id: 'o1', label: 'Admins', detail: 'the usual' },
  state: 'open',
  waitingNote: null,
  since: '2026-10-08T09:00:00.000Z',
  ...more,
})

const event = (sequence: number, more: Partial<SinceEvent> = {}): SinceEvent => ({
  sequence,
  tone: 'done',
  text: `Event ${String(sequence)}`,
  at: `2026-10-09T0${String(sequence % 10)}:00:00.000Z`,
  ...more,
})

const group = (missionId: string | null, events: SinceEvent[], more: Partial<SinceGroup> = {}) => ({
  projectId: 'acme',
  missionId,
  missionKey: missionId === null ? null : `KEY-${missionId}`,
  title: missionId === null ? 'Acme' : `Mission ${missionId}`,
  ball: null,
  events,
  ...more,
})

const page = (groups: SinceGroup[], before: number | null = null): SincePage => ({
  groups,
  before,
})

const project = (id: string, name: string): Project => ({
  id,
  name,
  mainCheckout: `/work/${id}`,
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: name.toUpperCase(),
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [
    {
      id: 'r2',
      projectId: id,
      path: 'web',
      includedByDefault: true,
      remote: null,
      baseBranch: 'main',
      lastFetchedAt: null,
    },
  ],
})

const PROJECTS = [project('acme', 'Acme'), project('hemera', 'Hemera')]

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
  updatedAt: '2026-10-09T07:00:00.000Z',
  ...more,
})

describe('The open questions, grouped by mission', () => {
  test('the questions of one mission stand together, the mission waiting longest first', () => {
    const rows = questionRowsOf(
      [
        question({ missionId: 'm1', questionId: 'a', since: '2026-10-09T08:00:00.000Z' }),
        question({ missionId: 'm2', questionId: 'b', since: '2026-10-08T08:00:00.000Z' }),
        question({ missionId: 'm1', questionId: 'c', since: '2026-10-09T08:30:00.000Z' }),
      ],
      NOW,
    )
    expect(rows.map((row) => row.id)).toEqual(['m2:b', 'm1:a', 'm1:c'])
  })

  test('inside a mission the earlier wave comes first', () => {
    const rows = questionRowsOf(
      [
        question({ questionId: 'late', wave: 2, since: '2026-10-08T08:00:00.000Z' }),
        question({ questionId: 'early', wave: 1, since: '2026-10-08T09:00:00.000Z' }),
      ],
      NOW,
    )
    expect(rows.map((row) => row.id)).toEqual(['m14:early', 'm14:late'])
  })

  test('a row says the Project, the key, the question and how long it has waited', () => {
    const [row] = questionRowsOf([question({ since: '2026-10-08T09:00:00.000Z' })], NOW)
    expect(row).toMatchObject({
      missionId: 'm14',
      project: 'Acme',
      missionKey: 'ACME-14',
      title: 'Who may read the audit log?',
      when: 'yesterday',
    })
  })

  test('no proposed answer is invented before the ticket gives one', () => {
    const [row] = questionRowsOf([question()], NOW)
    expect(row?.proposed).toBeUndefined()
  })
})

describe('The pages of Since you left, merged', () => {
  test('two pages of one mission make one group, its events newest first', () => {
    const merged = mergeSince([
      page([group('m1', [event(9), event(8)])], 5),
      page([group('m1', [event(5), event(4)])]),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.events.map((one) => one.sequence)).toEqual([9, 8, 5, 4])
  })

  test('the groups stand in the order of their newest event', () => {
    const merged = mergeSince([
      page([group('m2', [event(7)]), group('m1', [event(9)])], 5),
      page([group('m3', [event(3)])]),
    ])
    expect(merged.map((one) => one.missionId)).toEqual(['m1', 'm2', 'm3'])
  })

  test('the first page heard again does not repeat an event', () => {
    const merged = mergeSince([
      page([group('m1', [event(9), event(8)])], 5),
      page([group('m1', [event(8), event(5)])]),
    ])
    expect(merged[0]?.events.map((one) => one.sequence)).toEqual([9, 8, 5])
  })

  test('a group keeps the words it had in the newest page', () => {
    const merged = mergeSince([
      page([group('m1', [event(9)], { title: 'Renamed' })], 5),
      page([group('m1', [event(5)], { title: 'Old title' })]),
    ])
    expect(merged[0]?.title).toBe('Renamed')
  })

  test('the events of a Project itself make a group of their own, one per Project', () => {
    const merged = mergeSince([
      page([
        group(null, [event(9)]),
        group(null, [event(8)], { projectId: 'hemera', title: 'Hemera' }),
        group('m1', [event(7)]),
      ]),
    ])
    expect(merged.map((one) => [one.projectId, one.missionId])).toEqual([
      ['acme', null],
      ['hemera', null],
      ['acme', 'm1'],
    ])
  })

  test('the cursor is the last page read’s, or none while nothing was read', () => {
    expect(sinceCursorOf(null, [])).toBeNull()
    expect(sinceCursorOf(page([], 12), [])).toBe(12)
    expect(sinceCursorOf(page([], 12), [page([], 6)])).toBe(6)
    expect(sinceCursorOf(page([], 12), [page([], 6), page([], null)])).toBeNull()
  })
})

describe('Since you left, as the page draws it', () => {
  test('a card says the Project, the mission and its events in the words of the time', () => {
    const [card] = sinceGroupsOf(
      mergeSince([
        page([
          group('m1', [event(2, { at: '2026-10-09T08:56:00.000Z', tone: 'failed' })], {
            ball: WaitingOnYou.make({}),
          }),
        ]),
      ]),
      PROJECTS,
      NOW,
    )
    expect(card).toMatchObject({
      id: 'm1',
      missionId: 'm1',
      project: 'Acme',
      missionKey: 'KEY-m1',
      title: 'Mission m1',
      ball: 'you',
      events: [{ id: '2', tone: 'failed', text: 'Event 2', when: '4 min' }],
    })
  })

  test('a Project’s own events are a card that opens nothing', () => {
    const [card] = sinceGroupsOf(mergeSince([page([group(null, [event(2)])])]), PROJECTS, NOW)
    expect(card?.id).toBe('project:acme')
    expect(card?.missionId).toBeUndefined()
    expect(card?.missionKey).toBeUndefined()
    expect(card?.ball).toBeUndefined()
  })

  test('a mission without a ball is drawn without one', () => {
    const [card] = sinceGroupsOf(mergeSince([page([group('m1', [event(2)])])]), PROJECTS, NOW)
    expect(card?.ball).toBeUndefined()
  })

  test('events of a Project no longer listed are left out', () => {
    expect(
      sinceGroupsOf(
        mergeSince([page([group('m1', [event(2)], { projectId: 'gone' })])]),
        PROJECTS,
        NOW,
      ),
    ).toEqual([])
  })
})

const tail = (missionId: string, text: string | null): JournalTail => ({
  missionId,
  line: text === null ? null : { at: '2026-10-09T08:00:00.000Z', text },
})

const outside: MissionMark = {
  id: `mark-${markIdentity(ChangedOutsideMark.make({ repositoryId: 'r2' }))}`,
  mark: ChangedOutsideMark.make({ repositoryId: 'r2' }),
  sentence: '',
  setAt: '2026-10-09T08:00:00.000Z',
}

describe('Recent, from the missions opened last', () => {
  test('the rows keep the engine’s order: the last opened first', () => {
    const rows = recentRowsOf(
      [mission({ id: 'b', key: 'ACME-2' }), mission({ id: 'a', key: 'ACME-1' })],
      [],
      PROJECTS,
      NOW,
    )
    expect(rows.map((row) => row.missionKey)).toEqual(['ACME-2', 'ACME-1'])
  })

  test('a row says the Project, when it moved, the ball and the last event in words', () => {
    const [row] = recentRowsOf(
      [mission()],
      [tail('m12', 'Checks green after the second round')],
      PROJECTS,
      NOW,
    )
    expect(row).toMatchObject({
      id: 'm12',
      project: 'Acme',
      missionKey: 'ACME-12',
      title: 'Export invoices as CSV',
      when: '2 h',
      ball: 'agent',
      event: 'Checks green after the second round',
    })
  })

  test('a mission whose Journal is empty has no second line', () => {
    const [row] = recentRowsOf([mission()], [tail('m12', null)], PROJECTS, NOW)
    expect(row?.event).toBeUndefined()
  })

  test('a mark names its repository by its folder, as the Project knows it', () => {
    const [row] = recentRowsOf([mission({ marks: [outside] })], [], PROJECTS, NOW)
    expect(row?.marks).toEqual([{ kind: 'outside', repository: 'web' }])
  })

  test('a mission of a Project no longer listed is left out', () => {
    expect(recentRowsOf([mission({ projectId: 'gone' })], [], PROJECTS, NOW)).toEqual([])
  })
})

describe('When Home counts as looked at', () => {
  test('left unseen, nothing is marked: Home was never shown', () => {
    expect(leavesLooked(UNSEEN)).toBe(false)
  })

  test('shown while the window had the focus, Home is looked at when the user leaves it', () => {
    const shown = sightAfter(sightAfter(UNSEEN, { focused: true }), { shown: true })
    expect(leavesLooked(shown)).toBe(true)
  })

  test('shown in a window without the focus, Home is not looked at', () => {
    expect(leavesLooked(sightAfter(UNSEEN, { shown: true }))).toBe(false)
  })

  test('the focus coming back while Home is shown counts, and losing it again does not undo it', () => {
    const shown = sightAfter(sightAfter(UNSEEN, { shown: true }), { focused: true })
    expect(leavesLooked(sightAfter(shown, { focused: false }))).toBe(true)
  })

  test('the focus alone, with Home still on its way, counts for nothing', () => {
    expect(leavesLooked(sightAfter(UNSEEN, { focused: true }))).toBe(false)
  })
})
