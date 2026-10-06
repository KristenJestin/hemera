import { useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import { followNeeds, type NeedsFollowing, type NeedsState } from './needs.ts'

const LOADING = { kind: 'loading' } as const

/** Needs you once the engine has answered, and what the window does with it. */
export function useNeeds(
  link: Link,
  engineReady: boolean,
): [NeedsState, Pick<NeedsFollowing, 'retry' | 'answer' | 'recheck'>] {
  const [state, setState] = useState<NeedsState>(LOADING)
  const following = useRef<NeedsFollowing | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    const current = followNeeds(link, setState)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setState(LOADING)
    }
  }, [link, engineReady])
  return [
    state,
    {
      retry: () => following.current?.retry(),
      answer: (id, label, answer) => following.current?.answer(id, label, answer),
      recheck: (id) => following.current?.recheck(id),
    },
  ]
}

const MINUTE = 60_000

/** Now, again every minute: what each need's "when" is counted from. */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), MINUTE)
    return () => clearInterval(timer)
  }, [])
  return now
}
