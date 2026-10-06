/**
 * The deliveries as they are stored: written before they are sent, they belong to their owner and
 * their target (a session's lineage, or a role of the owner), never to one session, so a
 * replacement receives what its predecessor had not, and a restart loses none. A delivery is sent
 * once: marking it sent names the session that took it, in the transaction that takes it.
 */

import {
  DeliveryKindName,
  type DeliveryUrgency,
  type DeliveryState,
  DELIVERY_STATES,
  DELIVERY_URGENCIES,
} from '@hemera/core/domain'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { Effect, Schema } from 'effect'

import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { sessionDeliveries } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import type { SessionOwner } from './roles.ts'
import { type RoleSession, ownerId } from './store.ts'

/** Who a delivery is for: a session's line, or the live session of a role of the owner. */
export type DeliveryTarget = { readonly lineage: string } | { readonly role: string }

export interface DeliveryAsked {
  /** The delivery's own id: the same id is stored once (an approval is keyed by its request). */
  readonly id?: string
  readonly owner: SessionOwner
  readonly target: DeliveryTarget
  readonly kind: string
  readonly body: string
  readonly urgency?: DeliveryUrgency
}

export interface StoredDelivery {
  readonly id: string
  readonly owner: SessionOwner
  readonly targetLineage: string | null
  readonly targetRole: string | null
  readonly kind: string
  readonly body: string
  readonly urgency: DeliveryUrgency
  readonly state: DeliveryState
  readonly sentTo: string | null
}

/** A kind that is not a lowercase word would break the marker it travels under. */
export class DeliveryKindRefused extends Schema.TaggedError<DeliveryKindRefused>()(
  'DeliveryKindRefused',
  { kind: Schema.String },
) {
  override get message(): string {
    return `"${this.kind}" is not a delivery kind: a kind is a lowercase word.`
  }
}

const isKind = Schema.is(DeliveryKindName)

type Row = typeof sessionDeliveries.$inferSelect

const storedOf = (row: Row): StoredDelivery => ({
  id: row.id,
  owner:
    row.ownerKind === 'project'
      ? { kind: 'project', projectId: row.ownerId }
      : { kind: 'mission', missionId: row.ownerId },
  targetLineage: row.targetLineage,
  targetRole: row.targetRole,
  kind: row.kind,
  body: row.body,
  urgency: DELIVERY_URGENCIES.find((one) => one === row.urgency) ?? 'between-turns',
  state: DELIVERY_STATES.find((one) => one === row.state) ?? 'queued',
  sentTo: row.sentTo,
})

/** Stores a delivery, queued; one already stored under the same id is left as it is. */
export const storeDelivery = (asked: DeliveryAsked) =>
  Effect.gen(function* () {
    if (!isKind(asked.kind)) return yield* new DeliveryKindRefused({ kind: asked.kind })
    const secrets = yield* Secrets
    const id = asked.id ?? crypto.randomUUID()
    yield* mutate('storing a delivery', (transaction) =>
      transaction
        .insert(sessionDeliveries)
        .values({
          id,
          ownerKind: asked.owner.kind,
          ownerId: ownerId(asked.owner),
          targetLineage: 'lineage' in asked.target ? asked.target.lineage : null,
          targetRole: 'role' in asked.target ? asked.target.role : null,
          kind: asked.kind,
          body: secrets.mask(asked.body),
          urgency: asked.urgency ?? 'between-turns',
          state: 'queued',
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .pipe(
          Effect.mapError(refusedWhile('storing a delivery')),
          Effect.as({ result: undefined, events: [] }),
        ),
    )
    return id
  })

/** The deliveries queued for a session: for its lineage, or for its role with no lineage named. */
export const queuedFor = (session: RoleSession) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(sessionDeliveries)
      .where(
        and(
          eq(sessionDeliveries.ownerKind, session.owner.kind),
          eq(sessionDeliveries.ownerId, ownerId(session.owner)),
          eq(sessionDeliveries.state, 'queued'),
          or(
            eq(sessionDeliveries.targetLineage, session.lineage),
            and(
              isNull(sessionDeliveries.targetLineage),
              eq(sessionDeliveries.targetRole, session.role),
            ),
          ),
        ),
      )
      .orderBy(asc(sessionDeliveries.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the deliveries')))
    return rows.map(storedOf)
  })

/** Every delivery still queued, for the dispatch at a start. */
export const allQueued = Effect.gen(function* () {
  const database = yield* Database
  const rows = yield* database
    .select()
    .from(sessionDeliveries)
    .where(eq(sessionDeliveries.state, 'queued'))
    .orderBy(asc(sessionDeliveries.createdAt))
    .pipe(Effect.mapError(refusedWhile('reading the deliveries')))
  return rows.map(storedOf)
})

/**
 * Marks deliveries sent to a session, inside a transaction, and answers the ones that were still
 * queued: a delivery taken by another session meanwhile is not sent twice.
 */
export const markSent = (
  transaction: EngineTransaction,
  ids: ReadonlyArray<string>,
  sessionId: string,
) =>
  ids.length === 0
    ? Effect.succeed<ReadonlyArray<string>>([])
    : transaction
        .update(sessionDeliveries)
        .set({ state: 'sent', sentAt: new Date().toISOString(), sentTo: sessionId })
        .where(and(inArray(sessionDeliveries.id, [...ids]), eq(sessionDeliveries.state, 'queued')))
        .returning({ id: sessionDeliveries.id })
        .pipe(
          Effect.mapError(refusedWhile('marking deliveries sent')),
          Effect.map((rows) => rows.map((row) => row.id)),
        )

/** Deliveries sent to a session whose agent never took them: queued again, for whoever comes next. */
export const giveBack = (
  transaction: EngineTransaction,
  ids: ReadonlyArray<string>,
  sessionId: string,
) =>
  ids.length === 0
    ? Effect.void
    : transaction
        .update(sessionDeliveries)
        .set({ state: 'queued', sentAt: null, sentTo: null })
        .where(
          and(
            inArray(sessionDeliveries.id, [...ids]),
            eq(sessionDeliveries.sentTo, sessionId),
            eq(sessionDeliveries.state, 'sent'),
          ),
        )
        .pipe(Effect.mapError(refusedWhile('giving deliveries back')), Effect.asVoid)

/** The deliveries of an owner no longer to be sent: its sessions are stopped. */
export const supersedeAll = (transaction: EngineTransaction, owner: SessionOwner) =>
  transaction
    .update(sessionDeliveries)
    .set({ state: 'superseded' })
    .where(
      and(
        eq(sessionDeliveries.ownerKind, owner.kind),
        eq(sessionDeliveries.ownerId, ownerId(owner)),
        eq(sessionDeliveries.state, 'queued'),
      ),
    )
    .pipe(Effect.mapError(refusedWhile('setting deliveries aside')), Effect.asVoid)
