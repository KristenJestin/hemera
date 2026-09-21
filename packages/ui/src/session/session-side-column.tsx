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
 */
const COLUMN = 'flex w-full flex-col gap-2'

const FILES = 'flex flex-col gap-1 pt-1'

const FILE = 'flex items-baseline gap-2'

const PATH = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const COUNTS = 'ml-auto flex shrink-0 items-center gap-1.5 font-mono text-xs'

const ADDED = 'text-success-muted-foreground'

const REMOVED = 'text-destructive-muted-foreground'

const NOTHING = 'pt-1 text-sm text-muted-foreground'

/** A file the turn touched, with what the change added up to. */
export interface TouchedFile {
  /** The path, as the call named it. */
  path: string
  added: number
  removed: number
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
  return (
    <aside className={cn(COLUMN, className)}>
      <PlanPanel entries={plan} />
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
        {files.length === 0 ? (
          <p className={NOTHING}>No file has been touched yet.</p>
        ) : (
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
        )}
      </Disclosure>
    </aside>
  )
}
