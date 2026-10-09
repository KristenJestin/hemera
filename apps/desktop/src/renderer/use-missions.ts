import { useEffect, useState } from 'react'

import type { Mission } from '@hemera/ipc'

import type { Link } from './link.ts'
import { afterChange } from './missions.ts'

/** The missions of a Project as the window holds them. */
export type MissionsState =
  | { kind: 'loading' }
  | { kind: 'ready'; missions: ReadonlyArray<Mission> }
  | { kind: 'failed'; sentence: string }

const LOADING = { kind: 'loading' } as const

/**
 * A Project's missions: read once, then kept up to date by the engine's changes (a changed
 * mission of this Project is upserted, a need change is ignored). None are followed without a
 * Project or before the engine answers.
 */
export function useMissions(
  link: Link,
  engineReady: boolean,
  projectId: string | null,
): MissionsState {
  const [state, setState] = useState<MissionsState>(LOADING)
  useEffect(() => {
    if (!engineReady || projectId === null) return undefined
    let stopped = false
    // Changes heard before the read answers are applied to what it brings.
    const heard: Array<Parameters<typeof afterChange>[1]> = []
    let read = false
    const unsubscribe = link.onMissionChanges(
      (change) => {
        if (stopped) return
        if (!read) {
          heard.push(change)
          return
        }
        setState((before) =>
          before.kind === 'ready'
            ? { kind: 'ready', missions: afterChange(before.missions, change, projectId) }
            : before,
        )
      },
      () => undefined,
    )
    link.missions(projectId).then(
      (missions) => {
        if (stopped) return
        read = true
        setState({
          kind: 'ready',
          missions: heard.reduce((now, change) => afterChange(now, change, projectId), missions),
        })
      },
      (failure: Error) => {
        if (!stopped) setState({ kind: 'failed', sentence: failure.message })
      },
    )
    return () => {
      stopped = true
      unsubscribe()
      setState(LOADING)
    }
  }, [link, engineReady, projectId])
  return state
}
