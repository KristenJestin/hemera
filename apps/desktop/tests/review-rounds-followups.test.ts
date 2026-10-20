/**
 * The rounds' follow-ups after #476 (#485): a point that answers nothing once its sources moved to
 * a mission of their own, a feedback a mission starts from while its round still runs, a round
 * grilled without its Workspace, and a carried Spec proof whose test the user edited in Review.
 *
 * On the engine as it starts (`review-rounds-world.ts`): the fake agent of #32 as every agent, the
 * Builders and the round's Planner driven through their grants, Acme's `api` in temporary folders.
 */

import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { START_A_MISSION } from '@hemera/core/domain'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { buildingOf } from '../src/engine/building/builder.ts'
import { BUILDING_MAPPERS } from '../src/engine/building/journal.ts'
import { eventOf } from '../src/engine/journal.ts'
import { getMission } from '../src/engine/missions.ts'
import { retryNeed } from '../src/engine/needs.ts'
import { answerQuestion } from '../src/engine/planning/calls.ts'
import { inputsOf, wavesOf } from '../src/engine/planning/questions.ts'
import { Rounds } from '../src/engine/review/rounds.ts'
import { createStart } from '../src/engine/start/field.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents } from '../src/engine/storage/schema.ts'
import { builderOf, launched } from './builder-world.ts'
import {
  LONG,
  SLOW,
  builtHeader,
  deliveredTo,
  feedbackNow,
  fix,
  headerPoint,
  headerRound,
  headerTask,
  liveOf,
  proofIn,
  remark,
  reviewed,
  roundBuilderOf,
  roundBuilding,
  roundPlannerOf,
  rounding,
  roundsOf,
  throughEnd,
  used,
  using,
  withdrawn,
  workspaceOf,
  written,
} from './review-rounds-world.ts'
import { until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('review-rounds-followups'))
  work = realpathSync.native(temporaryFolder('review-rounds-followups-work'))
})
afterEach(removeFolders)

/**
 * The user answers the round's latest question with its first option, and the Planner integrates
 * the answer once it is delivered.
 */
const answeredFirst = (missionId: string, grantId: string) =>
  Effect.gen(function* () {
    const [asked] = (yield* wavesOf(missionId)).flatMap((one) => one.questions).slice(-1)
    yield* answerQuestion(missionId, asked?.id ?? '', { optionId: 'A' })
    yield* until(
      Effect.map(inputsOf(missionId), (inputs) =>
        inputs.some((one) => one.item === asked?.id && one.state === 'delivered'),
      ),
      LONG,
    )
    const input = (yield* inputsOf(missionId)).find((one) => one.item === asked?.id)
    yield* used(grantId, 'input_integrated', {
      id: input?.id ?? '',
      where: { no_change: 'It leaves the round for a mission of its own.' },
    })
    return asked
  })

/** A mission started from a feedback, as the start field creates it once prefilled. */
const startedFrom = (projectId: string, feedbackId: string) =>
  Effect.gen(function* () {
    const prefill = yield* Rounds.use((rounds) => rounds.startMissionFrom(feedbackId))
    return yield* createStart({
      projectId,
      text: prefill.text,
      origin: prefill.origin,
      originFeedback: prefill.feedbackId,
      idempotencyKey: `from-${feedbackId}`,
    })
  })

/**
 * The user withdraws `feedbackId` from the grilled round and waits until its Planner is told: the
 * rounds' follower took every event before it, and the start's catch-up ran before the follower.
 */
const withdrawnAndTold = (missionId: string, feedbackId: string) =>
  Effect.gen(function* () {
    yield* withdrawn(feedbackId)
    yield* until(
      Effect.map(deliveredTo(missionId, 'round-planner'), (told) =>
        told.some((line) => line.includes(`The user withdrew ${feedbackId}`)),
      ),
      LONG,
    )
  })

