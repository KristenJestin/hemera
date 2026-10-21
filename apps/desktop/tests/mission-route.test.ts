/** A mission's page: the header the model decides, the base each stage owns, the views over it. */

import {
  AgentWorking,
  DecisionFields,
  MissionOwner,
  PermissionFields,
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

const permission = (id: string, call: string): Need => ({
  ...need(id, ''),
  fields: PermissionFields.make({
    call,
    agentReason: 'To see whether a slash in a title breaks the export today.',
    hemeraReason: 'Tests of api write to a database: the setting asks first.',
    sensitive: false,
  }),
  choices: ['allow-once', 'allow-for-mission', 'deny'],
  requestedBy: 'probe',
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
    openChat: none,
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

  test('Freeze is the Planning page’s: in the head where it puts it, with the line under it', () => {
    let told: StagePageProps['readiness'] = null
    const pages = {
      Planning: ({ frame, readiness }: StagePageProps): ReactNode => {
        told = readiness
        return frame({
          base: null,
          action: createElement('button', { type: 'button', disabled: true }, 'Freeze'),
          actionNote: createElement('p', null, 'The cold read is reading the Spec'),
        })
      },
    }
    const markup = drawn({ pages, readiness: ready(false) })
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Freeze<\/button>/)
    expect(markup).toContain('The cold read is reading the Spec')
    expect(told).toEqual(ready(false))
  })

  test('the head offers no Freeze of its own, ready or not', () => {
    expect(drawn({ readiness: ready(true) })).not.toContain('Freeze')
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

describe('An agent Hemera started before its last restart, still running (#320)', () => {
  const kept = [
    { program: 'claude', pid: 48213 },
    { program: 'codex', pid: 48377 },
  ]

  test('is one chip per agent where the stage card stands, and nothing in the header', () => {
    const markup = drawn({ mission: mission({ stage: 'building', frozen: true }), kept })
    expect(markup).toContain('claude · pid 48213')
    expect(markup).toContain('codex · pid 48377')
    expect(markup).not.toContain('data-mark="kept"')
    expect(markup).not.toContain('Earlier claude')
  })

  test('is handed to the stage’s page, whose card shows it', () => {
    const pages = {
      Planning: ({ kept: handed, frame }: StagePageProps): ReactNode =>
        frame({
          base: createElement(
            'p',
            null,
            handed.map((agent) => `${agent.program} ${String(agent.pid)}`).join(', '),
          ),
        }),
    }
    expect(drawn({ pages, kept })).toContain('claude 48213, codex 48377')
  })

  test('is not shown once none is kept', () => {
    expect(drawn({ mission: mission({ stage: 'building' }), kept: [] })).not.toContain('pid ')
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
    expect(STAGE_PAGES.Shipping).toBeUndefined()
    expect(drawn({ mission: mission({ stage: 'shipping', frozen: true }) })).toContain(
      'The Shipping page',
    )
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

  test('Review has its page: its rows wait in their shape while the Review is read', () => {
    expect(STAGE_PAGES.Review).toBeDefined()
    const markup = drawn({ mission: mission({ stage: 'review', frozen: true }) })
    expect(markup).toContain('data-stage="review"')
    expect(markup).not.toContain('The Review page')
  })

  test('Ready has its page: the frozen Spec is read first, and nothing launches meanwhile', () => {
    const markup = drawn({ mission: mission({ stage: 'ready', frozen: true }) })
    expect(markup).toContain('Reading the frozen Spec')
    expect(markup).not.toContain('The Ready page')
    expect(markup).not.toContain('>Launch<')
  })

  test('Building has its page: rows of its shape while it is read', () => {
    const markup = drawn({ mission: mission({ stage: 'building', frozen: true }) })
    expect(markup).toContain('data-stage="building"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Reading where Building stands')
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

describe('The diff of a mission (#497)', () => {
  test('is offered in the mission’s `…` from Building on, never before its Workspace', () => {
    expect(drawn({ mission: mission({ stage: 'building', round: 1, frozen: true }) })).toContain(
      'aria-label="More for ACME-14"',
    )
    expect(drawn({ mission: mission({ stage: 'done', round: 1, frozen: true }) })).toContain(
      'aria-label="More for ACME-14"',
    )
    expect(drawn()).not.toContain('aria-label="More for ACME-14"')
    expect(drawn({ mission: mission({ stage: 'ready', frozen: true }) })).not.toContain(
      'aria-label="More for ACME-14"',
    )
  })

  test('opens as a wide sheet over the base, its layout in its head, its files while they are read', () => {
    const frame: MissionFrameState = { open: ['diff'], shown: 'diff' }
    const markup = drawn({ mission: mission({ stage: 'review', round: 1, frozen: true }), frame })
    expect(markup).toMatch(/data-base=""[^>]*inert/)
    expect(markup).toContain('aria-label="Layout of the diff"')
    expect(markup).toMatch(
      /aria-busy="true"[^>]*aria-label="The diff"|aria-label="The diff"[^>]*aria-busy="true"/,
    )
  })

  test('wears the live mark while a round writes it', () => {
    const frame: MissionFrameState = { open: ['diff'], shown: 'diff' }
    const markup = drawn({ mission: mission({ stage: 'building', round: 2, frozen: true }), frame })
    expect(markup).toContain('Live: round 2 is writing these files')
  })
})

describe('The needs of a mission in Planning', () => {
  const waiting = [
    permission('n1', 'pnpm --filter api test notes-export'),
    need('n2', 'Who may read the audit log?'),
  ]

  test('are not drawn above the Spec: they are For you’s first line', () => {
    const markup = drawn({ mission: mission({ needs: waiting }) })
    expect(markup).not.toContain('<ul aria-label="Needs you"')
  })

  test('are handed to the Planning page, with what answers them', () => {
    let handed: StagePageProps['needs'] = { rows: [], on: () => ({}) }
    const pages = {
      Planning: ({ frame, needs }: StagePageProps): ReactNode => {
        handed = needs
        return frame({ base: null, needs: [] })
      },
    }
    drawn({ pages, mission: mission({ needs: waiting }) })
    expect(handed.rows.map((row) => row.id)).toEqual(['n1', 'n2'])
    expect(handed.on('n1').onPermission).toBeTypeOf('function')
  })

  test('another stage keeps them above its page', () => {
    const markup = drawn({ mission: mission({ stage: 'building', frozen: true, needs: waiting }) })
    expect(markup).toContain('<ul aria-label="Needs you"')
  })
})

describe('The head of a mission in Planning', () => {
  test('draws the ball without the face, and no Now line: the stage card says it', () => {
    const planning = drawn()
    expect(planning).toContain('data-ball="agent"')
    expect(planning).not.toContain('data-now=""')
    expect(drawn({ mission: mission({ stage: 'shipping', frozen: true }) })).not.toContain(
      'data-ball="agent"',
    )
  })

  test('on Ready, Building and Review too: their stage card draws the face', () => {
    for (const stage of ['ready', 'building', 'review'] as const) {
      expect(drawn({ mission: mission({ stage, frozen: true }) })).toContain('data-ball="agent"')
    }
  })
})
