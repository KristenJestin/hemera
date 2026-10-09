/**
 * The Project page as the window feeds it: the missions grouped by stage with the words of each
 * row, the card of the living spec, the Chats of the rail.
 */

import { AgentWorking, WaitingOnYou } from '@hemera/core/domain'
import type { ChatSummary, JournalTail, LivingDomain, Mission, Project } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { lineOf, type MissionLine } from '../src/renderer/missions.ts'
import { chatRowsOf, eventsOf, groupsOf, livingSpecOf } from '../src/renderer/project-lines.ts'
import { ProjectRoute } from '../src/renderer/project-route.tsx'
import { SILENT_LINK } from './fake-link.ts'

const NOW = new Date('2026-10-05T12:00:00.000Z')

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

const line = (more: Partial<Mission> = {}): MissionLine => lineOf(mission(more), (id) => id)

const tail = (missionId: string, text: string | null): JournalTail => ({
  missionId,
  line: text === null ? null : { at: '2026-10-05T09:02:00.000Z', text },
})

describe('The missions of a Project page, grouped by stage', () => {
  const lines = [
    line({ id: 'a', key: 'ACME-1', stage: 'done', ball: null }),
    line({ id: 'b', key: 'ACME-2', stage: 'planning', ball: WaitingOnYou.make({}) }),
    line({ id: 'c', key: 'ACME-3', stage: 'building' }),
    line({ id: 'd', key: 'ACME-4', stage: 'shipping' }),
  ]

  test('the stages come in the order of the page, Done last, the empty ones left out', () => {
    expect(groupsOf(lines, new Map(), NOW).map((group) => group.stage)).toEqual([
      'Shipping',
      'Building',
      'Planning',
      'Done',
    ])
  })

  test('a row says the key, the title, when it moved and who has the ball', () => {
    const [shipping] = groupsOf(lines, new Map(), NOW)
    expect(shipping?.rows[0]).toMatchObject({
      missionKey: 'ACME-4',
      title: 'Export invoices as CSV',
      when: '3 h',
      ball: 'agent',
    })
  })

  test('a mission that waits on the user has the ball of the user', () => {
    const planning = groupsOf(
      [line({ id: 'b', stage: 'planning', ball: WaitingOnYou.make({}), needs: [] })],
      new Map(),
      NOW,
    )[0]
    expect(planning?.rows[0]?.ball).toBe('you')
  })

  test('the last event of the mission is the row’s second line', () => {
    const events = eventsOf([tail('c', 'T3 done in api'), tail('d', null)])
    const groups = groupsOf(lines, events, NOW)
    const building = groups.find((group) => group.stage === 'Building')
    const shipping = groups.find((group) => group.stage === 'Shipping')
    expect(building?.rows[0]?.event).toBe('T3 done in api')
    expect(shipping?.rows[0]?.event).toBeUndefined()
  })

  test('a mission that moves stage moves group', () => {
    const before = groupsOf([line({ id: 'c', key: 'ACME-3', stage: 'planning' })], new Map(), NOW)
    const after = groupsOf([line({ id: 'c', key: 'ACME-3', stage: 'ready' })], new Map(), NOW)
    expect(before.map((group) => group.stage)).toEqual(['Planning'])
    expect(after.map((group) => group.stage)).toEqual(['Ready'])
    expect(after[0]?.rows.map((row) => row.missionKey)).toEqual(['ACME-3'])
  })

  test('inside a stage the newest comes first', () => {
    const groups = groupsOf(
      [
        line({ id: 'a', key: 'ACME-1', updatedAt: '2026-10-05T07:00:00.000Z' }),
        line({ id: 'b', key: 'ACME-2', updatedAt: '2026-10-05T09:00:00.000Z' }),
      ],
      new Map(),
      NOW,
    )
    expect(groups[0]?.rows.map((row) => row.missionKey)).toEqual(['ACME-2', 'ACME-1'])
  })
})

