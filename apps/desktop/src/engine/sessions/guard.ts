/**
 * CT-14's technical retries (#41): the replacements of a lineage are counted in a sliding window
 * of 30 minutes, and the third makes an error need on its owner, "the agent keeps failing", with
 * the three reasons and the last lines each session wrote. A restart's resume counts nowhere, and
 * the count begins anew once the user answered such a need. A replacement spends no business
 * attempt and no launch: nothing here touches the budget.
 */

import { REPLACEMENTS_ALLOWED, REPLACEMENT_WINDOW_MINUTES } from '@hemera/core/domain'
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm'
import { Effect, Layer, Option, Schema } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { agentSessions, domainEvents, needs, sessionNeeds } from '../storage/schema.ts'
import { keepsFailing } from './needs.ts'
import { ReplacementGuard } from './ports.ts'
import { RoleRegistry, roleNamed } from './roles.ts'
import type { RoleSession } from './store.ts'
import { threadOf } from './thread.ts'

/** The reason a restart's rebuild gives its replacements: never counted. */
export const RESTARTED = 'Hemera restarted'

/** The most of a session's last words an error need quotes. */
const OUTPUT_LINES = 20

const Replaced = Schema.Struct({ lineage: Schema.String, reason: Schema.String })
const readReplaced = Schema.decodeUnknownOption(Schema.fromJsonString(Replaced))

/** When the user last answered a lineage's "keeps failing" need, or null. */
const lastAnswered = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ at: needs.endedAt })
      .from(sessionNeeds)
      .innerJoin(needs, eq(needs.id, sessionNeeds.needId))
      .innerJoin(agentSessions, eq(agentSessions.id, sessionNeeds.sessionId))
      .where(
        and(
          eq(sessionNeeds.reason, 'failing'),
          eq(agentSessions.lineage, lineage),
          isNotNull(needs.endedAt),
        ),
      )
      .orderBy(desc(needs.endedAt))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the lineage’s needs')))
    return row?.at ?? null
  })

/** The counted replacements of a lineage since a moment: the session replaced and why. */
const replacementsSince = (lineage: string, since: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ sessionId: domainEvents.entityId, payload: domainEvents.payload })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.type, 'session.replaced'),
          gte(domainEvents.occurredAt, since),
          sql`json_extract(${domainEvents.payload}, '$.lineage') = ${lineage}`,
        ),
      )
      .orderBy(domainEvents.sequence)
      .pipe(Effect.mapError(refusedWhile('reading the lineage’s replacements')))
    return rows.flatMap((row) =>
      Option.match(readReplaced(row.payload), {
        onNone: () => [],
        onSome: (payload) =>
          payload.reason === RESTARTED ? [] : [{ sessionId: row.sessionId, what: payload.reason }],
      }),
    )
  })

/** The last lines a session wrote, as its thread kept them. */
const lastWords = (sessionId: string) =>
  Effect.map(threadOf(sessionId), (lines) => {
    const said = lines.filter((line) => line.kind === 'said').at(-1)?.text ?? ''
    return said.split('\n').slice(-OUTPUT_LINES).join('\n')
  })

const allows = (session: RoleSession, reason: string) =>
  Effect.gen(function* () {
    const windowStart = new Date(Date.now() - REPLACEMENT_WINDOW_MINUTES * 60_000).toISOString()
    const answered = yield* lastAnswered(session.lineage)
    const since = answered !== null && answered > windowStart ? answered : windowStart
    const earlier = yield* replacementsSince(session.lineage, since)
    if (earlier.length < REPLACEMENTS_ALLOWED) return { allowed: true } as const
    const attempts = yield* Effect.forEach(
      [...earlier.slice(-REPLACEMENTS_ALLOWED), { sessionId: session.id, what: reason }],
      (one) => Effect.map(lastWords(one.sessionId), (output) => ({ what: one.what, output })),
    )
    const roleName = roleNamed(yield* RoleRegistry, session.role)?.displayName ?? session.role
    return {
      allowed: false,
      why: 'the agent keeps failing',
      need: keepsFailing(session, roleName, attempts),
    } as const
  })

/** The `ReplacementGuard` of CT-14. */
export const replacementGuardLayer = Layer.effect(
  ReplacementGuard,
  Effect.map(Effect.context<Database | RoleRegistry>(), (context) => ({
    allows: (session: RoleSession, reason: string) =>
      allows(session, reason).pipe(Effect.provide(context)),
  })),
)
