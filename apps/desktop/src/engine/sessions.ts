/**
 * The Sessions of a Project: the thread the user writes, and nothing else answers it (D4b-02).
 *
 * A Session belongs to a Project and to nothing more — no Spec, no Workspace — and archiving is
 * the only way one ends. There is no `delete` here and there is no use case that could be made
 * to: the absence is the guarantee (design D4b-06).
 *
 * Every change goes through `mutate`, so the entry, the title it may have proposed, the date the
 * Session was last written and the event that says so are one transaction. That is the whole of
 * D4b-02: the renderer shows `Saved` when this returns, and a write that failed wrote nothing.
 *
 * The title is proposed here and not in the renderer, because the rule that derives it is one
 * rule (D4b-03). `title_source` is what makes a proposal and a choice different things: a title
 * the user typed is never proposed over, and nothing has to remember not to.
 */

import {
  type Session as DomainSession,
  type SessionEntry as DomainSessionEntry,
  type SessionTitleSource,
  EmptyMessageError,
  EmptyTitleError,
  NEW_SESSION_TITLE,
  NoActiveProjectError,
  messageBody,
  sessionTitle,
  titleAfterMessage,
} from '@hemera/core'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { InvalidCursorError, PAGE } from './journal.ts'
import { UnknownProjectError } from './projects.ts'
import { Database, DatabaseError } from './storage/database.ts'
import { projects, sessionEntries, sessions } from './storage/schema.ts'
import { type Mutation, StaleVersionError, mutate } from './transaction.ts'

/** The domain's own Session, read back out: it carries no path and loads nothing beside it. */
export type Session = DomainSession

export type SessionEntry = DomainSessionEntry

/** A Session was asked for by an identifier nothing answers to. */
export class UnknownSessionError extends Error {
  constructor(readonly id: string) {
    super(`no Session has the identifier "${id}"`)
    this.name = 'UnknownSessionError'
  }
}

/** One page of a thread, and where the one before it starts (design D4b-05). */
export interface ThreadPage {
  /** The entries, oldest first: a page is read the way the thread is read. */
  entries: SessionEntry[]
  /** The `seq` to ask the page before this one from, or null when there is nothing older. */
  nextBefore: number | null
}

/** What one message answers: the entry that was written, and the Session it may have renamed. */
export interface Written {
  session: Session
  entry: SessionEntry
}

/**
 * Everything that can be done to a Session, and nothing that cannot (design D4b-01, D4b-06).
 *
 * `list` answers the current Sessions of a Project, or its archived ones, most recently written
 * first (D4b-04): the thread recently worked on is the one being looked for. A rename counts as
 * a write, because a Session renamed a minute ago is a Session the user is working on.
 *
 * `create` takes the Project it is for, and takes it as something that may be missing: a session
 * belongs to a project, and being asked for one without a project is a refusal the interface can
 * show rather than a crash or a Project created quietly to have somewhere to put it.
 */
export interface SessionsService {
  readonly list: (
    projectId: string,
    archived?: boolean | undefined,
  ) => Effect.Effect<Session[], DatabaseError>
  readonly create: (
    projectId: string | null,
  ) => Effect.Effect<Session, DatabaseError | NoActiveProjectError | UnknownProjectError>
  readonly rename: (id: string, version: number, title: string) => Effect.Effect<Session, Refusal>
  readonly archive: (id: string, version: number) => Effect.Effect<Session, Refusal>
  readonly restore: (id: string, version: number) => Effect.Effect<Session, Refusal>
  /**
   * Writes one message into a Session.
   *
   * No version is taken: two windows appending to the same thread both mean it, and the order
   * they end up in is the order of their `seq`, which is handed out inside the transaction. The
   * version is what a change to what the Session *is* is refused against — its name, its
   * archived state — and not what is written into it.
   */
  readonly append: (id: string, body: string) => Effect.Effect<Written, Refusal | EmptyMessageError>
  readonly read: (
    id: string,
    before?: number | undefined,
    limit?: number | undefined,
  ) => Effect.Effect<ThreadPage, Refusal | InvalidCursorError>
}

export class Sessions extends Context.Service<Sessions, SessionsService>()('Sessions') {}

/** What any change to an existing Session can be refused with. */
type Refusal =
  | DatabaseError
  | StaleVersionError
  | UnknownSessionError
  | EmptyTitleError
  | InvalidCursorError

/** The date every row of one mutation shares, so an entry and its event agree on when. */
function now(): string {
  return new Date().toISOString()
}

/**
 * What the domain refuses, as something a caller can be told about.
 *
 * `core` is pure TypeScript and says no by throwing; thrown inside a transaction that is a
 * defect, and a defect takes the process down instead of being answered. Every call into the
 * domain comes through one of these, so a refusal is a value the use case declares and the
 * interface can show — the same shape `projects.ts` gives its own.
 */
function titled(candidate: string) {
  return Effect.try({
    try: () => sessionTitle(candidate),
    catch: (cause) => (cause instanceof EmptyTitleError ? cause : new EmptyTitleError()),
  })
}

