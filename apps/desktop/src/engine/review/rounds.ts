/**
 * A round is a small Spec (#468, R2): what the user's Fix starts, and how the round comes back.
 *
 * - **Fix.** `fix` takes the mission's `collecting` round, refused unless one of its feedback
 *   waits (a question or a withdrawn remark is never fixed) and no other round runs. In one
 *   transaction the round is grilled, an `answered` round before it closes, each waiting feedback
 *   goes into it (read-only from then on, kept as its agents read it, its images by their path),
 *   and `review.fix_started` is written. The mission stays in Review: the hold of #341 applies.
 * - **The grilling.** A fresh session of the Planner in round mode (open question 34) in the
 *   Workspace, read-only. Its questions are #86's waves (scoped to the round, shown in Home's
 *   Questions group), the answers delivered to it as they come (`PlannerWake`). A conflict with the
 *   frozen Spec is a wave question whose three outcomes Hemera offers and acts on; "Start a mission
 *   from this" is one Hemera writes (`round_propose_mission`). The points, their scenarios with
 *   their proofs, their decisions and the round's tasks are the Planner's writes; the frozen Spec
 *   is never written.
 * - **Ready.** `round_ready` checks that every feedback has an outcome, no question of the round
 *   is open, every answer is integrated (CT-26), every point has a scenario with its proof and the
 *   task graph holds; then, in one transaction, the round builds and the mission moves to
 *   "Building · round N" (Fix, by the user who asked for it), which the Builder starts on its own
 *   (`review.round_building`). A round with no point to build is answered at once and the mission
 *   stays in Review. The Planner's session ends: the Builder is the mission's main session now.
 * - **Answers.** `feedback_answer` marks a feedback addressed, never resolved: the Planner answers
 *   the round's questions, the round's Builder the sources of its points.
 * - **A mission of its own.** `startMissionFrom` answers what the start field opens with; once a
 *   mission is created from the feedback, the feedback closes in its round as moved, with the link;
 *   one its round still grills or builds closes once the round is answered. A point whose sources
 *   all moved so answers nothing: `round_ready` refuses it, as one from withdrawn feedback.
 * - **No Workspace.** A round whose Workspace is missing has no Planner: an environment need says
 *   so, once, and its Retry starts the Planner, or raises the need again.
 * - **A stop.** At every start, a round being grilled has its Planner (its lineage resumed, or a
 *   fresh one) and the deliveries a stop left; a Planner left alive past its grilling is ended; a
 *   feedback a new mission was started from and not closed yet is closed.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  EnvironmentFields,
  KEEP_IN_ROUND,
  NEW_MISSION_DETAILS,
  NEW_MISSION_OPTIONS,
  FEEDBACK_KINDS,
  FEEDBACK_STATES,
  type FeedbackStanding,
  ROUND_STATES,
  START_A_MISSION,
  type ToolArguments,
  graphProblemSaid,
  MissionOwner,
  maskedJson,
  missionKey,
  proofRefusals,
  roundLabel,
  roundPointId,
  roundPointRefusal,
  roundScenarioId,
  roundTaskId,
  startedFromSaid,
  taskGraph,
  fixHeldBy,
  waitsForFix,
} from '@hemera/core/domain'
import {
  FeedbackRefused,
  type MissionFromSource,
  type RoundDetailView,
  type RoundPointView,
  UnknownFeedback,
  UnknownMission,
} from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { type DomainEvent, type NewEvent, eventOf } from '../journal.ts'
import { livingStandingIn } from '../living-spec/store.ts'
import { Memory } from '../memory/index.ts'
import { moveIn } from '../missions.ts'
import { type NeedHandler, createNeedIn, needService } from '../needs.ts'
import { prepareDeliveries, queuedForPlanner } from '../planning/handover.ts'
import { askWave } from '../planning/questions.ts'
import { readProof } from '../planning/plan.ts'
import { Secrets } from '../secrets.ts'
import { Sessions } from '../sessions/service.ts'
import { sessionsIn } from '../sessions/store.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  agentSessions,
  buildingTasks,
  buildings,
  domainEvents,
  missions,
  needs,
  planningInputs,
  reviewFeedback,
  reviewRounds,
  roundDecisions,
  roundPoints,
  roundScenarios,
  roundTasks,
  scenarioProofs,
  sessionNeeds,
  specRequirements,
  workspaceRepositories,
  workspaces,
  buildingLaunches,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { Review } from './feedback.ts'
import { RoundDesk } from './round-desk.ts'
import {
  feedbackEventPayload,
  grillingRoundIn,
  roundDecisionsIn,
  roundEvent,
  roundFeedbackIn,
  roundPointsIn,
  roundQuestionsIn,
  roundRowIn,
  roundScenariosIn,
  roundTasksIn,
  workspaceFolderIn,
  writeRoundDecisions,
  writeRoundStrings,
  writeRoundTargets,
} from './round-store.ts'

export interface RoundsService {
  /** The user's Fix: the collecting round grilled, its waiting feedback in it. */
  readonly fix: (
    missionId: string,
  ) => Effect.Effect<void, UnknownMission | FeedbackRefused | DatabaseError>
  /** One round as a small Spec. */
  readonly round: (
    missionId: string,
    number: number,
  ) => Effect.Effect<RoundDetailView, UnknownMission | FeedbackRefused | DatabaseError>
  /** What the start field opens with for "Start a mission from this": nothing is created. */
  readonly startMissionFrom: (
    feedbackId: string,
  ) => Effect.Effect<MissionFromSource, UnknownFeedback | FeedbackRefused | DatabaseError>
}

export class Rounds extends Context.Service<Rounds, RoundsService>()('Rounds') {}

export interface RoundsSettings {
  readonly log: Log
  /** Where a suite holds a Fix once committed, before its Planner opens; never otherwise. */
  readonly fixed?: Effect.Effect<void> | undefined
}

/** Why a Fix is refused when nothing in the collecting round waits for one. */
export const NOTHING_WAITS =
  'Nothing waits for a fix: questions and withdrawn remarks are not fixed.'

/** The needs of a round's grilling: its Planner cannot start without the mission's Workspace. */
export const ROUND_NEEDS = needService('review-rounds')

/** What a round's need says is missing stays missing until the user's Retry tries again. */
export const roundNeeds: NeedHandler = {
  deliver: () => Effect.succeed([]),
  recheck: (_need, retried) => Effect.succeed(!retried),
}

const now = (): string => new Date().toISOString()

const refuse = (reason: string) => Effect.fail(new FeedbackRefused({ reason }))

/** A refusal as the agent reads it. */
const refusedSaid = (sentence: string): ToolAnswer =>
  refusal(sentence.startsWith('refused:') ? sentence : `refused: ${sentence}`)

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

/** A living requirement's id: `LR3`. */
const LIVING_ID = /^LR\d+$/i

/** A requirement of the Spec: `R2`. */
const SPEC_ID = /^R\d+$/

const readString = Schema.decodeUnknownOption(Schema.String)

type Outcome<A> = { readonly refused: string } | { readonly done: A }

/** What a write's transaction answers: its outcome, and the events it records. */
interface Answered<A> {
  readonly result: Outcome<A>
  readonly events: ReadonlyArray<NewEvent>
}

const refusedWith = <A>(sentence: string): Answered<A> => ({
  result: { refused: sentence },
  events: [],
})

/** A refusal or what was done, as the agent reads it; a failure in words. */
const settled = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<Outcome<A>, E, R>,
  done: (value: A) => string,
) =>
  effect.pipe(
    Effect.map((outcome) =>
      'refused' in outcome ? refusedSaid(outcome.refused) : answered(done(outcome.done)),
    ),
    Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
  )

