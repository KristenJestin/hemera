import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { IconGitBranch } from '../icons.ts'

/**
 * Which Workspace the composer is writing about (design D4-07).
 *
 * A real select and not a pill that looks like one: it is a choice, and a control drawn as a
 * choice that cannot be made is the worst of both. Lot 4 offers one Workspace — `main` — so the
 * list has one entry and choosing it changes nothing; lot 7 adds the others and this component
 * does not change.
 */
export interface WorkspacePillProps {
  /** The Workspaces on offer, `main` first. */
  workspaces: string[]
  workspace: string
  onWorkspaceChange: (workspace: string) => void
}

export function WorkspacePill({
  workspaces,
  workspace,
  onWorkspaceChange,
}: WorkspacePillProps): ReactNode {
  return (
    <Select
      label="Workspace"
      className="w-fit"
      value={workspace}
      onValueChange={onWorkspaceChange}
      items={workspaces.map((name) => ({
        value: name,
        label: name,
        icon: <IconGitBranch size="sm" />,
      }))}
    />
  )
}
