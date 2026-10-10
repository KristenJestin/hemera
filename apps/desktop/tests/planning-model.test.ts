/**
 * The Planning page as the window feeds it: the engine's read models in the page's words, the Now
 * line of the head, and the follower that reads them, keeps them up to date and sends the user's
 * gestures.
 */

import { AgentWorking } from '@hemera/core/domain'
import type {
  ColdReadPass,
  Discussion,
  Mission,
  Now,
  PlanningInput,
  ProbeChip,
  Question,
  SessionSummary,
  Spec,
  SpecRequirement,
  TicketEventInfo,
  Wave,
} from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  followPlanning,
  nowLineOf,
  planningDataOf,
  type PlanningLink,
  type PlanningRead,
  type PlanningView,
} from '../src/renderer/planning-model.ts'

const NOW = new Date('2026-10-05T12:00:00.000Z')
const AT = '2026-10-05T11:56:00.000Z'

const requirement = (more: Partial<SpecRequirement> = {}): SpecRequirement => ({
  id: 'R1',
  domain: 'Notes',
  delta: 'added',
  livingRef: null,
  livingVersion: null,
  text: 'A note is exported as one Markdown file.',
  version: 1,
  removed: false,
  scenarios: [],
  newDomain: false,
  againstProposed: false,
  reliesOn: [],
  ...more,
})

const spec = (more: Partial<Spec> = {}): Spec => ({
  missionId: 'm12',
  key: 'ACME-12',
  title: 'Export notes as Markdown',
  type: 'feature',
  stage: 'planning',
  language: 'en',
  version: 4,
  declaredCompleteVersion: null,
  frozen: false,
  readVersion: 2,
  sections: [
    {
      name: 'why',
      title: 'Why',
      body: 'Notes cannot leave the app.',
      version: 1,
      state: 'written',
      writtenAt: AT,
    },
    {
      name: 'goals',
      title: 'Goals / Non-goals',
      body: '',
      version: 0,
      state: 'empty',
      writtenAt: null,
    },
  ],
  requirements: [],
  triage: null,
  tasks: [],
  tasksVersion: 0,
  recommendation: null,
  ...more,
})

const question = (more: Partial<Question> = {}): Question => ({
  id: 'Q1',
  wave: 1,
  text: 'Who may export a note?',
  why: 'The export leaves the app.',
  options: [
    { id: 'A', label: 'Anyone who can read it', detail: '' },
    { id: 'B', label: 'Only its owner', detail: '' },
  ],
  recommended: 'A',
  recommendedReason: 'Reading already shows it.',
  section: null,
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'open',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  askedAt: AT,
  answers: [],
  drafts: [],
  proposals: [],
  ...more,
})

const input = (more: Partial<PlanningInput> = {}): PlanningInput => ({
  id: 'i1',
  kind: 'answer',
  item: 'Q1',
  itemVersion: 1,
  state: 'delivered',
  receivedAt: AT,
  deliveredAt: AT,
  integratedAt: null,
  where: null,
  supersededBy: null,
  ...more,
})

const read = (more: Partial<PlanningRead> = {}): PlanningRead => ({
  spec: spec(),
  waves: [],
  inputs: [],
  visions: [],
  discussions: [],
  probes: [],
  passes: [],
  freshness: { readVersion: null, specVersion: 4, changes: [] },
  dependencies: { dependsOn: [], dependedOnBy: [] },
  events: [],
  changes: [],
  living: new Map(),
  titles: new Map(),
  ...more,
})

const event = (more: Partial<TicketEventInfo> = {}): TicketEventInfo => ({
  id: 'te1',
  missionId: 'm12',
  sequence: 1,
  key: 'acme/shop#41',
  kind: 'comment_added',
  commentId: 'c1',
  difference: '+ Keep the images',
  stage: 'planning',
  detectedAt: AT,
  state: 'delivered',
  input: null,
  analysis: null,
  seenAt: null,
  ...more,
})

const now = (more: Partial<Now> = {}): Now => ({
  missionId: 'm12',
  key: 'ACME-12',
  stage: 'planning',
  round: 0,
  marks: [],
  ball: null,
  waiting: [],
  running: [],
  slotWait: null,
  next: null,
  doing: [],
  ...more,
})

