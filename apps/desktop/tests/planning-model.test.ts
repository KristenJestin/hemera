/**
 * The Planning page as the window feeds it: the engine's read models in the page's words, the Now
 * line of the head, and the follower that reads them, keeps them up to date and sends the user's
 * gestures.
 */

import { AgentWorking } from '@hemera/core/domain'
import type {
  ColdReadPass,
  Discussion,
  FreezeReadiness,
  HelperChip,
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

import { Planning, answerStepOf, planningSteps } from '@hemera/ui'

import {
  followPlanning,
  planningDataOf,
  planningHeadOf,
  plannerOf,
  probeOf,
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

const doingLine = (text: string, main = true) => ({
  sessionId: 's1',
  role: 'planner',
  text,
  main,
  updatedAt: AT,
})

describe('The Planner as the page knows it', () => {
  test('says what the Planner does while it works, and the next step it set', () => {
    const next = { sessionId: 's1', role: 'planner', text: 'Ask about sharing', updatedAt: AT }
    expect(
      plannerOf(now({ doing: [doingLine('Writing the requirements')], next }), [session()]),
    ).toEqual({
      state: 'working',
      doing: 'Writing the requirements',
      next: 'Ask about sharing',
      reason: null,
    })
  })

  test('is between its turns once its session is idle, whatever its last line said', () => {
    expect(
      plannerOf(now({ doing: [doingLine('Waiting for Q4 to Q6')] }), [session({ state: 'idle' })])
        .state,
    ).toBe('idle')
    expect(plannerOf(null, []).state).toBe('idle')
  })

  test('says a Planner that gave no sign or stopped, with why', () => {
    expect(plannerOf(now(), [session({ state: 'stuck' })]).state).toBe('stuck')
    expect(plannerOf(now(), [session({ state: 'failed', stateReason: 'Out of credit' })])).toEqual({
      state: 'failed',
      doing: null,
      next: null,
      reason: 'Out of credit',
    })
  })

  test('a Planner starting says the slot it waits for', () => {
    expect(
      plannerOf(now({ slotWait: 'Waiting for a free slot (2 of 2 in use)' }), [
        session({ state: 'starting' }),
      ]),
    ).toEqual({
      state: 'working',
      doing: 'Waiting for a free slot (2 of 2 in use)',
      next: null,
      reason: null,
    })
  })

  test('the last Planner session is the one that counts', () => {
    expect(
      plannerOf(now(), [session({ id: 's0', state: 'failed' }), session({ state: 'idle' })]).state,
    ).toBe('idle')
  })
})

/** A follower's view, drawn from one read. */
const viewOf = (more: Partial<PlanningView> = {}): PlanningView => ({
  data: planningDataOf(read(), NOW),
  mentionables: [],
  reports: new Map(),
  prototypes: [],
  prototypeResults: new Map(),
  planner: { state: 'idle', doing: null, next: null, reason: null },
  declaredComplete: false,
  ...more,
})

const readiness = (ready: boolean, unsettled: string[] = []): FreezeReadiness => ({
  ready,
  unsettled,
  freshness: { readVersion: 4, specVersion: 4, changes: [] },
  dependencies: [],
})

const answered = (id: string, inputState: Question['answers'][number]['inputState']): Question =>
  question({
    id,
    state: 'answered',
    answers: [
      { version: 1, optionId: 'A', text: null, author: 'user', at: AT, input: 'i1', inputState },
    ],
  })

const complete = (more: Partial<PlanningRead> = {}): Planning.PlanningData =>
  planningDataOf(
    read({
      spec: spec({ declaredCompleteVersion: 4 }),
      waves: [{ number: 1, askedAt: AT, questions: [answered('Q1', 'integrated')] }],
      ...more,
    }),
    NOW,
  )

describe('The head of the Planning page', () => {
  test('the Now line says what the Planner does while it works', () => {
    const head = planningHeadOf(
      viewOf({
        planner: { state: 'working', doing: 'Writing the requirements', next: null, reason: null },
      }),
      null,
    )
    expect(head.now?.text).toBe('Writing the requirements')
    expect(head.now?.ball).toBe('agent')
  })

  test('says a silent turn: the Planner works and has not said on what', () => {
    const head = planningHeadOf(
      viewOf({ planner: { state: 'working', doing: null, next: null, reason: null } }),
      null,
    )
    expect(head.now?.text).toBe('The Planner is working and has not said on what yet')
  })

  test('a Planner between turns is not believed over the facts: an open question is said', () => {
    const data = planningDataOf(
      read({ waves: [{ number: 1, askedAt: AT, questions: [question({ id: 'Q4' })] }] }),
      NOW,
    )
    const head = planningHeadOf(
      viewOf({
        data,
        planner: plannerOf(now({ doing: [doingLine('Nothing left to do in planning')] }), [
          session({ state: 'idle' }),
        ]),
      }),
      null,
    )
    expect(head.now?.text).toBe('Q4 waits for your answer')
    expect(head.now?.target).toEqual({ kind: 'question', id: 'Q4' })
  })

  test('says nothing before the page is read', () => {
    expect(planningHeadOf(viewOf({ data: null }), null)).toEqual({
      now: null,
      freeze: { shown: false },
    })
  })

  test('Freeze is not in the head before the Spec is declared complete', () => {
    expect(planningHeadOf(viewOf(), readiness(true)).freeze).toEqual({ shown: false })
  })

  test('from declared complete on, Freeze stays, disabled with what is left under it', () => {
    const reading = complete({
      passes: [{ ...PASS, state: 'running', endedAt: null }],
    })
    expect(
      planningHeadOf(viewOf({ data: reading, declaredComplete: true }), readiness(false, ['x']))
        .freeze,
    ).toEqual({ shown: true, reasons: ['The cold read is reading the Spec'] })
  })

  test('Freeze is enabled once nothing is left and the engine says it is ready', () => {
    const data = complete({ passes: [PASS] })
    expect(
      planningHeadOf(viewOf({ data, declaredComplete: true }), readiness(true)).freeze,
    ).toEqual({ shown: true, reasons: [] })
  })

  test('the engine’s reasons are said when the page’s facts explain nothing', () => {
    const data = complete({ passes: [PASS] })
    expect(
      planningHeadOf(
        viewOf({ data, declaredComplete: true }),
        readiness(false, ['An open discussion: #2']),
      ).freeze,
    ).toEqual({ shown: true, reasons: ['An open discussion: #2'] })
    expect(planningHeadOf(viewOf({ data, declaredComplete: true }), null).freeze).toEqual({
      shown: true,
      reasons: ['Hemera checks what is left before Freeze'],
    })
  })

  test('the Spec frozen: no Freeze, and the line says so', () => {
    const data = complete({ spec: spec({ declaredCompleteVersion: 4, frozen: true }) })
    const head = planningHeadOf(viewOf({ data, declaredComplete: true }), readiness(true))
    expect(head.freeze).toEqual({ shown: false })
    expect(head.now?.text).toBe('The Spec is frozen')
  })
})

describe('A question’s dot', () => {
  const dotOf = (one: Question, inputs: PlanningInput[] = []) => {
    const data = planningDataOf(
      read({ waves: [{ number: 1, askedAt: AT, questions: [one] }], inputs }),
      NOW,
    )
    const shown = data.waves[0]?.questions[0]
    if (shown === undefined) throw new Error('no question drawn')
    return answerStepOf(shown)
  }

  test('follows the answer’s state: not answered, sent, with the Planner, taken into account', () => {
    expect(dotOf(question())).toBe('unanswered')
    expect(dotOf(answered('Q1', 'received'))).toBe('received')
    expect(dotOf(answered('Q1', null))).toBe('received')
    expect(dotOf(answered('Q1', 'delivered'))).toBe('delivered')
    expect(dotOf(answered('Q1', 'integrated'))).toBe('integrated')
  })

  test('a question asked again after an answer is not answered, whatever its earlier answer', () => {
    expect(dotOf({ ...answered('Q4', 'integrated'), state: 'waiting' })).toBe('unanswered')
    expect(dotOf({ ...answered('Q5', 'integrated'), state: 'open' })).toBe('unanswered')
  })
})

describe('Where Planning stands, from the engine', () => {
  test('the steps follow the answers’ states', () => {
    const stepsOf = (questions: Question[]) =>
      planningSteps({
        data: planningDataOf(read({ waves: [{ number: 1, askedAt: AT, questions }] }), NOW),
        planner: { state: 'idle', doing: null, next: null, reason: null },
        declaredComplete: false,
      }).find((step) => step.id === 'questions')?.state
    expect(stepsOf([question()])).toBe('waiting')
    expect(stepsOf([answered('Q1', 'received')])).toBe('running')
    expect(stepsOf([answered('Q1', 'delivered')])).toBe('running')
    expect(stepsOf([answered('Q1', 'integrated')])).toBe('done')
  })

  test('a section is settled only once no open question touches it', () => {
    const openOf = (questions: Question[]) =>
      Planning.openBySection(
        planningDataOf(read({ waves: [{ number: 1, askedAt: AT, questions }] }), NOW).waves,
      ).get('decisions') ?? 0
    expect(
      openOf([question({ section: 'decisions' }), question({ id: 'Q2', section: 'decisions' })]),
    ).toBe(2)
    expect(openOf([{ ...answered('Q1', 'delivered'), section: 'decisions' }])).toBe(1)
    expect(openOf([{ ...answered('Q1', 'integrated'), section: 'decisions' }])).toBe(0)
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
  step: null,
  startedAt: AT,
  endedAt: AT,
  outcome: 'reproduced',
}

const PROTOTYPER: HelperChip = {
  id: 'h1',
  missionId: 'm12',
  number: 1,
  label: 'H1',
  name: 'Prototyper',
  definition: 'prototyper',
  icon: 'flask',
  letter: 'P',
  tone: 'build',
  depth: 1,
  task: null,
  state: 'running',
  stuck: false,
  step: 'Write list.html',
  verdict: null,
  startedAt: AT,
  endedAt: null,
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
  prototypes: (heard: ReadonlyArray<HelperChip>) => void
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
    prototypes: () => undefined,
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
    onPrototypes: (_mission, heard) => {
      listeners.prototypes = heard
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
    askPrototype: noted('askPrototype', undefined),
    judgePrototype: noted('judgePrototype', undefined),
    helper: (helperId) => {
      calls.push({ call: 'helper', args: [helperId] })
      return Promise.resolve({
        ...PROTOTYPER,
        state: 'done',
        step: null,
        brief: 'Two columns?',
        place: 'prototype',
        folder: '',
        writes: true,
        result: 'Tried: two columns.',
        failure: null,
        verdictNote: null,
        judgedAt: null,
        thread: null,
      })
    },
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

describe('A running Probe’s step (#206)', () => {
  test('its chip shows the step the engine gives, and none when it gives none', () => {
    const running: ProbeChip = { ...PROBE, state: 'running', endedAt: null, outcome: null }
    expect(probeOf({ ...running, step: 'Read api/importer.ts' }).step).toBe('Read api/importer.ts')
    expect(probeOf(running).step).toBeUndefined()
  })
})

describe('The Prototyper on the Planning page (#222)', () => {
  test('the mission’s Prototypers are on the page, with their step and verdict', async () => {
    const played = world()
    played.listeners.spec(spec())
    played.listeners.prototypes([PROTOTYPER])
    await flush()
    expect(played.last().prototypes).toEqual([PROTOTYPER])
  })

  test('asking for a prototype and judging one are sent to the engine', async () => {
    const played = world()
    played.listeners.spec(spec())
    await flush()
    await played.following.askPrototype('Show the list in two columns.')
    await played.following.judgePrototype('h1', 'validated', 'Keep it.')
    expect(played.named('askPrototype').map((one) => one.args)).toEqual([
      ['m12', 'Show the list in two columns.'],
    ])
    expect(played.named('judgePrototype').map((one) => one.args)).toEqual([
      ['h1', 'validated', 'Keep it.'],
    ])
  })

  test('a Prototyper’s result is read when it is opened, and again when it moves', async () => {
    const played = world()
    played.following.openPrototype('h1')
    expect(played.last().prototypeResults).toEqual(new Map([['h1', null]]))
    await flush()
    expect(played.last().prototypeResults.get('h1')?.result).toBe('Tried: two columns.')
    played.listeners.prototypes([PROTOTYPER])
    await flush()
    expect(played.named('helper')).toHaveLength(2)
  })
})

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

  test('one display for a question, live or after a restart: the same state draws the same page', async () => {
    // The engine as it moves: an answer received, then delivered, then integrated.
    let waves: Wave[] = [
      { number: 1, askedAt: AT, questions: [question(), question({ id: 'Q2' })] },
    ]
    let inputs: PlanningInput[] = []
    const engine: Partial<PlanningLink> = {
      waves: () => Promise.resolve(waves),
      planningInputs: () => Promise.resolve(inputs),
      missionSessions: () => Promise.resolve([session({ state: 'idle' })]),
      coldReadFreshness: () => Promise.resolve({ readVersion: 4, specVersion: 4, changes: [] }),
    }
    const answeredAs = (state: PlanningInput['state']): void => {
      waves = [
        { number: 1, askedAt: AT, questions: [answered('Q1', state), question({ id: 'Q2' })] },
      ]
      inputs = [input({ state })]
    }
    const live = world({
      ...engine,
      answer: () => {
        answeredAs('received')
        return Promise.resolve()
      },
    })
    live.listeners.spec(spec({ readVersion: 4 }))
    await flush()
    await live.following.answer('Q1', { optionId: 'A' })
    await flush()
    for (const state of ['delivered', 'integrated'] as const) {
      answeredAs(state)
      live.listeners.spec(spec({ readVersion: 4 }))
      // oxlint-disable-next-line no-await-in-loop -- each step is heard after the one before
      await flush()
      const fresh = world(engine)
      fresh.listeners.spec(spec({ readVersion: 4 }))
      // oxlint-disable-next-line no-await-in-loop -- the restarted page reads the same step
      await flush()
      expect(live.last().data).toEqual(fresh.last().data)
      expect(planningHeadOf(live.last(), null)).toEqual(planningHeadOf(fresh.last(), null))
      expect(live.last().data?.waves[0]?.questions[0]?.answers.at(-1)?.inputState).toBe(state)
    }
  })

  test('a refused gesture says why, and the next one clears it', async () => {
    const played = world({
      coldReadAgain: () => Promise.reject(new Error('The mission is no longer in Planning.')),
    })
    played.listeners.spec(spec())
    await flush()
    await played.following.runColdRead()
    expect(played.last().refused).toBe('The mission is no longer in Planning.')
    played.following.keepPlanning()
    expect(played.last().refused).toBeUndefined()
  })

  test('what the user wrote and the engine refused is refused to its field, not said in the head', async () => {
    const refusal = new Error('The mission is no longer in Planning.')
    const played = world({
      addVision: () => Promise.reject(refusal),
      answer: () => Promise.reject(refusal),
      acceptProposedAnswer: () => Promise.reject(refusal),
      openDiscussion: () => Promise.reject(refusal),
      closeDiscussion: () => Promise.reject(refusal),
    })
    played.listeners.spec(spec())
    played.listeners.discussions([DISCUSSION])
    await flush()
    const item = { kind: 'question' as const, id: 'Q2' }
    await expect(played.following.giveVision('Keep it small')).rejects.toBe(refusal)
    await expect(played.following.answer('Q1', { text: 'Only me' })).rejects.toBe(refusal)
    await expect(played.following.acceptProposed('a1', 'Only me')).rejects.toBe(refusal)
    await expect(played.following.say(item, 'Why not both?')).rejects.toBe(refusal)
    await expect(played.following.close(DISCUSSION.item, 'Only me')).rejects.toBe(refusal)
    expect(played.last().refused).toBeUndefined()
  })

  test('what the engine takes is said done once it is taken', async () => {
    const played = world()
    played.listeners.spec(spec())
    await flush()
    await expect(played.following.giveVision('Keep it small')).resolves.toBeUndefined()
  })

  test('an answer pressed again while the first is on its way is sent once', async () => {
    const sent: Array<() => void> = []
    const played = world({
      answer: () =>
        new Promise<void>((resolve) => {
          sent.push(resolve)
        }),
    })
    played.listeners.spec(spec())
    await flush()
    const first = played.following.answer('Q1', { optionId: 'A' })
    const again = played.following.answer('Q1', { optionId: 'A' })
    expect(again).toBe(first)
    expect(sent).toHaveLength(1)
    sent[0]?.()
    await first
    void played.following.answer('Q1', { optionId: 'B' })
    expect(sent).toHaveLength(2)
  })

  test('a second quick message on an item does not open its discussion again', async () => {
    let opened = 0
    const played = world({
      openDiscussion: () => {
        opened += 1
        return new Promise(() => undefined)
      },
    })
    played.listeners.spec(spec())
    await flush()
    const item = { kind: 'question' as const, id: 'Q2' }
    const first = played.following.say(item, 'Why not both?')
    const again = played.following.say(item, 'And for a shared note?')
    expect(again).toBe(first)
    expect(opened).toBe(1)
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
    // Accept and Close both end it: one at a time.
    await played.following.accept(item)
    await played.following.close(item, null)
    expect(played.named('sayInDiscussion')[0]?.args).toEqual(['d1', 'And for a shared note?'])
    expect(played.named('acceptDiscussion')[0]?.args).toEqual(['d1', AT])
    expect(played.named('closeDiscussion')[0]?.args).toEqual(['d1', null])
  })

  test('a living requirement that could not be read is asked again at the next read', async () => {
    let asked = 0
    const played = world({
      livingSpecRequirement: (id) => {
        asked += 1
        if (asked === 1) return Promise.reject(new Error('The engine did not answer in time.'))
        return Promise.resolve({
          id,
          domainId: 'notes',
          domain: 'Notes',
          text: 'A note is printed.',
          scenarios: [],
          origin: null,
          state: 'validated',
          uncertainty: '',
          version: 1,
          removed: false,
          pending: null,
          history: [],
        })
      },
    })
    played.listeners.spec(
      spec({ requirements: [requirement({ delta: 'modified', livingRef: 'LR4' })] }),
    )
    await flush()
    expect(played.last().data?.requirements[0]?.living?.text ?? null).toBeNull()
    played.listeners.passes([PASS])
    await flush()
    expect(asked).toBe(2)
    expect(played.last().data?.requirements[0]?.living?.text).toBe('A note is printed.')
    played.listeners.passes([PASS])
    await flush()
    expect(asked).toBe(2)
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
