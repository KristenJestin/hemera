/**
 * Waves of questions (#86): the Planner asks in waves without ending its turn, the user answers at
 * their own pace, each answer reaches the Planner at its next safe point, and every human input
 * goes received, delivered, integrated (CT-26). On the engine as it starts, with the fake agent of
 * #32 scripting the Planner's tool calls (never a real agent), a temporary data folder, and a
 * temporary Git repository as the Project's main checkout.
 *
 * Rewritten from `hemera-legacy` (`apps/desktop/tests/specs.test.ts`, "An answer resolves the
 * question and is written beside it in the chat"): its refusal cases are kept, the chat is gone.
 */

import { realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SPEC_SECTIONS, WaitingOnSomeoneMark } from '@hemera/core/domain'
import { AgentNotSignedIn } from '@hemera/ipc'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Effect, Fiber, Layer, Option, Predicate, Queue, type Schema, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { createMission, getMission, moveMission } from '../src/engine/missions.ts'
import { listNeeds } from '../src/engine/needs.ts'
import { KINDS } from '../src/engine/notifications.ts'
import { HumanIntent, humanIntentLayer } from '../src/engine/permissions/hemera-auto.ts'
import { answerQuestion, giveVision, waitOnSomeone } from '../src/engine/planning/calls.ts'
import {
  askWave,
  inputsOf,
  openQuestions,
  questionsChanged,
  recordAnswer,
  wavesOf,
} from '../src/engine/planning/questions.ts'
import { readSpec } from '../src/engine/planning/store.ts'
import { PlannerWake } from '../src/engine/planning/wake.ts'
import { createProject } from '../src/engine/projects.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { type RoleSession, sessionsIn } from '../src/engine/sessions/store.ts'
import { DomainEvents } from '../src/engine/domain-events.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  memoryJournal,
  memoryNext,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { git, repository } from './repositories.ts'
import {
  BUILDER,
  HELPER,
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
  data = realpathSync.native(temporaryFolder('waves'))
  work = realpathSync.native(temporaryFolder('waves-work'))
})
afterEach(removeFolders)

const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

const says = (words: string): FakeStep => ({ does: 'says', text: words })

const QUIET: FakeScript = { steps: [says('Nothing to do.')] }

const planning = (
  scriptOf: (index: number) => FakeScript,
  options: Parameters<typeof sessionsEngine>[2] = {},
) =>
  sessionsEngine(data, scriptOf, {
    roles: [BUILDER, HELPER],
    ...options,
    sessions: { plannerStarts: true, ...options.sessions },
  })

/** A Project with its main checkout holding the repository `api`. */
const projectNamed = (name: string, folder: string) =>
  Effect.suspend(() =>
    Effect.gen(function* () {
      const main = join(work, folder)
      const api = repository(join(main, 'api'))
      writeFileSync(join(api, 'invoices.ts'), 'export const invoices = []\n')
      git(api, 'add', '.')
      git(api, 'commit', '-q', '-m', 'invoices')
      return yield* createProject({ name, mainCheckout: main, repositories: ['api'] })
    }),
  )

const acme = projectNamed('Acme', 'acme')

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const plannersOf = (missionId: string) =>
  Effect.map(sessionsIn(LIVE, { kind: 'mission', missionId }), (rows) =>
    rows.filter((row) => row.role === 'planner'),
  )

const plannerStarted = (missionId: string, not: string | null = null) =>
  Effect.gen(function* () {
    yield* until(Effect.map(plannersOf(missionId), (rows) => rows.some((row) => row.id !== not)))
    const [planner] = (yield* plannersOf(missionId)).filter((row) => row.id !== not)
    if (planner === undefined) return yield* Effect.die(new Error('no Planner'))
    return planner
  })

const settled = (session: RoleSession) => Sessions.use((sessions) => sessions.settled(session.id))

/**
 * A mission of a Project, its Planner started on its own and its first turn over: the session is
 * idle once a turn ended (it stays starting until its brief is sent), then nothing waits for it.
 */
const missionPlanned = (projectId: string, sentence = 'Export the invoices as CSV') =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    const planner = yield* plannerStarted(mission.id)
    yield* until(
      Effect.map(plannersOf(mission.id), (rows) =>
        rows.some((row) => row.id === planner.id && row.state === 'idle'),
      ),
    )
    yield* settled(planner)
    return { mission, planner }
  })

/** Wakes the Planner with a delivery of the test's own, and waits for the turn it starts. */
const nudged = (planner: RoleSession) =>
  Effect.gen(function* () {
    yield* Sessions.use((sessions) =>
      sessions.deliver({
        owner: planner.owner,
        target: { lineage: planner.lineage },
        kind: 'update',
        body: 'Go on.',
      }),
    )
    yield* settled(planner)
  })

const question = (
  textOf: string,
  labels: ReadonlyArray<string>,
  extra: Schema.JsonObject = {},
): Schema.JsonObject => ({
  text: textOf,
  why: 'The export depends on it.',
  options: labels.map((label) => ({ label, detail: `Choosing ${label}.` })),
  recommended: 1,
  recommended_reason: 'The api repository already writes it so.',
  ...extra,
})

const SEPARATOR = question('Which separator does the CSV use?', ['Comma', 'Semicolon'])
const WHICH = question('Which invoices are exported?', ['All', 'Paid only'])
const WHERE = question('Where is the file saved?', ['Downloads', 'Ask each time'])

const wave = (id: string, ...questions: ReadonlyArray<Schema.JsonObject>) =>
  uses(id, 'ask_wave', { questions: [...questions] })

const answersOf = (world: World, at = 0) =>
  world.agents[at]?.answers.toolAnswers.map((one) => one.text) ?? []

const promptsOf = (world: World, at = 0) =>
  (world.agents[at]?.answers.prompts ?? []).map((blocks) => text(blocks))

const promptCount = (world: World, at = 0) =>
  Effect.sync(() => world.agents[at]?.answers.prompts.length ?? 0)

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1

const eventsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ type: domainEvents.type, payload: domainEvents.payload })
      .from(domainEvents)
      .where(eq(domainEvents.entityId, missionId))
      .orderBy(asc(domainEvents.sequence))
  })

const inputStates = (missionId: string) =>
  Effect.map(inputsOf(missionId), (inputs) =>
    Object.fromEntries(inputs.map((input) => [input.id, input.state])),
  )

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

