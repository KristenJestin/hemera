/**
 * The delivery (S1): from Ship to Done, a mission's repositories leave in waves, each through the
 * steps its copy of the waves gives it, in the background, across restarts.
 *
 * - **The plan.** Ship copied the waves and the End and recorded which repositories changed since
 *   their base, in its own transaction. Once Ship is committed (`mission.shipped`, or at the next
 *   start when an engine stopped in between), the plan is computed once from that copy (`planDelivery`)
 *   and stored: the participating repositories, their waves, and each one's steps with their mode
 *   and configuration, each by the id its copy gives it. Changing the Project's rules afterwards
 *   never touches it. Ship marking the mission delivered (the Local preset everywhere) plans none.
 * - **Waves.** The repositories of the lowest wave not delivered run in parallel, each through its
 *   steps in order. An error stops its repository and the next wave, never the others of its wave.
 *   A repository whose push (#464, Ship's) has not ended waits for it before its first step.
 * - **Every step**, its type's (`steps.ts`): before it runs, `check`; already true, it is recorded
 *   done with what was found. A click step opens a decision need (Go / Stop delivery) when its turn
 *   comes. Running, a step that acts outside the database writes its intent first (CT-09) and its
 *   outcome with its state, in one transaction. A step that waits on the world is watched: one poll
 *   at a time, every `pollEvery` (60 seconds), each read bounded by `readLimit` (30 seconds), again at
 *   once at every start and when `refresh` is called (the window regains the focus). A read that
 *   cannot say keeps the step waiting, with why: an unknown state is never a success. A forge step
 *   waits while its repository's forge CLI is missing or signed out, saying which (#253).
 * - **One Journal line per step**, when it ends (done, already true, failed, stopped, indeterminate),
 *   never one per poll. A failure keeps the remote's or Git's message verbatim, masked, and opens an
 *   error need with Retry and Stop delivery; its `need.created` is the "failure" notification.
 * - **Restart.** A step left running with an intent and no outcome is judged by its type's
 *   post-condition when it has one, recorded and run again only when it is not done; without one
 *   (a Command, an Agent step), it becomes indeterminate: a decision need, "Run again" or "It is
 *   already done", never a run of its own.
 * - **Retry** runs a failed or stopped repository again from its first step not done, each step
 *   checked first: nothing is done twice. A repository of a wave that waits on another is not
 *   retried: the failed one of the earlier wave is.
 * - **Stop delivery** (the user's, or a Cancel) stops what remains and keeps what is done: pending
 *   steps stopped, the delivery's open needs expired, a running step interrupted (its process or
 *   session stopped by its type) and recorded stopped, a wait no longer watched. Nothing is sent to
 *   any remote, nothing is undone; what was delivered stays delivered.
 * - **Before a merge** (S2's Merge step), the pre-merge guards: this ticket's says the pull
 *   request's head must be the last commit Hemera pushed (S3 replaces it with the frozen tree's).
 */

import {
  DecisionFields,
  type DeliveryAction,
  DeliveryAction as DeliveryActionSchema,
  type DeliveryStepState,
  ErrorFields,
  type Masked,
  MissionOwner,
  type NeedFields,
  deliveryStatus,
  planDelivery,
  repositoryStatus,
  stepSaid,
} from '@hemera/core/domain'
import {
  DeliveryRetryRefused,
  type DeliveryRepositoryView,
  type DeliveryView,
  type ForgeCli,
  type UnknownMission,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Match,
  Option,
  Predicate,
  PubSub,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { readTrees } from '../building/proof-store.ts'
import { missionCopies } from '../delivery-rules.ts'
import type { DomainEvents } from '../domain-events.ts'
import { ForgePort } from '../forges/port.ts'
import type { DomainEvent, NewEvent } from '../journal.ts'
import { type MissionActivity, getMission } from '../missions.ts'
import {
  DeliveryFailed,
  type NeedHandler,
  createNeedIn,
  expireNeedIn,
  needService,
} from '../needs.ts'
import { Diffs } from '../review/diffs.ts'
import { Secrets } from '../secrets.ts'
import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from '../storage/database.ts'
import {
  buildingLaunches,
  deliveryPushes,
  deliveryRepositories,
  deliveryRuns,
  deliverySteps,
  effectfulActions,
  missionShips,
  missions,
} from '../storage/schema.ts'
import { beginActionIn, settleActionIn } from '../tools/actions.ts'
import { mutate } from '../transaction.ts'
import {
  DeliveryStepTypes,
  type StepAnswer,
  type StepAt,
  type StepType,
  failed,
  notYetRun,
  waiting,
} from './steps.ts'

/** The engine service the delivery's needs belong to. */
export const DELIVERY_RUN_NEEDS = needService('delivery-run')

/** How often a wait is read again: one constant (open point of the ticket). */
export const POLL_EVERY = Duration.seconds(60)

/** How long one read of the world may take (#5's limit). */
export const READ_LIMIT = Duration.seconds(30)

/** The kind of a delivery step's intent (CT-09). */
export const STEP_ACTION = 'delivery.step'

/** The answers of the delivery's needs. */
export const GO = 'Go'
export const STOP_DELIVERY = 'Stop delivery'
export const RETRY = 'Retry'
export const RUN_AGAIN = 'Run again'
export const ALREADY_DONE = 'It is already done'

/** Where a suite holds a step: as its run starts (intent written), and once it ran. */
export type DeliveryMoment = 'running' | 'ran'

export type DeliveryHold = (
  at: DeliveryMoment,
  repository: string,
  step: string,
) => Effect.Effect<void>

export interface DeliveriesSettings {
  readonly log: Log
  readonly pollEvery?: Duration.Input | undefined
  readonly readLimit?: Duration.Input | undefined
  readonly hold?: DeliveryHold | undefined
}

/** A pre-merge guard refused the merge: why, and the commit it did not expect. */
export interface MergeRefusal {
  readonly sentence: string
  readonly unexpected: string
}

export interface DeliveriesService {
  /** The mission's delivery; null before Ship, or when Ship marked it delivered. */
  readonly get: (
    missionId: string,
  ) => Effect.Effect<DeliveryView | null, UnknownMission | DatabaseError>
  /** The same now, then after every change. */
  readonly watch: (
    missionId: string,
  ) => Stream.Stream<DeliveryView | null, UnknownMission | DatabaseError>
  readonly retry: (
    missionId: string,
    repository: string,
  ) => Effect.Effect<DeliveryView, UnknownMission | DeliveryRetryRefused | DatabaseError>
  readonly stop: (
    missionId: string,
  ) => Effect.Effect<DeliveryView | null, UnknownMission | DatabaseError>
  /** Every wait read again now. */
  readonly refresh: Effect.Effect<void>
  /** What a stop left, then each committed event, for as long as the stream lasts. */
  readonly follow: (events: Stream.Stream<DomainEvent>) => Effect.Effect<void>
  /**
   * The pre-merge guards S2's Merge runs: null when the merge may happen, the first refusal
   * otherwise. `head` is the pull request's head as the forge reads it now.
   */
  readonly beforeMerge: (
    missionId: string,
    repositoryId: string,
    head: string,
  ) => Effect.Effect<MergeRefusal | null, DatabaseError>
}

/** What the delivery's engine reaches, captured once by its layer. */
type Engaged =
  | Database
  | DomainEvents
  | Secrets
  | ForgePort
  | Diffs
  | DeliveryStepTypes
  | MissionActivity

export class Deliveries extends Context.Service<Deliveries, DeliveriesService>()('Deliveries') {}

type StepRow = typeof deliverySteps.$inferSelect
type RepositoryRow = typeof deliveryRepositories.$inferSelect

const now = () => new Date().toISOString()

const STATES: ReadonlyArray<DeliveryStepState> = [
  'pending',
  'needs-click',
  'running',
  'waiting',
  'done',
  'failed',
  'indeterminate',
  'stopped',
]
const stateOf = (row: StepRow): DeliveryStepState =>
  STATES.find((one) => one === row.state) ?? 'indeterminate'

/** The states a step is still to end from. */
const OPEN: ReadonlyArray<DeliveryStepState> = [
  'pending',
  'needs-click',
  'running',
  'waiting',
  'indeterminate',
]

const readAction = Schema.decodeUnknownOption(Schema.fromJsonString(DeliveryActionSchema))
const readChanged = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const Asked = Schema.Struct({ kept: Schema.Json, option: Schema.NullOr(Schema.String) })
const readAsked = Schema.decodeUnknownOption(Schema.fromJsonString(Asked))
const writeAsked = Schema.encodeSync(Schema.fromJsonString(Asked))
const writeAction = Schema.encodeSync(Schema.fromJsonString(DeliveryActionSchema))
const CLIS: ReadonlyArray<ForgeCli> = ['gh', 'bkt']

/** The pre-merge guard of this ticket: the pull request's head is the last commit Hemera pushed. */
const lastPushedHead = (missionId: string, repositoryId: string, head: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ commit: deliveryPushes.commit, repository: deliveryPushes.repository })
      .from(deliveryPushes)
      .where(
        and(eq(deliveryPushes.missionId, missionId), eq(deliveryPushes.repositoryId, repositoryId)),
      )
      .pipe(Effect.mapError(refusedWhile('reading the last push')))
    const pushed = row?.commit ?? null
    if (pushed !== null && pushed === head) return null
    const name = row?.repository ?? repositoryId
    return {
      sentence:
        pushed === null
          ? `The pull request of ${name} has the head ${head.slice(0, 7)}, but Hemera never pushed ${name}: it is not merged.`
          : `The pull request of ${name} has the head ${head.slice(0, 7)}, not ${pushed.slice(0, 7)}, the last commit Hemera pushed: someone pushed to its branch, so it is not merged.`,
      unexpected: head,
    } satisfies MergeRefusal
  })

