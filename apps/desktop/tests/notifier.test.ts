/**
 * The notifier in main: the notices the engine tells, gathered over the group window, delivered
 * in the window or by the system, with their sound, and taken away when their need ends.
 *
 * Every system effect is a port recorded here: no notification is shown and no sound is played on
 * the machine running the suite.
 */

import type { Notice, NoticeFeed, NotificationSettings, Sound, WindowNotice } from '@hemera/ipc'
import {
  InAppNotice,
  NeedEnded,
  NeedTarget,
  NoticeGone,
  NoticeRaised,
  OpenTarget,
} from '@hemera/ipc'
import { Duration, Effect, Fiber, Queue, Stream } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import type { Delivery, DoNotDisturb } from '../src/main/notifications.ts'
import { type NotifierPorts, runNotifier } from '../src/main/notifier.ts'
import { until } from './commands-engine.ts'

const WINDOW = Duration.millis(40)
/** Long enough for the window to close and its delivery to be made, with room for a busy machine. */
const SETTLE = '300 millis'

const SETTINGS: NotificationSettings = {
  kinds: [{ id: 'need', label: 'A need', on: true, byDefault: true, sound: 'needs-you' }],
  sounds: [{ sound: 'needs-you', label: 'Needs you', on: true }],
}

let made = 0
const need = (project = 'Acme'): Notice => {
  made += 1
  const needId = `need-${String(made)}`
  return {
    id: `need:${String(made)}`,
    kind: 'need',
    sound: 'needs-you',
    importance: 2,
    tone: 'you',
    project: { id: `p-${project}`, name: project },
    missionKey: 'ACME-12',
    subject: 'Add roles',
    what: 'a decision waits for you',
    target: NeedTarget.make({ projectId: `p-${project}`, missionKey: 'ACME-12', needId }),
    needId,
  }
}

interface Machine {
  focused: boolean
  doNotDisturb: DoNotDisturb
  readonly shown: Delivery[]
  readonly closed: string[]
  readonly played: Sound[]
  readonly told: WindowNotice[]
  readonly forward: number[]
  readonly clicks: Map<string, () => void>
}

const machine = (focused: boolean, doNotDisturb: DoNotDisturb = 'off'): Machine => ({
  focused,
  doNotDisturb,
  shown: [],
  closed: [],
  played: [],
  told: [],
  forward: [],
  clicks: new Map(),
})

const portsOf = (seen: Machine): NotifierPorts => ({
  focused: () => seen.focused,
  settings: Effect.succeed(SETTINGS),
  doNotDisturb: Effect.sync(() => seen.doNotDisturb),
  show: (delivery, onClick) => {
    seen.shown.push(delivery)
    seen.clicks.set(delivery.id, onClick)
    return { close: () => seen.closed.push(delivery.id) }
  },
  play: (sound) => seen.played.push(sound),
  bringForward: () => seen.forward.push(seen.forward.length + 1),
  tell: (notice) => seen.told.push(notice),
  log: () => undefined,
})

/** Runs the notifier on a feed the test writes to, for the length of `steps`. */
const notifying = (
  seen: Machine,
  steps: (tell: (...items: NoticeFeed[]) => Effect.Effect<void>) => Effect.Effect<void>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* Queue.unbounded<NoticeFeed>()
        const running = yield* Effect.forkChild(
          runNotifier(Stream.fromQueue(feed), portsOf(seen), WINDOW),
        )
        yield* steps((...items) => Effect.asVoid(Queue.offerAll(feed, items)))
        yield* Fiber.interrupt(running)
      }),
    ),
  )

const raised = (notice: Notice) => NoticeRaised.make({ notice })

describe('The window not focused: a system notification created in main', () => {
  test('what arrives within the window is one notification with one sound', async () => {
    const seen = machine(false)
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(need()), raised(need()))
        yield* tell(raised(need()))
        yield* until(
          Effect.sync(() => seen.shown.length),
          (count) => count > 0,
        )
        yield* Effect.sleep(SETTLE)
      }),
    )
    expect(seen.shown.map((one) => one.body)).toEqual(['3 things wait for you in Acme'])
    expect(seen.played).toEqual(['needs-you'])
    expect(seen.told).toEqual([])
  })

  test('what arrives after the window closed is a notification of its own', async () => {
    const seen = machine(false)
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(need()))
        yield* until(
          Effect.sync(() => seen.shown.length),
          (count) => count === 1,
        )
        yield* tell(raised(need('Globex')))
        yield* until(
          Effect.sync(() => seen.shown.length),
          (count) => count === 2,
        )
      }),
    )
    expect(seen.shown.map((one) => one.title)).toEqual(['Acme', 'Globex'])
  })

  test('a click brings the window forward and sends the route to the window', async () => {
    const seen = machine(false)
    const one = need()
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(one))
        yield* until(
          Effect.sync(() => seen.shown.length),
          (count) => count === 1,
        )
        seen.clicks.get(one.id)?.()
      }),
    )
    expect(seen.forward).toHaveLength(1)
    expect(seen.told).toEqual([OpenTarget.make({ target: one.target })])
  })

  test('Do Not Disturb on: nothing shown, nothing heard', async () => {
    const seen = machine(false, 'on')
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(need()))
        yield* Effect.sleep(SETTLE)
      }),
    )
    expect(seen.shown).toEqual([])
    expect(seen.played).toEqual([])
  })
})

describe('The window focused: the in-app notification only', () => {
  test('told to the window, never shown by the system, with its sound', async () => {
    const seen = machine(true)
    const one = need()
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(one))
        yield* until(
          Effect.sync(() => seen.told.length),
          (count) => count > 0,
        )
      }),
    )
    expect(seen.shown).toEqual([])
    expect(seen.played).toEqual(['needs-you'])
    expect(seen.told).toEqual([
      InAppNotice.make({
        id: one.id,
        tone: 'you',
        project: 'Acme',
        missionKey: 'ACME-12',
        title: 'Add roles',
        detail: 'A decision waits for you',
        target: one.target,
      }),
    ])
  })
})

describe('A need that ends', () => {
  test('answered while its system notification shows: the notification is closed', async () => {
    const seen = machine(false)
    const one = need()
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(one))
        yield* until(
          Effect.sync(() => seen.shown.length),
          (count) => count === 1,
        )
        yield* tell(NeedEnded.make({ needId: one.needId ?? '' }))
        yield* until(
          Effect.sync(() => seen.closed.length),
          (count) => count === 1,
        )
      }),
    )
    expect(seen.closed).toEqual([one.id])
    expect(seen.told).toEqual([])
  })

  test('expired while its in-app notification shows: the window is told it is gone', async () => {
    const seen = machine(true)
    const one = need()
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(one))
        yield* until(
          Effect.sync(() => seen.told.length),
          (count) => count === 1,
        )
        yield* tell(NeedEnded.make({ needId: one.needId ?? '' }))
        yield* until(
          Effect.sync(() => seen.told.length),
          (count) => count === 2,
        )
      }),
    )
    expect(seen.told.at(-1)).toEqual(NoticeGone.make({ id: one.id }))
  })

  test('answered before the window closed: it is never notified', async () => {
    const seen = machine(false)
    const one = need()
    await notifying(seen, (tell) =>
      Effect.gen(function* () {
        yield* tell(raised(one), NeedEnded.make({ needId: one.needId ?? '' }))
        yield* Effect.sleep(SETTLE)
      }),
    )
    expect(seen.shown).toEqual([])
    expect(seen.played).toEqual([])
  })
})
