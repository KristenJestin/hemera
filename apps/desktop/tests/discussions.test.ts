/**
 * The Discuss conversations (#87): the user and the Planner on one item of the Spec, in Planning
 * only, closed by the user on a decision or without one. On the engine as it starts, with the fake
 * agent of #32 scripting the Planner (never a real agent), a temporary data folder, and a
 * temporary Git repository as the Project's main checkout.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEC_SECTIONS, TOOL_NAMES, toolsOf } from '@hemera/core/domain'
import type { DiscussionItem } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Option, Predicate, Result, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { listColdReads } from '../src/engine/planning/cold-read-store.ts'
import { discussionsOf, readDiscussion } from '../src/engine/planning/discussion-store.ts'
import {
  acceptProposal,
  closeDiscussion,
  discussionChanges,
  missionLocksKept,
  openDiscussion,
  recordSay,
  sayInDiscussion,
} from '../src/engine/planning/discussions.ts'
import { giveVision } from '../src/engine/planning/calls.ts'
import { receiveInput } from '../src/engine/planning/inputs.ts'
import { inputsOf } from '../src/engine/planning/questions.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { PlannerWake } from '../src/engine/planning/wake.ts'
import { createProject } from '../src/engine/projects.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { memoryJournal, sessionDeliveries } from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { git, repository } from './repositories.ts'
import {
  BUILDER,
  HELPER,
  agentsFound,
  type World,
  held,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('discussions'))
  work = realpathSync.native(temporaryFolder('discussions-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

const reply = (id: string, discussion: string, words: string) =>
  uses(id, 'discussion_reply', { discussion, text: words })

const propose = (id: string, discussion: string, decision: string) =>
  uses(id, 'discussion_propose_decision', { discussion, decision })

const declare = (id: string) => uses(id, 'declare_complete', { why: 'A Builder can build it.' })

const requirement = (id: string, words: string, when: string, then: string) =>
  uses(id, 'requirement_write', {
    domain: 'invoices',
    delta: 'added',
    text: words,
    scenarios: [{ when, then }],
  })

/** The Planner's first turn: a whole Spec, R1 to R3, the mission named, its proofs, tasks and model; version 15. */
const WRITE_SPEC: ReadonlyArray<FakeStep> = [
  ...SPEC_SECTIONS.map((section, at) =>
    uses(`toolu_section_${String(at)}`, 'spec_write_section', {
      section,
      content: `The ${section}.`,
      base_version: 0,
    }),
  ),
  requirement('toolu_r1', 'Invoices export as CSV.', 'the user exports', 'a CSV file is saved'),
  requirement(
    'toolu_r2',
    'The export names its file after the month.',
    'the user exports March',
    'the file is named after March',
  ),
  requirement(
    'toolu_r3',
    'An empty month exports the header only.',
    'a month has no invoice',
    'the file holds the header only',
  ),
  uses('toolu_describe', 'mission_describe', { title: 'Invoices as CSV', type: 'feature' }),
  // What #90 asks of a complete Spec beside the inputs and the discussions: proofs, tasks, a model.
  ...['R1.S1', 'R2.S1', 'R3.S1'].map((scenario, at) =>
    uses(`toolu_proof_${String(at)}`, 'proof_write', {
      scenario,
      proof: {
        mode: 'by_hand',
        actions: ['Export the invoices', 'Open the saved file'],
        starting_data: 'Two invoices of March.',
        expected: 'The file is as the scenario says.',
        seen_today: false,
      },
      base_version: 0,
    }),
  ),
  uses('toolu_tasks', 'tasks_write', {
    tasks: [
      {
        title: 'Export as CSV',
        result: 'The invoices export as CSV, one file per month.',
        requirements: ['R1', 'R2', 'R3'],
        scenarios: ['R1.S1', 'R2.S1', 'R3.S1'],
        targets: [],
        depends_on: [],
      },
    ],
    base_version: 0,
  }),
  uses('toolu_model', 'model_recommend', {
    agent: 'claude',
    model: 'large',
    reason: 'One export: a small change.',
  }),
]

const R2: DiscussionItem = { kind: 'requirement', id: 'R2' }
const R3: DiscussionItem = { kind: 'requirement', id: 'R3' }

/** A Planner that writes the Spec first, then does what each later turn says. */
const plannerScript = (...later: ReadonlyArray<ReadonlyArray<FakeStep>>): FakeScript => ({
  turns: [WRITE_SPEC, ...later],
  steps: [says('Done.')],
})

/** #91: the cold read a first declaration launches, the next agent started; it reports nothing. */
const COLD_READ: FakeScript = {
  turns: [[uses('toolu_cold_read_report', 'cold_read_report', { findings: [] })]],
  steps: [says('Done.')],
}

/** Waits until the mission's cold read has ended with its report. */
const coldReadEnded = (missionId: string) =>
  until(
    Effect.map(listColdReads(missionId), (passes) => passes.some((one) => one.state === 'done')),
  )

/** The engine with the Planner starting on its own, its agents scripted in their start order. */
const planning = (scriptOf: (index: number) => FakeScript) =>
  sessionsEngine(data, scriptOf, { roles: [BUILDER, HELPER], sessions: { plannerStarts: true } })

/** Acme, its main checkout holding the repository `api`. */
const acme = Effect.suspend(() =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    const api = repository(join(main, 'api'))
    writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'invoices')
    return yield* createProject({ name: 'Acme', mainCheckout: main, repositories: ['api'] })
  }),
)

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const plannersOf = (missionId: string) =>
  Effect.map(sessionsIn(LIVE, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => row.role === 'planner'),
  )

const plannerStarted = (missionId: string) =>
  Effect.gen(function* () {
    yield* until(Effect.map(plannersOf(missionId), (rows) => rows.length > 0))
    const [planner] = yield* plannersOf(missionId)
    if (planner === undefined) return yield* Effect.die(new Error('no Planner'))
    return planner
  })

const settled = (session: RoleSession) => Sessions.use((sessions) => sessions.settled(session.id))

/** A mission of Acme, its Planner started on its own and its first turn over. */
const missionPlanned = (projectId: string, sentence = 'Export the invoices as CSV') =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const planner = yield* plannerStarted(mission.id)
    yield* settled(planner)
    return { mission, planner }
  })

const promptsOf = (world: World, at = 0) => world.agents[at]?.answers.prompts ?? []