/** A hold on one step of a turn: the step at `at` (counted over the agent's life) waits. */
const holdAt = (at: number) => {
  const gate = held()
  let step = 0
  return {
    ...gate,
    between: () => {
      step += 1
      return step === at ? gate.promise : Promise.resolve()
    },
  }
}

describe('The Planner asks in waves', () => {
  test('ask_wave records wave 1 and the turn goes on; refused waves record nothing; a second wave while the first is open is accepted', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [
          uses('toolu_empty', 'ask_wave', { questions: [] }),
          wave('toolu_one', question('Which separator?', ['Comma'])),
          uses('toolu_bare', 'ask_wave', {
            questions: [{ text: 'Which separator?', why: 'It matters.', options: [] }],
          }),
          wave('toolu_wave_1', SEPARATOR, WHICH),
          uses('toolu_read', 'spec_read', {}),
          wave('toolu_wave_2', WHERE),
        ],
      ],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const committed = yield* DomainEvents.use((events) => events.subscribe)
            const asked = yield* committed.pipe(
              Stream.filter((event) => event.type === 'planning.wave_asked'),
              Stream.runHead,
              Effect.forkScoped,
            )
            const project = yield* acme
            const { mission } = yield* missionPlanned(project.id)
            const event = yield* Fiber.join(asked)
            const kind = KINDS.find((one) => one.id === 'questions-asked')
            const notice =
              kind === undefined || Option.isNone(event)
                ? Option.none()
                : yield* kind.notice(event.value, (words) => words)
            const database = yield* Database
            const [next] = yield* database
              .select()
              .from(memoryNext)
              .where(eq(memoryNext.missionId, mission.id))
            yield* journalHas(mission.id, 'The Planner asked wave 1')
            return {
              mission: yield* getMission(mission.id),
              waves: yield* wavesOf(mission.id),
              events: yield* eventsOf(mission.id),
              needs: yield* listNeeds,
              notice,
              kind,
              next,
              projectId: project.id,
            }
          }),
        ),
      ),
    )
    const answers = answersOf(world)
    expect(promptsOf(world)).toHaveLength(1)
    expect(answers[0]).toBe('refused: a wave holds at least one question.')
    expect(answers[1]).toBe('refused: question 1 offers fewer than two options.')
    expect(answers[2]).toMatch(/^refused: /)
    expect(answers[3]).toBe(
      'Wave 1 asked: Q1, Q2. Your turn goes on: work on what does not depend on the answers; they arrive as [hemera:answers].',
    )
    expect(answers[4]).toMatch(/^The Spec of ACME-1 is at version 0/)
    expect(answers[5]).toMatch(/^Wave 2 asked: Q3\./)
    expect(seen.waves.map((one) => [one.number, one.questions.map((q) => q.id)])).toEqual([
      [1, ['Q1', 'Q2']],
      [2, ['Q3']],
    ])
    expect(seen.waves[0]?.questions[0]).toMatchObject({
      id: 'Q1',
      wave: 1,
      text: 'Which separator does the CSV use?',
      why: 'The export depends on it.',
      options: [
        { id: 'A', label: 'Comma', detail: 'Choosing Comma.' },
        { id: 'B', label: 'Semicolon', detail: 'Choosing Semicolon.' },
      ],
      recommended: 'B',
      recommendedReason: 'The api repository already writes it so.',
      state: 'open',
      answers: [],
      drafts: [],
    })
    const types = seen.events.map((one) => one.type)
    expect(types.filter((type) => type === 'planning.wave_asked')).toHaveLength(2)
    expect(
      JSON.parse(seen.events.find((one) => one.type === 'planning.wave_asked')?.payload ?? '{}'),
    ).toMatchObject({
      number: 1,
      questions: ['Q1', 'Q2'],
      texts: ['Which separator does the CSV use?', 'Which invoices are exported?'],
    })
    expect(seen.needs.flatMap((group) => group.needs)).toEqual([])
    expect(seen.mission.needs).toEqual([])
    expect(seen.kind).toMatchObject({ byDefault: true, sound: 'needs-you' })
    expect(Option.getOrNull(seen.notice)).toMatchObject({
      kind: 'questions-asked',
      missionKey: 'ACME-1',
    })
    expect(seen.next?.text).toBe('3 questions wait for you')
    expect(Predicate.isTagged(seen.mission.ball, 'WaitingOnYou')).toBe(true)
  })
})

