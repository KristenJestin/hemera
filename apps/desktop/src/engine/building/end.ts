/**
 * The end of a Building (#147): `BuildingEnd`, called once every task of the effective plan is
 * done or skipped, runs one sequence, each step kept on `buildings.phase` so a restarted engine
 * resumes at the step it was in:
 *
 * 1. `documenter`: the documenter's full pass (#146).
 * 2. `final_checks`: the checks of the end; a red is the Builder's to fix, judged again once its
 *    turn ends.
 * 3. `checkpoint`: a review checkpoint of every repository (#140), copied into a folder the
 *    reviewers read.
 * 4. `review`: both reviewers, one pass each. Their findings are then sorted: one that contradicts
 *    the Spec becomes a decision need, never told to the Builder before the answer; every other
 *    one a special task (`RV1`…, CT-41) handed to the Builder like any task.
 * 5. `special_tasks`: until each is done or skipped and every contradiction answered.
 * 6. `documenter_delta`: a delta pass on what the special tasks changed outside the doc recipes.
 * 7. `refresh`: the stale proofs and final checks run again (#144); the end waits while one is red.
 * 8. The exit, once no need of the mission waits: what changed after the checkpoint is kept, the
 *    Builder's session ends, and the mission moves to Review on its own (`endBuilding`).
 *
 * The port returns at once: the sequence runs in a fiber of its own, driven again by every event
 * of the mission and every end of the Builder's turns, so it never waits on the turn that called it
 * (the last green's, which holds the proofs' turn).
 */

import { existsSync, renameSync, rmSync } from 'node:fs'

import {
  CONTRADICTION_OPTIONS,
  DOCUMENTATION,
  DecisionFields,
  ErrorFields,
  MissionOwner,
  REVIEWERS,
  REVIEWER_NAMES,
  RESULT_IS_RIGHT,
  ROOT_REPOSITORY,
  SESSION_STATES,
  SPEC_IS_RIGHT,
  specialTaskId,
  specialTaskOf,
} from '@hemera/core/domain'
import type { Need } from '@hemera/ipc'
import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { Cause, Effect, Layer, Option, Predicate, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { Memory } from '../memory/index.ts'
import { getMission, moveIn as moveMissionIn } from '../missions.ts'
import { DeliveryFailed, type NeedHandler, createNeedIn, needService } from '../needs.ts'
import { ProfileHome } from '../profile-home.ts'
import { type Runs, stopAgentRuns } from '../runs.ts'
import { Secrets } from '../secrets.ts'
import { supersedeAll } from '../sessions/deliveries.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsIn } from '../sessions/store.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  agentSessions,
  attemptWrites,
  buildingAttempts,
  buildingCheckRuns,
  buildingDecisions,
  buildingTasks,
  buildings,
  checkpointRepositories,
  checkpoints,
  missions,
  needs,
  reviewChangedAfter,
  reviewFindings,
} from '../storage/schema.ts'
import { ToolAccess } from '../tools/access.ts'
import { mutate } from '../transaction.ts'
import { BuildingEnd } from './builder.ts'
import { checkResultsIn } from './attempts.ts'
import { Checkpoints } from './checkpoints.ts'
import { BuildDesk } from './desk.ts'
import { Documenter, type DocumenterMode, stoppedByHemera } from './documenter.ts'
import { type PassRow, filesOfPass, passesIn } from './documenter-store.ts'
import { STOPPED_AT_THE_END } from './helper-store.ts'
import { currentTreesIn, finalChecksIn, scenarioProofsIn, modeOf, stateOf } from './proof-store.ts'
import { AutoReview, repositoryFolderOf, reviewFolderOf } from './review.ts'
import {
  REVIEW_NEEDS,
  type ReviewFindingRow,
  lastPassesOf,
  reviewFindingsIn,
  reviewPassesIn,
  reviewerOf,
} from './review-store.ts'
import { Snapshots } from './snapshots.ts'
import {
  type BuildingBase,
  type BuildingRow,
  activeBuildingIn,
  attemptsIn,
  bases,
  buildingEvent,
  now,
  settleIn,
  tasksIn,
  writeStrings,
} from './tasks.ts'

/**
 * The service of the error needs the end raises when one of its steps cannot go on (a pass that
 * failed, a step that threw): their Retry drives the end again, and the step tries again.
 */
export const END_NEEDS = needService('building-end')

/** The one answer an error need of the end offers. */
export const RETRY = 'Retry'

/** The steps of the end, in their order, as `buildings.phase` keeps them. */
export const END_PHASES = [
  'documenter',
  'final_checks',
  'checkpoint',
  'review',
  'special_tasks',
  'documenter_delta',
  'refresh',
] as const
type EndPhase = (typeof END_PHASES)[number]

const endPhaseOf = (phase: string): EndPhase | null =>
  END_PHASES.find((one) => one === phase) ?? null

/** The automated proofs the end accepts: green, or settled otherwise by the user or Hemera. */
const PROVEN = ['green', 'not_reproducible', 'not_proven'] as const

/** The states of a session that still runs. */
const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | SessionPost
  | Documenter
  | AutoReview
  | Checkpoints
  | Snapshots
  | BuildDesk
  | ProfileHome
  | AutomationGate
  | Memory
  | Runs
  | ToolAccess
  | Effect.Services<ReturnType<typeof getMission>>

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

