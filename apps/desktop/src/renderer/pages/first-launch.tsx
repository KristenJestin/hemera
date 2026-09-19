import type { ReactNode } from 'react'

import { FirstLaunch } from '@hemera/ui'

/**
 * The page a window with no Project shows (design D4-06, D4-07).
 *
 * It composes and binds, and holds nothing: a page of this folder has no class of its own, no
 * state and no rule — what it knows is which component goes where and what each callback is
 * wired to.
 */
export function FirstLaunchPage({
  onCreateProject,
  commandShortcut,
}: {
  onCreateProject: () => void
  commandShortcut: string
}): ReactNode {
  return <FirstLaunch onCreateProject={onCreateProject} commandShortcut={commandShortcut} />
}
