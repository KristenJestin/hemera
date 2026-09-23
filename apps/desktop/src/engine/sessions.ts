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
  type AgentProvider,
  type NativeState,
  type Session as DomainSession,
  type SessionEntry as DomainSessionEntry,
  type SessionEntryKind,
  type SessionEntryOrigin,
  type SessionEntryRole,
  type SessionTitleSource,
  EmptyMessageError,
  EmptyTitleError,
  NEW_SESSION_TITLE,
  NoActiveProjectError,
  NoAgentError,
  messageBody,
  sessionTitle,
  titleAfterMessage,
} from '@hemera/core'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'

import { InvalidCursorError, PAGE, type NewEvent } from './journal.ts'
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

/** The agent a Session is given, and the model it is asked for. */
export interface AgentChoice {
  readonly provider: AgentProvider
  readonly model: string | null
}

/** What an agent handed back about its own session, and where it ran (design D5-06). */
export interface NativeRecord {
  readonly nativeSessionId: string | null
  readonly nativeState: NativeState
  readonly cwd: string | null
}

/** One entry the engine writes into a thread, on the agent's behalf or its own. */
export interface ThreadWrite {
  readonly role: SessionEntryRole
  readonly kind: SessionEntryKind
  readonly body: string
  /** What this kind carries, as the JSON text it is stored as; `{}` when it carries nothing. */
  readonly payload?: string
  readonly correlationId?: string | null
  readonly turnId?: string | null
  readonly state?: string | null
  /**
   * Whether this entry is being written as it happens or from what an agent replayed (D5-08).
   *
   * Absent means `live`, which is what a turn writes; only a resume writes `replay`, and it says
   * so on the entries it inserts. An entry that already exists keeps the origin it was born
   * with: a replayed update to a live entry is that same entry, updated.
   */
  readonly origin?: SessionEntryOrigin
  /**
   * Whether this write is the last one this entry will see (Decided 10 of #17).
   *
   * Absent means it may be written again, which is what every caller but the coalescer says: a
   * message grows chunk by chunk, and whoever wrote it last is the one that knows it has stopped.
   */
  readonly settled?: boolean
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
  /**
   * Makes a Session in a Project, with the agent it will run.
   *
   * The agent is not an option: a Session is made with one and keeps it for every turn (design
   * D5-06), and a Session nothing can answer is what `NoAgentError` refuses. The parameter is
   * still nullable at the wire because a Session written before the agents existed holds nothing
   * there; reading one is not making one.
   */
  readonly create: (
    projectId: string | null,
    provider?: AgentProvider | null,
  ) => Effect.Effect<
    Session,
    DatabaseError | NoActiveProjectError | NoAgentError | UnknownProjectError
  >
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
  /**
   * Chooses the agent of a Session, and the model it is asked for.
   *
   * The choice is written before the agent is started, and read back from here at the next
   * start: a Session whose process died is still the Session the user set up, and the engine
   * cannot ask a renderer that may not be running. A version is taken, because which agent a
   * Session talks to is a decision a second window can be making at the same time.
   */
  readonly chooseAgent: (
    id: string,
    version: number,
    choice: AgentChoice,
  ) => Effect.Effect<Session, Refusal>
  /**
   * Records what the agent itself handed back: the handle of its native session, the directory
   * it ran in, and how far that handle is still worth anything (design D5-06).
   *
   * No version is taken, and this is the one write of a Session that does not bump one: the
   * engine writes it while the agent is working, and a version the agent keeps raising would
   * refuse the rename the user is making at that very moment. The fields are the engine's own,
   * and nothing else writes them.
   */
  readonly recordNative: (id: string, native: NativeRecord) => Effect.Effect<Session, Refusal>
  /**
   * One Session, and what the agent handed back about it (design D5-06).
   *
   * The engine reads a Session by its identifier where the window reads a Project's list: a turn
   * names the Session it belongs to, and the handle the agent gave is the engine's own — the
   * window is told how far the Session is still attached, never which conversation the agent is
   * keeping.
   */
  readonly one: (
    id: string,
  ) => Effect.Effect<{ readonly session: Session; readonly native: NativeRecord }, Refusal>
  /**
   * Writes one entry of the thread the user did not write — what the agent said, called, ran or
   * asked for (design D5-11).
   *
   * The user's own message does not come through here: `append` is the one that refuses an
   * empty message and proposes the title. This one is told what to write, and its `kind` is
   * what the block on screen is drawn from.
   *
   * The Journal keeps one line per entry, whatever the number of writes (Decided 10 of #17): the
   * first write says the entry exists, and a later one says it has settled — only when the caller
   * says so with `settled`. An agent streams a message a few words at a time, and a Journal with
   * one line per chunk is a Journal nobody reads.
   *
   * When a `correlationId` is given and a row of this Session already carries it, that row is
   * updated rather than a second one appended: a tool call that was running and has finished is
   * the same entry in a later state. Everything else is read back as what was written, and the
   * Session's `last_written_at` says it was worked on — its `version` is not raised, because an
   * agent writing in a thread changes nothing about what the Session is.
   */
  readonly write: (id: string, entry: ThreadWrite) => Effect.Effect<Written, Refusal>
}

