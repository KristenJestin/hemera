/** A mission's page: the header the model decides, the base each stage owns, the views over it. */

import {
  AgentWorking,
  DecisionFields,
  MissionOwner,
  OutdatedMark,
  markIdentity,
} from '@hemera/core/domain'
import type { FreezeReadiness, Mission, Need } from '@hemera/ipc'
import { AT_BASE, type MissionFrameState } from '@hemera/ui'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { MissionPage, MissionRoute, type MissionPageProps } from '../src/renderer/mission-route.tsx'
import { MISSION_VIEWS, STAGE_PAGES, type StagePageProps } from '../src/renderer/stage-pages.tsx'
import { SILENT_LINK } from './fake-link.ts'

const NOW = new Date('2026-10-05T09:04:00.000Z')

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

const ready = (value: boolean): FreezeReadiness => ({
  ready: value,
  unsettled: [],
  freshness: { readVersion: 1, specVersion: 1, changes: [] },
  dependencies: [],
})

const none = (): undefined => undefined

const pageOf = (more: Partial<MissionPageProps> = {}): MissionPageProps => ({
  link: SILENT_LINK,
  engineReady: true,
  mission: mission(),
  project: null,
  readiness: null,
  now: NOW,
  frame: AT_BASE,
  actions: {
    open: none,
    show: none,
    close: none,
    goProject: none,
    goMission: none,
    answer: none,
    recheck: none,
    openSettings: none,
  },
  freeze: none,
  cancel: none,
  ...more,
})

const drawn = (more: Partial<MissionPageProps> = {}): string =>
  renderToStaticMarkup(createElement(MissionPage, pageOf(more)))

describe('A mission’s page before the engine has answered', () => {
  test('draws nothing while the Project’s missions are being read', () => {
    expect(
      renderToStaticMarkup(
        createElement(MissionRoute, {
          ...pageOf(),
          projectId: 'acme',
          missionKey: 'ACME-14',
        }),
      ),
    ).toBe('')
  })
})

describe('The header of a mission', () => {
  test('puts the key, the title, the type and the stage track', () => {
    const markup = drawn()
    expect(markup).toMatch(/<h1[^>]*>An audit log of who read what<\/h1>/)
    expect(markup).toContain('ACME-14')
    expect(markup).toMatch(/aria-label="Stage"/)
    expect(markup).toMatch(/aria-current="step"[^>]*>.*Planning/)
    expect(markup).toMatch(/capitalize[^>]*>feature</)
  })

  test('says the round in Building and Review', () => {
    expect(drawn({ mission: mission({ stage: 'building', round: 2, frozen: true }) })).toContain(
      'Building · round 2',
    )
    expect(drawn({ mission: mission({ stage: 'review', round: 1, frozen: true }) })).toContain(
      'Review · round 1',
    )
  })

  test('shows the frozen lock from Ready on, even if the flag was not read yet', () => {
    expect(drawn({ mission: mission({ stage: 'ready', frozen: false }) })).toContain(
      'aria-label="Spec frozen"',
    )
    expect(drawn()).not.toContain('aria-label="Spec frozen"')
  })

  test('offers Freeze only once the engine says it is ready', () => {
    expect(drawn({ readiness: ready(true) })).toMatch(/<button[^>]*>Freeze<\/button>/)
    expect(drawn({ readiness: ready(false) })).not.toContain('Freeze')
    expect(drawn({ readiness: null })).not.toContain('Freeze')
    expect(drawn({ mission: mission({ stage: 'ready' }), readiness: ready(true) })).not.toContain(
      'Freeze',
    )
  })

  test('offers Cancel before Done, and not at Done or Cancelled', () => {
    expect(drawn()).toMatch(/<button[^>]*>Cancel<\/button>/)
    expect(drawn({ mission: mission({ stage: 'done' }) })).not.toMatch(/>Cancel</)
    expect(drawn({ mission: mission({ stage: 'cancelled' }) })).not.toMatch(/>Cancel</)
  })

  test('hides the Spec link while no Spec view is registered, shows it when one is', () => {
    expect(drawn()).not.toMatch(/>Spec</)
    const spec = { ...MISSION_VIEWS, spec: MISSION_VIEWS.difference }
    expect(drawn({ views: spec })).toMatch(/Spec<\/span>/)
  })

  test('says why a Freeze or Cancel was refused', () => {
    expect(drawn({ notice: 'The Spec changed since you read it.' })).toMatch(
      /role="alert"[^>]*>The Spec changed since you read it\./,
    )
  })
})

