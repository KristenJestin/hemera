/**
 * A round is a small Spec (#468, R2): the user's Fix grills a round's feedback into points written
 * as requirements, with their scenarios, proofs and decisions, and the round's tasks; the mission
 * then goes to "Building · round N" with the whole Building machinery, a fresh Builder answers
 * every source, and the end sequence brings it back to Review.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: the cold read reads, every
 * Builder and the Planner of a round answer each prompt (the test drives their tools through their
 * grants), and every other agent (the documenter, the reviewers) holds its turn until the test lets
 * it go. Acme's `api` and `web` in temporary folders, a mission launched into Building, moved into
 * Review the way the end of a Building leaves it, the user's feedback written on it.
 */

import { realpathSync } from 'node:fs'

import {
  CANCEL_MISSION_TOO,
  CLARIFY,
  KEEP_IN_ROUND,
  SESSION_STATES,
  START_A_MISSION,
  TO_A_MISSION,
  WITHDRAW_FEEDBACK,
} from '@hemera/core/domain'
import { FeedbackUser, type FeedbackView } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Layer, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { buildingOf } from '../src/engine/building/builder.ts'
import { TaskChecks } from '../src/engine/building/checks.ts'
import { addRequirement } from '../src/engine/living-spec/store.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { getMission, moveIn } from '../src/engine/missions.ts'
import { answerQuestion } from '../src/engine/planning/calls.ts'
import { inputsOf, openQuestions, wavesOf } from '../src/engine/planning/questions.ts'
import { Review, type FeedbackAsked } from '../src/engine/review/feedback.ts'
import { Rounds } from '../src/engine/review/rounds.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { createStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  buildings,
  domainEvents,
  livingDomains,
  sessionDeliveries,
  specProofs,
  specRequirements,
  specScenarios,
  specSections,
  specTasks,
  specs,
  workspaces,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { READING, grantOf, says } from './building-world.ts'
import { builderOf, launched } from './builder-world.ts'
import { HELPER, held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { ALLOW, callTool, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('review-rounds'))
  work = realpathSync.native(temporaryFolder('review-rounds-work'))
})
afterEach(removeFolders)

/** How long a step may take on a slow runner: never a measure of speed. */
const LONG = 30_000

/** Each test runs a whole engine, Git and agents: far above its time alone. */
const SLOW = { timeout: 180_000 }

const USER = FeedbackUser.make({})

/** The Project's living spec holds one validated requirement, at version 1, in Invoices. */
const livingInvoices = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const secrets = yield* Secrets
    const at = new Date().toISOString()
    const domainId = crypto.randomUUID()
    yield* database.insert(livingDomains).values({
      id: domainId,
      projectId,
      rank: 1,
      name: secrets.mask('Invoices'),
      summary: secrets.mask('What the invoices cover.'),
      uncertainty: secrets.mask(''),
      state: 'validated',
      validatedAt: at,
      createdAt: at,
      updatedAt: at,
    })
    return yield* addRequirement(
      {
        projectId,
        domainId,
        text: 'The invoices export to one file.',
        scenarios: [{ when: 'the user exports the invoices', then: 'one file is saved' }],
      },
      { kind: 'user' },
    )
  })

/** Whether an agent's first prompt is one the test drives through its grant: it answers at once. */
const DRIVEN = ['## Builder · ', '## Planner · ']

/**
 * The engine over `folder`: the cold read reads (unless `resumed`), the Builders and the round's
 * Planner answer every prompt, every other agent holds its turn until the test lets it go.
 */
const rounding = (options: { readonly resumed?: boolean; readonly folder?: string } = {}) => {
  const holds = new Map<number, ReturnType<typeof held>>()
  const holdOf = (index: number) => {
    const found = holds.get(index) ?? held()
    holds.set(index, found)
    return found
  }
  const driven = (index: number) => {
    const first = text(engine.world.agents[index]?.answers.prompts[0] ?? [])
    return DRIVEN.some((heading) => first.includes(heading))
  }
  const script = (index: number): FakeScript =>
    index === 0 && options.resumed !== true
      ? READING
      : {
          steps: [says('Working.')],
          between: () => (driven(index) ? Promise.resolve() : holdOf(index).promise),
        }
  const engine = sessionsEngine(options.folder ?? data, script, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: {
      outside: { compareEveryMillis: 3_600_000, baseEveryMillis: 3_600_000 },
      checks: Layer.succeed(TaskChecks, { run: () => Effect.succeed([]) }),
    },
  })
  return {
    world: {
      agents: engine.world.agents,
      release: (index: number) => holdOf(index).release(),
    },
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(() => {
        for (const one of holds.values()) one.release()
      }),
  }
}

/**
 * The mission's Building ended as the exit of its end leaves it (B9): its sessions stopped, the
 * Building over, the mission moved to Review by Hemera.
 */
