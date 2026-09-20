/**
 * The journal: what happened, written with the change that made it happen (design D4-04, D4-05).
 *
 * An event is provenance and not state. Nothing is ever rebuilt by replaying the journal — the
 * domain tables are what the application reads — and nothing here is corrected afterwards: the
 * one column an event ever gains is the date it was seen on.
 *
 * What an event is correlated to is a column, never something to be dug out of its payload: a
 * journal read by project finds its rows through an index, without opening a single JSON
 * document. The correlations of the Session, the Spec, the revision and the phase were declared
 * with the rest a lot before anything filled them, because a column that exists costs nothing
 * and a column added later costs a migration; the Session's is written from lot 4b on.
 */

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { z } from 'zod'

import { Database, DatabaseError, type EngineTransaction } from './storage/database.ts'
import {
  type ENTITY_KINDS,
  type EVENT_AUTHORS,
  type EVENT_SOURCES,
  domainEvents,
} from './storage/schema.ts'

export type EntityKind = (typeof ENTITY_KINDS)[number]
export type EventSource = (typeof EVENT_SOURCES)[number]
export type EventAuthor = (typeof EVENT_AUTHORS)[number]

/**
 * What an event says about itself, beyond what it is correlated to.
 *
 * Flat and made of values a JSON document holds as they are, because a payload is what a reader
 * shows — the name a project was given, the path that was added — and never a document another
 * part of the application is expected to walk.
 */
export type EventPayload = Record<string, string | number | boolean | null>

/**
 * An event on its way to the journal, before it has a sequence.
 *
 * The sequence is the database's to hand out and never the caller's to choose: two mutations in
 * the same millisecond still come out in the order they were committed in.
 */
export interface NewEvent {
  /** What happened, as the reader names it: `project.created`, `profile.migrated`. */
  type: string
  entityKind: EntityKind
  entityId: string
  source: EventSource
  author: EventAuthor
  /** The project the event belongs to, and null for what belongs to the profile itself. */
  projectId?: string | null
  /**
   * The Session it happened in, and null for everything that happened in none.
   *
   * Written from lot 4b on: `entity_id` already names the Session of a `session.*` event, and
   * this column is what makes a Journal read by Session an index rather than a scan — which is
   * the reason it was declared with the rest a lot before anything filled it.
   */
  sessionId?: string | null
  payload?: EventPayload
}

/**
 * Writes events to the journal, inside the transaction the change itself is being written in.
 *
 * It takes a transaction rather than the database, and that is the whole point: there is no way
 * to call it outside one, so an event cannot be committed without the change it describes, and a
 * change cannot be committed without it.
 */
export function record(
  transaction: EngineTransaction,
  events: readonly NewEvent[],
): Effect.Effect<void, DatabaseError> {
  if (events.length === 0) return Effect.void
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
        // What the user did themselves, they watched happen: a bell counting the Project you
        // have just created among the things you have not seen is a bell nobody believes. Seen
        // at the moment it happened rather than filtered out of the bell afterwards, because
        // that is what is true — and it leaves the Journal itself listing everything.
        seenAt: event.author === 'human' ? occurredAt : null,
        projectId: event.projectId ?? null,
        sessionId: event.sessionId ?? null,
        payload: JSON.stringify(event.payload ?? {}),
      })),
    )
    .pipe(Effect.mapError((cause) => new DatabaseError({ doing: 'writing to the journal', cause })))
}

/** One event, as a reader of the Journal sees it. */
export interface JournalEntry {
  /** The global sequence, which is the cursor and the only stable order there is. */
  sequence: number
  type: string
  entityKind: EntityKind
  entityId: string
  source: EventSource
  author: EventAuthor
  /** When it happened, as the ISO string it was written with. */
  occurredAt: string
  /** The Project it belongs to, and null for what belongs to the profile itself. */
  projectId: string | null
  payload: EventPayload
  /** When the user was shown it, and null for as long as they were not. */
  seenAt: string | null
}

/** What a page of the Journal is asked for. */
export interface JournalQuery {
  /** Whose Journal. Profile events are shown in every Project's, since they are in none. */
  projectId: string
  /** Everything older than this sequence. Absent means from the most recent. */
  before?: number | undefined
  limit?: number | undefined
  kinds?: readonly EntityKind[] | undefined
  authors?: readonly EventAuthor[] | undefined
}

/** A page, and where the next one starts. */
export interface JournalPage {
  entries: JournalEntry[]
  /** The sequence to ask the next page from, or null when there is nothing older. */
  nextBefore: number | null
}

/** What the bell shows: everything unseen, and how many of them each Project has. */
export interface Unseen {
  entries: JournalEntry[]
  byProject: Map<string, number>
}

/** A cursor that cannot be a sequence was handed over. */
export class InvalidCursorError extends Error {
  constructor(readonly cursor: number) {
    super(`"${String(cursor)}" is not a sequence: a cursor is a positive whole number`)
    this.name = 'InvalidCursorError'
  }
}

/** How many entries a page holds when the caller does not say. */
export const PAGE = 50

export class Journal extends Context.Service<
  Journal,
  {
    readonly read: (
      query: JournalQuery,
    ) => Effect.Effect<JournalPage, DatabaseError | InvalidCursorError>
    readonly unseen: Effect.Effect<Unseen, DatabaseError>
    readonly markSeen: (upTo: number) => Effect.Effect<void, DatabaseError | InvalidCursorError>
  }
