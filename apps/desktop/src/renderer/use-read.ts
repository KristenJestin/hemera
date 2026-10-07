/** A read over the window's link, for a part of a page. No Effect here: the calls are promises. */

import { useEffect, useState } from 'react'

import type { Link } from './link.ts'

/** What a section reads once it is shown, read again by `reread`; null while on its way. */
export function useRead<A>(
  link: Link,
  engineReady: boolean,
  read: (link: Link) => Promise<A>,
): [A | null, (value: A) => void, () => void] {
  const [value, setValue] = useState<A | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    read(link).then(
      (answered) => {
        if (!stopped) setValue(answered)
      },
      () => undefined,
    )
    return () => {
      stopped = true
    }
  }, [link, engineReady, read, reads])
  return [value, setValue, () => setReads((before) => before + 1)]
}
