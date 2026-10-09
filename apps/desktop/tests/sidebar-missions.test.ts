/** The missions under an open Project in the sidebar: by stage, two lines each. */

import { AgentWorking, ApplicationOwner, DecisionFields, WaitingOnYou } from '@hemera/core/domain'
import type { Mission, Need } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { lineOf } from '../src/renderer/missions.ts'
import { sidebarGroupsOf } from '../src/renderer/project-lines.ts'
import { SidebarMissionList, SidebarMissions } from '../src/renderer/sidebar-missions.tsx'
import { SILENT_LINK } from './fake-link.ts'

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

const lines = [
  lineOf(mission({ id: 'a', key: 'ACME-1', stage: 'done', ball: null }), (id) => id),
  lineOf(mission({ id: 'b', key: 'ACME-2', stage: 'cancelled', ball: null }), (id) => id),
  lineOf(
    mission({
      id: 'c',
      key: 'ACME-3',
      stage: 'review',
      ball: WaitingOnYou.make({}),
      needs: [aNeed],
    }),
    (id) => id,
  ),
  lineOf(mission({ id: 'd', key: 'ACME-4', stage: 'building' }), (id) => id),
]

describe('The stages under a Project in the sidebar', () => {
  test('in the order of the page, the empty ones left out', () => {
    expect(sidebarGroupsOf(lines, new Map()).map((group) => group.stage)).toEqual([
      'Review',
      'Building',
      'Done',
      'Cancelled',
    ])
  })

  test('Done and Cancelled start folded, the others open', () => {
    expect(sidebarGroupsOf(lines, new Map()).map((group) => group.folded)).toEqual([
      false,
      false,
      true,
      true,
    ])
  })

  test('a row has the key, the title, the ball, the last event and whether the user is called', () => {
    const review = sidebarGroupsOf(lines, new Map([['c', 'Round 1 addressed']]))[0]
    expect(review?.count).toBe(1)
    expect(review?.rows[0]).toEqual({
      missionKey: 'ACME-3',
      title: 'Export invoices as CSV',
      ball: 'you',
      event: 'Round 1 addressed',
      needsYou: true,
    })
  })

  test('a mission that moves stage moves group', () => {
    const moved = [lineOf(mission({ id: 'c', key: 'ACME-3', stage: 'ready' }), (id) => id)]
    expect(sidebarGroupsOf(moved, new Map()).map((group) => group.stage)).toEqual(['Ready'])
  })
})

describe('The sidebar’s list', () => {
  const list = (current: Parameters<typeof SidebarMissionList>[0]['current']): string =>
    renderToStaticMarkup(
      createElement(SidebarMissionList, {
        lines,
        events: new Map([['d', 'T3 done in api']]),
        current,
        onOpenMission: () => undefined,
      }),
    )

  test('each stage is a group, the open ones with their rows and the folded ones without', () => {
    const markup = list({ kind: 'home' })
    expect(markup).toContain('aria-label="Review"')
    expect(markup).toContain('ACME-4')
    expect(markup).toContain('T3 done in api')
    expect(markup).toContain('aria-label="Needs you"')
    expect(markup).not.toContain('ACME-1<')
  })

  test('the mission the window is on is the current place', () => {
    expect(list({ kind: 'mission', key: 'ACME-4' })).toContain('aria-current="page"')
    expect(list({ kind: 'home' })).not.toContain('aria-current="page"')
  })

  test('before the missions are read, nothing is drawn', () => {
    expect(
      renderToStaticMarkup(
        createElement(SidebarMissions, {
          link: SILENT_LINK,
          engineReady: true,
          projectId: 'acme',
          current: { kind: 'home' },
          onOpenMission: () => undefined,
        }),
      ),
    ).toBe('')
  })
})