>()('Journal') {}

/** A row of `domain_events`, as the entry a reader is handed. */
function entryOf(row: typeof domainEvents.$inferSelect): JournalEntry {
  return {
    sequence: row.sequence,
    type: row.type,
    // SAFETY: the column is constrained by a check to exactly the values `EntityKind` lists,
    // and nothing writes it but `record`, which takes that type.
    entityKind: row.entityKind as EntityKind,
    // SAFETY: the same, for the check on `source`.
    source: row.source as EventSource,
    // SAFETY: the same, for the check on `author`.
    author: row.author as EventAuthor,
    entityId: row.entityId,
    occurredAt: row.occurredAt,
    projectId: row.projectId,
    payload: parsed(row.payload),
    seenAt: row.seenAt,
  }
}

/**
 * The shape a payload has to have to be handed on, checked where it comes out of the database.
 *
 * This is an I/O boundary like any other: what is in the column is a string a previous version
 * of this application wrote, and the only thing that makes it a payload is a parser saying so.
 */
const payloadSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))

/**
 * What an event says about itself, or nothing when the column holds something else.
 *
 * A payload written by a version that knew more is not a reason to refuse a page: the entry has
 * a type, a date and an author, which is what the Journal is read for.
 */
function parsed(payload: string): EventPayload {
  try {
    // Straight from the text into the parser, with nothing in between holding the in-between
    // value: what `JSON.parse` hands back is not a payload until the schema says it is.
    const read = payloadSchema.safeParse(JSON.parse(payload))
    return read.success ? read.data : {}
  } catch {
    return {}
  }
}

/** A cursor is a sequence, and a sequence is a positive whole number. */
function checkedCursor(cursor: number | undefined) {
  if (cursor === undefined) return Effect.succeed(undefined)
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return Effect.fail(new InvalidCursorError(cursor))
  }
  return Effect.succeed(cursor)
}

export const journalLayer = Layer.effect(
  Journal,
  Effect.gen(function* () {
    const database = yield* Database
    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    return {
      /**
       * A page of one Project's Journal, newest first, from a cursor.
       *
       * The cursor is the sequence and never an offset: an offset is counted from the start of
       * a list that is being written to from the other end, so a page asked for by offset both
       * repeats and skips entries the moment anything happens between two pages. Strictly
       * older than the cursor is what makes a walk down the Journal exact.
       *
       * Profile events have no Project — they belong to the data folder — and are shown in
       * every Project's Journal, because that is where the user goes looking for them.
       */
      read: (query) =>
        Effect.gen(function* () {
          const before = yield* checkedCursor(query.before)
          const limit = query.limit ?? PAGE
          const rows = yield* database
            .select()
            .from(domainEvents)
            .where(
              and(
                or(
                  eq(domainEvents.projectId, query.projectId),
                  eq(domainEvents.entityKind, 'profile'),
                ),
                before === undefined ? undefined : lt(domainEvents.sequence, before),
                query.kinds === undefined
                  ? undefined
                  : inArray(domainEvents.entityKind, [...query.kinds]),
                query.authors === undefined
                  ? undefined
                  : inArray(domainEvents.author, [...query.authors]),
              ),
            )
            .orderBy(desc(domainEvents.sequence))
            // One more than asked for, which is how the page knows whether there is another
            // without a second query counting what it is not going to show.
            .limit(limit + 1)
            .pipe(Effect.mapError(failed('reading the Journal')))

          const page = rows.slice(0, limit)
          return {
            entries: page.map(entryOf),
            nextBefore: rows.length > limit ? (page.at(-1)?.sequence ?? null) : null,
          }
        }),

      /**
       * Everything nobody has been shown, every Project at once, newest first.
       *
       * Of the Projects only. What the profile does — opening, migrating, backing itself up —
       * is written down because it happened and is read in the Journal, but it is not news: a
       * bell that rang at every start to say the database had been opened would be a bell the
       * user learns to ignore, and then misses the one thing it was for.
       */
      unseen: Effect.gen(function* () {
        const rows = yield* database
          .select()
          .from(domainEvents)
          .where(and(isNull(domainEvents.seenAt), eq(domainEvents.entityKind, 'project')))
          .orderBy(desc(domainEvents.sequence))
          .pipe(Effect.mapError(failed('reading what is unseen')))

        const byProject = new Map<string, number>()
        for (const row of rows) {
          if (row.projectId === null) continue
          byProject.set(row.projectId, (byProject.get(row.projectId) ?? 0) + 1)
        }
        return { entries: rows.map(entryOf), byProject }
      }),

      /**
       * Marks everything up to a sequence as seen, and touches nothing else.
       *
       * `seen_at` is the one column of an event that is ever written twice, and only from null:
       * an entry already seen keeps the date it was seen on, because when a reader first saw
       * something is not a thing a later read gets to change.
       */
      markSeen: (upTo) =>
        Effect.gen(function* () {
          yield* checkedCursor(upTo)
          yield* database
            .update(domainEvents)
            .set({ seenAt: new Date().toISOString() })
            .where(and(isNull(domainEvents.seenAt), sql`${domainEvents.sequence} <= ${upTo}`))
            .pipe(Effect.mapError(failed('marking the Journal as seen')))
        }),
    }
  }),
)
