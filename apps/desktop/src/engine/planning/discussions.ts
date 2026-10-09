/**
 * The user's side of the Discuss conversations (#87), as the Planning page calls it: open a
 * discussion on an item with a first message, say more, accept the Planner's proposal, or close it
 * on a decision of one's own or without one. Each gesture stores its delivery in its own
 * transaction (`prepareDeliveriesIn`: a message as `[hemera:discuss]`, a decision as an input that
 * travels as `[hemera:decision]`), so a stop between the two loses nothing; it is then handed to the
 * Planner through `PlannerWake` (CT-28): at its next safe point when it is in a turn, at once when it
 * is idle, and to a fresh Planner when none lives. A running turn is never cancelled.
 *
 * A mission's gestures run one at a time, each with its hand-over: a message and the close it races
 * are delivered in the order they were stored, never a message after the decision that closed it.
 * Two missions' gestures never wait on each other.
 */

import {
  type DiscussionClosing,
  type DiscussionItem,
  PlanningRefused,
  UnknownDiscussion,
  UnknownMission,
} from '@hemera/ipc'
import { type Masked, missionKey } from '@hemera/core/domain'
import { and, desc, eq } from 'drizzle-orm'
import { Effect, Semaphore, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { storeDeliveryIn } from '../sessions/deliveries.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { discussionMessages, discussions, missions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { handOver } from './calls.ts'
import { discussionInputs } from './discussion-inputs.ts'
import {
  closedSaid,
  discussionsOf,
  itemOf,
  itemSaid,
  labelOf,
  messageEvent,
  notPlanningSaid,
  readDiscussion,
} from './discussion-store.ts'
import { type InputsDelivery, contentIn, prepareDeliveriesIn } from './handover.ts'

/**
 * One gesture and its hand-over at a time, per mission: a discussion's, a Freeze, a return to
 * Planning (#92). A mission's lock is kept while a gesture holds it or waits for it, and dropped
 * with the last one.
 */
const missionLocks = new Map<string, { readonly lock: Semaphore.Semaphore; users: number }>()
export const oneAtATime =
  (missionId: string) =>
  <A, E, R>(gesture: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const found = missionLocks.get(missionId) ?? { lock: Semaphore.makeUnsafe(1), users: 0 }
        found.users += 1
        missionLocks.set(missionId, found)
        return found
      }),
      (found) => Semaphore.withPermits(found.lock, 1)(gesture),
      (found) =>
        Effect.sync(() => {
          found.users -= 1
          if (found.users === 0) missionLocks.delete(missionId)
        }),
    )

/** A mission that exists, or the refusal the user reads: nothing is locked for one that does not. */
const knownMission = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === undefined) return yield* new UnknownMission({ id: missionId })
  })

/** How many missions' locks are kept now. */
export const missionLocksKept = (): number => missionLocks.size

/** A gesture on a discussion, under its mission's lock. */
const onDiscussion = <A, E, R>(discussionId: string, gesture: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ missionId: discussions.missionId })
      .from(discussions)
      .where(eq(discussions.id, discussionId))
      .pipe(Effect.mapError(refusedWhile('reading the discussion')))
    if (row === undefined) return yield* new UnknownDiscussion({ id: discussionId })
    return yield* oneAtATime(row.missionId)(gesture)
  })

const now = (): string => new Date().toISOString()

/** The mission of a gesture, in Planning, or the refusal the user reads. */
const inPlanning = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const [mission] = yield* transaction
      .select()
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: missionId })
    const key = missionKey(mission.keyPrefix, mission.keyNumber)
    if (mission.stage !== 'planning') {
      return yield* new PlanningRefused({ reason: notPlanningSaid(key) })
    }
    return key
  })

/** An open discussion of a mission in Planning, or the refusal the user reads. */
const openOne = (transaction: EngineTransaction, discussionId: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(discussions)
      .where(eq(discussions.id, discussionId))
      .pipe(Effect.mapError(refusedWhile('reading the discussion')))
    if (row === undefined) return yield* new UnknownDiscussion({ id: discussionId })
    yield* inPlanning(transaction, row.missionId)
    if (row.state !== 'open') {
      return yield* new PlanningRefused({ reason: closedSaid(labelOf(row.number)) })
    }
    return row
  })

/** The user's text, masked; refused when there is none. */
const textOf = (text: string, refused: string) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const said = secrets.mask(text.trim())
    if (said === '') return yield* new PlanningRefused({ reason: refused })
    return said
  })

/** What a gesture stored: its discussion, and the deliveries to hand over once committed. */
interface Stored {
  readonly missionId: string
  readonly discussionId: string
  readonly deliveries: ReadonlyArray<InputsDelivery>
}