const intoReview = (missionId: string) =>
  Effect.gen(function* () {
    yield* Sessions.use((sessions) =>
      sessions.stopTree({ kind: 'mission', missionId }, 'the Building ended'),
    )
    const mission = yield* getMission(missionId)
    yield* mutate('ending the Building', (transaction) =>
      Effect.gen(function* () {
        yield* transaction
          .update(buildings)
          .set({ state: 'ended', phase: 'ended', endedAt: new Date().toISOString() })
          .where(and(eq(buildings.missionId, missionId), eq(buildings.state, 'active')))
        const event = yield* moveIn(
          transaction,
          { id: missionId, stage: mission.stage, round: mission.round },
          'endBuilding',
          'hemera',
        )
        return { result: undefined, events: [event] }
      }),
    )
  })

/** A mission launched over Acme's `api`, its first Building ended into Review. */
const inReview = () =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(work)
    yield* builderOf(mission.id)
    yield* intoReview(mission.id)
    return { missionId: mission.id, projectId: project.id, key: mission.key }
  })

const remark = (body: string): FeedbackAsked => ({ kind: 'remark', body, anchor: null, images: [] })
const question = (body: string): FeedbackAsked => ({
  kind: 'question',
  body,
  anchor: null,
  images: [],
})

const written = (missionId: string, asked: FeedbackAsked) =>
  Review.use((review) => review.feedbackAdd(missionId, asked, USER))

const fix = (missionId: string) => Rounds.use((rounds) => rounds.fix(missionId))

/** The round's Planner once its first turn ended, and a grant the test drives it with. */
const roundPlannerOf = (missionId: string) =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'round-planner') ?? null,
    )
    yield* until(
      Effect.map(idle, (found) => found !== null),
      LONG,
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Planner in round mode'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** A tool's answer, its text and whether it went through. */
const using = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.map(callTool(grantId, tool, args), (answer) => ({ ok: answer.ok, text: answer.text }))

/** A tool that must go through: its text. */
const used = (grantId: string, tool: string, args: Schema.JsonObject) =>
  Effect.gen(function* () {
    const answer = yield* callTool(grantId, tool, args)
    if (!answer.ok) return yield* Effect.die(new Error(`${tool}: ${answer.text}`))
    return answer.text
  })

/** A scenario verified by hand. */
const byHand = (when: string, then: string): Schema.JsonObject => ({
  when,
  then,
  proof: {
    mode: 'by_hand',
    actions: [`${when}.`],
    starting_data: 'Two invoices.',
    expected: `${then}.`,
    seen_today: false,
  },
})

/** The test of the header row: it reads `invoices.ts` and wants a header in it. */
const HEADER_TEST = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { readFileSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  const text = readFileSync(new URL('../invoices.ts', import.meta.url), 'utf8')",
  "  assert.ok(text.includes('header'), 'no header')",
  '})',
  '',
].join('\n')

/** A scenario proven by an automated test that fails until `invoices.ts` holds a header. */
const automated = (when: string, then: string): Schema.JsonObject => ({
  when,
  then,
  proof: {
    mode: 'automated',
    actions: ['Export the invoices', 'Read the first line'],
    starting_data: 'Two invoices.',
    expected: 'The first line names the columns.',
    test: {
      repository: 'api',
      path: 'tests/header.test.mjs',
      code: HEADER_TEST,
      insertion: 'new_file',
      command: `"${process.execPath}" --test --test-reporter=tap tests/header.test.mjs`,
    },
    seen_today: false,
  },
})

/** The types of the mission's events, in their order. */
const typesOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select({ type: domainEvents.type })
      .from(domainEvents)
      .where(eq(domainEvents.entityId, missionId))
      .orderBy(asc(domainEvents.sequence))).map((row) => row.type)
  })

/** The feedback of the mission, by id, as Review reads it now. */
const feedbackNow = (missionId: string) =>
  Effect.map(
    Review.use((review) => review.state(missionId)),
    (state) => new Map<string, FeedbackView>(state.feedback.map((one) => [one.id, one])),
  )

/** The mission's open questions, as Home's Questions group reads them. */
const questionsOf = (missionId: string) =>
  Effect.map(openQuestions, (open) => open.filter((one) => one.missionId === missionId))

/** The Workspace folder of the mission's launch. */
const workspaceOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ folder: workspaces.folder })
      .from(buildingLaunches)
      .innerJoin(workspaces, eq(workspaces.id, buildingLaunches.workspaceId))
      .where(eq(buildingLaunches.missionId, missionId))
    return row?.folder ?? ''
  })