describe('Each answer reaches the Planner at its next safe point', () => {
  test('an answer given while the Planner is idle wakes it at once, with its input id', async () => {
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Integrating.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          yield* until(
            Effect.map(inputStates(mission.id), (states) => states['I1'] === 'delivered'),
          )
          yield* journalHas(mission.id, 'The user answered Q1')
          return {
            waves: yield* wavesOf(mission.id),
            inputs: yield* inputsOf(mission.id),
            events: yield* eventsOf(mission.id),
          }
        }),
      ),
    )
    const second = promptsOf(world)[1] ?? ''
    expect(second).toMatch(/^\[hemera:answers\]\n/)
    expect(second).toContain('I1 · Q1: B · Semicolon (version 1)')
    expect(second).toContain('input_integrated')
    expect(seen.waves[0]?.questions[0]).toMatchObject({
      state: 'answered',
      answers: [
        {
          version: 1,
          optionId: 'B',
          text: null,
          author: 'user',
          input: 'I1',
          inputState: 'delivered',
        },
      ],
    })
    expect(seen.inputs).toEqual([
      expect.objectContaining({
        id: 'I1',
        kind: 'answer',
        item: 'Q1',
        itemVersion: 1,
        state: 'delivered',
        integratedAt: null,
      }),
    ])
    const types = seen.events.map((one) => one.type)
    expect(types).toContain('planning.answered')
    expect(types).toContain('planning.inputs_delivered')
    const answered = seen.events.find((one) => one.type === 'planning.answered')
    expect(JSON.parse(answered?.payload ?? '{}')).toMatchObject({
      question: 'Q1',
      version: 1,
      answer: 'Semicolon',
      author: 'user',
    })
  })

  test('three answers given during a turn arrive together at its end, in one [hemera:answers], once each', async () => {
    const hold = holdAt(2)
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH, WHERE), says('Reading the code.')]],
      steps: [says('Integrating.')],
      between: hold.between,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          yield* until(Effect.map(wavesOf(mission.id), (waves) => waves.length === 1))
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* answerQuestion(mission.id, 'Q2', { text: 'Only the invoices of this year' })
          yield* answerQuestion(mission.id, 'Q3', { optionId: 'A' })
          const during = {
            prompts: yield* promptCount(world),
            states: yield* inputStates(mission.id),
          }
          hold.release()
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          yield* until(
            Effect.map(inputStates(mission.id), (states) =>
              ['I1', 'I2', 'I3'].every((id) => states[id] === 'delivered'),
            ),
          )
          const database = yield* Database
          return {
            during,
            prompts: yield* promptCount(world),
            sent: yield* database
              .select({ state: sessionDeliveries.state })
              .from(sessionDeliveries)
              .where(
                and(eq(sessionDeliveries.kind, 'answers'), eq(sessionDeliveries.state, 'sent')),
              ),
          }
        }),
      ),
    )
    expect(seen.during).toEqual({
      prompts: 1,
      states: { I1: 'received', I2: 'received', I3: 'received' },
    })
    expect(seen.prompts).toBe(2)
    const second = promptsOf(world)[1] ?? ''
    expect(occurrences(second, '[hemera:answers]')).toBe(1)
    expect(occurrences(second, 'I1 · Q1: B · Semicolon (version 1)')).toBe(1)
    expect(occurrences(second, 'I2 · Q2: “Only the invoices of this year” (version 1)')).toBe(1)
    expect(occurrences(second, 'I3 · Q3: A · Downloads (version 1)')).toBe(1)
    expect(seen.sent).toHaveLength(1)
  })

  test('with no live Planner, a fresh one starts with its brief, the questions and the answers', async () => {
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Integrating.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' })
          const fresh = yield* plannerStarted(mission.id, planner.id)
          yield* settled(fresh)
          return { fresh, planner }
        }),
      ),
    )
    expect(seen.fresh.id).not.toBe(seen.planner.id)
    const first = promptsOf(world, 1)[0] ?? ''
    expect(first).toMatch(/^\[hemera:brief\]/)
    expect(first).toContain('Mode: answers')
    expect(first).toContain('## Questions')
    expect(first).toContain('Q1 (wave 1, answered): Which separator does the CSV use?')
    expect(first).toContain('Q2 (wave 1, open): Which invoices are exported?')
    expect(occurrences(first, '[hemera:answers]')).toBe(1)
    expect(first).toContain('I1 · Q1: A · Comma (version 1)')
  })

  test('undelivered inputs survive a restart and reach the next Planner once', async () => {
    const hold = holdAt(2)
    const first = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH), says('Reading the code.')]],
      steps: [says('Integrating.')],
      between: hold.between,
    }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          yield* plannerStarted(mission.id)
          yield* until(Effect.map(wavesOf(mission.id), (waves) => waves.length === 1))
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          return { mission, states: yield* inputStates(mission.id) }
        }),
      ),
    )
    hold.release()
    expect(before.states).toEqual({ I1: 'received' })
    const second = planning(() => QUIET)
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(inputStates(before.mission.id), (states) => states['I1'] === 'delivered'),
          )
          const planner = yield* plannerStarted(before.mission.id)
          yield* settled(planner)
          return { planners: yield* plannersOf(before.mission.id) }
        }),
      ),
    )
    expect(after.planners).toHaveLength(1)
    const told = second.world.agents.flatMap((agent) =>
      agent.answers.prompts.map((blocks) => text(blocks)),
    )
    expect(told.filter((one) => one.includes('I1 · Q1: B · Semicolon (version 1)'))).toHaveLength(1)
  })
})

/**
 * Every agent found as the fake one, but not signed in while `out` holds; each lookup waits for
 * `gate` first, so a test can hold an agent's start at the moment its first turn was handed over.
 */
const signIns = () => {
  const state = { out: false, gate: Promise.resolve() }
  const discovery = Layer.succeed(Discovery, {
    list: Effect.succeed([]),
    probe: () => Effect.succeed(null),
    resolve: (id) =>
      Effect.andThen(
        Effect.promise(() => state.gate),
        Effect.suspend(() =>
          state.out
            ? Effect.fail(new AgentNotSignedIn({ agent: id, label: id, loginHint: `${id} login` }))
            : Effect.succeed({
                adapter: ADAPTERS[id],
                from: 'bundled' as const,
                program: '/adapters/fake.mjs',
                args: [],
                env: {},
                own: {},
              }),
        ),
      ),
  })
  return { state, discovery }
}

/** The deliveries of answers given back to the queue, for whoever comes next. */
const answersQueued = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select({ id: sessionDeliveries.id })
    .from(sessionDeliveries)
    .where(and(eq(sessionDeliveries.kind, 'answers'), eq(sessionDeliveries.state, 'queued')))
  return rows.length
})

/**
 * A Planner whose agent fails before it took its first turn, the answer to Q1 in it: the session
 * gives the delivery back. `hold` keeps the agent's start until the input reads delivered. Then the
 * agent is back, Q2 is answered, and a fresh Planner starts.
 */
const givenBack = (hold: boolean) => {
  const { state, discovery } = signIns()
  const { world, run } = planning(
    (index) =>
      index === 0
        ? { turns: [[wave('toolu_wave', SEPARATOR, WHICH)]], steps: [says('Done.')] }
        : { steps: [says('Integrating.')] },
    { sessions: { discovery } },
  )
  const seen = run(({ profile }) =>
    within(
      profile,
      Effect.gen(function* () {
        const project = yield* acme
        const { mission, planner } = yield* missionPlanned(project.id)
        yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
        const gate = held()
        state.out = true
        if (hold) state.gate = gate.promise
        yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
        const failing = yield* plannerStarted(mission.id, planner.id)
        if (hold) {
          yield* until(
            Effect.map(inputStates(mission.id), (states) => states['I1'] === 'delivered'),
          )
          gate.release()
        }
        yield* until(
          Effect.map(sessionsIn(['failed'], { kind: 'mission', missionId: mission.id }), (rows) =>
            rows.some((row) => row.id === failing.id),
          ),
        )
        yield* until(Effect.map(answersQueued, (count) => count === 1))
        const afterGiveBack = yield* inputStates(mission.id)
        state.out = false
        state.gate = Promise.resolve()
        yield* answerQuestion(mission.id, 'Q2', { optionId: 'A' })
        const fresh = yield* plannerStarted(mission.id, failing.id)
        yield* until(
          Effect.map(inputStates(mission.id), (states) =>
            ['I1', 'I2'].every((id) => states[id] === 'delivered'),
          ),
        )
        yield* settled(fresh)
        return { afterGiveBack, failing, fresh, planners: yield* plannersOf(mission.id) }
      }),
    ),
  )
  return { world, seen }
}

