/**
 * Who may ask Hemera's tools, and for how long (design D6-01, D6-03).
 *
 * A Session's tools are served by one process, on a loopback address, and the only thing that
 * says which Session a call belongs to is the token the agent process was handed at
 * `session/new`. The token is therefore the whole of the identity: it names the Session, it
 * names the agent process that received it, and it is revoked when that process ends or when
 * the Session is released.
 *
 * Two things are deliberately absent. There is no way to ask this service what a token *is* —
 * `byId` names a grant by a digest, `byToken` answers with a grant and never with the secret —
 * and a refusal is answered by the caller with a generic error, so a foreign token learns
 * nothing about which Sessions exist. And a token is never an authorisation (D6-05): what a
 * token buys is the right to ask, never the right to be obeyed, which is why nothing in this
 * file is asked when a path leaves the workspace root.
 */

import { createHash, randomBytes } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'

import { type Mission, type ToolName, offeredTools } from '@hemera/core'

import { StderrSink } from '../agents/supervisor.ts'

/** What one agent process was given: the Session it serves, and what it may ask for. */
export interface AccessGrant {
  /** A digest of the token, which is what the diagnostics and the thread call it. */
  readonly id: string
  readonly sessionId: string
  /** The agent process the token was handed to: it ends, the grant ends with it. */
  readonly agentProcess: string
  readonly offered: readonly ToolName[]
  /**
   * Whether this agent may carry its token in the query of its address rather than in a bearer
   * header. False for every agent today: a URL is what a proxy logs and a crash report quotes,
   * and a header is not. An agent that can only be configured with a URL is the one reason for it.
   */
  readonly tokenInQuery: boolean
}

/** The grant and the secret itself, handed out once, at `session/new`. */
export interface GrantedAccess extends AccessGrant {
  readonly token: string
}

export interface ToolAccessService {
  /** Mints the token of one Session for one agent process, and revokes what came before it. */
  readonly granted: (
    sessionId: string,
    agentProcess: string,
    mission: Mission,
    tokenInQuery?: boolean,
  ) => Effect.Effect<GrantedAccess>
  /** The grant a token belongs to, and null for anything else — a foreign or a revoked one. */
  readonly byToken: (token: string | null) => Effect.Effect<AccessGrant | null>
  /** The same, by the digest the grant is named with in the thread and the diagnostics. */
  readonly byId: (id: string) => Effect.Effect<AccessGrant | null>
  /** Revokes every token of a Session, which is what releasing one does. */
  readonly revoked: (sessionId: string) => Effect.Effect<void>
  /** Whether a Session still has an agent process that may ask. */
  readonly live: (sessionId: string) => Effect.Effect<boolean>
  /**
   * Writes one line about a refused access, naming the Session when there is one and never the
   * token: a rejected call is something the user may have to understand, and the secret is not.
   */
  readonly refusedAccess: (line: string) => Effect.Effect<void>
}

export class ToolAccess extends Context.Service<ToolAccess, ToolAccessService>()('ToolAccess') {}

/** How much of a digest is enough to name a grant without naming the secret. */
const DIGEST_CHARACTERS = 12

/**
 * The grants of this engine run, in memory and nowhere else.
 *
 * Not in the database, and not in a file: a token that outlives the process that holds it is a
 * token this application would have to keep a secret for a year, and the engine mints a new one
 * at every start. Losing them at a crash is the intended behaviour — an agent whose engine died
 * has nothing to ask.
 */
export const toolAccessLayer: Layer.Layer<ToolAccess, never, StderrSink> = Layer.effect(
  ToolAccess,
  Effect.gen(function* () {
    const sink = yield* StderrSink
    const byToken = new Map<string, AccessGrant>()
    const byId = new Map<string, AccessGrant>()
    const bySession = new Map<string, string>()

    const write = (line: string) => sink.write(`tools: ${line}`)

    const forget = (sessionId: string) =>
      Effect.sync(() => {
        const id = bySession.get(sessionId)
        const grant = id === undefined ? undefined : byId.get(id)
        if (grant === undefined) return
        bySession.delete(sessionId)
        byId.delete(grant.id)
        for (const [token, held] of byToken) if (held.id === grant.id) byToken.delete(token)
      })

    return {
      granted: (sessionId, agentProcess, mission, tokenInQuery = false) =>
        Effect.gen(function* () {
          yield* forget(sessionId)
          const token = randomBytes(32).toString('base64url')
          const id = createHash('sha256').update(token).digest('hex').slice(0, DIGEST_CHARACTERS)
          const grant: AccessGrant = {
            id,
            sessionId,
            agentProcess,
            offered: offeredTools(mission),
            tokenInQuery,
          }
          byToken.set(token, grant)
          byId.set(id, grant)
          bySession.set(sessionId, id)
          yield* write(`granted to ${agentProcess} for a Session, as ${id}`)
          return { ...grant, token }
        }),

      byToken: (token) =>
        Effect.sync(() => (token === null ? undefined : byToken.get(token)) ?? null),

      byId: (id) => Effect.sync(() => byId.get(id) ?? null),

      revoked: forget,

      live: (sessionId) => Effect.sync(() => bySession.has(sessionId)),

      refusedAccess: (line) => write(line),
    }
  }),
)