describe('Fix', () => {
  test(
    'Fix is refused with only a question and a withdrawn remark; accepted with one waiting remark: the round is grilled, its waiting feedback in it, the mission stays in Review',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* inReview()
            const asked = yield* written(missionId, question('Why is the date in UTC?'))
            const gone = yield* written(missionId, remark('The CSV has no header row.'))
            yield* Review.use((review) => review.feedbackWithdraw(gone.id, USER))
            const refused = yield* fix(missionId).pipe(Effect.flip)
            const waiting = yield* written(
              missionId,
              remark('The export button is hidden on small screens.'),
            )
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            const brief = text(
              world.agents.find((agent) =>
                text(agent.answers.prompts[0] ?? []).includes('## Planner · '),
              )?.answers.prompts[0] ?? [],
            )
            // Feedback written while the round is grilled goes to the next round.
            const later = yield* written(missionId, remark('The file name has no date.'))
            const again = yield* fix(missionId).pipe(Effect.flip)
            return {
              refused: refused.message,
              again: again.message,
              state: yield* Review.use((review) => review.state(missionId)),
              feedback: yield* feedbackNow(missionId),
              ids: { asked: asked.id, gone: gone.id, waiting: waiting.id, later: later.id },
              stage: (yield* getMission(missionId)).stage,
              types: yield* typesOf(missionId),
              planner: planner.session,
              workspace: yield* workspaceOf(missionId),
              brief,
            }
          }),
        ),
      )
      expect(seen.refused).toBe(
        'Nothing waits for a fix: questions and withdrawn remarks are not fixed.',
      )
      expect(seen.state.rounds.map((one) => [one.number, one.state])).toEqual([
        [1, 'grilling'],
        [2, 'collecting'],
      ])
      expect(seen.feedback.get(seen.ids.waiting)?.state).toBe('in_round')
      expect(seen.feedback.get(seen.ids.asked)?.state).toBe('in_round')
      expect(seen.feedback.get(seen.ids.gone)?.state).toBe('withdrawn')
      expect(seen.feedback.get(seen.ids.later)).toMatchObject({ round: 2, state: 'waiting' })
      expect(seen.again).toBe('round 1 is grilling: round 2 waits for it to be answered')
      expect(seen.stage).toBe('review')
      expect(seen.types).toContain('review.fix_started')
      // The Planner in round mode reads the Workspace, never the main checkout.
      expect(seen.planner.folder).toBe(seen.workspace)
      expect(seen.brief).toContain('Mode: round 1')
      expect(seen.brief).toContain('The export button is hidden on small screens.')
      expect(seen.brief).toContain('Why is the date in UTC?')
      // A withdrawn remark needs no outcome: the round's feedback leaves it out.
      const field = seen.brief.split('## The feedback of round 1')[1]?.split('\n## ')[0] ?? ''
      expect(field).toContain('The export button is hidden on small screens.')
      expect(field).not.toContain('The CSV has no header row.')
    },
  )
})

