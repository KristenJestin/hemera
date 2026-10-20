import { defaultBranchPrefix } from '@hemera/core/domain'
import type { Project } from '@hemera/ipc'
import { WorkspacesSection } from '@hemera/ui'
import type { ReactNode } from 'react'

import { defaultWorkspacesFolder, keptPrefix } from './settings-paths.ts'
import { useSettled } from './settings-hooks.ts'
import type { Settings } from './settings-data.ts'
import type { SettingsTools } from './settings-types.ts'

interface WorkspacesProps {
  project: Project
  settings: Settings | null
  tools: SettingsTools
}

export function Workspaces({ project, settings, tools }: WorkspacesProps): ReactNode {
  const slug = defaultBranchPrefix(project.name)
  const [folder, setFolder, folderError] = useSettled(project.workspacesRoot, async (value) =>
    settings?.setWorkspacesRoot(value),
  )
  const [prefix, setPrefix, prefixError] = useSettled(project.branchPrefix, async (value) =>
    settings?.setBranchPrefix(keptPrefix(value)),
  )
  return (
    <WorkspacesSection
      folder={folder}
      defaultFolder={defaultWorkspacesFolder(tools.dataFolder, project.id)}
      onFolder={setFolder}
      onChooseFolder={() => {
        void tools.chooseFolder().then((chosen) => {
          if (chosen !== null) setFolder(chosen)
        })
      }}
      prefix={prefix}
      defaultPrefix={`${slug}/`}
      onPrefix={setPrefix}
      example={`${slug.toUpperCase()}-12`}
      folderError={folderError}
      prefixError={prefixError}
    />
  )
}
