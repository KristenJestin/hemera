/**
 * Who may ask Hemera's tools, and for how long.
 *
 * An agent's process is handed one bearer token for its session, 32 random bytes minted when the
 * session's agent is started and revoked when the session ends or its process dies; minting again
 * for a session replaces its token. The token is kept only as its digest, in memory: a token never
 * outlives the engine that minted it, and nothing on disk can be replayed.
 *
 * A token names a grant: the session, its role, the place its paths are inside, and the tools it is
 * offered (the role's, minus any withdrawn from the session). A token is the right to ask, never
 * the right to be obeyed: every call still goes through the gate.
 *
 * A call is executed only while its grant is live, and counted against its mission until it ends:
 * once a mission's sessions are stopped, `settled` waits for the calls that were already executing.
 * A call the user allowed is refused once its mission's Building is exiting, until a Builder works
 * on it again.
 *
 * A refused access is answered generically by the server and written here, at most 20 lines a
 * minute, naming the session the token once served when it is known and never the token.
 */

import { createHash, randomBytes } from 'node:crypto'

import type { PlaceKind, Role, ToolName } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Log } from '../../main/diagnostic.ts'

/** What one agent process was given. */
export interface Grant {
  /** The digest of the token: what the record and the diagnostic call the caller. */
  readonly id: string
  readonly sessionId: string
  /** The session's epoch when the token was minted: a write at an older one is refused. */
  readonly epoch: number
  readonly role: Role
  readonly tools: ReadonlyArray<ToolName>
  readonly place: {
    readonly kind: PlaceKind
    readonly readOnly: boolean
    readonly root: string
    /**
     * A folder it reads beside its own, never writes (the Prototyper's Workspace, #145): the
     * repositories it names are there.
     */
    readonly readable?: string | undefined
  }
  /** The helper the session runs, for the question its call may become (#145); none otherwise. */
  readonly helper?:
    | { readonly label: string; readonly taskId: string | null; readonly depth: number }
    | undefined
  readonly projectId: string
  readonly missionId: string | null
  /** The Workspace the place is, or null for the main checkout or a place of its own. */
  readonly workspaceId: string | null
  /** Whether the place is the Project's main checkout. */
  readonly mainCheckout: boolean
}

export type GrantAsked = Omit<Grant, 'id'>

