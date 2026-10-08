/** The setup agent's cards (#44) as the new-Project page draws them (#53): one card per kind. */

import type {
  AgentState,
  RoleModels,
  SessionSummary,
  SetupCard,
  SetupStanding,
  ThreadLine,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  agentTimesOf,
  answerSaid,
  latestSetupOf,
  pendingOf,
  setupAboutOf,
  setupAgentOf,
  setupEntriesOf,
  setupLauncher,
  setupOfferOf,
  setupOfferRead,
  setupIsTask,
  setupShownOf,
  setupTimesOf,
  setupMessagesOf,
  sinceLatestSetup,
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

describe('A repository the setup agent proposes', () => {
  test('says only the remote and the base branch the proposal gives', () => {
    const repositories = setupEntriesOf([
      card('r1', { kind: 'repository', path: 'api', remote: 'upstream', baseBranch: 'develop' }),
      card('r2', { kind: 'repository', path: 'web', baseBranch: 'develop' }),
      card('r3', { kind: 'repository', path: 'shared', remote: 'upstream' }),
      card('r4', { kind: 'repository', path: 'billing' }),
    ])[0]?.proposal
    expect(repositories).toEqual({
      kind: 'repositories',
      items: [
        { id: 'r1', path: 'api', base: 'upstream/develop' },
        { id: 'r2', path: 'web', base: 'develop' },
        { id: 'r3', path: 'shared', base: 'upstream' },
        { id: 'r4', path: 'billing', base: '' },
      ],
    })
  })
})

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

describe('A setup launched again', () => {
  const session = (id: string, role: string, createdAt: string): SessionSummary => ({
    id,
    provider: 'claude',
    role,
    lineage: id,
    parent: null,
    depth: 0,
    epoch: 0,
    state: 'ended',
    stateReason: null,
    createdAt,
    endedAt: null,
  })
  const first = session('s1', 'setup', '2026-10-06T10:00:00.000Z')
  const second = session('s2', 'setup', '2026-10-06T11:00:00.000Z')

  test('its latest session is the setup role’s last started, whatever the list’s order', () => {
    const chat = session('c1', 'chat', '2026-10-06T12:00:00.000Z')
    expect(latestSetupOf([second, chat, first])).toBe(second)
    expect(latestSetupOf([chat])).toBeNull()
  })

  test('shows only the cards of its latest session, and what still waits from before', () => {
    const at = (time: string) => `2026-10-06T${time}.000Z`
    const cards = [
      card(
        'r1',
        { kind: 'repository', path: 'web' },
        { state: 'accepted', createdAt: at('10:01:00') },
      ),
      card(
        'v1',
        { kind: 'variable', name: 'ACME_REGION', replaces: false },
        {
          state: 'declined',
          createdAt: at('10:02:00'),
        },
      ),
      card(
        'c1',
        {
          kind: 'command',
          name: 'api: lint',
          type: 'lint',
          line: 'npm run lint',
          replaces: false,
        },
        {
          createdAt: at('10:03:00'),
        },
      ),
      card('r2', { kind: 'repository', path: 'shared' }, { createdAt: at('11:01:00') }),
    ]
    const shown = sinceLatestSetup(cards, second)
    expect(shown.map((one) => one.id)).toEqual(['c1', 'r2'])
    expect(setupEntriesOf(shown).map((entry) => entry.kind)).toEqual(['repositories', 'commands'])
    expect(sinceLatestSetup(cards, null)).toEqual(cards)
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

describe('An answer to the setup’s cards', () => {
  test('an answer the engine refuses is said, and the cards read again', async () => {
    const said: string[] = []
    let rereads = 0
    answerSaid(
      Promise.reject(new Error('Hemera could not write to its profile.')),
      () => {
        rereads += 1
      },
      (sentence) => said.push(sentence),
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(said).toEqual(['Your answer could not be given: Hemera could not write to its profile.'])
    expect(rereads).toBe(1)
  })
})

describe('The setup agent’s time, as its chip counts it', () => {
  const working = { startedAt: 1_000, endedAt: null }

  test('stops when the agent ends, and keeps that end while it stays ended', () => {
    const ended = agentTimesOf(working, 'done', 43_000)
    expect(ended).toEqual({ startedAt: 1_000, endedAt: 43_000 })
    expect(agentTimesOf(ended, 'done', 90_000)).toBe(ended)
  })

  test('starts again when the agent works again', () => {
    expect(agentTimesOf({ startedAt: 1_000, endedAt: 43_000 }, 'working', 60_000)).toEqual({
      startedAt: 60_000,
      endedAt: null,
    })
    expect(agentTimesOf(working, 'working', 60_000)).toBe(working)
  })
})

describe('The setup chip’s time, from its session', () => {
  const session = (createdAt: string, endedAt: string | null): SessionSummary => ({
    id: 's1',
    provider: 'claude',
    role: 'setup',
    lineage: 's1',
    parent: null,
    depth: 0,
    epoch: 0,
    state: endedAt === null ? 'working' : 'ended',
    stateReason: null,
    createdAt,
    endedAt,
  })
  const mounted = { startedAt: 9_000_000, endedAt: null }

  test('counts from when the latest setup session started, not from when the page showed', () => {
    expect(setupTimesOf(session('2026-10-06T10:00:00.000Z', null), mounted)).toEqual({
      startedAt: Date.parse('2026-10-06T10:00:00.000Z'),
      endedAt: null,
    })
  })

  test('stops where the session ended', () => {
    expect(
      setupTimesOf(session('2026-10-06T10:00:00.000Z', '2026-10-06T10:00:42.000Z'), mounted),
    ).toEqual({
      startedAt: Date.parse('2026-10-06T10:00:00.000Z'),
      endedAt: Date.parse('2026-10-06T10:00:42.000Z'),
    })
  })

  test('with no session known, the times the page kept', () => {
    expect(setupTimesOf(null, mounted)).toBe(mounted)
  })
})

describe('The setup, as a task of the Project', () => {
  const none: SetupStanding = { state: 'none', sentence: null }
  const done: SetupStanding = { state: 'done', sentence: null }

  const failed: SetupStanding = { state: 'failed', sentence: 'interrupted by a restart' }

  test('a task while the agent waits or works, or a proposal waits for its answer', () => {
    expect(setupIsTask({ state: 'waiting', sentence: null }, [])).toBe(true)
    expect(setupIsTask({ state: 'working', sentence: null }, [])).toBe(true)
    expect(setupIsTask(done, CARDS)).toBe(true)
  })

  test('a setup that stopped stays a task only while one of its proposals waits', () => {
    expect(setupIsTask(failed, CARDS)).toBe(true)
    expect(setupIsTask(failed, [])).toBe(false)
    expect(
      setupIsTask(failed, [card('r1', { kind: 'repository', path: 'web' }, { state: 'declined' })]),
    ).toBe(false)
  })

  test('nothing to show once every proposal is answered, nothing proposed, or nothing asked', () => {
    expect(setupIsTask(none, [])).toBe(false)
    expect(setupIsTask(done, [])).toBe(false)
    expect(
      setupIsTask(done, [card('r1', { kind: 'repository', path: 'web' }, { state: 'accepted' })]),
    ).toBe(false)
  })
})

describe('Whether an agent can run the setup', () => {
  const agent = (id: AgentState['id'], label: string, installed: boolean, signedIn: boolean) =>
    ({ id, label, installed, signedIn }) as const
  const role = (provider: AgentState['id']): RoleModels => ({
    role: 'setup',
    displayName: 'the setup agent',
    app: { agent: provider, model: null, effort: null },
    project: null,
    mission: null,
    resolved: { agent: provider, model: null, effort: null, level: 'app' },
  })

  test('the agent the setup role resolves to, installed and signed in, can', () => {
    expect(setupOfferOf([agent('codex', 'Codex', true, true)], [role('codex')])).toEqual({})
  })

  test('otherwise why it cannot, in words', () => {
    expect(setupOfferOf([agent('claude', 'Claude Code', true, false)], [role('claude')])).toEqual({
      unavailable: 'Claude Code is not signed in',
    })
    expect(setupOfferOf([agent('claude', 'Claude Code', false, false)], [role('claude')])).toEqual({
      unavailable: 'Claude Code is not installed',
    })
    // Only the setup role's agent missing: that one is named, whatever else is installed.
    expect(setupOfferOf([agent('codex', 'Codex', true, true)], [role('claude')])).toEqual({
      unavailable: 'claude is not installed',
    })
    expect(setupOfferOf([agent('codex', 'Codex', true, true)], [])).toEqual({
      unavailable: 'No agent runs the setup',
    })
  })
})

describe('The setup offered, as it is read', () => {
  const claude = { id: 'claude', label: 'Claude Code', installed: true, signedIn: true } as const
  const role: RoleModels = {
    role: 'setup',
    displayName: 'the setup agent',
    app: { agent: 'claude', model: null, effort: null },
    project: null,
    mission: null,
    resolved: { agent: 'claude', model: null, effort: null, level: 'app' },
  }

  test('nothing while either read is on its way; read, who can run it', () => {
    expect(setupOfferRead({ kind: 'loading' }, { kind: 'ready', value: [role] })).toBeNull()
    expect(
      setupOfferRead({ kind: 'ready', value: [claude] }, { kind: 'ready', value: [role] }),
    ).toEqual({})
  })

  test('a read refused is said as the reason no agent is offered', () => {
    expect(
      setupOfferRead(
        { kind: 'failed', sentence: 'The engine is gone.' },
        { kind: 'ready', value: [role] },
      ),
    ).toEqual({ unavailable: 'Who would run the setup could not be read: The engine is gone.' })
    expect(
      setupOfferRead({ kind: 'loading' }, { kind: 'failed', sentence: 'The engine is gone.' }),
    ).toEqual({ unavailable: 'Who would run the setup could not be read: The engine is gone.' })
  })
})

describe('What the setup chip’s menu says', () => {
  const role = (model: string | null): RoleModels => ({
    role: 'setup',
    displayName: 'the setup agent',
    app: { agent: 'claude', model, effort: null },
    project: null,
    mission: null,
    resolved: { agent: 'claude', model, effort: null, level: 'app' },
  })
  const claude = { id: 'claude', label: 'Claude Code' } as const

  test('who runs it: the agent and the model its role resolves to', () => {
    expect(setupAboutOf([claude], [role('opus')])).toBe('Agent · Claude Code · opus')
    expect(setupAboutOf([claude], [role(null)])).toBe('Agent · Claude Code · its default model')
  })

  test('what the setup agent said, oldest first: its menu shows the last, its details all', () => {
    const line = (kind: ThreadLine['kind'], text: string): ThreadLine => ({
      at: '2026-10-08T10:00:00.000Z',
      kind,
      text,
    })
    expect(
      setupMessagesOf([
        line('instructions', 'You are the setup agent'),
        line('said', 'Reading the repositories'),
        line('tool', 'setup_read'),
        line('said', 'Found pnpm workspaces'),
        line('said', 'Proposing the commands'),
        line('said', 'Proposed the setup'),
      ]),
    ).toEqual([
      'Reading the repositories',
      'Found pnpm workspaces',
      'Proposing the commands',
      'Proposed the setup',
    ])
  })
})

describe('The Tasks row of a Project’s page', () => {
  const none: SetupStanding = { state: 'none', sentence: null }
  const done: SetupStanding = { state: 'done', sentence: null }
  const failed: SetupStanding = { state: 'failed', sentence: 'interrupted by a restart' }
  const answered = [
    card('r1', { kind: 'repository', path: 'web' }, { state: 'accepted' }),
    card('v1', { kind: 'variable', name: 'ACME_REGION', replaces: false }, { state: 'declined' }),
  ]
  const read = (standing: SetupStanding, cards: ReadonlyArray<SetupCard>) => ({
    standing,
    cards,
    unread: null,
  })

  test('shows the setup while a proposal waits, and leaves once every one is answered', () => {
    expect(setupShownOf(read(done, CARDS), undefined)).toEqual({
      agent: 'done',
      failure: undefined,
    })
    expect(setupShownOf(read(done, answered), undefined)).toBeNull()
  })

  test('leaves when the setup stopped with every proposal answered', () => {
    expect(setupShownOf(read(failed, CARDS), undefined)).toEqual({
      agent: 'failed',
      failure: 'interrupted by a restart',
    })
    expect(setupShownOf(read(failed, answered), undefined)).toBeNull()
  })

  test('says a refused launch, though no setup ever ran', () => {
    const refused = 'The setup agent could not start: a setup is already being made.'
    expect(setupShownOf(read(none, []), refused)).toEqual({ agent: 'failed', failure: refused })
    // The agent at work is what the chip says; the refusal waits for it to stop.
    expect(setupShownOf(read({ state: 'working', sentence: null }, []), refused)).toEqual({
      agent: 'working',
      failure: undefined,
    })
  })

  test('says a setup that could not be read', () => {
    expect(
      setupShownOf({ standing: none, cards: [], unread: 'The engine is gone.' }, undefined),
    ).toEqual({ agent: 'failed', failure: 'The setup could not be read: The engine is gone.' })
  })
})

describe('A launch of a Project’s setup', () => {
  const held = () => Promise.withResolvers<void>()
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

  test('pressed twice while on its way, is made once', async () => {
    const asked: string[] = []
    const answer = held()
    const start = setupLauncher(
      (projectId) => {
        asked.push(projectId)
        return answer.promise
      },
      () => undefined,
    )
    const first = start('acme')
    const second = start('acme')
    answer.resolve()
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(asked).toEqual(['acme'])
  })

  test('refused, says why for that Project only, and a later launch clears it', async () => {
    const told: Array<readonly [string, { starting: boolean; refused: string | undefined }]> = []
    let refuse = true
    const start = setupLauncher(
      () =>
        refuse ? Promise.reject(new Error('a setup is already being made.')) : Promise.resolve(),
      (projectId, state) => told.push([projectId, state]),
    )
    expect(await start('acme')).toBe(false)
    refuse = false
    await settled()
    expect(await start('acme')).toBe(true)
    expect(told).toEqual([
      ['acme', { starting: true, refused: undefined }],
      [
        'acme',
        {
          starting: false,
          refused: 'The setup agent could not start: a setup is already being made.',
        },
      ],
      ['acme', { starting: true, refused: undefined }],
      ['acme', { starting: false, refused: undefined }],
    ])
  })

  test('one Project’s launch on its way does not hold another’s', async () => {
    const asked: string[] = []
    const start = setupLauncher(
      (projectId) => {
        asked.push(projectId)
        return held().promise
      },
      () => undefined,
    )
    void start('acme')
    void start('web')
    void start('acme')
    expect(asked).toEqual(['acme', 'web'])
  })
})
