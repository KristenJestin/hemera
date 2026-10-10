/**
 * What the sessions used (#41): per session, the tokens in and out its agent reported at the end
 * of each turn, with those it read from and wrote to the prompt cache, and the cost it gave, marked measured; when it reports nothing, an estimate from
 * the text sent and said (four characters a token), marked estimated. A mission's usage is the sum
 * of its sessions', measured only when every part of it was; nothing when no session ran.
 */

import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { Database, refusedWhile } from '../storage/database.ts'
import { sessionUsage } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type RoleSession, ownerId } from './store.ts'

/** Characters a token is guessed at, for an agent that reports no usage. */
const CHARACTERS_A_TOKEN = 4

export const estimatedTokens = (text: string): number => Math.ceil(text.length / CHARACTERS_A_TOKEN)

const rowOf = (session: RoleSession) => ({
  sessionId: session.id,
  ownerKind: session.owner.kind,
  ownerId: ownerId(session.owner),
})

/** Adds a turn's tokens to a session's usage; one estimated turn makes the whole an estimate. */
export const addUsage = (
  session: RoleSession,
  tokens: {
    readonly input: number
    readonly output: number
    readonly cachedRead: number
    readonly cachedWrite: number
  },
  measured: boolean,
) =>
  mutate('counting a session’s usage', (transaction) =>
    Effect.gen(function* () {
      const [kept] = yield* transaction
        .select()
        .from(sessionUsage)
        .where(eq(sessionUsage.sessionId, session.id))
        .pipe(Effect.mapError(refusedWhile('reading a session’s usage')))
      const usage = {
        inputTokens: (kept?.inputTokens ?? 0) + tokens.input,
        outputTokens: (kept?.outputTokens ?? 0) + tokens.output,
        cachedReadTokens: (kept?.cachedReadTokens ?? 0) + tokens.cachedRead,
        cachedWriteTokens: (kept?.cachedWriteTokens ?? 0) + tokens.cachedWrite,
        measured: (kept?.measured ?? true) && measured,
      }
      yield* transaction
        .insert(sessionUsage)
        .values({ ...rowOf(session), ...usage, costAmount: null, costCurrency: null })
        .onConflictDoUpdate({ target: sessionUsage.sessionId, set: usage })
        .pipe(Effect.mapError(refusedWhile('counting a session’s usage')))
      return { result: undefined, events: [] }
    }),
  )

/** The cost the agent gives for its session so far, which replaces the one it gave before. */
export const setCost = (
  session: RoleSession,
  cost: { readonly amount: number; readonly currency: string },
) =>
  mutate('writing a session’s cost', (transaction) =>
    transaction
      .insert(sessionUsage)
      .values({
        ...rowOf(session),
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        measured: true,
        costAmount: cost.amount,
        costCurrency: cost.currency,
      })
      .onConflictDoUpdate({
        target: sessionUsage.sessionId,
        set: { costAmount: cost.amount, costCurrency: cost.currency },
      })
      .pipe(
        Effect.mapError(refusedWhile('writing a session’s cost')),
        Effect.as({ result: undefined, events: [] }),
      ),
  )

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedReadTokens: number
  readonly cachedWriteTokens: number
  /** Null when no session gave one, or they gave it in different currencies. */
  readonly cost: { readonly amount: number; readonly currency: string } | null
  readonly measured: boolean
}

/** A mission's usage, the sum of its sessions'; null when none of them ran a turn. */
export const missionUsage = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(sessionUsage)
      .where(and(eq(sessionUsage.ownerKind, 'mission'), eq(sessionUsage.ownerId, missionId)))
      .pipe(Effect.mapError(refusedWhile('reading the mission’s usage')))
    if (rows.length === 0) return null
    const costs = rows.flatMap((row) =>
      row.costAmount === null || row.costCurrency === null
        ? []
        : [{ amount: row.costAmount, currency: row.costCurrency }],
    )
    const currencies = new Set(costs.map((cost) => cost.currency))
    const [currency] = currencies
    const usage: Usage = {
      inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
      cachedReadTokens: rows.reduce((sum, row) => sum + row.cachedReadTokens, 0),
      cachedWriteTokens: rows.reduce((sum, row) => sum + row.cachedWriteTokens, 0),
      cost:
        currency === undefined || currencies.size > 1
          ? null
          : { amount: costs.reduce((sum, cost) => sum + cost.amount, 0), currency },
      measured: rows.every((row) => row.measured),
    }
    return usage
  })
