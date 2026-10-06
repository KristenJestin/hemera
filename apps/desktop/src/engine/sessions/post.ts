/**
 * What the role sessions share with the parts below them, without depending on them: the single
 * gate takes a session's urgent notes from here when it answers the session's next Hemera tool
 * call, and the `Delivery` port of the approvals rings here once it stored a result. The sessions
 * service listens on both. A board in memory: the deliveries themselves are in the database.
 */

import { Context, Deferred, Effect, Layer, PubSub, Stream } from 'effect'

import type { NeedHandler } from '../needs.ts'
import type { SessionOwner } from './roles.ts'

/** An urgent delivery, as a session's next tool result carries it. */
export interface PinnedNote {
  readonly deliveryId: string
  readonly sessionId: string
  /** The `<hemera-note>` block, ready to append. */
  readonly text: string
}

export class SessionPost extends Context.Service<
  SessionPost,
  {
    /** Something was stored for a session: whoever dispatches looks again. */
    readonly ring: Effect.Effect<void>
    readonly rings: Stream.Stream<void>
    /** A note for a session's next Hemera tool result. */
    readonly pin: (note: PinnedNote) => Effect.Effect<void>
    /** Takes back a note that was not picked up: it travels another way. */
    readonly unpin: (deliveryId: string) => Effect.Effect<boolean>
    /** The notes waiting for a session, taken: each is handed once. */
    readonly take: (sessionId: string) => Effect.Effect<ReadonlyArray<PinnedNote>>
    /** Each note as it was taken by a tool result. */
    readonly taken: Stream.Stream<PinnedNote>
    /**
     * Stops every session of an owner, children first: what a mission's cancel calls. The role
     * sessions put their `stopTree` here once they run; a stop asked before waits for it.
     */
    readonly stopTree: (owner: SessionOwner) => Effect.Effect<void>
    readonly stopWith: (stop: (owner: SessionOwner) => Effect.Effect<void>) => Effect.Effect<void>
    /** A session's turn began or ended: what a mission's activity reads. */
    readonly turning: (
      sessionId: string,
      missionId: string | null,
      on: boolean,
    ) => Effect.Effect<void>
    /** Whether a session of the mission is in a turn now. */
    readonly working: (missionId: string) => Effect.Effect<boolean>
    /**
     * The owner of the needs a session gives (#41): the needs register it below the sessions,
     * which put their handler here once they run.
     */
    readonly needs: NeedHandler
    readonly needsWith: (handler: NeedHandler) => Effect.Effect<void>
    /** A Hemera phase of a mission waits for a slot of the cap, said for Now; null once it has one. */
    readonly slotWait: (missionId: string, sentence: string | null) => Effect.Effect<void>
    readonly slotWaitOf: (missionId: string) => Effect.Effect<string | null>
  }
>()('SessionPost') {}

/** The post, built once: the Profile hands it to the parts below the sessions and above. */
const makeSessionPost: Effect.Effect<SessionPost['Service']> = Effect.gen(function* () {
  const rings = yield* PubSub.sliding<void>(1)
  const taken = yield* PubSub.unbounded<PinnedNote>()
  const pinned = new Map<string, PinnedNote>()
  const stopper = yield* Deferred.make<(owner: SessionOwner) => Effect.Effect<void>>()
  const turns = new Map<string, string | null>()
  const handler = yield* Deferred.make<NeedHandler>()
  const waits = new Map<string, string>()
  return {
    ring: Effect.asVoid(PubSub.publish(rings, undefined)),
    rings: Stream.fromPubSub(rings),
    pin: (note) => Effect.sync(() => void pinned.set(note.deliveryId, note)),
    unpin: (deliveryId) => Effect.sync(() => pinned.delete(deliveryId)),
    take: (sessionId) =>
      Effect.gen(function* () {
        const mine = [...pinned.values()].filter((note) => note.sessionId === sessionId)
        for (const note of mine) pinned.delete(note.deliveryId)
        yield* Effect.forEach(mine, (note) => PubSub.publish(taken, note), { discard: true })
        return mine
      }),
    taken: Stream.fromPubSub(taken),
    stopTree: (owner) => Effect.flatMap(Deferred.await(stopper), (stop) => stop(owner)),
    stopWith: (stop) => Effect.asVoid(Deferred.succeed(stopper, stop)),
    turning: (sessionId, missionId, on) =>
      Effect.sync(() => {
        if (on) turns.set(sessionId, missionId)
        else turns.delete(sessionId)
      }),
    working: (missionId) => Effect.sync(() => [...turns.values()].includes(missionId)),
    needs: {
      deliver: (need, transaction) =>
        Effect.flatMap(Deferred.await(handler), (one) => one.deliver(need, transaction)),
      recheck: (need, retried) =>
        Effect.flatMap(
          Deferred.await(handler),
          (one) => one.recheck?.(need, retried) ?? Effect.succeed(true),
        ),
    },
    needsWith: (one) => Effect.asVoid(Deferred.succeed(handler, one)),
    slotWait: (missionId, sentence) =>
      Effect.sync(() => {
        if (sentence === null) waits.delete(missionId)
        else waits.set(missionId, sentence)
      }),
    slotWaitOf: (missionId) => Effect.sync(() => waits.get(missionId) ?? null),
  }
})

export const sessionPostLayer = Layer.effect(SessionPost, makeSessionPost)
