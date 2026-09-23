import type { ReactNode } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Tabs } from '../components/tabs/tabs.tsx'
import { IconActivity, IconBrain, IconCommand, IconFolderOpen } from '../icons.ts'
import { PlanPanel, type PlanEntry } from './plan-panel.tsx'

/**
 * What the session has been doing, one press away (design D17-17, D6-10 and D6-12).
 *
 * Three questions a reader has while an agent works, and none of them belongs in the thread: the
 * plan it is working to and the files it has touched, the commands it runs, and what it is
 * working from. All three are states rather than events — the thread already carries every call
 * that touched them — so they are read here, on purpose, and growing them does not push the
 * conversation down the page.
 *
 * A centred dialog and not a column beside the thread (second review of #18): a column took a third
 * of the window from the thread whenever one of its tabs had something, and came and went with
 * what the agent did. The dialog opens when the reader asks for it, from the Session's head, and
 * nothing the agent does opens it by itself: a plan, a run or a permission that arrives updates
 * the thread and, while the dialog is open, the tab it concerns. It is as wide as the thread, its
 * content scrolls inside it, and Escape, its close button and a click outside all close it.
 *
 * Three tabs and not three stacked panels, because a reader who comes back to a Session where a
 * command is running wants that tab, not a scroll; the tab it opens on is the page's to say.
 *
 * Nothing here is a second inbox: what is listed is what the turn has done, and a file is listed
 * because a call named it.
 */

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

/** The tab the details open on, which is the one a reader came back for. */
export type SessionDetailsTab = 'activity' | 'commands' | 'context'

export interface SessionDetailsProps {
  /** Whether the dialog is open. The page holds it: only the reader opens it. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The plan as the agent last sent it. */
  plan: readonly PlanEntry[]
  /** The files the turn has touched. */
  files: readonly TouchedFile[]
  /** The Commands panel of this Session, handed over already drawn. */
  commands?: ReactNode
  /** The Context view of this Session, handed over already drawn. */
  context?: ReactNode
  /** The tab it opens on, each time it opens. The plan's, unless the Session says otherwise. */
  defaultTab?: SessionDetailsTab | undefined
  /** Opens one of them, when the reader presses its path. */
  onSelectFile?: ((path: string) => void) | undefined
}

export function SessionDetails({
  open,
  onOpenChange,
  plan,
  files,
  commands,
  context,
  defaultTab = 'activity',
  onSelectFile,
}: SessionDetailsProps): ReactNode {
  return (
    <Dialog title="Session details" size="wide" open={open} onOpenChange={onOpenChange}>
      {/* The dialog's content is mounted when it opens, so the tab it opens on is read then:
          what happens while it is open changes what a tab holds, never which tab is shown. */}
      <Tabs
        label="What this Session is doing"
        defaultValue={defaultTab}
        items={[
          {
            value: 'activity',
            label: 'Activity',
            icon: <IconActivity size="sm" />,
            panel: (
              <>
                {/* A Session can have nothing here yet, and says so like the two other tabs
                    rather than showing an empty panel. */}
                {plan.length === 0 && files.length === 0 ? (
                  <p className={NOTHING}>No plan and no file touched in this Session yet.</p>
                ) : null}
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
                                  word, and the link holds it to the dialog's width. */}
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
    </Dialog>
  )
}
