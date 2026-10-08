/**
 * How the inputs of Planning reach the Planner (#86, CT-26): the received inputs of a mission are
 * carried by one session delivery per kind (`[hemera:answers]` for answers and waiting marks),
 * stored in the same transaction that names it on the inputs. A delivery still queued when another
 * input arrives is set aside and its inputs travel again with the new one, so the Planner gets them
 * together at its next safe point, once. One whose delivery never left (a stop, a crash) is carried
 * again by the next call, or at the engine's next start.
 */

import type { InputKind } from '@hemera/core/domain'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { refusedWhile } from '../storage/database.ts'
import { planningInputs, sessionDeliveries } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { deliveredIn, inputKindOf } from './inputs.ts'

/** The delivery kind each input travels under. */
export const DELIVERY_KIND: Readonly<Record<InputKind, string>> = {
  answer: 'answers',
  waiting: 'answers',
  vision: 'vision',
  discuss_decision: 'decision',
  dismissed_finding: 'findings',
  triage_kept: 'triage-kept',
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

/**
 * The deliveries that carry a mission's received inputs, stored queued in one transaction: one per
 * delivery kind, each input naming it. A delivery of them still queued is set aside, its inputs
 * carried again by the new one; nothing when no input waits.
 */
export const prepareDeliveries = (missionId: string) =>
  mutate('handing inputs to the Planner', (transaction) =>
    Effect.gen(function* () {
      const events = yield* deliveredIn(transaction, missionId)
      const waiting = yield* transaction
        .select()
        .from(planningInputs)
        .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.state, 'received')))
        .orderBy(asc(planningInputs.number))
        .pipe(Effect.mapError(refusedWhile('reading the inputs')))
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
      const deliveries: InputsDelivery[] = []
      for (const kind of new Set(waiting.map((one) => DELIVERY_KIND[inputKindOf(one.kind)]))) {
        const carried = waiting.filter((one) => DELIVERY_KIND[inputKindOf(one.kind)] === kind)
        const body = [...carried.map((one) => `${one.id} · ${one.said}`), INPUTS_CLOSING].join(
          '\n\n',
        )
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
      return { result: deliveries, events }
    }),
  )
