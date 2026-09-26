/**
 * The ready gate and the human click that freezes a Spec (design D7-10).
 *
 * The gate is `readyGate` of `@hemera/core` on the current snapshot. "Mark ready" is made against
 * the revision and the content version the gate was shown on: a Spec that changed since refuses
 * the click, and a gate that lists anything refuses it too. Nothing here is automatic.
 */

import { type GateFailure, type SpecSnapshot, readyGate, storyFailures } from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import type { EngineTransaction } from '../storage/database.ts'
import { specs } from '../storage/schema.ts'
import { failed, now, specEvent } from './snapshot.ts'

/**
 * A "Mark ready" click refused: obsolete, or on a gate that lists a failure (D7-10); or the
 * agent's `ready` proposal refused on what the stories lack (#143).
 */
export class ReadyRefusedError extends Data.TaggedError('ReadyRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** What the gate shows: the failing checks, and the content version they were read on. */
export interface Gate {
  failures: GateFailure[]
  contentVersion: number
}

export function gateOf(snapshot: SpecSnapshot): Gate {
  return { failures: readyGate(snapshot), contentVersion: snapshot.spec.contentVersion }
}

/**
 * The agent's `ready` proposal is refused as "Mark ready" is on what its stories lack (#143): a
 * feature with no story, or a story with no acceptance criterion, is not attested. The rest of
 * the gate is answered with the attestation, since the attestation is one of its checks.
 */
export function attestable(snapshot: SpecSnapshot) {
  const failures = storyFailures(snapshot)
  return failures.length === 0
    ? Effect.void
    : Effect.fail(
        new ReadyRefusedError({
          reason: `${snapshot.spec.key} cannot be proposed ready: ${failures.map((failure) => failure.message).join('; ')}`,
        }),
      )
}

/** What a "Mark ready" click was shown (D7-10). */
export interface ReadyRequest {
  specId: string
  expectedRevisionId: string
  expectedContentVersion: number
  /** The Session whose panel the click came from (D7-13). */
  sessionId: string
}

/**
 * Freezes a draft as `ready` (D7-03, D7-10): human only, on the revision and content version the
 * gate was shown on, and only when the gate is empty.
 */
export function markReady(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  request: ReadyRequest,
) {
  return Effect.gen(function* () {
    const { spec } = snapshot
    if (
      spec.currentRevisionId !== request.expectedRevisionId ||
      spec.contentVersion !== request.expectedContentVersion
    ) {
      return yield* Effect.fail(
        new ReadyRefusedError({
          reason: `${spec.key} changed since its gate was shown: read the gate again before marking it ready.`,
        }),
      )
    }
    const failures = readyGate(snapshot)
    if (failures.length > 0) {
      return yield* Effect.fail(
        new ReadyRefusedError({
          reason: `${spec.key} does not pass its gate: ${failures.map((failure) => failure.message).join('; ')}.`,
        }),
      )
    }
    yield* transaction
      .update(specs)
      .set({ status: 'ready', updatedAt: now() })
      .where(eq(specs.id, spec.id))
      .pipe(Effect.mapError(failed('freezing the Spec')))
    return [
      specEvent(spec, snapshot.revision.id, 'spec.ready', {
        author: 'human',
        sessionId: request.sessionId,
        payload: { key: spec.key, contentVersion: spec.contentVersion },
      }),
    ]
  })
}
