import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Menu, type MenuItem } from '../components/menu/menu.tsx'
import { StatusDot } from '../components/status-dot/status-dot.tsx'
import {
  IconAlertTriangle,
  IconFolderPlus,
  IconGitBranch,
  IconHammer,
  IconMessage,
  IconPlayerPlay,
  IconRefresh,
} from '../icons.ts'
import type { LaunchView, LaunchWorkspace } from './model.ts'

/**
 * What to do next on a ready Spec, and where the build it starts stands (D8-12, D8-13).
 *
 * The footer of the Spec panel holds it on a Spec that is not being written (issue #135): a
 * Spec being written offers nothing to build, and an older revision of a ready one is read only
 * (D7-05). A launch already asked for keeps the actions where they are once the Spec moves on —
 * the build it started is reached through `Open`, and one a Rework took back says so (D8-13).
 *
 * The footer runs under the rail and the stage alike (issue #150), so the actions stand side by
 * side at its end, each at its own width, the primary one last.
 *
 * With no Workspace yet, the two ways in are the hand's: prepare one from the plan and start the
 * build in it, or start the build in a Workspace the Project already has — `main`, which every
 * Project has, or one made by hand. A Workspace a Spec made for its own build is not offered
 * here: it belongs to that build. Once a Workspace is ready there is one thing left to do,
 * `Start the build`.
 *
 * A launch is a request that waits: the Workspace is prepared first, then the agent is started,
 * and each of those says where it is in the width of a sentence — the step running, then the
 * agent — beside the indicator that says it is still going, without a count and without anything
 * to press. A start the engine refused keeps its own words and offers `Retry`; started, it offers
 * the build Session; taken back by a Rework, it says so and offers nothing.
 *
 * Everything it shows is handed to it and everything it does is reported: the Workspaces, the
 * launch and what a press becomes belong to the caller.
 */

const ACTIONS = 'flex flex-wrap items-center justify-end gap-2'

const SAYS = 'flex flex-wrap items-center gap-2 text-sm text-muted-foreground'

const FAILURE = 'flex flex-wrap items-center gap-2 text-sm text-destructive-muted-foreground'

const PREPARING = 'Preparing the Workspace'

const GROUP = 'The build of this Spec'

export interface WorkspaceActionsProps {
  /** Where the launch stands, or `null` while none has been asked for (D8-13). */
  launch: LaunchView | null
  /** The Workspace the Spec is set on, once one is ready; absent while it has none. */
  workspace?: LaunchWorkspace | undefined
  /** The Workspaces a build may be started in: `main`, and the ones made by hand. */
  workspaces: readonly LaunchWorkspace[]
  /** Prepares a Workspace from the plan and starts the build in it. */
  onPrepareAndStart: () => void
  /** Prepares a Workspace and stops there. */
  onPrepareOnly: () => void
  /** Starts the build in one of the Project's existing Workspaces. */
  onUseWorkspace: (id: string) => void
  /** Starts the build in the Workspace the Spec is set on. */
  onStart: () => void
  /** Starts the agent again, after it refused to. */
  onRetry: () => void
  /** Opens the build Session. */
  onOpen: () => void
}

export function WorkspaceActions({
  launch,
  workspace,
  workspaces,
  onPrepareAndStart,
  onPrepareOnly,
  onUseWorkspace,
  onStart,
  onRetry,
  onOpen,
}: WorkspaceActionsProps): ReactNode {
  if (launch === null && workspace === undefined) {
    // `Prepare a Workspace only` first, and the Workspaces after it: the separator between the
    // two groups is what says the one is not the other.
    const prepareOnly: MenuItem = {
      label: 'Prepare a Workspace only',
      icon: <IconFolderPlus size="sm" aria-hidden="true" />,
      onSelect: onPrepareOnly,
    }
    const existing: MenuItem[] = workspaces.map((one) => ({
      label: one.name,
      icon: <IconGitBranch size="sm" aria-hidden="true" />,
      onSelect: () => onUseWorkspace(one.id),
    }))
    return (
      <div role="group" aria-label={GROUP} className={ACTIONS}>
        <Menu
          label="Use an existing Workspace"
          size="sm"
          groups={existing.length === 0 ? [[prepareOnly]] : [[prepareOnly], existing]}
        />
        <Button variant="primary" size="sm" onClick={onPrepareAndStart}>
          <IconHammer size="sm" aria-hidden="true" />
          Prepare and start the build
        </Button>
      </div>
    )
  }

  if (launch === null) {
    return (
      <div role="group" aria-label={GROUP} className={ACTIONS}>
        <Button variant="primary" size="sm" onClick={onStart}>
          <IconPlayerPlay size="sm" aria-hidden="true" />
          Start the build
        </Button>
      </div>
    )
  }

  switch (launch.state) {
    case 'waiting': {
      // The step being prepared is named where it stands, and the three dots are the whole of the
      // progress: it says it is still going without saying how much is left of it.
      const said = launch.step === undefined ? PREPARING : `${PREPARING} · ${launch.step}`
      return (
        <p className={SAYS}>
          <Loading size="sm" label={said} />
          <span>{said}</span>
        </p>
      )
    }
    case 'starting': {
      const said = 'Starting the agent…'
      return (
        <p className={SAYS}>
          <Loading size="sm" label={said} />
          <span>{said}</span>
        </p>
      )
    }
    case 'started':
      return (
        <div role="group" aria-label={GROUP} className={SAYS}>
          <StatusDot status="success" size="sm" />
          <span>Build started</span>
          <Button size="sm" onClick={onOpen}>
            <IconMessage size="sm" aria-hidden="true" />
            Open
          </Button>
        </div>
      )
    case 'failed':
      // Its own words, whole: what the start was refused with is the only thing that says what to
      // do about it.
      return (
        <div role="alert" className={FAILURE}>
          <IconAlertTriangle size="sm" aria-hidden="true" />
          <span>{`The agent did not start: ${launch.cause}`}</span>
          <Button size="sm" onClick={onRetry}>
            <IconRefresh size="sm" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )
    case 'cancelled':
      return (
        <p role="status" className={SAYS}>
          <StatusDot status="cancelled" size="sm" />
          Cancelled by the Rework
        </p>
      )
  }
}