/** A user's message, stored with the deliveries that carry it. */
const sayIn = (
  transaction: EngineTransaction,
  row: { readonly id: string; readonly missionId: string },
  said: Masked<string>,
) =>
  Effect.gen(function* () {
    yield* transaction
      .insert(discussionMessages)
      .values({ discussionId: row.id, author: 'user', text: said, at: now() })
      .pipe(Effect.mapError(refusedWhile('writing the message')))
    return yield* prepareDeliveriesIn(transaction, row.missionId)
  })

/** Hands over what a gesture stored, then answers its discussion as it stands. */
const handedOver = (stored: Stored) =>
  Effect.andThen(handOver(stored.missionId, stored.deliveries), readDiscussion(stored.discussionId))

/** Opens a discussion on an item with the user's first message, stored with its delivery. */
export const recordOpen = (missionId: string, item: DiscussionItem, text: string) =>
  Effect.gen(function* () {
    const said = yield* textOf(text, 'A message needs some text.')
    return yield* mutate('opening a discussion', (transaction) =>
      Effect.gen(function* () {
        const key = yield* inPlanning(transaction, missionId)
        if ((yield* contentIn(transaction, missionId, item)) === null) {
          return yield* new PlanningRefused({ reason: `${key} has no ${item.kind} ${item.id}.` })
        }
        const [open] = yield* transaction
          .select({ number: discussions.number })
          .from(discussions)
          .where(
            and(
              eq(discussions.missionId, missionId),
              eq(discussions.itemKind, item.kind),
              eq(discussions.itemId, item.id),
              eq(discussions.state, 'open'),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading the discussions')))
        if (open !== undefined) {
          return yield* new PlanningRefused({
            reason: `${itemSaid(item)} already has an open discussion: ${labelOf(open.number)}.`,
          })
        }
        const [last] = yield* transaction
          .select({ number: discussions.number })
          .from(discussions)
          .where(eq(discussions.missionId, missionId))
          .orderBy(desc(discussions.number))
          .limit(1)
          .pipe(Effect.mapError(refusedWhile('numbering the discussion')))
        const number = (last?.number ?? 0) + 1
        const row = {
          id: crypto.randomUUID(),
          missionId,
          number,
          itemKind: item.kind,
          itemId: item.id,
          state: 'open',
          openedAt: now(),
        }
        yield* transaction
          .insert(discussions)
          .values(row)
          .pipe(Effect.mapError(refusedWhile('opening the discussion')))
        const prepared = yield* sayIn(transaction, row, said)
        return {
          result: {
            missionId,
            discussionId: row.id,
            deliveries: prepared.deliveries,
          } satisfies Stored,
          events: [
            {
              type: 'planning.discussion_opened',
              entityKind: 'mission',
              entityId: missionId,
              source: 'ui',
              author: 'human',
              payload: {
                discussionId: row.id,
                discussion: labelOf(number),
                itemKind: item.kind,
                itemId: item.id,
                item: itemSaid(item),
              },
            } satisfies NewEvent,
            ...prepared.events,
          ],
        }
      }),
    )
  })

/** Opens a discussion on an item with the user's first message, and delivers it. */
export const openDiscussion = (missionId: string, item: DiscussionItem, text: string) =>
  Effect.andThen(
    knownMission(missionId),
    oneAtATime(missionId)(
      Effect.flatMap(recordOpen(missionId, item, text), (stored) =>
        // Just opened, in this gesture: a discussion not there now is a defect.
        handedOver(stored).pipe(Effect.catchTag('UnknownDiscussion', Effect.die)),
      ),
    ),
  )

/** The user's next message, stored with its delivery; the caller hands it over. */
export const recordSay = (discussionId: string, text: string) =>
  Effect.gen(function* () {
    const said = yield* textOf(text, 'A message needs some text.')
    return yield* mutate('saying more in a discussion', (transaction) =>
      Effect.gen(function* () {
        const row = yield* openOne(transaction, discussionId)
        const prepared = yield* sayIn(transaction, row, said)
        return {
          result: { missionId: row.missionId, discussionId, deliveries: prepared.deliveries },
          events: [messageEvent(row, 'user'), ...prepared.events],
        }
      }),
    )
  })

/** The user's next message, delivered with the whole discussion. */
export const sayInDiscussion = (discussionId: string, text: string) =>
  onDiscussion(discussionId, Effect.flatMap(recordSay(discussionId, text), handedOver))

/** How a close was asked: on the pending proposal, on the user's decision, or without one. */
type Closing = { readonly accept: { readonly proposedAt: string } } | DiscussionClosing

/**
 * Closes a discussion: the decision goes to the register of inputs and travels as
 * `[hemera:decision]`; without one, the pending proposal is withdrawn and the Planner is told.
 */
const closeWith = (discussionId: string, closing: Closing) =>
  onDiscussion(
    discussionId,
    Effect.gen(function* () {
      const written =
        'decision' in closing
          ? yield* textOf(closing.decision, 'A decision needs some text.')
          : null
      const stored = yield* mutate('closing a discussion', (transaction) =>
        Effect.gen(function* () {
          const row = yield* openOne(transaction, discussionId)
          const label = labelOf(row.number)
          const decision = 'accept' in closing ? row.proposal : written
          if ('accept' in closing && decision === null) {
            return yield* new PlanningRefused({ reason: `${label} has no proposal to accept.` })
          }
          // Accepted as the user read it: a proposal made since is not the one they accept.
          if ('accept' in closing && row.proposedAt !== closing.accept.proposedAt) {
            return yield* new PlanningRefused({
              reason: `The proposal in ${label} changed since you read it: read “${row.proposal ?? ''}”, then accept it or decide otherwise.`,
            })
          }
          yield* transaction
            .update(discussions)
            .set({
              state: 'closed',
              outcome: decision === null ? 'no_decision' : 'decision',
              decision,
              proposal: null,
              proposedAt: null,
              closedBy: 'user',
              closedAt: now(),
            })
            .where(and(eq(discussions.id, discussionId), eq(discussions.state, 'open')))
            .pipe(Effect.mapError(refusedWhile('closing the discussion')))
          const on = `${label} on ${itemSaid(itemOf(row))}`
          if (decision === null) {
            yield* discussionInputs.withdrawn(transaction, row.missionId, label)
          } else {
            yield* discussionInputs.decided(transaction, {
              missionId: row.missionId,
              label,
              said: [
                `The user closed discussion ${on} on this decision${'accept' in closing ? ', your proposal as written' : ', written by the user'}:`,
                decision,
                `Write it into Decisions (the choice, the alternatives, why) with the link "discussion ${label}", or into the requirement it changes.`,
              ].join('\n\n'),
            })
          }
          // The decision is an input of the register: it travels as [hemera:decision] (CT-26).
          const prepared = yield* prepareDeliveriesIn(transaction, row.missionId)
          const deliveries = [...prepared.deliveries]
          if (decision === null) {
            const body = `The user closed discussion ${on} without a decision. Your pending proposal there, if any, is withdrawn: nothing to integrate.`
            // A lowercase word: a refusal would be a defect.
            const id = yield* storeDeliveryIn(transaction, {
              owner: { kind: 'mission', missionId: row.missionId },
              target: { role: 'planner' },
              kind: 'discussion-closed',
              body,
            }).pipe(Effect.catchTag('DeliveryKindRefused', Effect.die))
            deliveries.push({ id, kind: 'discussion-closed', body })
          }
          return {
            result: { missionId: row.missionId, discussionId, deliveries },
            events: [
              {
                type: 'planning.discussion_closed',
                entityKind: 'mission',
                entityId: row.missionId,
                source: 'ui',
                author: 'human',
                payload: {
                  discussionId,
                  discussion: label,
                  item: itemSaid(itemOf(row)),
                  outcome: decision === null ? 'no_decision' : 'decision',
                  decision,
                  accepted: 'accept' in closing,
                  by: 'user',
                },
              } satisfies NewEvent,
              ...prepared.events,
            ],
          }
        }),
      )
      return yield* handedOver(stored)
    }),
  )

/**
 * Closes it on the Planner's pending proposal, as written: the one the user read, made at
 * `proposedAt`; refused when the Planner proposed another since.
 */
export const acceptProposal = (discussionId: string, proposedAt: string) =>
  closeWith(discussionId, { accept: { proposedAt } })

/** Closes it on the user's own decision, or without a decision. */
export const closeDiscussion = (discussionId: string, closing: DiscussionClosing) =>
  closeWith(discussionId, closing)

/** A mission's discussions now, then again after each change of them, while the caller listens. */
export const discussionChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      return Stream.concat(
        Stream.fromEffect(discussionsOf(missionId)),
        committed.pipe(
          Stream.filter(
            (event) =>
              event.entityKind === 'mission' &&
              event.entityId === missionId &&
              (event.type.startsWith('planning.discussion_') ||
                event.type === 'planning.decision_proposed'),
          ),
          Stream.mapEffect(() => discussionsOf(missionId)),
        ),
      )
    }),
  )
