/**
 * What an agent is provided, and how a change of it reaches it (D6-07, D6-08).
 *
 * The base is `CONTEXT_BASE`, the three sentences every Session is given once, by whatever means
 * its adapter has. The Project's instructions are the `AGENTS.md` at the root of the Workspace,
 * which the three agents read themselves: the fingerprint of what was there at the start is
 * recorded, and the Context view says the file was read natively rather than sent. Sending it
 * would be a second injection of a text the agent already has.
 *
 * A change during a Session is not a prompt either. It waits, and is handed over between two
 * turns as its own text carrying the marker that says who wrote it, recorded once per
 * fingerprint, so the same text is never delivered twice to the same Session — the table's own
 * unique index is what enforces that rather than this service remembering to.
 *
 * Nothing here watches the filesystem. The safe point is the caller's, and `pending` reads the
 * file then, which is the only moment the answer is worth anything. The entry a delivery makes
 * in the thread is the caller's too: it is written when the text is handed over, by the one that
 * hands it over, and not by the service that computed it.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENTS_FILE, CONTEXT_BASE, deliveryText } from '@hemera/core'
import { eq } from 'drizzle-orm'
import { Context as EffectContext, Effect, Layer } from 'effect'

import { Projects, UnknownProjectError } from '../projects.ts'
import { Sessions, UnknownSessionError } from '../sessions.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import { type ContextDeliveryKind, contextDeliveries } from '../storage/schema.ts'

/** How a source of the provided context is named, in the table and under the same name in a view. */
export type DeliveryKind = ContextDeliveryKind

/** One thing a Session was provided, as the Context view lists it. */
export interface Delivery {
  readonly kind: DeliveryKind
  /** The file it came from, and `''` for the base, which is not a file. */
  readonly path: string
  readonly fingerprint: string
  readonly deliveredAt: string
}

/** What a Session is given when it starts. */
export interface Started {
  /** Word for word what the adapter hands the agent once. */
  readonly base: string
  /** The instructions as they stood, and their fingerprint; null without the file. */
  readonly instructions: { readonly path: string; readonly fingerprint: string } | null
}

/** What waits for the next safe point. */
export interface Pending {
  readonly path: string
  readonly fingerprint: string
  /** The text as it is handed over: the marker, and the instructions as they now read. */
  readonly text: string
}

/** What a delivery leaves behind: what to hand over, and what to record in the thread. */
export interface Delivered {
  readonly record: Delivery
  readonly text: string
}

/** What this service provides a Session, and what it can be refused with. */
export interface ContextService {
  /** Records what a Session starts with, and hands back what its adapter gives it. */
  readonly start: (sessionId: string) => Effect.Effect<Started, Refusal>
  /** What waits for the next safe point, if anything. */
  readonly pending: (sessionId: string) => Effect.Effect<Pending | null, Refusal>
  /**
   * Hands over what waits: the row, once, and the text to give the agent between two turns.
   *
   * Null when nothing waits, and null again for a text that was already given — which is not a
   * failure but the ordinary answer of a Session whose instructions did not change.
   */
  readonly deliver: (sessionId: string) => Effect.Effect<Delivered | null, Refusal>
  /** Everything a Session was provided, oldest first. */
  readonly provided: (sessionId: string) => Effect.Effect<Delivery[], Refusal>
}

/** Everything a delivery can be refused with. */
type Refusal = DatabaseError | UnknownProjectError | UnknownSessionError | UnreadableInstructionsError

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
        const { session } = yield* sessions.one(sessionId).pipe(
          Effect.mapError((cause) =>
            cause instanceof UnknownSessionError
              ? cause
              : new DatabaseError({ doing: 'reading the Session of a delivery', cause }),
          ),
        )
        const all = yield* projects.list(true).pipe(
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
        case 'instructions':
          return kind
        default:
          return 'instructions'
      }
    }

    /** Everything a Session was provided, oldest first: what the Context view lists. */
    const rowsOf = (sessionId: string): Effect.Effect<Delivery[], DatabaseError> =>
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
     * Records one thing given to a Session, and says whether it is new.
     *
     * A row that is already there is not written a second time: the unique index over the
     * Session, the kind, the path and the fingerprint is the rule, and a delivery that returns
     * null here is a delivery the agent already has.
     */
    const record = (
      sessionId: string,
      kind: DeliveryKind,
      path: string,
      fingerprint: string,
    ): Effect.Effect<Delivery | null, DatabaseError> =>
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

    const start = (sessionId: string): Effect.Effect<Started, Refusal> =>
      Effect.gen(function* () {
          const root = yield* rootOf(sessionId)
          const instructions = yield* instructionsOf(root)
          yield* record(sessionId, 'base', '', fingerprintOf(CONTEXT_BASE))
          if (instructions === null) return { base: CONTEXT_BASE, instructions: null }
          yield* record(sessionId, 'native', AGENTS_FILE, instructions.fingerprint)
        return {
          base: CONTEXT_BASE,
          instructions: { path: AGENTS_FILE, fingerprint: instructions.fingerprint },
        }
      })

    const pending = (sessionId: string): Effect.Effect<Pending | null, Refusal> =>
      Effect.gen(function* () {
          const root = yield* rootOf(sessionId)
          const instructions = yield* instructionsOf(root)
          if (instructions === null) return null
          const given = yield* rowsOf(sessionId)
          // The fingerprint recorded at the start counts as given, whatever the kind: the agent
          // read that text itself, and a file that reads again as it did is not a change.
          const same = given.some(
            (one) => one.path === AGENTS_FILE && one.fingerprint === instructions.fingerprint,
          )
          if (same) return null
        return {
          path: AGENTS_FILE,
          fingerprint: instructions.fingerprint,
          text: deliveryText(instructions.text),
        }
      })

    const deliver = (sessionId: string): Effect.Effect<Delivered | null, Refusal> =>
      Effect.gen(function* () {
          const waiting = yield* pending(sessionId)
          if (waiting === null) return null
          const record_ = yield* record(
            sessionId,
            'instructions',
            waiting.path,
            waiting.fingerprint,
          )
          if (record_ === null) return null
        return { record: record_, text: waiting.text }
      })

    return { start, pending, deliver, provided: rowsOf }
  }),
)
