import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { IconGitBranch } from '../icons.ts'

/**
 * Which Workspace the composer is writing about (design D4-07, D8-08).
 *
 * A real select and not a pill that looks like one: it is a choice, and a control drawn as a
 * choice that cannot be made is the worst of both. It offers the Project's Workspaces that are
 * `ready`, `main` first — the caller filters and orders them, since which Workspaces are ready
 * is the engine's to know and not this control's.
 *
 * The choice is made before the first message and fixed once the agent has started, because the
 * agent's own session was opened in that folder (D8-08). Fixed, the select is disabled and says
 * why beside it, in words rather than in a tooltip a disabled control could never show.
 */

/** A Workspace on offer: the name it is chosen by, and where it is on disk. */
export interface WorkspaceChoice {
  name: string
  path?: string | undefined
}

export interface WorkspacePillProps {
  /** The Workspaces in state `ready`, `main` first, already filtered and ordered by the caller. */
  workspaces: WorkspaceChoice[]
  workspace: string
  onWorkspaceChange: (workspace: string) => void
  /** Whether the agent has started, which fixes the choice (D8-08). */
  fixed?: boolean | undefined
}

const NOTE = 'text-xs text-muted-foreground'

export function WorkspacePill({
  workspaces,
  workspace,
  onWorkspaceChange,
  fixed = false,
}: WorkspacePillProps): ReactNode {
  return (
    <>
      <Select
        label="Workspace"
        className="w-fit"
        value={workspace}
        onValueChange={onWorkspaceChange}
        disabled={fixed}
        items={workspaces.map((one) => ({
          value: one.name,
          label: one.name,
          icon: <IconGitBranch size="sm" />,
        }))}
      />
      {fixed && <span className={NOTE}>The Workspace is fixed once the agent has started.</span>}
    </>
  )
}
