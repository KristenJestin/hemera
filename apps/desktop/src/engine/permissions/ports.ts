/**
 * The ports the order of decision calls and later tickets fill: the remote judge (#38), the
 * grants of "Allow for this mission" (`grants.ts`), the Project's "who commits" rule (B4, R5), and the
 * folders of the data folder a mission's sessions may reach (CT-17).
 *
 * Their defaults never allow what they cannot judge: no judge (the call asks), no grant, no agent
 * that commits, and only the mission's own folder.
 */

import { missionKey } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database } from '../storage/database.ts'
import { missions } from '../storage/schema.ts'
import type { JudgedCall } from '../tools/ports.ts'

/** What the judge answers: it allows or asks, never refuses; or it could not judge. */
export type JudgeAnswer =
  | { readonly verdict: 'allow' | 'ask'; readonly reason: string }
  | { readonly verdict: 'unavailable'; readonly reason: string }

/** Step 5 of the order: the remote judge. */
export class Judge extends Context.Service<
  Judge,
  { readonly judge: (call: JudgedCall) => Effect.Effect<JudgeAnswer> }
>()('Judge') {}

/** Until #38: there is no judge, so whatever reaches step 5 asks. */
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