describe('The grilling', () => {
  test(
    'two duplicate remarks become one point listing both ids; a question gets feedback_answer and no point',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* inReview()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            const two = yield* written(missionId, remark('The exported CSV lacks column titles.'))
            const asked = yield* written(missionId, question('Why is the date in UTC?'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            const point = yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [
                byHand('the user exports the invoices', 'the first line names the columns'),
              ],
              decisions: [],
              sources: [one.id, two.id],
            })
            const asPoint = yield* using(grantId, 'round_point_write', {
              round: 1,
              text: 'Dates are in UTC.',
              kind: 'corrective',
              scenarios: [byHand('the user exports', 'the dates are in UTC')],
              decisions: [],
              sources: [asked.id],
            })
            const answer = yield* used(grantId, 'feedback_answer', {
              source: asked.id,
              text: 'The invoices are dated in UTC so that every office reads the same day.',
            })
            const notAQuestion = yield* using(grantId, 'feedback_answer', {
              source: one.id,
              text: 'Done.',
            })
            return {
              point,
              asPoint,
              answer,
              notAQuestion,
              round: yield* Rounds.use((rounds) => rounds.round(missionId, 1)),
              feedback: yield* feedbackNow(missionId),
              ids: { one: one.id, two: two.id, asked: asked.id },
            }
          }),
        ),
      )
      expect(seen.point).toContain('R1.1')
      expect(seen.round.points.map((one) => [one.id, one.sources])).toEqual([
        ['R1.1', [seen.ids.one, seen.ids.two]],
      ])
      expect(seen.round.points[0]?.scenarios.map((one) => one.id)).toEqual(['R1.1.S1'])
      expect(seen.asPoint.ok).toBe(false)
      expect(seen.asPoint.text).toContain('is a question')
      expect(seen.feedback.get(seen.ids.asked)).toMatchObject({
        state: 'addressed',
        answer: 'The invoices are dated in UTC so that every office reads the same day.',
      })
      expect(seen.notAQuestion.ok).toBe(false)
      expect(seen.notAQuestion.text).toContain('only a question')
      expect(seen.feedback.get(seen.ids.one)?.state).toBe('in_round')
    },
  )

  test(
    'a conflict with the frozen Spec is a wave question with its three outcomes, shown in Home’s Questions group; "clarify" records a decision, "withdraw" withdraws the feedback',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* inReview()
            const xml = yield* written(missionId, remark('Export as XML rather than CSV.'))
            const pdf = yield* written(missionId, remark('Export a PDF too.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            const wave = yield* used(grantId, 'ask_wave', {
              questions: [
                {
                  text: 'R1 exports the invoices as CSV: should the export be XML instead?',
                  why: 'The remark goes against what the frozen Spec says.',
                  options: [],
                  recommended: 0,
                  recommended_reason: 'R1 names no format: XML fits it.',
                  conflict: xml.id,
                },
                {
                  text: 'R1 exports one file: should it also make a PDF?',
                  why: 'The remark adds a file the frozen Spec does not have.',
                  options: [],
                  recommended: 1,
                  recommended_reason: 'A PDF is a mission of its own.',
                  conflict: pdf.id,
                },
              ],
            })
            const asked = (yield* wavesOf(missionId)).flatMap((one) => one.questions)
            const home = yield* questionsOf(missionId)
            const [first, second] = asked.slice(-2)
            yield* answerQuestion(missionId, first?.id ?? '', {
              text: 'R1 does not name CSV: XML is the format of the export.',
            })
            yield* answerQuestion(missionId, second?.id ?? '', { optionId: 'B' })
            const again = yield* answerQuestion(missionId, second?.id ?? '', {
              optionId: 'A',
            }).pipe(Effect.flip)
            const spec = yield* used(grantId, 'spec_read', {})
            return {
              wave,
              asked: asked.slice(-2),
              home,
              again: again.message,
              round: yield* Rounds.use((rounds) => rounds.round(missionId, 1)),
              feedback: yield* feedbackNow(missionId),
              ids: { xml: xml.id, pdf: pdf.id },
              spec,
            }
          }),
        ),
      )
      expect(seen.asked.map((one) => one.options.map((option) => option.label))).toEqual([
        [CLARIFY, WITHDRAW_FEEDBACK, CANCEL_MISSION_TOO],
        [CLARIFY, WITHDRAW_FEEDBACK, CANCEL_MISSION_TOO],
      ])
      expect(seen.home.map((one) => one.questionId)).toEqual(seen.asked.map((one) => one.id))
      expect(seen.round.questions).toEqual(seen.asked.map((one) => one.id))
      expect(seen.round.decisions).toEqual([
        expect.objectContaining({
          kind: 'clarify',
          feedbackId: seen.ids.xml,
          choice: 'R1 does not name CSV: XML is the format of the export.',
        }),
      ])
      expect(seen.spec).toContain('R1 does not name CSV: XML is the format of the export.')
      expect(seen.feedback.get(seen.ids.pdf)?.state).toBe('withdrawn')
      expect(seen.feedback.get(seen.ids.xml)?.state).toBe('in_round')
      expect(seen.again).toContain('applied')
    },
  )

  test(
    'a conflict answered "cancel" cancels the mission, as its Cancel does (open question 35)',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* inReview()
            const xml = yield* written(missionId, remark('Export as XML rather than CSV.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            yield* used(grantId, 'ask_wave', {
              questions: [
                {
                  text: 'R1 exports the invoices as CSV: should the export be XML instead?',
                  why: 'The remark goes against what the frozen Spec says.',
                  options: [],
                  recommended: 0,
                  recommended_reason: 'R1 names no format.',
                  conflict: xml.id,
                },
              ],
            })
            const [asked] = (yield* wavesOf(missionId)).flatMap((one) => one.questions).slice(-1)
            yield* answerQuestion(missionId, asked?.id ?? '', { optionId: 'C' })
            yield* until(
              Effect.map(
                sessionsIn(['starting', 'working', 'idle', 'stuck'], {
                  kind: 'mission',
                  missionId,
                }),
                (live) => live.length === 0,
              ),
              LONG,
            )
            return { mission: yield* getMission(missionId) }
          }),
        ),
      )
      expect(seen.mission.stage).toBe('cancelled')
    },
  )

  test(
    'a feedback adding a requirement gets the "Start a mission from this" question; a mission started from it closes it, its origin linked',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId } = yield* inReview()
            const sync = yield* written(
              missionId,
              remark('Also send the invoices to the accounting system.'),
            )
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            const proposed = yield* used(grantId, 'round_propose_mission', {
              feedback: sync.id,
              reason: 'R1 says nothing of an accounting system: a requirement the Spec lacks.',
            })
            const [asked] = (yield* wavesOf(missionId)).flatMap((one) => one.questions).slice(-1)
            yield* answerQuestion(missionId, asked?.id ?? '', { optionId: 'A' })
            const answered = (yield* feedbackNow(missionId)).get(sync.id)
            const prefill = yield* Rounds.use((rounds) => rounds.startMissionFrom(sync.id))
            const started = yield* createStart({
              projectId,
              text: prefill.text,
              origin: prefill.origin,
              originFeedback: prefill.feedbackId,
              idempotencyKey: 'from-the-round',
            })
            yield* until(
              Effect.map(feedbackNow(missionId), (all) => all.get(sync.id)?.state === 'resolved'),
              LONG,
            )
            return {
              proposed,
              asked,
              answered,
              prefill,
              started,
              closed: (yield* feedbackNow(missionId)).get(sync.id),
              key: (yield* getMission(missionId)).key,
            }
          }),
        ),
      )
      expect(seen.asked?.options.map((one) => one.label)).toEqual([START_A_MISSION, KEEP_IN_ROUND])
      expect(seen.asked?.text).toContain('Also send the invoices to the accounting system.')
      expect(seen.answered).toMatchObject({ state: 'addressed', answer: TO_A_MISSION })
      expect(seen.prefill).toMatchObject({
        text: 'Also send the invoices to the accounting system.',
        originSaid: `Started from ${seen.key}, round 1`,
      })
      expect(seen.started.origin).toBe(seen.prefill.origin)
      expect(seen.closed?.answer).toContain(seen.started.key)
    },
  )
})