describe('An input survives what happens to the Planner', () => {
  test('a Planner that dies after taking the answers: its replacement is told them in its brief', async () => {
    const { world, run } = planning((index) =>
      index === 0 ? { turns: [[wave('toolu_wave', SEPARATOR, WHICH)], [{ does: 'dies' }]] } : QUIET,
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          const fresh = yield* plannerStarted(mission.id, planner.id)
          yield* until(Effect.map(promptCount(world, 1), (count) => count >= 1))
          yield* settled(fresh)
          return { inputs: yield* inputsOf(mission.id), planners: yield* plannersOf(mission.id) }
        }),
      ),
    )
    expect(seen.planners).toHaveLength(1)
    expect(seen.inputs.map((one) => [one.id, one.state])).toEqual([['I1', 'delivered']])
    const brief = promptsOf(world, 1)[0] ?? ''
    expect(brief).toContain('## Inputs delivered and not integrated')
    expect(brief).toContain('- I1 · Q1: B · Semicolon (version 1)')
  })

  test('a delivery given back by a Planner that never took it: the next Planner sees each input once', async () => {
    const { world, seen } = givenBack(true)
    const { afterGiveBack, failing, fresh, planners } = await seen
    expect(afterGiveBack).toEqual({ I1: 'received' })
    expect(fresh.id).not.toBe(failing.id)
    expect(planners.map((one) => one.id)).toEqual([fresh.id])
    // The failing Planner's agent never started: the fresh one is the second agent.
    const told = promptsOf(world, 1).join('\n')
    expect(occurrences(told, 'Q1: B · Semicolon (version 1)')).toBe(1)
    expect(occurrences(told, 'Q2: A · All (version 1)')).toBe(1)
    expect(told).not.toContain('## Inputs delivered and not integrated')
  })

  test('a give-back racing the turn’s start: each input is still seen once', async () => {
    const { world, seen } = givenBack(false)
    const { afterGiveBack, planners } = await seen
    expect(afterGiveBack).toEqual({ I1: 'received' })
    expect(planners).toHaveLength(1)
    const told = promptsOf(world, 1).join('\n')
    expect(occurrences(told, 'Q1: B · Semicolon (version 1)')).toBe(1)
    expect(occurrences(told, 'Q2: A · All (version 1)')).toBe(1)
  })

  test('a give-back the database refuses: the Planner still fails, and no Planner is left live', async () => {
    const { state, discovery } = signIns()
    const { run } = planning(
      (index) =>
        index === 0
          ? { turns: [[wave('toolu_wave', SEPARATOR, WHICH)]], steps: [says('Done.')] }
          : QUIET,
      { sessions: { discovery } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          const gate = held()
          state.out = true
          state.gate = gate.promise
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          const failing = yield* plannerStarted(mission.id, planner.id)
          yield* until(
            Effect.map(inputStates(mission.id), (states) => states['I1'] === 'delivered'),
          )
          yield* Database.use((database) =>
            database.run(sql`CREATE TRIGGER refuse_give_back BEFORE UPDATE ON session_deliveries
              WHEN OLD.state = 'sent' AND NEW.state = 'queued'
              BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`),
          )
          gate.release()
          yield* until(
            Effect.map(sessionsIn(['failed'], { kind: 'mission', missionId: mission.id }), (rows) =>
              rows.some((row) => row.id === failing.id),
            ),
          )
          return { planners: yield* plannersOf(mission.id) }
        }),
      ),
    )
    expect(seen.planners).toEqual([])
  })

  test('an answer changed while its delivery was out, then given back: the next Planner never sees the old one', async () => {
    const { state, discovery } = signIns()
    const { world, run } = planning(
      (index) =>
        index === 0
          ? { turns: [[wave('toolu_wave', SEPARATOR, WHICH)]], steps: [says('Done.')] }
          : { steps: [says('Integrating.')] },
      { sessions: { discovery } },
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          const gate = held()
          state.out = true
          state.gate = gate.promise
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          const failing = yield* plannerStarted(mission.id, planner.id)
          yield* until(
            Effect.map(inputStates(mission.id), (states) => states['I1'] === 'delivered'),
          )
          // The answer changes while its first version is out with a Planner that never takes it.
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' })
          gate.release()
          yield* until(
            Effect.map(sessionsIn(['failed'], { kind: 'mission', missionId: mission.id }), (rows) =>
              rows.some((row) => row.id === failing.id),
            ),
          )
          state.out = false
          state.gate = Promise.resolve()
          yield* PlannerWake.use((wake) => wake.deliver(mission.id, 'update', 'Go on.'))
          const fresh = yield* plannerStarted(mission.id, failing.id)
          yield* until(Effect.map(promptCount(world, 1), (count) => count >= 1))
          yield* settled(fresh)
          return { states: yield* inputStates(mission.id) }
        }),
      ),
    )
    expect(seen.states).toEqual({ I1: 'superseded', I2: 'delivered' })
    const told = promptsOf(world, 1).join('\n')
    expect(told).not.toContain('Q1: B · Semicolon (version 1)')
    expect(occurrences(told, 'Q1: now A · Comma, was B · Semicolon (version 2)')).toBe(1)
  })

  test('an answer racing a cancel: no Planner is left running, and nothing is delivered after it', async () => {
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR)]],
      steps: [says('Integrating.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          const [answered] = yield* Effect.all(
            [
              answerQuestion(mission.id, 'Q1', { optionId: 'B' }).pipe(Effect.result),
              moveMission(mission.id, 'cancel', 'user'),
            ],
            { concurrency: 'unbounded' },
          )
          yield* until(Effect.map(plannersOf(mission.id), (rows) => rows.length === 0))
          const refused = yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' }).pipe(
            Effect.flip,
          )
          return { answered, refused, open: yield* openQuestions }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.refused, 'PlanningRefused')).toBe(true)
    expect(seen.open).toEqual([])
    // Every agent started is the mission's one Planner: nothing opened another after the cancel.
    expect(world.agents).toHaveLength(1)
  })
})