export class Sessions extends Context.Service<Sessions, SessionsService>()('Sessions') {}

/** What any change to an existing Session can be refused with. */
type Refusal =
  | DatabaseError
  | StaleVersionError
  | UnknownSessionError
  | EmptyTitleError
  | InvalidCursorError
  | NoAgentError

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
    // SAFETY: the same, for the check on `provider`: it admits exactly the agents the domain
    // declares, and null, which is a Session no agent has been chosen for.
    provider: row.provider as AgentProvider | null,
    model: row.model,
    // SAFETY: the same, for the check on `native_state`: it admits exactly the states the
    // domain declares.
    nativeState: row.nativeState as NativeState,
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
    // SAFETY: both columns are constrained by a check to exactly the values the domain
    // declares, and nothing writes them but this service and the agent runtime beside it.
    role: row.role as SessionEntryRole,
    // SAFETY: the same, and for the same reason: `kind` is checked against the kinds of the
    // domain, and it is what tells a reader which block of the thread this entry is.
    kind: row.kind as SessionEntryKind,
    body: row.body,
    payload: row.payload,
    // SAFETY: the column is constrained by a check to exactly the values the domain declares,
    // and only this service and the agent runtime beside it write it.
    origin: row.origin as SessionEntryOrigin,
    correlationId: row.correlationId,
    turnId: row.turnId,
    state: row.state,
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
        provider: AgentProvider
        model: string | null
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

      create: (projectId, provider = null) =>
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
              // And a Session is made with the agent it runs: it is chosen once, in the composer
              // that starts it, and every turn of that Session runs it (design D5-06, D5-17).
              // Refused here rather than in the interface, because a Session nothing can answer
              // is not something a second reader of this service should be able to make either.
              if (provider === null) return yield* Effect.fail(new NoAgentError())

              const id = crypto.randomUUID()
              const at = now()
              const session: Session = {
                id,
                projectId,
                title: NEW_SESSION_TITLE,
                titleSource: 'derived',
                mission: 'free',
                // With the row rather than by a second mutation a moment later: the choice is
                // made before the Session exists, in the composer that starts it, and the agent
                // is what it is written with.
                provider,
                model: null,
                nativeState: 'none',
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
                  provider,
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
                kind: 'message',
                body: text,
                payload: '{}',
                origin: 'live',
                correlationId: null,
                turnId: null,
                state: null,
                createdAt: Date.parse(at),
              }
              yield* transaction
                .insert(sessionEntries)
                .values({
                  id: entry.id,
                  sessionId: id,
                  seq: entry.seq,
                  role: entry.role,
                  kind: entry.kind,
                  body: entry.body,
                  payload: entry.payload,
                  createdAt: at,
                })
                .pipe(Effect.mapError(failed('writing the message')))

              // The title follows the first message of a Session that has none of its own, and
              // only then: `titleAfterMessage` says no to every later one.
              const title = titleAfterMessage(session, text, seq === 1)
              // Written without the optimistic check and without raising the version, exactly as
              // the entries an agent writes are: no version is taken here, and a message is not
              // a change to what the Session *is* — a version the thread kept raising would
              // refuse the archive, the rename or the choice the window is making from the
              // Session it read, which is a thread that cannot be put away once it is used.
              yield* transaction
                .update(sessions)
                .set({ title, lastWrittenAt: at })
                .where(eq(sessions.id, id))
                .pipe(Effect.mapError(failed('writing the Session')))
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

      chooseAgent: (id, version, choice) =>
        withDatabase(
          mutate('choosing the agent of a Session', (transaction) =>
            Effect.gen(function* () {
              yield* bump(transaction, id, version, {
                provider: choice.provider,
                model: choice.model,
                lastWrittenAt: now(),
              })
              const session = yield* readOne(transaction, id)
              return {
                result: session,
                events: [
                  {
                    type: 'session.agent_chosen',
                    entityKind: 'session',
                    entityId: id,
                    source: 'ui',
                    author: 'human',
                    projectId: session.projectId,
                    sessionId: id,
                    payload: { provider: choice.provider, model: choice.model },
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      recordNative: (id, native) =>
        withDatabase(
          mutate('recording the agent of a Session', (transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(sessions)
                .set({
                  nativeSessionId: native.nativeSessionId,
                  nativeState: native.nativeState,
                  cwd: native.cwd,
                })
                .where(eq(sessions.id, id))
                .pipe(Effect.mapError(failed('writing the Session')))
              const session = yield* readOne(transaction, id)
              return {
                result: session,
                events: [
                  {
                    type: 'session.agent_recorded',
                    entityKind: 'session',
                    entityId: id,
                    // The engine did this while the agent was working, not the user.
                    source: 'system',
                    author: 'hemera',
                    projectId: session.projectId,
                    sessionId: id,
                    payload: {
                      nativeState: native.nativeState,
                      hasNativeSession: native.nativeSessionId !== null,
                    },
                  },
                ],
              } satisfies Mutation<Session>
            }),
          ),
        ),

      one: (id) =>
        withDatabase(
          Effect.gen(function* () {
            const rows = yield* database
              .select()
              .from(sessions)
              .where(eq(sessions.id, id))
              .limit(1)
              .pipe(Effect.mapError(failed('reading the Session')))
            const row = rows[0]
            if (row === undefined) return yield* Effect.fail(new UnknownSessionError(id))
            return {
              session: sessionOf(row),
              native: {
                nativeSessionId: row.nativeSessionId,
                // SAFETY: the same check the Session's own mapping reads: the column admits
                // exactly the states the domain declares.
                nativeState: row.nativeState as NativeState,
                cwd: row.cwd,
              },
            }
          }),
        ),

      write: (id, entry) =>
        withDatabase(
          mutate('writing an entry', (transaction) =>
            Effect.gen(function* () {
              const at = now()
              const held = entry.correlationId ?? null
              const payload = entry.payload ?? '{}'

              // An update finds its row by what it is about, inside its own session: a tool call
              // that was running and has finished is one entry in a later state.
              const already =
                held === null
                  ? []
                  : yield* transaction
                      .select({ id: sessionEntries.id, seq: sessionEntries.seq })
                      .from(sessionEntries)
                      .where(
                        and(
                          eq(sessionEntries.sessionId, id),
                          eq(sessionEntries.correlationId, held),
                        ),
                      )
                      .limit(1)
                      .pipe(Effect.mapError(failed('reading the thread')))
              const settled = already.at(0)

              let seq: number
              if (settled === undefined) {
                // Asked of the table rather than counted, exactly as a message is: one thread
                // reads in one order, however many writers it has.
                const highest = yield* transaction
                  .select({ seq: sessionEntries.seq })
                  .from(sessionEntries)
                  .where(eq(sessionEntries.sessionId, id))
                  .orderBy(desc(sessionEntries.seq))
                  .limit(1)
                  .pipe(Effect.mapError(failed('reading the thread')))
                seq = (highest.at(0)?.seq ?? 0) + 1
                yield* transaction
                  .insert(sessionEntries)
                  .values({
                    id: crypto.randomUUID(),
                    sessionId: id,
                    seq,
                    role: entry.role,
                    kind: entry.kind,
                    body: entry.body,
                    payload,
                    origin: entry.origin ?? 'live',
                    correlationId: held,
                    turnId: entry.turnId ?? null,
                    state: entry.state ?? null,
                    createdAt: at,
                  })
                  .pipe(Effect.mapError(failed('writing the entry')))
              } else {
                seq = settled.seq
                yield* transaction
                  .update(sessionEntries)
                  .set({
                    body: entry.body,
                    payload,
                    state: entry.state ?? null,
                    turnId: entry.turnId ?? null,
                  })
                  .where(eq(sessionEntries.id, settled.id))
                  .pipe(Effect.mapError(failed('writing the entry')))
              }

              // The Session was worked on, which is what its list is ordered by. What it *is*
              // has not changed, so its version stays where the user's own changes left it.
              yield* transaction
                .update(sessions)
                .set({ lastWrittenAt: at })
                .where(eq(sessions.id, id))
                .pipe(Effect.mapError(failed('writing the Session')))

              const session = yield* readOne(transaction, id)
              const rows = yield* transaction
                .select()
                .from(sessionEntries)
                .where(and(eq(sessionEntries.sessionId, id), eq(sessionEntries.seq, seq)))
                .limit(1)
                .pipe(Effect.mapError(failed('reading the thread')))
              const settledRow = rows[0]
              if (settledRow === undefined) return yield* Effect.fail(new UnknownSessionError(id))

              // What both lines say, and all they say: the entry this is about, and who it was
              // for. A reader of the Journal has the thread for the rest of it.
              const line: Omit<NewEvent, 'type'> = {
                entityKind: 'session',
                entityId: id,
                source: 'system',
                author: entry.role === 'agent' ? 'agent' : 'hemera',
                projectId: session.projectId,
                sessionId: id,
                payload: {
                  seq,
                  kind: entry.kind,
                  role: entry.role,
                  state: entry.state ?? null,
                },
              }

              // One line per entry, never one per write (Decided 10 of #17). The first write says
              // the entry was written; a write the caller says is the last says it has settled.
              // A rewrite that is neither — a call in a later state, a message with more of it in
              // it — is the entry the reader has already been told about.
              const events: NewEvent[] = []
              if (settled === undefined) events.push({ ...line, type: 'session.entry_written' })
              if (entry.settled === true) events.push({ ...line, type: 'session.entry_settled' })

              return {
                result: { session, entry: entryOf(settledRow) },
                events,
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
