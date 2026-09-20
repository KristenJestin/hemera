/**
 * What a Session is, and everything that can be done to one (design D4b-01 … D4b-06).
 *
 * A Session is a thread of a Project: no Spec, no Workspace, no agent. What the user writes is
 * kept here and nowhere else — the Journal records that a message was written, never what it
 * said — so a thread survives a crash, a restart and the absence of any provider, because it
 * was never anything but rows.
 *
 * Everything that writes goes through `mutate`, so the change and the event that describes it
 * are one transaction: a message is committed with its `last_written_at` and its
 * `session.message_recorded`, or none of the three happened and the caller is told so. The
 * interface is what depends on that — it shows a message as saved when the commit comes back
 * and not before (design D4b-02).
 */

import { and, asc, desc, eq, gt, isNotNull, isNull } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { Database, DatabaseError, type EngineTransaction } from './storage/database.ts'
import {
  type ENTRY_ROLES,
  type TITLE_SOURCES,
  projects,
  sessionEntries,
  sessions,
} from './storage/schema.ts'
import type { EventPayload } from './journal.ts'
import { UnknownProjectError } from './projects.ts'
import { type Mutation, StaleVersionError, mutate } from './transaction.ts'

export type TitleSource = (typeof TITLE_SOURCES)[number]
export type EntryRole = (typeof ENTRY_ROLES)[number]

/**
 * The title a Session carries until something is written in it (design D4b-03).
 *
 * Written into the row at creation rather than left empty and filled in by whoever displays
 * it: a title is what the sidebar sorts, searches and shows, and a null that four surfaces
 * each have to turn into the same English words is four places for them to disagree. The
 * interface is in English, so the default is a string and not a token.
 */
export const NEW_SESSION_TITLE = 'New session'

/** How much of a first message a derived title keeps, before the space it is cut on. */
export const DERIVED_TITLE_LIMIT = 60

/** A Session as the interface is handed one. */
export interface Session {
  id: string
  projectId: string
  title: string
  /** Whether the title is still Hemera's to propose, or the user's decision. */
  titleSource: TitleSource
  archivedAt: number | null
  createdAt: number
  /** The last message or rename, which is what the sidebar sorts on (design D4b-04). */
  lastWrittenAt: number
  version: number
}

/** One message of a thread, in the order the Session numbered it. */
export interface SessionEntry {
  id: string
  sessionId: string
  /** Its place in this Session, counted from one and never reused. */
  seq: number
  role: EntryRole
  body: string
  createdAt: number
}

/** What creating one takes: whose Session, and what was typed to start it if anything was. */
export interface NewSession {
  projectId: string
  /**
   * The message the Home composer was sent with, written in the same transaction.
   *
   * Two calls would be two transactions, and between them a thread that exists with nothing in
   * it and a title nobody chose — which is what the user sees if the second one fails.
   */
  firstMessage?: string | undefined
}

/** Which Sessions of a Project are asked for: the current ones, or the archived ones. */
export interface SessionsQuery {
  projectId: string
  archived?: boolean | undefined
}

/** A page of a thread: where to read from, and how much of it (design D4b-05). */
export interface ThreadQuery {
  sessionId: string
  /** Everything after this place in the Session. Absent means from the first message. */
  after?: number | undefined
  limit?: number | undefined
}

/** A page of a thread, and where the next one starts. */
export interface ThreadPage {
  entries: SessionEntry[]
  /** The place to ask the next page after, or null when there is nothing more. */
  nextAfter: number | null
}

/** What a message being written down gives back: the message, and the Session it changed. */
export interface Appended {
  session: Session
  entry: SessionEntry
}

/** A Session was asked for by an identifier nothing answers to. */
export class UnknownSessionError extends Error {
  constructor(readonly id: string) {
    super(`no Session has the identifier "${id}"`)
    this.name = 'UnknownSessionError'
  }
}

/** How many messages a page holds when the caller does not say. */
export const THREAD_PAGE = 50

/**
 * Everything that can be done to a Session, and nothing that cannot (design D4b-06).
 *
 * There is no `delete`, as there is none on a Project: archiving is how a Session ends, its
 * messages stay whole, and the absence of the use case is the guarantee.
 *
 * `rename`, `archive` and `restore` take the version the Session was read at and refuse one
 * that is no longer current, the way every change to a Project does. `append` does not, and
 * that is deliberate: writing a message adds a row and takes nothing away, so there is no
 * change of anyone else's it could be overwriting — and a burst of ten messages typed faster
 * than the answers come back cannot carry ten versions nobody has been handed yet.
 */
