/**
 * How the inputs of Planning reach the Planner (#86, CT-26): the received inputs of a mission are
 * carried by one session delivery per kind (`[hemera:answers]` for answers and waiting marks),
 * stored in the same transaction that names it on the inputs. A delivery still queued when another
 * input arrives is set aside and its inputs travel again with the new one, so the Planner gets them
 * together at its next safe point, once. One whose delivery never left (a stop, a crash) is carried
 * again by the next call, or at the engine's next start. The user's Discuss messages (#87) travel
 * the same way, as one `[hemera:discuss]`.
 */

import type { InputKind } from '@hemera/core/domain'
import type { DiscussionItem } from '@hemera/ipc'
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { Effect } from 'effect'

import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  discussionMessages,
  discussions,
  planningInputs,
  sessionDeliveries,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { discussionInputs } from './discussion-inputs.ts'
import {
  discussionSaid,
  discussionsIn,
  itemContent,
  openDiscussionsIn,
} from './discussion-store.ts'
import { deliveredIn, inputKindOf } from './inputs.ts'
import { specIn } from './store.ts'

/** The delivery kind each input travels under. */
export const DELIVERY_KIND: Readonly<Record<InputKind, string>> = {
  answer: 'answers',
  waiting: 'answers',
  vision: 'vision',
  discuss_decision: 'decision',
  dismissed_finding: 'findings',
  triage_kept: 'triage-kept',
  dependency_accepted: 'dependency',
}

/** What closes a delivery of inputs: what the Planner does with each. */
export const INPUTS_CLOSING =
  'Integrate each into the Spec as it comes, then call input_integrated with its id and where it went, or { "no_change": why }.'

/** One delivery of inputs, as `PlannerWake.deliver` hands it over. */
export interface InputsDelivery {
  readonly id: string
  readonly kind: string
  readonly body: string
}

/** The item's content now, from the Spec and #86's questions; null when it has no such item. */
export const contentIn = (
  transaction: EngineTransaction,
  missionId: string,
  item: DiscussionItem,
) =>
  Effect.gen(function* () {
    const spec = yield* specIn(transaction, missionId)
    const question =
      item.kind === 'question'
        ? yield* discussionInputs.question(transaction, missionId, item.id)
        : null
    return itemContent(spec, item, question)
  })

/** What closes a `[hemera:discuss]`: how the Planner answers. */
export const DISCUSS_CLOSING =
  'Answer it with discussion_reply; propose the decision with discussion_propose_decision once one is in sight.'

/**
 * The `[hemera:discuss]` that carries the user's messages not handed over yet (#87), stored queued
 * in the transaction given, each message naming it: one delivery for every discussion such a
 * message is in, with its item now and the whole exchange. A delivery of them still queued is set
 * aside and its messages travel again in the new one, so messages said during a turn reach the
 * Planner once, together, at its next safe point. Null when every message was handed over.
 */
const discussDeliveryIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const owed = yield* transaction
      .select({
        sequence: discussionMessages.sequence,
        discussionId: discussionMessages.discussionId,
        deliveryId: discussionMessages.deliveryId,
      })
      .from(discussionMessages)
      .innerJoin(discussions, eq(discussions.id, discussionMessages.discussionId))
      .leftJoin(sessionDeliveries, eq(sessionDeliveries.id, discussionMessages.deliveryId))
      .where(
        and(
          eq(discussions.missionId, missionId),
          eq(discussionMessages.author, 'user'),
          or(isNull(discussionMessages.deliveryId), eq(sessionDeliveries.state, 'queued')),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the messages to deliver')))
    if (owed.length === 0) return null
    const earlier = [
      ...new Set(owed.flatMap((one) => (one.deliveryId === null ? [] : [one.deliveryId]))),
    ]
    if (earlier.length > 0) {
      yield* transaction
        .update(sessionDeliveries)
        .set({ state: 'superseded' })
        .where(and(inArray(sessionDeliveries.id, earlier), eq(sessionDeliveries.state, 'queued')))
        .pipe(Effect.mapError(refusedWhile('setting a delivery aside')))
    }
    const concerned = new Set(owed.map((one) => one.discussionId))
    const parts: string[] = []
    for (const discussion of yield* discussionsIn(transaction, missionId)) {
      if (!concerned.has(discussion.id)) continue
      const content = yield* contentIn(transaction, missionId, discussion.item)
      parts.push(discussionSaid(discussion, content))
      if (discussion.state === 'closed') {
        parts.push(`The user has closed ${discussion.label} since: nothing more to answer there.`)
      }
    }
    const body = [...parts, DISCUSS_CLOSING].join('\n\n')
    // `discuss` is a lowercase word: a refusal would be a defect.
    const id = yield* storeDeliveryIn(transaction, {
      owner: { kind: 'mission', missionId },
      target: { role: 'planner' },
      kind: 'discuss',
      body,
    }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
    yield* transaction
      .update(discussionMessages)
      .set({ deliveryId: id })
      .where(
        inArray(
          discussionMessages.sequence,
          owed.map((one) => one.sequence),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('naming the delivery of a message')))
    return { id, kind: 'discuss', body } satisfies InputsDelivery
  })

/**
 * The deliveries that carry what the user said and the Planner was not handed yet, stored queued in
 * the transaction given: the messages of the discussions first (`[hemera:discuss]`), then the
 * received inputs, one delivery per delivery kind, each input naming it. A delivery of them still
 * queued is set aside, what it carried travelling again in the new one; nothing when nothing waits.
 * Answers the deliveries and the events of the inputs a session took meanwhile.
 */
export const prepareDeliveriesIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const events = yield* deliveredIn(transaction, missionId)
    const deliveries: InputsDelivery[] = []
    const discuss = yield* discussDeliveryIn(transaction, missionId)
    if (discuss !== null) deliveries.push(discuss)
    const received = yield* transaction
      .select()
      .from(planningInputs)
      .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.state, 'received')))
      .orderBy(asc(planningInputs.number))
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    // A Discuss proposal waits on the user while its discussion is open: never sent to its author.
    const discussing = new Set(
      (yield* openDiscussionsIn(transaction, missionId)).map((one) => one.label),
    )
    const waiting = received.filter(
      (one) => !(inputKindOf(one.kind) === 'discuss_decision' && discussing.has(one.item)),
    )
    // A superseded input's delivery, still queued, no longer says what holds.
    const replaced = yield* transaction
      .select({ deliveryId: planningInputs.deliveryId })
      .from(planningInputs)
      .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.state, 'superseded')))
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    const earlier = [
      ...new Set(
        [...waiting, ...replaced].flatMap((one) =>
          one.deliveryId === null ? [] : [one.deliveryId],
        ),
      ),
    ]
    // Not taken yet (the takings are marked above, in this same transaction): set aside.
    if (earlier.length > 0) {
      yield* transaction
        .update(sessionDeliveries)
        .set({ state: 'superseded' })
        .where(and(inArray(sessionDeliveries.id, earlier), eq(sessionDeliveries.state, 'queued')))
        .pipe(Effect.mapError(refusedWhile('setting a delivery aside')))
    }
    for (const kind of new Set(waiting.map((one) => DELIVERY_KIND[inputKindOf(one.kind)]))) {
      const carried = waiting.filter((one) => DELIVERY_KIND[inputKindOf(one.kind)] === kind)
      const body = [...carried.map((one) => `${one.id} · ${one.said}`), INPUTS_CLOSING].join('\n\n')
      // Every kind here is a lowercase word: a refusal would be a defect.
      const id = yield* storeDeliveryIn(transaction, {
        owner: { kind: 'mission', missionId },
        target: { role: 'planner' },
        kind,
        body,
      }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
      yield* transaction
        .update(planningInputs)
        .set({ deliveryId: id })
        .where(
          and(
            eq(planningInputs.missionId, missionId),
            inArray(
              planningInputs.id,
              carried.map((one) => one.id),
            ),
          ),
        )
        .pipe(Effect.mapError(refusedWhile('naming the delivery of an input')))
      deliveries.push({ id, kind, body })
    }
    return { deliveries, events }
  })

/** `prepareDeliveriesIn`, in a transaction of its own. */
export const prepareDeliveries = (missionId: string) =>
  mutate('handing inputs to the Planner', (transaction) =>
    Effect.map(prepareDeliveriesIn(transaction, missionId), ({ deliveries, events }) => ({
      result: deliveries,
      events,
    })),
  )

/**
 * The deliveries still queued for a mission's Planner, oldest first: what a stopped engine stored
 * and never handed over that is neither an input nor a message (a `[hemera:discussion-closed]`).
 * The engine's start hands them over again under their own ids, so a Planner starts for them.
 */
export const queuedForPlanner = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({
        id: sessionDeliveries.id,
        kind: sessionDeliveries.kind,
        body: sessionDeliveries.body,
      })
      .from(sessionDeliveries)
      .where(
        and(
          eq(sessionDeliveries.ownerKind, 'mission'),
          eq(sessionDeliveries.ownerId, missionId),
          isNull(sessionDeliveries.targetLineage),
          eq(sessionDeliveries.targetRole, 'planner'),
          eq(sessionDeliveries.state, 'queued'),
        ),
      )
      .orderBy(asc(sessionDeliveries.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the Planner’s deliveries')))
    return rows.map((row): InputsDelivery => ({ id: row.id, kind: row.kind, body: row.body }))
  })