const session = (more: Partial<SessionSummary> = {}): SessionSummary => ({
  id: 's1',
  provider: 'claude',
  role: 'planner',
  lineage: 'l1',
  parent: null,
  depth: 0,
  epoch: 1,
  state: 'working',
  stateReason: null,
  createdAt: AT,
  endedAt: null,
  ...more,
})

describe('The Spec in the page’s words', () => {
  test('the requirements still in the Spec are drawn, with the living text they change once read', () => {
    const data = planningDataOf(
      read({
        spec: spec({
          requirements: [
            requirement({
              delta: 'modified',
              livingRef: 'LR4',
              againstProposed: true,
              scenarios: [
                {
                  id: 'R1.S1',
                  when: 'the user exports a note',
                  then: 'one file is written',
                  version: 1,
                  proof: {
                    mode: 'automated',
                    actions: ['Export the note'],
                    starting_data: 'One note',
                    expected: 'One file',
                    command: 'pnpm test',
                    seen_today: false,
                    from_probe: '#2',
                  },
                  proofVersion: 1,
                },
              ],
            }),
            requirement({ id: 'R2', removed: true }),
          ],
        }),
        living: new Map([['LR4', 'A note is printed.']]),
      }),
      NOW,
    )
    expect(data.requirementsState).toBe('written')
    expect(data.requirements.map((one) => one.id)).toEqual(['R1'])
    expect(data.requirements[0]?.living).toEqual({
      ref: 'LR4',
      text: 'A note is printed.',
      proposed: true,
    })
    expect(data.requirements[0]?.scenarios[0]?.proof).toMatchObject({
      command: 'pnpm test',
      fromProbe: '#2',
      seenToday: false,
    })
    expect(planningDataOf(read(), NOW).requirementsState).toBe('empty')
  })

  test('an answer, a vision and a change of the ticket each say where their input stands', () => {
    const data = planningDataOf(
      read({
        waves: [
          {
            number: 1,
            askedAt: AT,
            questions: [
              question({
                state: 'answered',
                answers: [
                  {
                    version: 1,
                    optionId: 'A',
                    text: null,
                    author: 'user',
                    at: AT,
                    input: 'i1',
                    inputState: 'integrated',
                  },
                ],
              }),
            ],
          },
        ],
        inputs: [input({ id: 'i2', kind: 'vision', item: 'v1', state: 'delivered' })],
        visions: [{ id: 'v1', text: 'Keep it small', at: AT, input: 'i2' }],
        events: [event({ input: null, state: 'new' }), event({ id: 'te2', seenAt: AT })],
      }),
      NOW,
    )
    expect(data.waves[0]?.questions[0]?.answers[0]?.inputState).toBe('integrated')
    expect(data.visions[0]?.inputState).toBe('delivered')
    expect(data.ticket).toEqual({
      key: 'acme/shop#41',
      changes: [
        {
          id: 'te1',
          what: 'A comment was added to the ticket',
          difference: '+ Keep the images',
          at: '4 min',
          inputState: 'received',
        },
      ],
    })
  })

  test('only the answers proposed from the ticket that still wait are offered', () => {
    const proposal = {
      id: 'pa1',
      missionId: 'm12',
      questionId: 'Q1',
      commentId: 'c1',
      commentAuthor: 'Sam',
      comment: 'Only the owner, please.',
      text: 'Only its owner',
      state: 'proposed' as const,
      proposedAt: AT,
      decidedAt: null,
      reason: null,
    }
    const waves: Wave[] = [
      {
        number: 1,
        askedAt: AT,
        questions: [
          question({
            proposals: [proposal, { ...proposal, id: 'pa0', state: 'dismissed', decidedAt: AT }],
          }),
        ],
      },
    ]
    expect(planningDataOf(read({ waves }), NOW).waves[0]?.questions[0]?.proposals).toEqual([
      { id: 'pa1', author: 'Sam', comment: 'Only the owner, please.', text: 'Only its owner' },
    ])
  })

  test('the Planner’s triage answer is shown while it waits, not once the mission is kept', () => {
    const triage = {
      kind: 'existing_mission' as const,
      ref: 'ACME-9',
      text: 'ACME-9 already exports notes.',
      state: 'pending' as const,
      at: AT,
      basedOnProposed: false,
    }
    expect(planningDataOf(read({ spec: spec({ triage }) }), NOW).triage).toEqual({
      kind: 'existing_mission',
      ref: 'ACME-9',
      text: 'ACME-9 already exports notes.',
      basedOnProposed: false,
    })
    expect(
      planningDataOf(read({ spec: spec({ triage: { ...triage, state: 'kept' } }) }), NOW).triage,
    ).toBeNull()
  })

  test('the cold read says whether it read the text as it is now', () => {
    const behind = planningDataOf(
      read({
        freshness: {
          readVersion: 3,
          specVersion: 4,
          changes: [{ version: 4, item: 'why', before: 'a', after: 'b', at: AT }],
        },
      }),
      NOW,
    )
    expect(behind.freshness.current).toBe(false)
    expect(behind.freshness.changes).toHaveLength(1)
    expect(planningDataOf(read(), NOW).freshness.current).toBe(true)
  })

  test('a dependency names the mission it waits on by its title and its stage', () => {
    const data = planningDataOf(
      read({
        dependencies: {
          dependsOn: [
            {
              id: 'dep1',
              missionId: 'm12',
              missionKey: 'ACME-12',
              dependsOnId: 'm9',
              dependsOnKey: 'ACME-9',
              dependsOnStage: 'building',
              reason: 'It adds the note files.',
              state: 'proposed',
              proposedAt: AT,
              decidedAt: null,
            },
          ],
          dependedOnBy: [],
        },
        titles: new Map([['ACME-9', 'Store notes as files']]),
      }),
      NOW,
    )
    expect(data.dependencies).toEqual([
      {
        id: 'dep1',
        dependsOnKey: 'ACME-9',
        dependsOnTitle: 'Store notes as files',
        dependsOnStage: 'Building',
        reason: 'It adds the note files.',
        state: 'proposed',
      },
    ])
  })
})