describe('round_ready', () => {
  test(
    'round_ready is refused, naming the reason, with an unintegrated answer, a feedback without outcome, a point without proof, a task graph with a cycle',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* inReview()
            const header = yield* written(missionId, remark('The CSV has no header row.'))
            const name = yield* written(missionId, remark('The file name has no date.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            const ready = () => using(grantId, 'round_ready', { why: 'Every remark is a point.' })
            const none = yield* ready()
            yield* used(grantId, 'ask_wave', {
              questions: [
                {
                  text: 'Which date goes in the file name: the export’s or the last invoice’s?',
                  why: 'The remark does not say.',
                  options: [
                    { label: 'The export’s', detail: 'Today.' },
                    { label: 'The last invoice’s', detail: 'Its own date.' },
                  ],
                  recommended: 0,
                  recommended_reason: 'The export reads the invoices of the day.',
                },
              ],
            })
            const [asked] = (yield* wavesOf(missionId)).flatMap((one) => one.questions).slice(-1)
            const open = yield* ready()
            yield* answerQuestion(missionId, asked?.id ?? '', { optionId: 'A' })
            // The answer reaches the Planner, which takes it in a turn of its own.
            yield* until(
              Effect.map(inputsOf(missionId), (inputs) =>
                inputs.some((one) => one.item === asked?.id && one.state === 'delivered'),
              ),
              LONG,
            )
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [],
              decisions: [],
              sources: [header.id],
            })
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The file name carries the date of the export.',
              kind: 'corrective',
              scenarios: [byHand('the user exports', 'the file name holds today’s date')],
              decisions: [],
              sources: [name.id],
            })
            const unproven = yield* ready()
            yield* used(grantId, 'round_point_write', {
              round: 1,
              id: 'R1.1',
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [automated('the user exports the invoices', 'the first line names them')],
              decisions: [],
              sources: [header.id],
            })
            const cycle = yield* using(grantId, 'round_tasks_write', {
              round: 1,
              tasks: [
                {
                  title: 'Write the header',
                  result: 'The CSV has its header.',
                  points: ['R1.1'],
                  scenarios: ['R1.1.S1'],
                  targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
                  depends_on: ['Date the file'],
                },
                {
                  title: 'Date the file',
                  result: 'The file name has its date.',
                  points: ['R1.2'],
                  scenarios: ['R1.2.S1'],
                  targets: [{ repository: 'api', path: 'export-name.ts', intent: 'create' }],
                  depends_on: ['Write the header'],
                },
              ],
            })
            const untasked = yield* ready()
            const unintegrated = untasked
            return {
              none,
              open,
              unproven,
              cycle,
              untasked,
              unintegrated,
              asked: asked?.id ?? '',
              ids: { header: header.id, name: name.id },
              state: (yield* Review.use((review) => review.state(missionId))).rounds,
            }
          }),
        ),
      )
      expect(seen.none.ok).toBe(false)
      expect(seen.none.text).toContain(`${seen.ids.header} has no outcome`)
      expect(seen.none.text).toContain(`${seen.ids.name} has no outcome`)
      expect(seen.open.text).toContain(`${seen.asked} is open`)
      expect(seen.unproven.text).toContain('R1.1 has no scenario with its proof')
      expect(seen.cycle.ok).toBe(false)
      expect(seen.cycle.text).toContain('Write the header → Date the file → Write the header')
      expect(seen.untasked.text).toContain('R1.1.S1 is covered by no task')
      expect(seen.unintegrated.text).toMatch(/I\d+ is not integrated/)
      expect(seen.state.map((one) => one.state)).toEqual(['grilling'])
    },
  )
})

/** A PNG of 640 × 480: its signature and its IHDR, which is all the store reads. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e00806000000', 'hex')

const HEADINGS = {
  documenter: '## Documenter · ',
  'spec-reviewer': '## Spec reviewer · ',
  'code-reviewer': '## Code reviewer · ',
}

interface Held {
  readonly agents: ReadonlyArray<{
    answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> }
  }>
  readonly release: (index: number) => void
}

/** The `count`-th agent of a role in the mission once it read its brief, and a grant to drive it. */
const agentOf = (world: Held, missionId: string, role: keyof typeof HEADINGS, count = 1) =>
  Effect.gen(function* () {
    const heading = HEADINGS[role]
    const indexes = () =>
      world.agents.flatMap((agent, index) =>
        text(agent.answers.prompts[0] ?? []).includes(heading) ? [index] : [],
      )
    yield* until(
      Effect.sync(() => indexes().length >= count),
      LONG,
    )
    const index = indexes()[count - 1] ?? -1
    const opened = Effect.map(sessionsIn(SESSION_STATES, { kind: 'mission', missionId }), (rows) =>
      rows
        .filter((row) => row.role === role)
        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    )
    yield* until(
      Effect.map(opened, (rows) => rows.length >= count),
      LONG,
    )
    const session = (yield* opened).at(-1)
    if (session === undefined) return yield* Effect.die(new Error(`no ${role}`))
    return { session, index, grantId: yield* grantOf(session.id) }
  })

