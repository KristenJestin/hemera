import { cn } from 'cn'
import { motion } from 'motion/react'
import type { Transition } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button, IconButton } from '../components/button/button.tsx'
import { Menu } from '../components/menu/menu.tsx'
import { IconArchive, IconDots, IconMessages, IconPencil, IconPlus } from '../icons.ts'
import { LABEL_TRAVEL, morph, useTransition } from '../motion.ts'
import type { ShellSession } from '../shell/model.ts'
import { InlineRename } from './inline-rename.tsx'
import { shownTitle } from './model.ts'

/**
 * The Sessions of the active Project, as the sidebar lists them (design D4b-04, D4b-06).
 *
 * The order is the caller's — last written first — and this list does not sort: a panel that
 * re-ordered what it was handed would disagree with the engine the moment the two counted a
 * write differently. What it does own is keeping the marked row where it can be seen: a
 * Session that goes on being written in climbs, one that is not sinks, and the one being read
 * is scrolled back into view rather than left below the fold.
 *
 * Each row carries the two things that can happen to a Session and nothing else: renamed,
 * in place, in the row itself; archived, which takes it out of this list and leaves it whole
 * behind the `n archived` line at the bottom. No deletion — « Aucune suppression proposée ».
 *
 * Empty, it says so and offers to create one. The scenario « Aucune Session » asks for exactly
 * that: the state said out loud, and no greyed-out row pretending to be a Session.
 */
const GROUP =
  'flex shrink-0 items-center gap-1 px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

const ROW = 'relative flex shrink-0 items-center gap-1'

/**
 * The part of the row that opens the Session, padded like every other entry of the panel.
 *
 * A control of its own rather than the catalogue's `Button`: a row holds a second control —
 * its `…` — and a button cannot hold a button, so what the row needs is the shape of an entry
 * without the element. The padding is the panel's, so the middle of the icon lands on the
 * middle of the rail when the sidebar folds.
 */
const SELECT =
  'relative flex h-control-md min-w-0 flex-1 items-center gap-3 rounded-md px-4 text-left outline-none hover:bg-accent focus-ring'

/**
 * The mark of the active entry, drawn exactly as the sidebar draws its own.
 *
 * Same `layoutId`, so the mark is one element the whole panel hands between its places rather
 * than one per list appearing and disappearing. Written here rather than imported from the
 * sidebar: the sidebar is what composes this list, and a list reaching back into it would be a
 * circle between two files.
 */
const MARK = 'absolute inset-0 rounded-md bg-sidebar-accent'

const ICON = 'text-muted-foreground'

const ICON_ACTIVE = 'text-sidebar-accent-foreground'

const TIME = 'shrink-0 text-xs text-muted-foreground'

const ARCHIVED =
  'flex h-control-sm w-full shrink-0 items-center gap-3 rounded-md px-4 text-left text-sm text-muted-foreground outline-none hover:bg-accent focus-ring'

const EMPTY = 'px-4 py-2 text-sm text-muted-foreground'

export interface SidebarSessionEntryProps {
  session: ShellSession
  /** Whether the window is on this Session. */
  active: boolean
  /** Whether the panel is folded to its rail, where a row is an icon and nothing else. */
  collapsed?: boolean | undefined
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
}

