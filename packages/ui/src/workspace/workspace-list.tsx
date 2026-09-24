import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Menu } from '../components/menu/menu.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { IconChevronDown, IconFolderPlus, IconGitBranch, IconPlus, IconTrash } from '../icons.ts'
import { arrival, collapse, expand, fold, useTransition } from '../motion.ts'
import { MapFolderDialog } from './map-folder-dialog.tsx'
import type { WorkspaceRow, WorkspaceState } from './model.ts'

/**
 * The Workspaces of a Project, in its settings (D8-02): one list, and everything about a
 * Workspace is found by opening its row.
 *
 * `main` first, then the ones Hemera made — for a Spec or from here — and the folders the user
 * mapped: all of them are Workspaces, so all of them are rows of the same list. A row says the
 * name, where the Workspace stands (a dot and its word), `main`, `dedicated` for one Hemera made
 * with its worktrees, and its folder; `main`'s row also says the branch, the commit and the
 * changes of its own folder, which the caller reads.
 *
 * A row opens in place: its repositories with their Git state, its preparation, its services and
 * its own variables are drawn under it, grown and folded on the `expand` and `collapse` kinds of
 * the preset. What is drawn there is the caller's (`renderDetails`), so the list stays a leaf;
 * one row is open at a time, the one the caller says.
 *
 * Two ways to add one. **New Workspace** asks the caller to open the creation dialog of a
 * dedicated Workspace — worktrees and preparation, with no Spec. **Map an existing folder**, in
 * the menu beside it, opens a dialog that picks a folder Hemera uses as it is.
 *
 * Cleaning up is offered on a dedicated Workspace that is not cleaned up yet, and never on
 * `main` nor on a mapped folder, which is theirs (D8-14). The list asks for it and the caller
 * confirms it: what is removed is said in the cleanup dialog, not here.
 */
const ROWS = 'flex flex-col gap-2'

const LINE = 'flex min-w-0 flex-1 flex-col gap-0.5'

const HEAD = 'flex min-w-0 flex-wrap items-center gap-2'

const NAME = 'min-w-0 truncate text-sm font-medium'

/** Where it stands: the dot, and the word beside it for whoever does not read colours. */
const STATE = 'flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'

const PATH = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/** What Git says of its folder, on `main`'s row. */
const SUMMARY = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'

const MONO = 'font-mono text-foreground'

const MARK = 'flex items-center gap-1'

/** New Workspace, and the menu of the other way beside it. */
const ADD = 'flex items-center gap-1'

/** The chevron of the disclosure, turned by half a turn while the row is open. */
const CHEVRON = 'flex'

/** What holds the height, and nothing else: the room the details are given as they open. */
const ROOM = 'overflow-hidden'

/** The details, under the row they belong to. */
const DETAILS = 'flex flex-col gap-3 pt-3'

const CLEANUP = 'shrink-0'

