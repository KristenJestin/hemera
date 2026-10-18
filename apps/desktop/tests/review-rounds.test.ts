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
import { join } from 'node:path'

import {
  CANCEL_MISSION_TOO,
  ChosenAnswer,
  CLARIFY,
  KEEP_IN_ROUND,
  SESSION_STATES,
  START_A_MISSION,
  TOOLS,
  TO_A_MISSION,
  WITHDRAW_FEEDBACK,
  toolsOf,
} from '@hemera/core/domain'
import { FeedbackUser, type FeedbackView } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Deferred, Effect, Layer, Predicate, type Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { type BuilderHold, buildingOf } from '../src/engine/building/builder.ts'
import { TaskChecks } from '../src/engine/building/checks.ts'
import { judgeManual, proofsRead } from '../src/engine/building/proofs.ts'
import { addRequirement } from '../src/engine/living-spec/store.ts'
import { missionFolder } from '../src/engine/memory/files.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { getMission, moveIn, moveMission } from '../src/engine/missions.ts'
import { answerQuestion } from '../src/engine/planning/calls.ts'
import { inputsOf, openQuestions, wavesOf } from '../src/engine/planning/questions.ts'
import { RETRY } from '../src/engine/building/end.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Review, type FeedbackAsked } from '../src/engine/review/feedback.ts'
import { Rounds } from '../src/engine/review/rounds.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { ROLES_REGISTERED, roleNamed } from '../src/engine/sessions/roles.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { createStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  buildings,
  domainEvents,
  livingDomains,
  proofRuns,
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

/** How the end of a round names the sources left to answer to its Builder. */
const ANSWERS_ASKED = 'The round does not end while a source has no answer'

/**
 * The engine over `folder`: the cold read reads (unless `resumed`), the Builders and the round's
 * Planner answer every prompt, every other agent holds its turn until the test lets it go. A
 * Builder told to answer its sources holds that turn while the test answers them through its
 * grant, unless it `ignores` them: then it ends that turn at once, answering nothing.
 */
const rounding = (
  options: {
    readonly resumed?: boolean
    readonly folder?: string
    readonly hold?: BuilderHold
    /** Where the Fix is held once committed, before its Planner opens. */
    readonly fixed?: Effect.Effect<void>
    readonly ignores?: boolean
  } = {},
) => {
  const answering = held()
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
  const asked = (index: number) =>
    text(engine.world.agents[index]?.answers.prompts.at(-1) ?? []).includes(ANSWERS_ASKED)
  const script = (index: number): FakeScript =>
    index === 0 && options.resumed !== true
      ? READING
      : {
          steps: [says('Working.')],
          between: () =>
            !driven(index)
              ? holdOf(index).promise
              : options.ignores !== true && asked(index)
                ? answering.promise
                : Promise.resolve(),
        }
  const engine = sessionsEngine(options.folder ?? data, script, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    review: { fixed: options.fixed },
    building: {
      hold: options.hold,
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
        answering.release()
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

/**
 * The round's Planner once its first turn ended, and a grant the test drives it with; never the
 * session `before` (one a restart replaces).
 */
const roundPlannerOf = (missionId: string, before = '') =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'round-planner' && row.id !== before) ?? null,
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

/**
 * The round's Builder: idle, not of `before`'s lineage, never the session `replaced` (one a restart
 * replaces), and a grant to drive it.
 */
const roundBuilderOf = (missionId: string, before: string, replaced = '') =>
  Effect.gen(function* () {
    const idle = Effect.map(
      sessionsIn(['idle'], { kind: 'mission', missionId }),
      (rows) =>
        rows.find(
          (row) => row.role === 'builder' && row.lineage !== before && row.id !== replaced,
        ) ?? null,
    )
    yield* until(
      Effect.map(idle, (found) => found !== null),
      LONG,
    )
    const session = yield* idle
    if (session === null) return yield* Effect.die(new Error('no Builder for the round'))
    return { session, grantId: yield* grantOf(session.id) }
  })

/** A grant to the round's Builder holding the turn it was told to answer in. */
const toldBuilderOf = (missionId: string) =>
  Effect.gen(function* () {
    const told = Effect.map(
      sessionsIn(['working'], { kind: 'mission', missionId }),
      (rows) => rows.find((row) => row.role === 'builder') ?? null,
    )
    yield* until(
      Effect.map(told, (found) => found !== null),
      LONG,
    )
    return yield* grantOf((yield* told)?.id ?? '')
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

describe('A Builder that does not answer', () => {
  test(
    'a round’s Builder that ends its turn twice without answering a source is told again, then the user is asked; a restart keeps the need, and its Retry tells the Builder again',
    SLOW,
    async () => {
      const first = rounding({ ignores: true })
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* until(
              Effect.map(getMission(missionId), (mission) => mission.needs.length > 0),
              LONG,
            )
            return {
              missionId,
              one: one.id,
              builder: builder.session.id,
              needs: (yield* getMission(missionId)).needs,
              told: yield* toBuilder(missionId),
              phase: (yield* buildingOf(missionId))?.phase,
            }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const [need] = (yield* getMission(left.missionId)).needs
            yield* answerNeed({
              id: need?.id ?? '',
              answer: ChosenAnswer.make({ option: RETRY }),
              key: 'retry-answers',
            })
            yield* until(
              Effect.map(
                toBuilder(left.missionId),
                (told) => told.filter((line) => line.startsWith('answers:')).length > 2,
              ),
              LONG,
            )
            yield* used(yield* toldBuilderOf(left.missionId), 'feedback_answer', {
              source: left.one,
              text: 'The header row is written first.',
            })
            yield* throughEnd(after.world, left.missionId)
            return {
              told: yield* toBuilder(left.missionId),
              rounds: yield* roundsOf(left.missionId),
            }
          }),
        ),
      )
      const asked = (told: ReadonlyArray<string>) =>
        told.filter((line) => line.startsWith('answers:'))
      expect(left.phase).toBe('answers')
      expect(asked(left.told)).toHaveLength(2)
      expect(left.needs).toHaveLength(1)
      const fields = left.needs[0]?.fields
      expect(fields !== undefined && Predicate.isTagged(fields, 'Error') ? fields.failed : '').toBe(
        `The Builder ended its turn twice without answering ${left.one} with feedback_answer: Retry tells it again.`,
      )
      // The restart said nothing more: only the Retry told the Builder again.
      expect(asked(seen.told)).toHaveLength(3)
      expect(seen.rounds).toEqual([[1, 'answered']])
    },
  )
})

/** The test of the Markdown export: it fails until `export.ts` holds `markdown`. */
const MARKDOWN_TEST = [
  "import { test } from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { existsSync, readFileSync } from 'node:fs'",
  '',
  "test('the scenario holds', () => {",
  "  const file = new URL('../export.ts', import.meta.url)",
  "  assert.ok(existsSync(file) && readFileSync(file, 'utf8').includes('markdown'), 'no markdown')",
  '})',
  '',
].join('\n')

/** The Spec's R1.S2 proven by an automated test; R1.S1 and R1.S3 verified by hand. */
const SPEC_PROOFS = () => ({
  'R1.S2': {
    mode: 'automated',
    actions: ['Run the test'],
    starting_data: 'None.',
    expected: 'The assertion of the test holds.',
    test: {
      repository: 'api',
      path: 'tests/export.test.mjs',
      code: MARKDOWN_TEST,
      insertion: 'new_file',
      command: `"${process.execPath}" --test --test-reporter=tap tests/export.test.mjs`,
    },
    seen_today: false,
  },
})

/** The first Builder runs every task of the plan to its end: T2 writes the Markdown export. */
const builtAll = (grantId: string) =>
  Effect.gen(function* () {
    for (const task of ['T1', 'T2', 'T4', 'T3']) {
      yield* used(grantId, 'task_start', { task })
      if (task === 'T2') {
        yield* used(grantId, 'fs_write', {
          repository: 'api',
          path: 'export.ts',
          content: 'export const markdown = true\n',
        })
      }
      yield* used(grantId, 'task_finished', { task, summary: `${task} built.` })
    }
  })

/** The runs of a scenario's proof in a Building, as `phase: classification`. */
const runsOf = (buildingId: string, scenario: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select()
      .from(proofRuns)
      .where(and(eq(proofRuns.buildingId, buildingId), eq(proofRuns.scenario, scenario)))
      .orderBy(asc(proofRuns.at))).map((run) => `${run.phase}: ${run.classification}`)
  })