const NO_DOC = 'The header row changes no behaviour the README describes to its readers.'

/** The documenter of the `count`-th pass reports that nothing needed to change, and ends. */
const documented = (world: Held, missionId: string, count = 1) =>
  Effect.gen(function* () {
    const documenter = yield* agentOf(world, missionId, 'documenter', count)
    yield* used(documenter.grantId, 'docs_report', { changed: [], no_change_reason: NO_DOC })
    world.release(documenter.index)
  })

/** Both reviewers report no finding, and end. */
const reviewedBoth = (world: Held, missionId: string, count = 1) =>
  Effect.gen(function* () {
    for (const role of ['spec-reviewer', 'code-reviewer'] as const) {
      const reviewer = yield* agentOf(world, missionId, role, count)
      yield* used(reviewer.grantId, 'review_report', { findings: [] })
      world.release(reviewer.index)
    }
  })

/** Waits until the mission is in a stage. */
const inStage = (missionId: string, stage: string) =>
  until(
    Effect.map(getMission(missionId), (mission) => mission.stage === stage),
    LONG,
  )

/** The mission's latest Building, once it is the one of a round. */
const roundBuilding = (missionId: string, round: number) =>
  Effect.gen(function* () {
    yield* until(
      Effect.map(buildingOf(missionId), (view) => view?.round?.number === round),
      LONG,
    )
    const view = yield* buildingOf(missionId)
    if (view === null) return yield* Effect.die(new Error('no Building'))
    return view
  })

/** Waits until a scenario's proof of the latest Building is in a state. */
const proofIn = (missionId: string, scenario: string, state: string) =>
  until(
    Effect.map(buildingOf(missionId), (view) =>
      (view?.requirements ?? [])
        .flatMap((one) => one.scenarios)
        .some((one) => one.scenario === scenario && one.state === state),
    ),
    LONG,
  )

/** Every row of the frozen Spec, as the database keeps it. */
const specRows = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return JSON.stringify({
      specs: yield* database.select().from(specs).where(eq(specs.missionId, missionId)),
      sections: yield* database
        .select()
        .from(specSections)
        .where(eq(specSections.missionId, missionId))
        .orderBy(asc(specSections.name)),
      requirements: yield* database
        .select()
        .from(specRequirements)
        .where(eq(specRequirements.missionId, missionId))
        .orderBy(asc(specRequirements.id)),
      scenarios: yield* database
        .select()
        .from(specScenarios)
        .where(eq(specScenarios.missionId, missionId))
        .orderBy(asc(specScenarios.id)),
      proofs: yield* database
        .select()
        .from(specProofs)
        .where(eq(specProofs.missionId, missionId))
        .orderBy(asc(specProofs.scenarioId)),
      tasks: yield* database
        .select()
        .from(specTasks)
        .where(eq(specTasks.missionId, missionId))
        .orderBy(asc(specTasks.id)),
    })
  })

/** The header point, its scenario by hand, built by one task changing `invoices.ts`. */
const headerRound = (grantId: string, sources: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* used(grantId, 'round_point_write', {
      round: 1,
      text: 'The CSV export starts with a header row naming each column.',
      kind: 'corrective',
      scenarios: [byHand('the user exports the invoices', 'the first line names the columns')],
      decisions: [],
      sources: [...sources],
    })
    yield* used(grantId, 'round_tasks_write', {
      round: 1,
      tasks: [
        {
          title: 'Write the header',
          result: 'The CSV starts with its header row.',
          points: ['R1.1'],
          scenarios: ['R1.1.S1'],
          targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
          depends_on: [],
        },
      ],
    })
    return yield* used(grantId, 'round_ready', {
      why: 'The remarks are one point, built by one task.',
    })
  })

/** The round's Builder builds its one task, writing the header into `invoices.ts`. */
const builtHeader = (grantId: string) =>
  Effect.gen(function* () {
    const started = yield* using(grantId, 'task_start', { task: 'R1.T1' })
    if (!started.ok || started.text.startsWith('refused')) {
      return yield* Effect.die(new Error(started.text))
    }
    yield* used(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
    yield* used(grantId, 'fs_write', {
      repository: 'api',
      path: 'invoices.ts',
      content: "export const header = 'number,date,amount'\nexport const invoices = []\n",
    })
    yield* used(grantId, 'task_finished', { task: 'R1.T1', summary: 'The header row is written.' })
  })

/** The round's Builder: a fresh one, idle, not of `before`'s lineage, and a grant to drive it. */
const roundBuilderOf = (missionId: string, before: string) =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'builder' && row.lineage !== before) ?? null,
    )
    yield* until(
      Effect.map(idle, (found) => found !== null),
      LONG,
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Builder for the round'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** What was delivered to the mission's Builder, as `kind: body`. */
const toBuilder = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select()
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.ownerId, missionId))
      .orderBy(asc(sessionDeliveries.createdAt)))
      .filter((row) => row.targetRole === 'builder')
      .map((row) => `${row.kind}: ${row.body}`)
  })

