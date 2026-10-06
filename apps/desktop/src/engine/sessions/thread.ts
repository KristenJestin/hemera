/**
 * A session's hidden thread: what it was sent, what it said, the tools it called, the notes it
 * received and its changes of state, in order and masked. It is kept for diagnosis only, in the
 * diagnostic retention class, and read over RPC; nobody writes to a mission's session through it.
 */

import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { sessionThreads } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** What a line of the thread records. */
export type ThreadKind = 'instructions' | 'sent' | 'said' | 'tool' | 'note' | 'state'

export interface ThreadLine {
  readonly at: string
  readonly kind: ThreadKind
  readonly text: string
}

const KINDS: ReadonlyArray<ThreadKind> = ['instructions', 'sent', 'said', 'tool', 'note', 'state']

/** Adds a line to a session's thread, masked. */
export const addToThread = (sessionId: string, kind: ThreadKind, text: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    yield* mutate('writing a session’s thread', (transaction) =>
      transaction
        .insert(sessionThreads)
        .values({ sessionId, at: new Date().toISOString(), kind, text: secrets.mask(text) })
        .pipe(
          Effect.mapError(refusedWhile('writing a session’s thread')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
  })

/** A session's thread, oldest first. */
export const threadOf = (sessionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(sessionThreads)
      .where(eq(sessionThreads.sessionId, sessionId))
      .orderBy(asc(sessionThreads.id))
      .pipe(Effect.mapError(refusedWhile('reading a session’s thread')))
    return rows.map((row): ThreadLine => ({
      at: row.at,
      kind: KINDS.find((kind) => kind === row.kind) ?? 'state',
      text: row.text,
    }))
  })

/** The instructions a session was started with, as its thread kept them, or null. */
export const instructionsKept = (sessionId: string) =>
  Effect.map(
    threadOf(sessionId),
    (lines) => lines.find((line) => line.kind === 'instructions')?.text ?? null,
  )
