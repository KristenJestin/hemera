/**
 * The Freeze (#92): the user's gesture that freezes the Spec and its tasks and moves the mission
 * to Ready, offered only once everything is settled for the agent; the user's return to Planning,
 * which unfreezes it for a fresh Planner with a free hand; and the outdated mark engine services
 * set, which is information only.
 *
 * - **Readiness.** Every reason the Freeze is not offered, each in words: no declaration of
 *   completeness on the current version, what completeness finds now (a question open or waiting,
 *   an open discussion or a decision in transit, an input not integrated, a target or an insertion
 *   that no longer holds at the base), the cold read of this Planning (#91), a Probe prepared or
 *   running (#89), a dependency the user has not decided yet.
 * - **Freeze.** Each repository's base commit by the rule of the up-to-date base (CT-24, one fetch
 *   each), the checks of #90 run again at those commits, and the dirty files of the main checkout
 *   kept (CT-23); then, in one transaction, the readiness again, the Spec frozen, the Freeze kept,
 *   Planning → Ready, the outdated marks cleared, the dependencies' marks set, and the stops owed
 *   written down. After it the Probes are wiped and the Planner tree stopped; a stop in between
 *   leaves the stops owed, which the next start runs before any session is rebuilt.
 * - **Return.** Ready → Planning, a new Planning cycle, the Spec unfrozen (a new version), the
 *   declaration cleared, the Freeze's stops still owed dropped, the ticket's changes found after the
 *   Freeze made inputs of the new Planning (#97), and `[hemera:update]` stored in the same
 *   transaction, then handed to a fresh Planner with those inputs.
 *
 * A mission's Freezes and returns run one at a time, and never beside one of its discussions'
 * gestures. No path here reaches Building.
 */

import { createHash } from 'node:crypto'

import {
  type CompletenessFailure,
  type Mark,
  Mark as MarkSchema,
  type OutdatedSeen,
  SPEC_CHANGED_SINCE_READ,
  STAGES,
  type Stage,
  completeness,
  declarationUnsettled,
  dependencyUndecidedSaid,
  freezeRefusedDelivery,
  missionKey,
  probeLabel,
  probeUnsettled,
  updateDelivery,
} from '@hemera/core/domain'
import {
  type FreezeReadiness,
  FreezeRefused,
  type FrozenBase,
  type BaseFreshness,
} from '@hemera/ipc'
import { and, asc, eq, inArray, like } from 'drizzle-orm'
import {
  Cause,
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
} from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { Memory } from '../memory/index.ts'
import { getMission, moveIn, runStops } from '../missions.ts'
import { upToDateBase } from '../repositories.ts'
import { Secrets } from '../secrets.ts'
import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { Sessions } from '../sessions/service.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  freezeFiles,
  freezes,
  missionMarks,
  missionStops,
  type missions,
  probes,
  sessionDeliveries,
  specChanges,
  specs,
} from '../storage/schema.ts'
import { ticketEventsToPlanningIn } from '../tickets/events.ts'
import { mutate } from '../transaction.ts'
import { SpecBoard } from './board.ts'
import { deliverInputs } from './calls.ts'
import { coldReadFreshness, coldReadSettledIn } from './cold-read-store.ts'
import { blockIn, dependenciesIn, liftEnded, unblockIn } from './dependencies.ts'
import { pendingWithDiscussionsIn } from './discussion-store.ts'
import { oneAtATime } from './discussions.ts'
import { writeFrozenBases } from './freeze-store.ts'
import { type Outdated, markOutdatedIn } from './outdated.ts'
import { atBaseFailures, placeOf } from './plan.ts'
import { ProbeDesk } from './probe-desk.ts'
import { type Captured, FileSnapshots } from './snapshots.ts'
import { driftIn, missionRow, specIn, writeSpecFile } from './store.ts'
import { PlannerWake } from './wake.ts'

const now = (): string => new Date().toISOString()

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

type MissionRow = typeof missions.$inferSelect

const stageOf = (row: MissionRow): Stage => STAGES.find((one) => one === row.stage) ?? 'cancelled'

/** What the readiness says while no cold read of this Planning cycle was recorded. */
export const NO_COLD_READ_YET = 'No cold read has read the Spec in this Planning yet.'