describe('The feedback’s images', () => {
  test(
    'the Planner in round mode reads a feedback’s image by its path as an image; a role not listed reads no image there',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, key } = yield* reviewed()
            const image = yield* Review.use((review) =>
              review.imageAdd(missionId, 'no-header.png', PNG),
            )
            yield* written(missionId, {
              ...remark('The CSV has no header row.'),
              images: [image.evidenceId],
            })
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            const path = join(missionFolder(data, key), 'evidence', `${image.sha256}.png`)
            const folder = yield* workspaceOf(missionId)
            const helper = yield* Sessions.use((sessions) =>
              sessions.open({
                owner: { kind: 'mission', missionId },
                role: 'helper',
                folder,
                requestedBy: 'agent',
              }),
            )
            return {
              planner: yield* callTool(planner.grantId, 'fs_read', { path }),
              helper: yield* callTool(yield* grantOf(helper.id), 'fs_read', { path }),
            }
          }),
        ),
      )
      expect(seen.planner).toMatchObject({
        ok: true,
        image: { mimeType: 'image/png', data: PNG.toString('base64') },
      })
      expect(seen.helper.image).toBeUndefined()
    },
  )
})

describe('The Spec’s proofs after a round', () => {
  test(
    'after a real end of the first Building and a round, the Spec’s automated proof is run again on the round’s tree, and a Spec proof by hand is still judged in Review',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { mission } = yield* launched(
              work,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              SPEC_PROOFS,
            )
            const missionId = mission.id
            const first = yield* builderOf(missionId)
            yield* proofIn(missionId, 'R1.S2', 'red_recorded')
            yield* builtAll(first.grantId)
            yield* documented(world, missionId)
            yield* reviewedBoth(world, missionId)
            yield* inStage(missionId, 'review')
            const ended = yield* buildingOf(missionId)
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            const round = yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, first.session.lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'The export now writes a header row first.',
            })
            yield* throughEnd(world, missionId, 2)
            const proofs = yield* proofsRead(missionId)
            const judged = yield* judgeManual(missionId, 'R1.S1', 'validated', null)
            return {
              first: ended?.buildingId,
              round: round.buildingId,
              runs: yield* runsOf(round.buildingId, 'R1.S2'),
              proofs: (proofs?.scenarios ?? []).map((view) => [view.scenario, view.state]),
              judged: judged.state,
            }
          }),
        ),
      )
      expect(seen.round).not.toBe(seen.first)
      // The first Building's runs are carried, and the round changed `api`: the Spec's green ran
      // again on the round's tree, green.
      expect(seen.runs).toEqual(['red: assertion_failed', 'green: passed', 'rerun: passed'])
      expect(seen.proofs).toEqual(
        expect.arrayContaining([
          ['R1.S1', 'to_verify'],
          ['R1.S2', 'green'],
          ['R1.S3', 'to_verify'],
          ['R1.1.S1', 'to_verify'],
        ]),
      )
      expect(seen.judged).toBe('validated')
    },
  )
})

