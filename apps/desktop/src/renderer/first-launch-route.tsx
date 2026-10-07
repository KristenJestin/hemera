/**
 * The first launch over the link (#53): the empty state and the two ways in, both opening the
 * dialog that adds a Project from its folder, and the need above it when no agent is installed.
 * Git's presence is not asked: no call of the engine answers it yet, and a Git missing is said by
 * the need that refuses a repository. No Effect here: the calls are promises.
 */

import type { AgentState } from '@hemera/ipc'
import { FirstLaunch } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { Link } from './link.ts'
import { useRead } from './use-read.ts'

const readAgents = (link: Link) => link.agents()

interface FirstLaunchRouteProps {
  link: Link
  engineReady: boolean
  /** Opens the dialog that adds a Project. */
  onAddProject: () => void
}

export function FirstLaunchRoute({
  link,
  engineReady,
  onAddProject,
}: FirstLaunchRouteProps): ReactNode {
  const [agents, , reread] = useRead<ReadonlyArray<AgentState>>(link, engineReady, readAgents)
  return (
    <FirstLaunch
      git
      onCheckGit={() => undefined}
      noAgent={agents !== null && agents.every((agent) => !agent.installed)}
      onCheck={reread}
      onAddFolder={onAddProject}
      onCreate={onAddProject}
    />
  )
}