function written(candidate: string) {
  return Effect.try({
    try: () => messageBody(candidate),
    catch: (cause) => (cause instanceof EmptyMessageError ? cause : new EmptyMessageError()),
  })
}

/** A row of `sessions`, as the domain's own Session. */
function sessionOf(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    // SAFETY: the column is constrained by a check to exactly the sources the domain declares,
    // and nothing writes it but this service, which writes one of the two.
    titleSource: row.titleSource as SessionTitleSource,
    // This lot writes one kind of Session; a mission is what HEM-48 gives a Session here.
    mission: 'free',
    archivedAt: row.archivedAt === null ? null : Date.parse(row.archivedAt),
    createdAt: Date.parse(row.createdAt),
    lastWrittenAt: Date.parse(row.lastWrittenAt),
    version: row.version,
  }
}

/** A row of `session_entries`, as the domain's own entry. */
function entryOf(row: typeof sessionEntries.$inferSelect): SessionEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    // SAFETY: the same, for the check on `role`: the user's is the only value it admits.
    role: 'user',
    body: row.body,
    createdAt: Date.parse(row.createdAt),
  }
}

/** A cursor is a `seq`, and a `seq` counts from one. */
function checkedCursor(cursor: number | undefined) {
  if (cursor === undefined) return Effect.succeed(undefined)
  if (!Number.isSafeInteger(cursor) || cursor < 1) {
    return Effect.fail(new InvalidCursorError(cursor))
  }
  return Effect.succeed(cursor)
}