export interface SessionsService {
  readonly list: (query: SessionsQuery) => Effect.Effect<Session[], DatabaseError>
  readonly create: (
    asked: NewSession,
  ) => Effect.Effect<Session, DatabaseError | UnknownProjectError>
  readonly rename: (id: string, version: number, title: string) => Effect.Effect<Session, Refusal>
  readonly archive: (id: string, version: number) => Effect.Effect<Session, Refusal>
  readonly restore: (id: string, version: number) => Effect.Effect<Session, Refusal>
  readonly append: (
    id: string,
    body: string,
  ) => Effect.Effect<Appended, DatabaseError | UnknownSessionError>
  readonly read: (query: ThreadQuery) => Effect.Effect<ThreadPage, DatabaseError>
}

export class Sessions extends Context.Service<Sessions, SessionsService>()('Sessions') {}

/** What any change to an existing Session can be refused with. */
type Refusal = DatabaseError | StaleVersionError | UnknownSessionError

/**
 * The columns one change of a Session may touch, and no others.
 *
 * `last_written_at` is among them rather than set by every write: archiving is not working on
 * a thread, and a Session that went to the top of the sidebar by being put away would be a
 * sidebar sorted by the last thing done to a Session instead of the last thing written in it.
 */
interface SessionChange {
  title?: string
  titleSource?: TitleSource
  archivedAt?: string | null
  lastWrittenAt?: string
}

/** The date every row of one mutation shares, so a Session and its event agree on when. */
function now(): string {
  return new Date().toISOString()
}

/**
 * The title a first message proposes, which the user is free to replace (design D4b-03).
 *
 * The first line, because a message is often a paragraph and a sidebar is one line wide; cut
 * on a space, because a title cut mid-word reads as a bug; and the ellipsis says that what is
 * shown is not all there was. A message that is short enough is kept whole, without one.
 *
 * A message that is only blank lines proposes nothing, and the Session keeps the default
 * title: the alternative is a sidebar entry named after nothing at all.
 */
export function derivedTitle(body: string): string | null {
  const line = body
    .split('\n')
    .find((one) => one.trim() !== '')
    ?.trim()
  if (line === undefined) return null
  if (line.length <= DERIVED_TITLE_LIMIT) return line
  const cut = line.slice(0, DERIVED_TITLE_LIMIT)
  const space = cut.lastIndexOf(' ')
  return `${(space === -1 ? cut : cut.slice(0, space)).trimEnd()}…`
}

/** A row of `sessions`, as the Session a caller is handed. */
function sessionOf(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    // SAFETY: the column is constrained by a check to the two values `TitleSource` lists, and
    // nothing writes it but this service, which writes one of those two literals.
    titleSource: row.titleSource as TitleSource,
    archivedAt: row.archivedAt === null ? null : Date.parse(row.archivedAt),
    createdAt: Date.parse(row.createdAt),
    lastWrittenAt: Date.parse(row.lastWrittenAt),
    version: row.version,
  }
}

/** A row of `session_entries`, as the message a reader of the thread is handed. */
function entryOf(row: typeof sessionEntries.$inferSelect): SessionEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    seq: row.seq,
    // SAFETY: the column is constrained by a check to the one value `EntryRole` lists, and
    // nothing writes it but this service, which writes that literal.
    role: row.role as EntryRole,
    body: row.body,
    createdAt: Date.parse(row.createdAt),
  }
}

