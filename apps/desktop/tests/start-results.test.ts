/**
 * What the start field shows: the stream folded into results (the Project's missions, then the
 * tickets as they come, "Create a mission" last and replaced by a second one), what each choice
 * creates, and the mission started from a choice, which opens at once.
 */

import { CanonicalTicket, parseTicketReference } from '@hemera/core/domain'
import {
  CreateChoice,
  MissionFound,
  SearchNotice,
  TicketFound,
  type Mission,
  type StartResult,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  EMPTY_FOLD,
  createFromTicket,
  createOf,
  foldStart,
  searchPending,
  startAndOpen,
  viewsOf,
} from '../src/renderer/start-results.ts'

const mission = (more: Partial<Mission> = {}): Mission => ({
  id: 'm12',
  projectId: 'acme',
  key: 'ACME-12',
  title: 'Export invoices as CSV',
  idea: { sentence: 'Export invoices as CSV', ticket: null },
  type: 'feature',
  ticketLink: null,
  origin: null,
  stage: 'planning',
  round: 0,
  frozen: false,
  freeze: null,
  marks: [],
  ball: null,
  needs: [],
  cleanup: null,
  unstopped: [],
  triage: null,
  createdAt: '2026-10-05T09:00:00.000Z',
  updatedAt: '2026-10-05T09:00:00.000Z',
  ...more,
})

const found = (more: Partial<Mission> = {}, open = false): StartResult =>
  MissionFound.make({ mission: mission(more), open, last: null })

const reference = parseTicketReference('https://github.com/acme/shop/issues/41')
if (reference === null) throw new Error('the fixture reference is not read')

const ticket = (linkedMission: string | null = null): StartResult =>
  TicketFound.make({
    hit: {
      provider: 'github',
      reference,
      canonical: CanonicalTicket.make('github:github.com/acme/shop#41'),
      key: 'acme/shop#41',
      title: 'Export invoices as CSV',
      url: 'https://github.com/acme/shop/issues/41',
      status: { state: 'open', wording: 'Open' },
      updatedAt: '2026-10-05T09:00:00.000Z',
      linkedMission,
    },
  })

const create = (withTicket: boolean): StartResult =>
  CreateChoice.make({ title: 'export', ticket: withTicket ? reference : null })

const fold = (...results: StartResult[]) => results.reduce(foldStart, EMPTY_FOLD)

describe('the results of the start field', () => {
  test('draw the missions first, the tickets next and the create choice last', () => {
    const views = viewsOf(
      fold(found(), create(false), ticket(), found({ id: 'm9', key: 'ACME-9', stage: 'done' })),
    )
    expect(views.map((view) => view.kind)).toEqual(['mission', 'mission', 'ticket', 'create'])
    expect(views[1]).toMatchObject({ key: 'ACME-9', done: true, open: false })
  })

  test('keep the mission the text names marked open', () => {
    expect(viewsOf(fold(found({}, true)))[0]).toMatchObject({ open: true })
  })

  test('add a ticket as its provider answers, once per ticket', () => {
    const views = viewsOf(fold(create(false), ticket(), ticket('ACME-12')))
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ kind: 'ticket', linkedMission: 'ACME-12' })
  })

  test('replace the create choice by the second one', () => {
    const views = viewsOf(fold(create(true), create(false)))
    expect(views).toEqual([{ kind: 'create', title: 'export', ticket: null }])
  })

  test('say the ticket of the create choice with the key a provider gave it', () => {
    expect(viewsOf(fold(create(true), ticket()))).toContainEqual({
      kind: 'create',
      title: 'export',
      ticket: 'acme/shop#41',
    })
    expect(viewsOf(fold(create(true)))).toContainEqual({
      kind: 'create',
      title: 'export',
      ticket: 'github:github.com/acme/shop#41',
    })
  })

  test('keep the notice, the last one said', () => {
    expect(
      fold(
        SearchNotice.make({ sentence: 'First' }),
        SearchNotice.make({ sentence: 'GitHub did not answer.' }),
      ).notice,
    ).toBe('GitHub did not answer.')
  })
})

describe('what a choice creates', () => {
  test('is the sentence when the text is not a ticket', () => {
    expect(createOf('acme', 'export', fold(create(false)), 'k1')).toEqual({
      projectId: 'acme',
      text: 'export',
      idempotencyKey: 'k1',
    })
  })

  test('is the ticket, with the title a provider read, when the text is one', () => {
    expect(createOf('acme', 'acme/shop#41', fold(create(true), ticket()), 'k2')).toEqual({
      projectId: 'acme',
      ticket: { reference, title: 'Export invoices as CSV' },
      idempotencyKey: 'k2',
    })
  })

  test('is the ticket alone when no provider read it', () => {
    expect(createOf('acme', 'acme/shop#41', fold(create(true)), 'k3')).toEqual({
      projectId: 'acme',
      ticket: { reference },
      idempotencyKey: 'k3',
    })
  })

  test('is the ticket of a result chosen', () => {
    const hit = foldStart(EMPTY_FOLD, ticket()).tickets[0]?.hit
    if (hit === undefined) throw new Error('no ticket folded')
    expect(createFromTicket('acme', hit, 'k4')).toEqual({
      projectId: 'acme',
      ticket: { reference, title: 'Export invoices as CSV' },
      idempotencyKey: 'k4',
    })
  })
})

describe('whether the search for the text typed is still going', () => {
  const choice = foldStart(EMPTY_FOLD, CreateChoice.make({ title: 'export', ticket: null }))
  const search = (done: boolean, ended: string | null = null) => ({
    for: 'export',
    fold: choice,
    done,
    ended,
  })

  test('is going while the stream that emitted the create choice has not ended', () => {
    expect(searchPending(search(false), 'export')).toBe(true)
  })

  test('is over once the stream ended, or failed', () => {
    expect(searchPending(search(true), 'export')).toBe(false)
    expect(searchPending(search(false, 'The search stopped'), 'export')).toBe(false)
  })

  test('is going for a text nothing was said about yet', () => {
    expect(searchPending(null, 'export')).toBe(true)
    expect(searchPending(search(true), 'export invoices')).toBe(true)
  })
})

describe('a mission started from the field', () => {
  const made = createOf('acme', 'export invoices', EMPTY_FOLD, 'choice-1')

  test('opens at once, under its key, without waiting for the Planner', async () => {
    const asked: string[] = []
    const opened: string[] = []
    const refused: string[] = []
    await startAndOpen(
      {
        createStart: (request) => {
          asked.push(request.projectId)
          return Promise.resolve(mission())
        },
      },
      made,
      { opened: (key) => opened.push(key), refused: (sentence) => refused.push(sentence) },
    )
    expect(asked).toEqual(['acme'])
    expect(opened).toEqual(['ACME-12'])
    expect(refused).toEqual([])
  })

  test('opens nothing and says why when the engine refuses', async () => {
    const opened: string[] = []
    const refused: string[] = []
    await startAndOpen({ createStart: () => Promise.reject(new Error('no room')) }, made, {
      opened: (key) => opened.push(key),
      refused: (sentence) => refused.push(sentence),
    })
    expect(opened).toEqual([])
    expect(refused).toEqual(['The mission could not be started: no room'])
  })
})
