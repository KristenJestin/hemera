/**
 * What an agent is provided, and how a change of it reaches it (D6-07, D6-08).
 *
 * The base is `CONTEXT_BASE`, the three sentences every Session is given once, by whatever means
 * its adapter has. The Project's instructions are the `AGENTS.md` at the root of the Workspace.
 * Whether the agent reads it itself is its adapter's declaration, since bare mode can keep it
 * from reading it. An agent that reads it is not sent it — that would be a second injection of a
 * text it already has — and the Context view says the file was read natively. An agent that does
 * not is given it at the start of the Session, and the view says so. Either way the fingerprint
 * of what was there at the start is recorded, and a later change goes the same way to both.
 *
 * A change during a Session is not a prompt either. It waits, and is handed over between two
 * turns as its own text carrying the marker that says who wrote it. What decides whether there is
 * a change is the last text the agent was given: a file edited and then put back is a change
 * each time, and a file that reads as it was last given is none.
 *
 * Nothing here watches the filesystem. The safe point is the caller's, and `pending` reads the
 * file then, which is the only moment the answer is worth anything. The entry a delivery makes
 * in the thread is the caller's too: it is written when the text is handed over, by the one that
 * hands it over, and not by the service that computed it. So is the moment a change counts as
 * given: `delivered` is told once the agent took it, and a change whose sending failed is still
 * pending at the next safe point.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AGENTS_FILE,
  type BaseReach,
  CONTEXT_BASE,
  type ContextReach,
  deliveryText,
} from '@hemera/core'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { Context as EffectContext, Effect, Layer } from 'effect'

import { bareModeOf } from '../agents/bare.ts'
import { ADAPTERS } from '../agents/discovery.ts'
import { Projects, UnknownProjectError } from '../projects.ts'
import { Sessions, UnknownSessionError } from '../sessions.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import { type ContextDeliveryKind, contextDeliveries } from '../storage/schema.ts'

/** How a source of the provided context is named, in the table and under the same name in a view. */
export type DeliveryKind = ContextDeliveryKind

/** One thing a Session was provided, as its row records it. */
interface Recorded {
  readonly kind: DeliveryKind
  /** The file it came from, and `''` for the base, which is not a file. */
  readonly path: string
  readonly fingerprint: string
  readonly deliveredAt: string
}

/** One thing a Session was provided, as the Context view lists it. */
export interface Delivery extends Recorded {
  /**
   * How it reached the agent (D6-10): the base by its agent's means, `AGENTS.md` read by the agent
   * itself or given at the start of the Session, a change as a delivery prompt of its own between
   * two turns.
   */
  readonly reached: ContextReach
}

/** What a Session is given when it starts. */
export interface Started {
  /** Word for word what the adapter hands the agent once. */
  readonly base: string
  /** The instructions as they stood, and their fingerprint; null without the file. */
  readonly instructions: {
    readonly path: string
    readonly fingerprint: string
    /**
     * The text Hemera hands the agent at the start, for an agent that does not read the file
     * itself; null for one that does, which is never sent it.
     */
    readonly given: string | null
  } | null
}

/** What waits for the next safe point. */
export interface Pending {
  readonly path: string
  /** The fingerprint of what the agent was last given, which this change replaces (D6-08). */
  readonly before: string | null
  /** The fingerprint of the instructions as they now read. */
  readonly fingerprint: string
  /** The text as it is handed over: the marker, and the instructions as they now read. */
  readonly text: string
  /** The instructions as they now read, which is what a delivery carries as its resource. */
  readonly content: string
}

/** What this service provides a Session, and what it can be refused with. */
export interface ContextService {
  /** Records what a Session starts with, and hands back what its adapter gives it. */
  readonly start: (sessionId: string) => Effect.Effect<Started, Refusal>
  /** What waits for the next safe point, if anything. */
  readonly pending: (sessionId: string) => Effect.Effect<Pending | null, Refusal>
  /**
   * Records a change as given, once the agent took it: from then on it is what the agent holds,
   * and the file reading as it is no longer a change.
   */
  readonly delivered: (sessionId: string, given: Pending) => Effect.Effect<Delivery, Refusal>
  /** Everything a Session was provided, oldest first. */
  readonly provided: (sessionId: string) => Effect.Effect<Delivery[], Refusal>
}

/** Everything a delivery can be refused with. */
type Refusal =
  | DatabaseError
  | UnknownProjectError
  | UnknownSessionError
  | UnreadableInstructionsError

/** Thrown when `AGENTS.md` is there and could not be read: not the same as not having one. */
export class UnreadableInstructionsError extends Error {
  readonly path: string
  readonly detail: string

  constructor(path: string, detail: string) {
    super(`${path} could not be read: ${detail}`)
    this.name = 'UnreadableInstructionsError'
    this.path = path
    this.detail = detail
  }
}

export class Context extends EffectContext.Service<Context, ContextService>()('Context') {}

/** The instructions of a Workspace, as they stand, and their fingerprint. */
interface Instructions {
  readonly text: string
  readonly fingerprint: string
}