/** The mission's first Builder's lineage, before its Building ended into Review. */
const firstBuilder = (missionId: string) =>
  Effect.map(builderOf(missionId), (builder) => builder.session.lineage)

/** A mission launched over Acme's `api`, its first Building ended, its first Builder's lineage. */
const reviewed = () =>
  Effect.gen(function* () {
    const { mission, project } = yield* launched(work)
    const lineage = yield* firstBuilder(mission.id)
    yield* intoReview(mission.id)
    return { missionId: mission.id, projectId: project.id, key: mission.key, lineage }
  })

describe('"Building · round N"', () => {
  test(
    'the mission shows "Building · round 1", a fresh Builder session gets the round brief with its images (blocks or paths), and the frozen Spec\'s rows are byte-for-byte unchanged after the round',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const before = yield* specRows(missionId)
            const image = yield* Review.use((review) =>
              review.imageAdd(missionId, 'no-header.png', PNG),
            )
            const one = yield* written(missionId, {
              kind: 'remark',
              body: 'The CSV has no header row.',
              anchor: null,
              images: [image.evidenceId],
            })
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            const readied = yield* headerRound(planner.grantId, [one.id])
            const view = yield* roundBuilding(missionId, 1)
            const stage = yield* getMission(missionId)
            const builder = yield* roundBuilderOf(missionId, lineage)
            const brief = text(
              world.agents.findLast((agent) =>
                text(agent.answers.prompts[0] ?? []).includes('## Builder · '),
              )?.answers.prompts[0] ?? [],
            )
            // The Planner in round mode ended: the Builder is the mission's main session now.
            const planners = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
              kind: 'mission',
              missionId,
            })
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'The export now writes a header row first.',
            })
            yield* documented(world, missionId)
            yield* reviewedBoth(world, missionId)
            yield* inStage(missionId, 'review')
            const database = yield* Database
            return {
              readied,
              view,
              stage,
              builder: builder.session,
              lineage,
              brief,
              planners: planners.filter((row) => row.role === 'round-planner'),
              before,
              after: yield* specRows(missionId),
              evidence: image,
              key: stage.key,
              buildings: yield* database
                .select({ round: buildings.round, label: buildings.label, state: buildings.state })
                .from(buildings)
                .where(eq(buildings.missionId, missionId))
                .orderBy(asc(buildings.startedAt)),
            }
          }),
        ),
      )
      expect(seen.readied).toContain('Building · round 1')
      expect(seen.view).toMatchObject({ label: 'Building · round 1', round: { number: 1 } })
      expect(seen.stage).toMatchObject({ stage: 'building', round: 1 })
      // A fresh Builder: a lineage of its own, never the first Building's resumed.
      expect(seen.builder.lineage).not.toBe(seen.lineage)
      expect(seen.planners).toEqual([])
      expect(seen.brief).toContain('Building · round 1')
      expect(seen.brief).toContain('R1.1')
      expect(seen.brief).toContain('The CSV export starts with a header row naming each column.')
      expect(seen.brief).toContain('The CSV has no header row.')
      expect(seen.brief).toMatch(
        new RegExp(`Image: .*${seen.key}.evidence.${seen.evidence.sha256}\\.png`),
      )
      expect(seen.brief).toContain('R1.T1 · Write the header')
      // The round's Building is a new Building of the mission: the first one stays ended.
      expect(seen.buildings).toEqual([
        { round: null, label: 'Building', state: 'ended' },
        { round: 1, label: 'Building · round 1', state: 'ended' },
      ])
      expect(seen.after).toBe(seen.before)
    },
  )

  test(
    'a testable point is red then green; a behaviour point is a decision with a proven scenario and a delta carrying the living version',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId, lineage } = yield* reviewed()
            const living = yield* livingInvoices(projectId)
            const header = yield* written(missionId, remark('The CSV has no header row.'))
            const named = yield* written(missionId, remark('Name the file after the export date.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [automated('the user exports the invoices', 'the first line names them')],
              decisions: [],
              sources: [header.id],
            })
            const stale = yield* using(grantId, 'round_point_write', {
              round: 1,
              text: 'The exported file is named after the export date.',
              kind: 'behaviour',
              delta: { requirement: living, change: 'modified', living_version: 7 },
              scenarios: [byHand('the user exports', 'the file is named invoices-<date>.csv')],
              decisions: [],
              sources: [named.id],
            })
            const noDelta = yield* using(grantId, 'round_point_write', {
              round: 1,
              text: 'The exported file is named after the export date.',
              kind: 'behaviour',
              scenarios: [byHand('the user exports', 'the file is named invoices-<date>.csv')],
              decisions: [],
              sources: [named.id],
            })
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The exported file is named after the export date.',
              kind: 'behaviour',
              delta: { requirement: living, change: 'modified', living_version: 1 },
              scenarios: [byHand('the user exports', 'the file is named invoices-<date>.csv')],
              decisions: [
                {
                  choice: 'The file is named invoices-<date>.csv.',
                  alternatives: ['invoices.csv, the date inside'],
                  why: 'The user sorts the exports by name.',
                },
              ],
              sources: [named.id],
            })
            yield* used(grantId, 'round_tasks_write', {
              round: 1,
              tasks: [
                {
                  title: 'Write the header',
                  result: 'The CSV starts with its header row.',
                  points: ['R1.1'],
                  scenarios: ['R1.1.S1'],
                  targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
                  depends_on: [],
                },
              ],
            })
            yield* used(grantId, 'round_ready', { why: 'Two points: a fix and a decision.' })
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* proofIn(missionId, 'R1.1.S1', 'red_recorded')
            yield* builtHeader(builder.grantId)
            yield* proofIn(missionId, 'R1.1.S1', 'green')
            const spec = yield* used(builder.grantId, 'spec_read', {})
            for (const one of [header, named]) {
              yield* used(builder.grantId, 'feedback_answer', {
                source: one.id,
                text: `${one.id} is built.`,
              })
            }
            yield* documented(world, missionId)
            yield* reviewedBoth(world, missionId)
            yield* inStage(missionId, 'review')
            return {
              stale,
              noDelta,
              spec,
              living,
              round: yield* Rounds.use((rounds) => rounds.round(missionId, 1)),
            }
          }),
        ),
      )
      expect(seen.stale.ok).toBe(false)
      expect(seen.stale.text).toContain(`${seen.living} is at version 1 of the living spec, not 7`)
      expect(seen.noDelta.ok).toBe(false)
      expect(seen.noDelta.text).toContain('a behaviour change carries its delta')
      const [fixed, behaviour] = seen.round.points
      expect(fixed?.scenarios).toEqual([
        expect.objectContaining({ id: 'R1.1.S1', mode: 'automated', proof: 'green' }),
      ])
      expect(behaviour).toMatchObject({
        id: 'R1.2',
        kind: 'behaviour',
        delta: { requirement: seen.living, change: 'modified', livingVersion: 1 },
      })
      expect(behaviour?.scenarios.map((one) => one.id)).toEqual(['R1.2.S1'])
      expect(seen.round.decisions.map((one) => [one.kind, one.point])).toEqual([
        ['behaviour', 'R1.2'],
        ['point', 'R1.2'],
      ])
      expect(seen.spec).toContain('## Decisions taken in Review rounds')
      expect(seen.spec).toContain('The exported file is named after the export date.')
      expect(seen.spec).toContain('The file is named invoices-<date>.csv.')
    },
  )
})