describe('At its start, the engine hands over what a stopped engine received', () => {
  test('an answer kept but never handed over (the engine stopped in between) starts a Planner with it', async () => {
    const first = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Done.')],
    }))
    const before = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Sessions.use((sessions) => sessions.end(planner.lineage, 'the test ends it'))
          // Kept, and the engine stops before it hands it over.
          yield* recordAnswer(mission.id, 'Q1', { optionId: 'B' })
          return { mission, states: yield* inputStates(mission.id) }
        }),
      ),
    )
    expect(before.states).toEqual({ I1: 'received' })
    const second = planning(() => QUIET)
    const after = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const planner = yield* plannerStarted(before.mission.id)
          yield* until(
            Effect.map(inputStates(before.mission.id), (states) => states['I1'] === 'delivered'),
          )
          yield* settled(planner)
          return { planners: yield* plannersOf(before.mission.id) }
        }),
      ),
    )
    expect(after.planners).toHaveLength(1)
    const told = promptsOf(second.world)[0] ?? ''
    expect(told).toMatch(/^\[hemera:brief\]/)
    expect(occurrences(told, 'I1 · Q1: B · Semicolon (version 1)')).toBe(1)
  })
})

describe('Waiting on someone', () => {
  test('is delivered with its note; the mark appears and clears with the answer; the ball moves between you and someone; a drafted message is kept and never sent', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [wave('toolu_wave', SEPARATOR, WHICH)],
        [
          uses('toolu_draft', 'question_draft_message', {
            question: 'Q1',
            text: 'Hello, which separator does the accounting tool read?',
          }),
        ],
      ],
      steps: [says('Noted.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* waitOnSomeone(mission.id, 'Q1', 'Asking the accounting team')
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          const waiting = yield* getMission(mission.id)
          const database = yield* Database
          const [next] = yield* database
            .select()
            .from(memoryNext)
            .where(eq(memoryNext.missionId, mission.id))
          yield* answerQuestion(mission.id, 'Q2', { optionId: 'A' })
          yield* until(Effect.map(promptCount(world), (count) => count === 3))
          yield* settled(planner)
          const someone = yield* getMission(mission.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* until(Effect.map(promptCount(world), (count) => count === 4))
          yield* settled(planner)
          const answered = yield* getMission(mission.id)
          return {
            waiting,
            someone,
            answered,
            next,
            waves: yield* wavesOf(mission.id),
            events: yield* eventsOf(mission.id),
          }
        }),
      ),
    )
    const told = promptsOf(world)[1] ?? ''
    expect(told).toMatch(/^\[hemera:answers\]\n/)
    expect(told).toContain('I1 · Q1 waits on someone: “Asking the accounting team”')
    expect(seen.waiting.marks.map((one) => one.mark)).toEqual([
      WaitingOnSomeoneMark.make({ question: 'Q1', note: 'Asking the accounting team' }),
    ])
    expect(Predicate.isTagged(seen.waiting.ball, 'WaitingOnYou')).toBe(true)
    expect(seen.next?.text).toBe('Q1 waits on someone')
    expect(Predicate.isTagged(seen.someone.ball, 'WaitingOnSomeone')).toBe(true)
    expect(seen.answered.marks).toEqual([])
    expect(Predicate.isTagged(seen.answered.ball, 'Idle')).toBe(true)
    expect(answersOf(world)[1]).toBe(
      'Draft kept under Q1, for the user to copy. Nothing is sent: the user writes and sends it.',
    )
    expect(seen.waves[0]?.questions[0]).toMatchObject({
      state: 'answered',
      waitingNote: 'Asking the accounting team',
      drafts: [{ text: 'Hello, which separator does the accounting tool read?' }],
    })
    const types = seen.events.map((one) => one.type)
    expect(types).toContain('planning.waiting_on_someone')
    expect(types).toContain('planning.draft_message')
    expect(types).toContain('mission.mark_set')
    expect(types).toContain('mission.mark_cleared')
  })

  test('saying it twice at once makes one input; it is refused on an answered question', async () => {
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Noted.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Effect.all(
            [
              waitOnSomeone(mission.id, 'Q1', 'Asking the accounting team'),
              waitOnSomeone(mission.id, 'Q1', 'Asking the accounting team'),
            ],
            { concurrency: 'unbounded' },
          )
          yield* answerQuestion(mission.id, 'Q2', { optionId: 'A' })
          const refused = yield* waitOnSomeone(mission.id, 'Q2', null).pipe(Effect.flip)
          yield* settled(planner)
          return { inputs: yield* inputsOf(mission.id), refused }
        }),
      ),
    )
    expect(seen.inputs.map((one) => [one.id, one.kind, one.item])).toEqual([
      ['I1', 'waiting', 'Q1'],
      ['I2', 'answer', 'Q2'],
    ])
    expect(Predicate.isTagged(seen.refused, 'PlanningRefused')).toBe(true)
  })
})

describe('A changed answer is a new version', () => {
  test('delivered as “now B, was A”; the old input is superseded and no longer blocks', async () => {
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR)]],
      steps: [says('Integrating.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' })
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* until(Effect.map(promptCount(world), (count) => count === 3))
          yield* settled(planner)
          yield* until(
            Effect.map(inputStates(mission.id), (states) => states['I2'] === 'delivered'),
          )
          return { waves: yield* wavesOf(mission.id), inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    expect(promptsOf(world)[2]).toContain('I2 · Q1: now B · Semicolon, was A · Comma (version 2)')
    expect(seen.waves[0]?.questions[0]?.answers.map((one) => [one.version, one.optionId])).toEqual([
      [1, 'A'],
      [2, 'B'],
    ])
    expect(seen.inputs.map((one) => [one.id, one.state])).toEqual([
      ['I1', 'superseded'],
      ['I2', 'delivered'],
    ])
  })

  test('the same answer twice at once is one version, delivered once; two different ones are two versions', async () => {
    const { world, run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Integrating.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* Effect.all(
            [
              answerQuestion(mission.id, 'Q1', { optionId: 'B' }),
              answerQuestion(mission.id, 'Q1', { optionId: 'B' }),
            ],
            { concurrency: 'unbounded' },
          )
          yield* Effect.all(
            [
              answerQuestion(mission.id, 'Q2', { optionId: 'A' }),
              answerQuestion(mission.id, 'Q2', { optionId: 'B' }),
            ],
            { concurrency: 'unbounded' },
          )
          yield* until(
            Effect.map(inputsOf(mission.id), (inputs) =>
              inputs.every((one) => one.state !== 'received'),
            ),
          )
          yield* settled(planner)
          return { waves: yield* wavesOf(mission.id), inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    const [q1, q2] = seen.waves[0]?.questions ?? []
    expect(q1?.answers.map((one) => one.version)).toEqual([1])
    expect(q2?.answers.map((one) => one.version)).toEqual([1, 2])
    const told = promptsOf(world).join('\n')
    expect(occurrences(told, 'Q1: B · Semicolon (version 1)')).toBe(1)
    expect(seen.inputs.filter((one) => one.state !== 'superseded').map((one) => one.item)).toEqual([
      'Q1',
      'Q2',
    ])
  })
})

