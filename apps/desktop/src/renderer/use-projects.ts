import { useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  followProject,
  followProjects,
  type Following,
  type ProjectState,
  type ProjectsState,
} from './projects.ts'

const LOADING = { kind: 'loading' } as const

/** Every Project, for the sidebar, once the engine has answered; and a way to read them again. */
export function useProjects(link: Link, engineReady: boolean): [ProjectsState, () => void] {
  const [state, setState] = useState<ProjectsState>(LOADING)
  const following = useRef<Following | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    const current = followProjects(link, setState)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setState(LOADING)
    }
  }, [link, engineReady])
  return [state, () => following.current?.retry()]
}

/** The Project a page shows, when it shows one; and a way to read it again. */
export function useProject(
  link: Link,
  engineReady: boolean,
  id: string | null,
): [ProjectState, () => void] {
  const [state, setState] = useState<ProjectState>(LOADING)
  const following = useRef<Following | null>(null)
  useEffect(() => {
    if (!engineReady || id === null) return undefined
    const current = followProject(link, id, setState)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setState(LOADING)
    }
  }, [link, engineReady, id])
  return [state, () => following.current?.retry()]
}
