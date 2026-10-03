/**
 * The domain events: what happened, written with the change that made it happen.
 *
 * An event is provenance, not state. Nothing is rebuilt by replaying it and nothing in it is
 * corrected afterwards. Its sequence is the database's to hand out: two events of the same
 * millisecond still come out in the order they were committed in, and a reader keeps the last
 * sequence it read as a durable cursor.
 */

import { and, asc, eq, gt } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import {
  Database,
  type DatabaseError,
  type EngineTransaction,
  refusedWhile,
} from './storage/database.ts'
import { domainEvents } from './storage/schema.ts'

/** Where an event came from: the user acting, or the application doing its work. */
export const EventSource = Schema.Literals(['ui', 'system'])

/** Who did what an event records. */
export const EventAuthor = Schema.Literals(['human', 'hemera', 'agent', 'mcp', 'system'])

/**
 * What an event says about itself: flat, and made of plain values (a list of names is one of
 * them). A payload is what a reader shows, never a document another part walks.
 */
export const EventPayload = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(Schema.String),
  ]),
)
export type EventPayload = typeof EventPayload.Type

/** An event on its way to the journal, before it has a sequence. */
export const NewEvent = Schema.Struct({
  /** What happened, as a reader names it: `profile.opened`. */
  type: Schema.String,
  entityKind: Schema.String,
  entityId: Schema.String,
  source: EventSource,
  author: EventAuthor,
  payload: Schema.optionalKey(EventPayload),
})
export type NewEvent = typeof NewEvent.Type

/** An event as it was committed. */
export const DomainEvent = Schema.Struct({
  sequence: Schema.Number,
  type: Schema.String,
  entityKind: Schema.String,
  entityId: Schema.String,
  source: EventSource,
  author: EventAuthor,
  occurredAt: Schema.String,
  payload: EventPayload,
})
export type DomainEvent = typeof DomainEvent.Type

/** A cursor that is not a sequence was handed over. */
export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()('InvalidCursor', {
  cursor: Schema.Number,
}) {
  override get message(): string {
    return `${String(this.cursor)} is not a sequence: a cursor is a whole number, zero or more.`
  }
}

/**
 * Writes events inside the transaction of the change they describe, and answers them with their
 * sequence. It takes a transaction and not the database: an event cannot be committed without
 * its change, nor a change without its event.
 */
export function record(
  transaction: EngineTransaction,
  events: ReadonlyArray<NewEvent>,
): Effect.Effect<ReadonlyArray<DomainEvent>, DatabaseError> {
  if (events.length === 0) return Effect.succeed([])
  const occurredAt = new Date().toISOString()
  return transaction
    .insert(domainEvents)
    .values(
      events.map((event) => ({
        type: event.type,
        entityKind: event.entityKind,
        entityId: event.entityId,
        source: event.source,
        author: event.author,
        occurredAt,
        payload: JSON.stringify(event.payload ?? {}),
      })),
    )
    .returning()
    .pipe(
      Effect.map((rows) => rows.map(eventOf)),
      Effect.mapError(refusedWhile('writing the domain events')),
    )
}

const readPayload = Schema.decodeUnknownOption(Schema.fromJsonString(EventPayload))
const readSource = Schema.decodeUnknownOption(EventSource)
const readAuthor = Schema.decodeUnknownOption(EventAuthor)

/**
 * A row, as the event a reader is handed. The columns are text a previous version may have
 * written: a payload this version cannot read is an empty one, a source or an author it does not
 * know is the system's, and the event is still read for its type, date and entity.
 */
function eventOf(row: typeof domainEvents.$inferSelect): DomainEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    entityKind: row.entityKind,
    entityId: row.entityId,
    source: Option.getOrElse(readSource(row.source), () => 'system' as const),
    author: Option.getOrElse(readAuthor(row.author), () => 'system' as const),
    occurredAt: row.occurredAt,
    payload: Option.getOrElse(readPayload(row.payload), () => ({})),
  }
}

/** How many events a page holds when the caller does not say. */
export const PAGE = 100

export interface EventsQuery {
  /** One entity's events only. */
  readonly entity?: { readonly kind: string; readonly id: string }
  /** Strictly after this sequence; absent means from the first. */
  readonly after?: number
  readonly limit?: number
}

export interface EventsPage {
  readonly events: ReadonlyArray<DomainEvent>
  /** The cursor to ask the next page from, or null when there is nothing after this page. */
  readonly next: number | null
}

const checkedCursor = (cursor: number): Effect.Effect<number, InvalidCursor> =>
  Number.isSafeInteger(cursor) && cursor >= 0
    ? Effect.succeed(cursor)
    : Effect.fail(new InvalidCursor({ cursor }))

/**
 * A page of events in sequence order, from a cursor. The cursor is a sequence and never an
 * offset: an offset counts from the start of a list that is being written to, so a page asked by
 * offset repeats or skips the moment anything happens between two pages.
 */
export const readEvents = (
  query: EventsQuery,
): Effect.Effect<EventsPage, DatabaseError | InvalidCursor, Database> =>
  Effect.gen(function* () {
    const after = yield* checkedCursor(query.after ?? 0)
    const limit = query.limit ?? PAGE
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(domainEvents)
      .where(
        and(
          gt(domainEvents.sequence, after),
          query.entity === undefined
            ? undefined
            : and(
                eq(domainEvents.entityKind, query.entity.kind),
                eq(domainEvents.entityId, query.entity.id),
              ),
        ),
      )
      .orderBy(asc(domainEvents.sequence))
      // One more than asked for: that is how the page knows whether there is another.
      .limit(limit + 1)
      .pipe(Effect.mapError(refusedWhile('reading the domain events')))
    const page = rows.slice(0, limit).map(eventOf)
    return { events: page, next: rows.length > limit ? (page.at(-1)?.sequence ?? null) : null }
  })
