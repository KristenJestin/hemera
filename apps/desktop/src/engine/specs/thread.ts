/**
 * The entries a Spec step writes into a Session's thread (design D7-01, D7-03).
 *
 * A question of a Spec is asked in the chat and answered there: the question is a `hemera` entry
 * of kind `spec_question`, the answer a `user` entry of kind `spec_answer` beside it, both
 * carrying the question's id as their `correlation_id`. They are written in the transaction of
 * the step that raises or answers the question, with the Journal line the Sessions write for any
 * entry, and the window hears of them once it has committed.
 */

import type { SessionEntryKind, SessionEntryRole } from '@hemera/core'
import { and, desc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { type SessionEntry, entryOf, UnknownSessionError } from '../sessions.ts'
import type { EngineTransaction } from '../storage/database.ts'
import { sessionEntries, sessions } from '../storage/schema.ts'
import { failed, now } from './snapshot.ts'

/** One entry of a thread, as a Spec step writes it. */
export interface SpecEntry {
  role: SessionEntryRole
  kind: SessionEntryKind
  body: string
  /** JSON text, the shape the block drawing this kind parses. */
  payload: string
  /** The question the entry is about. */
  correlationId: string
}

/** Appends an entry at the end of a Session's thread, and the Journal line that says so. */
export function appendEntry(transaction: EngineTransaction, sessionId: string, write: SpecEntry) {
  return Effect.gen(function* () {
    const found = yield* transaction
      .select({ projectId: sessions.projectId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('reading the Session')))
    const session = found[0]
    if (session === undefined) return yield* Effect.fail(new UnknownSessionError(sessionId))
    const highest = yield* transaction
      .select({ seq: sessionEntries.seq })
      .from(sessionEntries)
      .where(eq(sessionEntries.sessionId, sessionId))
      .orderBy(desc(sessionEntries.seq))
      .limit(1)
      .pipe(Effect.mapError(failed('reading the thread')))
    const seq = (highest.at(0)?.seq ?? 0) + 1
    const at = now()
    const rows = yield* transaction
      .insert(sessionEntries)
      .values({ id: crypto.randomUUID(), sessionId, seq, ...write, createdAt: at })
      .returning()
      .pipe(Effect.mapError(failed('writing the entry')))
    // The Session was worked on; what it is has not changed, so its version stays.
    yield* transaction
      .update(sessions)
      .set({ lastWrittenAt: at })
      .where(eq(sessions.id, sessionId))
      .pipe(Effect.mapError(failed('writing the Session')))
    const row = rows[0]
    if (row === undefined) return yield* Effect.die('an inserted entry that reads back as nothing')
    const event: NewEvent = {
      type: 'session.entry_written',
      entityKind: 'session',
      entityId: sessionId,
      source: 'system',
      author: write.role === 'user' ? 'human' : 'hemera',
      projectId: session.projectId,
      sessionId,
      payload: { seq, kind: write.kind, role: write.role, state: null },
    }
    return { entry: entryOf(row), event }
  })
}

/** The Session a question was asked in, from its `spec_question` entry; null when none was. */
export function askedIn(transaction: EngineTransaction, questionId: string) {
  return transaction
    .select({ sessionId: sessionEntries.sessionId })
    .from(sessionEntries)
    .where(
      and(eq(sessionEntries.kind, 'spec_question'), eq(sessionEntries.correlationId, questionId)),
    )
    .limit(1)
    .pipe(
      Effect.mapError(failed('reading the thread')),
      Effect.map((rows) => rows[0]?.sessionId ?? null),
    )
}

/** What a Spec step wrote into threads, for the window to hear once it has committed. */
export interface Written {
  sessionId: string
  entry: SessionEntry
}
