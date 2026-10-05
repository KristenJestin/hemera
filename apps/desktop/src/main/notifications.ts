/**
 * The rules of notifications: what the notices that arrive together become, where it shows, in
 * which words, with which sound, and where a click leads. Pure: the notices, the focus, the
 * settings and Do Not Disturb in, one delivery (or none) out. `notifier.ts` applies them.
 *
 * - Notices arriving within `GROUP_WINDOW` are one notification. One keeps its own words; several
 *   in one Project say "3 things wait for you in Acme" and lead to Home filtered to it; several
 *   across Projects (the application's own count apart from any Project) say "5 things wait for
 *   you" and lead to Home.
 * - A kind turned off is left out. A group plays one sound, the most important of those whose
 *   kind and sound are on: an error, then a need, then done.
 * - The window focused: the in-app notification, never the system's. Not focused: the system's.
 * - Do Not Disturb on: no system notification and no sound; in the focused window the in-app one
 *   still appears, silently. Unreadable: the system's is sent (its server applies its own Do Not
 *   Disturb), and Hemera plays no sound with it.
 */

import {
  HomeTarget,
  type Notice,
  type NoticeTone,
  type NotificationSettings,
  type NotificationTarget,
  type Sound,
} from '@hemera/ipc'
import { Duration } from 'effect'

/** How long after a first notice the others are gathered into its notification. */
export const GROUP_WINDOW = Duration.seconds(2)

/** Whether the system says not to disturb: on, off, or it could not be read. */
export type DoNotDisturb = 'on' | 'off' | 'unknown'

export interface Situation {
  /** The window has the focus: shown, not minimised, focused. */
  readonly focused: boolean
  readonly settings: NotificationSettings
  readonly doNotDisturb: DoNotDisturb
}

/** One notification, as it is shown in the window or by the system. */
export interface Delivery {
  /** The first notice's id. */
  readonly id: string
  readonly where: 'in-app' | 'system'
  /** The system notification's title and body. */
  readonly title: string
  readonly body: string
  /** The in-app card's words: the Project, the mission's key, its heading and a detail. */
  readonly project: string
  readonly missionKey: string | null
  readonly heading: string
  readonly detail: string | null
  readonly tone: NoticeTone
  readonly target: NotificationTarget
  /** The needs it is about: once all of them ended, it goes away. */
  readonly needIds: ReadonlyArray<string>
  readonly sound: Sound | null
}

const HEMERA = 'Hemera'

/** One event's words, as one line: "ACME-12 · Add roles: a decision waits for you". */
export function wordsOf(notice: Notice): string {
  const about =
    notice.missionKey === null ? notice.subject : `${notice.missionKey} · ${notice.subject}`
  return `${about}: ${notice.what}`
}

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const things = (count: number): string =>
  `${String(count)} ${count === 1 ? 'thing waits' : 'things wait'} for you`

/** The most important of the notices: the first of the highest importance. */
const leading = (notices: ReadonlyArray<Notice>): Notice | undefined =>
  notices.reduce<Notice | undefined>(
    (best, notice) => (best === undefined || notice.importance > best.importance ? notice : best),
    undefined,
  )

/** The words, the card and the target of the notices, before where and how loud. */
function shapeOf(notices: ReadonlyArray<Notice>, first: Notice) {
  if (notices.length === 1) {
    return {
      title: first.project?.name ?? HEMERA,
      body: wordsOf(first),
      project: first.project?.name ?? HEMERA,
      missionKey: first.missionKey,
      heading: first.subject,
      detail: sentence(first.what),
      target: first.target,
    }
  }
  const projects = new Set(notices.map((notice) => notice.project?.id ?? null))
  const project = first.project
  if (projects.size === 1 && project !== null) {
    const body = `${things(notices.length)} in ${project.name}`
    return {
      title: project.name,
      body,
      project: project.name,
      missionKey: null,
      heading: body,
      detail: null,
      target: HomeTarget.make({ projectId: project.id }),
    }
  }
  const body = things(notices.length)
  return {
    title: HEMERA,
    body,
    project: HEMERA,
    missionKey: null,
    heading: body,
    detail: null,
    target: HomeTarget.make({ projectId: null }),
  }
}

/** What the notices that arrived together become in this situation: one delivery, or nothing. */
export function deliveryOf(notices: ReadonlyArray<Notice>, situation: Situation): Delivery | null {
  const { focused, settings, doNotDisturb } = situation
  const kindOn = new Map(settings.kinds.map((kind) => [kind.id, kind.on]))
  const soundOn = new Map(settings.sounds.map((sound) => [sound.sound, sound.on]))
  const kept = notices.filter((notice) => kindOn.get(notice.kind) ?? true)
  const [first] = kept
  if (first === undefined) return null
  if (!focused && doNotDisturb === 'on') return null
  const heard = leading(
    kept.filter((notice) => notice.sound !== null && (soundOn.get(notice.sound) ?? true)),
  )
  const silent = doNotDisturb === 'on' || (!focused && doNotDisturb === 'unknown')
  return {
    id: first.id,
    where: focused ? 'in-app' : 'system',
    ...shapeOf(kept, first),
    tone: (leading(kept) ?? first).tone,
    needIds: kept.flatMap((notice) => (notice.needId === null ? [] : [notice.needId])),
    sound: silent ? null : (heard?.sound ?? null),
  }
}

/**
 * A need ended: the delivery without it, and whether it is to go away — once the last of the
 * needs it was about ended. One about no need never goes by this.
 */
/** A delivery after a need ended, and whether it goes away. */
export interface AfterNeedEnded {
  readonly closed: boolean
  readonly delivery: Delivery
}

export function withoutNeed(delivery: Delivery, needId: string): AfterNeedEnded {
  if (!delivery.needIds.includes(needId)) return { closed: false, delivery }
  const needIds = delivery.needIds.filter((id) => id !== needId)
  return needIds.length === 0
    ? { closed: true, delivery }
    : { closed: false, delivery: { ...delivery, needIds } }
}