export class ToolAccess extends Context.Service<
  ToolAccess,
  {
    /** Mints the token of a session, revoking the one before; answers the token. */
    readonly mint: (asked: GrantAsked) => Effect.Effect<string>
    readonly byToken: (token: string | null) => Effect.Effect<Grant | null>
    readonly byId: (id: string) => Effect.Effect<Grant | null>
    /** Revokes the token of a session. */
    readonly revoke: (sessionId: string) => Effect.Effect<void>
    /** Takes tools away from a session's grant, from its next request. */
    readonly withdraw: (sessionId: string, tools: ReadonlyArray<ToolName>) => Effect.Effect<void>
    /** The session a token was minted for, live or revoked, for a refusal's line. */
    readonly sessionOf: (token: string | null) => Effect.Effect<string | null>
    /** Writes the line of a refused access, at most `REFUSALS_LOGGED` a minute. */
    readonly refused: (line: string) => Effect.Effect<void>
    /**
     * Runs a call's execution if its grant is still live, counted against its mission until it
     * ends; null, with nothing run, when the grant was revoked meanwhile.
     */
    readonly executing: <A, E, R>(
      grantId: string,
      execution: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A | null, E, R>
    /**
     * Runs a call the user allowed, counted against its mission until it ends: Hemera acts on it
     * with no grant of its own, so the call checks inside that its session was not stopped. Null,
     * with nothing run, when its mission's Building is exiting.
     */
    readonly counted: <A, E, R>(
      missionId: string | null,
      execution: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A | null, E, R>
    /** Marks a mission's Building as exiting: the calls the user allowed run no more. */
    readonly exiting: (missionId: string) => Effect.Effect<void>
    /** A Builder works on the mission again: the calls the user allowed run again. */
    readonly building: (missionId: string) => Effect.Effect<void>
    /** Waits until no call of a mission's grants is executing. */
    readonly settled: (missionId: string) => Effect.Effect<void>
  }
>()('ToolAccess') {}

/** How many refused accesses are written in a minute; the rest are counted, and said later. */
export const REFUSALS_LOGGED = 20

const REFUSAL_WINDOW_MS = 60_000

/** How many revoked grants are remembered, so a refusal can name the session a token served. */
const REVOKED_KEPT = 256

const digestOf = (token: string): string => createHash('sha256').update(token).digest('hex')

export const toolAccessLayer = (log: Log, clock: () => number = Date.now) =>
  Layer.sync(ToolAccess, () => {
    const byDigest = new Map<string, Grant>()
    const bySession = new Map<string, string>()
    const revokedSessions = new Map<string, string>()
    const refusals = { since: Number.NEGATIVE_INFINITY, written: 0, left: 0 }
    /** The calls executing, by mission, and who waits for them to end. */
    const executions = new Map<string, number>()
    const waiting = new Map<string, Array<Deferred.Deferred<void>>>()
    /** The missions whose Building is exiting. */
    const exits = new Set<string>()

    const begun = (missionId: string) =>
      executions.set(missionId, (executions.get(missionId) ?? 0) + 1)

    const ended = (missionId: string) =>
      Effect.suspend(() => {
        const left = (executions.get(missionId) ?? 1) - 1
        if (left > 0) {
          executions.set(missionId, left)
          return Effect.void
        }
        executions.delete(missionId)
        const woken = waiting.get(missionId) ?? []
        waiting.delete(missionId)
        return Effect.forEach(woken, (one) => Deferred.succeed(one, undefined), { discard: true })
      })

    const revoke = (sessionId: string) =>
      Effect.sync(() => {
        const digest = bySession.get(sessionId)
        if (digest === undefined) return
        bySession.delete(sessionId)
        byDigest.delete(digest)
        revokedSessions.set(digest, sessionId)
        for (const oldest of revokedSessions.keys()) {
          if (revokedSessions.size <= REVOKED_KEPT) break
          revokedSessions.delete(oldest)
        }
      })

    return {
      mint: (asked) =>
        Effect.gen(function* () {
          yield* revoke(asked.sessionId)
          const token = randomBytes(32).toString('base64url')
          const digest = digestOf(token)
          byDigest.set(digest, { ...asked, id: digest })
          bySession.set(asked.sessionId, digest)
          log(
            `tools: granted ${asked.role} tools to session ${asked.sessionId} (${digest.slice(0, 12)})`,
          )
          return token
        }),
      byToken: (token) =>
        Effect.sync(() => (token === null ? null : (byDigest.get(digestOf(token)) ?? null))),
      byId: (id) => Effect.sync(() => byDigest.get(id) ?? null),
      revoke,
      executing: (grantId, execution) =>
        Effect.acquireUseRelease(
          // Read and counted at once: a revoke either comes first and refuses it, or finds it
          // counted, so `settled` waits for it.
          Effect.sync(() => {
            const grant = byDigest.get(grantId) ?? null
            const missionId = grant?.missionId ?? null
            if (missionId !== null) begun(missionId)
            return { live: grant !== null, missionId }
          }),
          ({ live }) => (live ? execution : Effect.succeed(null)),
          ({ missionId }) => (missionId === null ? Effect.void : ended(missionId)),
        ),
      counted: (missionId, execution) =>
        Effect.acquireUseRelease(
          // Counted, then the mark read, at once: an exit either finds the call counted and waits
          // for it, or was marked first and the call runs nothing.
          Effect.sync(() => {
            if (missionId === null) return true
            begun(missionId)
            return !exits.has(missionId)
          }),
          (runs) => (runs ? execution : Effect.succeed(null)),
          () => (missionId === null ? Effect.void : ended(missionId)),
        ),
      exiting: (missionId) => Effect.sync(() => exits.add(missionId)),
      building: (missionId) => Effect.sync(() => exits.delete(missionId)),
      settled: (missionId) =>
        Effect.suspend(() => {
          if (!executions.has(missionId)) return Effect.void
          const one = Deferred.makeUnsafe<void>()
          waiting.set(missionId, [...(waiting.get(missionId) ?? []), one])
          return Deferred.await(one)
        }),
      withdraw: (sessionId, tools) =>
        Effect.sync(() => {
          const digest = bySession.get(sessionId)
          const grant = digest === undefined ? undefined : byDigest.get(digest)
          if (digest === undefined || grant === undefined) return
          byDigest.set(digest, {
            ...grant,
            tools: grant.tools.filter((tool) => !tools.includes(tool)),
          })
        }),
      sessionOf: (token) =>
        Effect.sync(() => {
          if (token === null) return null
          const digest = digestOf(token)
          return byDigest.get(digest)?.sessionId ?? revokedSessions.get(digest) ?? null
        }),
      refused: (line) =>
        Effect.sync(() => {
          // Anything on this machine can knock: a flood is a few lines and a count.
          const now = clock()
          if (now - refusals.since >= REFUSAL_WINDOW_MS) {
            refusals.since = now
            refusals.written = 0
          }
          if (refusals.written >= REFUSALS_LOGGED) {
            refusals.left += 1
            return
          }
          refusals.written += 1
          const left = refusals.left
          refusals.left = 0
          // A name a caller sent is part of the line, and a control character would forge another.
          const clean = line.replace(/\p{Cc}/gu, ' ')
          log(
            left === 0
              ? `tools: ${clean}`
              : `tools: ${clean} (${String(left)} refused request(s) before it were not logged)`,
          )
        }),
    }
  })
