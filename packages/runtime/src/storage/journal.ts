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
  const write = database.transaction(() => {
    const result = mutate()
    if (result instanceof Promise) throw new ExternalEffectInTransactionError()

    database.run(
      `INSERT INTO domain_events
        (type, entity, entity_id, source, author, occurred_at, project_id, session_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.type,
        event.entity,
        event.entityId,
        event.source,
        event.author,
        event.occurredAt,
        event.projectId ?? null,
        event.sessionId ?? null,
        event.payload === undefined ? null : JSON.stringify(event.payload),
      ],
    )
    const sequence = (
      database.query('SELECT last_insert_rowid() AS sequence').get() as { sequence: number }
    ).sequence
    return { result, sequence }
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

interface EventRow {
  sequence: number
  type: string
  entity: string
  entity_id: string
  source: string
  author: string
  occurred_at: number
  project_id: string | null
  session_id: string | null
  spec_id: string | null
  revision_id: string | null
  phase_id: string | null
  payload: string | null
}

function toEvent(row: EventRow): RecordedEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    entity: row.entity,
    entityId: row.entity_id,
    source: row.source as EventSource,
    author: row.author as EventAuthor,
    occurredAt: row.occurred_at,
    projectId: row.project_id,
    sessionId: row.session_id,
    specId: row.spec_id,
    revisionId: row.revision_id,
    phaseId: row.phase_id,
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
  const conditions: string[] = []
  const parameters: (string | number)[] = []

  if (query.projectId != null) {
    conditions.push('project_id = ?')
    parameters.push(query.projectId)
  }
  if (query.sessionId != null) {
    conditions.push('session_id = ?')
    parameters.push(query.sessionId)
  }
  if (cursor !== null) {
    conditions.push('sequence > ?')
    parameters.push(cursor)
  }

  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
  // One row past the page tells whether another page follows, without counting the whole table.
  const rows = database
    .query(`SELECT * FROM domain_events ${where} ORDER BY sequence LIMIT ?`)
    .all(...parameters, limit + 1) as EventRow[]

  const events = rows.slice(0, limit).map(toEvent)
  const nextCursor =
    rows.length > limit && events.length > 0 ? events[events.length - 1]!.sequence : null
  return { events, nextCursor }
}

/** The highest sequence written so far, or 0 when the journal is empty. */
export function lastSequence(database: Database): number {
  const row = database.query('SELECT MAX(sequence) AS sequence FROM domain_events').get() as {
    sequence: number | null
  }
  return row.sequence ?? 0
}