export const sessionsLayer = Layer.effect(
  Sessions,
  Effect.gen(function* () {
    const database = yield* Database

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    /** Hands the database to what the layer gives back, as the Projects service does. */
    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The one Session a change was about, read inside the transaction that changed it. */
    const readOne = (transaction: EngineTransaction, id: string) =>
      Effect.gen(function* () {
        const rows = yield* transaction
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .pipe(Effect.mapError(failed('reading the Session')))
        const row = rows[0]
        if (row === undefined) return yield* Effect.fail(new UnknownSessionError(id))
        return sessionOf(row)
      })

    /**
     * Takes a Session to its next version, and refuses a caller working from an older one.
     *
     * The comparison is the write, as it is for a Project: `WHERE id = ? AND version = ?`
     * either changes a row or does not, and there is no window between reading the version and
     * acting on it.
     */
    const bump = (
      transaction: EngineTransaction,
      id: string,
      version: number,
      change: SessionChange,
    ) =>
      Effect.gen(function* () {
        const written = yield* transaction
          .update(sessions)
          .set({ ...change, version: version + 1 })
          .where(and(eq(sessions.id, id), eq(sessions.version, version)))
          .returning({ id: sessions.id })
          .pipe(Effect.mapError(failed('writing the Session')))
        if (written.length === 0) {
          return yield* Effect.fail(
            new StaleVersionError({ entity: 'session', id, expected: version }),
          )
        }
      })

    /** The place the next message of a Session takes, asked of the Session itself. */
    const nextSeq = (transaction: EngineTransaction, id: string) =>
      transaction
        .select({ seq: sessionEntries.seq })
        .from(sessionEntries)
        .where(eq(sessionEntries.sessionId, id))
        .orderBy(desc(sessionEntries.seq))
        .limit(1)
        .pipe(
          Effect.mapError(failed('reading the thread')),
          Effect.map((rows) => (rows[0]?.seq ?? 0) + 1),
        )

    /**
     * One message written down, with what it does to the Session it belongs to.
     *
     * Everything a message changes is here and happens at once: the row, the place it takes,
     * the date the sidebar sorts on, and the title when this is the first message of a Session
     * whose title is still Hemera's to propose. The caller wraps it in `mutate`, so the event
     * that says it happened is committed with it or not at all (design D4b-02).
     */
    const appending = (transaction: EngineTransaction, session: Session, body: string) =>
      Effect.gen(function* () {
        const seq = yield* nextSeq(transaction, session.id)
        const written = now()
        const entry = {
          id: crypto.randomUUID(),
          sessionId: session.id,
          seq,
          role: 'user',
          body,
          createdAt: written,
        } as const
        yield* transaction
          .insert(sessionEntries)
          .values(entry)
          .pipe(Effect.mapError(failed('writing the message')))

        // The first message of a Session nobody has renamed is what the title is taken from,
        // and the only moment it ever is: `user` is a decision and a later message is not an
        // occasion to reconsider it (design D4b-03).
        const proposed = seq === 1 && session.titleSource === 'derived' ? derivedTitle(body) : null
        const title = proposed ?? session.title
        yield* bump(transaction, session.id, session.version, { title, lastWrittenAt: written })

        return {
          session: {
            ...session,
            title,
            lastWrittenAt: Date.parse(written),
            version: session.version + 1,
          },
          entry: entryOf(entry),
        } satisfies Appended
      })

    /** What the Journal is told about a message, which is that there was one and where. */
    const recorded = (session: Session, seq: number) =>
      ({
        type: 'session.message_recorded',
        entityKind: 'session',
        entityId: session.id,
        source: 'ui',
        author: 'human',
        projectId: session.projectId,
        sessionId: session.id,
        // What was written is in the Session and not in the Journal: a journal is a journal,
        // not a second copy of the thread (design D4b-01).
        payload: { seq },
      }) as const

    /** A change to a Session, read back and journaled the same way whatever it changed. */
    const changing = (
      doing: string,
      type: string,
      id: string,
      version: number,
      change: SessionChange,
      payload: EventPayload = {},
    ) =>
      withDatabase(
        mutate(doing, (transaction) =>
          Effect.gen(function* () {
            yield* bump(transaction, id, version, change)
            const session = yield* readOne(transaction, id)
            return {
              result: session,
              events: [
                {
                  type,
                  entityKind: 'session',
                  entityId: id,
                  source: 'ui',
                  author: 'human',
                  projectId: session.projectId,
                  sessionId: id,
                  payload,
                },
              ],
            } satisfies Mutation<Session>
          }),
        ),
      )

    return {
      /**
       * The Sessions of one Project, most recently written first (design D4b-04).
       *
       * The archived ones are a list of their own and never mixed in: the sidebar shows what is
       * being worked on, and the archives page asks for the rest.
       */
      list: (query) =>
        withDatabase(
          database
            .select()
            .from(sessions)
            .where(
              and(
                eq(sessions.projectId, query.projectId),
                query.archived === true
                  ? isNotNull(sessions.archivedAt)
                  : isNull(sessions.archivedAt),
              ),
            )
            .orderBy(desc(sessions.lastWrittenAt))
            .pipe(
              Effect.mapError(failed('reading the Sessions')),
              Effect.map((rows) => rows.map(sessionOf)),
            ),
        ),

      /**
       * A Session of a Project, and the message it was started with if there was one.
       *
       * The Project is looked for before anything is written, so a Session asked for without
       * one — the shell with nothing selected — is refused by name instead of by a foreign key.
       * Nothing else is created: no Spec, no Workspace, no message the user did not type.
       */
      create: (asked) =>
        withDatabase(
          mutate('creating a Session', (transaction) =>
            Effect.gen(function* () {
              const owner = yield* transaction
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.id, asked.projectId))
                .pipe(Effect.mapError(failed('reading the Project')))
              if (owner.length === 0) {
                return yield* Effect.fail(new UnknownProjectError(asked.projectId))
              }

              const id = crypto.randomUUID()
              const written = now()
              yield* transaction
                .insert(sessions)
                .values({
                  id,
                  projectId: asked.projectId,
                  title: NEW_SESSION_TITLE,
                  titleSource: 'derived',
                  createdAt: written,
                  lastWrittenAt: written,
                })
                .pipe(Effect.mapError(failed('writing the Session')))

              // Built from what was just written rather than read back, as a Project is: the
              // row is known in full, and reading it would make this use case declare a refusal
              // that cannot follow the insert that just succeeded.
              const fresh: Session = {
                id,
                projectId: asked.projectId,
                title: NEW_SESSION_TITLE,
                titleSource: 'derived',
                archivedAt: null,
                createdAt: Date.parse(written),
                lastWrittenAt: Date.parse(written),
                version: 1,
              }
              const created = {
                type: 'session.created',
                entityKind: 'session',
                entityId: id,
                source: 'ui',
                author: 'human',
                projectId: asked.projectId,
                sessionId: id,
                payload: { title: NEW_SESSION_TITLE },
              } as const

              if (asked.firstMessage === undefined) {
                return { result: fresh, events: [created] } satisfies Mutation<Session>
              }
              const appended = yield* appending(transaction, fresh, asked.firstMessage)
              return {
                result: appended.session,
                events: [created, recorded(appended.session, appended.entry.seq)],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      /**
       * The title the user chose, which nothing proposes over afterwards (design D4b-03).
       *
       * A rename is a write like a message is: the Session goes to the top of the sidebar,
       * because that is where the user just was.
       */
      rename: (id, version, title) =>
        changing(
          'renaming a Session',
          'session.renamed',
          id,
          version,
          { title, titleSource: 'user', lastWrittenAt: now() },
          { title },
        ),

      /** Archiving is a date and nothing else: the thread is not touched (design D4b-06). */
      archive: (id, version) =>
        changing('archiving a Session', 'session.archived', id, version, { archivedAt: now() }),

      restore: (id, version) =>
        changing('restoring a Session', 'session.restored', id, version, { archivedAt: null }),

      /**
       * A message, its place in the Session and the event saying so, in one transaction.
       *
       * Nothing of it is shown as saved before this returns, and nothing of it survives a
       * failure: the entry, the date the sidebar sorts on and the journal line are one commit
       * (design D4b-02).
       */
      append: (id, body) =>
        withDatabase(
          mutate('writing a message', (transaction) =>
            Effect.gen(function* () {
              const session = yield* readOne(transaction, id)
              const appended = yield* appending(transaction, session, body)
              return {
                result: appended,
                events: [recorded(appended.session, appended.entry.seq)],
              } satisfies Mutation<Appended>
            }),
          ),
        ),

      /**
       * A page of a thread, in the order the Session numbered it (design D4b-05).
       *
       * The cursor is the place a message holds in its Session and never an offset: an offset
       * counts from the start of a list being written to from the other end, so a page asked
       * for by offset both repeats and skips the moment anything is written between two pages.
       */
      read: (query) =>
        withDatabase(
          Effect.gen(function* () {
            const limit = query.limit ?? THREAD_PAGE
            const rows = yield* database
              .select()
              .from(sessionEntries)
              .where(
                and(
                  eq(sessionEntries.sessionId, query.sessionId),
                  query.after === undefined ? undefined : gt(sessionEntries.seq, query.after),
                ),
              )
              .orderBy(asc(sessionEntries.seq))
              // One more than asked for, which is how the page knows whether there is another
              // without a second query counting what it is not going to show.
              .limit(limit + 1)
              .pipe(Effect.mapError(failed('reading the thread')))

            const page = rows.slice(0, limit)
            return {
              entries: page.map(entryOf),
              nextAfter: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
            }
          }),
        ),
    } satisfies SessionsService
  }),
)
