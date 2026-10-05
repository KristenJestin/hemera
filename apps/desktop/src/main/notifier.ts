/**
 * The notifier: main's side of notifications, applying `notifications.ts` to what the engine
 * tells.
 *
 * A first notice opens the group window; whatever arrives before it closes joins it. Then the
 * focus, the settings and Do Not Disturb are read, at the moment the notification is about to go,
 * and the delivery is made: told to the window when it has the focus, shown by the system
 * otherwise (created here, in main, never by the window), with its one sound. A need that ends
 * takes its notification away: the system's is closed if it still shows, the window is told the
 * in-app one is gone; one that ends inside the window is never notified at all.
 *
 * Everything that reaches the system is a port, so the rules are proven without a notification on
 * anyone's screen.
 */

import {
  InAppNotice,
  type NoticeFeed,
  NoticeGone,
  type NotificationSettings,
  OpenTarget,
  type Sound,
  type WindowNotice,
} from '@hemera/ipc'
import { Effect, Predicate, Queue, Stream } from 'effect'
import type { Duration } from 'effect'

import type { Log } from './diagnostic.ts'
import { type Delivery, type DoNotDisturb, deliveryOf, withoutNeed } from './notifications.ts'

/** A system notification once shown: it can still be closed. */
export interface Shown {
  readonly close: () => void
}

export interface NotifierPorts {
  /** Whether the window is shown, not minimised, and has the focus. */
  readonly focused: () => boolean
  readonly settings: Effect.Effect<NotificationSettings, Error>
  readonly doNotDisturb: Effect.Effect<DoNotDisturb>
  /** Shows a system notification; a click on it calls `onClick`. */
  readonly show: (delivery: Delivery, onClick: () => void) => Shown
  readonly play: (sound: Sound) => void
  /** Brings the window forward: shown, restored, focused. */
  readonly bringForward: () => void
  /** Tells the window: an in-app notification, one gone, or where a click leads. */
  readonly tell: (notice: WindowNotice) => void
  readonly log: Log
}

/** How many notifications are kept to be closed or clicked; older ones are left to the system. */
const KEPT = 50

interface Kept {
  readonly delivery: Delivery
  readonly system: Shown | null
}

const said = (failure: Error): string =>
  failure.message === '' ? String(failure) : failure.message

/** Runs for as long as the feed lasts, or until interrupted. */
export const runNotifier = <E>(
  feed: Stream.Stream<NoticeFeed, E>,
  ports: NotifierPorts,
  window: Duration.Input,
): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const arriving = yield* Queue.unbounded<NoticeFeed>()
      yield* feed.pipe(
        Stream.runForEach((item) => Queue.offer(arriving, item)),
        Effect.catchCause(() => Effect.sync(() => ports.log('the notices stopped arriving'))),
        Effect.forkScoped,
      )
      let kept: Kept[] = []

      const keep = (entry: Kept) => {
        kept = [...kept, entry].slice(-KEPT)
      }

      const ended = (needId: string) => {
        kept = kept.flatMap((entry) => {
          const after = withoutNeed(entry.delivery, needId)
          if (!after.closed) return [{ ...entry, delivery: after.delivery }]
          if (entry.system === null) ports.tell(NoticeGone.make({ id: entry.delivery.id }))
          else entry.system.close()
          return []
        })
      }

      const deliver = (delivery: Delivery) => {
        if (delivery.sound !== null) ports.play(delivery.sound)
        if (delivery.where === 'in-app') {
          ports.tell(
            InAppNotice.make({
              id: delivery.id,
              tone: delivery.tone,
              project: delivery.project,
              missionKey: delivery.missionKey,
              title: delivery.heading,
              detail: delivery.detail,
              target: delivery.target,
            }),
          )
          return keep({ delivery, system: null })
        }
        const system = ports.show(delivery, () => {
          kept = kept.filter((entry) => entry.delivery.id !== delivery.id)
          ports.bringForward()
          ports.tell(OpenTarget.make({ target: delivery.target }))
        })
        keep({ delivery, system })
      }

      const group = Effect.gen(function* () {
        const first = yield* Queue.take(arriving)
        if (Predicate.isTagged(first, 'NeedEnded')) return ended(first.needId)
        yield* Effect.sleep(window)
        const items = [first, ...(yield* Queue.clear(arriving))]
        const endedIds = new Set<string>()
        for (const item of items) {
          if (Predicate.isTagged(item, 'NeedEnded')) endedIds.add(item.needId)
        }
        for (const needId of endedIds) ended(needId)
        const notices = items.flatMap((item) =>
          Predicate.isTagged(item, 'NoticeRaised') &&
          (item.notice.needId === null || !endedIds.has(item.notice.needId))
            ? [item.notice]
            : [],
        )
        if (notices.length === 0) return
        const settings = yield* ports.settings
        const delivery = deliveryOf(notices, {
          focused: ports.focused(),
          settings,
          doNotDisturb: yield* ports.doNotDisturb,
        })
        if (delivery !== null) deliver(delivery)
      }).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => ports.log(`a notification was not delivered: ${said(failure)}`)),
        ),
      )
      return yield* Effect.forever(group)
    }),
  )