export function SidebarSessionEntry({
  session,
  active,
  collapsed = false,
  onSelect,
  onRename,
  onArchive,
}: SidebarSessionEntryProps): ReactNode {
  const transition = useTransition(morph)
  const [renaming, setRenaming] = useState(false)
  const title = shownTitle(session.title)

  if (renaming) {
    return (
      <div className={ROW}>
        <InlineRename
          title={session.title}
          label={`Rename ${title}`}
          className="mx-1 text-sm"
          onRename={(next) => onRename(session.id, next)}
          onDone={() => setRenaming(false)}
        />
      </div>
    )
  }

  return (
    <div className={ROW}>
      {active && <motion.span layoutId="active-nav" className={MARK} transition={transition} />}
      <button
        type="button"
        className={SELECT}
        aria-label={title}
        aria-current={active ? 'true' : undefined}
        onClick={() => onSelect(session.id)}
      >
        <span className={cn('relative flex shrink-0', active ? ICON_ACTIVE : ICON)}>
          <IconMessages size="md" />
        </span>
        <Label collapsed={collapsed} transition={transition}>
          {title}
        </Label>
        {session.writtenAt !== undefined &&
          !collapsed && (
            // On the filled row it takes the colour that reads on it: the quiet one is meant for
            // the panel's own surface, and on the mark it falls under the contrast threshold.
            <span className={cn('relative ml-auto', TIME, active && ICON_ACTIVE)}>
              {session.writtenAt}
            </span>
          )}
      </button>
      {/* Folded, the row is an icon: a menu hanging off a rail would open onto the content
          beside it, about a Session whose name is no longer on screen. */}
      {!collapsed && (
        <Menu
          label={`Actions for ${title}`}
          className="relative"
          trigger={
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconDots size="sm" />}
              aria-label={`Actions for ${title}`}
            />
          }
          groups={[
            [
              {
                label: 'Rename',
                icon: <IconPencil size="sm" />,
                onSelect: () => setRenaming(true),
              },
              {
                label: 'Archive',
                icon: <IconArchive size="sm" />,
                onSelect: () => onArchive(session.id),
              },
            ],
          ]}
        />
      )}
    </div>
  )
}

export interface SidebarSessionsProps {
  /** The Sessions of the active Project, already in the order they are to be listed in. */
  sessions: ShellSession[]
  /** Which one the window is on, and null when it is somewhere else. */
  activeId: string | null
  /** How many are archived; the line to the archives is drawn only when there is one. */
  archivedCount?: number | undefined
  collapsed?: boolean | undefined
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onOpenArchived: () => void
}

export function SidebarSessions({
  sessions,
  activeId,
  archivedCount = 0,
  collapsed = false,
  onSelect,
  onCreate,
  onRename,
  onArchive,
  onOpenArchived,
}: SidebarSessionsProps): ReactNode {
  const transition = useTransition(morph)
  const marked = useRef<HTMLDivElement>(null)

  // The list is sorted by last write, so the Session being read moves down it while somebody
  // writes in another one. Bringing it back into view is the whole of D4b-04's second half.
  useEffect(() => {
    marked.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <>
      <div className={GROUP}>
        <Label collapsed={collapsed} transition={transition}>
          Sessions
        </Label>
        {/* The plus goes when the list is empty: what offers to create a Session then is the
            empty state below, in words, and two controls with one name is one of them wasted. */}
        {sessions.length > 0 && (
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconPlus size="sm" />}
            aria-label="New session"
            className="ml-auto"
            onClick={onCreate}
          />
        )}
      </div>

      {sessions.length === 0
        ? !collapsed && (
            <div className="flex shrink-0 flex-col items-start gap-1 px-2">
              <p className={EMPTY}>No Session yet</p>
              <Button variant="ghost" size="sm" onClick={onCreate}>
                <IconPlus size="sm" />
                New session
              </Button>
            </div>
          )
        : sessions.map((session) => (
            <div key={session.id} ref={session.id === activeId ? marked : undefined}>
              <SidebarSessionEntry
                session={session}
                active={session.id === activeId}
                collapsed={collapsed}
                onSelect={onSelect}
                onRename={onRename}
                onArchive={onArchive}
              />
            </div>
          ))}

      {archivedCount > 0 && !collapsed && (
        <button type="button" className={ARCHIVED} onClick={onOpenArchived}>
          <span className={cn('flex shrink-0', ICON)}>
            <IconArchive size="sm" />
          </span>
          {archivedCount} archived
        </button>
      )}
    </>
  )
}

/**
 * The part of a row that goes away with the width, and comes back after it.
 *
 * The sidebar draws its own labels the same way; this list keeps its copy for the same reason
 * the mark above is written twice, and it is four lines of animation rather than a dependency
 * running back up into the panel that composes it.
 */
function Label({
  collapsed,
  transition,
  children,
}: {
  collapsed: boolean
  transition: Transition
  children: ReactNode
}): ReactNode {
  const travel = collapsed ? -LABEL_TRAVEL : 0
  return (
    <motion.span
      className="relative truncate"
      initial={false}
      animate={{ opacity: collapsed ? 0 : 1, x: travel }}
      transition={transition}
    >
      {children}
    </motion.span>
  )
}