describe('A point whose sources moved to a mission of their own', () => {
  test(
    'a point whose only source moved to a new mission ("Start a mission from this") is refused by round_ready, with its reason, before and after the mission exists; removed, the round is answered',
    SLOW,
    async () => {
      const { run } = rounding(data, work)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId } = yield* reviewed(work)
            const sync = yield* written(
              missionId,
              remark('Also send the invoices to the accounting system.'),
            )
            yield* fix(missionId)
            const { grantId } = yield* roundPlannerOf(missionId)
            // Written while the feedback is the round's; the user then moves it to a mission.
            yield* headerPoint(grantId, [sync.id])
            yield* headerTask(grantId)
            yield* used(grantId, 'round_propose_mission', {
              feedback: sync.id,
              reason: 'R1 says nothing of an accounting system: a requirement the Spec lacks.',
            })
            const asked = yield* answeredFirst(missionId, grantId)
            const addressed = yield* using(grantId, 'round_ready', { why: 'One point.' })
            yield* startedFrom(projectId, sync.id)
            yield* until(
              Effect.map(feedbackNow(missionId), (all) => all.get(sync.id)?.state === 'resolved'),
              LONG,
            )
            const moved = yield* using(grantId, 'round_ready', { why: 'One point.' })
            yield* using(grantId, 'round_point_remove', {
              round: 1,
              id: 'R1.1',
              reason: 'Its source is a mission of its own now.',
            })
            yield* using(grantId, 'round_tasks_write', { round: 1, tasks: [] })
            const ready = yield* using(grantId, 'round_ready', { why: 'Nothing left to build.' })
            return {
              option: asked?.options[0]?.label,
              addressed,
              moved,
              ready,
              rounds: yield* roundsOf(missionId),
            }
          }),
        ),
      )
      expect(seen.option).toBe(START_A_MISSION)
      const reason = `R1.1 comes only from feedback moved to a mission of its own: remove it.`
      expect(seen.addressed.text).toContain('round 1 is not ready to build')
      expect(seen.addressed.text).toContain(reason)
      expect(seen.moved.text).toContain(reason)
      expect(seen.ready.text).toContain('Round 1 has no point to build')
      expect(seen.rounds).toEqual([[1, 'answered']])
    },
  )
})

describe('A mission started from a feedback its round still builds', () => {
  test(
    'a mission started from a feedback its round grills keeps it in the round through a restart and its Building; it closes as moved once the round is answered',
    SLOW,
    async () => {
      const first = rounding(data, work)
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId, lineage } = yield* reviewed(work)
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            const two = yield* written(missionId, remark('The export button is grey.'))
            const three = yield* written(missionId, remark('The file name has no date.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerPoint(planner.grantId, [one.id])
            const started = yield* startedFrom(projectId, one.id)
            yield* withdrawnAndTold(missionId, two.id)
            return {
              missionId,
              lineage,
              planner: planner.session.id,
              ids: { one: one.id, three: three.id },
              started,
              live: (yield* feedbackNow(missionId)).get(one.id),
            }
          }),
        ),
      )
      const after = rounding(data, work, { resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = left
            yield* withdrawnAndTold(missionId, left.ids.three)
            const restarted = (yield* feedbackNow(missionId)).get(left.ids.one)
            const planner = yield* roundPlannerOf(missionId, left.planner)
            yield* headerTask(planner.grantId)
            yield* used(planner.grantId, 'round_ready', { why: 'One point, one task.' })
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, left.lineage)
            yield* builtHeader(builder.grantId)
            const building = (yield* feedbackNow(missionId)).get(left.ids.one)
            yield* used(builder.grantId, 'feedback_answer', {
              source: left.ids.one,
              text: 'The header row is written first.',
            })
            yield* throughEnd(after.world, missionId)
            yield* until(
              Effect.map(
                feedbackNow(missionId),
                (all) => all.get(left.ids.one)?.state === 'resolved',
              ),
              LONG,
            )
            return {
              restarted,
              building,
              closed: (yield* feedbackNow(missionId)).get(left.ids.one),
              rounds: yield* roundsOf(missionId),
            }
          }),
        ),
      )
      expect(left.live?.state).toBe('in_round')
      expect(seen.restarted?.state).toBe('in_round')
      expect(seen.building?.state).toBe('in_round')
      expect(seen.rounds).toEqual([[1, 'answered']])
      expect(seen.closed?.state).toBe('resolved')
      expect(seen.closed?.answer).toContain(left.started.key)
    },
  )
})