/** How a Workspace's state is read: a dot in the tone of what it says, and the word. */
const STATES: Record<WorkspaceState, { word: string; tone: StatusTone }> = {
  preparing: { word: 'Preparing', tone: 'running' },
  ready: { word: 'Ready', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  cleaned: { word: 'Cleaned up', tone: 'cancelled' },
}

export interface WorkspaceListProps {
  /** The Workspaces of the Project, `main` first. */
  workspaces: readonly WorkspaceRow[]
  /** Opens the creation dialog of a dedicated Workspace, which the caller holds. */
  onCreateDedicated: () => void
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** Maps a folder as a Workspace of that name; answers the refusal to show, or null. */
  onMapFolder: (path: string, name: string) => Promise<string | null>
  /** Asks to clean one up; the caller confirms it with the cleanup dialog. */
  onCleanup: (id: string) => void
  /**
   * What an open row shows under it: that Workspace's repositories, preparation, services and
   * variables. Without it, the rows open onto nothing and offer no disclosure.
   */
  renderDetails?: ((id: string) => ReactNode) | undefined
  /** The Workspace whose row is open; null or absent when none is. */
  expanded?: string | null | undefined
  /** Opens a row, or closes it with null. */
  onExpandedChange?: ((id: string | null) => void) | undefined
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

export function WorkspaceList({
  workspaces,
  onCreateDedicated,
  onBrowse,
  onMapFolder,
  onCleanup,
  renderDetails,
  expanded = null,
  onExpandedChange,
  className,
}: WorkspaceListProps): ReactNode {
  const [mapping, setMapping] = useState(false)

  return (
    <Card
      title="Workspaces"
      description="Where this Project's Sessions work. main is the Project's own folder."
      className={className}
      actions={
        <span className={ADD}>
          <Button variant="primary" size="sm" onClick={onCreateDedicated}>
            <IconPlus size="sm" aria-hidden="true" />
            New Workspace
          </Button>
          <Menu
            label="Other ways to add a Workspace"
            icon={<IconChevronDown size="sm" />}
            groups={[
              [
                {
                  label: 'Map an existing folder',
                  icon: <IconFolderPlus size="sm" aria-hidden="true" />,
                  onSelect: () => setMapping(true),
                },
              ],
            ]}
          />
        </span>
      }
    >
      <ul className={ROWS} aria-label="Workspaces">
        {workspaces.map((workspace) => (
          <Row
            key={workspace.id}
            workspace={workspace}
            open={expanded === workspace.id}
            renderDetails={renderDetails}
            onOpenChange={(open) => onExpandedChange?.(open ? workspace.id : null)}
            onCleanup={() => onCleanup(workspace.id)}
          />
        ))}
      </ul>
      <MapFolderDialog
        open={mapping}
        onOpenChange={setMapping}
        onBrowse={onBrowse}
        onMap={onMapFolder}
      />
    </Card>
  )
}

/** One Workspace: its line, and what it holds under it while it is open. */
function Row({
  workspace,
  open,
  renderDetails,
  onOpenChange,
  onCleanup,
}: {
  workspace: WorkspaceRow
  open: boolean
  renderDetails: ((id: string) => ReactNode) | undefined
  onOpenChange: (open: boolean) => void
  onCleanup: () => void
}): ReactNode {
  const turning = useTransition(arrival)
  // A dimension has a spring of its own, which never turns round: the room under the row is one.
  const folding = useTransition(fold)
  const details = useId()
  const state = STATES[workspace.state]
  const { summary } = workspace
  const cleanable = workspace.dedicated && workspace.state !== 'cleaned'
  return (
    <li>
      <CardRow>
        {renderDetails !== undefined && (
          <IconButton
            variant="ghost"
            size="sm"
            icon={
              <motion.span
                aria-hidden="true"
                className={CHEVRON}
                animate={{ rotate: open ? 180 : 0 }}
                transition={turning}
              >
                <IconChevronDown size="sm" />
              </motion.span>
            }
            aria-label={`Details of ${workspace.name}`}
            aria-expanded={open}
            // Named only while it is there: the details are out of the page once folded.
            aria-controls={open ? details : undefined}
            onClick={() => onOpenChange(!open)}
          />
        )}
        <span className={LINE}>
          <span className={HEAD}>
            <span className={NAME}>{workspace.name}</span>
            <span className={STATE}>
              <StatusDot status={state.tone} />
              {state.word}
            </span>
            {workspace.main && <Badge tone="primary">main</Badge>}
            {workspace.dedicated && <Badge tone="neutral">dedicated</Badge>}
            {workspace.specKey !== undefined && <Badge tone="neutral">{workspace.specKey}</Badge>}
          </span>
          <span className={PATH}>{workspace.path}</span>
          {summary !== undefined && (
            <span className={SUMMARY}>
              <span className={MARK}>
                <IconGitBranch size="sm" aria-hidden="true" />
                <span className={MONO}>{summary.branch}</span>
              </span>
              <span className={MONO}>{summary.commit.slice(0, 7)}</span>
              <span>{summary.changes}</span>
            </span>
          )}
        </span>
        {cleanable && (
          <Button
            variant="ghost"
            size="sm"
            className={CLEANUP}
            aria-label={`Clean up ${workspace.name}`}
            onClick={onCleanup}
          >
            <IconTrash size="sm" aria-hidden="true" />
            Clean up
          </Button>
        )}
      </CardRow>
      {renderDetails !== undefined && (
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={details}
              className={ROOM}
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={folding}
            >
              <div className={DETAILS}>{renderDetails(workspace.id)}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </li>
  )
}
