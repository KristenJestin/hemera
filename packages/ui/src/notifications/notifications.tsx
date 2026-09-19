import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../components/button/button.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconBell } from '../icons.ts'
import type { ProjectTone } from '../shell/model.ts'

/**
 * The bell of the chrome bar, and what it opens onto (design D4-05, D4-07).
 *
 * What it lists is every unseen event of every Project, newest first, each line naming the one
 * it belongs to: a Project is a place the user is not currently looking at, and a notification
 * that did not say where it happened would be a notification they cannot act on. Choosing a
 * line goes there; `Mark all read` empties the list without touching the Journal it came from.
 *
 * The dot is the whole of what the bell says on its own. A count on it would be a number the
 * eye reads as urgency, and the counts belong on the tabs, one per Project.
 */
const DOT = 'absolute -top-0.5 -right-0.5 size-2 rounded-full border border-surface-rim bg-primary'

const LIST = 'scroll-quiet flex max-h-96 max-w-sm flex-col gap-1 overflow-y-auto'

const LINE = 'flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left hover:bg-accent'

const TONE: Record<ProjectTone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-mission-free',
}

export interface NotificationLine {
  /** The sequence of the event, which is what marks it seen. */
  sequence: number
  /** What happened, already written for a human to read. */
  label: string
  /** The Project it happened in, named on the line itself. */
  projectName: string
  tone: ProjectTone
  /** When it happened, already written for the platform. */
  when: string
  /** Goes to the Project and opens the place the event is about. */
  onOpen: () => void
}

export interface NotificationListProps {
  entries: NotificationLine[]
  onMarkAllRead: () => void
}

export function NotificationList({ entries, onMarkAllRead }: NotificationListProps): ReactNode {
  if (entries.length === 0) {
    return (
      <p className="max-w-sm text-sm text-muted-foreground">
        Nothing to see. Everything that happened has been looked at.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className={LIST} aria-label="Unseen events">
        {entries.map((entry) => (
          <li key={entry.sequence}>
            <button type="button" className={LINE} onClick={entry.onOpen}>
              <span className="flex items-center gap-2 text-sm">
                <span className={cn('size-2 shrink-0 rounded-full', TONE[entry.tone])} />
                <span className="truncate">{entry.label}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.projectName} · {entry.when}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="link" size="sm" onClick={onMarkAllRead}>
        Mark all read
      </Button>
    </div>
  )
}

export interface NotificationBellProps {
  /** Whether anything at all is left to see, which is the dot it wears. */
  unseen: boolean
  /** What the panel holds; the chrome bar hands it the list. */
  children: ReactNode
}

/** The bell itself: a control, a dot, and the panel it opens. */
export function NotificationBell({ unseen, children }: NotificationBellProps): ReactNode {
  return (
    <Popover
      title="Notifications"
      trigger={
        <IconButton
          variant="ghost"
          icon={
            // The dot is pinned to the bell and not to the button: the button lays its content
            // out and animates it, and a dot placed against that box drifted with it.
            <span className="relative flex">
              <IconBell size="md" />
              {unseen && <span aria-hidden="true" className={DOT} />}
            </span>
          }
          aria-label={unseen ? 'Notifications, some unseen' : 'Notifications'}
        />
      }
    >
      {children}
    </Popover>
  )
}