describe('The needs at the top', () => {
  test('are listed under Needs you, with the mission’s key', () => {
    const markup = drawn({
      mission: mission({
        stage: 'building',
        frozen: true,
        needs: [need('n1', 'Who may read the audit log?'), need('n2', 'How long is the log kept?')],
      }),
    })
    expect(markup).toMatch(/aria-label="Needs you"/)
    expect(markup).toContain('Who may read the audit log?')
    expect(markup).toContain('How long is the log kept?')
  })

  test('are not drawn when nothing waits', () => {
    expect(drawn()).not.toContain('Needs you')
  })
})

describe('The base of each stage', () => {
  test('is the empty base with the stage’s name when no page is registered', () => {
    expect(STAGE_PAGES.Building).toBeUndefined()
    expect(drawn({ mission: mission({ stage: 'building' }) })).toContain('The Building page')
  })

  test('is the registered page of the stage, given the mission', () => {
    const pages = {
      Planning: ({ mission: shown, frame }: StagePageProps): ReactNode =>
        frame({ base: createElement('p', null, `Planning page of ${shown.key}`) }),
    }
    const markup = drawn({ pages })
    expect(markup).toContain('Planning page of ACME-14')
    expect(markup).not.toContain('The Planning page')
    expect(markup).toMatch(/<h1[^>]*>An audit log of who read what<\/h1>/)
    expect(drawn({ pages, mission: mission({ stage: 'ready' }) })).toContain('The Ready page')
  })

  test('Planning has its page', () => {
    expect(STAGE_PAGES.Planning).toBeDefined()
  })

  test('a page adds its views over itself and its Now line', () => {
    const pages = {
      Planning: ({ frame }: StagePageProps): ReactNode =>
        frame({
          base: createElement('p', null, 'The Spec'),
          views: [
            {
              id: 'probe:p1',
              title: 'Probe #1',
              icon: null,
              width: 'narrow',
              body: createElement('p', null, 'What Probe #1 found'),
            },
          ],
          now: 'Writing the requirements',
        }),
    }
    const frame: MissionFrameState = { open: ['probe:p1'], shown: 'probe:p1' }
    const markup = drawn({ pages, frame })
    expect(markup).toContain('What Probe #1 found')
    expect(markup).toMatch(/data-base=""[^>]*inert/)
    expect(markup).toMatch(/data-now=""[^>]*>Writing the requirements</)
  })

  test('a page is told why its Freeze was refused, and may say why a gesture was', () => {
    let told: ReadonlyArray<string> | undefined
    const pages = {
      Planning: ({ frame, refused }: StagePageProps): ReactNode => {
        told = refused
        return frame({ base: null, notice: 'The mission is no longer in Planning.' })
      },
    }
    const markup = drawn({ pages, refused: ['The Spec changed since you read it.'] })
    expect(told).toEqual(['The Spec changed since you read it.'])
    expect(markup).toMatch(/role="alert"[^>]*>The mission is no longer in Planning\./)
  })
})

describe('The views over the base', () => {
  const outdated = mission({
    stage: 'ready',
    frozen: true,
    marks: [
      {
        id: 'mark-1',
        mark: OutdatedMark.make({
          reason: 'ticket-changed',
          reference: 'acme/shop#38',
          difference: 'A second acceptance line',
        }),
        sentence: '',
        setAt: '2026-10-05T09:00:00.000Z',
      },
    ],
  })

  test('the outdated mark opens what changed', () => {
    expect(markIdentity(outdated.marks[0]!.mark)).toContain('outdated')
    expect(drawn({ mission: outdated })).toMatch(/<button[^>]*>What changed<\/button>/)
  })

  test('a view open is a sheet over the base, which is out of reach', () => {
    const frame: MissionFrameState = { open: ['difference'], shown: 'difference' }
    const markup = drawn({ mission: outdated, frame })
    expect(markup).toContain('A second acceptance line')
    expect(markup).toMatch(/data-base=""[^>]*inert/)
  })

  test('a view the registry does not know is not shown', () => {
    const frame: MissionFrameState = { open: ['task:T1'], shown: 'task:T1' }
    expect(drawn({ frame })).not.toMatch(/data-base=""[^>]*inert/)
  })
})
