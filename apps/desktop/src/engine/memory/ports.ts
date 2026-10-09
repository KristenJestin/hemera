/**
 * The ports of the Memory that later tickets fill: the sessions' epochs and the sub-agents running
 * (the role sessions, #40), and the missions a mission depends on (Planning, #92). Their defaults
 * know of no replacement and no sub-agent; the dependencies are those the database holds.
 */

import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { missionDependencies } from '../storage/schema.ts'

/**
 * Whether the epoch a session's write carries is still the session's current one (CT-11): a
 * replaced or ended session writes nothing more.
 */
export class SessionEpochs extends Context.Service<
  SessionEpochs,
  {
    /** The epoch a session holds now: what its token is minted with. */
    readonly current: (sessionId: string) => Effect.Effect<number>
    readonly isCurrent: (sessionId: string, epoch: number) => Effect.Effect<boolean>
  }
>()('SessionEpochs') {}

/** Epochs kept in memory: every session at its first epoch until it is replaced or ended. */
export interface EpochsInMemory {
  readonly layer: Layer.Layer<SessionEpochs>
  /** A new epoch for the session: its earlier one is stale. */
  readonly replace: (sessionId: string) => number
  /** The session ended: no epoch of it is current any more. */
  readonly end: (sessionId: string) => void
}

export function epochsInMemory(): EpochsInMemory {
  const epochs = new Map<string, number>()
  const ended = new Set<string>()
  return {
    layer: Layer.succeed(SessionEpochs, {
      current: (sessionId) => Effect.sync(() => epochs.get(sessionId) ?? 0),
      isCurrent: (sessionId, epoch) =>
        Effect.sync(() => !ended.has(sessionId) && (epochs.get(sessionId) ?? 0) === epoch),
    }),
    replace: (sessionId) => {
      const next = (epochs.get(sessionId) ?? 0) + 1
      epochs.set(sessionId, next)
      return next
    },
    end: (sessionId) => {
      ended.add(sessionId)
    },
  }
}

/** A sub-agent running for a mission. */
export interface RunningSession {
  readonly sessionId: string
  readonly role: string
}

/** The sub-agents running for a mission now; #40 fills it. */
export class RunningSessions extends Context.Service<
  RunningSessions,
  (missionId: string) => Effect.Effect<ReadonlyArray<RunningSession>>
>()('RunningSessions') {}

export const noRunningSessions = Layer.succeed(RunningSessions, () => Effect.succeed([]))

/** What a Hemera phase of the mission waiting for a slot of the cap says, or null (#41). */
export class SlotWaits extends Context.Service<
  SlotWaits,
  (missionId: string) => Effect.Effect<string | null>
>()('SlotWaits') {}

export const noSlotWaits = Layer.succeed(SlotWaits, () => Effect.succeed(null))

/** The missions a mission depends on, accepted dependencies only, by identifier (#92). */
export class MissionDependencies extends Context.Service<
  MissionDependencies,
  (missionId: string) => Effect.Effect<ReadonlyArray<string>>
>()('MissionDependencies') {}

/** The accepted dependencies the database holds (#92): what the user accepted, and only that. */
export const acceptedDependencies = Layer.effect(
  MissionDependencies,
  Effect.map(
    Effect.context<Database>(),
    (context) => (missionId: string) =>
      Effect.gen(function* () {
        const database = yield* Database
        const rows = yield* database
          .select({ on: missionDependencies.dependsOn })
          .from(missionDependencies)
          .where(
            and(
              eq(missionDependencies.missionId, missionId),
              eq(missionDependencies.state, 'accepted'),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the dependencies')))
        return rows.map((row) => row.on)
      }).pipe(
        Effect.provide(context),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
      ),
  ),
)