/** What the readiness says of a mission that is not in Planning: the Freeze does not exist. */
const notPlanningSaid = (key: string, stage: Stage): string =>
  `${key} is ${capitalised(stage)}: the Freeze is for a mission in Planning.`

/** What the base commits hold, as Git read it for the Spec at a version (#90). */
interface AtBase {
  readonly version: number
  readonly failures: ReadonlyArray<CompletenessFailure>
}

/** The Probes that hold the Freeze, in words. */
const probesUnsettledIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select()
      .from(probes)
      .where(eq(probes.missionId, missionId))
      .orderBy(asc(probes.number))
      .pipe(Effect.mapError(refusedWhile('reading the Probes'))),
    (rows) =>
      rows.flatMap((row) => {
        const said = probeUnsettled({
          label: probeLabel(row.number),
          state: row.state,
          question: row.question,
        })
        return said === null ? [] : [said]
      }),
  )

/**
 * Every reason the Freeze is not offered, in the transaction given, with what Git found at the
 * base commits (`atBase`, read before it); and those of them the Planner can fix at the base.
 */
const unsettledIn = (transaction: EngineTransaction, missionId: string, atBase: AtBase) =>
  Effect.gen(function* () {
    const mission = yield* missionRow(transaction, missionId)
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    const stage = stageOf(mission)
    if (stage !== 'planning') {
      return { mission, key, reasons: [notPlanningSaid(key, stage)], atBase: [] }
    }
    const spec = yield* specIn(transaction, missionId)
    const [row] = yield* transaction
      .select({ describedAt: specs.describedAt })
      .from(specs)
      .where(eq(specs.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the Spec')))
    const declared = declarationUnsettled(key, spec.declaredCompleteVersion, spec.version)
    const atBaseNow = atBase.version === spec.version ? atBase.failures : []
    const failures = completeness(spec, {
      described: (row?.describedAt ?? null) !== null,
      triagePending: spec.triage?.state === 'pending',
      atBase: atBaseNow,
      ...(yield* pendingWithDiscussionsIn(transaction, missionId)),
      livingChanged: yield* driftIn(transaction, mission.projectId, spec),
    })
    const cold = yield* coldReadSettledIn(transaction, missionId)
    const { dependsOn } = yield* dependenciesIn(transaction, missionId)
    const reasons = [
      ...(declared === null ? [] : [declared]),
      ...failures.map((failure) => failure.sentence),
      ...(cold.ran ? cold.reasons : [NO_COLD_READ_YET]),
      ...(yield* probesUnsettledIn(transaction, missionId)),
      ...dependsOn
        .filter((one) => one.state === 'proposed')
        .map((one) => dependencyUndecidedSaid(key, one.dependsOnKey)),
    ]
    return { mission, key, reasons, atBase: atBaseNow.map((failure) => failure.sentence) }
  })

/**
 * Whether Freeze is offered, and every reason it is not, each in words; with what the last cold
 * read read against the Spec now (#91) and the mission's dependencies. What the proofs insert and
 * the tasks target is checked at the base last fetched: only the Freeze fetches.
 */
export const freezeReadiness = (missionId: string) =>
  Effect.gen(function* () {
    const atBase = yield* atBaseFailures(missionId, false)
    const database = yield* Database
    const read = yield* database.transaction((transaction) =>
      Effect.gen(function* () {
        const unsettled = yield* unsettledIn(transaction, missionId, atBase)
        return { unsettled, dependencies: yield* dependenciesIn(transaction, missionId) }
      }),
    )
    const readiness: FreezeReadiness = {
      ready: read.unsettled.reasons.length === 0,
      unsettled: read.unsettled.reasons,
      freshness: yield* coldReadFreshness(missionId),
      dependencies: read.dependencies.dependsOn,
    }
    return readiness
  })

/**
 * The readiness now, then again at each change of the mission (its Spec, its questions, its cold
 * reads, its Probes, its dependencies) and at each move of any mission (a dependency's).
 */
export const freezeReadinessChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      return Stream.concat(
        Stream.fromEffect(freezeReadiness(missionId)),
        events.pipe(
          Stream.filter(
            (event) =>
              (event.entityKind === 'mission' && event.entityId === missionId) ||
              event.type === 'mission.moved',
          ),
          Stream.mapEffect(() => freezeReadiness(missionId)),
        ),
      )
    }),
  )