export const sessionsLayer = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const database = yield* Database

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The one Session a change was about, read inside the transaction that is changing it. */
    const readOne = (transaction: Parameters<Parameters<typeof mutate>[1]>[0], id: string) =>
      Effect.gen(function* () {
        const found = yield* transaction
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .pipe(Effect.mapError(failed('reading the Session')))
        const row = found[0]
        if (row === undefined) return yield* Effect.fail(new UnknownSessionError(id))
        return sessionOf(row)
      })

    /**
     * Takes a Session to its next version, and refuses a caller working from an older one.
     *
     * The comparison is the write: `WHERE id = ? AND version = ?` either changes a row or does
     * not, and there is no window between reading the version and acting on it.
     */
    const bump = (
      transaction: Parameters<Parameters<typeof mutate>[1]>[0],
      id: string,
      version: number,
      change: Partial<{
        title: string
        titleSource: SessionTitleSource
        lastWrittenAt: string
        archivedAt: string | null
      }>,
    ) =>
      Effect.gen(function* () {
        const touched = yield* transaction
          .update(sessions)
          .set({ ...change, version: version + 1 })
          .where(and(eq(sessions.id, id), eq(sessions.version, version)))
          .returning({ id: sessions.id })
          .pipe(Effect.mapError(failed('writing the Session')))
        if (touched.length === 0) {
          return yield* Effect.fail(
            new StaleVersionError({ entity: 'session', id, expected: version }),
          )
        }
      })

    return {
      /**
       * The Sessions of a Project, most recently written first (D4b-04).
       *
       * One order for both lists. The archived view is the same list put away, and a Session
       * restored from it comes back where it was, which is where the user last worked on it.
       */
      list: (projectId, archived = false) =>
        withDatabase(
          database
            .select()
            .from(sessions)
            .where(
              and(
                eq(sessions.projectId, projectId),
                archived ? sql`${sessions.archivedAt} IS NOT NULL` : isNull(sessions.archivedAt),
              ),
            )
            // The creation date breaks a tie, so two Sessions written in the same millisecond
            // are still in an order — the same one, asked twice.
            .orderBy(desc(sessions.lastWrittenAt), desc(sessions.createdAt))
            .pipe(
              Effect.mapError(failed('reading the Sessions')),
              Effect.map((rows) => rows.map(sessionOf)),
            ),
        ),

      create: (projectId) =>
        withDatabase(
          mutate('creating a Session', (transaction) =>
            Effect.gen(function* () {
              // A session belongs to a project: without one there is nothing to attach it to,
              // and a project created to have somewhere to put it would be a Project the user
              // never asked for.
              if (projectId === null) return yield* Effect.fail(new NoActiveProjectError())
              const found = yield* transaction
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.id, projectId))
                .pipe(Effect.mapError(failed('reading the Project')))
              if (found.length === 0) return yield* Effect.fail(new UnknownProjectError(projectId))

              const id = crypto.randomUUID()
              const at = now()
              const session: Session = {
                id,
                projectId,
                title: NEW_SESSION_TITLE,
                titleSource: 'derived',
                mission: 'free',
                archivedAt: null,
                createdAt: Date.parse(at),
                lastWrittenAt: Date.parse(at),
                version: 1,
              }
              yield* transaction
                .insert(sessions)
                .values({
                  id,
                  projectId,
                  title: session.title,
                  titleSource: session.titleSource,
                  createdAt: at,
                  lastWrittenAt: at,
                })
                .pipe(Effect.mapError(failed('writing the Session')))
              return {
                result: session,
                events: [
                  {
                    type: 'session.created',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId,
                    sessionId: id,
                    payload: { title: session.title },
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      rename: (id, version, title) =>
        withDatabase(
          mutate('renaming a Session', (transaction) =>
            Effect.gen(function* () {
              const before = yield* readOne(transaction, id)
              const chosen = yield* titled(title)
              // The title becomes the user's, and nothing proposes over it again (D4b-03).
              yield* bump(transaction, id, version, {
                title: chosen,
                titleSource: 'user',
                lastWrittenAt: now(),
              })
              const session = yield* readOne(transaction, id)
              return {
                result: session,
                events: [
                  {
                    type: 'session.renamed',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: session.projectId,
                    sessionId: id,
                    payload: { from: before.title, to: session.title },
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      archive: (id, version) =>
        withDatabase(
          mutate('archiving a Session', (transaction) =>
            Effect.gen(function* () {
              // Archiving is a date that can be cleared and nothing else: the entries do not
              // move, and nothing of the Session is removed (D4b-06).
              yield* bump(transaction, id, version, { archivedAt: now() })
              const session = yield* readOne(transaction, id)
              return {
                result: session,
                events: [
                  {
                    type: 'session.archived',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: session.projectId,
                    sessionId: id,
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      restore: (id, version) =>
        withDatabase(
          mutate('restoring a Session', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, { archivedAt: null })
              const session = yield* readOne(transaction, id)
              return {
                result: session,
                events: [
                  {
                    type: 'session.restored',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: session.projectId,
                    sessionId: id,
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      append: (id, body) =>
        withDatabase(
          mutate('writing a message', (transaction) =>
            Effect.gen(function* () {
              // Through the domain, so an empty message is a refusal the page can show rather
              // than a row nobody can read and nobody can delete.
              const text = yield* written(body)
              const session = yield* readOne(transaction, id)

              // Asked of the table rather than counted: a thread that lost a row to a botched
              // delete would hand the same `seq` twice and refuse a message the user wrote.
              const highest = yield* transaction
                .select({ seq: sessionEntries.seq })
                .from(sessionEntries)
                .where(eq(sessionEntries.sessionId, id))
                .orderBy(desc(sessionEntries.seq))
                .limit(1)
                .pipe(Effect.mapError(failed('reading the thread')))
              const seq = (highest.at(0)?.seq ?? 0) + 1

              const at = now()
              const entry: SessionEntry = {
                id: crypto.randomUUID(),
                sessionId: id,
                seq,
                role: 'user',
                body: text,
                createdAt: Date.parse(at),
              }
              yield* transaction
                .insert(sessionEntries)
                .values({
                  id: entry.id,
                  sessionId: id,
                  seq: entry.seq,
                  role: entry.role,
                  body: entry.body,
                  createdAt: at,
                })
                .pipe(Effect.mapError(failed('writing the message')))

              // The title follows the first message of a Session that has none of its own, and
              // only then: `titleAfterMessage` says no to every later one.
              const title = titleAfterMessage(session, text, seq === 1)
              yield* bump(transaction, id, session.version, { title, lastWrittenAt: at })
              const after = yield* readOne(transaction, id)

              return {
                result: { session: after, entry },
                events: [
                  {
                    type: 'session.message_recorded',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: after.projectId,
                    sessionId: id,
                    payload: { seq },
                  },
                ],
              } satisfies Mutation<Written>
            }),
          ),
        ),

      /**
       * A page of a thread, oldest first, read from its end (design D4b-05).
       *
       * The design asks for `after?: seq` and, in the same sentence, for the renderer loading
       * the end of the thread and walking back up it. The two cannot both be true, and it is the
       * second that describes the gesture: the shape here is `journal.read`'s — a `before`
       * cursor and the `nextBefore` to ask the page before it from — so the two reads of this
       * engine are read the same way, and a thread opens on what was written last.
       *
       * The cursor is a `seq` and not an offset for the reason the Journal's is a sequence: a
       * message written between two pages would make an offset repeat one and skip another.
       */
      read: (id, before, limit) =>
        withDatabase(
          Effect.gen(function* () {
            const cursor = yield* checkedCursor(before)
            const held = limit ?? PAGE
            const rows = yield* database
              .select()
              .from(sessionEntries)
              .where(
                and(
                  eq(sessionEntries.sessionId, id),
                  cursor === undefined ? undefined : lt(sessionEntries.seq, cursor),
                ),
              )
              .orderBy(desc(sessionEntries.seq))
              // One more than asked for, which is how the page knows whether there is another
              // without a second query counting what it is not going to show.
              .limit(held + 1)
              .pipe(Effect.mapError(failed('reading the thread')))

            const page = rows.slice(0, held)
            return {
              // Oldest first, because a page is read the way the thread is read: downwards.
              entries: page.map(entryOf).reverse(),
              nextBefore: rows.length > held ? (page.at(-1)?.seq ?? null) : null,
            } satisfies ThreadPage
          }),
        ),
    } satisfies SessionsService
  }),
)