/** Waits until the agent was prompted so many times, then for its turn to end. */
const prompted = (world: World, planner: RoleSession, count: number, at = 0) =>
  Effect.gen(function* () {
    yield* until(Effect.sync(() => promptsOf(world, at).length >= count))
    yield* settled(planner)
  })

const promptText = (world: World, index: number, at = 0) => text(promptsOf(world, at)[index] ?? [])

const answersOf = (world: World, at = 0) =>
  world.agents[at]?.answers.toolAnswers.map((one) => one.text) ?? []

/** Waits until the mission's Journal holds a line that starts so. */
const journalHas = (missionId: string, start: string) =>
  until(
    Effect.gen(function* () {
      const database = yield* Database
      const lines = yield* database
        .select({ text: memoryJournal.text })
        .from(memoryJournal)
        .where(eq(memoryJournal.missionId, missionId))
      return lines.some((line) => line.text.startsWith(start))
    }),
  )

const deliveriesOf = (missionId: string, kind: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(sessionDeliveries)
      .where(and(eq(sessionDeliveries.ownerId, missionId), eq(sessionDeliveries.kind, kind)))
  })

/** The mission's inputs (CT-26), by id: kind, item and state. */
const inputsNow = (missionId: string) =>
  Effect.map(inputsOf(missionId), (inputs) =>
    Object.fromEntries(inputs.map((input) => [input.id, [input.kind, input.item, input.state]])),
  )

/** When the pending proposal the user reads was made. */
const proposedAt = (discussionId: string) =>
  Effect.gen(function* () {
    const discussion = yield* readDiscussion(discussionId)
    if (discussion.proposal === null) return yield* Effect.die(new Error('nothing proposed'))
    return discussion.proposal.at
  })

const integrated = (id: string, input: string, where: string) =>
  uses(id, 'input_integrated', { id: input, where })

const BALLS = ['AgentWorking', 'WaitingOnYou', 'WaitingOnSomeone', 'Blocked', 'Idle'] as const

/** Who has the mission's ball, by its tag. */
const ballOf = (missionId: string) =>
  Effect.map(getMission(missionId), (one) => BALLS.find((tag) => Predicate.isTagged(one.ball, tag)))

describe('Opening a discussion delivers [hemera:discuss] to the Planner', () => {
  test('on R2 it carries R2’s text and the message; a second one on R2 is refused naming it, one on R3 is accepted', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const first = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          const again = yield* openDiscussion(mission.id, R2, 'Another thought.').pipe(Effect.flip)
          const other = yield* openDiscussion(mission.id, R3, 'Is a header alone useful?')
          yield* prompted(world, planner, 3)
          return { first, again, other, list: yield* discussionsOf(mission.id) }
        }),
      ),
    )
    const delivered = promptText(world, 1)
    expect(delivered).toMatch(/^\[hemera:discuss\]\n/)
    expect(delivered).toContain('#1 on R2')
    expect(delivered).toContain('The export names its file after the month.')
    expect(delivered).toContain('WHEN the user exports March THEN the file is named after March')
    expect(delivered).toContain('Why one file per month?')
    expect(seen.first).toMatchObject({
      label: '#1',
      item: R2,
      state: 'open',
      messages: [{ author: 'user', text: 'Why one file per month?', proposal: false }],
    })
    expect(Predicate.isTagged(seen.again, 'PlanningRefused')).toBe(true)
    expect(seen.again.message).toBe('R2 already has an open discussion: #1.')
    expect(seen.other).toMatchObject({ label: '#2', item: R3, state: 'open' })
    expect(promptText(world, 2)).toContain('#2 on R3')
    expect(seen.list.map((one) => [one.label, one.item.id, one.state])).toEqual([
      ['#1', 'R2', 'open'],
      ['#2', 'R3', 'open'],
    ])
    // The refused one reached nobody.
    expect(promptsOf(world)).toHaveLength(3)
  })

  test('on a Ready mission, or on an item that does not exist: refused, and nothing is delivered', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const missing = yield* Effect.forEach(
            [
              { kind: 'requirement', id: 'R9' },
              { kind: 'scenario', id: 'R1.S9' },
              { kind: 'section', id: 'summary' },
              { kind: 'decision', id: 'D1' },
              { kind: 'question', id: 'Q1' },
            ] satisfies ReadonlyArray<DiscussionItem>,
            (item) => openDiscussion(mission.id, item, 'About this.').pipe(Effect.flip),
          )
          const section = yield* openDiscussion(
            mission.id,
            { kind: 'section', id: 'risks' },
            'What could go wrong?',
          )
          yield* prompted(world, planner, 2)
          const ready = yield* missionPlanned(project.id, 'Import the invoices')
          yield* moveMission(ready.mission.id, 'freeze', 'user')
          const frozen = yield* openDiscussion(ready.mission.id, R2, 'Too late.').pipe(Effect.flip)
          return { missing, section, frozen, readyList: yield* discussionsOf(ready.mission.id) }
        }),
      ),
    )
    expect(seen.missing.map((one) => one.message)).toEqual([
      'ACME-1 has no requirement R9.',
      'ACME-1 has no scenario R1.S9.',
      'ACME-1 has no section summary.',
      'ACME-1 has no decision D1.',
      'ACME-1 has no question Q1.',
    ])
    expect(seen.section).toMatchObject({ label: '#1', item: { kind: 'section', id: 'risks' } })
    expect(promptText(world, 1)).toContain('#1 on Risks & trade-offs')
    expect(promptText(world, 1)).toContain('The risks.')
    expect(promptsOf(world)).toHaveLength(2)
    expect(Predicate.isTagged(seen.frozen, 'PlanningRefused')).toBe(true)
    expect(seen.frozen.message).toBe(
      'ACME-2 is not in Planning: a discussion is for a mission in Planning.',
    )
    expect(seen.readyList).toEqual([])
    // The Ready mission's Planner got its brief only.
    expect(promptsOf(world, 1)).toHaveLength(1)
  })

  test('on a question of a wave, it carries the question as #86 keeps it', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          ...WRITE_SPEC,
          uses('toolu_wave', 'ask_wave', {
            questions: [
              {
                text: 'Which separator does the CSV use?',
                why: 'The export depends on it.',
                options: [
                  { label: 'Comma', detail: 'Choosing Comma.' },
                  { label: 'Semicolon', detail: 'Choosing Semicolon.' },
                ],
                recommended: 1,
                recommended_reason: 'The api repository already writes it so.',
              },
            ],
          }),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(
            mission.id,
            { kind: 'question', id: 'Q1' },
            'Does the accounting tool care?',
          )
          yield* prompted(world, planner, 2)
          return { opened }
        }),
      ),
    )
    expect(seen.opened).toMatchObject({ label: '#1', item: { kind: 'question', id: 'Q1' } })
    const delivered = promptText(world, 1)
    expect(delivered).toContain('#1 on Q1')
    expect(delivered).toContain('Which separator does the CSV use?')
    expect(delivered).toContain('Does the accounting tool care?')
  })

  test('two opened at once on one item: one opens, the other is refused naming it', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const both = yield* Effect.all(
            [
              openDiscussion(mission.id, R2, 'First click.').pipe(Effect.result),
              openDiscussion(mission.id, R2, 'Second click.').pipe(Effect.result),
            ],
            { concurrency: 'unbounded' },
          )
          yield* prompted(world, planner, 2)
          return {
            both,
            list: yield* discussionsOf(mission.id),
            delivered: yield* deliveriesOf(mission.id, 'discuss'),
          }
        }),
      ),
    )
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    const [refused] = seen.both.filter(Result.isFailure)
    expect(refused?.failure.message).toBe('R2 already has an open discussion: #1.')
    expect(seen.list).toHaveLength(1)
    expect(seen.list[0]?.messages).toHaveLength(1)
    expect(seen.delivered).toHaveLength(1)
  })
})