/** The guards a merge passes, in order; S3 replaces the head check with the frozen tree's. */
export const MERGE_GUARDS = [lastPushedHead] as const

export const deliveriesLayer = (settings: DeliveriesSettings) => {
  let deliver: NeedHandler['deliver'] | null = null
  const handler: NeedHandler = {
    deliver: (need, transaction) =>
      deliver === null
        ? Effect.fail(new DeliveryFailed({ reason: 'the delivery is not running yet' }))
        : deliver(need, transaction),
  }
  const layer = Layer.effect(
    Deliveries,
    Effect.gen(function* () {
      const database = yield* Database
      const secrets = yield* Secrets
      const types = yield* DeliveryStepTypes
      const context = yield* Effect.context<Engaged>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Engaged>) =>
        Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const pollEvery = Duration.fromInputUnsafe(settings.pollEvery ?? POLL_EVERY)
      const readLimit = Duration.fromInputUnsafe(settings.readLimit ?? READ_LIMIT)
      const said = (line: string) => Effect.sync(() => settings.log(`delivery: ${line}`))
      const hold = (at: DeliveryMoment, repository: string, step: string) =>
        settings.hold?.(at, repository, step) ?? Effect.void
      const typeOf = (kind: string): StepType => types.get(kind) ?? notYetRun(kind)

      // --- what changed, told to whoever watches -----------------------------------------------

      const keyOf = (missionId: string, repositoryId: string) => `${missionId}\u0000${repositoryId}`

      const changed = yield* PubSub.unbounded<string>()
      const told = (missionId: string) => PubSub.publish(changed, missionId)

      // --- the waits, woken at a refresh or by the mission's pushes -----------------------------

      const wakes = new Map<string, Deferred.Deferred<void>>()
      const wakeOf = (missionId: string) =>
        Effect.gen(function* () {
          const kept = wakes.get(missionId)
          if (kept !== undefined) return kept
          const made = yield* Deferred.make<void>()
          wakes.set(missionId, made)
          return made
        })
      const wake = (missionId: string) =>
        Effect.gen(function* () {
          const kept = wakes.get(missionId)
          wakes.delete(missionId)
          if (kept !== undefined) yield* Deferred.succeed(kept, undefined)
        })
      /**
       * The wake each driver took as its turn began, by mission and repository: a refresh that comes
       * while it reads, before it naps, still wakes it.
       */
      const naps = new Map<string, Deferred.Deferred<void>>()
      /** Until the next poll: the interval, or a refresh since the turn began, whichever first. */
      const nap = (row: Pick<StepRow, 'missionId' | 'repositoryId'>) =>
        Effect.suspend(() => {
          const woken = naps.get(keyOf(row.missionId, row.repositoryId))
          return woken === undefined
            ? Effect.sleep(pollEvery)
            : Effect.raceFirst(Effect.sleep(pollEvery), Deferred.await(woken))
        })

      // --- rows ------------------------------------------------------------------------------------

      const runOf = (missionId: string) =>
        database
          .select()
          .from(deliveryRuns)
          .where(eq(deliveryRuns.missionId, missionId))
          .pipe(
            Effect.mapError(refusedWhile('reading the delivery')),
            Effect.map(([row]) => row ?? null),
          )
      const repositoriesOf = (missionId: string) =>
        database
          .select()
          .from(deliveryRepositories)
          .where(eq(deliveryRepositories.missionId, missionId))
          .orderBy(asc(deliveryRepositories.position))
          .pipe(Effect.mapError(refusedWhile('reading the delivery’s repositories')))
      const stepsOf = (missionId: string) =>
        database
          .select()
          .from(deliverySteps)
          .where(eq(deliverySteps.missionId, missionId))
          .orderBy(asc(deliverySteps.position))
          .pipe(Effect.mapError(refusedWhile('reading the delivery’s steps')))
      const stepsOfRepository = (missionId: string, repositoryId: string) =>
        Effect.map(stepsOf(missionId), (rows) =>
          rows.filter((row) => row.repositoryId === repositoryId),
        )
      const statusOf = (steps: ReadonlyArray<StepRow>) =>
        repositoryStatus(steps.map((row) => ({ state: stateOf(row) })))

      /** One write of the delivery, its events, then told to whoever watches. */
      const write = <A, E>(
        missionId: string,
        what: string,
        body: (
          transaction: EngineTransaction,
        ) => Effect.Effect<{ readonly result: A; readonly events: ReadonlyArray<NewEvent> }, E>,
      ) =>
        provided(mutate(what, body)).pipe(
          Effect.uninterruptible,
          Effect.tap(() => told(missionId)),
        )

      const stepEvent = (
        row: Pick<StepRow, 'missionId' | 'stepId' | 'kind'>,
        repository: string,
        type: string,
        payload: Record<string, string | boolean | null>,
      ): NewEvent => ({
        type,
        entityKind: 'mission',
        entityId: row.missionId,
        source: 'system',
        author: 'hemera',
        payload: { repository, step: row.stepId, kind: row.kind, ...payload },
      })
      const runEvent = (
        missionId: string,
        type: string,
        payload: Record<string, string | number | null | ReadonlyArray<string>>,
        author: 'hemera' | 'human' = 'hemera',
      ): NewEvent => ({
        type,
        entityKind: 'mission',
        entityId: missionId,
        source: author === 'human' ? 'ui' : 'system',
        author,
        payload: { ...payload },
      })

      const ownerOf = (projectId: string, missionId: string) =>
        MissionOwner.make({ projectId, missionId, taskId: null })

      /** Expires each need given that is still open, in the transaction. */
      const expireIn = (
        transaction: EngineTransaction,
        ids: ReadonlyArray<string | null>,
        reason: string,
      ) =>
        Effect.map(
          Effect.forEach(
            ids.filter((id) => id !== null),
            (id) => expireNeedIn(transaction, id, reason),
          ),
          (all) => all.flat(),
        )

      /** Settles the step's intent left without an outcome, in the transaction. */
      const settleIn = (
        transaction: EngineTransaction,
        actionId: string | null,
        state: 'done' | 'failed',
        outcome: string,
      ) =>
        actionId === null
          ? Effect.succeed([])
          : settleActionIn(transaction, actionId, state, secrets.mask(outcome))

      // --- the view --------------------------------------------------------------------------------

      const viewOf = (missionId: string) =>
        Effect.gen(function* () {
          yield* provided(getMission(missionId))
          const run = yield* runOf(missionId)
          if (run === null) return null
          const repositories = yield* repositoriesOf(missionId)
          const steps = yield* stepsOf(missionId)
          const views = repositories.map((repository): DeliveryRepositoryView => {
            const own = steps.filter((row) => row.repositoryId === repository.repositoryId)
            return {
              repositoryId: repository.repositoryId,
              repository: repository.repository,
              wave: repository.wave,
              bumpOnly: repository.bumpOnly,
              status: statusOf(own),
              steps: own.map((row) => ({
                id: row.stepId,
                kind: row.kind,
                mode: row.mode === 'click' ? 'click' : 'auto',
                state: stateOf(row),
                outcome: row.outcome,
                message: row.message,
                reason: row.reason,
                waitingFor: CLIS.find((one) => one === row.waitingFor) ?? null,
                needId: row.needId,
                startedAt: row.startedAt,
                endedAt: row.endedAt,
              })),
            }
          })
          const waves = [...new Set(repositories.map((one) => one.wave))].toSorted((a, b) => a - b)
          return {
            missionId,
            wavesVersion: run.wavesVersion,
            status: deliveryStatus({
              stopped: run.state === 'stopped',
              repositories: views.map((one) => one.status),
            }),
            waves: waves.map((wave) =>
              repositories.filter((one) => one.wave === wave).map((one) => one.repositoryId),
            ),
            repositories: views,
            startedAt: run.startedAt,
            stoppedAt: run.stoppedAt,
            deliveredAt: run.deliveredAt,
          } satisfies DeliveryView
        })

      // --- the plan --------------------------------------------------------------------------------

      /** Ship committed: the plan computed from the copy of the waves and stored, once. */
      const begin = (missionId: string) =>
        Effect.gen(function* () {
          const mission = yield* provided(getMission(missionId))
          if (mission.stage !== 'shipping') return
          if ((yield* runOf(missionId)) !== null) return
          const [ship] = yield* database
            .select()
            .from(missionShips)
            .where(eq(missionShips.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('reading Ship')))
          // Ship marked it delivered (the Local preset everywhere): nothing is left to deliver.
          if (ship === undefined || ship.deliveredAt !== null) return
          const copies = yield* provided(missionCopies(missionId)).pipe(
            Effect.catchTag('UnknownProject', () => Effect.succeed([])),
          )
          const waves = copies.find((one) => one.section === 'waves')
          if (waves?.section !== 'waves') {
            return yield* said(`${missionId} has no copy of the waves: nothing is delivered`)
          }
          // A Ship before this version did not record what changed: what it froze takes part.
          const frozen = new Set(readTrees(ship.trees).map((one) => one.repository))
          const changedIds = Option.getOrElse(readChanged(ship.changed ?? ''), () =>
            waves.repositories.filter((one) => frozen.has(one.name)).map((one) => one.repositoryId),
          )
          const plan = planDelivery(waves, changedIds)
          const startedAt = now()
          yield* write(missionId, 'planning a delivery', (transaction) =>
            Effect.gen(function* () {
              const inserted = yield* transaction
                .insert(deliveryRuns)
                .values({
                  missionId,
                  wavesVersion: waves.version,
                  state: 'running',
                  startedAt,
                  stoppedAt: null,
                  deliveredAt: null,
                  updatedAt: startedAt,
                })
                .onConflictDoNothing()
                .returning({ missionId: deliveryRuns.missionId })
                .pipe(Effect.mapError(refusedWhile('planning the delivery')))
              if (inserted.length === 0) return { result: undefined, events: [] }
              let position = 0
              for (const [rank, repository] of plan.repositories.entries()) {
                yield* transaction
                  .insert(deliveryRepositories)
                  .values({
                    missionId,
                    repositoryId: repository.repositoryId,
                    repository: repository.name,
                    wave: repository.wave,
                    position: rank,
                    bumpOnly: repository.bumpOnly,
                  })
                  .pipe(Effect.mapError(refusedWhile('planning the delivery')))
                for (const step of repository.steps) {
                  yield* transaction
                    .insert(deliverySteps)
                    .values({
                      missionId,
                      repositoryId: repository.repositoryId,
                      stepId: step.id,
                      position: position++,
                      kind: step.kind,
                      mode: typeOf(step.kind).alwaysClick === true ? 'click' : step.mode,
                      action: writeAction(step),
                      state: 'pending',
                      clicked: false,
                      watching: false,
                      updatedAt: startedAt,
                    })
                    .pipe(Effect.mapError(refusedWhile('planning the delivery')))
                }
              }
              return {
                result: undefined,
                events: [
                  runEvent(missionId, 'delivery.run.started', {
                    wavesVersion: waves.version,
                    repositories: plan.repositories.map((one) => one.name),
                    waves:
                      plan.repositories.length === 0
                        ? 0
                        : (plan.repositories.at(-1)?.wave ?? 0) + 1,
                  }),
                ],
              }
            }),
          )
          yield* advance(missionId)
        })

      // --- the waves -------------------------------------------------------------------------------

      const turns = new Map<string, Semaphore.Semaphore>()
      const turnOf = (missionId: string) => {
        const kept = turns.get(missionId) ?? Semaphore.makeUnsafe(1)
        turns.set(missionId, kept)
        return kept
      }
      /**
       * The repositories driven now, by mission and repository: marked before their driver is
       * forked, so a driver that ends at once is never taken for one still going.
       */
      const driving = new Set<string>()
      const drivers = new Map<string, Fiber.Fiber<void>>()

      /**
       * The delivery moves on: every repository of the lowest wave not delivered that can go on
       * is driven, once; with every repository delivered, the delivery is.
       */
      const advance = (missionId: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const run = yield* runOf(missionId)
          if (run?.state !== 'running') return
          const repositories = yield* repositoriesOf(missionId)
          const steps = yield* stepsOf(missionId)
          const standing = repositories.map((repository) => ({
            repository,
            status: statusOf(steps.filter((row) => row.repositoryId === repository.repositoryId)),
          }))
          const left = standing.filter((one) => one.status !== 'delivered')
          if (left.length === 0) {
            if (run.deliveredAt !== null) return
            const at = now()
            yield* write(missionId, 'recording a delivery delivered', (transaction) =>
              transaction
                .update(deliveryRuns)
                .set({ deliveredAt: at, updatedAt: at })
                .where(eq(deliveryRuns.missionId, missionId))
                .pipe(
                  Effect.mapError(refusedWhile('recording the delivery')),
                  Effect.as({
                    result: undefined,
                    events: [runEvent(missionId, 'delivery.run.delivered', {})],
                  }),
                ),
            )
            return
          }
          const wave = Math.min(...left.map((one) => one.repository.wave))
          for (const one of left) {
            if (one.repository.wave !== wave) continue
            if (!['not-started', 'running', 'waiting'].includes(one.status)) continue
            const key = keyOf(missionId, one.repository.repositoryId)
            if (driving.has(key)) continue
            driving.add(key)
            const fiber = yield* drive(missionId, one.repository).pipe(
              Effect.ensuring(
                Effect.suspend(() => {
                  driving.delete(key)
                  drivers.delete(key)
                  return advance(missionId).pipe(Effect.forkIn(scope), Effect.asVoid)
                }),
              ),
              Effect.forkIn(scope),
            )
            if (driving.has(key)) drivers.set(key, fiber)
          }
        }).pipe(
          Semaphore.withPermits(turnOf(missionId), 1),
          Effect.catchCause((cause) => said(`${missionId} did not move on: ${String(cause)}`)),
        )

      // --- one repository's steps -----------------------------------------------------------------

      /** What a repository's steps stand on: its worktree and the mission's Workspace. */
      const placeOf = (missionId: string, repository: RepositoryRow) =>
        Effect.gen(function* () {
          const mission = yield* provided(getMission(missionId))
          const places = yield* provided(
            Diffs.use((diffs) => diffs.places(missionId)).pipe(Effect.orElseSucceed(() => null)),
          )
          const [launch] = yield* database
            .select({ workspaceId: buildingLaunches.workspaceId })
            .from(buildingLaunches)
            .where(
              and(
                eq(buildingLaunches.missionId, missionId),
                eq(buildingLaunches.state, 'launched'),
              ),
            )
            .orderBy(desc(buildingLaunches.startedAt))
            .limit(1)
            .pipe(Effect.mapError(refusedWhile('reading the Workspace')))
          return {
            projectId: mission.projectId,
            folder: places?.find((one) => one.name === repository.repository)?.folder ?? null,
            workspaceId: launch?.workspaceId ?? null,
          }
        })

      const atOf = (
        row: StepRow,
        repository: RepositoryRow,
        place: { projectId: string; folder: string | null; workspaceId: string | null },
      ): StepAt | null =>
        Option.match(readAction(row.action), {
          onNone: () => null,
          onSome: (step: DeliveryAction) => ({
            missionId: row.missionId,
            projectId: place.projectId,
            repositoryId: row.repositoryId,
            repository: repository.repository,
            step,
            folder: place.folder,
            workspaceId: place.workspaceId,
          }),
        })

      /** A read of the world, bounded: one that does not answer in time, or dies, cannot say. */
      const bounded = (read: Effect.Effect<StepAnswer>, what: string) =>
        read.pipe(
          Effect.timeoutOption(readLimit),
          Effect.map(
            Option.getOrElse(() =>
              waiting(
                `${what} did not answer within ${String(Duration.toSeconds(readLimit))} seconds.`,
              ),
            ),
          ),
          Effect.catchDefect((defect) =>
            Effect.succeed(waiting(`${what} could not be read: ${String(defect)}`)),
          ),
        )

      /** The repository's push (Ship's, #464), when it has one that has not ended: why it waits. */
      const pushHeld = (missionId: string, repositoryId: string) =>
        Effect.gen(function* () {
          const [row] = yield* database
            .select({ state: deliveryPushes.state, repository: deliveryPushes.repository })
            .from(deliveryPushes)
            .where(
              and(
                eq(deliveryPushes.missionId, missionId),
                eq(deliveryPushes.repositoryId, repositoryId),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the push')))
          if (row === undefined || row.state === 'done' || row.state === 'declined') return null
          return row.state === 'failed' || row.state === 'indeterminate'
            ? `The push of ${row.repository} has not ended: its need waits for you.`
            : `The push of ${row.repository} has not ended yet.`
        })

      /** The forge CLI a forge step waits for, and why, while it is missing or signed out. */
      const cliHeld = (at: StepAt) =>
        provided(
          ForgePort.use((port) => port.status(at.projectId)).pipe(Effect.orElseSucceed(() => [])),
        ).pipe(
          Effect.map((statuses) => {
            const status = statuses.find((one) => one.repositoryId === at.repositoryId)
            if (
              status === undefined ||
              status.cli === null ||
              status.state === 'ready' ||
              status.state === 'not-needed'
            ) {
              return null
            }
            const fix = status.fix === null ? '' : `: ${status.fix}`
            return {
              cli: status.cli,
              reason: `${status.cli} is ${status.state.replace('-', ' ')} for ${at.repository}, so this step waits${fix}.`,
            }
          }),
        )

      /** The step now waits: why (masked), the CLI it waits for, and whether it is its own watch. */
      const setWaiting = (
        row: StepRow,
        reason: string,
        watching: boolean,
        cli: ForgeCli | null = null,
      ) =>
        Effect.gen(function* () {
          const masked = secrets.mask(reason)
          if (row.state === 'waiting' && row.reason === masked && row.waitingFor === cli) return
          yield* write(row.missionId, 'recording a wait', (transaction) =>
            transaction
              .update(deliverySteps)
              .set({
                state: 'waiting',
                reason: masked,
                waitingFor: cli,
                watching,
                startedAt: row.startedAt ?? (watching ? now() : null),
                updatedAt: now(),
              })
              .where(
                and(
                  eq(deliverySteps.missionId, row.missionId),
                  eq(deliverySteps.repositoryId, row.repositoryId),
                  eq(deliverySteps.stepId, row.stepId),
                  inArray(deliverySteps.state, ['pending', 'running', 'waiting']),
                ),
              )
              .pipe(
                Effect.mapError(refusedWhile('recording a wait')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
        })

      /** The step ends: done, failed or indeterminate, with its line in the Journal and its need. */
      const finish = (
        row: StepRow,
        at: StepAt,
        projectId: string,
        end:
          | { readonly state: 'done'; readonly outcome: string; readonly found: boolean }
          | { readonly state: 'failed'; readonly message: string }
          | { readonly state: 'indeterminate'; readonly question: string },
      ) =>
        Effect.gen(function* () {
          const step = stepSaid(at.step, at.repository)
          const need: NeedFields | null = Match.value(end).pipe(
            Match.discriminatorsExhaustive('state')({
              done: () => null,
              failed: (failed) =>
                ErrorFields.make({
                  failed: `The step “${row.stepId}” of ${at.repository} failed.`,
                  attempts: [{ what: step, output: failed.message }],
                  proposals: [RETRY, STOP_DELIVERY],
                  recommended: {
                    option: RETRY,
                    reason:
                      'Retry runs the repository again from this step; what is already true is checked first, and nothing is done twice.',
                  },
                }),
              indeterminate: (cut) =>
                DecisionFields.make({
                  question: cut.question,
                  options: [RUN_AGAIN, ALREADY_DONE],
                  recommended: null,
                }),
            }),
          )
          const create =
            need === null
              ? null
              : yield* provided(
                  createNeedIn(DELIVERY_RUN_NEEDS, ownerOf(projectId, row.missionId), need),
                )
          const text = Match.value(end).pipe(
            Match.discriminatorsExhaustive('state')({
              done: (one) => one.outcome,
              failed: (one) => one.message,
              indeterminate: () => 'Its result is unknown.',
            }),
          )
          const masked = secrets.mask(text)
          const ended = end.state === 'indeterminate' ? null : now()
          yield* write(row.missionId, 'ending a delivery step', (transaction) =>
            Effect.gen(function* () {
              const made = create === null ? null : yield* create(transaction)
              const updated = yield* transaction
                .update(deliverySteps)
                .set({
                  state: end.state,
                  outcome: end.state === 'done' ? masked : null,
                  message: end.state === 'done' ? null : masked,
                  reason: null,
                  waitingFor: null,
                  needId: made?.id ?? null,
                  asked: null,
                  endedAt: ended,
                  updatedAt: now(),
                })
                .where(
                  and(
                    eq(deliverySteps.missionId, row.missionId),
                    eq(deliverySteps.repositoryId, row.repositoryId),
                    eq(deliverySteps.stepId, row.stepId),
                    inArray(deliverySteps.state, ['pending', 'running', 'waiting', 'needs-click']),
                  ),
                )
                .returning({ stepId: deliverySteps.stepId })
                .pipe(Effect.mapError(refusedWhile('ending a delivery step')))
              // Stopped meanwhile: the stop recorded it, and nothing of this end is written.
              if (updated.length === 0) return yield* Effect.die(STOPPED_MEANWHILE)
              const settled =
                end.state === 'indeterminate'
                  ? []
                  : yield* settleIn(transaction, row.actionId, end.state, text)
              const expired = yield* expireIn(
                transaction,
                [row.needId],
                end.state === 'done' ? 'the step is already done' : 'the step moved on',
              )
              return {
                result: undefined,
                events: [
                  ...(made?.events ?? []),
                  ...settled,
                  ...expired,
                  stepEvent(row, at.repository, 'delivery.run.step_ended', {
                    state: end.state,
                    outcome: end.state === 'done' ? masked : null,
                    message: end.state === 'done' ? null : masked,
                    found: end.state === 'done' && end.found,
                  }),
                ],
              }
            }),
          ).pipe(
            Effect.catchDefect((defect) =>
              defect === STOPPED_MEANWHILE ? Effect.void : Effect.die(defect),
            ),
          )
        })

      /** A decision need on the step: its click, or what its type asks; the step waits for it. */
      const ask = (
        row: StepRow,
        projectId: string,
        fields: NeedFields,
        asked: Masked<string> | null,
        state: 'needs-click' | 'running' = 'needs-click',
      ) =>
        Effect.gen(function* () {
          const create = yield* provided(
            createNeedIn(DELIVERY_RUN_NEEDS, ownerOf(projectId, row.missionId), fields),
          )
          yield* write(row.missionId, 'asking for a delivery step', (transaction) =>
            Effect.gen(function* () {
              const run = yield* runIn(transaction, row.missionId)
              if (run?.state !== 'running') return { result: undefined, events: [] }
              const made = yield* create(transaction)
              // A run that asks has ended its effect: its intent is settled, never judged again.
              const settled = yield* settleIn(
                transaction,
                row.actionId,
                'done',
                'the step asked the user',
              )
              yield* transaction
                .update(deliverySteps)
                .set({
                  state,
                  needId: made.id,
                  actionId: null,
                  asked,
                  reason: null,
                  waitingFor: null,
                  updatedAt: now(),
                })
                .where(stepWhere(row))
                .pipe(Effect.mapError(refusedWhile('asking for a delivery step')))
              return { result: undefined, events: [...made.events, ...settled] }
            }),
          )
        })

      const runIn = (transaction: EngineTransaction, missionId: string) =>
        transaction
          .select({ state: deliveryRuns.state })
          .from(deliveryRuns)
          .where(eq(deliveryRuns.missionId, missionId))
          .pipe(
            Effect.mapError(refusedWhile('reading the delivery')),
            Effect.map(([run]) => run ?? null),
          )

      const stepWhere = (row: Pick<StepRow, 'missionId' | 'repositoryId' | 'stepId'>) =>
        and(
          eq(deliverySteps.missionId, row.missionId),
          eq(deliverySteps.repositoryId, row.repositoryId),
          eq(deliverySteps.stepId, row.stepId),
        )

      /** Takes what a step's read answered: an end, a wait (then a nap), or a question. */
      const took = (
        row: StepRow,
        at: StepAt,
        projectId: string,
        answer: StepAnswer,
        watching: boolean,
      ) =>
        Match.value(answer).pipe(
          Match.tagsExhaustive({
            Done: (one) =>
              finish(row, at, projectId, { state: 'done', outcome: one.outcome, found: false }),
            Failed: (one) => finish(row, at, projectId, { state: 'failed', message: one.message }),
            Waiting: (one) => Effect.andThen(setWaiting(row, one.reason, watching), nap(row)),
            NotDone: () => Effect.andThen(setWaiting(row, 'Not there yet.', watching), nap(row)),
            Asks: (one) =>
              ask(
                row,
                projectId,
                DecisionFields.make({
                  question: one.question,
                  options: [...one.options],
                  recommended: one.recommended,
                }),
                secrets.mask(writeAsked({ kept: one.kept, option: null })),
              ),
          }),
        )

      /** A step whose turn came, or whose read could not say: checked, then asked or run. */
      const start = (row: StepRow, at: StepAt, projectId: string) =>
        Effect.gen(function* () {
          const type = typeOf(row.kind)
          const pushing = yield* pushHeld(row.missionId, row.repositoryId)
          if (pushing !== null) {
            yield* setWaiting(row, pushing, false)
            return yield* nap(row)
          }
          if (type.forge) {
            const cli = yield* cliHeld(at)
            if (cli !== null) {
              yield* setWaiting(row, cli.reason, false, cli.cli)
              return yield* nap(row)
            }
          }
          const found = yield* bounded(
            type.check(at),
            `Whether ${stepSaid(at.step, at.repository)} is done`,
          )
          if (Predicate.isTagged(found, 'Done')) {
            return yield* finish(row, at, projectId, {
              state: 'done',
              outcome: found.outcome,
              found: true,
            })
          }
          if (!Predicate.isTagged(found, 'NotDone'))
            return yield* took(row, at, projectId, found, false)
          if (row.mode === 'click' && !row.clicked) {
            const words = type.click?.(at) ?? {
              question: `${stepSaid(at.step, at.repository)}?`,
              go: GO,
            }
            return yield* ask(
              row,
              projectId,
              DecisionFields.make({
                question: words.question,
                options: [words.go, STOP_DELIVERY],
                recommended: {
                  option: words.go,
                  reason: 'It is the next step of the delivery the Project’s rules describe.',
                },
              }),
              null,
            )
          }
          yield* runStep(row, at, projectId, type)
        })

      /** Runs a step: its intent first when it acts, its outcome with its state. */
      const runStep = (row: StepRow, at: StepAt, projectId: string, type: StepType) =>
        Effect.gen(function* () {
          const actionId = type.acts ? crypto.randomUUID() : null
          const started = yield* write(row.missionId, 'starting a delivery step', (transaction) =>
            Effect.gen(function* () {
              const run = yield* runIn(transaction, row.missionId)
              if (run?.state !== 'running') return { result: false, events: [] }
              // An intent a stop or a check left without an outcome was found not done.
              const left = yield* settleIn(
                transaction,
                row.actionId,
                'failed',
                'found not done on checking',
              )
              const updated = yield* transaction
                .update(deliverySteps)
                .set({
                  state: 'running',
                  actionId,
                  reason: null,
                  waitingFor: null,
                  watching: false,
                  startedAt: now(),
                  updatedAt: now(),
                })
                .where(
                  and(
                    stepWhere(row),
                    inArray(deliverySteps.state, ['pending', 'waiting', 'running']),
                  ),
                )
                .returning({ stepId: deliverySteps.stepId })
                .pipe(Effect.mapError(refusedWhile('starting a delivery step')))
              if (updated.length === 0) return { result: false, events: left }
              const intent =
                actionId === null
                  ? []
                  : yield* beginActionIn(
                      transaction,
                      actionId,
                      STEP_ACTION,
                      { kind: 'mission', missionId: row.missionId, taskId: null },
                      secrets.mask(
                        JSON.stringify({
                          repository: at.repository,
                          step: row.stepId,
                          kind: row.kind,
                        }),
                      ),
                    )
              return { result: true, events: [...left, ...intent] }
            }),
          )
          if (!started) return
          yield* hold('running', at.repository, row.stepId)
          const answer = yield* type
            .run(at)
            .pipe(Effect.catchDefect((defect) => Effect.succeed(failed(String(defect)))))
          yield* hold('ran', at.repository, row.stepId)
          const ran = { ...row, state: 'running', actionId }
          if (Predicate.isTagged(answer, 'Waiting')) {
            // What it did is done; what it waits for is watched from now.
            yield* write(row.missionId, 'recording what a step did', (transaction) =>
              Effect.map(settleIn(transaction, actionId, 'done', answer.reason), (settled) => ({
                result: undefined,
                events: settled,
              })),
            )
            yield* setWaiting({ ...ran, actionId: null }, answer.reason, true)
            return yield* nap(row)
          }
          yield* took(ran, at, projectId, answer, true)
        })

      /** A step a new driver finds running: a restart, or a driver cut. CT-09. */
      const resume = (row: StepRow, at: StepAt, projectId: string) =>
        Effect.gen(function* () {
          const type = typeOf(row.kind)
          const kept = row.asked === null ? Option.none() : readAsked(row.asked)
          // The user answered what the type asked: the type takes the answer.
          if (Option.isSome(kept) && kept.value.option !== null) {
            const answered = type.answered
            const answer =
              answered === undefined
                ? waiting('This step cannot take an answer.')
                : yield* answered(at, kept.value.option, kept.value.kept).pipe(
                    Effect.catchDefect((defect) => Effect.succeed(failed(String(defect)))),
                  )
            return yield* took(row, at, projectId, answer, true)
          }
          const [action] =
            row.actionId === null
              ? []
              : yield* database
                  .select({ state: effectfulActions.state, outcome: effectfulActions.outcome })
                  .from(effectfulActions)
                  .where(eq(effectfulActions.id, row.actionId))
                  .pipe(Effect.mapError(refusedWhile('reading the step’s intent')))
          // Nothing acted outside the database: checked, then run again.
          if (action === undefined) {
            return yield* start({ ...row, state: 'pending' }, at, projectId).pipe(
              Effect.andThen(Effect.void),
            )
          }
          if (type.postCondition) {
            const found = yield* bounded(
              type.check(at),
              `Whether ${stepSaid(at.step, at.repository)} is done`,
            )
            if (Predicate.isTagged(found, 'NotDone')) {
              // Not done in the world: run again, its intent recorded as failed first.
              return yield* runStep(row, at, projectId, type)
            }
            if (Predicate.isTagged(found, 'Done')) {
              return yield* finish(row, at, projectId, {
                state: 'done',
                outcome: found.outcome,
                found: true,
              })
            }
            return yield* took(row, at, projectId, found, false)
          }
          yield* type.cut?.(at) ?? Effect.void
          const output = yield* (type.lastOutput?.(at) ?? Effect.succeed(null)).pipe(
            Effect.orElseSucceed(() => null),
          )
          yield* finish(row, at, projectId, {
            state: 'indeterminate',
            question: [
              `${stepSaid(at.step, at.repository)} was cut off midway: its result is unknown. It may have run; check the real state.`,
              `Last recorded output: ${output === null || output.trim() === '' ? 'none.' : `\n${output}`}`,
            ].join('\n'),
          })
        })

      /** A wait read again: its own watch, or the check of a step whose read could not say. */
      const poll = (row: StepRow, at: StepAt, projectId: string) =>
        Effect.gen(function* () {
          if (!row.watching) return yield* start(row, at, projectId)
          const type = typeOf(row.kind)
          if (type.forge) {
            const cli = yield* cliHeld(at)
            if (cli !== null) {
              yield* setWaiting(row, cli.reason, true, cli.cli)
              return yield* nap(row)
            }
          }
          const answer = yield* bounded(
            (type.watch ?? type.check)(at),
            `${stepSaid(at.step, at.repository)}’s wait`,
          )
          yield* took(row, at, projectId, answer, true)
        })

      /** One repository's steps, in order, until it is delivered, blocked, or the delivery stops. */
      const drive = (missionId: string, repository: RepositoryRow) =>
        Effect.gen(function* () {
          const place = yield* placeOf(missionId, repository)
          const key = keyOf(missionId, repository.repositoryId)
          for (;;) {
            naps.set(key, yield* wakeOf(missionId))
            const run = yield* runOf(missionId)
            if (run?.state !== 'running') return
            const steps = yield* stepsOfRepository(missionId, repository.repositoryId)
            const row = steps.find((one) => one.state !== 'done')
            if (row === undefined) return
            const at = atOf(row, repository, place)
            if (at === null) {
              return yield* finish(row, placeholderAt(row, repository), place.projectId, {
                state: 'failed',
                message: 'Its copy in the waves could not be read.',
              })
            }
            const state = stateOf(row)
            if (state === 'pending') yield* start(row, at, place.projectId)
            else if (state === 'running') yield* resume(row, at, place.projectId)
            else if (state === 'waiting') yield* poll(row, at, place.projectId)
            else return
          }
        }).pipe(
          Effect.catchCause((cause) =>
            said(`${repository.repository} of ${missionId} stopped: ${String(cause)}`),
          ),
        )

      // --- Stop delivery, Retry --------------------------------------------------------------------

      /** Stops what remains of a delivery, keeps what is done. `by` says who stopped it. */
      const stop = (missionId: string, by: 'human' | 'hemera', why: string) =>
        Effect.gen(function* () {
          const run = yield* runOf(missionId)
          if (run === null) return
          if (run.state !== 'stopped') {
            const at = now()
            yield* write(missionId, 'stopping a delivery', (transaction) =>
              transaction
                .update(deliveryRuns)
                .set({ state: 'stopped', stoppedAt: at, updatedAt: at })
                .where(eq(deliveryRuns.missionId, missionId))
                .pipe(
                  Effect.mapError(refusedWhile('stopping the delivery')),
                  Effect.as({
                    result: undefined,
                    events: [runEvent(missionId, 'delivery.run.stopped', { why }, by)],
                  }),
                ),
            )
          }
          // What runs is interrupted: a type stops its process or its session as it is.
          const going = [...drivers.entries()].filter(([key]) =>
            key.startsWith(`${missionId}\u0000`),
          )
          yield* Effect.forEach(going, ([, fiber]) => Fiber.interrupt(fiber), {
            concurrency: 'unbounded',
            discard: true,
          })
          const repositories = yield* repositoriesOf(missionId)
          const nameOf = (id: string) =>
            repositories.find((one) => one.repositoryId === id)?.repository ?? id
          yield* write(missionId, 'stopping the steps of a delivery', (transaction) =>
            Effect.gen(function* () {
              const rows = yield* transaction
                .select()
                .from(deliverySteps)
                .where(eq(deliverySteps.missionId, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the steps')))
              const written: NewEvent[] = []
              for (const row of rows) {
                const state = stateOf(row)
                const open = OPEN.includes(state)
                if (!open && row.needId === null) continue
                yield* transaction
                  .update(deliverySteps)
                  .set(
                    open
                      ? {
                          state: 'stopped',
                          reason: null,
                          waitingFor: null,
                          needId: null,
                          asked: null,
                          endedAt: state === 'pending' ? null : now(),
                          updatedAt: now(),
                        }
                      : { needId: null, updatedAt: now() },
                  )
                  .where(stepWhere(row))
                  .pipe(Effect.mapError(refusedWhile('stopping a step')))
                written.push(
                  ...(yield* settleIn(
                    transaction,
                    row.actionId,
                    'failed',
                    'stopped by Stop delivery',
                  )),
                  ...(yield* expireIn(transaction, [row.needId], why)),
                )
                // A step that never began ends with no line of its own: the delivery's says it.
                if (open && state !== 'pending') {
                  written.push(
                    stepEvent(row, nameOf(row.repositoryId), 'delivery.run.step_ended', {
                      state: 'stopped',
                      outcome: null,
                      message: null,
                      found: false,
                    }),
                  )
                }
              }
              return { result: undefined, events: written }
            }),
          )
        })

      const retry = (missionId: string, repository: string) =>
        Effect.gen(function* () {
          yield* provided(getMission(missionId))
          const refused = (reason: string) => new DeliveryRetryRefused({ repository, reason })
          const run = yield* runOf(missionId)
          if (run === null) return yield* refused('This mission has no delivery to retry.')
          const repositories = yield* repositoriesOf(missionId)
          const one = repositories.find((row) => row.repository === repository)
          if (one === undefined) {
            return yield* refused(`${repository} does not take part in this delivery.`)
          }
          const steps = yield* stepsOf(missionId)
          const own = steps.filter((row) => row.repositoryId === one.repositoryId)
          const status = statusOf(own)
          if (status !== 'failed' && status !== 'stopped') {
            return yield* refused(`${repository} has nothing failed or stopped to retry.`)
          }
          const before = repositories.filter(
            (row) =>
              row.wave < one.wave &&
              statusOf(steps.filter((step) => step.repositoryId === row.repositoryId)) !==
                'delivered',
          )
          if (before.length > 0) {
            return yield* refused(
              `${repository} waits for ${before.map((row) => row.repository).join(', ')}: retry ${before.length === 1 ? 'that one' : 'those'} first.`,
            )
          }
          const later = new Set(
            repositories.filter((row) => row.wave > one.wave).map((row) => row.repositoryId),
          )
          yield* write(missionId, 'retrying a repository of a delivery', (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(deliveryRuns)
                .set({ state: 'running', stoppedAt: null, updatedAt: now() })
                .where(eq(deliveryRuns.missionId, missionId))
                .pipe(Effect.mapError(refusedWhile('retrying the delivery')))
              const written: NewEvent[] = []
              for (const row of steps) {
                const state = stateOf(row)
                const again =
                  (row.repositoryId === one.repositoryId &&
                    (state === 'failed' || state === 'stopped')) ||
                  (later.has(row.repositoryId) && state === 'stopped')
                if (!again) continue
                yield* transaction
                  .update(deliverySteps)
                  .set({
                    state: 'pending',
                    message: null,
                    outcome: null,
                    reason: null,
                    waitingFor: null,
                    needId: null,
                    asked: null,
                    watching: false,
                    endedAt: null,
                    updatedAt: now(),
                  })
                  .where(stepWhere(row))
                  .pipe(Effect.mapError(refusedWhile('retrying a step')))
                written.push(...(yield* expireIn(transaction, [row.needId], 'retried')))
              }
              return {
                result: undefined,
                events: [
                  ...written,
                  runEvent(missionId, 'delivery.run.retried', { repository }, 'human'),
                ],
              }
            }),
          )
          yield* advance(missionId)
          const view = yield* viewOf(missionId)
          // Written a moment ago: a delivery that is not there now is a defect.
          return view ?? (yield* Effect.die(new Error('the delivery is gone')))
        })

      // --- the needs' answers -----------------------------------------------------------------------

      deliver = (need, transaction) =>
        Effect.gen(function* () {
          if (!Predicate.isTagged(need.owner, 'Mission')) return []
          const missionId = need.owner.missionId
          const option =
            need.answer !== null && Predicate.isTagged(need.answer, 'Chosen')
              ? need.answer.option
              : null
          const [row] = yield* transaction
            .select()
            .from(deliverySteps)
            .where(and(eq(deliverySteps.missionId, missionId), eq(deliverySteps.needId, need.id)))
            .pipe(Effect.mapError(refusedWhile('reading the step of a need')))
          if (row === undefined || option === null) return []
          const [repository] = yield* transaction
            .select({ name: deliveryRepositories.repository })
            .from(deliveryRepositories)
            .where(
              and(
                eq(deliveryRepositories.missionId, missionId),
                eq(deliveryRepositories.repositoryId, row.repositoryId),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the repository of a need')))
          const name = repository?.name ?? row.repositoryId
          const answered = (type: string) =>
            runEvent(missionId, type, { repository: name, step: row.stepId, option }, 'human')
          const set = (change: Partial<StepRow>) =>
            transaction
              .update(deliverySteps)
              .set({ ...change, needId: null, updatedAt: now() })
              .where(stepWhere(row))
              .pipe(Effect.mapError(refusedWhile('taking an answer of the delivery')))
          if (option === STOP_DELIVERY) {
            yield* set({})
            return [answered('delivery.run.stop_asked')]
          }
          const state = stateOf(row)
          if (state === 'failed') {
            yield* set({})
            return option === RETRY ? [answered('delivery.run.retry_asked')] : []
          }
          if (state === 'indeterminate') {
            if (option === ALREADY_DONE) {
              const text = 'The user said it is already done.'
              yield* set({ state: 'done', outcome: secrets.mask(text), endedAt: now() })
              const settled = yield* settleIn(transaction, row.actionId, 'done', text)
              return [
                ...settled,
                stepEvent(row, name, 'delivery.run.step_ended', {
                  state: 'done',
                  outcome: secrets.mask(text),
                  message: null,
                  found: true,
                }),
                answered('delivery.run.answered'),
              ]
            }
            const settled = yield* settleIn(
              transaction,
              row.actionId,
              'failed',
              'run again by the user',
            )
            yield* set({ state: 'pending', clicked: true, actionId: null })
            return [...settled, answered('delivery.run.answered')]
          }
          if (state !== 'needs-click') return []
          const kept = row.asked === null ? Option.none() : readAsked(row.asked)
          if (Option.isSome(kept)) {
            // The type takes the answer: the step runs again with it.
            yield* set({
              state: 'running',
              asked: secrets.mask(writeAsked({ kept: kept.value.kept, option })),
            })
            return [answered('delivery.run.answered')]
          }
          yield* set({ state: 'pending', clicked: true })
          return [answered('delivery.run.answered')]
        })

      // --- what the delivery follows ----------------------------------------------------------------

      /** At a start, after a restore's reconciliation: Ship's left unplanned, every run re-read. */
      const catchUp = Effect.gen(function* () {
        const shipped = yield* database
          .select({ id: missions.id })
          .from(missions)
          .innerJoin(missionShips, eq(missionShips.missionId, missions.id))
          .where(eq(missions.stage, 'shipping'))
          .pipe(Effect.mapError(refusedWhile('reading the missions in Shipping')))
        for (const one of shipped)
          yield* begin(one.id).pipe(
            Effect.catchCause((cause) => said(`${one.id} was not planned: ${String(cause)}`)),
          )
        const running = yield* database
          .select({ missionId: deliveryRuns.missionId })
          .from(deliveryRuns)
          .where(eq(deliveryRuns.state, 'running'))
          .pipe(Effect.mapError(refusedWhile('reading the deliveries')))
        for (const one of running) {
          yield* recheckClicks(one.missionId)
          yield* advance(one.missionId)
        }
      })

      /** A click still asked whose result is already true ends done, and its need expires. */
      const recheckClicks = (missionId: string) =>
        Effect.gen(function* () {
          const repositories = yield* repositoriesOf(missionId)
          for (const row of yield* stepsOf(missionId)) {
            if (row.state !== 'needs-click' || row.asked !== null) continue
            const repository = repositories.find((one) => one.repositoryId === row.repositoryId)
            if (repository === undefined) continue
            const place = yield* placeOf(missionId, repository)
            const at = atOf(row, repository, place)
            if (at === null) continue
            const found = yield* bounded(typeOf(row.kind).check(at), 'A click step')
            if (Predicate.isTagged(found, 'Done')) {
              yield* finish(row, at, place.projectId, {
                state: 'done',
                outcome: found.outcome,
                found: true,
              })
            }
          }
        }).pipe(
          Effect.catchCause((cause) =>
            said(`the clicks of ${missionId} were not checked again: ${String(cause)}`),
          ),
        )

      const handle = (event: DomainEvent) =>
        Effect.gen(function* () {
          const missionId = event.entityId
          if (event.type === 'mission.shipped') return yield* begin(missionId)
          if (
            event.type === 'mission.cancelled' ||
            (event.type === 'mission.moved' && event.payload['to'] === 'cancelled')
          ) {
            return yield* stop(missionId, 'human', 'the mission was cancelled')
          }
          if (event.type === 'delivery.run.stop_asked') {
            return yield* stop(missionId, 'human', 'Stop delivery')
          }
          if (event.type === 'delivery.run.retry_asked') {
            const repository = String(event.payload['repository'] ?? '')
            return yield* retry(missionId, repository).pipe(
              Effect.catchTag('DeliveryRetryRefused', (refusal) => said(refusal.reason)),
              Effect.asVoid,
            )
          }
          if (event.type === 'delivery.run.answered') return yield* advance(missionId)
          // The mission's pushes moved: a repository waiting for its push reads it again.
          if (event.type.startsWith('delivery.') && !event.type.startsWith('delivery.run.')) {
            return yield* wake(missionId)
          }
        })

      const refresh = Effect.gen(function* () {
        for (const missionId of [...wakes.keys()]) yield* wake(missionId)
      })

      const service: DeliveriesService = {
        get: (missionId) => viewOf(missionId),
        watch: (missionId) =>
          Stream.unwrap(
            Effect.gen(function* () {
              // Subscribed before the first read: no change between them is missed.
              const subscription = yield* PubSub.subscribe(changed)
              const first = yield* viewOf(missionId)
              const later = Stream.fromSubscription(subscription).pipe(
                Stream.filter((one) => one === missionId),
                Stream.mapEffect(() => viewOf(missionId)),
              )
              return Stream.concat(Stream.make(first), later)
            }),
          ),
        retry,
        stop: (missionId) =>
          Effect.gen(function* () {
            yield* provided(getMission(missionId))
            yield* stop(missionId, 'human', 'Stop delivery')
            return yield* viewOf(missionId)
          }),
        refresh,
        follow: (stream) =>
          Effect.gen(function* () {
            yield* catchUp.pipe(
              Effect.catchCause((cause) =>
                said(`what a stop left was not caught up: ${String(cause)}`),
              ),
            )
            yield* Stream.runForEach(stream, (event) =>
              handle(event).pipe(
                Effect.catchCause((cause) =>
                  said(`${event.type} was not followed: ${String(cause)}`),
                ),
              ),
            )
          }),
        beforeMerge: (missionId, repositoryId, head) =>
          Effect.gen(function* () {
            for (const guard of MERGE_GUARDS) {
              const refusal = yield* provided(guard(missionId, repositoryId, head))
              if (refusal !== null) return refusal
            }
            return null
          }),
      }
      return service
    }),
  )
  return { layer, handler }
}

/** A step ended meanwhile by a stop: what was about to be written of it is not. */
const STOPPED_MEANWHILE = new Error('the step was stopped meanwhile')

/** Where a step whose copy cannot be read is said to stand, to fail it with that reason. */
const placeholderAt = (row: StepRow, repository: RepositoryRow): StepAt => ({
  missionId: row.missionId,
  projectId: '',
  repositoryId: row.repositoryId,
  repository: repository.repository,
  step: { id: row.stepId, kind: 'confirm', mode: 'auto', what: row.kind },
  folder: null,
  workspaceId: null,
})
