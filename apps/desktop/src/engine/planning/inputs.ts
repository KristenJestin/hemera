/**
 * The human inputs of Planning (#86, CT-26): every answer version, "I'm waiting on someone", vision,
 * Discuss decision (#87) and dismissed finding (#91) is received, then delivered to the Planner,
 * then integrated by it. A received input is not an integrated one: completeness and the Freeze
 * wait for every input to be integrated.
 *
 * The port the other Planning tickets call:
 * - `receiveInput(transaction, input)` in the transaction that stores what the input refers to;
 * - then, once committed, `deliverInputs(missionId)` (`calls.ts`), which hands every received
 *   input to the Planner through `PlannerWake` (`handover.ts` prepares the deliveries).
 *
 * An input is delivered when the session took the delivery that carries it (`deliveredIn`, at the
 * start of the Planner's turn and in every transaction that needs to know). A delivery the session
 * gives back because its agent never took the turn makes its inputs received again (`giveBack`).
 */

import { type InputKind, INPUT_KINDS } from '@hemera/core/domain'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { planningInputs, questions, sessionDeliveries } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** An input as its ticket hands it over. */
export interface InputReceived {
  readonly missionId: string
  readonly kind: InputKind
  /** What it refers to: a question (`Q3`), a vision, a decision, a finding. */
  readonly item: string
  /** The version of that item, when it has versions. */
  readonly version: number | null
  /** What the Planner is told of it. */
  readonly said: string
  /** Whether it replaces the inputs of the same item not integrated yet (a changed answer). */
  readonly supersedes: boolean
}

const now = (): string => new Date().toISOString()

export const inputKindOf = (text: string): InputKind =>
  INPUT_KINDS.find((one) => one === text) ?? 'answer'

/**
 * Records an input, received, in the transaction given: `I1`, `I2`… per mission, never reused. An
 * input that supersedes leaves the earlier ones of its item that were not integrated superseded.
 */
export const receiveInput = (transaction: EngineTransaction, input: InputReceived) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const [counted] = yield* transaction
      .select({ total: count() })
      .from(planningInputs)
      .where(eq(planningInputs.missionId, input.missionId))
      .pipe(Effect.mapError(refusedWhile('numbering an input')))
    const number = (counted?.total ?? 0) + 1
    const id = `I${String(number)}`
    if (input.supersedes) {
      yield* transaction
        .update(planningInputs)
        .set({ state: 'superseded', supersededBy: id })
        .where(
          and(
            eq(planningInputs.missionId, input.missionId),
            eq(planningInputs.item, input.item),
            inArray(planningInputs.state, ['received', 'delivered']),
          ),
        )
        .pipe(Effect.mapError(refusedWhile('superseding an input')))
    }
    yield* transaction
      .insert(planningInputs)
      .values({
        missionId: input.missionId,
        id,
        number,
        kind: input.kind,
        item: input.item,
        itemVersion: input.version,
        said: secrets.mask(input.said),
        state: 'received',
        receivedAt: now(),
      })
      .pipe(Effect.mapError(refusedWhile('receiving an input')))
    return id
  })

/**
 * Marks delivered the received inputs of a mission whose delivery a session took, in the
 * transaction given; answers `planning.inputs_delivered` naming them, or nothing.
 */
export const deliveredIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const taken = yield* transaction
      .select({ id: planningInputs.id, at: sessionDeliveries.sentAt })
      .from(planningInputs)
      .innerJoin(sessionDeliveries, eq(sessionDeliveries.id, planningInputs.deliveryId))
      .where(
        and(
          eq(planningInputs.missionId, missionId),
          eq(planningInputs.state, 'received'),
          eq(sessionDeliveries.state, 'sent'),
        ),
      )
      .orderBy(asc(planningInputs.number))
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    if (taken.length === 0) return []
    for (const one of taken) {
      yield* transaction
        .update(planningInputs)
        .set({ state: 'delivered', deliveredAt: one.at ?? now() })
        .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.id, one.id)))
        .pipe(Effect.mapError(refusedWhile('marking an input delivered')))
    }
    const event: NewEvent = {
      type: 'planning.inputs_delivered',
      entityKind: 'mission',
      entityId: missionId,
      source: 'system',
      author: 'hemera',
      payload: { ids: taken.map((one) => one.id) },
    }
    return [event]
  })

/**
 * The inputs a session took are delivered, with their event. Looked at first without writing: most
 * turns carry no input, and they take no turn of the write lock for it.
 */
export const markDelivered = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [waiting] = yield* database
      .select({ id: planningInputs.id })
      .from(planningInputs)
      .where(and(eq(planningInputs.missionId, missionId), eq(planningInputs.state, 'received')))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    if (waiting === undefined) return
    yield* mutate('marking inputs delivered', (transaction) =>
      Effect.map(deliveredIn(transaction, missionId), (events) => ({ result: undefined, events })),
    )
  })

/** What completeness reads of the inputs and the questions, in the transaction given. */
export const pendingIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const pending = yield* transaction
      .select()
      .from(planningInputs)
      .where(
        and(
          eq(planningInputs.missionId, missionId),
          inArray(planningInputs.state, ['received', 'delivered']),
        ),
      )
      .orderBy(asc(planningInputs.number))
      .pipe(Effect.mapError(refusedWhile('reading the inputs')))
    const open = yield* transaction
      .select({ id: questions.id, state: questions.state })
      .from(questions)
      .where(and(eq(questions.missionId, missionId), inArray(questions.state, ['open', 'waiting'])))
      .orderBy(asc(questions.number))
      .pipe(Effect.mapError(refusedWhile('reading the questions')))
    return {
      pendingInputs: pending.map((one) => ({
        id: one.id,
        kind: inputKindOf(one.kind),
        item: one.item,
        version: one.itemVersion,
        state: one.state === 'received' ? ('received' as const) : ('delivered' as const),
      })),
      openQuestions: open.map((one) => ({
        id: one.id,
        state: one.state === 'waiting' ? ('waiting' as const) : ('open' as const),
      })),
    }
  })