describe('The Planner replies and proposes; only the user decides', () => {
  test('a reply and a proposal are the agent’s messages; completeness is refused while the proposal is pending, naming the discussion', async () => {
    const { world, run } = planning(() =>
      plannerScript([
        reply('toolu_reply', '#1', 'The month comes from the invoice date.'),
        propose('toolu_propose', '#1', 'Name the file invoices-YYYY-MM.csv.'),
        declare('toolu_declare'),
      ]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const project = yield* acme
            const { mission, planner } = yield* missionPlanned(project.id)
            const changed = yield* discussionChanges(mission.id).pipe(
              Stream.filter((list) => list[0]?.proposal !== null && list[0] !== undefined),
              Stream.runHead,
              Effect.forkScoped,
            )
            yield* openDiscussion(mission.id, R2, 'Why one file per month?')
            yield* prompted(world, planner, 2)
            yield* journalHas(mission.id, 'The Planner proposed a decision in #1')
            return {
              discussion: (yield* discussionsOf(mission.id))[0],
              streamed: yield* Fiber.join(changed),
              spec: yield* readSpec(mission.id),
              ball: yield* ballOf(mission.id),
              inputs: yield* inputsNow(mission.id),
            }
          }),
        ),
      ),
    )
    const [replied, proposed, refused] = answersOf(world).slice(-3)
    expect(replied).toBe('Your reply is in #1.')
    expect(proposed).toBe(
      'Your proposal is pending in #1: the user accepts it, writes another decision, or ends the discussion without one.',
    )
    expect(refused?.split('\n')).toEqual([
      'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
      '- I1: Input I1 (the decision #1) waits on the user: they accept the proposal, or close the discussion.',
      '- #1: #1 on R2 is still open: the user closes it, with a decision or without.',
    ])
    // The decision in transit is an input of the register, received, never sent back to its author.
    expect(seen.inputs).toEqual({ I1: ['discuss_decision', '#1', 'received'] })
    expect(promptsOf(world).some((prompt) => text(prompt).includes('[hemera:decision]'))).toBe(
      false,
    )
    expect(seen.spec.declaredCompleteVersion).toBeNull()
    expect(seen.discussion?.messages.map((one) => [one.author, one.text, one.proposal])).toEqual([
      ['user', 'Why one file per month?', false],
      ['agent', 'The month comes from the invoice date.', false],
      ['agent', 'Name the file invoices-YYYY-MM.csv.', true],
    ])
    expect(seen.discussion?.proposal?.text).toBe('Name the file invoices-YYYY-MM.csv.')
    expect(Option.getOrNull(seen.streamed)?.[0]?.proposal?.text).toBe(
      'Name the file invoices-YYYY-MM.csv.',
    )
    expect(seen.ball).toBe('WaitingOnYou')
  })

  test('accepting closes on the proposal as written and delivers [hemera:decision] once, even accepted twice at once; the Planner writes it into Decisions with the link', async () => {
    const { world, run } = planning((index) =>
      index > 0
        ? COLD_READ
        : plannerScript(
            [propose('toolu_propose', '#1', 'Name the file invoices-YYYY-MM.csv.')],
            [
              uses('toolu_decisions', 'spec_write_section', {
                section: 'decisions',
                content: 'Name the file invoices-YYYY-MM.csv (discussion #1).',
                base_version: 1,
              }),
              declare('toolu_declare_early'),
              integrated('toolu_integrated', 'I2', 'decisions'),
              declare('toolu_declare'),
            ],
          ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          const seenAt = yield* proposedAt(opened.id)
          const both = yield* Effect.all(
            [
              acceptProposal(opened.id, seenAt).pipe(Effect.result),
              acceptProposal(opened.id, seenAt).pipe(Effect.result),
            ],
            { concurrency: 'unbounded' },
          )
          yield* prompted(world, planner, 3)
          yield* journalHas(mission.id, 'The user closed #1 on R2 on a decision')
          yield* coldReadEnded(mission.id)
          return {
            both,
            discussion: yield* readDiscussion(opened.id),
            spec: yield* readSpec(mission.id),
            decisions: yield* deliveriesOf(mission.id, 'decision'),
            ball: yield* ballOf(mission.id),
            inputs: yield* inputsNow(mission.id),
          }
        }),
      ),
    )
    expect(seen.both.filter(Result.isSuccess)).toHaveLength(1)
    const [refused] = seen.both.filter(Result.isFailure)
    expect(refused?.failure.message).toBe('#1 is closed: nothing more is said in it.')
    expect(seen.decisions).toHaveLength(1)
    const delivered = promptText(world, 2)
    expect(delivered).toMatch(/^\[hemera:decision\]\nI2 · /)
    expect(delivered).toContain('#1 on R2')
    expect(delivered).toContain('Name the file invoices-YYYY-MM.csv.')
    expect(delivered).toContain('input_integrated')
    // The proposal's input is superseded by the decision's; the Planner integrates that one.
    expect(seen.inputs).toEqual({
      I1: ['discuss_decision', '#1', 'superseded'],
      I2: ['discuss_decision', '#1', 'integrated'],
    })
    expect(answersOf(world).slice(-3)).toEqual([
      [
        'refused: the Spec is not complete, and nothing was recorded. Fix each of these, then declare again:',
        '- I2: Input I2 (the decision #1) is not integrated: integrate it, then call input_integrated.',
      ].join('\n'),
      'I2 is integrated (decisions).',
      'Declared complete at version 16. The user is told, with your reason.',
    ])
    expect(seen.discussion).toMatchObject({
      state: 'closed',
      outcome: 'decision',
      decision: 'Name the file invoices-YYYY-MM.csv.',
      proposal: null,
      closedBy: 'user',
    })
    expect(seen.discussion.closedAt).not.toBeNull()
    expect(seen.spec.sections.find((one) => one.name === 'decisions')?.body).toBe(
      'Name the file invoices-YYYY-MM.csv (discussion #1).',
    )
    expect(seen.ball).toBe('Idle')
  })

  test('closing without a decision withdraws the pending proposal, is delivered as information, and blocks nothing', async () => {
    const { world, run } = planning((index) =>
      index > 0
        ? COLD_READ
        : plannerScript(
            [propose('toolu_propose', '#1', 'Name the file invoices-YYYY-MM.csv.')],
            [integrated('toolu_integrated', 'I1', 'decisions'), declare('toolu_declare')],
          ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          yield* closeDiscussion(opened.id, { noDecision: true })
          yield* prompted(world, planner, 3)
          yield* journalHas(mission.id, 'The user closed #1 on R2 without a decision')
          return {
            discussion: yield* readDiscussion(opened.id),
            inputs: yield* inputsNow(mission.id),
          }
        }),
      ),
    )
    const delivered = promptText(world, 2)
    expect(delivered).toMatch(/^\[hemera:discussion-closed\]\n/)
    expect(delivered).toContain('#1 on R2')
    expect(delivered).toContain('without a decision')
    expect(seen.discussion).toMatchObject({
      state: 'closed',
      outcome: 'no_decision',
      decision: null,
      proposal: null,
      closedBy: 'user',
    })
    // Withdrawn: superseded by nothing, so there is nothing to integrate.
    expect(seen.inputs).toEqual({ I1: ['discuss_decision', '#1', 'superseded'] })
    expect(answersOf(world).slice(-2)).toEqual([
      'refused: I1 was withdrawn: nothing to integrate.',
      'Declared complete at version 15. The user is told, with your reason.',
    ])
  })

  test('closing without a decision withdraws only the discussion’s decision: another kind of input on the same item stays to integrate', async () => {
    const { run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* mutate('receiving an input of another kind', (transaction) =>
            Effect.map(
              receiveInput(transaction, {
                missionId: mission.id,
                kind: 'dismissed_finding',
                item: '#1',
                version: null,
                said: 'The user dismissed finding #1: the api already pads the month.',
                supersedes: false,
              }),
              (id) => ({ result: id, events: [] }),
            ),
          )
          yield* closeDiscussion(opened.id, { noDecision: true })
          return yield* inputsNow(mission.id)
        }),
      ),
    )
    expect(seen['I1']?.slice(0, 2)).toEqual(['dismissed_finding', '#1'])
    expect(['received', 'delivered']).toContain(seen['I1']?.[2])
  })

  test('a pending proposal waits on the user, not on the Planner: a fresh Planner starts in mode draft, not answers', async () => {
    const { world, run } = planning((index) =>
      index === 0
        ? plannerScript([propose('toolu_propose', '#1', 'One file per month.')])
        : { steps: [says('Back.')] },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          yield* PlannerWake.use((wake) => wake.deliver(mission.id, 'update', 'Go on.'))
          yield* until(Effect.sync(() => promptsOf(world, 1).length >= 1))
          return yield* inputsNow(mission.id)
        }),
      ),
    )
    expect(seen).toEqual({ I1: ['discuss_decision', '#1', 'received'] })
    expect(promptText(world, 0, 1)).toMatch(
      /^\[hemera:brief\]\n## Planner · ACME-1 · Invoices as CSV\n\nMode: draft\n/,
    )
  })

  test('a pending proposal is never sent back to the Planner: a vision given meanwhile travels alone', async () => {
    const { world, run } = planning(() =>
      plannerScript([propose('toolu_propose', '#1', 'Name the file invoices-YYYY-MM.csv.')]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          yield* giveVision(mission.id, 'Keep the export small.')
          yield* prompted(world, planner, 3)
          return { inputs: yield* inputsNow(mission.id) }
        }),
      ),
    )
    const vision = promptText(world, 2)
    expect(vision).toMatch(/^\[hemera:vision\]\nI2 · /)
    expect(vision).not.toContain('I1')
    expect(vision).not.toContain('invoices-YYYY-MM')
    expect(promptsOf(world).some((prompt) => text(prompt).includes('[hemera:decision]'))).toBe(
      false,
    )
    expect(seen.inputs).toEqual({
      I1: ['discuss_decision', '#1', 'received'],
      I2: ['vision', expect.any(String), 'delivered'],
    })
  })

  test('a new proposal replaces the pending one; accepting with nothing proposed, or closing on an empty decision, is refused; the user may write the decision', async () => {
    const { world, run } = planning(() =>
      plannerScript([
        propose('toolu_first', '#1', 'One file per month.'),
        propose('toolu_second', '#1', 'One file per month, named after it.'),
      ]),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          const early = yield* acceptProposal(opened.id, '2026-10-08T08:00:00.000Z').pipe(
            Effect.flip,
          )
          yield* prompted(world, planner, 2)
          const pending = yield* readDiscussion(opened.id)
          const empty = yield* closeDiscussion(opened.id, { decision: '  ' }).pipe(Effect.flip)
          const closed = yield* closeDiscussion(opened.id, { decision: 'One file per year.' })
          yield* prompted(world, planner, 3)
          return { early, pending, empty, closed }
        }),
      ),
    )
    expect(seen.early.message).toBe('#1 has no proposal to accept.')
    expect(seen.pending.proposal?.text).toBe('One file per month, named after it.')
    expect(seen.pending.messages.filter((one) => one.proposal).map((one) => one.text)).toEqual([
      'One file per month.',
      'One file per month, named after it.',
    ])
    expect(seen.empty.message).toBe('A decision needs some text.')
    expect(seen.closed).toMatchObject({ outcome: 'decision', decision: 'One file per year.' })
    expect(promptText(world, 2)).toContain('One file per year.')
  })

  test('the Planner proposes P2 while the user accepts P1: the accept is refused, nothing closes, and P2 is accepted once read', async () => {
    const { world, run } = planning(() =>
      plannerScript(
        [propose('toolu_p1', '#1', 'One file per month.')],
        [propose('toolu_p2', '#1', 'One file per month, named after it.')],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          // The user reads P1; the Planner then proposes P2, the user not having seen it.
          const p1 = yield* proposedAt(opened.id)
          yield* sayInDiscussion(opened.id, 'And its name?')
          yield* prompted(world, planner, 3)
          const stale = yield* acceptProposal(opened.id, p1).pipe(Effect.flip)
          const after = yield* readDiscussion(opened.id)
          const p2 = yield* proposedAt(opened.id)
          const accepted = yield* acceptProposal(opened.id, p2)
          return { stale, after, p1, p2, accepted, inputs: yield* inputsNow(mission.id) }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.stale, 'PlanningRefused')).toBe(true)
    expect(seen.stale.message).toBe(
      'The proposal in #1 changed since you read it: read “One file per month, named after it.”, then accept it or decide otherwise.',
    )
    expect(seen.after).toMatchObject({
      state: 'open',
      proposal: { text: 'One file per month, named after it.' },
    })
    expect(seen.p2 > seen.p1).toBe(true)
    expect(seen.accepted).toMatchObject({
      state: 'closed',
      outcome: 'decision',
      decision: 'One file per month, named after it.',
    })
  })

  test('an accept racing a new proposal: either the accept closes on the proposal read and the new one is refused, or the accept is refused', async () => {
    const turn = held()
    let holding = false
    const { world, run } = planning(() => ({
      ...plannerScript(
        [propose('toolu_p1', '#1', 'One file per month.')],
        [propose('toolu_p2', '#1', 'One file per month, named after it.')],
      ),
      between: () => (holding ? turn.promise : Promise.resolve()),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          const p1 = yield* proposedAt(opened.id)
          holding = true
          yield* sayInDiscussion(opened.id, 'And its name?')
          // The turn that proposes P2 began, and holds before it.
          yield* until(Effect.sync(() => promptsOf(world).length === 3))
          holding = false
          const [accept] = yield* Effect.all(
            [acceptProposal(opened.id, p1).pipe(Effect.result), Effect.sync(() => turn.release())],
            { concurrency: 'unbounded' },
          )
          yield* settled(planner)
          return { accept, discussion: yield* readDiscussion(opened.id) }
        }),
      ),
    )
    const proposedTwo = answersOf(world).at(-1)
    if (Result.isSuccess(seen.accept)) {
      expect(seen.discussion).toMatchObject({ state: 'closed', decision: 'One file per month.' })
      expect(proposedTwo).toBe('refused: #1 is closed: nothing more is said in it.')
    } else {
      expect(seen.accept.failure.message).toBe(
        'The proposal in #1 changed since you read it: read “One file per month, named after it.”, then accept it or decide otherwise.',
      )
      expect(seen.discussion).toMatchObject({
        state: 'open',
        proposal: { text: 'One file per month, named after it.' },
      })
    }
  })

  test('the Planner cannot close a discussion, and says nothing more in a closed one', async () => {
    expect(toolsOf('planner')).toEqual(
      expect.arrayContaining(['discussion_reply', 'discussion_propose_decision']),
    )
    expect(TOOL_NAMES.filter((name) => name.startsWith('discussion_'))).toEqual([
      'discussion_reply',
      'discussion_propose_decision',
    ])
    const { world, run } = planning(() =>
      plannerScript(
        [says('Reading R2.')],
        [
          reply('toolu_late', '#1', 'Too late.'),
          propose('toolu_late_proposal', '#1', 'Too late.'),
          reply('toolu_unknown', '#7', 'Nowhere.'),
        ],
      ),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          yield* closeDiscussion(opened.id, { noDecision: true })
          yield* prompted(world, planner, 3)
          const said = yield* sayInDiscussion(opened.id, 'One more thing.').pipe(Effect.flip)
          return { said, discussion: yield* readDiscussion(opened.id) }
        }),
      ),
    )
    expect(answersOf(world).slice(-3)).toEqual([
      'refused: #1 is closed: nothing more is said in it.',
      'refused: #1 is closed: nothing more is said in it.',
      'refused: ACME-1 has no discussion #7.',
    ])
    expect(seen.said.message).toBe('#1 is closed: nothing more is said in it.')
    expect(seen.discussion.messages).toHaveLength(1)
  })
})