const placeOf = (base: BuildingBase) => ({ name: base.repository, folder: base.folder })

const answerOf = (need: Need): string | null => {
  const answer = need.answer
  if (answer === null) return null
  if (Predicate.isTagged(answer, 'Chosen')) return answer.option
  if (Predicate.isTagged(answer, 'Written')) return answer.text
  return null
}

/** The question a contradicting finding asks the user. */
const questionOf = (finding: ReviewFindingRow): string =>
  [
    `The ${REVIEWER_NAMES[reviewerOf(finding)]} found a result that differs from the Spec, and fixing it would change what the Spec says: ${finding.text}`,
    finding.repository === null && finding.path === null
      ? null
      : `Where: ${[finding.repository, finding.path].filter((one) => one !== null && one !== ROOT_REPOSITORY).join('/')}${finding.line === null ? '' : `:${String(finding.line)}`}`,
    finding.evidence === null ? null : `Evidence: ${finding.evidence}`,
  ]
    .filter((one) => one !== null)
    .join('\n')

/** A special task born from a finding, added available when nothing holds it. */
const specialTaskIn = (
  transaction: EngineTransaction,
  building: BuildingRow,
  finding: ReviewFindingRow,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const tasks = yield* tasksIn(transaction, building.id)
    const number = tasks.filter((one) => one.origin === 'review').length + 1
    const id = specialTaskId(number)
    const rank = Math.max(0, ...tasks.map((one) => one.rank)) + 1
    const written = specialTaskOf(finding)
    const repository =
      finding.repository ??
      (finding.path === null ? null : (basesOf(building)[0]?.repository ?? null))
    const targets =
      repository === null || finding.path === null
        ? []
        : [{ repository, path: finding.path, intent: 'change' }]
    yield* transaction
      .insert(buildingTasks)
      .values({
        buildingId: building.id,
        id,
        rank,
        origin: 'review',
        decisionId: null,
        title: secrets.mask(written.title),
        result: secrets.mask(written.result),
        requirements: '[]',
        scenarios: '[]',
        targets: secrets.mask(JSON.stringify(targets)),
        dependsOn: '[]',
        state: 'waiting',
        replacedBy: '[]',
        changes: JSON.stringify([{ state: 'waiting', at: now() }]),
      })
      .pipe(Effect.mapError(refusedWhile('adding a special task')))
    yield* transaction
      .update(reviewFindings)
      .set({ fate: 'special_task', taskId: id })
      .where(eq(reviewFindings.id, finding.id))
      .pipe(Effect.mapError(refusedWhile('keeping a finding’s fate')))
    return {
      id,
      event: buildingEvent(building.missionId, 'review.special_task', {
        task: id,
        finding: finding.number,
        reviewer: finding.reviewer,
        title: written.title,
      }),
    }
  })

