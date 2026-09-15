/**
 * The journal: business provenance written beside the state it describes.
 *
 * A mutation and its event land in the same transaction, so neither survives the other. The
 * sequence is a global, strictly increasing integer that orders events without relying on the
 * clock, and the correlations product reads use are indexed columns rather than a payload to
 * filter. Nothing outside the database happens inside the transaction: an intention is
 * recorded, the effect is run after, and its outcome is recorded in turn.
 */

import type { Database } from 'bun:sqlite'
import { and, asc, eq, gt, max } from 'drizzle-orm'

import { orm } from './orm.ts'
import { domainEvents } from './schema.ts'

/** Who caused a change. Lot 1 only ever records the user. */
export type EventSource = 'user'

/** Who the change is attributed to. An agent author arrives with lot 2. */
export type EventAuthor = 'human'

export interface JournalEvent {
  type: string
  /** Entity the event is mainly about. */
  entity: string
  entityId: string
  source: EventSource
  author: EventAuthor
  occurredAt: number
  projectId?: string | null
  sessionId?: string | null
  payload?: unknown
}

export interface RecordedEvent extends JournalEvent {
  sequence: number
  projectId: string | null
  sessionId: string | null
  /** Declared for the lots that introduce them; empty here. */
  specId: string | null
  revisionId: string | null
  phaseId: string | null
}

export class ExternalEffectInTransactionError extends Error {
  constructor() {
    super(
      'a mutation recorded with its event must not await anything: no external effect runs ' +
        'inside the transaction',
    )
    this.name = 'ExternalEffectInTransactionError'
  }
}

export class InvalidCursorError extends Error {
  constructor(cursor: unknown) {
    super(`${String(cursor)} is not a journal cursor: a cursor is a sequence already read`)
    this.name = 'InvalidCursorError'
  }
}

export interface Recorded<Result> {
  result: Result
  sequence: number
}

/**
 * Writes a business change and its event together.
 *
 * The mutation runs inside the transaction and must stay synchronous: returning a promise is
 * refused rather than letting an external effect run while the transaction is open.
 */
export function recordChange<Result>(
  database: Database,
  event: JournalEvent,
  mutate: () => Result,
): Recorded<Result> {
  const db = orm(database)
  const write = database.transaction(() => {
    const result = mutate()
    if (result instanceof Promise) throw new ExternalEffectInTransactionError()

    const [written] = db
      .insert(domainEvents)
      .values({
        type: event.type,
        entity: event.entity,
        entityId: event.entityId,
        source: event.source,
        author: event.author,
        occurredAt: event.occurredAt,
        projectId: event.projectId ?? null,
        sessionId: event.sessionId ?? null,
        payload: event.payload === undefined ? null : JSON.stringify(event.payload),
      })
      // The sequence is what orders the journal, so it is read back from the row that was
      // written rather than from the connection's last rowid.
      .returning({ sequence: domainEvents.sequence })
      .all()
    if (written === undefined) throw new Error('the journal event was not written')
    return { result, sequence: written.sequence }
  })
  return write()
}

export interface JournalQuery {
  /** Read the events of one project, of one session, or of neither. */
  projectId?: string | null
  sessionId?: string | null
  /** Last sequence already read; the page starts after it. */
  cursor?: number | null
  /** How many events the page holds at most. */
  limit?: number
}

export interface JournalPage {
  events: RecordedEvent[]
  /** Cursor to pass for the next page, or null when the end was reached. */
  nextCursor: number | null
}

/** Largest page the journal hands out, whatever is asked. */
export const MAX_PAGE_SIZE = 200

/** Page size used when none is asked. */
export const DEFAULT_PAGE_SIZE = 50

type EventRow = typeof domainEvents.$inferSelect

function toEvent(row: EventRow): RecordedEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    entity: row.entity,
    entityId: row.entityId,
    source: row.source as EventSource,
    author: row.author as EventAuthor,
    occurredAt: row.occurredAt,
    projectId: row.projectId,
    sessionId: row.sessionId,
    specId: row.specId,
    revisionId: row.revisionId,
    phaseId: row.phaseId,
    payload: row.payload === null ? undefined : JSON.parse(row.payload),
  }
}

/**
 * Reads one bounded page of the journal, after `cursor`.
 *
 * Events never move once written, so a write during a walk adds to the end and the walk
 * neither repeats nor skips anything already passed.
 */
export function readJournal(database: Database, query: JournalQuery = {}): JournalPage {
  const cursor = query.cursor ?? null
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
    throw new InvalidCursorError(cursor)
  }

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const conditions = [
    query.projectId == null ? undefined : eq(domainEvents.projectId, query.projectId),
    query.sessionId == null ? undefined : eq(domainEvents.sessionId, query.sessionId),
    cursor === null ? undefined : gt(domainEvents.sequence, cursor),
  ].filter((condition) => condition !== undefined)

  // One row past the page tells whether another page follows, without counting the whole table.
  const rows = orm(database)
    .select()
    .from(domainEvents)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(domainEvents.sequence))
    .limit(limit + 1)
    .all()

  const events = rows.slice(0, limit).map(toEvent)
  const nextCursor =
    rows.length > limit && events.length > 0 ? events[events.length - 1]!.sequence : null
  return { events, nextCursor }
}

/** The highest sequence written so far, or 0 when the journal is empty. */
export function lastSequence(database: Database): number {
  const row = orm(database)
    .select({ sequence: max(domainEvents.sequence) })
    .from(domainEvents)
    .get()
  return row?.sequence ?? 0
}