describe('The Now line of the head', () => {
  test('says what the Planner does, else the slot it waits for', () => {
    const doing = {
      sessionId: 's1',
      role: 'planner',
      text: 'Writing the requirements',
      main: true,
      updatedAt: AT,
    }
    expect(nowLineOf(now({ doing: [doing] }), [])).toBe('Writing the requirements')
    expect(nowLineOf(now({ slotWait: 'Waiting for a free slot' }), [])).toBe(
      'Waiting for a free slot',
    )
  })

  test('says a Planner that gave no sign or stopped, and nothing otherwise', () => {
    expect(nowLineOf(now(), [session({ state: 'stuck' })])).toBe(
      'The Planner has given no sign for a while',
    )
    expect(nowLineOf(now(), [session({ state: 'failed', stateReason: 'Out of credit' })])).toBe(
      'The Planner stopped: Out of credit',
    )
    expect(nowLineOf(now(), [session()])).toBeUndefined()
    expect(nowLineOf(null, [])).toBeUndefined()
  })
})

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const mission = (id: string, key: string, title: string): Mission => ({
  id,
  projectId: 'acme',
  key,
  title,
  idea: { sentence: title, ticket: null },
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
  createdAt: AT,
  updatedAt: AT,
})

const DISCUSSION: Discussion = {
  id: 'd1',
  missionId: 'm12',
  number: 1,
  label: '#1',
  item: { kind: 'question', id: 'Q1' },
  state: 'open',
  outcome: null,
  decision: null,
  proposal: { text: 'Only its owner', at: AT },
  closedBy: null,
  closedAt: null,
  openedAt: AT,
  waitsOn: 'user',
  plannerFailed: null,
  messages: [],
}

const PROBE: ProbeChip = {
  id: 'p1',
  missionId: 'm12',
  number: 1,
  label: '#1',
  question: 'Does a long note export whole?',
  scenario: null,
  state: 'done',
  stuck: false,
  startedAt: AT,
  endedAt: AT,
  outcome: 'reproduced',
}

const PASS: ColdReadPass = {
  id: 'c1',
  missionId: 'm12',
  number: 1,
  label: 'C1',
  cycle: 1,
  specVersion: 4,
  requestedBy: 'hemera',
  state: 'done',
  stuck: false,
  askedAt: AT,
  startedAt: AT,
  endedAt: AT,
  failure: null,
  findings: [],
}