describe('Completeness waits for every input and every question', () => {
  test('refused naming them while an input is not integrated or a question is open or waiting; input_integrated clears it', async () => {
    const ALL_SECTIONS = SPEC_SECTIONS.map((section, at) =>
      uses(`toolu_section_${String(at)}`, 'spec_write_section', {
        section,
        content: `The ${section}.`,
        base_version: 0,
      }),
    )
    const R1 = uses('toolu_r1', 'requirement_write', {
      domain: 'invoices',
      delta: 'added',
      text: 'Invoices export as CSV.',
      scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
    })
    // What #90 asks of a complete Spec beside the inputs and questions: a proof, a task, a model.
    const PLAN = [
      uses('toolu_proof', 'proof_write', {
        scenario: 'R1.S1',
        proof: {
          mode: 'by_hand',
          actions: ['Export the invoices', 'Open the saved file'],
          starting_data: 'Two invoices.',
          expected: 'A CSV file holds both invoices.',
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_tasks', 'tasks_write', {
        tasks: [
          {
            title: 'Export as CSV',
            result: 'The invoices export as CSV.',
            requirements: ['R1'],
            scenarios: ['R1.S1'],
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
    const declare = (id: string) => uses(id, 'declare_complete', { why: 'A Builder can build it.' })
    const { world, run } = planning(() => ({
      turns: [
        [
          ...ALL_SECTIONS,
          R1,
          uses('toolu_describe', 'mission_describe', { title: 'Invoices as CSV', type: 'feature' }),
          ...PLAN,
          wave('toolu_wave', SEPARATOR, WHICH),
          declare('toolu_declare_1'),
        ],
        [
          declare('toolu_declare_2'),
          uses('toolu_integrated_1', 'input_integrated', { id: 'I1', where: 'decisions' }),
          uses('toolu_integrated_again', 'input_integrated', { id: 'I1', where: 'decisions' }),
          uses('toolu_unknown', 'input_integrated', { id: 'I9', where: 'decisions' }),
        ],
        [declare('toolu_declare_3')],
        [
          uses('toolu_superseded', 'input_integrated', { id: 'I2', where: 'open_questions' }),
          uses('toolu_integrated_3', 'input_integrated', {
            id: 'I3',
            where: { no_change: 'The Spec already exports every invoice.' },
          }),
          declare('toolu_declare_4'),
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
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          yield* waitOnSomeone(mission.id, 'Q2', null)
          yield* until(Effect.map(promptCount(world), (count) => count === 3))
          yield* settled(planner)
          yield* answerQuestion(mission.id, 'Q2', { optionId: 'A' })
          yield* until(Effect.map(promptCount(world), (count) => count === 4))
          yield* settled(planner)
          return {
            spec: yield* readSpec(mission.id),
            inputs: yield* inputsOf(mission.id),
            events: yield* eventsOf(mission.id),
          }
        }),
      ),
    )
    const answers = answersOf(world)
    const ids = [
      ...ALL_SECTIONS.map((_, index) => `s${String(index)}`),
      'r1',
      'describe',
      'proof',
      'tasks',
      'model',
      'wave',
      'declare_1',
      'declare_2',
      'integrated_1',
      'integrated_again',
      'unknown',
      'declare_3',
      'superseded',
      'integrated_3',
      'declare_4',
    ]
    const at = (id: string) => answers[ids.indexOf(id)]
    expect(answers).toHaveLength(ids.length)
    for (const id of ['proof', 'tasks', 'model']) expect(at(id)).not.toMatch(/^refused/)
    expect(at('declare_1')?.split('\n').slice(1)).toEqual([
      "- Q1: Q1 is open: it waits for the user's answer.",
      "- Q2: Q2 is open: it waits for the user's answer.",
    ])
    expect(at('declare_2')?.split('\n').slice(1)).toEqual([
      '- I1: Input I1 (the answer to Q1, version 1) is not integrated: integrate it, then call input_integrated.',
      "- Q2: Q2 is open: it waits for the user's answer.",
    ])
    expect(at('integrated_1')).toBe('I1 is integrated (decisions).')
    expect(at('integrated_again')).toBe('I1 is already integrated (decisions): nothing changed.')
    expect(at('unknown')).toBe('refused: this mission has no input I9.')
    expect(at('declare_3')?.split('\n').slice(1)).toEqual([
      '- I2: Input I2 (Q2 waiting on someone) is not integrated: integrate it, then call input_integrated.',
      '- Q2: Q2 waits on someone: a complete Spec has no open question.',
    ])
    expect(at('superseded')).toBe('refused: I2 is superseded by I3: integrate I3.')
    expect(at('integrated_3')).toBe(
      'I3 is integrated (no change: The Spec already exports every invoice.).',
    )
    expect(at('declare_4')).toMatch(/^Declared complete at version \d+\./)
    expect(seen.spec.declaredCompleteVersion).not.toBeNull()
    expect(seen.inputs.map((one) => [one.id, one.state, one.where])).toEqual([
      ['I1', 'integrated', 'decisions'],
      ['I2', 'superseded', null],
      ['I3', 'integrated', 'no change: The Spec already exports every invoice.'],
    ])
    expect(seen.events.filter((one) => one.type === 'planning.input_integrated')).toHaveLength(2)
  })

  test('input_integrated is refused for an input not delivered yet, given while the turn runs', async () => {
    const hold = holdAt(2)
    const { world, run } = planning(() => ({
      turns: [
        [
          wave('toolu_wave', SEPARATOR),
          uses('toolu_early', 'input_integrated', { id: 'I1', where: 'decisions' }),
        ],
      ],
      steps: [says('Integrating.')],
      between: hold.between,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          const planner = yield* plannerStarted(mission.id)
          yield* until(Effect.map(wavesOf(mission.id), (waves) => waves.length === 1))
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          hold.release()
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          return { inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    expect(answersOf(world)[1]).toBe(
      'refused: I1 has not been delivered to you yet: it comes with your next delivery.',
    )
    expect(seen.inputs[0]?.integratedAt).toBeNull()
  })
})

describe('Withdrawn, replaced and moot questions', () => {
  test('keep their reason and link, never block, and refuse an answer', async () => {
    const { world, run } = planning(() => ({
      turns: [
        [wave('toolu_wave', SEPARATOR, WHICH, WHERE)],
        [
          uses('toolu_withdraw', 'question_retire', {
            question: 'Q1',
            how: 'withdrawn',
            reason: 'The api repository fixes the separator.',
          }),
          uses('toolu_moot_bare', 'question_retire', {
            question: 'Q2',
            how: 'moot',
            reason: 'Decided elsewhere.',
          }),
          uses('toolu_moot', 'question_retire', {
            question: 'Q2',
            how: 'moot',
            reason: 'The export takes every invoice.',
            decision: 'D1: export every invoice',
          }),
          uses('toolu_again', 'question_retire', {
            question: 'Q1',
            how: 'withdrawn',
            reason: 'Again.',
          }),
          wave(
            'toolu_replace',
            question('Is the file saved or downloaded?', ['Saved', 'Downloaded'], {
              replaces: 'Q3',
            }),
          ),
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
          yield* nudged(planner)
          const refused = yield* Effect.all(
            ['Q1', 'Q2', 'Q3'].map((id) =>
              answerQuestion(mission.id, id, { optionId: 'A' }).pipe(Effect.flip),
            ),
          )
          yield* journalHas(mission.id, 'The Planner withdrew Q1')
          yield* journalHas(mission.id, 'The Planner said Q2 is moot')
          yield* journalHas(mission.id, 'The Planner replaced Q3 by Q4')
          return {
            refused,
            waves: yield* wavesOf(mission.id),
            open: yield* openQuestions,
            events: yield* eventsOf(mission.id),
          }
        }),
      ),
    )
    const answers = answersOf(world)
    expect(answers[1]).toBe('Q1 is withdrawn. It stays readable with your reason.')
    expect(answers[2]).toBe('refused: a moot question names the decision that made it moot.')
    expect(answers[3]).toBe('Q2 is moot. It stays readable with your reason.')
    expect(answers[4]).toBe('refused: Q1 is withdrawn already.')
    expect(answers[5]).toMatch(/^Wave 2 asked: Q4 \(it replaces Q3\)\./)
    expect(seen.refused.every((one) => Predicate.isTagged(one, 'PlanningRefused'))).toBe(true)
    const all = seen.waves.flatMap((one) => one.questions)
    expect(all.map((one) => [one.id, one.state])).toEqual([
      ['Q1', 'withdrawn'],
      ['Q2', 'moot'],
      ['Q3', 'replaced'],
      ['Q4', 'open'],
    ])
    expect(all[0]).toMatchObject({ retiredReason: 'The api repository fixes the separator.' })
    expect(all[1]).toMatchObject({
      retiredReason: 'The export takes every invoice.',
      mootDecision: 'D1: export every invoice',
    })
    expect(all[2]).toMatchObject({ replacedBy: 'Q4' })
    expect(all[3]).toMatchObject({ replaces: 'Q3', wave: 2 })
    expect(seen.open.map((one) => one.questionId)).toEqual(['Q4'])
    const types = seen.events.map((one) => one.type)
    expect(types).toContain('planning.question_withdrawn')
    expect(types).toContain('planning.question_moot')
    expect(types).toContain('planning.question_replaced')
  })
})

describe('Answering through the RPC', () => {
  test('both an option and a text, neither, or an option not offered is refused; outside Planning too', async () => {
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR)]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission } = yield* missionPlanned(project.id)
          const refusals = yield* Effect.all([
            answerQuestion(mission.id, 'Q1', { optionId: 'A', text: 'Comma' }).pipe(Effect.flip),
            answerQuestion(mission.id, 'Q1', {}).pipe(Effect.flip),
            answerQuestion(mission.id, 'Q1', { text: '   ' }).pipe(Effect.flip),
            answerQuestion(mission.id, 'Q1', { optionId: 'C' }).pipe(Effect.flip),
            answerQuestion(mission.id, 'Q7', { optionId: 'A' }).pipe(Effect.flip),
          ])
          yield* moveMission(mission.id, 'cancel', 'user')
          const cancelled = yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' }).pipe(
            Effect.flip,
          )
          return { refusals, cancelled, inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    expect(
      seen.refusals.map((one) => [Predicate.isTagged(one, 'InvalidAnswer'), one.message]),
    ).toEqual([
      [true, 'The answer is refused: it names both an option and a text.'],
      [true, 'The answer is refused: it names neither an option nor a text.'],
      [true, 'The answer is refused: it names neither an option nor a text.'],
      [true, 'The answer is refused: “C” is not an option of the question.'],
      [false, 'ACME-1 has no question Q7.'],
    ])
    expect(Predicate.isTagged(seen.cancelled, 'PlanningRefused')).toBe(true)
    expect(seen.inputs).toEqual([])
  })

  test('an answer racing a new wave: both are kept, numbered once', async () => {
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR)]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const writer = { sessionId: planner.id, role: 'planner', missionId: mission.id }
          const asked = {
            text: 'Which columns?',
            why: 'The export depends on it.',
            options: [
              { label: 'All', detail: '' },
              { label: 'Amounts only', detail: '' },
            ],
            recommended: 0,
            recommendedReason: 'Nothing says otherwise.',
          }
          yield* Effect.all(
            [
              askWave(writer, [asked]),
              answerQuestion(mission.id, 'Q1', { optionId: 'B' }),
              askWave(writer, [asked]),
            ],
            { concurrency: 'unbounded' },
          )
          yield* settled(planner)
          return { waves: yield* wavesOf(mission.id), inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    expect(seen.waves.map((one) => [one.number, one.questions.map((q) => q.id)])).toEqual([
      [1, ['Q1']],
      [2, [expect.stringMatching(/^Q[23]$/)]],
      [3, [expect.stringMatching(/^Q[23]$/)]],
    ])
    expect(seen.waves[0]?.questions[0]?.state).toBe('answered')
    expect(seen.inputs.map((one) => one.id)).toEqual(['I1'])
  })
})

describe('The Questions group across Projects', () => {
  test('openQuestions lists open and waiting questions by mission then wave; questionsChanged follows them', async () => {
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave_1', SEPARATOR, WHICH), wave('toolu_wave_2', WHERE)]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.scoped(
          Effect.gen(function* () {
            const acmeProject = yield* acme
            const hemera = yield* projectNamed('Hemera', 'hemera')
            const first = yield* missionPlanned(acmeProject.id)
            const second = yield* missionPlanned(hemera.id, 'Search the missions')
            yield* waitOnSomeone(first.mission.id, 'Q2', 'Asking the accounting team')
            yield* answerQuestion(second.mission.id, 'Q1', { optionId: 'A' })
            yield* settled(first.planner)
            yield* settled(second.planner)
            const lists =
              yield* Queue.unbounded<
                ReadonlyArray<{ readonly missionKey: string; readonly questionId: string }>
              >()
            yield* questionsChanged.pipe(
              Stream.runForEach((list) => Queue.offer(lists, list)),
              Effect.forkScoped,
            )
            const now = yield* Queue.take(lists)
            yield* answerQuestion(first.mission.id, 'Q1', { optionId: 'A' })
            // Other changes may come first; the list then follows the answer.
            const answered = (list: ReadonlyArray<{ missionKey: string; questionId: string }>) =>
              !list.some((one) => one.missionKey === first.mission.key && one.questionId === 'Q1')
            let next = yield* Queue.take(lists)
            while (!answered(next)) next = yield* Queue.take(lists)
            return {
              open: yield* openQuestions,
              now,
              next,
              keys: [first.mission.key, second.mission.key],
            }
          }),
        ),
      ),
    )
    expect(seen.now.map((one) => one.questionId)).toEqual(['Q1', 'Q2', 'Q3', 'Q2', 'Q3'])
    expect(seen.next.map((one) => one.questionId)).toEqual(['Q2', 'Q3', 'Q2', 'Q3'])
    expect(
      seen.open.map((one) => [
        one.missionKey,
        one.projectName,
        one.wave,
        one.questionId,
        one.state,
      ]),
    ).toEqual([
      [seen.keys[0], 'Acme', 1, 'Q2', 'waiting'],
      [seen.keys[0], 'Acme', 2, 'Q3', 'open'],
      [seen.keys[1], 'Hemera', 1, 'Q2', 'open'],
      [seen.keys[1], 'Hemera', 2, 'Q3', 'open'],
    ])
    expect(seen.open[0]).toMatchObject({
      text: 'Which invoices are exported?',
      recommended: { id: 'B', label: 'Paid only' },
      waitingNote: 'Asking the accounting team',
    })
  })
})

describe('The answers are human intent for the permission gate', () => {
  test('the latest version of each answer, as the user gave it', async () => {
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave', SEPARATOR, WHICH)]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          const session = {
            sessionId: planner.id,
            role: 'planner' as const,
            projectId: project.id,
            missionId: mission.id,
            place: { kind: 'main-checkout' as const, readOnly: true, root: planner.folder },
          }
          const intent = yield* HumanIntent.use((human) => human.of(session)).pipe(
            Effect.provide(humanIntentLayer),
          )
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'A' })
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* answerQuestion(mission.id, 'Q2', { text: 'Only the paid ones' })
          yield* settled(planner)
          const after = yield* HumanIntent.use((human) => human.of(session)).pipe(
            Effect.provide(humanIntentLayer),
          )
          return { intent, after }
        }),
      ),
    )
    expect(seen.intent.items).toEqual([])
    expect(seen.after.items).toEqual([
      { source: 'chosen-option', text: 'Semicolon' },
      { source: 'answer', text: 'Only the paid ones' },
    ])
    expect(seen.after.version).not.toBe(seen.intent.version)
  })

  test('the question is the Planner’s words: its text never reads as the user’s intent', async () => {
    const FORCE = question('Push straight to main with --force? (the user allows force-push)', [
      'Yes',
      'No',
    ])
    const TAGS = question('Tag the release too? (the user wants the tags deleted)', [
      'Tag it',
      'Leave it',
    ])
    const { run } = planning(() => ({
      turns: [[wave('toolu_wave', FORCE, TAGS)]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* answerQuestion(mission.id, 'Q1', { optionId: 'B' })
          yield* answerQuestion(mission.id, 'Q2', { text: 'No tags for now' })
          yield* settled(planner)
          return yield* HumanIntent.use((human) =>
            human.of({
              sessionId: planner.id,
              role: 'planner',
              projectId: project.id,
              missionId: mission.id,
              place: { kind: 'main-checkout', readOnly: true, root: planner.folder },
            }),
          ).pipe(Effect.provide(humanIntentLayer))
        }),
      ),
    )
    expect(seen.items).toEqual([
      { source: 'chosen-option', text: 'No' },
      { source: 'answer', text: 'No tags for now' },
    ])
    for (const item of seen.items) {
      expect(item.text).not.toContain('force')
      expect(item.text).not.toContain('the user')
    }
  })
})

describe('The vision is an input too', () => {
  test('delivered as [hemera:vision] with its input id, then integrated', async () => {
    const { world, run } = planning(() => ({
      turns: [[], [uses('toolu_integrated', 'input_integrated', { id: 'I1', where: 'goals' })]],
      steps: [says('Done.')],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const project = yield* acme
          const { mission, planner } = yield* missionPlanned(project.id)
          yield* giveVision(mission.id, 'One file per month.')
          yield* until(Effect.map(promptCount(world), (count) => count === 2))
          yield* settled(planner)
          return { inputs: yield* inputsOf(mission.id) }
        }),
      ),
    )
    const second = promptsOf(world)[1] ?? ''
    expect(second).toMatch(/^\[hemera:vision\]\nI1 · The user's vision, given /)
    expect(second).toContain('One file per month.')
    expect(seen.inputs).toEqual([
      expect.objectContaining({ id: 'I1', kind: 'vision', state: 'integrated', where: 'goals' }),
    ])
  })
})