export const buildingEndLayer = (log: Log) => {
  let apply: NeedHandler['deliver'] | null = null
  const handler: NeedHandler = {
    deliver: (need, transaction) =>
      apply === null
        ? Effect.fail(new DeliveryFailed({ reason: 'the end of the Building is not running yet' }))
        : apply(need, transaction),
  }
  const layer = Layer.effect(
    BuildingEnd,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const post = yield* SessionPost
      const { dataFolder } = yield* ProfileHome
      const said = (line: string) => Effect.sync(() => log(`end of a Building: ${line}`))
      /** The Buildings whose driver runs, and whether it is asked to run again. */
      const running = new Map<string, boolean>()
      /** The Buildings whose documenter's pass this engine started and still waits on. */
      const documenting = new Set<string>()
      /** The Buildings whose proofs this engine refreshed, with the trees it refreshed them on. */
      const refreshed = new Map<string, string>()

      const buildingRow = (buildingId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(buildings)
            .where(eq(buildings.id, buildingId))
            .pipe(Effect.mapError(refusedWhile('reading the Building')))
          return row ?? null
        })

      /** The last error need the end raised for a mission, or null. */
      const endNeedOf = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select({ id: needs.id, state: needs.state, createdAt: needs.createdAt })
            .from(needs)
            .where(and(eq(needs.missionId, missionId), eq(needs.service, END_NEEDS)))
            .orderBy(desc(needs.createdAt))
            .limit(1)
            .pipe(Effect.mapError(refusedWhile('reading the end’s needs')))
          return row ?? null
        })

      /** Whether the user answered Retry to the need raised for a failure ended at `failedAt`. */
      const retried = (missionId: string, failedAt: string) =>
        Effect.map(
          endNeedOf(missionId),
          (need) => need !== null && need.state === 'answered' && need.createdAt >= failedAt,
        )

      /** The owner of the mission's needs. */
      const ownerOf = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [mission] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, building.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          return MissionOwner.make({
            projectId: mission?.projectId ?? '',
            missionId: building.missionId,
            taskId: null,
          })
        })

      /** The end cannot go on: an error need on the mission, which it waits on until Retry. */
      const raise = (building: BuildingRow, failed: string) =>
        Effect.gen(function* () {
          const write = yield* createNeedIn(
            END_NEEDS,
            yield* ownerOf(building),
            ErrorFields.make({ failed, attempts: [], proposals: [RETRY] }),
          )
          yield* mutate('asking the user to retry the end', (transaction) =>
            Effect.gen(function* () {
              const current = yield* activeBuildingIn(transaction, building.missionId)
              if (current?.id !== building.id) return { result: undefined, events: [] }
              const made = yield* write(transaction)
              return { result: undefined, events: made.events }
            }),
          )
          yield* said(failed)
        })

      /** The phase moves on, if the Building is still at the step it left; with its events. */
      const moveOn = (
        building: BuildingRow,
        to: string,
        events: ReadonlyArray<NewEvent> = [],
        set: Partial<typeof buildings.$inferInsert> = {},
      ) =>
        mutate('moving the end on', (transaction) =>
          Effect.gen(function* () {
            const written = yield* transaction
              .update(buildings)
              .set({ ...set, phase: to })
              .where(
                and(
                  eq(buildings.id, building.id),
                  eq(buildings.phase, building.phase),
                  eq(buildings.state, 'active'),
                ),
              )
              .returning({ id: buildings.id })
              .pipe(Effect.mapError(refusedWhile('moving the end on')))
            return { result: written.length > 0, events: written.length > 0 ? events : [] }
          }),
        )

      /** Where the reviewers read the checkpoint: copied from its trees, again if it is gone. */
      const copyOf = (building: BuildingRow, checkpointId: string) =>
        Effect.gen(function* () {
          const folder = reviewFolderOf(dataFolder, building.id)
          if (existsSync(folder)) return folder
          const database = yield* Database
          const trees = yield* database
            .select()
            .from(checkpointRepositories)
            .where(eq(checkpointRepositories.checkpointId, checkpointId))
            .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
          const partial = `${folder}.partial`
          rmSync(partial, { recursive: true, force: true })
          for (const one of trees) {
            const base = basesOf(building).find((each) => each.repository === one.repository)
            if (base === undefined) continue
            yield* Snapshots.use((snapshots) =>
              snapshots.materialize(
                building.missionId,
                placeOf(base),
                one.tree,
                repositoryFolderOf(partial, one.repository),
              ),
            )
          }
          yield* Effect.sync(() => {
            rmSync(folder, { recursive: true, force: true })
            // A copy is whole or absent: one stopped half-way is made again.
            renameSync(partial, folder)
          })
          return folder
        })

      // --- the steps --------------------------------------------------------------------------------

      /** The documenter's pass, run by this engine and waited on through its events. */
      const document = (building: BuildingRow, mode: DocumenterMode) =>
        Effect.gen(function* () {
          documenting.add(building.id)
          yield* Documenter.use((documenter) => documenter.run(building.id, mode)).pipe(
            // Refused before a pass is recorded: the user is asked, never a loop of refusals.
            Effect.catchTag('DocumenterRefused', (refused) =>
              raise(building, `The documenter's pass did not run: ${refused.reason}.`),
            ),
            Effect.ensuring(Effect.sync(() => documenting.delete(building.id))),
            Effect.andThen(drive(building.id)),
            provided,
            Effect.forkIn(scope),
          )
        })

      /**
       * A documenter's pass that failed: run again when a stop of Hemera failed it, or at the
       * user's Retry; otherwise the user is asked.
       */
      const documenterFailed = (building: BuildingRow, pass: PassRow, mode: DocumenterMode) =>
        Effect.gen(function* () {
          if (
            stoppedByHemera(pass.failure) ||
            (yield* retried(building.missionId, pass.endedAt ?? ''))
          ) {
            return yield* document(building, mode)
          }
          yield* raise(
            building,
            `The documenter's pass did not finish: ${pass.failure ?? 'no reason given'}.`,
          )
        })

      /**
       * Whether a red of the final checks waits on the Builder, from what is stored, so a restart
       * neither judges its fix early nor waits for a turn that already ended: the attempt the red
       * opened for the Builder, not begun (as `cutScopes` reads it), and no turn of the Builder
       * ended since it opened.
       */
      const waitsOnBuilder = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const open = (yield* attemptsIn(database, building.id)).findLast(
            (one) =>
              one.taskId === null &&
              one.scope === 'end' &&
              one.subject === null &&
              one.endedAt === null,
          )
          if (open === undefined || open.number === 1) return false
          if ((yield* checkResultsIn(database, open.id)).length > 0) return false
          const checking = yield* database
            .select({ name: buildingCheckRuns.name })
            .from(buildingCheckRuns)
            .where(eq(buildingCheckRuns.attemptId, open.id))
            .pipe(Effect.mapError(refusedWhile('reading the checks running')))
          if (checking.length > 0) return false
          const turned = (yield* buildingRow(building.id))?.builderTurnedAt ?? null
          return turned === null || turned < open.startedAt
        })

      /** Whether the last result of a final check is red. */
      const checksRed = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          return (yield* finalChecksIn(database, building.missionId, building.id)).some(
            (one) => one.verdict === 'red',
          )
        })

      /** One step of the end: true when it moved on, false when it waits. */
      const step = (building: BuildingRow, phase: EndPhase) =>
        Effect.gen(function* () {
          const database = yield* Database
          const missionId = building.missionId
          switch (phase) {
            case 'documenter': {
              if (documenting.has(building.id)) return false
              const last = (yield* passesIn(database, building.id)).at(-1)
              if (last === undefined) {
                yield* document(building, { kind: 'full' })
                return false
              }
              if (last.state === 'failed') {
                yield* documenterFailed(building, last, { kind: 'full' })
                return false
              }
              if (last.state === 'waiting_for_slot' || last.state === 'running') return false
              return yield* moveOn(building, 'final_checks')
            }
            case 'final_checks': {
              if (yield* waitsOnBuilder(building)) return false
              const verdict = yield* BuildDesk.use((desk) =>
                desk.judgeScope(missionId, 'end', null),
              )
              if (verdict === 'pending') return false
              if (verdict === 'red') {
                // A red hands an attempt to the Builder; the third asks the user, and says so.
                if (!(yield* waitsOnBuilder(building))) return false
                yield* mutate('saying the final checks are red', () =>
                  Effect.succeed({
                    result: undefined,
                    events: [buildingEvent(missionId, 'building.final_checks', { verdict })],
                  }),
                )
                return false
              }
              return yield* moveOn(building, 'checkpoint', [
                buildingEvent(missionId, 'building.final_checks', { verdict }),
              ])
            }
            case 'checkpoint': {
              const checkpointId =
                building.reviewCheckpointId ??
                (yield* Checkpoints.use((one) =>
                  one.take(
                    missionId,
                    'review',
                    basesOf(building).map((base) => ({
                      name: base.repository,
                      folder: base.folder,
                      baseRef: null,
                      baseCommit: base.commit,
                    })),
                  ),
                ))
              if (building.reviewCheckpointId === null) {
                yield* mutate('keeping the review checkpoint', (transaction) =>
                  transaction
                    .update(buildings)
                    .set({ reviewCheckpointId: checkpointId })
                    .where(and(eq(buildings.id, building.id), isNull(buildings.reviewCheckpointId)))
                    .pipe(
                      Effect.mapError(refusedWhile('keeping the review checkpoint')),
                      Effect.as({
                        result: undefined,
                        events: [
                          buildingEvent(missionId, 'review.checkpoint_taken', {
                            checkpoint: checkpointId,
                          }),
                        ],
                      }),
                    ),
                )
              }
              yield* copyOf(building, checkpointId)
              return yield* moveOn(building, 'review')
            }
            case 'review': {
              const checkpointId = building.reviewCheckpointId
              if (checkpointId === null) return yield* moveOn(building, 'checkpoint')
              const passes = lastPassesOf(yield* reviewPassesIn(database, building.id))
              const failed = passes.filter((one) => one.state === 'failed')
              const again =
                failed.length > 0 &&
                (yield* retried(
                  missionId,
                  failed.map((one) => one.endedAt ?? '').toSorted()[0] ?? '',
                ))
              if (passes.length < REVIEWERS.length || again) {
                const folder = yield* copyOf(building, checkpointId)
                yield* AutoReview.use((review) =>
                  review.start(
                    building,
                    checkpointId,
                    folder,
                    failed.map((one) => reviewerOf(one)),
                  ),
                )
                return false
              }
              if (failed.length > 0) {
                // A failed pass never lets the end go on: the user is asked, and Retry runs it.
                yield* raise(
                  building,
                  `The automatic review did not finish: ${failed
                    .map(
                      (one) =>
                        `the ${REVIEWER_NAMES[reviewerOf(one)]}'s pass failed (${one.failure ?? 'no reason given'})`,
                    )
                    .join('; ')}.`,
                )
                return false
              }
              if (passes.some((one) => one.state === 'waiting' || one.state === 'running'))
                return false
              return yield* sortFindings(building)
            }
            case 'special_tasks': {
              const tasks = yield* tasksIn(database, building.id)
              const special = tasks.filter((one) => one.origin === 'review')
              if (special.some((one) => one.state !== 'done' && one.state !== 'skipped'))
                return false
              const findings = yield* reviewFindingsIn(database, building.id)
              if (findings.some((one) => one.fate === 'decision' || one.fate === null)) return false
              return yield* moveOn(building, 'documenter_delta')
            }
            case 'documenter_delta': {
              if (documenting.has(building.id)) return false
              const last = (yield* passesIn(database, building.id)).at(-1)
              if (last?.state === 'waiting_for_slot' || last?.state === 'running') return false
              if (last?.mode === 'delta') {
                if (last.state !== 'failed') return yield* moveOn(building, 'refresh')
                yield* documenterFailed(building, last, {
                  kind: 'delta',
                  files: filesOfPass(last),
                })
                return false
              }
              const special = yield* database
                .select({ repository: attemptWrites.repository, path: attemptWrites.path })
                .from(attemptWrites)
                .where(
                  and(
                    eq(attemptWrites.buildingId, building.id),
                    inArray(
                      attemptWrites.taskId,
                      (yield* tasksIn(database, building.id))
                        .filter((one) => one.origin === 'review')
                        .map((one) => one.id),
                    ),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the special tasks’ writes')))
              const needed = (yield* Documenter.use((documenter) =>
                documenter.deltaNeeded(building.id),
              )).filter((one) =>
                special.some(
                  (write) => write.repository === one.repository && write.path === one.path,
                ),
              )
              if (needed.length === 0) return yield* moveOn(building, 'refresh')
              yield* mutate('saying the documenter runs again', () =>
                Effect.succeed({
                  result: undefined,
                  events: [
                    buildingEvent(missionId, 'building.documenter_delta', {
                      files: needed.map((one) =>
                        one.repository === ROOT_REPOSITORY
                          ? one.path
                          : `${one.repository}/${one.path}`,
                      ),
                    }),
                  ],
                }),
              )
              yield* document(building, { kind: 'delta', files: needed })
              return false
            }
            case 'refresh': {
              if (yield* waitsOnBuilder(building)) return yield* withBuilder(missionId)
              const last = refreshed.get(building.id)
              const stale = last === undefined ? [] : yield* staleLeft(building)
              if (
                last === undefined ||
                (stale.length > 0 && last !== (yield* treesOf(missionId)))
              ) {
                yield* refresh(building)
              } else if (stale.length > 0) {
                // Refreshed on these trees already: nothing will run it again on its own, so the
                // user is asked, and Retry refreshes once more.
                refreshed.delete(building.id)
                yield* raise(
                  building,
                  `The proofs could not all be run again: ${stale.join(', ')} stayed stale after the refresh.`,
                )
                return false
              } else if (yield* checksRed(building)) {
                yield* BuildDesk.use((desk) => desk.judgeScope(missionId, 'end', null))
              }
              if (yield* waitsOnBuilder(building)) return yield* withBuilder(missionId)
              // The proofs are waited on, never the Builder: their runs drive the end again.
              if (yield* unsettled(building)) return yield* withBuilder(missionId)
              if ((yield* getMission(missionId)).needs.length > 0)
                return yield* withBuilder(missionId)
              return yield* exit(building)
            }
          }
        })

      /** Every finding not sorted yet: a decision need, or a special task; then the next step. */
      const sortFindings = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const owner = yield* ownerOf(building)
          const pending = (yield* reviewFindingsIn(database, building.id)).filter(
            (one) => one.fate === null,
          )
          // The need's writers are made outside the transaction, which they then write in.
          const asks = new Map<string, Effect.Success<ReturnType<typeof createNeedIn>>>()
          for (const finding of pending) {
            if (!finding.contradictsSpec) continue
            asks.set(
              finding.id,
              yield* createNeedIn(
                REVIEW_NEEDS,
                owner,
                DecisionFields.make({
                  question: questionOf(finding),
                  options: [...CONTRADICTION_OPTIONS],
                  recommended: null,
                }),
              ),
            )
          }
          return yield* mutate('sorting the review’s findings', (transaction) =>
            Effect.gen(function* () {
              const current = yield* activeBuildingIn(transaction, building.missionId)
              if (current?.id !== building.id || current.phase !== 'review') {
                return { result: false, events: [] }
              }
              const events: NewEvent[] = []
              for (const finding of pending) {
                const ask = asks.get(finding.id)
                if (ask !== undefined) {
                  const made = yield* ask(transaction)
                  yield* transaction
                    .update(reviewFindings)
                    .set({ fate: 'decision', needId: made.id })
                    .where(eq(reviewFindings.id, finding.id))
                    .pipe(Effect.mapError(refusedWhile('keeping a finding’s fate')))
                  events.push(
                    ...made.events,
                    buildingEvent(building.missionId, 'review.finding_need', {
                      finding: finding.number,
                      reviewer: finding.reviewer,
                      need: made.id,
                    }),
                  )
                  continue
                }
                events.push((yield* specialTaskIn(transaction, current, finding)).event)
              }
              events.push(...(yield* settleIn(transaction, current)).events)
              yield* transaction
                .update(buildings)
                .set({ phase: 'special_tasks' })
                .where(eq(buildings.id, building.id))
                .pipe(Effect.mapError(refusedWhile('moving the end on')))
              return { result: true, events }
            }),
          )
        })

      /**
       * What is stale and waits for no one: each automated proof made stale with no failed run
       * waiting for its fix, and each final check that is not red but ran on an older tree.
       */
      const staleLeft = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const fixing = (yield* attemptsIn(database, building.id))
            .filter((one) => one.scope === 'proof' && one.endedAt === null)
            .map((one) => one.subject)
          const proofs = (yield* scenarioProofsIn(database, building.id))
            .filter(
              (row) =>
                modeOf(row) === 'automated' &&
                stateOf(row) === 'to_rerun' &&
                !fixing.includes(row.scenario),
            )
            .map((row) => row.scenario)
          const checks = (yield* finalChecksIn(database, building.missionId, building.id))
            .filter((one) => one.verdict !== 'red' && !one.upToDate)
            .map((one) => (one.place === '' ? one.name : `${one.name} · ${one.place}`))
          return [...proofs, ...checks]
        })

      /** The mission's current trees, as one key: a snapshot that saw a change changes it. */
      const treesOf = (missionId: string) =>
        Effect.gen(function* () {
          const current = yield* currentTreesIn(yield* Database, missionId)
          return JSON.stringify([...current].toSorted(([a], [b]) => a.localeCompare(b)))
        })

      /**
       * The stale proofs and final checks run again, once per tree: the trees are read before the
       * refresh, so a write that lands during it makes the next step refresh again.
       */
      const refresh = (building: BuildingRow) =>
        Effect.gen(function* () {
          refreshed.set(building.id, yield* treesOf(building.missionId))
          yield* BuildDesk.use((desk) => desk.refreshProofs(building.missionId))
        })

      /**
       * The end waits at its last step: the Builder works meanwhile. A restart does not resume it
       * there (the exit could be under way), so the end does, before it next exits.
       */
      const withBuilder = (missionId: string) =>
        Effect.as(
          BuildDesk.use((desk) => desk.ensureBuilder(missionId)),
          false,
        )

      /** Whether an automated proof is not proven, or a final check is red or stale. */
      const unsettled = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const unproven = (yield* scenarioProofsIn(database, building.id)).some(
            (row) => modeOf(row) === 'automated' && !PROVEN.some((state) => state === stateOf(row)),
          )
          if (unproven) return true
          return (yield* finalChecksIn(database, building.missionId, building.id)).some(
            (one) => one.verdict === 'red' || !one.upToDate,
          )
        })

      /**
       * The mission's whole tree stops: every session, children first, and every command its agents
       * started. Then the calls already executing end, and what one started meanwhile (a helper's
       * session, a command) is stopped in turn, and its calls waited for: nothing of theirs lands
       * after this. A call the user allowed runs no more from the first stop, whoever of the tree
       * asked it, until a Builder works on the mission again. What was queued for them is kept, for
       * a Builder the exit sends back; the exit's commit sets it aside.
       */
      const stopAll = (missionId: string) =>
        Effect.gen(function* () {
          // The tree is every lineage the mission has had: one that ended on its own before the exit
          // is of it too. One born later is stopped by the stops, or is born after the exit.
          const lineages = (yield* sessionsIn(SESSION_STATES, { kind: 'mission', missionId })).map(
            (one) => one.lineage,
          )
          yield* ToolAccess.use((access) => access.exiting(missionId, lineages))
          const once = Sessions.use((sessions) =>
            sessions.stopTree({ kind: 'mission', missionId }, STOPPED_AT_THE_END, 'kept'),
          ).pipe(
            Effect.andThen(stopAgentRuns(missionId)),
            Effect.andThen(ToolAccess.use((access) => access.settled(missionId))),
          )
          yield* once
          yield* once
        })

      /**
       * The exit. The mission's whole tree stops first, so no write of its sessions or of their
       * commands lands after the Workspace is looked at; then a snapshot of each repository, which
       * makes stale whatever a late write touched. Anything stale or red sends the end back to the
       * Builder, resumed, with the stale proofs and checks run again. Otherwise what changed after the review checkpoint is kept
       * with who wrote it, and the mission moves to Review and the Building ends, in one
       * transaction, unless a session came back or the exit's mark was cleared since the stops:
       * then true, and the exit runs again. A failure in between leaves the end at `refresh`, which
       * runs the exit again.
       */
      const exit = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const missionId = building.missionId
          yield* stopAll(missionId)
          // A question a stopped call raised as the tree stopped holds the exit until answered.
          if ((yield* getMission(missionId)).needs.length > 0) return false
          const snapshots = yield* Snapshots
          const ends: Array<{ readonly base: BuildingBase; readonly tree: string }> = []
          for (const base of basesOf(building)) {
            const tree = yield* snapshots.take(placeOf(base), {
              kind: 'review_exit',
              missionId,
              buildingId: building.id,
            })
            ends.push({ base, tree })
          }
          if (yield* unsettled(building)) {
            yield* said('a write landed after the last checks: they run again before Review')
            yield* BuildDesk.use((desk) => desk.ensureBuilder(missionId))
            yield* refresh(building)
            return false
          }
          const changed: Array<typeof reviewChangedAfter.$inferInsert> = []
          if (building.reviewCheckpointId !== null) {
            const [taken] = yield* database
              .select()
              .from(checkpoints)
              .where(eq(checkpoints.id, building.reviewCheckpointId))
              .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
            const trees = yield* database
              .select()
              .from(checkpointRepositories)
              .where(eq(checkpointRepositories.checkpointId, building.reviewCheckpointId))
              .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
            const writes = yield* database
              .select({
                repository: attemptWrites.repository,
                path: attemptWrites.path,
                taskId: attemptWrites.taskId,
                subject: buildingAttempts.subject,
              })
              .from(attemptWrites)
              .innerJoin(buildingAttempts, eq(buildingAttempts.id, attemptWrites.attemptId))
              .where(
                and(
                  eq(attemptWrites.buildingId, building.id),
                  gt(attemptWrites.at, taken?.takenAt ?? ''),
                ),
              )
              .orderBy(attemptWrites.at)
              .pipe(Effect.mapError(refusedWhile('reading the writes')))
            for (const { base, tree: end } of ends) {
              const tree = trees.find((one) => one.repository === base.repository)?.tree ?? null
              for (const file of yield* snapshots.changed(missionId, placeOf(base), tree, end)) {
                const last = writes.findLast(
                  (one) =>
                    one.repository === base.repository &&
                    (one.path === file.path || one.path === file.oldPath),
                )
                changed.push({
                  buildingId: building.id,
                  repository: base.repository,
                  path: file.path,
                  status: file.status,
                  added: file.added,
                  removed: file.removed,
                  writtenBy:
                    last === undefined
                      ? null
                      : (last.taskId ?? (last.subject === DOCUMENTATION ? 'documenter' : null)),
                })
              }
            }
          }
          const ended = yield* mutate('ending the Building', (transaction) =>
            Effect.gen(function* () {
              const current = yield* activeBuildingIn(transaction, missionId)
              if (current?.id !== building.id || current.phase !== 'refresh') {
                return { result: 'stale' as const, events: [] }
              }
              // Something came back since the stops (a Builder resumed, its mark cleared): the
              // exit goes back, and stops the tree again before it looks once more.
              const exiting = yield* ToolAccess.use((access) => access.isExiting(missionId))
              const live = yield* transaction
                .select({ id: agentSessions.id })
                .from(agentSessions)
                .where(
                  and(
                    eq(agentSessions.ownerKind, 'mission'),
                    eq(agentSessions.ownerId, missionId),
                    inArray(agentSessions.state, [...LIVE_SESSION]),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the sessions')))
              if (!exiting || live.length > 0) return { result: 'again' as const, events: [] }
              const [mission] = yield* transaction
                .select({ id: missions.id, stage: missions.stage, round: missions.round })
                .from(missions)
                .where(eq(missions.id, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the mission')))
              if (mission === undefined || mission.stage !== 'building') {
                return { result: 'stale' as const, events: [] }
              }
              const event = yield* moveMissionIn(
                transaction,
                { ...mission, stage: 'building' },
                'endBuilding',
                'hemera',
              )
              // Kept through the stops for a Builder the exit sends back, never sent now.
              yield* supersedeAll(transaction, { kind: 'mission', missionId })
              const at = new Date().toISOString()
              yield* transaction
                .update(buildings)
                .set({ state: 'ended', phase: 'ended', endedAt: at })
                .where(eq(buildings.id, building.id))
                .pipe(Effect.mapError(refusedWhile('ending the Building')))
              if (changed.length > 0) {
                yield* transaction
                  .insert(reviewChangedAfter)
                  .values(changed)
                  .onConflictDoNothing()
                  .pipe(Effect.mapError(refusedWhile('keeping what changed after the review')))
              }
              return {
                result: 'ended' as const,
                events: [
                  event,
                  buildingEvent(missionId, 'building.ended', {
                    label: building.label,
                    changedAfter: changed.length,
                  }),
                ],
              }
            }),
          )
          if (ended === 'ended') {
            yield* Effect.sync(() =>
              rmSync(reviewFolderOf(dataFolder, building.id), { recursive: true, force: true }),
            )
          }
          return ended === 'again'
        })

      // --- the driver -----------------------------------------------------------------------------

      /** A step that threw: the user is asked, and Retry runs it again. */
      const stepFailed = (buildingId: string, cause: Cause.Cause<unknown>) =>
        Effect.gen(function* () {
          const why = Cause.pretty(cause).split('\n')[0] ?? ''
          const building = yield* buildingRow(buildingId)
          if (building?.state !== 'active') return yield* said(`a step did not run: ${why}`)
          yield* raise(building, `A step of the end did not run (${building.phase}): ${why}`)
        }).pipe(
          provided,
          Effect.catchCause((again) => said(`a step did not run, nor its need: ${String(again)}`)),
        )

      /** Runs the end's steps as far as they go now. */
      const advance = (buildingId: string) =>
        Effect.gen(function* () {
          for (;;) {
            const building = yield* buildingRow(buildingId)
            if (building === null) return
            if (building.state !== 'active') {
              yield* Effect.sync(() =>
                rmSync(reviewFolderOf(dataFolder, buildingId), { recursive: true, force: true }),
              )
              return
            }
            const phase = endPhaseOf(building.phase)
            if (phase === null) return
            // An error need of the end holds it until the user's Retry.
            if ((yield* endNeedOf(building.missionId))?.state === 'pending') return
            if (!(yield* step(building, phase))) return
          }
        })

      /** Drives a Building's end in a fiber of its own: one at a time, again when asked meanwhile. */
      function drive(buildingId: string): Effect.Effect<void> {
        return Effect.suspend(() => {
          if (running.has(buildingId)) {
            running.set(buildingId, true)
            return Effect.void
          }
          running.set(buildingId, false)
          const once: Effect.Effect<void> = advance(buildingId).pipe(
            provided,
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : stepFailed(buildingId, cause),
            ),
            Effect.andThen(
              Effect.suspend(() => {
                if (running.get(buildingId) === true) {
                  running.set(buildingId, false)
                  return once
                }
                running.delete(buildingId)
                return Effect.void
              }),
            ),
          )
          return once.pipe(Effect.forkIn(scope), Effect.asVoid)
        })
      }

      /** The mission's Building, driven when its end is under way. */
      const driveMission = (missionId: string) =>
        Effect.gen(function* () {
          const building = yield* activeBuildingIn(yield* Database, missionId)
          if (building === null || endPhaseOf(building.phase) === null) return
          yield* drive(building.id)
        })

      // --- an answer ---------------------------------------------------------------------------

      apply = (answered, transaction) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const [finding] = yield* transaction
            .select()
            .from(reviewFindings)
            .where(eq(reviewFindings.needId, answered.id))
            .pipe(Effect.mapError(refusedWhile('reading the finding')))
          if (finding === undefined || finding.fate !== 'decision') return []
          const [building] = yield* transaction
            .select()
            .from(buildings)
            .where(eq(buildings.id, finding.buildingId))
            .pipe(Effect.mapError(refusedWhile('reading the Building')))
          const answer = answerOf(answered)
          const kept = answer === null ? null : secrets.mask(answer)
          const events: NewEvent[] = [
            buildingEvent(finding.missionId, 'review.finding_answered', {
              finding: finding.number,
              answer: kept,
            }),
          ]
          yield* transaction
            .update(reviewFindings)
            .set({ answer: kept })
            .where(eq(reviewFindings.id, finding.id))
            .pipe(Effect.mapError(refusedWhile('keeping the answer')))
          if (building?.state !== 'active') {
            yield* transaction
              .update(reviewFindings)
              .set({ fate: 'dismissed' })
              .where(eq(reviewFindings.id, finding.id))
              .pipe(Effect.mapError(refusedWhile('keeping a finding’s fate')))
            return events
          }
          if (answer === SPEC_IS_RIGHT) {
            events.push((yield* specialTaskIn(transaction, building, finding)).event)
            events.push(...(yield* settleIn(transaction, building)).events)
            return events
          }
          if (answer === RESULT_IS_RIGHT) {
            // The result joins the Spec as a decision taken in Building: spec_read lists it.
            yield* transaction
              .insert(buildingDecisions)
              .values({
                id: crypto.randomUUID(),
                buildingId: building.id,
                needId: answered.id,
                kind: 'review',
                tasks: '[]',
                question: secrets.mask(questionOf(finding)),
                options: secrets.mask(writeStrings([...CONTRADICTION_OPTIONS])),
                recommended: null,
                amendment: null,
                state: 'answered',
                answer: kept,
                applied: false,
                requestedBy: 'hemera',
                requestedAt: answered.createdAt,
                answeredAt: now(),
              })
              .pipe(Effect.mapError(refusedWhile('recording the decision')))
          }
          yield* transaction
            .update(reviewFindings)
            .set({ fate: answer === RESULT_IS_RIGHT ? 'recorded' : 'dismissed' })
            .where(eq(reviewFindings.id, finding.id))
            .pipe(Effect.mapError(refusedWhile('keeping a finding’s fate')))
          return events
        }).pipe(Effect.provide(context))

      // --- following what happens -------------------------------------------------------------

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.filter((event) => event.entityKind === 'mission'),
        Stream.runForEach((event) =>
          driveMission(event.entityId).pipe(
            provided,
            Effect.catchCause((cause) => said(`an event was not followed: ${String(cause)}`)),
          ),
        ),
      )
      const turns = post.turns.pipe(
        Stream.filter((turn) => !turn.on),
        Stream.runForEach((turn) =>
          Effect.gen(function* () {
            const session = yield* getSession(turn.sessionId)
            if (session.role !== 'builder' || session.owner.kind !== 'mission') return
            const building = yield* activeBuildingIn(yield* Database, session.owner.missionId)
            if (building === null || endPhaseOf(building.phase) === null) return
            // Kept, so a red the Builder fixes is judged after this turn even across a restart.
            yield* mutate('keeping the end of the Builder’s turn', (transaction) =>
              transaction
                .update(buildings)
                .set({ builderTurnedAt: now() })
                .where(eq(buildings.id, building.id))
                .pipe(
                  Effect.mapError(refusedWhile('keeping the end of the Builder’s turn')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            yield* drive(building.id)
          }).pipe(
            provided,
            Effect.catchCause((cause) => said(`a turn's end was not followed: ${String(cause)}`)),
          ),
        ),
      )
      // At every start: each end under way resumes at its step.
      const resume = Effect.gen(function* () {
        const database = yield* Database
        const going = yield* database
          .select({ id: buildings.id, phase: buildings.phase })
          .from(buildings)
          .where(eq(buildings.state, 'active'))
          .pipe(Effect.mapError(refusedWhile('reading the Buildings')))
        for (const one of going) {
          if (endPhaseOf(one.phase) !== null) yield* drive(one.id)
        }
      })

      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(Memory.use((memory) => memory.ready)),
        Effect.andThen(
          Effect.all([follow, turns, resume], { concurrency: 'unbounded', discard: true }),
        ),
        provided,
        Effect.catchCause((cause) => said(`the end stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )

      return {
        end: (missionId: string) =>
          Effect.gen(function* () {
            const started = yield* mutate('starting the end of the Building', (transaction) =>
              Effect.gen(function* () {
                const building = yield* activeBuildingIn(transaction, missionId)
                if (building === null) return { result: null, events: [] }
                if (building.phase !== 'tasks') return { result: building.id, events: [] }
                yield* transaction
                  .update(buildings)
                  .set({ phase: 'documenter' })
                  .where(eq(buildings.id, building.id))
                  .pipe(Effect.mapError(refusedWhile('starting the end of the Building')))
                return {
                  result: building.id,
                  events: [
                    buildingEvent(missionId, 'building.tasks_done'),
                    buildingEvent(missionId, 'building.end_started', { label: building.label }),
                  ],
                }
              }),
            )
            if (started !== null) yield* drive(started)
          }).pipe(provided, Effect.orDie),
      }
    }),
  )
  /** An error need of the end answered: the end is driven again, and its step tries again. */
  const retry: NeedHandler = {
    deliver: (need) =>
      Effect.succeed(
        Predicate.isTagged(need.owner, 'Mission')
          ? [buildingEvent(need.owner.missionId, 'building.end_retried')]
          : [],
      ),
  }
  return { layer, handler, retry }
}