/** What the streams of the played link are heard by. */
interface Listeners {
  spec: (heard: Spec) => void
  discussions: (heard: ReadonlyArray<Discussion>) => void
  probes: (heard: ReadonlyArray<ProbeChip>) => void
  passes: (heard: ReadonlyArray<ColdReadPass>) => void
  end: (error: Error) => void
}

/** A link that answers as told and notes each gesture; its streams are sent by the test. */
const world = (played: Partial<PlanningLink> = {}) => {
  const calls: Array<{ call: string; args: ReadonlyArray<string | number | boolean | null> }> = []
  const listeners: Listeners = {
    spec: () => undefined,
    discussions: () => undefined,
    probes: () => undefined,
    passes: () => undefined,
    end: () => undefined,
  }
  let subscriptions = 0
  const noted =
    <A>(call: string, answer: A) =>
    (...args: ReadonlyArray<string | number | boolean | null>): Promise<A> => {
      calls.push({ call, args })
      return Promise.resolve(answer)
    }
  const link: PlanningLink = {
    onSpec: (_mission, heard, ended) => {
      subscriptions += 1
      listeners.spec = heard
      listeners.end = ended
      return () => undefined
    },
    onDiscussions: (_mission, heard) => {
      listeners.discussions = heard
      return () => undefined
    },
    onProbes: (_mission, heard) => {
      listeners.probes = heard
      return () => undefined
    },
    onColdReads: (_mission, heard) => {
      listeners.passes = heard
      return () => undefined
    },
    onMemory: () => () => undefined,
    memoryNow: () => Promise.resolve(now()),
    changesSince: noted('changesSince', []),
    markRead: noted('markRead', undefined),
    addVision: noted('addVision', undefined),
    visions: () => Promise.resolve([]),
    waves: noted('waves', []),
    answer: (missionId, questionId, answer) => {
      calls.push({ call: 'answer', args: [missionId, questionId, JSON.stringify(answer)] })
      return Promise.resolve()
    },
    waitOnSomeone: noted('waitOnSomeone', undefined),
    planningInputs: () => Promise.resolve([]),
    acceptProposedAnswer: noted('acceptProposedAnswer', undefined),
    dismissProposedAnswer: noted('dismissProposedAnswer', undefined),
    keepAfterTriage: noted('keepAfterTriage', undefined),
    openDiscussion: (missionId, item, text) => {
      calls.push({ call: 'openDiscussion', args: [missionId, item.kind, item.id, text] })
      return Promise.resolve(DISCUSSION)
    },
    sayInDiscussion: noted('sayInDiscussion', DISCUSSION),
    acceptDiscussion: noted('acceptDiscussion', DISCUSSION),
    closeDiscussion: noted('closeDiscussion', DISCUSSION),
    probe: (probeId) => {
      calls.push({ call: 'probe', args: [probeId] })
      return Promise.resolve({
        ...PROBE,
        brief: '',
        folder: '',
        bases: [],
        answer: 'Yes',
        report: null,
        files: [],
        evidence: [],
        failure: null,
        wipeError: null,
      })
    },
    coldReadAgain: noted('coldReadAgain', PASS),
    dismissFinding: noted('dismissFinding', undefined),
    coldReadFreshness: () => Promise.resolve({ readVersion: 4, specVersion: 4, changes: [] }),
    dependencies: () => Promise.resolve({ dependsOn: [], dependedOnBy: [] }),
    decideDependency: () => new Promise(() => undefined),
    ticketEvents: () => Promise.resolve([]),
    acknowledgeTicketEvent: () => new Promise(() => undefined),
    missionSessions: () => Promise.resolve([]),
    livingSpecRequirement: () => new Promise(() => undefined),
    missions: () =>
      Promise.resolve([
        mission('m12', 'ACME-12', 'Export notes as Markdown'),
        mission('m9', 'ACME-9', 'Store notes as files'),
      ]),
    ...played,
  }
  const views: PlanningView[] = []
  const following = followPlanning(
    link,
    { id: 'm12', projectId: 'acme' },
    (view) => views.push(view),
    () => NOW,
  )
  return {
    following,
    listeners,
    calls,
    views,
    subscriptions: () => subscriptions,
    last: (): PlanningView => {
      const view = views.at(-1)
      if (view === undefined) throw new Error('no view yet')
      return view
    },
    named: (call: string) => calls.filter((one) => one.call === call),
  }
}

