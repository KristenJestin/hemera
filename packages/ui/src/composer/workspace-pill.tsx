import type { ReactNode } from 'react'

import { Select } from '../components/select/select.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
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
 * agent's own session was opened in that folder (D8-08). Fixed, it is no longer a choice, so it
 * is no longer drawn as one: a plain label with the Workspace's name, and the reason is its
 * tooltip rather than a sentence that stayed on screen for the whole Session (issue #128).
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

/** Why the label is not a choice any more, which its tooltip says. */
export const FIXED_REASON = 'The Workspace is fixed once the agent has started.'

/** The label: the name and its branch, quiet, and reachable by the keyboard for its tooltip. */
const LABEL =
  'inline-flex min-w-0 items-center gap-2 rounded-md px-2 py-1 not-italic text-sm text-muted-foreground focus-ring'

export function WorkspacePill({
  workspaces,
  workspace,
  onWorkspaceChange,
  fixed = false,
}: WorkspacePillProps): ReactNode {
  if (fixed) {
    return (
      <Tooltip label={FIXED_REASON}>
        <i
          role="img"
          // Focusable so the keyboard reaches its tooltip as the pointer does.
          tabIndex={0}
          aria-label={`Workspace: ${workspace}`}
          className={LABEL}
        >
          <IconGitBranch size="sm" aria-hidden="true" />
          <span className="truncate">{workspace}</span>
        </i>
      </Tooltip>
    )
  }
  return (
    <Select
      label="Workspace"
      className="w-fit"
      value={workspace}
      onValueChange={onWorkspaceChange}
      items={workspaces.map((one) => ({
        value: one.name,
        label: one.name,
        icon: <IconGitBranch size="sm" />,
      }))}
    />
  )
}