describe('The way back to Review', () => {
  test(
    'the documenter and the end sequence run; a source without answer holds the end; after it the mission is back in Review, the feedback addressed, the round answered, a Review checkpoint recorded',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            const two = yield* written(missionId, remark('The exported CSV lacks column titles.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id, two.id])
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'The export now writes a header row first.',
            })
            // The end waits on the source left without an answer, and names it to the Builder.
            yield* until(
              Effect.map(toBuilder(missionId), (told) =>
                told.some((line) => line.startsWith('answers:') && line.includes(two.id)),
              ),
              LONG,
            )
            const waiting = yield* buildingOf(missionId)
            const documenters = (yield* sessionsIn(SESSION_STATES, {
              kind: 'mission',
              missionId,
            })).filter((row) => row.role === 'documenter')
            const answeredTwice = yield* using(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'Again.',
            })
            yield* used(builder.grantId, 'feedback_answer', {
              source: two.id,
              text: 'The same header row names every column.',
            })
            yield* documented(world, missionId)
            yield* reviewedBoth(world, missionId)
            yield* inStage(missionId, 'review')
            yield* until(
              Effect.map(
                Review.use((review) => review.state(missionId)),
                (state) => state.checkpoints.some((checkpoint) => checkpoint.round === 1),
              ),
              LONG,
            )
            return {
              waiting,
              documenters,
              answeredTwice,
              told: yield* toBuilder(missionId),
              state: yield* Review.use((review) => review.state(missionId)),
              types: yield* typesOf(missionId),
              ids: { one: one.id, two: two.id },
            }
          }),
        ),
      )
      expect(seen.waiting?.phase).toBe('answers')
      expect(seen.documenters).toEqual([])
      expect(seen.answeredTwice.ok).toBe(false)
      expect(seen.told.filter((line) => line.startsWith('answers:'))).toHaveLength(1)
      expect(seen.state.rounds.map((one) => [one.number, one.state])).toEqual([[1, 'answered']])
      expect(seen.state.feedback.map((one) => [one.id, one.state])).toEqual([
        [seen.ids.one, 'addressed'],
        [seen.ids.two, 'addressed'],
      ])
      expect(seen.state.feedback.map((one) => one.answer)).toEqual([
        'The export now writes a header row first.',
        'The same header row names every column.',
      ])
      expect(seen.state.checkpoints.map((one) => [one.round, one.kind])).toEqual([
        [0, 'review_entry'],
        [1, 'round_end'],
      ])
      // The end starts once every source is answered, and the round is answered with the move.
      const types = seen.types
      expect(types.lastIndexOf('review.feedback_answered')).toBeLessThan(
        types.indexOf('building.end_started', types.indexOf('review.round_building')),
      )
      expect(types.indexOf('review.round_answered')).toBeGreaterThan(
        types.lastIndexOf('building.ended'),
      )
    },
  )
})