/** A base's freshness, as the Freeze's Journal line says it. */
const freshnessSaid = Match.type<BaseFreshness>().pipe(
  Match.tagsExhaustive({
    FetchedNow: () => 'fetched now',
    NotFetchedSince: (freshness) =>
      freshness.since === null ? 'never fetched' : `not fetched since ${freshness.since}`,
    LocalBranch: () => 'its local branch',
  }),
)

const readMark = Schema.decodeUnknownOption(Schema.fromJsonString(MarkSchema))

/** The marks of a mission whose identity starts so, as they were set. */
const marksIn = (transaction: EngineTransaction, missionId: string, prefix: string) =>
  Effect.map(
    transaction
      .select({ mark: missionMarks.mark })
      .from(missionMarks)
      .where(and(eq(missionMarks.missionId, missionId), like(missionMarks.identity, `${prefix}%`)))
      .orderBy(asc(missionMarks.setAt))
      .pipe(Effect.mapError(refusedWhile('reading the marks'))),
    (rows) => rows.flatMap((row): ReadonlyArray<Mark> => Option.toArray(readMark(row.mark))),
  )

/** What moved since the Freeze, from the outdated marks a mission carries. */
const outdatedIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(marksIn(transaction, missionId, 'outdated:'), (marks) =>
    marks.flatMap((mark): ReadonlyArray<OutdatedSeen> =>
      Predicate.isTagged(mark, 'Outdated')
        ? [{ reason: mark.reason, difference: mark.difference }]
        : [],
    ),
  )

/** The outdated marks cleared, in the transaction given: the Freeze clears them. */
const clearOutdatedIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const cleared = yield* transaction
      .delete(missionMarks)
      .where(and(eq(missionMarks.missionId, missionId), like(missionMarks.identity, 'outdated:%')))
      .returning({ identity: missionMarks.identity })
      .pipe(Effect.mapError(refusedWhile('clearing the outdated marks')))
    return cleared.map((row): NewEvent => ({
      type: 'mission.mark_cleared',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { mark: row.identity },
    }))
  })

/** The stoppers the Freeze owes, in their order: the Probes wiped, then the session tree. */
const FREEZE_STOPS = ['probes', 'sessions'] as const

/** One repository's dirty files, as the Freeze read them. */
interface DirtyKept {
  readonly repository: string
  readonly captured: Captured
}

/** A `[hemera:freeze-refused]` stored for the Planner, to hand over once committed. */
interface Told {
  readonly id: string
  readonly body: string
}

/**
 * What the Planner can fix at the base, stored as `[hemera:freeze-refused]` in the refusal's
 * transaction, once per Spec version and failures: the same refusal clicked again wakes nothing.
 * Null when there is nothing to tell, or it was told already.
 */
