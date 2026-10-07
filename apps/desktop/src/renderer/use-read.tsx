/**
 * A read over the window's link, for a part of a page: on its way, answered, or refused and said
 * in words with Try again. No Effect here: the calls are promises.
 */

import { ErrorState } from '@hemera/ui'
import { type ReactNode, useEffect, useState } from 'react'

import { reading, type Read } from './app-settings-data.ts'
import type { Link } from './link.ts'

/** What a section reads once it is shown, read again by `reread`; refused, said in words. */
export function useRead<A>(
  link: Link,
  engineReady: boolean,
  read: (link: Link) => Promise<A>,
): [Read<A>, (value: A) => void, () => void] {
  const [state, setState] = useState<Read<A>>({ kind: 'loading' })
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    // Read again, what was shown stays until the answer comes.
    return reading(read(link), (next) =>
      setState((before) => (next.kind === 'loading' && before.kind === 'ready' ? before : next)),
    )
  }, [link, engineReady, read, reads])
  return [
    state,
    (value) => setState({ kind: 'ready', value }),
    () => setReads((before) => before + 1),
  ]
}

export const valueOf = <A,>(read: Read<A>): A | null => (read.kind === 'ready' ? read.value : null)

/** A section none of whose reads may be missing: what was refused, in words, and Try again. */
export function Unread({
  title,
  sentence,
  onRetry,
}: {
  title: string
  sentence: string
  onRetry: () => void
}): ReactNode {
  return (
    <ErrorState title={`${title} could not be read`} description={sentence} onRetry={onRetry} />
  )
}

/** The first read refused among a section's, if any. */
export const refusedOf = (reads: ReadonlyArray<Read<unknown>>): string | null =>
  reads.reduce<string | null>(
    (found, read) => found ?? (read.kind === 'failed' ? read.sentence : null),
    null,
  )