describe('A round grilled without its Workspace', () => {
  test(
    'a missing Workspace raises an environment need instead of stalling the grilling: one need through a restart, Retry raises it again while the Workspace is missing, and starts the Planner once it is back',
    SLOW,
    async () => {
      const first = rounding(data, work)
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed(work)
            yield* written(missionId, remark('The CSV has no header row.'))
            const spare = yield* written(missionId, remark('The export button is grey.'))
            const folder = yield* workspaceOf(missionId)
            renameSync(folder, `${folder}.away`)
            yield* fix(missionId)
            yield* until(
              Effect.map(getMission(missionId), (mission) => mission.needs.length > 0),
              LONG,
            )
            return {
              missionId,
              folder,
              spare: spare.id,
              needs: (yield* getMission(missionId)).needs,
              planners: (yield* liveOf(missionId)).filter((row) => row.role === 'round-planner'),
            }
          }),
        ),
      )
      const after = rounding(data, work, { resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = left
            // The start's catch-up meets the same missing Workspace: the need already says it.
            yield* withdrawnAndTold(missionId, left.spare)
            const restarted = (yield* getMission(missionId)).needs
            yield* retryNeed(restarted[0]?.id ?? '')
            yield* until(
              Effect.map(
                getMission(missionId),
                (mission) =>
                  mission.needs.length === 1 && mission.needs[0]?.id !== restarted[0]?.id,
              ),
              LONG,
            )
            const again = (yield* getMission(missionId)).needs
            const planners = (yield* liveOf(missionId)).filter(
              (row) => row.role === 'round-planner',
            )
            renameSync(`${left.folder}.away`, left.folder)
            yield* retryNeed(again[0]?.id ?? '')
            const planner = yield* roundPlannerOf(missionId)
            return {
              restarted,
              again,
              planners,
              planner: planner.session,
              needs: (yield* getMission(missionId)).needs,
            }
          }),
        ),
      )
      expect(left.planners).toEqual([])
      expect(left.needs).toHaveLength(1)
      const fields = left.needs[0]?.fields
      expect(fields !== undefined && Predicate.isTagged(fields, 'Environment')).toBe(true)
      expect(
        fields !== undefined && Predicate.isTagged(fields, 'Environment') ? fields.missing : '',
      ).toBe(
        `The Planner in round mode cannot start round 1: the mission's Workspace is missing (${left.folder}).`,
      )
      expect(seen.restarted.map((one) => one.id)).toEqual(left.needs.map((one) => one.id))
      expect(seen.again).toHaveLength(1)
      expect(seen.planners).toEqual([])
      expect(seen.planner.folder).toBe(left.folder)
      expect(seen.needs).toEqual([])
    },
  )
})

/** Why a start from the feedback is refused, or null when it is allowed. */
const refusalOf = (feedbackId: string) =>
  Rounds.use((rounds) => rounds.startMissionFrom(feedbackId)).pipe(
    Effect.map(() => null),
    Effect.catchTag('FeedbackRefused', (refused) => Effect.succeed(refused.reason)),
  )

