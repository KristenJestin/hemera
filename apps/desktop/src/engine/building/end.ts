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
  MissionOwner,
  REVIEWER_NAMES,
  RESULT_IS_RIGHT,
  ROOT_REPOSITORY,
  SPEC_IS_RIGHT,
  specialTaskId,
  specialTaskOf,
} from '@hemera/core/domain'
import type { Need } from '@hemera/ipc'
import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import { Cause, Effect, Layer, Option, Predicate, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { Memory } from '../memory/index.ts'
import { getMission, moveIn as moveMissionIn } from '../missions.ts'
import { DeliveryFailed, type NeedHandler, createNeedIn, needService } from '../needs.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsIn } from '../sessions/store.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  attemptWrites,
  buildingAttempts,
  buildingDecisions,
  buildingTasks,
  buildings,
  checkpointRepositories,
  checkpoints,
  missions,
  reviewChangedAfter,
  reviewFindings,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { BuildingEnd } from './builder.ts'
import { Checkpoints } from './checkpoints.ts'
import { BuildDesk } from './desk.ts'
import { Documenter } from './documenter.ts'
import { passesIn } from './documenter-store.ts'
import { finalChecksIn, scenarioProofsIn, modeOf, stateOf } from './proof-store.ts'
import { AutoReview, repositoryFolderOf, reviewFolderOf } from './review.ts'
import {
  type ReviewFindingRow,
  reviewFindingsIn,
  reviewPassesIn,
  reviewerOf,
} from './review-store.ts'
import { Snapshots } from './snapshots.ts'
import {
  type BuildingBase,
  type BuildingRow,
  activeBuildingIn,
  bases,
  buildingEvent,
  now,
  settleIn,
  tasksIn,
  writeStrings,
} from './tasks.ts'

/** The service the needs of the automatic review belong to: a finding that contradicts the Spec. */
export const REVIEW_NEEDS = needService('review')

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
      /** The Buildings whose end waits on a red the Builder fixes: judged again after its turn. */
      const awaitingBuilder = new Set<string>()
      /** The Buildings whose Builder ended a turn while their end waited on it. */
      const builderTurned = new Set<string>()
      /** The Buildings whose proofs this engine refreshed. */
      const refreshed = new Set<string>()

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
      const document = (building: BuildingRow, mode: Parameters<Documenter['Service']['run']>[1]) =>
        Effect.gen(function* () {
          documenting.add(building.id)
          yield* Documenter.use((documenter) => documenter.run(building.id, mode)).pipe(
            Effect.catchTag('DocumenterRefused', (refused) =>
              said(`the documenter's pass did not run: ${refused.reason}`),
            ),
            Effect.ensuring(Effect.sync(() => documenting.delete(building.id))),
            Effect.andThen(drive(building.id)),
            provided,
            Effect.forkIn(scope),
          )
        })

      /** Whether a red of the end waits on the Builder: judged again only after its turn ends. */
      const waitsOnBuilder = (buildingId: string) => {
        if (!awaitingBuilder.has(buildingId)) return false
        if (!builderTurned.has(buildingId)) return true
        awaitingBuilder.delete(buildingId)
        builderTurned.delete(buildingId)
        return false
      }

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
              const passes = yield* passesIn(database, building.id)
              if (documenting.has(building.id)) return false
              if (passes.some((one) => one.state === 'waiting_for_slot' || one.state === 'running'))
                return false
              if (passes.length === 0) {
                yield* document(building, { kind: 'full' })
                return false
              }
              return yield* moveOn(building, 'final_checks')
            }
            case 'final_checks': {
              if (waitsOnBuilder(building.id)) return false
              const verdict = yield* BuildDesk.use((desk) =>
                desk.judgeScope(missionId, 'end', null),
              )
              if (verdict === 'pending') return false
              if (verdict === 'red') {
                awaitingBuilder.add(building.id)
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
              const passes = yield* reviewPassesIn(database, building.id)
              if (passes.length === 0) {
                const folder = yield* copyOf(building, checkpointId)
                yield* AutoReview.use((review) => review.start(building, checkpointId, folder))
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
              const passes = yield* passesIn(database, building.id)
              if (passes.some((one) => one.state === 'waiting_for_slot' || one.state === 'running'))
                return false
              if (passes.some((one) => one.mode === 'delta'))
                return yield* moveOn(building, 'refresh')
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
              if (!refreshed.has(building.id)) {
                refreshed.add(building.id)
                yield* BuildDesk.use((desk) => desk.refreshProofs(missionId))
              } else if (!waitsOnBuilder(building.id) && (yield* checksRed(building))) {
                yield* BuildDesk.use((desk) => desk.judgeScope(missionId, 'end', null))
              }
              if (awaitingBuilder.has(building.id)) return false
              const unproven = (yield* scenarioProofsIn(database, building.id)).some(
                (row) =>
                  modeOf(row) === 'automated' && !PROVEN.some((state) => state === stateOf(row)),
              )
              if (unproven || (yield* checksRed(building))) {
                awaitingBuilder.add(building.id)
                return false
              }
              if ((yield* getMission(missionId)).needs.length > 0) return false
              yield* exit(building)
              return false
            }
          }
        })

      /** Every finding not sorted yet: a decision need, or a special task; then the next step. */
      const sortFindings = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [mission] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, building.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          const owner = MissionOwner.make({
            projectId: mission?.projectId ?? '',
            missionId: building.missionId,
            taskId: null,
          })
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
       * The exit: what changed after the review checkpoint kept with who wrote it, the Builder's
       * session ended, then the mission moved to Review and the Building ended, in one transaction.
       */
      const exit = (building: BuildingRow) =>
        Effect.gen(function* () {
          const database = yield* Database
          const missionId = building.missionId
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
            for (const base of basesOf(building)) {
              const tree = trees.find((one) => one.repository === base.repository)?.tree ?? null
              const snapshots = yield* Snapshots
              const end = yield* snapshots.take(placeOf(base), {
                kind: 'review_exit',
                missionId,
                buildingId: building.id,
              })
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
          // The Builder's work is over: its session ends before the mission leaves Building.
          const owner = { kind: 'mission', missionId } as const
          for (const session of yield* sessionsIn(
            ['starting', 'working', 'idle', 'stuck'],
            owner,
          )) {
            if (session.role !== 'builder') continue
            yield* Sessions.use((sessions) => sessions.end(session.lineage, 'the Building ended'))
          }
          const moved = yield* mutate('ending the Building', (transaction) =>
            Effect.gen(function* () {
              const current = yield* activeBuildingIn(transaction, missionId)
              if (current?.id !== building.id || current.phase !== 'refresh') {
                return { result: false, events: [] }
              }
              const [mission] = yield* transaction
                .select({ id: missions.id, stage: missions.stage, round: missions.round })
                .from(missions)
                .where(eq(missions.id, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the mission')))
              if (mission === undefined || mission.stage !== 'building') {
                return { result: false, events: [] }
              }
              const event = yield* moveMissionIn(
                transaction,
                { ...mission, stage: 'building' },
                'endBuilding',
                'hemera',
              )
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
                result: true,
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
          if (moved) {
            yield* Effect.sync(() =>
              rmSync(reviewFolderOf(dataFolder, building.id), { recursive: true, force: true }),
            )
          }
        })

      // --- the driver -----------------------------------------------------------------------------

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
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : said(`a step did not run: ${Cause.pretty(cause).split('\n')[0] ?? ''}`),
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
            if (building === null || !awaitingBuilder.has(building.id)) return
            builderTurned.add(building.id)
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
  return { layer, handler }
}