/** The end of a round's Building: its documenter and both reviewers report, the mission is back. */
const throughEnd = (world: Held, missionId: string, count = 1) =>
  Effect.gen(function* () {
    yield* documented(world, missionId, count)
    yield* reviewedBoth(world, missionId, count)
    yield* inStage(missionId, 'review')
  })

/** The mission's sessions still running. */
const liveOf = (missionId: string) =>
  sessionsIn(['starting', 'working', 'idle', 'stuck'], { kind: 'mission', missionId })

/** The rounds of the mission, as `[number, state]`. */
const roundsOf = (missionId: string) =>
  Effect.map(
    Review.use((review) => review.state(missionId)),
    (state) => state.rounds.map((one) => [one.number, one.state] as const),
  )

describe('A stop and a restart', () => {
  test(
    'a restart during grilling resumes without a human relaunch: the Planner in round mode is back with what it wrote, and the round goes on to "Building · round 1"',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [byHand('the user exports the invoices', 'the first line names them')],
              decisions: [],
              sources: [one.id],
            })
            return { missionId, planner: (yield* roundPlannerOf(missionId)).session.id }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { grantId } = yield* roundPlannerOf(left.missionId, left.planner)
            const brief = text(
              after.world.agents.find((agent) =>
                text(agent.answers.prompts[0] ?? []).includes('## Planner · '),
              )?.answers.prompts[0] ?? [],
            )
            const ready = yield* used(grantId, 'round_ready', {
              why: 'One point, verified by hand.',
            })
            const view = yield* roundBuilding(left.missionId, 1)
            return { brief, ready, view }
          }),
        ),
      )
      expect(seen.brief).toContain('Mode: round 1')
      expect(seen.brief).toContain('R1.1')
      expect(seen.ready).toContain('Building · round 1')
      expect(seen.view.label).toBe('Building · round 1')
    },
  )

  test(
    'a Planner in round mode that stops while its round is grilled is brought back, and a stop leaves none past its grilling',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* Sessions.use((sessions) => sessions.end(planner.session.lineage, 'it stopped'))
            yield* until(
              Effect.map(liveOf(missionId), (rows) =>
                rows.some((row) => row.role === 'round-planner' && row.id !== planner.session.id),
              ),
              LONG,
            )
            return { missionId, lineage: planner.session.lineage }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const planner = yield* roundPlannerOf(left.missionId)
            return { planner: planner.session }
          }),
        ),
      )
      // Its own lineage, resumed: what it wrote and was told stays with it.
      expect(seen.planner.lineage).toBe(left.lineage)
    },
  )

  test(
    'a stop between Fix and its Planner opens the Planner in round mode at the next start',
    SLOW,
    async () => {
      const reached = Deferred.makeUnsafe<void>()
      const first = rounding({
        fixed: Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
      })
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            yield* written(missionId, remark('The CSV has no header row.'))
            yield* Effect.forkChild(fix(missionId))
            yield* Deferred.await(reached)
            return {
              missionId,
              planners: (yield* liveOf(missionId)).filter((row) => row.role === 'round-planner'),
            }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.map(roundPlannerOf(left.missionId), (planner) => planner.session),
        ),
      )
      expect(left.planners).toEqual([])
      expect(seen.role).toBe('round-planner')
    },
  )

  test(
    'a restart between round_ready and its Building begins "Building · round 1" at the next start, once',
    SLOW,
    async () => {
      const reached = Deferred.makeUnsafe<void>()
      const first = rounding({
        hold: (at) =>
          at === 'beginning'
            ? Effect.andThen(Deferred.succeed(reached, undefined), Effect.never)
            : Effect.void,
      })
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* Deferred.await(reached)
            const database = yield* Database
            const rows = yield* database
              .select({ round: buildings.round })
              .from(buildings)
              .where(eq(buildings.missionId, missionId))
            return { missionId, lineage, rows, mission: yield* getMission(missionId) }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const view = yield* roundBuilding(left.missionId, 1)
            const builder = yield* roundBuilderOf(left.missionId, left.lineage)
            const database = yield* Database
            return {
              view,
              builder: builder.session,
              rows: yield* database
                .select({ round: buildings.round })
                .from(buildings)
                .where(eq(buildings.missionId, left.missionId)),
            }
          }),
        ),
      )
      expect(left.mission).toMatchObject({ stage: 'building', round: 1 })
      expect(left.rows).toEqual([{ round: null }])
      expect(seen.view.tasks.map((one) => one.id)).toEqual(['R1.T1'])
      expect(seen.rows).toEqual([{ round: null }, { round: 1 }])
    },
  )

  test(
    'a restart during "Building · round 1" resumes its Building and its own Builder, which builds and answers to Review',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            const view = yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            return { missionId, one: one.id, buildingId: view.buildingId, round: builder.session }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const builder = yield* roundBuilderOf(left.missionId, '', left.round.id)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: left.one,
              text: 'The header row is written first.',
            })
            yield* throughEnd(after.world, left.missionId)
            return {
              builder: builder.session,
              view: yield* buildingOf(left.missionId),
              rounds: yield* roundsOf(left.missionId),
            }
          }),
        ),
      )
      expect(seen.builder.lineage).toBe(left.round.lineage)
      expect(seen.view?.buildingId).toBe(left.buildingId)
      expect(seen.rounds).toEqual([[1, 'answered']])
    },
  )

  test(
    'a restart while the round’s end waits on an answer tells the Builder again, and the end goes on once it is given',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* until(
              Effect.map(toBuilder(missionId), (told) =>
                told.some((line) => line.startsWith('answers:')),
              ),
              LONG,
            )
            return { missionId, one: one.id, builder: builder.session.id }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* until(
              Effect.map(
                toBuilder(left.missionId),
                (told) => told.filter((line) => line.startsWith('answers:')).length === 2,
              ),
              LONG,
            )
            yield* used(yield* toldBuilderOf(left.missionId), 'feedback_answer', {
              source: left.one,
              text: 'The header row is written first.',
            })
            yield* throughEnd(after.world, left.missionId)
            return { rounds: yield* roundsOf(left.missionId) }
          }),
        ),
      )
      expect(seen.rounds).toEqual([[1, 'answered']])
    },
  )

  test(
    'a restart during the round’s automatic review runs the reviewers again and comes back to Review, the round answered',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'The header row is written first.',
            })
            yield* documented(first.world, missionId)
            yield* agentOf(first.world, missionId, 'code-reviewer')
            return { missionId, phase: (yield* buildingOf(missionId))?.phase }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            yield* reviewedBoth(after.world, left.missionId)
            yield* inStage(left.missionId, 'review')
            return {
              rounds: yield* roundsOf(left.missionId),
              state: yield* Review.use((review) => review.state(left.missionId)),
            }
          }),
        ),
      )
      expect(left.phase).toBe('review')
      expect(seen.rounds).toEqual([[1, 'answered']])
      expect(seen.state.feedback.map((one) => one.state)).toEqual(['addressed'])
    },
  )
})