describe('A second mission from the same feedback', () => {
  test(
    'a feedback its round still grills or builds refuses a second "Start a mission from this", through a restart and once the round is answered; the first mission gets the link',
    SLOW,
    async () => {
      const first = rounding(data, work)
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId, lineage } = yield* reviewed(work)
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            const two = yield* written(missionId, remark('The export button is grey.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerPoint(planner.grantId, [one.id])
            const started = yield* startedFrom(projectId, one.id)
            yield* withdrawnAndTold(missionId, two.id)
            return {
              missionId,
              lineage,
              planner: planner.session.id,
              one: one.id,
              started,
              again: yield* refusalOf(one.id),
            }
          }),
        ),
      )
      const after = rounding(data, work, { resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = left
            const restarted = yield* refusalOf(left.one)
            const planner = yield* roundPlannerOf(missionId, left.planner)
            yield* headerTask(planner.grantId)
            yield* used(planner.grantId, 'round_ready', { why: 'One point, one task.' })
            yield* roundBuilding(missionId, 1)
            const building = yield* refusalOf(left.one)
            const builder = yield* roundBuilderOf(missionId, left.lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: left.one,
              text: 'The header row is written first.',
            })
            yield* throughEnd(after.world, missionId)
            yield* until(
              Effect.map(feedbackNow(missionId), (all) => all.get(left.one)?.state === 'resolved'),
              LONG,
            )
            return {
              restarted,
              building,
              closed: (yield* feedbackNow(missionId)).get(left.one),
              answered: yield* refusalOf(left.one),
            }
          }),
        ),
      )
      const reason = 'A mission was started from this feedback already.'
      expect(left.again).toBe(reason)
      expect(seen.restarted).toBe(reason)
      expect(seen.building).toBe(reason)
      expect(seen.answered).toBe(reason)
      expect(seen.closed?.answer).toContain(left.started.key)
    },
  )
})

describe('A feedback withdrawn after its mission started', () => {
  test(
    'a feedback withdrawn while its round runs, after a mission was started from it, reads as withdrawn and as moved to that mission once the round is answered',
    SLOW,
    async () => {
      const { world, run } = rounding(data, work)
      const seen = await run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId, projectId, lineage } = yield* reviewed(work)
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            const two = yield* written(missionId, remark('The export button is grey.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerPoint(planner.grantId, [two.id])
            const started = yield* startedFrom(projectId, one.id)
            yield* withdrawnAndTold(missionId, one.id)
            yield* headerTask(planner.grantId)
            yield* used(planner.grantId, 'round_ready', { why: 'One point, one task.' })
            yield* roundBuilding(missionId, 1)
            const builder = yield* roundBuilderOf(missionId, lineage)
            yield* builtHeader(builder.grantId)
            yield* used(builder.grantId, 'feedback_answer', {
              source: two.id,
              text: 'The header row is written first.',
            })
            yield* throughEnd(world, missionId)
            yield* until(
              Effect.map(
                feedbackNow(missionId),
                (all) => all.get(one.id)?.answer?.includes(started.key) === true,
              ),
              LONG,
            )
            return {
              started,
              moved: (yield* feedbackNow(missionId)).get(one.id),
              rounds: yield* roundsOf(missionId),
            }
          }),
        ),
      )
      expect(seen.rounds).toEqual([[1, 'answered']])
      expect(seen.moved?.state).toBe('withdrawn')
      expect(seen.moved?.answer).toBe(`Moved to a new mission: ${seen.started.key}.`)
    },
  )
})