export const roundsLayer = (settings: RoundsSettings) =>
  Layer.effect(
    Rounds,
    Effect.gen(function* () {
      const database = yield* Database
      const events = yield* DomainEvents
      const secrets = yield* Secrets
      const review = yield* Review
      const sessions = yield* Sessions
      const context = yield* Effect.context<Database | DomainEvents | Secrets>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Database | DomainEvents | Secrets>) =>
        Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`rounds: ${line}`))
      /** One start of a round's Planner at a time: two at once would open two sessions. */
      const opening = Semaphore.makeUnsafe(1)

      const missionOf = (missionId: string) =>
        database
          .select()
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(
            Effect.mapError(refusedWhile('reading the mission')),
            Effect.flatMap(([row]) =>
              row === undefined
                ? Effect.fail(new UnknownMission({ id: missionId }))
                : Effect.succeed(row),
            ),
          )

      const keyOf = (row: { readonly keyPrefix: string; readonly keyNumber: number }) =>
        missionKey(row.keyPrefix, row.keyNumber)

      // --- the Planner in round mode -------------------------------------------------------------

      /** The live sessions of the mission's Planner in round mode. */
      const griller = (missionId: string) =>
        Effect.map(sessionsIn([...LIVE], { kind: 'mission', missionId }), (rows) =>
          rows.filter((one) => one.role === 'round-planner'),
        )

      /** Whether the need that the round's Workspace is missing waits on the user's Retry. */
      const workspaceWaits = (missionId: string) =>
        database
          .select({ id: needs.id })
          .from(needs)
          .where(
            and(
              eq(needs.missionId, missionId),
              eq(needs.service, ROUND_NEEDS),
              eq(needs.state, 'pending'),
            ),
          )
          .limit(1)
          .pipe(
            Effect.mapError(refusedWhile('reading the round’s needs')),
            Effect.map((rows) => rows.length > 0),
          )

      /** The round's Planner cannot start without the Workspace: the user is told, and Retries. */
      const workspaceMissing = (missionId: string, round: number, folder: string | null) =>
        Effect.gen(function* () {
          const mission = yield* missionOf(missionId)
          const write = yield* createNeedIn(
            ROUND_NEEDS,
            MissionOwner.make({ projectId: mission.projectId, missionId, taskId: null }),
            EnvironmentFields.make({
              missing: `The Planner in round mode cannot start round ${String(round)}: the mission's Workspace is missing${folder === null ? '' : ` (${folder})`}.`,
              action: 'Put the Workspace back where it was, then Retry; or cancel the mission.',
              settingsSection: null,
            }),
          )
          yield* mutate('saying the round’s Workspace is missing', (transaction) =>
            Effect.map(write(transaction), (made) => ({ result: undefined, events: made.events })),
          )
          yield* said(`no Workspace for round ${String(round)} of ${missionId}`)
        }).pipe(
          provided,
          Effect.catchTags({
            NeedRefused: (refused) => said(`no need for ${missionId}: ${refused.reason}`),
            UnknownMission: () => Effect.void,
            UnknownProject: () => Effect.void,
          }),
        )

      /** The folder of the mission's Workspace while it is on disk, or null. */
      const workspaceThere = (missionId: string) =>
        Effect.map(workspaceFolderIn(database, missionId), (folder) =>
          folder !== null && existsSync(folder) ? folder : null,
        )

      /**
       * The Planner of the round being grilled: nothing when one lives; its lineage resumed when it
       * stopped during this round; a fresh session otherwise, in the Workspace. Without its
       * Workspace, an environment need, once, whose Retry comes back here.
       */
      const ensureGriller = (missionId: string) =>
        Semaphore.withPermits(
          opening,
          1,
        )(
          Effect.gen(function* () {
            const round = yield* grillingRoundIn(database, missionId)
            if (round === null) return
            if ((yield* griller(missionId)).length > 0) return
            if (yield* workspaceWaits(missionId)) return
            if ((yield* workspaceThere(missionId)) === null) {
              return yield* workspaceMissing(
                missionId,
                round,
                yield* workspaceFolderIn(database, missionId),
              )
            }
            const row = yield* roundRowIn(database, missionId, round)
            const owner = { kind: 'mission', missionId } as const
            const last = (yield* sessionsIn(['ended', 'failed', 'replaced'], owner))
              .filter(
                (one) => one.role === 'round-planner' && one.createdAt >= (row?.movedAt ?? ''),
              )
              .toSorted((a, b) => b.epoch - a.epoch)[0]
            if (last !== undefined) {
              const resumed = yield* sessions.resume(last.id)
              if (resumed !== null) return
            }
            const folder = yield* workspaceThere(missionId)
            if (folder === null) return
            yield* sessions.open({ owner, role: 'round-planner', folder }).pipe(
              Effect.asVoid,
              Effect.catchTag('SessionRefused', (refused) =>
                said(`no Planner in round mode for ${missionId}: ${refused.message}`),
              ),
            )
          }),
        )

      /** Whether a need about a session of the mission's round Planner waits on the user. */
      const plannerWaits = (missionId: string) =>
        database
          .select({ id: needs.id })
          .from(sessionNeeds)
          .innerJoin(needs, eq(needs.id, sessionNeeds.needId))
          .innerJoin(agentSessions, eq(agentSessions.id, sessionNeeds.sessionId))
          .where(
            and(
              eq(agentSessions.ownerKind, 'mission'),
              eq(agentSessions.ownerId, missionId),
              eq(agentSessions.role, 'round-planner'),
              eq(needs.state, 'pending'),
            ),
          )
          .limit(1)
          .pipe(
            Effect.mapError(refusedWhile('reading the Planner’s needs')),
            Effect.map((rows) => rows.length > 0),
          )

      /** The round's Planner ended once its grilling is over: the Builder is the main session. */
      const endGriller = (missionId: string, reason: string) =>
        Effect.gen(function* () {
          for (const one of yield* griller(missionId)) yield* sessions.end(one.lineage, reason)
        })

      // --- Fix ---------------------------------------------------------------------------------

      const fix = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* missionOf(missionId)
          if (mission.stage !== 'review') {
            return yield* refuse(
              `Fix is for a mission in Review: ${keyOf(mission)} is in ${mission.stage}.`,
            )
          }
          const rounds = yield* database
            .select()
            .from(reviewRounds)
            .where(eq(reviewRounds.missionId, missionId))
            .orderBy(asc(reviewRounds.number))
            .pipe(Effect.mapError(refusedWhile('reading the rounds')))
          const collecting = rounds.find((one) => one.state === 'collecting')
          const taken =
            collecting === undefined
              ? []
              : (yield* roundFeedbackIn(database, missionId, collecting.number)).filter(
                  (one) => one.state === 'waiting',
                )
          // How the round's agents read each feedback, its images by their path (#341).
          const blocks = yield* review
            .blocks(
              taken.map((one) => one.id),
              false,
            )
            .pipe(Effect.mapError((failed) => new FeedbackRefused({ reason: failed.message })))
          // One text block per feedback, its images by their path: none is an image block here.
          const texts = blocks.flatMap((block) =>
            Predicate.isTagged(block, 'Text') ? [block.text] : [],
          )
          const sayings = new Map(taken.map((one, at) => [one.id, texts[at] ?? one.body] as const))
          yield* provided(
            mutate('starting a Fix', (transaction) =>
              Effect.gen(function* () {
                const at = now()
                const all = yield* transaction
                  .select()
                  .from(reviewRounds)
                  .where(eq(reviewRounds.missionId, missionId))
                  .orderBy(asc(reviewRounds.number))
                  .pipe(Effect.mapError(refusedWhile('reading the rounds')))
                const round = all.find((one) => one.state === 'collecting')
                const rows =
                  round === undefined
                    ? []
                    : yield* roundFeedbackIn(transaction, missionId, round.number)
                if (round === undefined || !waitsForFix(rows.map(standingOf))) {
                  return yield* refuse(NOTHING_WAITS)
                }
                const held = fixHeldBy(round.number, all.map(standingOfRound))
                if (held !== null) return yield* refuse(held)
                const closing: NewEvent[] = []
                for (const other of all) {
                  if (other.number === round.number) continue
                  if (other.state === 'answered') {
                    // The next round's Fix closes the answered one (open question 35).
                    yield* transaction
                      .update(reviewRounds)
                      .set({ state: 'closed', movedAt: at })
                      .where(
                        and(
                          eq(reviewRounds.missionId, missionId),
                          eq(reviewRounds.number, other.number),
                        ),
                      )
                      .pipe(Effect.mapError(refusedWhile('closing a round')))
                    closing.push(
                      roundEvent(missionId, 'review.round_moved', {
                        round: other.number,
                        from: 'answered',
                        to: 'closed',
                      }),
                    )
                  }
                }
                const waiting = rows.filter((one) => one.state === 'waiting')
                for (const one of waiting) {
                  const before = taken.find((row) => row.id === one.id)
                  // Edited between the reading of its text and now: the Fix is asked again.
                  if (before?.version !== one.version) {
                    return yield* refuse(`${one.id} changed as Fix started: Fix again.`)
                  }
                  yield* transaction
                    .update(reviewFeedback)
                    .set({
                      state: 'in_round',
                      said: secrets.mask(sayings.get(one.id) ?? one.body),
                      updatedAt: at,
                    })
                    .where(eq(reviewFeedback.id, one.id))
                    .pipe(Effect.mapError(refusedWhile('taking a feedback into the round')))
                }
                yield* transaction
                  .update(reviewRounds)
                  .set({ state: 'grilling', movedAt: at })
                  .where(
                    and(
                      eq(reviewRounds.missionId, missionId),
                      eq(reviewRounds.number, round.number),
                    ),
                  )
                  .pipe(Effect.mapError(refusedWhile('grilling the round')))
                return {
                  result: undefined,
                  events: [
                    ...closing,
                    roundEvent(missionId, 'review.round_moved', {
                      round: round.number,
                      from: 'collecting',
                      to: 'grilling',
                    }),
                    {
                      type: 'review.fix_started',
                      entityKind: 'mission',
                      entityId: missionId,
                      source: 'ui',
                      author: 'human',
                      payload: {
                        round: round.number,
                        feedback: waiting.map((one) => one.id),
                      },
                    } satisfies NewEvent,
                  ],
                }
              }),
            ),
          )
          yield* settings.fixed ?? Effect.void
          yield* ensureGriller(missionId)
        })

      // --- the Planner's tools -------------------------------------------------------------------

      /** The round the grant's Planner grills, or the refusal it reads. */
      const grilledBy = (
        transaction: EngineTransaction,
        grant: Grant,
        asked: number | null,
      ): Effect.Effect<
        { readonly refused: string } | { readonly round: number; readonly missionId: string },
        DatabaseError
      > =>
        Effect.gen(function* () {
          if (grant.missionId === null) return { refused: 'this session works for no mission' }
          const round = yield* grillingRoundIn(transaction, grant.missionId)
          if (round === null) {
            return { refused: 'no round of the mission is being grilled: round mode is over.' }
          }
          if (asked !== null && asked !== round) {
            return {
              refused: `round ${String(asked)} is not the one being grilled: it is round ${String(round)}.`,
            }
          }
          return { round, missionId: grant.missionId }
        })

      /** Why a feedback may not be a point's source, or null. */
      const sourceRefusal = (
        transaction: EngineTransaction,
        missionId: string,
        round: number,
        sources: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          const rows = yield* roundFeedbackIn(transaction, missionId, round)
          for (const id of sources) {
            const row = rows.find((one) => one.id === id)
            if (row === undefined) {
              return `${id} is no feedback of round ${String(round)}: name a source as your brief gives it.`
            }
            if (row.kind === 'question') {
              return `${id} is a question: answer it with feedback_answer; it never becomes a point.`
            }
            if (row.state === 'withdrawn') return `${id} was withdrawn: it needs no point.`
            if (row.state !== 'in_round') {
              return `${id} is ${row.state.replace('_', ' ')}: it is no longer the round's to build.`
            }
          }
          return null
        })

      /** Why a behaviour point's delta is refused, or null (CT-57). */
      const deltaRefusal = (
        transaction: EngineTransaction,
        missionId: string,
        projectId: string,
        delta: NonNullable<ToolArguments<'round_point_write'>['delta']>,
      ) =>
        Effect.gen(function* () {
          const named = delta.requirement.trim()
          if (LIVING_ID.test(named)) {
            const living = yield* livingStandingIn(transaction, projectId, named)
            if (living === null || living.removed) {
              return `${named} is no requirement of the living spec: read it with living_spec_read.`
            }
            if (delta.change === 'added') {
              return `${named} exists in the living spec already: a delta on it is modified or removed.`
            }
            if (living.version !== delta.living_version) {
              return `${named} is at version ${String(living.version)} of the living spec, not ${String(delta.living_version)}: read it again with living_spec_read.`
            }
            return null
          }
          if (SPEC_ID.test(named)) {
            const [row] = yield* transaction
              .select({ id: specRequirements.id })
              .from(specRequirements)
              .where(
                and(
                  eq(specRequirements.missionId, missionId),
                  eq(specRequirements.id, named),
                  eq(specRequirements.removed, false),
                ),
              )
              .pipe(Effect.mapError(refusedWhile('reading the Spec')))
            if (row === undefined) return `${named} is no requirement of the frozen Spec.`
            if (delta.change === 'added') {
              return `${named} is a requirement of the frozen Spec already: a delta on it is modified or removed.`
            }
            return null
          }
          return delta.change === 'added'
            ? null
            : `${named} names no requirement: a delta that modifies or removes one names R… or LR….`
        })

      const pointWrite = (grant: Grant, args: ToolArguments<'round_point_write'>) =>
        Effect.gen(function* () {
          const shape = roundPointRefusal(args)
          if (shape !== null) return refusedSaid(shape)
          // Checked as they are kept: masked (#35), so what passes is what Building reads.
          const blocks = args.scenarios.map((one) => maskedJson(secrets.maskRecord(one.proof)))
          const problems = blocks.flatMap((block, at) =>
            Option.match(readProof(block), {
              onNone: () => [`scenario ${String(at + 1)}: its proof does not read once masked.`],
              onSome: (proof) =>
                proofRefusals(proof).map((one) => `scenario ${String(at + 1)}: ${one}`),
            }),
          )
          if (problems.length > 0) return refusedSaid(problems.join('\n'))
          return yield* settled(
            mutate('writing a point of the round', (transaction) =>
              Effect.gen(function* () {
                const standing = yield* grilledBy(transaction, grant, args.round)
                if ('refused' in standing) return refusedWith<string>(standing.refused)
                const { round, missionId } = standing
                const wrong = yield* sourceRefusal(transaction, missionId, round, args.sources)
                if (wrong !== null) return refusedWith<string>(wrong)
                const [mission] = yield* transaction
                  .select({ projectId: missions.projectId })
                  .from(missions)
                  .where(eq(missions.id, missionId))
                  .pipe(Effect.mapError(refusedWhile('reading the mission')))
                if (args.delta !== undefined) {
                  const off = yield* deltaRefusal(
                    transaction,
                    missionId,
                    mission?.projectId ?? '',
                    args.delta,
                  )
                  if (off !== null) return refusedWith<string>(off)
                }
                const points = yield* roundPointsIn(transaction, missionId, round)
                const kept =
                  args.id === undefined ? undefined : points.find((one) => one.id === args.id)
                if (args.id !== undefined && (kept === undefined || kept.removed)) {
                  return refusedWith<string>(
                    `${args.id} is no point of round ${String(round)}: leave the id out to write a new one; ids are never reused.`,
                  )
                }
                const number = kept?.number ?? Math.max(0, ...points.map((one) => one.number)) + 1
                const id = roundPointId(round, number)
                const before = yield* transaction
                  .select()
                  .from(roundScenarios)
                  .where(and(eq(roundScenarios.missionId, missionId), eq(roundScenarios.point, id)))
                  .pipe(Effect.mapError(refusedWhile('reading the scenarios')))
                for (const one of args.scenarios) {
                  if (one.id === undefined) continue
                  if (!before.some((row) => row.id === one.id && !row.removed)) {
                    return refusedWith<string>(
                      `${one.id} is no scenario of ${id}: leave its id out to write a new one.`,
                    )
                  }
                }
                const at = now()
                const fields = {
                  text: secrets.mask(args.text.trim()),
                  kind: args.kind,
                  deltaRequirement: args.delta?.requirement.trim() ?? null,
                  deltaChange: args.delta?.change ?? null,
                  deltaLivingVersion: args.delta?.living_version ?? null,
                  sources: writeRoundStrings(args.sources),
                  decisions: secrets.mask(writeRoundDecisions(args.decisions)),
                  removed: false,
                  removedReason: null,
                  sessionId: grant.sessionId,
                  writtenAt: at,
                }
                yield* transaction
                  .insert(roundPoints)
                  .values({ missionId, round, id, number, ...fields })
                  .onConflictDoUpdate({
                    target: [roundPoints.missionId, roundPoints.id],
                    set: fields,
                  })
                  .pipe(Effect.mapError(refusedWhile('writing a point')))
                let next = Math.max(0, ...before.map((one) => one.number)) + 1
                const written: string[] = []
                for (const [index, one] of args.scenarios.entries()) {
                  const known = before.find((row) => row.id === one.id)
                  const scenarioNumber = known?.number ?? next
                  if (known === undefined) next += 1
                  const scenario = roundScenarioId(id, scenarioNumber)
                  written.push(scenario)
                  const block = blocks[index]
                  if (block === undefined) continue
                  const values = {
                    rank: number * 1000 + index,
                    when: secrets.mask(one.when.trim()),
                    then: secrets.mask(one.then.trim()),
                    block,
                    removed: false,
                  }
                  yield* transaction
                    .insert(roundScenarios)
                    .values({
                      missionId,
                      round,
                      point: id,
                      id: scenario,
                      number: scenarioNumber,
                      ...values,
                    })
                    .onConflictDoUpdate({
                      target: [roundScenarios.missionId, roundScenarios.id],
                      set: values,
                    })
                    .pipe(Effect.mapError(refusedWhile('writing a scenario')))
                }
                const left = before.filter((one) => !written.includes(one.id)).map((one) => one.id)
                if (left.length > 0) {
                  yield* transaction
                    .update(roundScenarios)
                    .set({ removed: true })
                    .where(
                      and(
                        eq(roundScenarios.missionId, missionId),
                        inArray(roundScenarios.id, left),
                      ),
                    )
                    .pipe(Effect.mapError(refusedWhile('removing a scenario')))
                }
                // The point's decisions join the decisions since Freeze; a behaviour change is one.
                yield* transaction
                  .delete(roundDecisions)
                  .where(
                    and(
                      eq(roundDecisions.missionId, missionId),
                      eq(roundDecisions.point, id),
                      inArray(roundDecisions.kind, ['point', 'behaviour']),
                    ),
                  )
                  .pipe(Effect.mapError(refusedWhile('writing the decisions')))
                const decided = [
                  ...(args.delta === undefined
                    ? []
                    : [
                        {
                          kind: 'behaviour',
                          choice: fields.text,
                          alternatives: secrets.mask('[]'),
                          why: secrets.mask(
                            `A behaviour change from round ${String(round)}: ${args.delta.change} ${fields.deltaRequirement ?? ''}, written against living version ${String(args.delta.living_version)}.`,
                          ),
                        },
                      ]),
                  ...args.decisions.map((one) => ({
                    kind: 'point',
                    choice: secrets.mask(one.choice.trim()),
                    alternatives: secrets.mask(writeRoundStrings(one.alternatives)),
                    why: secrets.mask(one.why.trim()),
                  })),
                ]
                for (const one of decided) {
                  yield* transaction
                    .insert(roundDecisions)
                    .values({
                      id: crypto.randomUUID(),
                      missionId,
                      round,
                      point: id,
                      feedbackId: null,
                      at,
                      ...one,
                    })
                    .pipe(Effect.mapError(refusedWhile('writing a decision')))
                }
                const done: Outcome<string> = {
                  done: `${kept === undefined ? 'Written' : 'Rewritten'}: ${id} (${args.kind === 'behaviour' ? 'behaviour change' : 'corrective'}), its scenarios ${written.length === 0 ? 'none yet: give it one with its proof' : written.join(', ')}; its sources ${args.sources.join(', ')}.`,
                }
                return {
                  result: done,
                  events: [
                    roundEvent(missionId, 'review.point_written', {
                      round,
                      point: id,
                      kind: args.kind,
                      sources: [...args.sources],
                      text: fields.text,
                    }),
                  ],
                }
              }),
            ),
            (text) => text,
          )
        })

      const pointRemove = (grant: Grant, args: ToolArguments<'round_point_remove'>) =>
        settled(
          mutate('removing a point of the round', (transaction) =>
            Effect.gen(function* () {
              const standing = yield* grilledBy(transaction, grant, args.round)
              if ('refused' in standing) return refusedWith<string>(standing.refused)
              const { round, missionId } = standing
              const point = (yield* roundPointsIn(transaction, missionId, round)).find(
                (one) => one.id === args.id,
              )
              if (point === undefined || point.removed) {
                return refusedWith<string>(`${args.id} is no point of round ${String(round)}.`)
              }
              const reason = secrets.mask(args.reason.trim())
              yield* transaction
                .update(roundPoints)
                .set({ removed: true, removedReason: reason, writtenAt: now() })
                .where(and(eq(roundPoints.missionId, missionId), eq(roundPoints.id, point.id)))
                .pipe(Effect.mapError(refusedWhile('removing a point')))
              yield* transaction
                .update(roundScenarios)
                .set({ removed: true })
                .where(
                  and(eq(roundScenarios.missionId, missionId), eq(roundScenarios.point, point.id)),
                )
                .pipe(Effect.mapError(refusedWhile('removing a point')))
              yield* transaction
                .delete(roundDecisions)
                .where(
                  and(eq(roundDecisions.missionId, missionId), eq(roundDecisions.point, point.id)),
                )
                .pipe(Effect.mapError(refusedWhile('removing a point')))
              const done: Outcome<string> = {
                done: `Removed: ${point.id}. Its sources ${point.sources.join(', ')} need another outcome; its id is never reused.`,
              }
              return {
                result: done,
                events: [
                  roundEvent(missionId, 'review.point_removed', { round, point: point.id, reason }),
                ],
              }
            }),
          ),
          (text) => text,
        )

      /** The repositories of the mission's Workspace, by their path, with their worktree. */
      const worktreesOf = (missionId: string) =>
        database
          .select({ path: workspaceRepositories.path, worktree: workspaceRepositories.worktree })
          .from(buildingLaunches)
          .innerJoin(workspaces, eq(workspaces.id, buildingLaunches.workspaceId))
          .innerJoin(workspaceRepositories, eq(workspaceRepositories.workspaceId, workspaces.id))
          .where(
            and(eq(buildingLaunches.missionId, missionId), eq(buildingLaunches.state, 'launched')),
          )
          .pipe(Effect.mapError(refusedWhile('reading the Workspace')))

      /**
       * What is wrong with a round's task graph: references to nothing, cycles, and automated
       * scenarios no task covers; with the targets as their intent says in the Workspace when given.
       */
      const graphProblems = (
        round: number,
        tasks: ReadonlyArray<{
          readonly id: string
          readonly title: string
          readonly points: ReadonlyArray<string>
          readonly scenarios: ReadonlyArray<string>
          readonly dependsOn: ReadonlyArray<string>
        }>,
        points: ReadonlyArray<string>,
        scenarios: ReadonlyArray<{ readonly id: string; readonly automated: boolean }>,
      ) => {
        const problems = taskGraph(
          tasks.map((one) => ({
            id: one.id,
            title: one.title,
            requirements: one.points,
            scenarios: one.scenarios,
            dependsOn: one.dependsOn,
          })),
          {
            requirements: new Set(points),
            scenarios: new Set(scenarios.map((one) => one.id)),
          },
        ).map((problem) => {
          switch (problem.kind) {
            case 'unknown_requirement':
              return `${problem.task} builds ${problem.target}, which is no point of round ${String(round)}.`
            case 'unknown_scenario':
              return `${problem.task} covers ${problem.target}, which is no scenario of round ${String(round)}.`
            default:
              return graphProblemSaid(problem)
          }
        })
        for (const one of scenarios) {
          if (!one.automated) continue
          if (tasks.some((task) => task.scenarios.includes(one.id))) continue
          problems.push(`${one.id} is covered by no task: a testable scenario is built by a task.`)
        }
        return problems
      }

      const tasksWrite = (grant: Grant, args: ToolArguments<'round_tasks_write'>) =>
        Effect.gen(function* () {
          const repositories = grant.missionId === null ? [] : yield* worktreesOf(grant.missionId)
          return yield* settled(
            mutate('writing the round’s tasks', (transaction) =>
              Effect.gen(function* () {
                const standing = yield* grilledBy(transaction, grant, args.round)
                if ('refused' in standing) return refusedWith<string>(standing.refused)
                const { round, missionId } = standing
                const rows = yield* transaction
                  .select()
                  .from(roundTasks)
                  .where(and(eq(roundTasks.missionId, missionId), eq(roundTasks.round, round)))
                  .pipe(Effect.mapError(refusedWhile('reading the tasks')))
                const live = rows.filter((one) => !one.removed)
                const problems: string[] = []
                let next = Math.max(0, ...rows.map((one) => one.number)) + 1
                const resolved = args.tasks.map((asked) => {
                  const kept =
                    asked.id === undefined ? undefined : live.find((one) => one.id === asked.id)
                  if (asked.id !== undefined && kept === undefined) {
                    problems.push(
                      `${asked.id} is no task of round ${String(round)}: leave the id out for a new task; ids are never reused.`,
                    )
                  }
                  const number = kept?.number ?? next
                  if (kept === undefined) next += 1
                  return { id: roundTaskId(round, number), number, kept: kept !== undefined, asked }
                })
                const dependsOn = (task: (typeof resolved)[number]) =>
                  task.asked.depends_on.map(
                    (named) =>
                      resolved.find((one) => one.id === named)?.id ??
                      resolved.find((one) => !one.kept && one.asked.title === named)?.id ??
                      named,
                  )
                const points = (yield* roundPointsIn(transaction, missionId, round))
                  .filter((one) => !one.removed)
                  .map((one) => one.id)
                const scenarios = (yield* roundScenariosIn(transaction, missionId, round)).map(
                  (one) => ({ id: one.id, automated: one.proof?.mode === 'automated' }),
                )
                problems.push(
                  ...graphProblems(
                    round,
                    resolved.map((task) => ({
                      id: task.id,
                      title: task.asked.title,
                      points: task.asked.points,
                      scenarios: task.asked.scenarios,
                      dependsOn: dependsOn(task),
                    })),
                    points,
                    // Coverage is round_ready's: here, only what the tasks name must exist.
                    scenarios.map((one) => ({ id: one.id, automated: false })),
                  ),
                )
                for (const task of resolved) {
                  for (const target of task.asked.targets) {
                    const place = repositories.find((one) => one.path === target.repository)
                    if (place === undefined) {
                      problems.push(
                        `${task.id} targets ${target.repository}, which is outside the Workspace (it holds ${repositories.map((one) => one.path).join(', ')}): a change there is a mission of its own (round_propose_mission).`,
                      )
                      continue
                    }
                    const there = existsSync(join(place.worktree, target.path))
                    if (target.intent === 'create' && there) {
                      problems.push(
                        `${task.id} creates ${target.repository}/${target.path}, which is in the Workspace already: its intent is change.`,
                      )
                    }
                    if (target.intent === 'change' && !there) {
                      problems.push(
                        `${task.id} changes ${target.repository}/${target.path}, which is not in the Workspace: its intent is create.`,
                      )
                    }
                  }
                }
                if (problems.length > 0) {
                  return refusedWith<string>(
                    ['the round’s task graph is not written. Fix each of these:', ...problems].join(
                      '\n',
                    ),
                  )
                }
                const written = resolved.map((one) => one.id)
                const gone = live.filter((one) => !written.includes(one.id)).map((one) => one.id)
                if (gone.length > 0) {
                  yield* transaction
                    .update(roundTasks)
                    .set({ removed: true })
                    .where(and(eq(roundTasks.missionId, missionId), inArray(roundTasks.id, gone)))
                    .pipe(Effect.mapError(refusedWhile('removing a task')))
                }
                for (const [rank, task] of resolved.entries()) {
                  const values = {
                    rank,
                    title: secrets.mask(task.asked.title.trim()),
                    result: secrets.mask(task.asked.result.trim()),
                    points: writeRoundStrings(task.asked.points),
                    scenarios: writeRoundStrings(task.asked.scenarios),
                    targets: secrets.mask(writeRoundTargets(task.asked.targets)),
                    dependsOn: writeRoundStrings(dependsOn(task)),
                    removed: false,
                  }
                  yield* transaction
                    .insert(roundTasks)
                    .values({ missionId, round, id: task.id, number: task.number, ...values })
                    .onConflictDoUpdate({
                      target: [roundTasks.missionId, roundTasks.id],
                      set: values,
                    })
                    .pipe(Effect.mapError(refusedWhile('writing a task')))
                }
                const done: Outcome<string> = {
                  done: `Written: the task graph of round ${String(round)}, ${written.length === 0 ? 'no task' : written.join(', ')}${gone.length === 0 ? '' : `; removed ${gone.join(', ')}`}.`,
                }
                return {
                  result: done,
                  events: [
                    roundEvent(missionId, 'review.tasks_written', { round, tasks: written }),
                  ],
                }
              }),
            ),
            (text) => text,
          )
        })

      const proposeMission = (grant: Grant, args: ToolArguments<'round_propose_mission'>) =>
        Effect.gen(function* () {
          if (grant.missionId === null) return refusedSaid('this session works for no mission')
          const [row] = yield* database
            .select()
            .from(reviewFeedback)
            .where(
              and(
                eq(reviewFeedback.missionId, grant.missionId),
                eq(reviewFeedback.id, args.feedback.trim()),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading a feedback')))
          if (row === undefined)
            return refusedSaid(`${args.feedback} is no feedback of this mission.`)
          const asked = yield* roundQuestionsIn(database, grant.missionId, row.round)
          if (asked.some((one) => one.kind === 'new_mission' && one.feedbackId === row.id)) {
            return refusedSaid(`${row.id} is put to the user already: wait for the answer.`)
          }
          const writer = {
            sessionId: grant.sessionId,
            role: grant.role,
            missionId: grant.missionId,
          }
          const outcome = yield* askWave(writer, [
            {
              text: `“${row.body}”: start a mission from this, or keep it in this round as a behaviour change?`,
              why: args.reason,
              options: NEW_MISSION_OPTIONS.map((label) => ({
                label,
                detail: NEW_MISSION_DETAILS[label],
              })),
              recommended: 0,
              recommendedReason: args.reason,
              about: { kind: 'new_mission', feedbackId: row.id },
            },
          ])
          if ('refused' in outcome) return refusedSaid(outcome.refused)
          return answered(
            `Asked as ${outcome.done.ids.join(', ')}: ${START_A_MISSION}, or ${KEEP_IN_ROUND}. The answer arrives as [hemera:answers]; until then ${row.id} has no outcome.`,
          )
        }).pipe(
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
        )

      /** Why the round is not ready to build, every reason named; empty when it is. */
      const readyProblems = (transaction: EngineTransaction, missionId: string, round: number) =>
        Effect.gen(function* () {
          const problems: string[] = []
          const feedback = yield* roundFeedbackIn(transaction, missionId, round)
          const points = (yield* roundPointsIn(transaction, missionId, round)).filter(
            (one) => !one.removed,
          )
          const scenarios = yield* roundScenariosIn(transaction, missionId, round)
          const asked = yield* roundQuestionsIn(transaction, missionId, round)
          const sources = new Set(points.flatMap((one) => one.sources))
          for (const one of feedback) {
            if (one.state === 'withdrawn' || one.state === 'resolved') continue
            if (one.kind === 'question' && one.state === 'addressed') continue
            if (one.state === 'addressed' || sources.has(one.id)) continue
            problems.push(
              one.kind === 'question'
                ? `${one.id} has no outcome: answer the question with feedback_answer.`
                : `${one.id} has no outcome: make it a point, or put it to the user.`,
            )
          }
          for (const one of asked) {
            if (one.state === 'open' || one.state === 'waiting') {
              problems.push(`${one.id} is open: the round waits for its answer.`)
            }
          }
          const inputs =
            asked.length === 0
              ? []
              : yield* transaction
                  .select({ id: planningInputs.id, state: planningInputs.state })
                  .from(planningInputs)
                  .where(
                    and(
                      eq(planningInputs.missionId, missionId),
                      inArray(
                        planningInputs.item,
                        asked.map((one) => one.id),
                      ),
                      inArray(planningInputs.state, ['received', 'delivered']),
                    ),
                  )
                  .orderBy(asc(planningInputs.number))
                  .pipe(Effect.mapError(refusedWhile('reading the inputs')))
          for (const one of inputs) {
            problems.push(
              one.state === 'received'
                ? `${one.id} is not integrated: it reaches you with your next delivery.`
                : `${one.id} is not integrated: integrate it, then call input_integrated.`,
            )
          }
          const withdrawn = new Set(
            feedback.filter((one) => one.state === 'withdrawn').map((one) => one.id),
          )
          // A remark leaves the round only withdrawn or moved to a mission of its own: "Start a
          // mission from this" answered, then the mission created.
          const gone = new Set(
            feedback.filter((one) => one.state !== 'in_round').map((one) => one.id),
          )
          for (const point of points) {
            if (!scenarios.some((one) => one.point === point.id && one.proof !== null)) {
              problems.push(`${point.id} has no scenario with its proof.`)
            }
            if (point.sources.every((one) => withdrawn.has(one))) {
              problems.push(`${point.id} comes only from withdrawn feedback: remove it.`)
            } else if (point.sources.every((one) => gone.has(one))) {
              const how = point.sources.some((one) => withdrawn.has(one))
                ? 'withdrawn or moved to a mission of its own'
                : 'moved to a mission of its own'
              problems.push(`${point.id} comes only from feedback ${how}: remove it.`)
            }
          }
          const tasks = yield* roundTasksIn(transaction, missionId, round)
          problems.push(
            ...graphProblems(
              round,
              tasks,
              points.map((one) => one.id),
              scenarios.map((one) => ({ id: one.id, automated: one.proof?.mode === 'automated' })),
            ),
          )
          return { problems, points }
        })

      const ready = (grant: Grant, args: ToolArguments<'round_ready'>) =>
        Effect.gen(function* () {
          const outcome = yield* mutate('ending the grilling', (transaction) =>
            Effect.gen(function* () {
              const standing = yield* grilledBy(transaction, grant, null)
              if ('refused' in standing) return refusedWith<string>(standing.refused)
              const { round, missionId } = standing
              const { problems, points } = yield* readyProblems(transaction, missionId, round)
              if (problems.length > 0) {
                return refusedWith<string>(
                  [
                    `round ${String(round)} is not ready to build. Fix each of these:`,
                    ...problems,
                  ].join('\n'),
                )
              }
              const why = secrets.mask(args.why.trim())
              const at = now()
              const [mission] = yield* transaction
                .select()
                .from(missions)
                .where(eq(missions.id, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the mission')))
              if (mission === undefined) return refusedWith<string>('the mission is gone.')
              const readyEvent = roundEvent(missionId, 'review.round_ready', {
                round,
                why,
                points: points.map((one) => one.id),
              })
              const moving = (to: 'building' | 'answered') =>
                transaction
                  .update(reviewRounds)
                  .set({ state: to, movedAt: at, readyWhy: why })
                  .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.number, round)))
                  .pipe(Effect.mapError(refusedWhile('moving the round')))
              if (points.length === 0) {
                // Nothing to build: the round is answered now, and the mission stays in Review.
                yield* moving('answered')
                yield* transaction
                  .update(missions)
                  .set({ round, updatedAt: at })
                  .where(eq(missions.id, missionId))
                  .pipe(Effect.mapError(refusedWhile('numbering the round')))
                const done: Outcome<string> = {
                  done: `Round ${String(round)} has no point to build: it is answered, and the mission stays in Review. End your turn now.`,
                }
                return {
                  result: done,
                  events: [
                    readyEvent,
                    roundEvent(missionId, 'review.round_moved', {
                      round,
                      from: 'grilling',
                      to: 'answered',
                    }),
                    roundEvent(missionId, 'review.round_answered', { round }),
                  ],
                }
              }
              if (mission.round + 1 !== round) {
                return refusedWith<string>(
                  `the mission is at round ${String(mission.round)}: round ${String(round)} cannot build after it.`,
                )
              }
              yield* moving('building')
              // The user's Fix, made now that its round is ready: "Building · round N".
              const moved = yield* moveIn(
                transaction,
                { id: missionId, stage: 'review', round: mission.round },
                'fix',
                'user',
              )
              const done: Outcome<string> = {
                done: `Round ${String(round)} is ready: the mission goes to “${roundLabel(round)}”, where a Builder builds it. End your turn now.`,
              }
              return {
                result: done,
                events: [
                  readyEvent,
                  roundEvent(missionId, 'review.round_moved', {
                    round,
                    from: 'grilling',
                    to: 'building',
                  }),
                  moved,
                  roundEvent(missionId, 'review.round_building', {
                    round,
                    label: roundLabel(round),
                  }),
                ],
              }
            }),
          ).pipe(provided)
          return 'refused' in outcome ? refusedSaid(outcome.refused) : answered(outcome.done)
        }).pipe(
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
        )

      const answer = (grant: Grant, args: ToolArguments<'feedback_answer'>) =>
        Effect.gen(function* () {
          if (grant.missionId === null) return refusedSaid('this session works for no mission')
          const id = args.source.trim()
          const [row] = yield* database
            .select()
            .from(reviewFeedback)
            .where(and(eq(reviewFeedback.missionId, grant.missionId), eq(reviewFeedback.id, id)))
            .pipe(Effect.mapError(refusedWhile('reading a feedback')))
          if (row === undefined) return refusedSaid(`${id} is no feedback of this mission.`)
          if (grant.role === 'round-planner') {
            const round = yield* grillingRoundIn(database, grant.missionId)
            if (round === null || row.round !== round) {
              return refusedSaid(`${id} is no feedback of the round being grilled.`)
            }
            if (row.kind !== 'question') {
              return refusedSaid(
                `${id} is a ${row.kind}: you answer only a question; the round's Builder answers the rest.`,
              )
            }
          } else {
            const [building] = yield* database
              .select({ round: buildings.round })
              .from(buildings)
              .where(and(eq(buildings.missionId, grant.missionId), eq(buildings.state, 'active')))
              .pipe(Effect.mapError(refusedWhile('reading the Building')))
            if (building?.round == null || building.round !== row.round) {
              return refusedSaid(`${id} is no feedback of the round this Building builds.`)
            }
            const points = (yield* roundPointsIn(database, grant.missionId, building.round)).filter(
              (one) => !one.removed,
            )
            if (!points.some((one) => one.sources.includes(id))) {
              return refusedSaid(`${id} is the source of no point of round ${String(row.round)}.`)
            }
          }
          return yield* review.answer(id, args.text).pipe(
            Effect.as(
              answered(
                `${id} is addressed with your answer. Only the user resolves it, or follows it up in a later round.`,
              ),
            ),
            Effect.catchTag('FeedbackRefused', (refused) =>
              Effect.succeed(refusedSaid(refused.reason)),
            ),
          )
        }).pipe(
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))),
        )

      yield* RoundDesk.use((desk) =>
        desk.serve({
          pointWrite: (grant, args) => provided(pointWrite(grant, args)),
          pointRemove: (grant, args) => provided(pointRemove(grant, args)),
          tasksWrite: (grant, args) =>
            provided(tasksWrite(grant, args)).pipe(
              Effect.catch((failed) =>
                Effect.succeed(failure(`the call failed: ${failed.message}`)),
              ),
            ),
          proposeMission: (grant, args) => provided(proposeMission(grant, args)),
          ready: (grant, args) => provided(ready(grant, args)),
          answer: (grant, args) => provided(answer(grant, args)),
        }),
      )

      // --- reading a round ---------------------------------------------------------------------

      const round = (missionId: string, number: number) =>
        Effect.gen(function* () {
          yield* missionOf(missionId)
          const row = yield* roundRowIn(database, missionId, number)
          if (row === null) return yield* refuse(`There is no round ${String(number)}.`)
          const points = yield* roundPointsIn(database, missionId, number)
          const scenarios = yield* roundScenariosIn(database, missionId, number)
          const tasks = yield* roundTasksIn(database, missionId, number)
          const decisions = (yield* roundDecisionsIn(database, missionId)).filter(
            (one) => one.round === number,
          )
          const [building] = yield* database
            .select({ id: buildings.id })
            .from(buildings)
            .where(and(eq(buildings.missionId, missionId), eq(buildings.round, number)))
            .pipe(Effect.mapError(refusedWhile('reading the Building')))
          const proofs =
            building === undefined
              ? []
              : yield* database
                  .select({ scenario: scenarioProofs.scenario, state: scenarioProofs.state })
                  .from(scenarioProofs)
                  .where(eq(scenarioProofs.buildingId, building.id))
                  .pipe(Effect.mapError(refusedWhile('reading the proofs')))
          const built =
            building === undefined
              ? []
              : yield* database
                  .select({ id: buildingTasks.id, state: buildingTasks.state })
                  .from(buildingTasks)
                  .where(eq(buildingTasks.buildingId, building.id))
                  .pipe(Effect.mapError(refusedWhile('reading the tasks')))
          const decisionView = (one: (typeof decisions)[number]) => ({
            kind: one.kind,
            point: one.point,
            feedbackId: one.feedbackId,
            choice: one.choice,
            alternatives: one.alternatives,
            why: one.why,
          })
          const view: RoundDetailView = {
            missionId,
            number,
            state: roundStateOf(row.state),
            readyWhy: row.readyWhy,
            points: points.map((point): RoundPointView => ({
              id: point.id,
              text: point.text,
              kind: point.kind,
              delta: point.delta,
              sources: point.sources,
              scenarios: scenarios
                .filter((one) => one.point === point.id)
                .map((one) => ({
                  id: one.id,
                  when: one.when,
                  then: one.then,
                  mode: one.proof?.mode ?? 'by_hand',
                  proof: proofs.find((proof) => proof.scenario === one.id)?.state ?? null,
                })),
              decisions: decisions.filter((one) => one.point === point.id).map(decisionView),
              removed: point.removed,
              removedReason: point.removedReason,
            })),
            tasks: tasks.map((task) => ({
              id: task.id,
              title: task.title,
              result: task.result,
              points: task.points,
              scenarios: task.scenarios,
              state: built.find((one) => one.id === task.id)?.state ?? null,
            })),
            decisions: decisions.map(decisionView),
            questions: (yield* roundQuestionsIn(database, missionId, number)).map((one) => one.id),
            progress: {
              done: built.filter((one) => one.state === 'done' || one.state === 'skipped').length,
              tasks: built.length === 0 ? tasks.length : built.length,
            },
          }
          return view
        })

      // --- a mission of its own ----------------------------------------------------------------

      const startMissionFrom = (feedbackId: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select()
            .from(reviewFeedback)
            .where(eq(reviewFeedback.id, feedbackId))
            .pipe(Effect.mapError(refusedWhile('reading a feedback')))
          if (row === undefined) return yield* new UnknownFeedback({ id: feedbackId })
          if (row.state === 'withdrawn') {
            return yield* refuse('This feedback is withdrawn: no mission starts from it.')
          }
          if (row.movedTo !== null) {
            return yield* refuse('A mission was started from this feedback already.')
          }
          const mission = yield* missionOf(row.missionId).pipe(Effect.orDie)
          const view: MissionFromSource = {
            feedbackId: row.id,
            text: row.body,
            origin: row.missionId,
            originSaid: startedFromSaid(keyOf(mission), row.round),
          }
          return view
        })

      /**
       * A feedback a mission was started from, linked to it as soon as the mission exists, so a
       * second start is refused whatever the feedback is by then. One its round still grills or
       * builds stays the round's until the round is answered; a withdrawn one stays withdrawn and
       * says where it went; any other closes as moved, with the link.
       */
      const movedIn = (missionId: string, feedbackId: string) =>
        provided(
          mutate('closing a feedback moved to a mission', (transaction) =>
            Effect.gen(function* () {
              const [created] = yield* transaction
                .select()
                .from(missions)
                .where(eq(missions.id, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the mission')))
              const [row] = yield* transaction
                .select()
                .from(reviewFeedback)
                .where(eq(reviewFeedback.id, feedbackId))
                .pipe(Effect.mapError(refusedWhile('reading a feedback')))
              if (
                created === undefined ||
                row === undefined ||
                row.missionId !== created.originId ||
                (row.movedTo !== null && row.movedTo !== missionId)
              ) {
                return { result: undefined, events: [] }
              }
              const moved = secrets.mask(`Moved to a new mission: ${keyOf(created)}.`)
              const closes =
                row.state !== 'in_round' &&
                row.state !== 'withdrawn' &&
                !(row.state === 'resolved' && row.answer === moved)
              const says = row.state === 'withdrawn' && row.answer !== moved
              if (row.movedTo !== null && !closes && !says) {
                return { result: undefined, events: [] }
              }
              yield* transaction
                .update(reviewFeedback)
                .set({
                  state: closes ? 'resolved' : row.state,
                  movedTo: missionId,
                  answer: closes || says ? moved : row.answer,
                  updatedAt: now(),
                })
                .where(eq(reviewFeedback.id, feedbackId))
                .pipe(Effect.mapError(refusedWhile('closing a feedback')))
              return {
                result: undefined,
                events: [
                  roundEvent(row.missionId, 'review.feedback_moved', {
                    ...feedbackEventPayload(row),
                    to: missionId,
                    toKey: keyOf(created),
                  }),
                ],
              }
            }),
          ),
        )

      /** Each feedback of `origin` a mission was started from and not closed yet, closed now. */
      const movedLeft = (origin: string | null) =>
        Effect.gen(function* () {
          const created = yield* database
            .select()
            .from(domainEvents)
            .where(eq(domainEvents.type, 'mission.created'))
            .orderBy(asc(domainEvents.sequence))
            .pipe(Effect.mapError(refusedWhile('reading the missions created')))
          for (const one of created.map(eventOf)) {
            if (origin !== null && one.payload['origin'] !== origin) continue
            const feedbackId = Option.getOrNull(readString(one.payload['originFeedback']))
            if (feedbackId !== null) yield* movedIn(one.entityId, feedbackId)
          }
        })

      // --- following what happens --------------------------------------------------------------

      const handle = (event: DomainEvent) =>
        Effect.gen(function* () {
          if (event.type === 'mission.created') {
            const feedbackId = Option.getOrNull(readString(event.payload['originFeedback']))
            if (feedbackId !== null) yield* movedIn(event.entityId, feedbackId)
            return
          }
          // The round's Planner stopped while its round is grilled: brought back, unless a need
          // about its session waits on the user, whose Retry starts it.
          if (event.type === 'session.stopped' && event.payload['role'] === 'round-planner') {
            const missionId = Option.getOrNull(readString(event.payload['missionId']))
            if (missionId === null || (yield* grillingRoundIn(database, missionId)) === null) return
            if (yield* plannerWaits(missionId)) return
            return yield* ensureGriller(missionId)
          }
          // The user's Retry of the need that the round's Workspace is missing.
          if (event.type === 'need.withdrawn' && event.payload['service'] === ROUND_NEEDS) {
            const missionId = Option.getOrNull(readString(event.payload['missionId']))
            if (missionId !== null) yield* grilledCaughtUp(missionId)
            return
          }
          if (event.type === 'review.round_building') {
            return yield* endGriller(event.entityId, 'the round’s grilling is over')
          }
          if (event.type === 'review.round_answered') {
            yield* endGriller(event.entityId, 'the round’s grilling is over')
            // A feedback a mission was started from while its round ran closes now.
            return yield* movedLeft(event.entityId)
          }
          if (event.type === 'review.feedback_withdrawn') {
            const grilled = yield* grillingRoundIn(database, event.entityId)
            if (grilled === null || event.payload['round'] !== grilled) return
            const id = String(event.payload['feedbackId'] ?? '')
            yield* sessions
              .deliver({
                owner: { kind: 'mission', missionId: event.entityId },
                target: { role: 'round-planner' },
                kind: 'withdrawn',
                body: `The user withdrew ${id}: it needs no outcome. Remove a point that comes from it alone.`,
              })
              .pipe(Effect.asVoid)
          }
        })

      /**
       * A round grilled with its Planner, and what its Planner was given and never handed over
       * (CT-26): at a start, and at the Retry of its Workspace's need.
       */
      const grilledCaughtUp = (missionId: string) =>
        Effect.gen(function* () {
          yield* ensureGriller(missionId)
          // The need holds the Planner like every other caller: its Retry comes back here.
          if (yield* workspaceWaits(missionId)) return
          const prepared = yield* provided(prepareDeliveries(missionId))
          const left = (yield* provided(queuedForPlanner(missionId))).filter(
            (queued) => !prepared.some((ready_) => ready_.id === queued.id),
          )
          const folder = yield* workspaceThere(missionId)
          if (folder === null) return
          for (const delivery of [...left, ...prepared]) {
            yield* sessions
              .deliverOrStart(
                {
                  id: delivery.id,
                  owner: { kind: 'mission', missionId },
                  target: { role: 'round-planner' },
                  kind: delivery.kind,
                  body: delivery.body,
                },
                { owner: { kind: 'mission', missionId }, role: 'round-planner', folder },
              )
              .pipe(
                Effect.catchCause((cause) =>
                  said(`a delivery was not handed over: ${String(cause)}`),
                ),
              )
          }
        })

      /** What a stop left: a round grilled without its Planner, a Planner past its grilling. */
      const catchUp = Effect.gen(function* () {
        const grilled = yield* database
          .select({ missionId: reviewRounds.missionId })
          .from(reviewRounds)
          .innerJoin(missions, eq(missions.id, reviewRounds.missionId))
          .where(and(eq(reviewRounds.state, 'grilling'), eq(missions.stage, 'review')))
          .pipe(Effect.mapError(refusedWhile('reading the rounds')))
        for (const one of grilled) yield* grilledCaughtUp(one.missionId)
        // A Planner in round mode alive past its round's grilling ends.
        const living = yield* sessionsIn([...LIVE])
        for (const one of living) {
          if (one.role !== 'round-planner' || one.owner.kind !== 'mission') continue
          if ((yield* grillingRoundIn(database, one.owner.missionId)) !== null) continue
          yield* sessions.end(one.lineage, 'the round’s grilling is over')
        }
        // A mission started from a feedback a stop kept from closing.
        yield* movedLeft(null)
      })

      const subscribed = yield* events.subscribe
      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(Memory.use((memory) => memory.ready)),
        Effect.andThen(
          catchUp.pipe(
            Effect.catchCause((cause) =>
              said(`what a stop left was not caught up: ${String(cause)}`),
            ),
          ),
        ),
        Effect.andThen(
          Stream.runForEach(subscribed, (event) =>
            handle(event).pipe(
              Effect.catchCause((cause) =>
                said(`${event.type} was not followed: ${String(cause)}`),
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      )

      return {
        fix: (missionId: string) => provided(fix(missionId)),
        round: (missionId: string, number: number) => provided(round(missionId, number)),
        startMissionFrom: (feedbackId: string) => provided(startMissionFrom(feedbackId)),
      }
    }),
  )

/** What of a feedback row says whether it waits for a Fix. */
const standingOf = (row: typeof reviewFeedback.$inferSelect): FeedbackStanding => ({
  kind: FEEDBACK_KINDS.find((one) => one === row.kind) ?? 'remark',
  state: FEEDBACK_STATES.find((one) => one === row.state) ?? 'waiting',
})

const roundStateOf = (state: string) => ROUND_STATES.find((one) => one === state) ?? 'collecting'

/** What of a round row says whether it holds a Fix back. */
const standingOfRound = (row: typeof reviewRounds.$inferSelect) => ({
  number: row.number,
  state: roundStateOf(row.state),
})