describe('A message reaches the Planner without ever cancelling a turn', () => {
  test('during a Planner turn it waits for the turn’s end; an idle Planner is woken', async () => {
    const turn = held()
    const { world, run } = planning(() => ({
      turns: [[says('Reading.'), says('Still reading.')]],
      steps: [says('Done.')],
      between: () => turn.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          yield* until(Effect.sync(() => promptsOf(world).length === 1))
          const opened = yield* openDiscussion(
            mission.id,
            { kind: 'section', id: 'why' },
            'Is it worth it?',
          )
          const during = promptsOf(world).length
          turn.release()
          yield* prompted(world, planner, 2)
          yield* sayInDiscussion(opened.id, 'Who asked for it?')
          yield* prompted(world, planner, 3)
          return { during }
        }),
      ),
    )
    expect(seen.during).toBe(1)
    expect(world.agents[0]?.answers.cancels).toBe(0)
    expect(promptText(world, 1)).toContain('Is it worth it?')
    const woken = promptText(world, 2)
    expect(woken).toMatch(/^\[hemera:discuss\]\n/)
    // The whole discussion so far, the new message last.
    expect(woken.indexOf('Is it worth it?')).toBeLessThan(woken.indexOf('Who asked for it?'))
  })

  test('with no live Planner, a fresh one starts in mode discuss with the discussion', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          const fresh = yield* plannerStarted(mission.id)
          yield* settled(fresh)
          return { fresh, planner }
        }),
      ),
    )
    expect(seen.fresh.id).not.toBe(seen.planner.id)
    const first = promptText(world, 0, 1)
    expect(first).toMatch(
      /^\[hemera:brief\]\n## Planner · ACME-1 · Invoices as CSV\n\nMode: discuss/,
    )
    expect(first).toContain('[hemera:discuss]')
    expect(first).toContain('Why one file per month?')
  })

  test('a message racing the close: it lands before the close and is delivered before it, or it is refused and delivered nowhere', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          const [said] = yield* Effect.all(
            [
              sayInDiscussion(opened.id, 'One more thing.').pipe(Effect.result),
              closeDiscussion(opened.id, { decision: 'One file per month.' }),
            ],
            { concurrency: 'unbounded' },
          )
          yield* until(
            Effect.sync(() =>
              promptsOf(world).some((prompt) => text(prompt).includes('[hemera:decision]')),
            ),
          )
          yield* settled(planner)
          return { said, discussion: yield* readDiscussion(opened.id) }
        }),
      ),
    )
    const everything = promptsOf(world)
      .map((prompt) => text(prompt))
      .join('\n')
    const texts = seen.discussion.messages.map((one) => one.text)
    if (Result.isSuccess(seen.said)) {
      expect(texts).toEqual(['Why one file per month?', 'One more thing.'])
      expect(everything.indexOf('One more thing.')).toBeGreaterThan(-1)
      expect(everything.indexOf('One more thing.')).toBeLessThan(
        everything.indexOf('[hemera:decision]'),
      )
    } else {
      expect(seen.said.failure.message).toBe('#1 is closed: nothing more is said in it.')
      expect(texts).toEqual(['Why one file per month?'])
      expect(everything).not.toContain('One more thing.')
    }
    expect(seen.discussion).toMatchObject({ state: 'closed', decision: 'One file per month.' })
  })
})

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('Each message is stored with its delivery, and delivered once', () => {
  test('three messages said during one Planner turn reach it once, together, at the turn’s end', async () => {
    const turn = held()
    let holding = false
    const { world, run } = planning(() => ({
      ...plannerScript(),
      between: () => (holding ? turn.promise : Promise.resolve()),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          holding = true
          const opened = yield* openDiscussion(mission.id, R2, 'First.')
          // The turn on the discussion began, and holds.
          yield* until(Effect.sync(() => promptsOf(world).length === 2))
          for (const words of ['Second.', 'Third.', 'Fourth.']) {
            yield* sayInDiscussion(opened.id, words)
          }
          holding = false
          turn.release()
          yield* prompted(world, planner, 3)
          return { deliveries: yield* deliveriesOf(mission.id, 'discuss') }
        }),
      ),
    )
    const after = promptsOf(world)
      .slice(2)
      .map((prompt) => text(prompt))
      .join('\n')
    expect(promptsOf(world)).toHaveLength(3)
    expect(occurrences(after, '[hemera:discuss]')).toBe(1)
    for (const words of ['First.', 'Second.', 'Third.', 'Fourth.']) {
      expect(occurrences(after, `- The user: ${words}`)).toBe(1)
    }
    expect(seen.deliveries.filter((one) => one.state === 'sent')).toHaveLength(2)
    expect(seen.deliveries.filter((one) => one.state === 'queued')).toHaveLength(0)
  })

  test('a message stored when the engine stops before handing it over reaches a Planner after the restart, once', async () => {
    const first = planning(() => plannerScript())
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(first.world, planner, 2)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          // Stored, and the engine stops before it hands it over.
          yield* recordSay(opened.id, 'Still there?')
          return { mission }
        }),
      ),
    )
    const second = planning(() => ({ steps: [says('Back.')] }))
    await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.mission.id)
          yield* until(
            Effect.sync(() =>
              promptsOf(second.world).some((prompt) => text(prompt).includes('[hemera:discuss]')),
            ),
          )
          yield* settled(planner)
        }),
      ),
    )
    expect(second.world.agents).toHaveLength(1)
    const told = promptsOf(second.world)
      .map((prompt) => text(prompt))
      .join('\n')
    expect(told).toMatch(
      /^\[hemera:brief\]\n## Planner · ACME-1 · Invoices as CSV\n\nMode: discuss/,
    )
    expect(occurrences(told, '[hemera:discuss]')).toBe(1)
    expect(told.slice(told.indexOf('[hemera:discuss]'))).toContain('- The user: Still there?')
  })
  test('a close without a decision stored while no Planner lives, never handed over: the next Planner is told it once', async () => {
    const first = planning(() => plannerScript())
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(first.world, planner, 2)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          // Stored, and the engine stops before it hands it over.
          const real = yield* PlannerWake
          yield* closeDiscussion(opened.id, { noDecision: true }).pipe(
            Effect.provideService(PlannerWake, {
              start: real.start,
              deliver: () => Effect.succeed(false),
            }),
          )
          return { mission }
        }),
      ),
    )
    const second = planning(() => ({ steps: [says('Back.')] }))
    await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.mission.id)
          yield* until(
            Effect.sync(() =>
              promptsOf(second.world).some((prompt) =>
                text(prompt).includes('[hemera:discussion-closed]'),
              ),
            ),
          )
          yield* settled(planner)
        }),
      ),
    )
    expect(second.world.agents).toHaveLength(1)
    const told = promptsOf(second.world)
      .map((prompt) => text(prompt))
      .join('\n')
    expect(occurrences(told, '[hemera:discussion-closed]')).toBe(1)
    expect(told).toContain('#1 on R2 without a decision')
  })
})

