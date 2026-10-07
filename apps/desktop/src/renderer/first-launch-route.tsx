/**
 * The first launch over the link (#53): the agents this machine has, as the application's settings
 * list them, Hemera Auto's key, and the two ways in, both opening the dialog that adds a Project
 * from its folder. Git's presence is not asked: no call of the engine answers it yet, and a Git
 * missing is said by the need that refuses a repository. No Effect here: the calls are promises.
 */

import type { AgentState, HemeraAutoStatus } from '@hemera/ipc'
import { FirstLaunch } from '@hemera/ui'
import { type ReactNode, useState } from 'react'

import { agentRowsOf, jevKeyOf } from './app-settings-data.ts'
import type { Link } from './link.ts'
import { useRead } from './use-read.ts'

const readAgents = (link: Link) => link.agents()
const readHemeraAuto = (link: Link) => link.hemeraAuto()

interface FirstLaunchRouteProps {
  link: Link
  engineReady: boolean
  copy: (text: string) => void
  /** Opens the dialog that adds a Project. */
  onAddProject: () => void
  /** Opens Hemera Auto in the application's settings. */
  onAddKey: () => void
}

export function FirstLaunchRoute({
  link,
  engineReady,
  copy,
  onAddProject,
  onAddKey,
}: FirstLaunchRouteProps): ReactNode {
  const [agents, setAgents, reread] = useRead<ReadonlyArray<AgentState>>(
    link,
    engineReady,
    readAgents,
  )
  const [status] = useRead<HemeraAutoStatus>(link, engineReady, readHemeraAuto)
  const [checking, setChecking] = useState(false)
  return (
    <FirstLaunch
      agents={agentRowsOf(agents ?? [])}
      discovering={agents === null}
      checking={checking}
      onCheck={() => {
        setChecking(true)
        link.checkAgentUpdates().then(
          (checked) => {
            setAgents(checked)
            setChecking(false)
          },
          () => setChecking(false),
        )
      }}
      onUpdate={(name) => {
        const agent = agents?.find((one) => one.label === name)
        if (agent !== undefined) link.updateAgent(agent.id).then(reread, () => undefined)
      }}
      onCopy={copy}
      git
      onCheckGit={() => undefined}
      jevKey={jevKeyOf(status?.key ?? 'missing')}
      onAddKey={onAddKey}
      onAddFolder={onAddProject}
      onCreate={onAddProject}
    />
  )
}
