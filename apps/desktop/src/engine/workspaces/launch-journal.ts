/**
 * What the Journal says of a launch, and the launches a Rework cancels (D8-16, D8-13).
 *
 * A launch is the entity of its own lines: `launch.requested` when the build was asked for,
 * `launch.cancelled` when a Rework took away the revision it waited on. Both live here, outside
 * the service that starts builds, because a Rework is written in the Spec's own transaction
 * (`specs/revisions.ts`) and that transaction cannot ask the service — the service imports the
 * Spec, so the Spec cannot import the service.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { type NewEvent } from '../journal.ts'
import { failed, now } from '../specs/snapshot.ts'
import { type EngineTransaction } from '../storage/database.ts'
import { buildLaunches } from '../storage/schema.ts'

/** What a Rework says of the launches it cancels: the revision they waited for is gone (D8-13). */
const REWORKED = 'reworked'

/** What the Journal says of a launch: the entity is the launch itself (D8-16). */
export function launchEvent(
  launch: { readonly id: string; readonly specId: string; readonly revisionId: string },
  projectId: string,
  type: string,
  payload: Record<string, string | null>,
  author: 'human' | 'hemera',
): NewEvent {
  return {
    type,
    entityKind: 'launch',
    entityId: launch.id,
    source: author === 'human' ? 'ui' : 'system',
    author,
    projectId,
    payload: { specId: launch.specId, revisionId: launch.revisionId, ...payload },
  }
}

/**
 * The launches a Rework cancels (D8-13): every launch of the Spec that has not started — the one
 * still `waiting` for its environment, and the one whose agent failed — becomes `cancelled`,
 * saying `reworked`, in the very transaction the Rework is written in. Nothing of the Workspace
 * is touched: its worktrees and its steps are exactly what they were, and the new revision has to
 * reach `ready` and be launched by hand.
 */
export function cancelForRework(
  transaction: EngineTransaction,
  spec: { readonly id: string; readonly projectId: string },
) {
  return Effect.gen(function* () {
    const pending = yield* transaction
      .select()
      .from(buildLaunches)
      .where(
        and(eq(buildLaunches.specId, spec.id), inArray(buildLaunches.state, ['waiting', 'failed'])),
      )
      .pipe(Effect.mapError(failed('reading the launches a Rework cancels')))
    if (pending.length === 0) return []
    const at = now()
    yield* transaction
      .update(buildLaunches)
      .set({ state: 'cancelled', detail: REWORKED, updatedAt: at })
      .where(
        inArray(
          buildLaunches.id,
          pending.map((row) => row.id),
        ),
      )
      .pipe(Effect.mapError(failed('cancelling the launches of the Spec')))
    return pending.map((row) =>
      launchEvent(
        { id: row.id, specId: row.specId, revisionId: row.revisionId },
        spec.projectId,
        'launch.cancelled',
        { reason: REWORKED },
        'human',
      ),
    )
  })
}
