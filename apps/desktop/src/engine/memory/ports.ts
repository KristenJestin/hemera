/**
 * The ports of the Memory that later tickets fill: the sessions' epochs and the sub-agents running
 * (the role sessions, #40), and the missions a mission depends on (Planning, P9). Their defaults
 * know of no replacement, no sub-agent and no dependency.
 */

import { Context, Effect, Layer } from 'effect'

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

/** The missions a mission depends on, accepted dependencies only, by identifier; P9 fills it. */
export class MissionDependencies extends Context.Service<
  MissionDependencies,
  (missionId: string) => Effect.Effect<ReadonlyArray<string>>
>()('MissionDependencies') {}

export const noDependencies = Layer.succeed(MissionDependencies, () => Effect.succeed([]))
