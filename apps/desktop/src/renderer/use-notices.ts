import type { NotificationTarget } from '@hemera/ipc'
import { Predicate } from 'effect'
import { useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import { noticesAfter, withoutNotice, type ShownNotice } from './notices.ts'

export interface Notices {
  readonly notices: ReadonlyArray<ShownNotice>
  /** Pressed: the window goes where it leads, and it goes away. */
  readonly open: (id: string) => void
  readonly dismiss: (id: string) => void
}

/**
 * The in-app notifications main tells the window, and the clicks on the system's: each leads
 * where `lead` takes it.
 */
export function useNotices(link: Link, lead: (target: NotificationTarget) => void): Notices {
  const [notices, setNotices] = useState<ReadonlyArray<ShownNotice>>([])
  // The latest `lead`, read when a notice arrives, without following the stream again.
  const leading = useRef(lead)
  useEffect(() => {
    leading.current = lead
  })
  useEffect(
    () =>
      link.onNotices((told) => {
        if (Predicate.isTagged(told, 'OpenTarget')) leading.current(told.target)
        else setNotices((before) => noticesAfter(before, told))
      }),
    [link],
  )
  return {
    notices,
    open: (id) => {
      const notice = notices.find((one) => one.id === id)
      if (notice !== undefined) lead(notice.target)
      setNotices((before) => withoutNotice(before, id))
    },
    dismiss: (id) => setNotices((before) => withoutNotice(before, id)),
  }
}
