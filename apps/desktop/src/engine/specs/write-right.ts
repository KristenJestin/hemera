/**
 * One writer Session per Spec, and the right moved by a human (design D7-07, D7-11).
 *
 * A Session becomes `define` in two ways only. A `free` Session whose agent proposed a Spec, the
 * proposal accepted by the human: the Spec is created, the Session becomes its writer and turns
 * `define` in the same transaction. Or a new Session opened on an existing Spec from a list of
 * Specs: it writes when the Spec has no writer, and reads otherwise. "Take the write right" moves
 * `writer_session_id` at once; the previous writer's next agent write is refused by `writable`,
 * which names the new writer.
 */

import { type AgentProvider, NEW_SESSION_TITLE, type SpecSnapshot } from '@hemera/core'
import { eq, sql } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { UnknownSessionError, sessionOf } from '../sessions.ts'
import type { EngineTransaction } from '../storage/database.ts'
import { sessions, specs } from '../storage/schema.ts'
import { failed, now, specEvent } from './snapshot.ts'

/** A Session that may not create a Spec or take its write right (D7-07). */
export class SpecAnchorRefusedError extends Data.TaggedError('SpecAnchorRefusedError')<{
  readonly reason: string
}> {
  override get message(): string {
    return this.reason
  }
}

/** The Session a Spec use case names, or the refusal naming the identifier. */
export function sessionRow(transaction: EngineTransaction, sessionId: string) {
  return Effect.gen(function* () {
    const found = yield* transaction
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('reading the Session')))
    const row = found[0]
    if (row === undefined) return yield* Effect.fail(new UnknownSessionError(sessionId))
    return row
  })
}

/** The Session as the domain reads it, after a step changed it. */
export function sessionNow(transaction: EngineTransaction, sessionId: string) {
  return sessionRow(transaction, sessionId).pipe(Effect.map(sessionOf))
}

/**
 * A Session a Spec may be created from (D7-07): a `free` one. A Session that already defines a
 * Spec never changes it, and never goes back.
 */
export function definable(transaction: EngineTransaction, sessionId: string) {
  return Effect.gen(function* () {
    const session = yield* sessionRow(transaction, sessionId)
    if (session.mission !== 'free') {
      return yield* Effect.fail(
        new SpecAnchorRefusedError({
          reason:
            session.mission === 'define'
              ? `The Session "${session.title}" already defines a Spec.`
              : `The Session "${session.title}" is ${session.mission}: only a free Session creates a Spec.`,
        }),
      )
    }
    return session
  })
}

/**
 * Switches a `free` Session to `define` on a Spec (D7-07), in the transaction that created the
 * Spec. It is a change to what the Session is, so its version moves.
 */
export function define(transaction: EngineTransaction, sessionId: string, specId: string) {
  return transaction
    .update(sessions)
    .set({ mission: 'define', specId, version: sql`${sessions.version} + 1` })
    .where(eq(sessions.id, sessionId))
    .pipe(Effect.mapError(failed('switching the Session to define')))
}

/** Makes a Session the writer of a Spec (D7-11). */
export function giveWriteRight(transaction: EngineTransaction, specId: string, sessionId: string) {
  return transaction
    .update(specs)
    .set({ writerSessionId: sessionId, updatedAt: now() })
    .where(eq(specs.id, specId))
    .pipe(Effect.mapError(failed('moving the write right')))
}

/**
 * A new `define` Session on a Spec, from a list of Specs (D7-07, D7-11): of the Spec's Project,
 * with the agent chosen for it, the writer when the Spec has none and a reader otherwise.
 */
export function openSessionIn(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  provider: AgentProvider,
) {
  return Effect.gen(function* () {
    const { spec } = snapshot
    const sessionId = crypto.randomUUID()
    const at = now()
    yield* transaction
      .insert(sessions)
      .values({
        id: sessionId,
        projectId: spec.projectId,
        title: NEW_SESSION_TITLE,
        titleSource: 'derived',
        provider,
        mission: 'define',
        specId: spec.id,
        createdAt: at,
        lastWrittenAt: at,
      })
      .pipe(Effect.mapError(failed('writing the Session')))
    const writer = spec.writerSessionId === null
    if (writer) yield* giveWriteRight(transaction, spec.id, sessionId)
    const events: NewEvent[] = [
      {
        type: 'session.created',
        entityKind: 'session',
        entityId: sessionId,
        source: 'ui',
        author: 'human',
        projectId: spec.projectId,
        sessionId,
        payload: { title: NEW_SESSION_TITLE, mission: 'define', specId: spec.id },
      },
      specEvent(spec, snapshot.revision.id, 'spec.joined', {
        author: 'human',
        sessionId,
        payload: { writer },
      }),
    ]
    return { sessionId, events }
  })
}

/**
 * "Take the write right" (D7-11): a human action, effective at once, for a Session on this
 * Spec. The previous writer is named in the Journal.
 */
export function transferWrite(
  transaction: EngineTransaction,
  snapshot: SpecSnapshot,
  sessionId: string,
) {
  return Effect.gen(function* () {
    const { spec } = snapshot
    const session = yield* sessionRow(transaction, sessionId)
    if (session.specId !== spec.id) {
      return yield* Effect.fail(
        new SpecAnchorRefusedError({
          reason: `The Session "${session.title}" is not on ${spec.key}: it cannot take its write right.`,
        }),
      )
    }
    if (spec.writerSessionId === sessionId) return []
    yield* giveWriteRight(transaction, spec.id, sessionId)
    return [
      specEvent(spec, snapshot.revision.id, 'spec.write_right_transferred', {
        author: 'human',
        sessionId,
        payload: { from: spec.writerSessionId, to: sessionId },
      }),
    ]
  })
}