describe('The Planner at a start while the Workspace need waits', () => {
  test(
    'queued deliveries do not open the Planner of a round at an engine start while its missing-Workspace need waits, even with the Workspace back; Retry opens it',
    SLOW,
    async () => {
      const first = rounding(data, work)
      const left = await first.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = yield* reviewed(work)
            yield* written(missionId, remark('The CSV has no header row.'))
            const spare = yield* written(missionId, remark('The export button is grey.'))
            const later = yield* written(missionId, remark('The file name has no date.'))
            const folder = yield* workspaceOf(missionId)
            renameSync(folder, `${folder}.away`)
            yield* fix(missionId)
            yield* until(
              Effect.map(getMission(missionId), (mission) => mission.needs.length > 0),
              LONG,
            )
            // Queued for a Planner that does not run.
            yield* withdrawn(spare.id)
            yield* until(
              Effect.map(deliveredTo(missionId, 'round-planner'), (told) => told.length > 0),
              LONG,
            )
            renameSync(`${folder}.away`, folder)
            return { missionId, later: later.id, needs: (yield* getMission(missionId)).needs }
          }),
        ),
      )
      const after = rounding(data, work, { resumed: true })
      const seen = await after.run(({ profile }) =>
        within(
          profile,
          Effect.gen(function* () {
            const { missionId } = left
            // A later event followed means the start's catch-up has ended.
            yield* withdrawnAndTold(missionId, left.later)
            const planners = (yield* liveOf(missionId)).filter(
              (row) => row.role === 'round-planner',
            )
            const waiting = (yield* getMission(missionId)).needs
            yield* retryNeed(waiting[0]?.id ?? '')
            const planner = yield* roundPlannerOf(missionId)
            return { planners, waiting, planner: planner.session }
          }),
        ),
      )
      expect(seen.planners).toEqual([])
      expect(seen.waiting.map((one) => one.id)).toEqual(left.needs.map((one) => one.id))
      expect(seen.planner.role).toBe('round-planner')
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

/** The mission's events of a type, in their order. */
const eventsOf = (missionId: string, type: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return (yield* database
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.entityId, missionId), eq(domainEvents.type, type)))
      .orderBy(asc(domainEvents.sequence))).map(eventOf)
  })

describe('A carried Spec proof the user edited in Review', () => {
  test(
    'a round’s start keeps the test of a carried Spec proof the user edited in Review, hands its Builder no conflict, and says it',
    SLOW,
    async () => {
      const { world, run } = rounding(data, work)
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
            const builder = yield* builderOf(missionId)
            yield* proofIn(missionId, 'R1.S2', 'red_recorded')
            yield* builtAll(builder.grantId)
            yield* throughEnd(world, missionId)
            const testFile = join(yield* workspaceOf(missionId), 'api', 'tests', 'export.test.mjs')
            const edited = `${readFileSync(testFile, 'utf8')}// Kept by the user.\n`
            writeFileSync(testFile, edited)
            const one = yield* written(missionId, remark('The CSV has no header row.'))
            yield* fix(missionId)
            const planner = yield* roundPlannerOf(missionId)
            yield* headerRound(planner.grantId, [one.id])
            yield* roundBuilding(missionId, 1)
            yield* roundBuilderOf(missionId, builder.session.lineage)
            yield* until(
              Effect.map(
                eventsOf(missionId, 'building.proofs_written'),
                (events) => events.length === 2,
              ),
              LONG,
            )
            const [, round] = yield* eventsOf(missionId, 'building.proofs_written')
            const [kept] = yield* eventsOf(missionId, 'building.proofs_kept')
            const line =
              kept === undefined
                ? null
                : yield* (
                    BUILDING_MAPPERS.get('building.proofs_kept')?.(kept) ?? Effect.succeed(null)
                  )
            return {
              edited,
              file: readFileSync(testFile, 'utf8'),
              payload: round?.payload,
              kept: kept?.payload,
              line: line?.text,
              view: yield* buildingOf(missionId),
              told: yield* deliveredTo(missionId, 'builder'),
            }
          }),
        ),
      )
      expect(seen.file).toBe(seen.edited)
      expect(seen.payload).toMatchObject({ conflicts: [] })
      expect(seen.kept).toEqual({ scenarios: ['R1.S2'] })
      expect(seen.line).toBe(
        'Hemera kept the proof tests of R1.S2 as they are in the Workspace, changed since their Building.',
      )
      expect(seen.told.filter((line) => line.includes('could not be written'))).toEqual([])
      const proof = (seen.view?.requirements ?? [])
        .flatMap((one) => one.scenarios)
        .find((one) => one.scenario === 'R1.S2')
      expect(proof?.state).not.toBe('red_recorded')
    },
  )
})