export const contextLayer = Layer.effect(
  Context,
  Effect.gen(function* () {
    const database = yield* Database
    const sessions = yield* Sessions
    const projects = yield* Projects

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** What makes the same text recognisable, and never given twice. */
    const fingerprintOf = (text: string): string =>
      createHash('sha256').update(text, 'utf8').digest('hex')

    /** Whether a read failed because the file is simply not there, which is not a failure. */
    const missing = (cause: unknown): boolean =>
      cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'

    const said = (cause: unknown): string =>
      cause instanceof Error ? cause.message : 'the reason is unknown'

    /** The instructions of a Workspace, read; null when the Workspace has none. */
    const instructionsOf = (
      root: string,
    ): Effect.Effect<Instructions | null, UnreadableInstructionsError> =>
      Effect.gen(function* () {
        const at = join(root, AGENTS_FILE)
        const read = yield* Effect.promise(() =>
          readFile(at, 'utf8').then(
            (text) => ({ read: true as const, text }),
            (cause: unknown) => ({ read: false as const, cause }),
          ),
        )
        if (!read.read) {
          if (missing(read.cause)) return null
          return yield* Effect.fail(new UnreadableInstructionsError(at, said(read.cause)))
        }
        return { text: read.text, fingerprint: fingerprintOf(read.text) }
      })

    /** The root of the Workspace: what a Session is given is its Project's own folder. */
    const rootOf = (sessionId: string): Effect.Effect<string, Refusal> =>
      Effect.gen(function* () {
        const { session } = yield* sessions
          .one(sessionId)
          .pipe(
            Effect.mapError((cause) =>
              cause instanceof UnknownSessionError
                ? cause
                : new DatabaseError({ doing: 'reading the Session of a delivery', cause }),
            ),
          )
        const all = yield* projects
          .list(true)
          .pipe(
            Effect.mapError(
              (cause) => new DatabaseError({ doing: 'reading the Projects of a delivery', cause }),
            ),
          )
        const project = all.find((one) => one.id === session.projectId)
        if (project === undefined) {
          return yield* Effect.fail(new UnknownProjectError(session.projectId))
        }
        return project.mainPath
      })

    /** The kind of a row, which the table's check constraint already closed. */
    const kindOf = (kind: string): DeliveryKind => {
      switch (kind) {
        case 'base':
        case 'native':
        case 'provided':
        case 'instructions':
          return kind
        default:
          return 'instructions'
      }
    }

    /** Everything a Session was provided, oldest first: what the Context view lists. */
    const rowsOf = (sessionId: string): Effect.Effect<Recorded[], DatabaseError> =>
      withDatabase(
        database
          .select({
            kind: contextDeliveries.kind,
            path: contextDeliveries.path,
            fingerprint: contextDeliveries.fingerprint,
            deliveredAt: contextDeliveries.deliveredAt,
          })
          .from(contextDeliveries)
          .where(eq(contextDeliveries.sessionId, sessionId))
          .orderBy(contextDeliveries.deliveredAt, contextDeliveries.kind)
          .pipe(Effect.mapError(failed('reading the provided context'))),
      ).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            kind: kindOf(row.kind),
            path: row.path,
            fingerprint: row.fingerprint,
            deliveredAt: row.deliveredAt,
          })),
        ),
      )

    /**
     * The fingerprint of the instructions a Session was last given: read natively, given at the
     * start, or delivered.
     *
     * The last one and not any one: a file edited A, B, then A again has changed back, and the
     * agent holds B until it is told. Rows of one moment are told apart by their insertion order.
     */
    const lastGiven = (sessionId: string): Effect.Effect<string | null, DatabaseError> =>
      withDatabase(
        database
          .select({ fingerprint: contextDeliveries.fingerprint })
          .from(contextDeliveries)
          .where(
            and(
              eq(contextDeliveries.sessionId, sessionId),
              eq(contextDeliveries.path, AGENTS_FILE),
              inArray(contextDeliveries.kind, ['native', 'provided', 'instructions']),
            ),
          )
          .orderBy(desc(contextDeliveries.deliveredAt), desc(sql`rowid`))
          .limit(1)
          .pipe(Effect.mapError(failed('reading the last instructions given'))),
      ).pipe(Effect.map((rows) => rows[0]?.fingerprint ?? null))

    /**
     * Records one thing given to a Session, and says whether it is new.
     *
     * A base or a file the Session started with already recorded is not written a second time:
     * the unique index over the Session, the kind, the path and the fingerprint is the rule for
     * those, and null here is something the agent already has. A delivery is always written.
     */
    const record = (
      sessionId: string,
      kind: DeliveryKind,
      path: string,
      fingerprint: string,
    ): Effect.Effect<Recorded | null, DatabaseError> =>
      withDatabase(
        database
          .insert(contextDeliveries)
          .values({
            id: crypto.randomUUID(),
            sessionId,
            kind,
            path,
            fingerprint,
            deliveredAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning({
            kind: contextDeliveries.kind,
            path: contextDeliveries.path,
            fingerprint: contextDeliveries.fingerprint,
            deliveredAt: contextDeliveries.deliveredAt,
          })
          .pipe(Effect.mapError(failed('recording what was provided'))),
      ).pipe(
        Effect.map((rows) => {
          const row = rows.at(0)
          if (row === undefined) return null
          return {
            kind: kindOf(row.kind),
            path: row.path,
            fingerprint: row.fingerprint,
            deliveredAt: row.deliveredAt,
          }
        }),
      )

    /**
     * Whether the agent of this Session reads `AGENTS.md` itself under its bare mode, as its
     * adapter declares (D6-07). A Session with no agent yet reads as one that does not: it is
     * given the file rather than assumed to have it.
     */
    const readsItself = (sessionId: string): Effect.Effect<boolean, Refusal> =>
      sessions.one(sessionId).pipe(
        Effect.mapError((cause) =>
          cause instanceof UnknownSessionError
            ? cause
            : new DatabaseError({ doing: 'reading the Session of what it starts with', cause }),
        ),
        Effect.map(({ session }) =>
          session.provider === null
            ? false
            : bareModeOf(ADAPTERS[session.provider], process.platform).readsAgentsFile,
        ),
      )

    const start = (sessionId: string): Effect.Effect<Started, Refusal> =>
      Effect.gen(function* () {
        const root = yield* rootOf(sessionId)
        const instructions = yield* instructionsOf(root)
        yield* record(sessionId, 'base', '', fingerprintOf(CONTEXT_BASE))
        if (instructions === null) return { base: CONTEXT_BASE, instructions: null }
        const reads = yield* readsItself(sessionId)
        yield* record(
          sessionId,
          reads ? 'native' : 'provided',
          AGENTS_FILE,
          instructions.fingerprint,
        )
        return {
          base: CONTEXT_BASE,
          instructions: {
            path: AGENTS_FILE,
            fingerprint: instructions.fingerprint,
            given: reads ? null : instructions.text,
          },
        }
      })

    const pending = (sessionId: string): Effect.Effect<Pending | null, Refusal> =>
      Effect.gen(function* () {
        const root = yield* rootOf(sessionId)
        const read = yield* instructionsOf(root)
        const before = yield* lastGiven(sessionId)
        // A file deleted or renamed away after the agent read it is a change too: the agent still
        // holds the old instructions, and it is told they are now empty. A Workspace that never
        // had one has nothing to say.
        if (read === null && before === null) return null
        const instructions = read ?? { text: '', fingerprint: fingerprintOf('') }
        // What the agent holds is what it was last given, read at the start or delivered since:
        // a file that reads as that is not a change, and one that reads as anything else is.
        if (before === instructions.fingerprint) return null
        return {
          path: AGENTS_FILE,
          before,
          fingerprint: instructions.fingerprint,
          text: deliveryText(instructions.text),
          content: instructions.text,
        }
      })

    const delivered = (sessionId: string, given: Pending): Effect.Effect<Delivery, Refusal> =>
      Effect.gen(function* () {
        const written = yield* record(sessionId, 'instructions', given.path, given.fingerprint)
        // A delivery row is always new — the unique index leaves them out — so this is the row
        // just written; a base or the file a Session started with never reaches here.
        const row = written ?? {
          kind: 'instructions' as const,
          path: given.path,
          fingerprint: given.fingerprint,
          deliveredAt: new Date().toISOString(),
        }
        return { ...row, reached: 'delivery_prompt' as const }
      })

    /**
     * How the base reaches the agent of this Session: by the means its adapter declares, on the
     * platform this engine runs on (D6-07). A Session with no agent yet has been given nothing, and
     * reads as the means of the agents that have no system prompt to take it.
     */
    const baseReachOf = (sessionId: string): Effect.Effect<BaseReach, Refusal> =>
      sessions.one(sessionId).pipe(
        Effect.mapError((cause) =>
          cause instanceof UnknownSessionError
            ? cause
            : new DatabaseError({ doing: 'reading the Session of what it was provided', cause }),
        ),
        Effect.map(({ session }) =>
          session.provider === null
            ? 'embedded_resource'
            : bareModeOf(ADAPTERS[session.provider], process.platform).base,
        ),
      )

    const provided = (sessionId: string): Effect.Effect<Delivery[], Refusal> =>
      Effect.gen(function* () {
        const base = yield* baseReachOf(sessionId)
        const rows = yield* rowsOf(sessionId)
        const reachOf = (kind: DeliveryKind): ContextReach => {
          switch (kind) {
            case 'base':
              return base
            case 'native':
              return 'read_natively'
            case 'provided':
              return 'session_start'
            case 'instructions':
              return 'delivery_prompt'
          }
        }
        return rows.map((row): Delivery => ({
          kind: row.kind,
          path: row.path,
          fingerprint: row.fingerprint,
          deliveredAt: row.deliveredAt,
          reached: reachOf(row.kind),
        }))
      })

    return { start, pending, delivered, provided }
  }),
)