/**
 * The Planner's wake as a gesture sees it, around the engine's own: each hand-over is counted while
 * it runs, and waits for `gate` first when one is given.
 */
const watchedWake = (gate: Deferred.Deferred<void> | null) =>
  Effect.gen(function* () {
    const real = yield* PlannerWake
    const flight = { entered: 0, now: 0, most: 0 }
    const wake: PlannerWake['Service'] = {
      start: real.start,
      deliver: (missionId, kind, body, id) =>
        Effect.gen(function* () {
          flight.entered += 1
          flight.now += 1
          flight.most = Math.max(flight.most, flight.now)
          if (gate !== null) yield* Deferred.await(gate)
          // Leaves room for another gesture to run alongside, were it let.
          for (let step = 0; step < 20; step += 1) yield* Effect.yieldNow
          return yield* real.deliver(missionId, kind, body, id)
        }).pipe(Effect.ensuring(Effect.sync(() => (flight.now -= 1)))),
    }
    return { wake, flight }
  })

describe('Gestures run one at a time per mission, never across the app', () => {
  test('two missions discussing at once are not serialised: one held in its hand-over leaves the other free', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const first = yield* missionPlanned(project.id)
          const second = yield* missionPlanned(project.id, 'Import the invoices')
          const gate = yield* Deferred.make<void>()
          const holder = yield* watchedWake(gate)
          const holding = yield* openDiscussion(
            first.mission.id,
            R2,
            'Why one file per month?',
          ).pipe(Effect.provideService(PlannerWake, holder.wake), Effect.forkChild)
          yield* until(Effect.sync(() => holder.flight.entered === 1))
          // The first mission's gesture holds; the second's goes through, delivered to its Planner.
          const free = yield* openDiscussion(
            second.mission.id,
            R3,
            'Is a header alone useful?',
          ).pipe(Effect.forkChild)
          yield* until(Effect.sync(() => free.pollUnsafe() !== undefined))
          yield* prompted(world, second.planner, 2, 1)
          const whileHeld = yield* discussionsOf(first.mission.id)
          yield* Deferred.succeed(gate, undefined)
          yield* Fiber.join(holding)
          yield* prompted(world, first.planner, 2)
          return { free: yield* Fiber.join(free), whileHeld }
        }),
      ),
    )
    expect(seen.free).toMatchObject({ label: '#1', item: R3, state: 'open' })
    expect(promptText(world, 1, 1)).toContain('Is a header alone useful?')
    // Held in its hand-over, the first gesture was already stored.
    expect(seen.whileHeld.map((one) => one.label)).toEqual(['#1'])
    expect(promptText(world, 1)).toContain('Why one file per month?')
  })

  test('two gestures on one mission are serialised: no two of its hand-overs ever run at once', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const watched = yield* watchedWake(null)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* Effect.all(
            ['Second.', 'Third.', 'Fourth.', 'Fifth.'].map((words) =>
              sayInDiscussion(opened.id, words).pipe(
                Effect.provideService(PlannerWake, watched.wake),
              ),
            ),
            { concurrency: 'unbounded' },
          )
          yield* until(
            Effect.sync(() =>
              promptsOf(world).some((prompt) => text(prompt).includes('- The user: Fifth.')),
            ),
          )
          yield* settled(planner)
          return { flight: watched.flight, discussion: yield* readDiscussion(opened.id) }
        }),
      ),
    )
    expect(seen.flight.entered).toBe(4)
    expect(seen.flight.most).toBe(1)
    expect(seen.discussion.messages).toHaveLength(5)
  })

  test('a mission’s lock is kept only while a gesture holds or waits for it, and never for a mission that does not exist', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* Effect.all(
            ['Second.', 'Third.'].map((words) => sayInDiscussion(opened.id, words)),
            { concurrency: 'unbounded' },
          )
          yield* closeDiscussion(opened.id, { noDecision: true })
          const unknown = yield* openDiscussion('no-such-mission', R2, 'Anyone?').pipe(Effect.flip)
          yield* until(Effect.sync(() => promptsOf(world).length >= 2))
          yield* settled(planner)
          return { unknown, locks: missionLocksKept() }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.unknown, 'UnknownMission')).toBe(true)
    expect(seen.locks).toBe(0)
  })
})