describe('More rounds', () => {
  test(
    'a round with no change, every feedback a question answered, is answered at once: the mission stays in Review with the round’s checkpoint, and the Planner ends',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            // A remark that waits, answered as it goes with a new mission of its own.
            const asked = yield* written(missionId, question('Why is the date in UTC?'))
            const other = yield* written(missionId, remark('Send the invoices to the bank too.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            yield* used(grantId, 'feedback_answer', {
              source: asked.id,
              text: 'Every office reads the same day.',
            })
            yield* used(grantId, 'round_propose_mission', {
              feedback: other.id,
              reason: 'A bank is in no requirement of the Spec.',
            })
            const [proposed] = (yield* wavesOf(missionId)).flatMap((one) => one.questions).slice(-1)
            yield* answerQuestion(missionId, proposed?.id ?? '', { optionId: 'A' })
            yield* until(
              Effect.map(inputsOf(missionId), (inputs) =>
                inputs.some((one) => one.item === proposed?.id && one.state === 'delivered'),
              ),
              LONG,
            )
            const input = (yield* inputsOf(missionId)).find((one) => one.item === proposed?.id)
            yield* used(grantId, 'input_integrated', {
              id: input?.id ?? '',
              where: { no_change: 'It leaves the round for a mission of its own.' },
            })
            const ready = yield* used(grantId, 'round_ready', { why: 'Nothing to build.' })
            yield* until(
              Effect.map(
                Review.use((review) => review.state(missionId)),
                (state) => state.checkpoints.some((one) => one.round === 1),
              ),
              LONG,
            )
            yield* until(
              Effect.map(liveOf(missionId), (rows) => rows.length === 0),
              LONG,
            )
            const database = yield* Database
            return {
              ready,
              mission: yield* getMission(missionId),
              rounds: yield* roundsOf(missionId),
              buildings: yield* database
                .select({ round: buildings.round })
                .from(buildings)
                .where(eq(buildings.missionId, missionId)),
            }
          }),
        ),
      )
      expect(seen.ready).toContain('no point to build')
      expect(seen.mission).toMatchObject({ stage: 'review', round: 1 })
      expect(seen.rounds).toEqual([[1, 'answered']])
      expect(seen.buildings).toEqual([{ round: null }])
    },
  )

  test(
    'two rounds in a row: the next Fix closes the answered round, and "Building · round 2" builds the second with a fresh Builder',
    SLOW,
    async () => {
      const { world, run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const first = yield* roundPlannerOf(missionId)
            yield* headerRound(first.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: one.id,
              text: 'The header row is written first.',
            })
            yield* throughEnd(world, missionId)
            const two = yield* written(missionId, remark('The header names the currency too.'))
            yield* fix(missionId)
            const between = yield* roundsOf(missionId)
            const second = yield* until(
              Effect.map(liveOf(missionId), (rows) =>
                rows.some(
                  (row) =>
                    row.role === 'round-planner' &&
                    row.state === 'idle' &&
                    row.lineage !== first.session.lineage,
                ),
              ),
              LONG,
            ).pipe(Effect.andThen(roundPlannerOf(missionId)))
            yield* used(second.grantId, 'round_point_write', {
              round: 2,
              text: 'The header names the currency of the amounts.',
              kind: 'corrective',
              scenarios: [byHand('the user exports', 'the header says amount (EUR)')],
              decisions: [],
              sources: [two.id],
            })
            yield* used(second.grantId, 'round_tasks_write', {
              round: 2,
              tasks: [
                {
                  title: 'Name the currency',
                  result: 'The header names the currency.',
                  points: ['R2.1'],
                  scenarios: ['R2.1.S1'],
                  targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
                  depends_on: [],
                },
              ],
            })
            yield* used(second.grantId, 'round_ready', { why: 'One point.' })
            const view = yield* roundBuilding(missionId, 2)
            const next = yield* roundBuilderOf(missionId, builder.session.lineage)
            const started = yield* using(next.grantId, 'task_start', { task: 'R2.T1' })
            yield* used(next.grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
            yield* used(next.grantId, 'fs_write', {
              repository: 'api',
              path: 'invoices.ts',
              content:
                "export const header = 'number,date,amount (EUR)'\nexport const invoices = []\n",
            })
            yield* used(next.grantId, 'task_finished', { task: 'R2.T1', summary: 'Done.' })
            yield* used(next.grantId, 'feedback_answer', {
              source: two.id,
              text: 'The header names the currency.',
            })
            yield* throughEnd(world, missionId, 2)
            yield* until(
              Effect.map(
                Review.use((review) => review.state(missionId)),
                (state) => state.checkpoints.some((checkpoint) => checkpoint.round === 2),
              ),
              LONG,
            )
            return {
              between,
              view,
              started,
              builders: [lineage, builder.session.lineage, next.session.lineage],
              rounds: yield* roundsOf(missionId),
              checkpoints: (yield* Review.use((review) => review.state(missionId))).checkpoints.map(
                (checkpoint) => checkpoint.round,
              ),
              mission: yield* getMission(missionId),
            }
          }),
        ),
      )
      expect(seen.between).toEqual([
        [1, 'closed'],
        [2, 'grilling'],
      ])
      expect(seen.view.label).toBe('Building · round 2')
      expect(seen.started.ok).toBe(true)
      expect(new Set(seen.builders).size).toBe(3)
      expect(seen.rounds).toEqual([
        [1, 'closed'],
        [2, 'answered'],
      ])
      expect(seen.checkpoints).toEqual([0, 1, 2])
      expect(seen.mission).toMatchObject({ stage: 'review', round: 2 })
    },
  )

  test(
    'a round cancelled while grilled stops its Planner, and the next start brings none back',
    SLOW,
    async () => {
      const first = rounding()
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            yield* roundPlannerOf(missionId)
            yield* moveMission(missionId, 'cancel', 'user')
            yield* until(
              Effect.map(liveOf(missionId), (rows) => rows.length === 0),
              LONG,
            )
            return { missionId }
          }),
        ),
      )
      const after = rounding({ resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            // The start's catch-up has run once the Memory is ready and the gate passed.
            yield* until(
              Effect.map(getMission(left.missionId), (mission) => mission.unstopped.length === 0),
              LONG,
            )
            return {
              mission: yield* getMission(left.missionId),
              live: yield* liveOf(left.missionId),
              rounds: yield* roundsOf(left.missionId),
            }
          }),
        ),
      )
      expect(seen.mission.stage).toBe('cancelled')
      expect(seen.live).toEqual([])
      expect(seen.rounds).toEqual([[1, 'grilling']])
    },
  )

  test(
    'a round cancelled while it builds ends its Building as cancelled, and no agent runs',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, lineage } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            yield* roundBuilderOf(missionId, lineage)
            yield* moveMission(missionId, 'cancel', 'user')
            yield* until(
              Effect.map(liveOf(missionId), (rows) => rows.length === 0),
              LONG,
            )
            return { view: yield* buildingOf(missionId), mission: yield* getMission(missionId) }
          }),
        ),
      )
      expect(seen.mission.stage).toBe('cancelled')
      expect(seen.view).toMatchObject({ label: 'Building · round 1', state: 'cancelled' })
    },
  )

  test(
    'a feedback withdrawn while its round is grilled is told to the Planner; a point from it alone holds round_ready until it is removed',
    SLOW,
    async () => {
      const { run } = rounding()
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed()
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            yield* used(grantId, 'round_point_write', {
              round: 1,
              text: 'The CSV export starts with a header row naming each column.',
              kind: 'corrective',
              scenarios: [byHand('the user exports', 'the first line names the columns')],
              decisions: [],
              sources: [one.id],
            })
            yield* Review.use((review) => review.feedbackWithdraw(one.id, USER))
            const database = yield* Database
            yield* until(
              Effect.map(
                database
                  .select({ kind: sessionDeliveries.kind, body: sessionDeliveries.body })
                  .from(sessionDeliveries)
                  .where(eq(sessionDeliveries.targetRole, 'round-planner')),
                (rows) => rows.some((row) => row.kind === 'withdrawn' && row.body.includes(one.id)),
              ),
              LONG,
            )
            const holding = yield* using(grantId, 'round_ready', { why: 'Done.' })
            yield* used(grantId, 'round_point_remove', {
              round: 1,
              id: 'R1.1',
              reason: 'Its remark was withdrawn.',
            })
            const ready = yield* used(grantId, 'round_ready', { why: 'Nothing left.' })
            return { held: holding, ready, rounds: yield* roundsOf(missionId) }
          }),
        ),
      )
      expect(seen.held.ok).toBe(false)
      expect(seen.held.text).toContain('R1.1 comes only from withdrawn feedback')
      expect(seen.ready).toContain('no point to build')
      expect(seen.rounds).toEqual([[1, 'answered']])
    },
  )

  test(
    'a source withdrawn while its round builds needs no answer: the end goes on without it',
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
              text: 'The header row is written first.',
            })
            yield* Review.use((review) => review.feedbackWithdraw(two.id, USER))
            yield* throughEnd(world, missionId)
            return { state: yield* Review.use((review) => review.state(missionId)) }
          }),
        ),
      )
      expect(seen.state.feedback.map((one) => one.state)).toEqual(['addressed', 'withdrawn'])
      expect(seen.state.rounds.map((one) => one.state)).toEqual(['answered'])
    },
  )
})

describe('The Planner in round mode', () => {
  test('it writes and runs nothing, is the main session of Review, and never counts in the cap', () => {
    const entry = roleNamed(ROLES_REGISTERED, 'round-planner')
    expect(entry).toMatchObject({
      mainOf: 'review',
      writes: false,
      countsInCap: false,
      readsMemory: true,
    })
    expect(
      toolsOf('round-planner').filter(
        (name) => TOOLS[name].effect === 'writes' || TOOLS[name].effect === 'runs',
      ),
    ).toEqual([])
    expect(entry?.template).toContain('## Round mode (your brief says "Mode: round N")')
    expect(roleNamed(ROLES_REGISTERED, 'planner')?.template).toContain('## Round mode')
    expect(roleNamed(ROLES_REGISTERED, 'builder')?.template).toContain(
      '## Round N (your brief says "Building · round N")',
    )
  })
})