describe('Following a mission’s Planning', () => {
  test('the page is drawn once the Spec and what goes with it are read, and read again at each change', async () => {
    const played = world()
    expect(played.views.at(-1)?.data ?? null).toBeNull()
    played.listeners.spec(spec())
    expect(played.last().data).toBeNull()
    await flush()
    expect(played.last().data?.sections[0]?.body).toBe('Notes cannot leave the app.')
    expect(played.named('changesSince')[0]?.args).toEqual(['m12', 2])
    expect(played.last().mentionables.map((one) => one.label)).toEqual(['ACME-9'])
    played.listeners.passes([PASS])
    await flush()
    expect(played.named('waves')).toHaveLength(2)
    expect(played.last().data?.passes.map((one) => one.label)).toEqual(['C1'])
  })

  test('the first written Spec shown is marked read at its version, once', async () => {
    const played = world()
    played.listeners.spec(spec({ readVersion: null }))
    played.listeners.spec(spec({ readVersion: null, version: 5 }))
    await flush()
    expect(played.named('markRead').map((one) => one.args)).toEqual([['m12', 4]])
    expect(played.named('changesSince')).toHaveLength(0)
  })

  test('a Spec with nothing written is not marked read', async () => {
    const played = world()
    played.listeners.spec(spec({ readVersion: null, sections: [] }))
    await flush()
    expect(played.named('markRead')).toHaveLength(0)
  })

  test('Mark as read marks the version shown', async () => {
    const played = world()
    played.listeners.spec(spec({ version: 7 }))
    await flush()
    played.following.markRead()
    await flush()
    expect(played.named('markRead').map((one) => one.args)).toEqual([['m12', 7]])
  })

  test('an answer is sent, then the questions are read again', async () => {
    const played = world()
    played.listeners.spec(spec())
    await flush()
    played.following.answer('Q1', { optionId: 'A' })
    await flush()
    expect(played.named('answer')[0]?.args).toEqual(['m12', 'Q1', '{"optionId":"A"}'])
    expect(played.named('waves')).toHaveLength(2)
  })

  test('a refused gesture says why, and the next one clears it', async () => {
    const played = world({
      addVision: () => Promise.reject(new Error('The mission is no longer in Planning.')),
    })
    played.listeners.spec(spec())
    await flush()
    played.following.giveVision('Keep it small')
    await flush()
    expect(played.last().refused).toBe('The mission is no longer in Planning.')
    played.following.keepPlanning()
    expect(played.last().refused).toBeUndefined()
  })

  test('the first message on an item opens its discussion; the next ones are said in it', async () => {
    const played = world()
    played.listeners.spec(spec())
    const item = { kind: 'question' as const, id: 'Q1' }
    played.following.say(item, 'Why not both?')
    await flush()
    expect(played.named('openDiscussion')[0]?.args).toEqual([
      'm12',
      'question',
      'Q1',
      'Why not both?',
    ])
    played.listeners.discussions([DISCUSSION])
    played.following.say(item, 'And for a shared note?')
    played.following.accept(item)
    played.following.close(item, null)
    await flush()
    expect(played.named('sayInDiscussion')[0]?.args).toEqual(['d1', 'And for a shared note?'])
    expect(played.named('acceptDiscussion')[0]?.args).toEqual(['d1', AT])
    expect(played.named('closeDiscussion')[0]?.args).toEqual(['d1', null])
  })

  test('a Probe’s report is read when it is opened, and again when its Probe moves', async () => {
    const played = world()
    played.following.openProbe('p1')
    expect(played.last().reports).toEqual(new Map([['p1', null]]))
    await flush()
    expect(played.last().reports.get('p1')?.label).toBe('#1')
    played.listeners.probes([PROBE])
    await flush()
    expect(played.named('probe')).toHaveLength(2)
  })

  test('a Spec that cannot be read says so, and Retry follows it again', async () => {
    const played = world()
    played.listeners.end(new Error('The engine did not answer in time.'))
    expect(played.last().error).toBe('The engine did not answer in time.')
    played.following.retry()
    expect(played.last().error).toBeUndefined()
    expect(played.subscriptions()).toBe(2)
  })
})