describe('The ball follows the last message', () => {
  test('the user’s last: the agent is working; the agent’s last or a proposal: waiting on you; closed: neither', async () => {
    const turn = held()
    let holding = false
    const { world, run } = planning(() => ({
      ...plannerScript(
        [says('Looking at R2.')],
        [reply('toolu_reply', '#1', 'The month comes from the invoice date.')],
        [propose('toolu_propose', '#1', 'One file per month.')],
      ),
      between: () => (holding ? turn.promise : Promise.resolve()),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const before = yield* ballOf(mission.id)
          holding = true
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          // The Planner's turn that took the message is still running.
          yield* until(Effect.sync(() => promptsOf(world).length === 2))
          const userLast = yield* ballOf(mission.id)
          holding = false
          turn.release()
          yield* prompted(world, planner, 2)
          yield* sayInDiscussion(opened.id, 'Any reason?')
          yield* prompted(world, planner, 3)
          const agentLast = yield* ballOf(mission.id)
          const replied = yield* readDiscussion(opened.id)
          yield* sayInDiscussion(opened.id, 'So?')
          yield* prompted(world, planner, 4)
          const proposed = yield* ballOf(mission.id)
          const pending = yield* readDiscussion(opened.id)
          yield* closeDiscussion(opened.id, { noDecision: true })
          yield* prompted(world, planner, 5)
          return {
            before,
            userLast,
            agentLast,
            replied,
            proposed,
            pending,
            closed: yield* ballOf(mission.id),
          }
        }),
      ),
    )
    expect(seen.before).toBe('Idle')
    expect(seen.userLast).toBe('AgentWorking')
    expect(seen.agentLast).toBe('WaitingOnYou')
    expect(seen.replied.waitsOn).toBe('user')
    expect(seen.proposed).toBe('WaitingOnYou')
    expect(seen.pending.waitsOn).toBe('user')
    expect(seen.closed).toBe('Idle')
  })
})

