import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { IconButton } from '../components/button/button.tsx'
import { Menu, type MenuItem } from '../components/menu/menu.tsx'
import { IconArchive, IconDots, IconPencil, IconRestore } from '../icons.ts'
import { InlineRename } from './inline-rename.tsx'
import { shownTitle } from './model.ts'

/**
 * The head of a Session: its title, what it is, and the two things that can happen to it
 * (design D4b-03, D4b-06).
 *
 * The title is renamed where it is read. A title that opens a dialog to be changed is a title
 * nobody changes: here it is a control, the same words in the same place, and one press — or
 * Enter, or F2 — turns it into a box. What is typed lands on Enter and on leaving the box, and
 * Escape leaves the Session called what it was called.
 *
 * The menu says the same thing a second way, for a hand that went looking for a menu, and it
 * offers archiving beside it. It offers no deletion, here or anywhere else: an archived Session
 * keeps its whole thread and comes back with `Restore`, which is the only end of life this
 * version has.
 */
/**
 * A block and not a `<header>`: the banner of the window is the chrome bar, and a page that
 * declared a second one would leave everything reading it two to choose between.
 */
const HEAD = 'flex items-start gap-3'

const TITLE =
  'max-w-full truncate rounded-md px-1 text-left text-2xl font-medium outline-none hover:bg-accent focus-ring'

const HINT = 'shrink-0 text-xs text-muted-foreground'

const SUBTITLE = 'flex flex-wrap items-center gap-2 px-1 text-sm text-muted-foreground'

export interface SessionHeaderProps {
  /** The Session's own title, empty for as long as no message has named it. */
  title: string
  /** The line under it: what kind of Session it is, which Project, how old. */
  subtitle?: ReactNode
  /** Whether it is out of the sidebar, which is what the menu and the badge answer. */
  archived?: boolean | undefined
  /** What it is now called. Never called with an empty title. */
  onRename: (title: string) => void
  onArchive: () => void
  /** What brings an archived Session back; absent on one that is not archived. */
  onRestore?: (() => void) | undefined
}

export function SessionHeader({
  title,
  subtitle,
  archived = false,
  onRename,
  onArchive,
  onRestore,
}: SessionHeaderProps): ReactNode {
  const [editing, setEditing] = useState(false)
  const rename: MenuItem = {
    label: 'Rename',
    icon: <IconPencil size="sm" />,
    shortcut: 'F2',
    onSelect: () => setEditing(true),
  }
  const end: MenuItem =
    archived && onRestore !== undefined
      ? { label: 'Restore', icon: <IconRestore size="sm" />, onSelect: onRestore }
      : { label: 'Archive', icon: <IconArchive size="sm" />, onSelect: onArchive }

  return (
    <div className={HEAD}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          {editing ? (
            <>
              <InlineRename
                title={title}
                label="Session title"
                className="text-2xl font-medium"
                onRename={onRename}
                onDone={() => setEditing(false)}
              />
              <span className={HINT}>Enter to save · Esc to cancel</span>
            </>
          ) : (
            <>
              <h1 className="min-w-0">
                <button
                  type="button"
                  className={TITLE}
                  aria-label={`Rename ${shownTitle(title)}`}
                  onClick={() => setEditing(true)}
                  // Enter is the button's own; F2 is the one the rest of the desktop uses, and
                  // a title that only answers a press is a title the keyboard cannot reach.
                  onKeyDown={(event) => {
                    if (event.key === 'F2') setEditing(true)
                  }}
                >
                  {shownTitle(title)}
                </button>
              </h1>
              {archived && <Badge icon={<IconArchive size="sm" />}>Archived</Badge>}
            </>
          )}
        </div>
        {subtitle !== undefined && <div className={SUBTITLE}>{subtitle}</div>}
      </div>
      <Menu
        label="Session actions"
        trigger={
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconDots size="sm" />}
            aria-label="Session actions"
          />
        }
        groups={[[rename, end]]}
      />
    </div>
  )
}
