/** The setup agent's cards (#44) as the new-Project page draws them (#53): one card per kind. */

import type { SetupCard } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import type { Route } from '../src/renderer/navigation.ts'
import {
  nothingProposed,
  pendingOf,
  setupAgentOf,
  setupEntriesOf,
  startSetup,
} from '../src/renderer/setup-cards.ts'

const card = (
  id: string,
  change: SetupCard['change'],
  more: Partial<SetupCard> = {},
): SetupCard => ({
  id,
  projectId: 'acme',
  batch: 'b1',
  change,
  title: id,
  details: [],
  state: 'pending',
  refusal: null,
  createdAt: `2026-10-06T16:00:0${id.length}.000Z`,
  decidedAt: null,
  ...more,
})

const CARDS: SetupCard[] = [
  card('r1', { kind: 'repository', path: 'shared', remote: 'origin', baseBranch: 'main' }),
  card('c1', {
    kind: 'command',
    name: 'api: test',
    type: 'test',
    line: 'npm test',
    check: true,
    replaces: false,
  }),
  card(
    'c2',
    { kind: 'command', name: 'web: dev', type: 'serve', line: 'npm run dev', replaces: false },
    {
      state: 'accepted',
    },
  ),
  card('v1', { kind: 'variable', name: 'ACME_REGION', replaces: false }, { state: 'declined' }),
  card(
    's1',
    { kind: 'step', step: 'copy', path: 'web/.env.example' },
    {
      refusal: 'web/.env.example is not declared',
    },
  ),
]

describe('The cards of a new Project', () => {
  test('one per kind proposed, in the settings’ order, each with what it proposes', () => {
    const entries = setupEntriesOf(CARDS)
    expect(entries.map((entry) => entry.kind)).toEqual([
      'repositories',
      'commands',
      'preparation',
      'variables',
    ])
    expect(entries[0]?.proposal).toEqual({
      kind: 'repositories',
      items: [{ id: 'r1', path: 'shared', base: 'origin/main' }],
    })
    expect(entries[1]?.proposal).toMatchObject({
      kind: 'commands',
      items: [
        {
          id: 'c1',
          name: 'api: test',
          type: 'test',
          line: 'npm test',
          check: true,
          service: false,
        },
        { id: 'c2', name: 'web: dev', type: 'serve', service: true },
      ],
    })
    expect(entries[2]?.proposal).toEqual({
      kind: 'preparation',
      items: [{ id: 's1', kind: 'copy', place: '.', what: 'web/.env.example' }],
    })
    expect(entries[3]?.proposal).toEqual({
      kind: 'variables',
      items: [{ id: 'v1', key: 'ACME_REGION', value: '' }],
    })
  })

  test('a kind with a change waiting is proposed, with the last refusal; else accepted or declined', () => {
    const [repositories, commands, preparation, variables] = setupEntriesOf(CARDS)
    expect(repositories?.status).toEqual({ state: 'proposed', refused: undefined })
    expect(commands?.status).toEqual({ state: 'proposed', refused: undefined })
    expect(preparation?.status).toEqual({
      state: 'proposed',
      refused: 'web/.env.example is not declared',
    })
    expect(variables?.status).toEqual({ state: 'declined' })
    const served = card(
      'c2',
      { kind: 'command', name: 'web: dev', type: 'serve', line: 'npm run dev', replaces: false },
      { state: 'accepted' },
    )
    expect(setupEntriesOf([served])[0]?.status).toEqual({ state: 'accepted' })
  })

  test('the cards a kind’s Accept or Decline goes to: its changes still waiting, in order', () => {
    expect(pendingOf(CARDS, 'commands').map((one) => one.id)).toEqual(['c1'])
    expect(pendingOf(CARDS, 'variables')).toEqual([])
  })
})

describe('The setup agent, as the page’s header says it', () => {
  test('waiting, working, done or failed; nothing asked yet reads as done', () => {
    expect(setupAgentOf({ state: 'waiting', sentence: 'waiting for a free slot' })).toBe('waiting')
    expect(setupAgentOf({ state: 'working', sentence: null })).toBe('working')
    expect(setupAgentOf({ state: 'failed', sentence: 'interrupted by a restart' })).toBe('failed')
    expect(setupAgentOf({ state: 'none', sentence: null })).toBe('done')
  })
})

describe('A new Project’s setup, from the dialog that adds it', () => {
  test('the proposal is asked for, then its page opens', async () => {
    const asked: string[] = []
    const gone: Route[] = []
    await startSetup(
      async (projectId) => {
        asked.push(projectId)
        // The page opens only once the engine has the proposal under way.
        expect(gone).toEqual([])
      },
      'acme',
      (route) => gone.push(route),
    )
    expect(asked).toEqual(['acme'])
    expect(gone).toEqual([{ kind: 'projectSetup', id: 'acme' }])
  })

  test('a proposal the engine refuses leads to the Project’s page', async () => {
    const gone: Route[] = []
    await startSetup(
      () => Promise.reject(new Error('The setup agent is not available.')),
      'acme',
      (route) => gone.push(route),
    )
    expect(gone).toEqual([{ kind: 'project', id: 'acme' }])
  })

  test('an agent done with nothing proposed has nothing to answer; one never asked is not done', () => {
    expect(nothingProposed({ state: 'done', sentence: null }, [])).toBe(true)
    expect(nothingProposed({ state: 'done', sentence: null }, CARDS)).toBe(false)
    expect(nothingProposed({ state: 'none', sentence: null }, [])).toBe(false)
    expect(nothingProposed({ state: 'working', sentence: null }, [])).toBe(false)
  })
})