describe('The ball says agent working only while a Planner works on it', () => {
  test('the user spoke last: agent working while the turn that took it runs; the Planner idle without a reply, waiting on you; none live, not agent working', async () => {
    const turn = held()
    let holding = false
    const { world, run } = planning(() => ({
      ...plannerScript(),
      between: () => (holding ? turn.promise : Promise.resolve()),
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          holding = true
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* until(Effect.sync(() => promptsOf(world).length === 2))
          const working = yield* ballOf(mission.id)
          const workingRead = yield* readDiscussion(opened.id)
          holding = false
          turn.release()
          // The Planner says only "Done." and goes idle: it did not reply.
          yield* prompted(world, planner, 2)
          const silent = yield* ballOf(mission.id)
          const silentRead = yield* readDiscussion(opened.id)
          // Ended, not failed, and the next message is kept without being handed over.
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          yield* recordSay(opened.id, 'Still there?')
          return {
            working,
            workingRead,
            silent,
            silentRead,
            ball: yield* ballOf(mission.id),
            read: yield* readDiscussion(opened.id),
          }
        }),
      ),
    )
    expect(seen.working).toBe('AgentWorking')
    expect(seen.workingRead.waitsOn).toBe('agent')
    expect(seen.silent).toBe('WaitingOnYou')
    expect(seen.silentRead).toMatchObject({ waitsOn: 'user', plannerFailed: null })
    expect(seen.ball).toBe('Idle')
    expect(seen.read).toMatchObject({ waitsOn: 'agent', plannerFailed: null })
  })

  test('after a Planner failure, the discussion shows that failure and waits on you', async () => {
    const { run } = sessionsEngine(data, () => plannerScript(), {
      roles: [BUILDER, HELPER],
      sessions: { plannerStarts: true, discovery: agentsFound(['claude', 'codex', 'opencode']) },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          const opened = yield* openDiscussion(
            mission.id,
            { kind: 'section', id: 'why' },
            'Is it worth it?',
          )
          yield* until(
            Effect.map(
              sessionsIn(['failed'], { kind: 'mission', missionId: mission.id }),
              (rows) => rows.length > 0,
            ),
          )
          yield* until(Effect.map(plannersOf(mission.id), (rows) => rows.length === 0))
          const [failed] = yield* sessionsIn(['failed'], { kind: 'mission', missionId: mission.id })
          return {
            read: yield* readDiscussion(opened.id),
            ball: yield* ballOf(mission.id),
            reason: failed?.stateReason,
          }
        }),
      ),
    )
    expect(seen.reason).toContain('not signed in')
    expect(seen.read).toMatchObject({ waitsOn: 'user', plannerFailed: seen.reason })
    expect(seen.ball).toBe('WaitingOnYou')
  })
})

