import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Tabs } from '../components/tabs/tabs.tsx'
import { IconActivity, IconBrain, IconCommand, IconFolderOpen } from '../icons.ts'
import { PlanPanel, type PlanEntry } from './plan-panel.tsx'

/**
 * What the session has been doing, beside it (design D17-17, D6-10 and D6-12).
 *
 * Three questions a reader has while an agent works, and none of them belongs in the thread: the
 * plan it is working to and the files it has touched, the commands it runs, and what it is
 * working from. All three are states rather than events — the thread already carries every call
 * that touched them — so they live here, where they are read once and checked on, and where
 * growing them does not push the conversation down the page.
 *
 * They are three tabs and not three stacked panels because a column that grows downwards is a
 * column the reader scrolls, and what a reader scrolls past is what they stop reading. The plan
 * keeps the tab it had, since it is what a Session is watched through; the Commands panel and
 * the Context view arrive as the tab beside it (D6-12, D6-10), and the tab a Session opens on
 * follows what is happening in it — a Session with a server running opens on its commands.
 *
 * The column is not a second inbox and carries nothing that arrived: what is listed here is what
 * the turn has done, and a file is listed because a call named it.
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

const NOTHING = 'pt-1 text-sm text-muted-foreground'

/** A file the turn touched, with what the change added up to. */
export interface TouchedFile {
  /** The path, as the call named it. */
  path: string
  added: number
  removed: number
}

/** The tab the column opens on, which is the one a reader came back for. */
export type SideColumnTab = 'activity' | 'commands' | 'context'

export interface SessionSideColumnProps {
  /** The plan as the agent last sent it. */
  plan: readonly PlanEntry[]
  /** The files the turn has touched. */
  files: readonly TouchedFile[]
  /** The Commands panel of this Session, handed over already drawn. */
  commands?: ReactNode
  /** The Context view of this Session, handed over already drawn. */
  context?: ReactNode
  /** The tab it opens on. The plan's, unless the Session says otherwise. */
  defaultTab?: SideColumnTab | undefined
  /** Opens one of them, when the reader presses its path. */
  onSelectFile?: ((path: string) => void) | undefined
  /** Where the column sits; never how it looks. */
  className?: string | undefined
}

/**
 * Whether anything stands beside the thread (review of #40, defect 3).
 *
 * The rule is the column's own and not the page's: a page that decided it for itself would be a
 * second place for it to drift, and the width the column takes is taken from the thread. The plan
 * and the files are the two the column can count, and a Commands panel or a Context view is handed
 * over only by a caller that has one to show: being handed either of them is the answer for those
 * two, so a Session that has run a command keeps its column.
 */
function hasSideColumn({ plan, files, commands, context }: SessionSideColumnProps): boolean {
  const hasCommands = commands !== null && commands !== undefined
  const hasContext = context !== null && context !== undefined
  return plan.length > 0 || files.length > 0 || hasCommands || hasContext
}

export function SessionSideColumn({
  plan,
  files,
  commands,
  context,
  defaultTab = 'activity',
  onSelectFile,
  className,
}: SessionSideColumnProps): ReactNode {
  // Nothing to show, nothing to draw: the column is not rendered and the thread keeps its
  // width, since it is the column's own box that is missing and there is no wrapper around it.
  if (!hasSideColumn({ plan, files, commands, context })) return null
  return (
    <aside className={cn(COLUMN, className)}>
      {/* The icons alone: three labelled tabs are wider than the column, and a strip wider than
          its column is a column that scrolls sideways (trial of 23 September 2026). Each tab is
          still named by its label, which the tooltip says under the hand. */}
      <Tabs
        label="What this Session is doing"
        iconsOnly
        defaultValue={defaultTab}
        items={[
          {
            value: 'activity',
            label: 'Activity',
            icon: <IconActivity size="sm" />,
            panel: (
              <>
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
                              {/* One line, cut at its end rather than clipped: a path is one
                                  word, and the link holds it to the column's width. */}
                              <span className="min-w-0 truncate">{file.path}</span>
                            </Button>
                          )}
                          <span className={COUNTS}>
                            {file.added > 0 ? (
                              <span className={ADDED}>{`+${file.added}`}</span>
                            ) : null}
                            {file.removed > 0 ? (
                              <span className={REMOVED}>{`-${file.removed}`}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </>
            ),
          },
          {
            value: 'commands',
            label: 'Commands',
            icon: <IconCommand size="sm" />,
            panel: commands ?? <p className={NOTHING}>No command has run in this Session.</p>,
          },
          {
            value: 'context',
            label: 'Context',
            icon: <IconBrain size="sm" />,
            panel: context ?? <p className={NOTHING}>Hemera has nothing to say about it yet.</p>,
          },
        ]}
      />
    </aside>
  )
}
