import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { IconFolderOpen } from '../icons.ts'
import { PlanPanel, type PlanEntry } from './plan-panel.tsx'

/**
 * What the session has been doing, beside it (design D17-17).
 *
 * Two questions a reader has while an agent works, and neither of them belongs in the thread: the
 * plan it is working to, and the files it has touched. Both are states rather than events — the
 * thread already carries every call that touched them — so they live here, where they are read
 * once and checked on, and where growing them does not push the conversation down the page.
 *
 * The column is not a second inbox and carries nothing that arrived: what is listed here is what
 * the turn has done, and a file is listed because a call named it.
 *
 * Nothing to say is nothing to draw: a section with nothing in it is not rendered, and a column
 * with no section is not rendered at all, because an empty `Plan 0 of 0` and a `Files 0` take the
 * width the thread needs and say nothing with it.
 */
/**
 * The column is a box of its own: the width of a side column, the line that separates it from the
 * thread, and the room for what it holds. It is not something a caller adds — a component restyled
 * from outside is what the lint refuses — and the border is the column's rather than the page's,
 * since the page draws no wrapper around it: a column with nothing to show leaves no box behind
 * (review of #40, defect 3).
 */
const COLUMN =
  'flex w-sidebar shrink-0 flex-col gap-2 overflow-y-auto border-l border-border px-4 py-6'

const FILES = 'flex flex-col gap-1 pt-1'

const FILE = 'flex items-baseline gap-2'

const PATH = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const COUNTS = 'ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs'

const ADDED = 'text-success-muted-foreground'

const REMOVED = 'text-destructive-muted-foreground'

/** A file the turn touched, with what the change added up to. */
export interface TouchedFile {
  /** The path, as the call named it. */
  path: string
  added: number
  removed: number
}

/**
 * Whether anything stands beside the thread (review of #40, defect 3).
 *
 * The rule is the column's own and not the page's: a page that decided it for itself would be a
 * second place for it to drift, and the width the column takes is taken from the thread.
 */
function hasSideColumn(plan: readonly PlanEntry[], files: readonly TouchedFile[]): boolean {
  return plan.length > 0 || files.length > 0
}

export interface SessionSideColumnProps {
  /** The plan as the agent last sent it. */
  plan: readonly PlanEntry[]
  /** The files the turn has touched. */
  files: readonly TouchedFile[]
  /** Opens one of them, when the reader presses its path. */
  onSelectFile?: ((path: string) => void) | undefined
  /** Where the column sits; never how it looks. */
  className?: string | undefined
}

export function SessionSideColumn({
  plan,
  files,
  onSelectFile,
  className,
}: SessionSideColumnProps): ReactNode {
  // Nothing to show, nothing to draw: the column is not rendered and the thread keeps its
  // width, since it is the column's own box that is missing and there is no wrapper around it.
  if (!hasSideColumn(plan, files)) return null
  return (
    <aside className={cn(COLUMN, className)}>
      {plan.length === 0 ? null : <PlanPanel entries={plan} />}
      {files.length === 0 ? null : (
        <Disclosure
          summary={
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
                <IconFolderOpen size="sm" />
              </span>
              <span className="text-sm text-foreground">Files</span>
              <Badge tone="neutral">{`${files.length}`}</Badge>
            </span>
          }
        >
          <ul className={FILES}>
            {files.map((file) => (
              <li key={file.path} className={FILE}>
                {onSelectFile === undefined ? (
                  <span className={PATH}>{file.path}</span>
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    className="min-w-0"
                    onClick={() => {
                      onSelectFile(file.path)
                    }}
                  >
                    {file.path}
                  </Button>
                )}
                <span className={COUNTS}>
                  {file.added > 0 ? <span className={ADDED}>{`+${file.added}`}</span> : null}
                  {file.removed > 0 ? <span className={REMOVED}>{`-${file.removed}`}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </aside>
  )
}