describe('Discussions outlive the Planner’s session', () => {
  test('a restart reads them back whole, and a message after it reaches the rebuilt Planner with the whole exchange', async () => {
    const first = planning(() =>
      plannerScript([reply('toolu_reply', '#1', 'The month comes from the invoice date.')]),
    )
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(first.world, planner, 2)
          return { mission, opened }
        }),
      ),
    )
    const second = planning(() => ({ steps: [says('Back.')] }))
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.mission.id)
          const read = yield* readDiscussion(before.opened.id)
          yield* sayInDiscussion(before.opened.id, 'Still there?')
          yield* until(
            Effect.sync(() =>
              second.world.agents.some((agent) =>
                agent.answers.prompts.some((prompt) => text(prompt).includes('Still there?')),
              ),
            ),
          )
          yield* settled(planner)
          return { read }
        }),
      ),
    )
    expect(after.read).toMatchObject({ label: '#1', state: 'open' })
    expect(after.read.messages.map((one) => one.text)).toEqual([
      'Why one file per month?',
      'The month comes from the invoice date.',
    ])
    const delivered = second.world.agents
      .flatMap((agent) => agent.answers.prompts.map((prompt) => text(prompt)))
      .find((prompt) => prompt.includes('Still there?'))
    expect(delivered).toContain('[hemera:discuss]')
    expect(delivered).toContain('The month comes from the invoice date.')
  })

  test('a message waiting for a turn when the engine stops reaches the Planner after the restart', async () => {
    let holding = false
    const first = planning(() => ({
      ...plannerScript(),
      between: () => (holding ? new Promise<void>(() => {}) : Promise.resolve()),
    }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          holding = true
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* until(Effect.sync(() => promptsOf(first.world).length === 2))
          // The turn on the discussion holds: this one waits for its end, which never comes.
          yield* sayInDiscussion(opened.id, 'Waiting for you.')
          return { mission, held: promptsOf(first.world).length }
        }),
      ),
    )
    expect(before.held).toBe(2)
    const second = planning(() => ({ steps: [says('Back.')] }))
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.mission.id)
          yield* until(
            Effect.sync(() =>
              second.world.agents.some((agent) =>
                agent.answers.prompts.some((prompt) => text(prompt).includes('Waiting for you.')),
              ),
            ),
          )
          yield* settled(planner)
          return second.world.agents
            .flatMap((agent) => agent.answers.prompts.map((prompt) => text(prompt)))
            .find((prompt) => prompt.includes('Waiting for you.'))
        }),
      ),
    )
    // The Planner replacing the stopped one: in mode discuss, then the message it was waiting with.
    expect(after).toMatch(
      /^\[hemera:brief\]\n## Planner · ACME-1 · Invoices as CSV\n\nMode: discuss/,
    )
    expect(after).toContain('[hemera:resume]')
    expect(after?.slice(after.indexOf('[hemera:discuss]'))).toContain(
      '- The user: Waiting for you.',
    )
  })

  test('a replaced Planner gets the open discussion in its brief', async () => {
    const { world, run } = planning((index) =>
      index === 0
        ? plannerScript([reply('toolu_reply', '#1', 'The month comes from the invoice date.')])
        : { steps: [says('Done.')] },
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          const next = yield* Sessions.use((sessions) =>
            sessions.replace(planner.id, 'its agent stopped'),
          )
          if (next === null) return yield* Effect.die(new Error('not replaced'))
          yield* settled(next)
        }),
      ),
    )
    const brief = promptText(world, 0, 1)
    expect(brief).toContain('Mode: draft')
    expect(brief).toContain('## Open discussions')
    expect(brief).toContain('#1 on R2')
    expect(brief).toContain('Why one file per month?')
    expect(brief).toContain('The month comes from the invoice date.')
  })

  test('a cancel leaves open discussions as they are, readable; nothing more is said or opened', async () => {
    const { world, run } = planning(() => plannerScript())
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const opened = yield* openDiscussion(mission.id, R2, 'Why one file per month?')
          yield* prompted(world, planner, 2)
          yield* moveMission(mission.id, 'cancel', 'user')
          yield* until(Effect.map(plannersOf(mission.id), (rows) => rows.length === 0))
          return {
            list: yield* discussionsOf(mission.id),
            said: yield* sayInDiscussion(opened.id, 'Still?').pipe(Effect.flip),
            closed: yield* closeDiscussion(opened.id, { noDecision: true }).pipe(Effect.flip),
            opened: yield* openDiscussion(mission.id, R3, 'Another?').pipe(Effect.flip),
          }
        }),
      ),
    )
    expect(seen.list.map((one) => [one.label, one.state, one.messages.length])).toEqual([
      ['#1', 'open', 1],
    ])
    for (const refused of [seen.said, seen.closed, seen.opened]) {
      expect(refused.message).toBe(
        'ACME-1 is not in Planning: a discussion is for a mission in Planning.',
      )
    }
  })
})