const toldIn = (
  transaction: EngineTransaction,
  missionId: string,
  version: number,
  fixable: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (fixable.length === 0) return null
    const id = `freeze-refused-${createHash('sha256')
      .update([missionId, String(version), ...fixable].join('\0'))
      .digest('hex')}`
    const [already] = yield* transaction
      .select({ id: sessionDeliveries.id })
      .from(sessionDeliveries)
      .where(eq(sessionDeliveries.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the Planner’s deliveries')))
    if (already !== undefined) return null
    const body = freezeRefusedDelivery(fixable)
    // `freeze-refused` is a delivery kind: a refusal of it is a defect.
    yield* storeDeliveryIn(transaction, {
      id,
      owner: { kind: 'mission', missionId },
      target: { role: 'planner' },
      kind: 'freeze-refused',
      body,
    }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
    const told: Told = { id, body }
    return told
  })

/**
 * The user freezes the Spec at the version they read. Refused when the Spec changed since, or when
 * anything is not settled (each reason named); what the Planner can fix at the base is also handed
 * to it as `[hemera:freeze-refused]`.
 */
export const freezeMission = (missionId: string, specVersion: number) =>
  oneAtATime(missionId)(
    Effect.gen(function* () {
      const place = yield* placeOf(missionId)
      const repositories = [...place.repositories.values()].toSorted(
        (a, b) => a.position - b.position,
      )
      // Each repository's base commit, by the rule of the up-to-date base: one fetch each.
      const bases: FrozenBase[] = []
      const problems: string[] = []
      for (const repository of repositories) {
        const base = yield* upToDateBase(repository.id).pipe(Effect.result)
        if (Result.isSuccess(base)) {
          const { commit, ref, freshness } = base.success
          bases.push({ repository: repository.path, commit, ref, freshness })
        } else {
          problems.push(`The base of ${repository.path} could not be read: ${base.failure.message}`)
        }
      }
      // What the proofs insert and the tasks target, at the commits the Freeze records (#90).
      const atBase = yield* atBaseFailures(
        missionId,
        false,
        new Map(bases.map((base) => [base.repository, base.commit])),
      )
      // The dirty files of the main checkout, kept (CT-23).
      const dirty: DirtyKept[] = []
      for (const repository of repositories) {
        const folder = `${place.main}/${repository.path}`
        const files = yield* Git.use((git) => git.dirtyFiles(folder)).pipe(Effect.result)
        if (Result.isFailure(files)) {
          problems.push(
            `The main checkout of ${repository.path} could not be read: ${files.failure.message}`,
          )
          continue
        }
        if (files.success.length === 0) continue
        // Read only: what is kept of them is written with the Freeze, never for a refused one.
        const captured = yield* FileSnapshots.use((kept) =>
          kept.capture({ name: repository.path, folder }, files.success),
        )
        problems.push(...captured.problems)
        dirty.push({ repository: repository.path, captured })
      }
      const outcome = yield* mutate('freezing the Spec', (transaction) =>
        Effect.gen(function* () {
          const mission = yield* missionRow(transaction, missionId)
          const key = missionKey(mission.keyPrefix, mission.keyNumber)
          const stage = stageOf(mission)
          const refused = (reasons: ReadonlyArray<string>, told: Told | null = null) => ({
            result: { refused: reasons, told },
            events:
              stage === 'planning'
                ? [
                    {
                      type: 'planning.freeze_refused',
                      entityKind: 'mission',
                      entityId: missionId,
                      source: 'system',
                      author: 'hemera',
                      payload: { reasons: [...reasons] },
                    } satisfies NewEvent,
                  ]
                : [],
          })
          if (stage !== 'planning') return refused([notPlanningSaid(key, stage)])
          const [spec] = yield* transaction
            .select({ version: specs.version })
            .from(specs)
            .where(eq(specs.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the Spec')))
          const version = spec?.version ?? 0
          if (version !== specVersion || atBase.version !== version) {
            return refused([SPEC_CHANGED_SINCE_READ])
          }
          const unsettled = yield* unsettledIn(transaction, missionId, atBase)
          const reasons = [...problems, ...unsettled.reasons]
          if (reasons.length > 0) {
            return refused(
              reasons,
              yield* toldIn(transaction, missionId, version, unsettled.atBase),
            )
          }
          const at = now()
          const id = crypto.randomUUID()
          yield* transaction
            .insert(freezes)
            .values({
              id,
              missionId,
              cycle: mission.planningCycle,
              specVersion: version,
              bases: writeFrozenBases(bases),
              frozenAt: at,
            })
            .pipe(Effect.mapError(refusedWhile('keeping the Freeze')))
          const files = dirty.flatMap((one) =>
            one.captured.snapshots.map((snapshot) => ({
              freezeId: id,
              repository: one.repository,
              path: snapshot.path,
              status: snapshot.status,
              sha256: snapshot.sha256,
              withheld: snapshot.withheld,
            })),
          )
          if (files.length > 0) {
            yield* FileSnapshots.use((kept) =>
              kept.keepIn(
                transaction,
                dirty.map((one) => one.captured),
              ),
            )
            yield* transaction
              .insert(freezeFiles)
              .values(files)
              .pipe(Effect.mapError(refusedWhile('keeping the dirty files')))
          }
          yield* transaction
            .update(specs)
            .set({ frozen: true, frozenAt: at })
            .where(eq(specs.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('freezing the Spec')))
          const moved = yield* moveIn(transaction, { ...mission, stage }, 'freeze', 'user')
          const cleared = yield* clearOutdatedIn(transaction, missionId)
          const blocked = yield* blockIn(transaction, missionId)
          // Owed until done: a stop before they ran leaves them to the next start.
          yield* transaction
            .insert(missionStops)
            .values(FREEZE_STOPS.map((stopper) => ({ missionId, stopper, failedReason: null })))
            .onConflictDoNothing()
            .pipe(Effect.mapError(refusedWhile('writing the stops')))
          const frozen: NewEvent = {
            type: 'planning.frozen',
            entityKind: 'mission',
            entityId: missionId,
            source: 'ui',
            author: 'human',
            payload: {
              version,
              bases: bases.map(
                (base) =>
                  `${base.repository} ${base.commit.slice(0, 12)} (${freshnessSaid(base.freshness)})`,
              ),
              dirtyFiles: files.length,
            },
          }
          return {
            result: { refused: [], told: null },
            events: [moved, frozen, ...cleared, ...blocked],
          }
        }),
      )
      if (outcome.refused.length > 0) {
        const { told } = outcome
        if (told !== null) {
          yield* PlannerWake.use((wake) =>
            wake.deliver(missionId, 'freeze-refused', told.body, told.id),
          )
        }
        return yield* new FreezeRefused({ reasons: outcome.refused })
      }
      // The Freeze is committed: what follows it never answers it with an error. The Probes
      // wiped, then the Planner tree stopped; the stops owed are then done with, and what fails
      // stays owed, written down, for the next start.
      const { said } = yield* FreezeLog
      const followed = (doing: string) =>
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          said(`${doing} after the Freeze of ${missionId} failed: ${Cause.pretty(cause)}`),
        )
      yield* ProbeDesk.use((desk) => desk.wipeAll(missionId)).pipe(followed('wiping the Probes'))
      yield* Sessions.use((sessions) =>
        sessions.stopTree({ kind: 'mission', missionId }, 'the Spec was frozen'),
      ).pipe(followed('stopping the Planner'))
      yield* runStops(missionId).pipe(followed('running the stops owed'))
      yield* SpecBoard.use((board) => board.changed(missionId)).pipe(
        followed('telling the Spec’s readers'),
      )
      return yield* getMission(missionId)
    }),
  )

/**
 * The user sends a Ready mission back to Planning, with their reason or none: a new Planning cycle,
 * the Spec unfrozen at a new version, its declaration cleared, and `[hemera:update]` (what moved,
 * the reason) stored in the same transaction, then handed to a fresh Planner.
 */
export const returnToPlanning = (missionId: string, reason: string | null) =>
  oneAtATime(missionId)(
    Effect.gen(function* () {
      const secrets = yield* Secrets
      const given = reason === null || reason.trim() === '' ? null : secrets.mask(reason.trim())
      const returned = yield* mutate('sending the mission back to Planning', (transaction) =>
        Effect.gen(function* () {
          const mission = yield* missionRow(transaction, missionId)
          const key = missionKey(mission.keyPrefix, mission.keyNumber)
          const moved = yield* moveIn(
            transaction,
            { ...mission, stage: stageOf(mission) },
            'backToPlanning',
            'user',
          )
          const [spec] = yield* transaction
            .select({ version: specs.version })
            .from(specs)
            .where(eq(specs.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the Spec')))
          const frozenAt = spec?.version ?? 0
          const version = frozenAt + 1
          const at = now()
          yield* transaction
            .update(specs)
            .set({
              frozen: false,
              frozenAt: null,
              declaredCompleteVersion: null,
              version,
              updatedAt: at,
            })
            .where(eq(specs.missionId, missionId))
            .pipe(Effect.mapError(refusedWhile('unfreezing the Spec')))
          yield* transaction
            .insert(specChanges)
            .values({
              missionId,
              version,
              item: 'frozen',
              before: secrets.mask(`frozen at version ${String(frozenAt)}`),
              after: secrets.mask('unfrozen: the user sent the mission back to Planning'),
              sessionId: '',
              at,
            })
            .pipe(Effect.mapError(refusedWhile('unfreezing the Spec')))
          // The Freeze's stops still owed are no longer: Planning lives again, and a Probe or a
          // Planner of the new cycle is never stopped for it. A Probe whose wipe failed stays
          // `wiping`, and every start tries its wipe again.
          yield* transaction
            .delete(missionStops)
            .where(
              and(
                eq(missionStops.missionId, missionId),
                inArray(missionStops.stopper, [...FREEZE_STOPS]),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('forgetting the Freeze’s stops')))
          const unblocked = yield* unblockIn(transaction, missionId)
          // The ticket's changes found after the Freeze are the new Planning's inputs (#97).
          const ticket = yield* ticketEventsToPlanningIn(transaction, missionId)
          const body = updateDelivery({
            key,
            version,
            reason: given,
            outdated: yield* outdatedIn(transaction, missionId),
          })
          // `update` is a delivery kind: a refusal of it is a defect.
          const deliveryId = yield* storeDeliveryIn(transaction, {
            owner: { kind: 'mission', missionId },
            target: { role: 'planner' },
            kind: 'update',
            body,
          }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
          const back: NewEvent = {
            type: 'planning.returned',
            entityKind: 'mission',
            entityId: missionId,
            source: 'ui',
            author: 'human',
            payload: { reason: given, version },
          }
          return {
            result: { deliveryId, body, inputs: ticket.inputs },
            events: [moved, back, ...unblocked, ...ticket.events],
          }
        }),
      )
      yield* writeSpecFile(missionId).pipe(Effect.ignore)
      yield* SpecBoard.use((board) => board.changed(missionId))
      yield* PlannerWake.use((wake) =>
        wake.deliver(missionId, 'update', returned.body, returned.deliveryId),
      )
      if (returned.inputs > 0) yield* deliverInputs(missionId)
      return yield* getMission(missionId)
    }),
  )

export type { Outdated } from './outdated.ts'

/**
 * An engine service (B1 for the code and the dependencies, #97 for the ticket) marks a mission
 * outdated: the mark with what moved, and `mission.outdated`. It never moves the stage and never
 * blocks Launch; the pending needs named that no longer hold expire. Marked again on the same
 * reference, the mark says the latest difference. The next Freeze clears it.
 */
export const markOutdated = (missionId: string, outdated: Outdated) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    yield* mutate('marking the mission outdated', (transaction) =>
      Effect.map(markOutdatedIn(transaction, missionId, outdated, secrets.mask), (events) => ({
        result: undefined,
        events,
      })),
    )
    return yield* getMission(missionId)
  })

/** Where the Freeze writes down what failed after it committed: the diagnostic log. */
export class FreezeLog extends Context.Service<
  FreezeLog,
  { readonly said: (line: string) => Effect.Effect<void> }
>()('FreezeLog') {}

/**
 * What follows the Freeze: a mission reaching Done, or cancelled, lifts what waited on it (#34's
 * stage event, the cancel's); and once automations may run, the start lifts what a stop left. An
 * update a stop kept from the Planner is queued for it, and the Planner's own start hands it over
 * with the rest. It answers where the Freeze writes down what failed after it committed.
 */
export const freezeLayer = (settings: { readonly log: (line: string) => void }) =>
  Layer.effect(
    FreezeLog,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        Database | DomainEvents | Secrets | PlannerWake | AutomationGate | Memory
      >()
      const said = (line: string) => Effect.sync(() => settings.log(`freeze: ${line}`))
      const run = <A, E>(
        effect: Effect.Effect<
          A,
          E,
          Database | DomainEvents | Secrets | PlannerWake | AutomationGate | Memory
        >,
      ) => Effect.provide(effect, context)
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      yield* events.pipe(
        Stream.filter(
          (event) =>
            (event.type === 'mission.moved' && event.payload['to'] === 'done') ||
            event.type === 'mission.cancelled',
        ),
        Stream.runForEach((event) =>
          liftEnded(event.entityId).pipe(
            run,
            Effect.catchCause((cause) =>
              said(`a mission that ended was not followed: ${String(cause)}`),
            ),
          ),
        ),
        Effect.forkScoped,
      )
      yield* Effect.gen(function* () {
        yield* AutomationGate.use((gate) => gate.pass)
        yield* Memory.use((memory) => memory.ready)
        yield* liftEnded(null)
      }).pipe(
        run,
        Effect.catchCause((cause) => said(`the start's lift was not done: ${String(cause)}`)),
        Effect.forkScoped,
      )
      return { said }
    }),
  )
