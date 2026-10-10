import { useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  LOADING_LIVING_SPEC,
  followLivingSpec,
  type LivingSpecFollowing,
  type LivingSpecView,
} from './living-spec-model.ts'

/** A Project's living spec once the engine has answered, and what the window does with it. */
export function useLivingSpec(
  link: Link,
  engineReady: boolean,
  projectId: string,
): [LivingSpecView, Omit<LivingSpecFollowing, 'stop'>] {
  const [view, setView] = useState<LivingSpecView>(LOADING_LIVING_SPEC)
  const following = useRef<LivingSpecFollowing | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    const current = followLivingSpec(link, projectId, setView)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setView(LOADING_LIVING_SPEC)
    }
  }, [link, engineReady, projectId])
  return [
    view,
    {
      openDomain: (id) => following.current?.openDomain(id),
      history: (id) => following.current?.history(id),
      validate: (id) => following.current?.validate(id),
      reject: (id) => following.current?.reject(id),
      drop: (id) => following.current?.drop(id),
      reread: (id) => following.current?.reread(id),
      read: () => following.current?.read(),
      retry: () => following.current?.retry(),
    },
  ]
}
