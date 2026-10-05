/**
 * The in-app notifications the window draws: those main told it, in the order they came, until
 * one is pressed, dismissed, or main says its need ended. Plain values, no React: the hook that
 * holds them is `use-notices.ts`, and the card that draws them is the design system's.
 */

import type { InAppNotice, NoticeGone, NotificationTarget } from '@hemera/ipc'
import type { NoticeItem } from '@hemera/ui'
import { Predicate } from 'effect'

/** A notification drawn, and where it leads. */
export interface ShownNotice extends NoticeItem {
  readonly target: NotificationTarget
}

/** The notifications after what main told. */
export function noticesAfter(
  shown: ReadonlyArray<ShownNotice>,
  told: typeof InAppNotice.Type | typeof NoticeGone.Type,
): ReadonlyArray<ShownNotice> {
  if (Predicate.isTagged(told, 'NoticeGone')) {
    return shown.some((one) => one.id === told.id) ? withoutNotice(shown, told.id) : shown
  }
  if (shown.some((one) => one.id === told.id)) return shown
  return [
    ...shown,
    {
      id: told.id,
      tone: told.tone,
      project: told.project,
      missionKey: told.missionKey ?? undefined,
      title: told.title,
      detail: told.detail ?? undefined,
      target: told.target,
    },
  ]
}

/** Pressed or dismissed: it goes away. */
export const withoutNotice = (
  shown: ReadonlyArray<ShownNotice>,
  id: string,
): ReadonlyArray<ShownNotice> => shown.filter((one) => one.id !== id)
