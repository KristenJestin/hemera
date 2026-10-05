/**
 * The reconciliation of a restored Profile with the world.
 *
 * A restore brings back a Profile as it was when its backup was taken; the world went on. Until
 * every live mission has been read against the world again, no automation resumes: the gate
 * (`gate.ts`) stays closed. The checks themselves belong to the tickets that own each thing; they
 * register their step here, in the order they must run, where the engine is composed.
 *
 * A step runs once per live mission or once for the Profile. It reads the state Hemera recorded
 * and the state the world shows, both among the states it declares in the order the world moves
 * through them, and the runner only ever advances: a recorded state ahead of what the world shows
 * is kept, never moved back. A step that fails keeps the gate closed; it is written in the
 * diagnostic log and in the journal, and the whole reconciliation runs again at the next start.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import type { DomainEvents } from './domain-events.ts'
import type { EventPayload, NewEvent } from './journal.ts'
import { profileRow } from './migrate.ts'
import {
  Database,
  type DatabaseError,
  type SqliteClient,
  refusedWhile,
} from './storage/database.ts'
import { domainEvents } from './storage/schema.ts'
import { mutate } from './transaction.ts'

/** A step could not read or advance what it checks. */
export class ReconciliationFailed extends Schema.TaggedError<ReconciliationFailed>()(
  'ReconciliationFailed',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

/** What a step may stand on: the Profile's database and its events. */
export type StepServices = Database | DomainEvents

export interface ReconciliationStep {
  readonly name: string
  /** Once per live mission, or once for the Profile. */
  readonly per: 'mission' | 'profile'
  /** The states a subject moves through, in the order the world moves through them. */
  readonly states: ReadonlyArray<string>
  /** What Hemera recorded of the subject. */
  readonly recorded: (subject: string) => Effect.Effect<string, ReconciliationFailed, StepServices>
  /** What the world shows of it. */
  readonly observed: (subject: string) => Effect.Effect<string, ReconciliationFailed, StepServices>
  /** Records a state further along than the recorded one. */
  readonly advance: (
    subject: string,
    to: string,
  ) => Effect.Effect<void, ReconciliationFailed, StepServices>
}

/** The steps, in the order they run. */
export class ReconciliationSteps extends Context.Service<
  ReconciliationSteps,
  ReadonlyArray<ReconciliationStep>
>()('ReconciliationSteps') {}

export const reconciliationStepsLayer = (steps: ReadonlyArray<ReconciliationStep>) =>
  Layer.succeed(ReconciliationSteps, steps)

/** The missions still live in the Profile; none until missions exist. */
export class LiveMissions extends Context.Service<
  LiveMissions,
  Effect.Effect<ReadonlyArray<string>, DatabaseError>
>()('LiveMissions') {}

export const noLiveMissions = Layer.succeed(LiveMissions, Effect.succeed([]))

/**
 * The line each mission's Journal gets once its Profile is reconciled: "restored from the backup
 * of <date>". Until the Journal exists, it writes nothing.
 */
export class RestoreJournal extends Context.Service<
  RestoreJournal,
  { readonly restored: (mission: string, takenAt: string) => Effect.Effect<void, DatabaseError> }
>()('RestoreJournal') {}

export const noRestoreJournal = Layer.succeed(RestoreJournal, { restored: () => Effect.void })

const PROFILE = 'profile'

const profileEvent = (type: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: PROFILE,
  entityId: PROFILE,
  source: 'system',
  author: 'hemera',
  payload,
})

/** Writes down one of the restore's events, with nothing else. */
export const recordProfileEvent = (type: string, payload: EventPayload) =>
  mutate(`writing down ${type}`, () =>
    Effect.succeed({ result: null, events: [profileEvent(type, payload)] }),
  )

const readRestored = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ takenAt: Schema.String })),
)

/** The restore still waiting for its reconciliation: when its backup was taken, or none. */
export const pendingRestore = Effect.gen(function* () {
  const database = yield* Database
  const [last] = yield* database
    .select()
    .from(domainEvents)
    .where(
      and(
        eq(domainEvents.entityKind, PROFILE),
        inArray(domainEvents.type, ['profile.restored', 'profile.reconciled']),
      ),
    )
    .orderBy(desc(domainEvents.sequence))
    .limit(1)
    .pipe(Effect.mapError(refusedWhile('reading the restore record')))
  if (last?.type !== 'profile.restored') return null
  return Option.match(readRestored(last.payload), {
    onNone: () => '',
    onSome: ({ takenAt }) => takenAt,
  })
})

/** Runs one step on one subject; answers whether it advanced the subject. */
const runStep = (step: ReconciliationStep, subject: string, log: Log) =>
  Effect.gen(function* () {
    const rankOf = (state: string) =>
      step.states.includes(state)
        ? Effect.succeed(step.states.indexOf(state))
        : Effect.fail(new ReconciliationFailed({ reason: `${step.name}: no state ${state}` }))
    const recorded = yield* step.recorded(subject)
    const observed = yield* step.observed(subject)
    const from = yield* rankOf(recorded)
    const to = yield* rankOf(observed)
    if (to < from) {
      log(
        `reconciliation: ${step.name} kept ${subject} at ${recorded}; the world shows ${observed}`,
      )
      return false
    }
    if (to === from) return false
    yield* step.advance(subject, observed)
    log(`reconciliation: ${step.name} advanced ${subject} from ${recorded} to ${observed}`)
    return true
  })

/**
 * Reconciles the Profile with the world, step after step in their order, and records the end:
 * `profile.reconciled` with the missions it advanced. Fails, after recording the failure, with
 * the first step that failed.
 */
export const reconcile = (
  takenAt: string,
  log: Log,
): Effect.Effect<
  ReadonlyArray<string>,
  ReconciliationFailed | DatabaseError,
  Database | SqliteClient | DomainEvents | ReconciliationSteps | LiveMissions | RestoreJournal
> =>
  Effect.gen(function* () {
    const steps = yield* ReconciliationSteps
    const missions = yield* yield* LiveMissions
    const profile = (yield* profileRow)?.id ?? PROFILE
    const advanced = new Set<string>()
    for (const step of steps) {
      const subjects = step.per === 'mission' ? missions : [profile]
      for (const subject of subjects) {
        const moved = yield* runStep(step, subject, log).pipe(
          Effect.mapError(
            (failure) => new ReconciliationFailed({ reason: `${step.name}: ${failure.message}` }),
          ),
        )
        if (moved && step.per === 'mission') advanced.add(subject)
      }
    }
    const journal = yield* RestoreJournal
    yield* Effect.forEach(missions, (mission) => journal.restored(mission, takenAt), {
      discard: true,
    })
    yield* recordProfileEvent('profile.reconciled', { missions: [...advanced] })
    log(`reconciliation: finished, ${String(advanced.size)} missions advanced`)
    return [...advanced]
  }).pipe(
    Effect.tapError((failure) =>
      Effect.gen(function* () {
        log(`reconciliation: failed: ${failure.message}`)
        yield* recordProfileEvent('profile.reconciliation_failed', { reason: failure.message })
      }).pipe(Effect.ignore),
    ),
  )
