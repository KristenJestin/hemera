/**
 * The ports the order of decision calls and later tickets fill: the remote judge (Hemera Auto,
 * `hemera-auto.ts`), the grants of "Allow for this mission" (`grants.ts`), the Project's "who
 * commits" rule (B4, R5), the folders of the data folder a mission's sessions may reach (CT-17),
 * and the turns of the agents' sessions, within which a judge's verdict may be reused.
 *
 * Their defaults never allow what they cannot judge: no judge (the call asks), no grant, no agent
 * that commits, and only the mission's own folder.
 */

import { missionKey } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import type { JudgeScores } from '@hemera/core/domain'
import { Context, Effect, Layer } from 'effect'

import { Database } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import type { JudgedCall } from '../tools/ports.ts'

/** How a judge rated a call, as its decision records it. */
export interface Judged {
  /** Who judged, as the settings name it: `Jev`. */
  readonly judge: string
  readonly model: string
  readonly scores: JudgeScores
  /** Asked now, or a verdict of the same turn reused. */
  readonly settled: 'jev' | 'reused'
  /** The round trip to the judge, when it was asked now. */
  readonly roundTripMs: number | null
}

/** What the judge answers: it allows or asks, never refuses; or it could not judge. */
export type JudgeAnswer =
  | { readonly verdict: 'allow' | 'ask'; readonly reason: string; readonly judged?: Judged }
  | {
      readonly verdict: 'unavailable'
      readonly reason: string
      /** Why the judge failed, as a safe category (`http 429`, `timeout`…), when it was asked. */
      readonly failure?: string
      readonly roundTripMs?: number | null
      /** The settings section that would give a judge (`hemera-auto`), when one would. */
      readonly settingsSection?: string
    }

/** Step 5 of the order: the remote judge. */
export class Judge extends Context.Service<
  Judge,
  { readonly judge: (call: JudgedCall) => Effect.Effect<JudgeAnswer> }
>()('Judge') {}

/** No judge: whatever reaches step 5 asks. */
export const noJudge = Layer.succeed(Judge, {
  judge: () => Effect.succeed({ verdict: 'unavailable', reason: 'no judge is set up' }),
})

/**
 * The grants hook, after the refusals and the sensitive places: a live "Allow for this mission"
 * grant of the call's mission for the same action allows it. Its identity is recomputed before
 * each use, and a grant whose identity moved falls rather than allows.
 */
export class MissionGrants extends Context.Service<
  MissionGrants,
  {
    /** The id of the grant that allows the call, counted as used; null when none does. */
    readonly allowing: (call: JudgedCall) => Effect.Effect<string | null>
  }
>()('MissionGrants') {}

/** No grant: nothing is allowed by one. */
export const noMissionGrants = Layer.succeed(MissionGrants, {
  allowing: () => Effect.succeed(null),
})

/** The Project's "who commits" rule, as far as agents are concerned. */
export class CommitRights extends Context.Service<
  CommitRights,
  { readonly agentsCommit: (projectId: string) => Effect.Effect<boolean> }
>()('CommitRights') {}

/** Until the rule exists (open question 26): no agent of a mission commits. */
export const noAgentCommits = Layer.succeed(CommitRights, {
  agentsCommit: () => Effect.succeed(false),
})

/** The keys of the missions whose folders of the data folder a mission's sessions may reach. */
export interface MissionFolders {
  /** The mission's own key: its `missions/<key>/` is its own. */
  readonly own: string | null
  /** The keys of its accepted dependencies: their `missions/<key>/` is read-only to it. */
  readonly dependencies: ReadonlyArray<string>
}

export class MissionPlaces extends Context.Service<
  MissionPlaces,
  { readonly foldersOf: (missionId: string) => Effect.Effect<MissionFolders> }
>()('MissionPlaces') {}

/** The mission's own key from the database; no dependency is accepted yet. */
export const missionPlacesLayer = Layer.effect(
  MissionPlaces,
  Effect.gen(function* () {
    const database = yield* Database
    return {
      foldersOf: (missionId) =>
        database
          .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
          .from(missions)
          .where(eq(missions.id, missionId))
          .pipe(
            Effect.map(([row]) => ({
              own: row === undefined ? null : missionKey(row.prefix, row.number),
              dependencies: [],
            })),
            Effect.orElseSucceed(() => ({ own: null, dependencies: [] })),
          ),
    }
  }),
)

/**
 * The turns of the agents' sessions: each prompt begins one. A verdict of the judge is reused for
 * an identical call within the turn it was given in, never across turns.
 */
export class SessionTurns extends Context.Service<
  SessionTurns,
  {
    readonly begin: (sessionId: string) => Effect.Effect<void>
    /** The session's turn now: 0 before its first. */
    readonly current: (sessionId: string) => Effect.Effect<number>
  }
>()('SessionTurns') {}

export const sessionTurnsLayer = Layer.sync(SessionTurns, () => {
  const turns = new Map<string, number>()
  return {
    begin: (sessionId) =>
      Effect.sync(() => void turns.set(sessionId, (turns.get(sessionId) ?? 0) + 1)),
    current: (sessionId) => Effect.sync(() => turns.get(sessionId) ?? 0),
  }
})
