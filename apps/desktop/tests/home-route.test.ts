/** Home as the window feeds it: the lists from what was read, and the page it draws. */

import { AgentWorking } from '@hemera/core/domain'
import type { Mission, OpenQuestion, Project } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import {
  NO_HOME_DATA,
  HomeBody,
  HomeRoute,
  homeViewOf,
  type HomeData,
  type HomeRouteProps,
} from '../src/renderer/home-route.tsx'
import { SILENT_LINK } from './fake-link.ts'

const NOW = new Date('2026-10-09T09:00:00.000Z')
const nothing = (): void => undefined

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

const mission: Mission = {
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
}

const question: OpenQuestion = {
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
}

const props = (more: Partial<HomeRouteProps> = {}): HomeRouteProps => ({
  link: SILENT_LINK,
  engineReady: true,
  today: 'Friday 9 October',
  now: NOW,
  projects: { kind: 'ready', projects: [ACME] },
  needs: { kind: 'ready', needs: [], missions: new Map(), answers: new Map() },
  focus: {},
  firstLaunch: createElement('p', null, 'Welcome'),
  actions: {
    answer: nothing,
    recheck: nothing,
    openSettings: nothing,
    addProject: nothing,
    retry: nothing,
    openMission: nothing,
  },
  ...more,
})

const READ: HomeData = {
  questions: [question],
  since: {
    first: {
      groups: [
        {
          projectId: 'acme',
          missionId: 'm12',
          missionKey: 'ACME-12',
          title: 'Export invoices as CSV',
          ball: null,
          events: [
            {
              sequence: 4,
              tone: 'failed',
              text: 'T3 failed in api',
              at: '2026-10-09T02:14:00.000Z',
            },
          ],
        },
      ],
      before: 3,
    },
    older: [],
    loadingMore: false,
  },
  recent: { missions: [mission], tails: [] },
  failure: undefined,
}

const pageOf = (data: HomeData, more: Partial<HomeRouteProps> = {}) => {
  const view = homeViewOf(props(more), data, nothing)
  if (view.kind !== 'page') throw new Error('expected the page')
  return view.page
}

describe('Home, from what the engine answered', () => {
  test('nothing read yet, the lists are on their way and the needs are not held back', () => {
    const page = pageOf(NO_HOME_DATA)
    expect(page.reading).toBe(true)
    expect(page.loading).toBe(false)
  })

  test('each list waits for its own read: one missing keeps the lists on their way', () => {
    expect(pageOf({ ...READ, recent: null }).reading).toBe(true)
    expect(pageOf({ ...READ, questions: null }).reading).toBe(true)
    expect(pageOf({ ...READ, since: { ...READ.since, first: null } }).reading).toBe(true)
    expect(pageOf(READ).reading).toBe(false)
  })

  test('the Projects or the needs on their way hold the whole page back', () => {
    expect(pageOf(READ, { projects: { kind: 'loading' } }).loading).toBe(true)
    expect(pageOf(READ, { needs: { kind: 'loading' } }).loading).toBe(true)
  })

  test('the questions, the cards and Recent are what the model made of the reads', () => {
    const page = pageOf(READ)
    expect(page.questions.map((row) => row.title)).toEqual(['Who may read the audit log?'])
    expect(page.since.groups.map((one) => one.missionKey)).toEqual(['ACME-12'])
    expect(page.recent.map((row) => row.missionKey)).toEqual(['ACME-12'])
  })

  test('an older page can be asked for while the last read still has a cursor', () => {
    expect(pageOf(READ).since.more).toBe(true)
    const done = { ...READ, since: { ...READ.since, first: { groups: [], before: null } } }
    expect(pageOf(done).since.more).toBe(false)
  })

  test('the page says when an older one is on its way', () => {
    const reading = { ...READ, since: { ...READ.since, loadingMore: true } }
    expect(pageOf(reading).since.loadingMore).toBe(true)
  })

  test('a list that could not be read is said in words, in place of Home', () => {
    expect(pageOf({ ...READ, failure: 'The engine did not answer.' }).error).toBe(
      'The engine did not answer.',
    )
  })

  test('a Project that could not be listed is said before a list that could not be read', () => {
    const page = pageOf(
      { ...READ, failure: 'A list failed.' },
      { projects: { kind: 'failed', sentence: 'The Projects failed.' } },
    )
    expect(page.error).toBe('The Projects failed.')
  })

  test('with no Project and nothing waiting, Home is the first launch', () => {
    const view = homeViewOf(props({ projects: { kind: 'ready', projects: [] } }), READ, nothing)
    expect(view.kind).toBe('firstLaunch')
  })
})

describe('The Home route, drawn', () => {
  test('before anything is read, the cards and rows are drawn as their shapes', () => {
    const markup = renderToStaticMarkup(createElement(HomeRoute, props({ engineReady: false })))
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('data-row-skeleton')
    expect(markup).not.toContain('All quiet')
  })

  test('once read, Since you left leads and Recent follows', () => {
    const markup = renderToStaticMarkup(
      createElement(HomeBody, { ...props(), data: READ, onMore: nothing }),
    )
    expect(markup.indexOf('Since you left')).toBeLessThan(markup.indexOf('Recent'))
    expect(markup).toContain('T3 failed in api')
    expect(markup).toContain('Who may read the audit log?')
  })

  test('nothing waiting and nothing happened is one quiet state', () => {
    const quiet: HomeData = {
      questions: [],
      since: { first: { groups: [], before: null }, older: [], loadingMore: false },
      recent: { missions: [], tails: [] },
      failure: undefined,
    }
    const markup = renderToStaticMarkup(
      createElement(HomeBody, { ...props(), data: quiet, onMore: nothing }),
    )
    expect(markup).toContain('All quiet')
    expect(markup).not.toContain('aria-label="Questions"')
  })
})