describe('The last event of each mission', () => {
  test('a mission with no line in its Journal has no event', () => {
    expect([...eventsOf([tail('a', null)]).keys()]).toEqual([])
  })

  test('the text of the last line is the event, keyed by the mission', () => {
    expect(eventsOf([tail('a', 'Round 1 addressed')]).get('a')).toBe('Round 1 addressed')
  })
})

const domain = (more: Partial<LivingDomain> = {}): LivingDomain => ({
  id: 'billing',
  projectId: 'acme',
  name: 'Billing',
  summary: 'Invoices and payments',
  uncertainty: '',
  state: 'validated',
  validatedAt: '2026-10-03T09:00:00.000Z',
  proposed: 0,
  validated: 4,
  pending: 0,
  lastChange: '2026-10-04T09:00:00.000Z',
  ...more,
})

describe('The living spec card', () => {
  test('no domain yet is no card', () => {
    expect(livingSpecOf([], NOW)).toBeNull()
  })

  test('the domains by name, and how many, with when the latest changed', () => {
    const card = livingSpecOf(
      [
        domain(),
        domain({ id: 'exports', name: 'Exports', lastChange: '2026-10-05T11:30:00.000Z' }),
      ],
      NOW,
    )
    expect(card?.about).toBe('2 domains · updated 30 min ago')
    expect(card?.domains.map((one) => one.name)).toEqual(['Billing', 'Exports'])
  })

  test('one domain is said in the singular, and a change yesterday says yesterday', () => {
    expect(livingSpecOf([domain()], NOW)?.about).toBe('1 domain · updated yesterday')
  })

  test('a domain waits for the user while it is proposed or a re-run proposes a change', () => {
    const card = livingSpecOf(
      [
        domain({ id: 'a', name: 'A', state: 'proposed' }),
        domain({ id: 'b', name: 'B', pending: 2 }),
        domain({ id: 'c', name: 'C' }),
      ],
      NOW,
    )
    expect(card?.domains.map((one) => one.waiting)).toEqual([true, true, false])
  })
})

const chat = (id: string, lastActivityAt: string): ChatSummary => ({
  id,
  projectId: 'acme',
  title: `Chat ${id}`,
  setting: { agent: 'claude', model: null, effort: null },
  createdAt: '2026-10-01T08:00:00.000Z',
  lastActivityAt,
  working: false,
})

describe('The Chats of the rail', () => {
  test('the latest first, each with when it last moved', () => {
    expect(
      chatRowsOf(
        [chat('old', '2026-10-04T09:00:00.000Z'), chat('new', '2026-10-05T11:56:00.000Z')],
        NOW,
      ),
    ).toEqual([
      { id: 'new', title: 'Chat new', when: '4 min' },
      { id: 'old', title: 'Chat old', when: 'yesterday' },
    ])
  })
})

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [],
}

const drawn = (state: Parameters<typeof ProjectRoute>[0]['state']): string =>
  renderToStaticMarkup(
    createElement(ProjectRoute, {
      link: SILENT_LINK,
      engineReady: true,
      id: 'acme',
      state,
      fallback: 'Acme',
      now: NOW,
      actions: {
        openSettings: () => undefined,
        retry: () => undefined,
        openMission: () => undefined,
        openChat: () => undefined,
        openLivingSpec: () => undefined,
      },
    }),
  )

describe('The Project route', () => {
  test('while the Project and its missions are read, the rows are drawn as their own shape', () => {
    const markup = drawn({ kind: 'loading' })
    expect(markup).toContain('data-row-skeleton')
    expect(markup).toContain('About Acme')
  })

  test('a Project that could not be read says so, in the engine’s words', () => {
    expect(drawn({ kind: 'failed', sentence: 'The profile is locked.' })).toContain(
      'The profile is locked.',
    )
  })

  test('the rail holds the living spec and the Chats, and the gear opens the settings', () => {
    const markup = drawn({ kind: 'ready', project: ACME })
    expect(markup).toContain('Living spec')
    expect(markup).toContain('Chats')
    expect(markup).toContain('Settings of Acme')
  })
})
