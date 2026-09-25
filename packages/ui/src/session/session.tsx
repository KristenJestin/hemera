import { cn } from 'cn'
import { motion } from 'motion/react'
import type { Transition } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { Button, IconButton } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { List, ListItem } from '../components/list/list.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconArchive, IconInfoCircle, IconMessages, IconPencil, IconRestore } from '../icons.ts'
import { LABEL_DELAY, LABEL_TRAVEL, instant, morph, useTransition } from '../motion.ts'

/**
 * The Session: the head of its page, the state of one nobody has written in yet, the list of
 * the ones taken out of the sidebar, and the line the sidebar draws for one (design D4b-07,
 * D4b-08).
 *
 * A Session is a thread the user writes in, and nothing else: this lot has no engine and no
 * agent, so nothing here answers, and every word about time or about persistence is a word the
 * page was handed — a design system that formatted a date would be a design system with a
 * locale of its own. What is decided here is what a Session looks like in the four places it
 * is seen, and what each of those places offers to do with it.
 *
 * The thread itself is `message/`, and the composer is `composer/`: this file draws around
 * them, never inside them.
 */

/** What the head of a Session says, and what it offers to do with it. */
const HEAD = 'flex items-center gap-3'

/** The title and where the Session lives, on one line, taking the room its controls leave. */
const COLUMN = 'flex min-w-0 flex-1 items-baseline gap-3'

/** The title, which truncates rather than pushing the directory and the menu out of the line. */
const TITLE = 'min-w-0 truncate text-2xl font-medium'

/**
 * The title as a control, which is what opens Rename.
 *
 * It is drawn as the title it is and not as a button beside it: the words are already on the
 * line, and the hand that wants the name changed is on them — the one control that names a
 * Session since the head's `…` menu went (lot 5c, issue #115).
 */
const TITLE_ACTION = 'focus-ring -mx-1 min-w-0 truncate rounded-md px-1 text-left hover:bg-accent'

/** Where the Session lives: the Project it belongs to, and what it holds. */
const SUB = 'min-w-0 truncate text-sm text-muted-foreground'

/** The commands of the head, at the end of the line rather than under it. */
const ACTIONS = 'ml-auto flex shrink-0 items-center gap-2'

/** The field and the words that say how it ends, on the line the title was on. */
const EDIT = 'flex min-w-0 items-center gap-3'

/**
 * The title while it is being typed: the same line, its own underline saying so.
 *
 * The ring is on the box around the control and not on the control, which is a replaced
 * element and renders no pseudo-element at all — the reason the catalogue's fields are built
 * the same way.
 */
const FIELD = 'focus-ring flex min-w-0 flex-1'

const INPUT =
  'w-full min-w-0 border-b-2 border-primary bg-transparent text-2xl font-medium text-foreground outline-none'

/** How the field ends, said where the keystrokes are read rather than in a tooltip. */
const HINT = 'text-xs text-muted-foreground'

export interface SessionHeaderProps {
  /**
   * What the Session is called.
   *
   * The page names a new one — the prototype's `Untitled` — and this file never invents one:
   * a title derived from the first message is a proposal the domain makes, not a word the
   * design system decides on.
   */
  title: string
  /** The Project it belongs to, which is where it will be found again. */
  projectName: string
  /** The rest of the line under the title, already written: `created 3 days ago · 5 messages`. */
  meta: string
  /**
   * What the title becomes, once it is saved.
   *
   * Required, and never called on a keystroke: a page that wrote a version of the Session per
   * character typed would be a page the engine refuses as stale, which is the same reason the
   * Project's settings save on a press and not as they are typed.
   */
  onRename: (title: string) => void
  /**
   * Whether the title is being typed right now.
   *
   * The page opens it: a Session that has just been created opens on it, because the title is
   * the one thing a new Session has to say about itself. The Rename control opens it too.
   */
  editing?: boolean | undefined
  /** Opens the field, which is what the Rename control does. */
  onStartEditing?: (() => void) | undefined
  /** Closes it without keeping what was typed. */
  onCancelEditing?: (() => void) | undefined
  /**
   * Opens the Session's details: its plan and files, its commands, and what its agent works from.
   *
   * They are a dialog the reader opens and never a column beside the thread (second review of
   * #18), and this is the one way to them, at the end of the head's line.
   */
  onOpenDetails?: (() => void) | undefined
}

/**
 * The head of a Session: what it is called, where it lives, and what can be done to it.
 *
 * One line (review of #40, defect 4): the title, the directory it lives in, and the commands at
 * the end of the same line. The title is the page's first line and the only editable one, so it
 * is edited where it stands — a dialog over the page to change a line of it would hide the thread
 * being named — and the title is itself the control that opens the field, because that is where
 * the hand already is.
 *
 * The head carries no command menu (lot 5c, issue #115): Rename is the title itself, and Archive
 * is the Session's row in the sidebar, where the Session is listed and where a Session is looked
 * for. The end of the head's line is left to the one control a mission Session needs there, the
 * button that stands for its chat, and this file draws no control of its own beside it.
 *
 * Nothing here carries an outer margin: where the head sits in the page is the page's, and a
 * component that spaced itself would be a component that could not be moved.
 */
export function SessionHeader({
  title,
  projectName,
  meta,
  onRename,
  editing = false,
  onStartEditing,
  onCancelEditing,
  onOpenDetails,
}: SessionHeaderProps): ReactNode {
  const titleControl = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  // Where the keyboard goes when the field closes. It goes back to the control that opened it
  // and not to the top of the page: a field that takes the caret and then drops it on `<body>`
  // is a page the keyboard has to walk again from its first control. On a new Session the page
  // opened the field itself, and the answer is the same — the head is where the title is.
  useEffect(() => {
    if (wasEditing.current && !editing) titleControl.current?.focus()
    wasEditing.current = editing
  }, [editing])
  return (
    <div className={HEAD}>
      <div className={COLUMN}>
        {editing ? (
          <TitleField initial={title} onCommit={onRename} onCancel={onCancelEditing} />
        ) : (
          <h1 className={TITLE}>
            {onStartEditing === undefined ? (
              title
            ) : (
              <button
                type="button"
                ref={titleControl}
                className={TITLE_ACTION}
                onClick={onStartEditing}
              >
                {title}
              </button>
            )}
          </h1>
        )}
        <p className={SUB}>{`${projectName} · ${meta}`}</p>
      </div>
      <div className={ACTIONS}>
        {onOpenDetails !== undefined && (
          <Tooltip label="Session details">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconInfoCircle size="sm" />}
              aria-label="Session details"
              onClick={onOpenDetails}
            />
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/**
 * The title, while it is being typed.
 *
 * It is a field and not a dialog, and it ends on Enter, on Escape, and on the click that goes
 * somewhere else on the page — a question left open in the head of a page asks itself again every
 * time the eye passes over it, and a field that stays open after the person is done with it is a
 * field that never got its answer. Both of the answers it takes are written under the field: a
 * keystroke explained in a tooltip arrives after the keystroke. What is typed is kept by the page,
 * not here: this holds a draft and hands it over once, which is what keeps the engine from being
 * asked to write a version per character.
 */
function TitleField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: (() => void) | undefined
}): ReactNode {
  const [draft, setDraft] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  // An ending is one ending. Every way out leaves through the same door — the field closing —
  // and this is what keeps the second one from arriving at a page that has already moved on.
  const ended = useRef(false)
  const asked = useRef<'keep' | 'drop' | null>(null)

  function end(): void {
    if (ended.current) return
    ended.current = true
    const why = asked.current
    asked.current = null
    const named = draft.trim()
    try {
      // An empty name, and the name the Session already had, are not renamings: the title the
      // Project derives from the first message is the title it derived, and the field just
      // closes.
      if (why !== 'drop' && named !== '' && named !== initial) onCommit(named)
      else onCancel?.()
    } finally {
      // The ending is one ending, not one for the life of the field: the door is shut while it
      // is being gone through, and open again after. A rename the engine refused leaves the
      // field where it was, on purpose, and a latch left down would be a field nobody can leave
      // a second time — typed into, and never saved again.
      ended.current = false
    }
  }

  /** The way out: the caret leaves the field before the field does, and what it meant is kept. */
  function leave(why: 'keep' | 'drop'): void {
    asked.current ??= why
    // An element taken out of the page while it holds the focus leaves the keyboard nowhere to
    // be, and the head takes the focus back the moment it is drawn again.
    input.current?.blur()
  }

  return (
    <div className={EDIT}>
      <span className={FIELD}>
        <input
          // The field is opened by the page, on purpose, on a Session whose name is the thing
          // being asked for: taking the caret without being asked is exactly what it is for
          // here, where on any other field it would be an interruption.
          autoFocus
          aria-label="Title of the Session"
          className={INPUT}
          ref={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => end()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              leave('keep')
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              leave('drop')
            }
          }}
        />
      </span>
      <span className={HINT}>Enter to save · Esc to cancel</span>
    </div>
  )
}

/** The panel a thread that holds nothing shows in its place. */
const EMPTY = 'flex flex-col items-center gap-2.5 px-6 py-10 text-center'

/** The square of icon above it: the page's quieter surface, one step in from the thread's. */
const EMPTY_ICON =
  'flex size-12 items-center justify-center rounded-lg bg-muted text-muted-foreground'

const EMPTY_TITLE = 'text-lg font-medium'

const EMPTY_NOTE = 'max-w-md text-sm text-muted-foreground'

/**
 * What a Session says when nobody has written in it yet.
 *
 * It is not a hint at the top of an empty box: it stands where the thread will be, and it says
 * the one thing that is true of this lot — the first message names the Session, and what is
 * written is kept whether or not an agent ever joins. Nothing is faked under it, no entry is
 * drawn to fill the page, and no composer is offered twice.
 *
 * The words are the product's and not the page's: they are the same on every empty Session,
 * and a page that passed them in would be a page that could say something else.
 */
export function SessionEmpty(): ReactNode {
  return (
    <div className={EMPTY}>
      <span className={EMPTY_ICON} aria-hidden="true">
        <IconMessages size="lg" />
      </span>
      <p className={EMPTY_TITLE}>Nothing written yet</p>
      <p className={EMPTY_NOTE}>
        Your first message names the Session for you. Everything you write here is kept, whether or
        not an agent ever joins.
      </p>
    </div>
  )
}

/** The page of the Sessions that were taken out of the sidebar. */
const PAGE = 'mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10'

const NOTE = 'text-sm text-muted-foreground'

export interface ArchivedSession {
  id: string
  title: string
  /** When it was archived, already written for the platform. */
  archivedAt: string
  /** What it holds and when it was last written, already written: `5 messages · last written 2 weeks ago`. */
  detail?: string | undefined
}

export interface ArchivedSessionsProps {
  /** The Sessions taken out of the sidebar, in the order they are shown. */
  sessions: ArchivedSession[]
  /** Puts one back in the sidebar, where it is worked in again. */
  onRestore: (id: string) => void
}

/**
 * The Sessions that were archived, and the one way back.
 *
 * Reached from the sidebar's own line and from the palette, which is why it is a page of its
 * own and not a card in the settings: what it lists belongs to the Project in front, not to
 * the application. Nothing is ever deleted in this lot, so there is no second control here —
 * a list of things that can only be brought back is a list with one verb.
 *
 * An empty list is not an error and says so: a Project where nothing has been archived yet is
 * the usual state of a Project, and an empty page would look like one that failed to load.
 */
export function ArchivedSessions({ sessions, onRestore }: ArchivedSessionsProps): ReactNode {
  return (
    <div className={PAGE}>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">Archived Sessions</h1>
        <p className={NOTE}>Out of the sidebar, kept whole. Restore one to work in it again.</p>
      </div>
      <Card>
        {sessions.length === 0 ? (
          <p className={NOTE}>No Session has been archived. Nothing is ever deleted.</p>
        ) : (
          <List label="Archived Sessions">
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                icon={<IconArchive size="sm" />}
                title={session.title}
                description={
                  session.detail === undefined
                    ? `archived ${session.archivedAt}`
                    : `archived ${session.archivedAt} · ${session.detail}`
                }
                trailing={
                  <Button
                    variant="secondary"
                    size="sm"
                    // Named by what it restores: a page of Restore buttons is a page a screen
                    // reader cannot tell one row of from the next.
                    aria-label={`Restore ${session.title}`}
                    onClick={() => onRestore(session.id)}
                  >
                    <IconRestore size="sm" />
                    Restore
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </Card>
    </div>
  )
}

/**
 * The sidebar's line for one Session.
 *
 * It is the sidebar's own entry — the same shape, the same travelling mark, the same fold —
 * and it is written here because a Session is the one entry of that list that carries a second
 * thing: the two commands a row has no room for, offered from its own end. They are drawn
 * under the hand and under the keyboard and not before, because the list is read by its names
 * and a column of controls is a column of noise.
 *
 * Two controls and not the prototype's overflow: the catalogue has no ellipsis, and Tabler
 * comes through `icons.ts` and nowhere else, so a menu would mean a new icon in the catalogue
 * for two commands that fit. It is also why nothing here is a menu: the row is a button, and a
 * button inside a button is not a row anybody can press.
 *
 * The mark's `layoutId` is the sidebar's own, so that the one filled surface of the panel is
 * handed from a Session to the Journal rather than each entry drawing its own.
 */
export function SidebarSessionEntry({
  title,
  active,
  collapsed,
  onSelect,
  onRename,
  onArchive,
}: {
  /** What the Session is called, said in the row and read out as its name. */
  title: string
  /** Whether the window is on it. */
  active: boolean
  /** Whether the panel is folded to its rail, where a row is its icon and nothing else. */
  collapsed: boolean
  onSelect: () => void
  /** Renames it, in place, in the head of its page. */
  onRename?: (() => void) | undefined
  /** Takes it out of the sidebar. */
  onArchive?: (() => void) | undefined
}): ReactNode {
  const transition = useTransition(morph)
  // `useTransition` hands back this very object when the system asks for less movement, and a
  // delay is still a wait: the label takes its own only when there is a journey to wait for.
  const still = transition === instant
  const labels = collapsed || still ? transition : { ...transition, delay: LABEL_DELAY }
  const commands = !collapsed && (onRename !== undefined || onArchive !== undefined)
  return (
    <div className="group relative flex w-full">
      <Tooltip label={title} side="right" disabled={!collapsed}>
        <Button
          variant="ghost"
          className={ENTRY}
          aria-label={title}
          aria-current={active ? 'true' : undefined}
          onClick={onSelect}
        >
          {active && <motion.span layoutId="active-nav" className={MARK} transition={transition} />}
          <span className={cn(ICON_PLACE, active ? ICON_ACTIVE : ICON)}>
            <IconMessages size="md" />
          </span>
          <Label collapsed={collapsed} transition={labels}>
            {title}
          </Label>
        </Button>
      </Tooltip>
      {commands && (
        <span className={COMMANDS}>
          {onRename !== undefined && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconPencil size="sm" />}
              aria-label={`Rename ${title}`}
              onClick={onRename}
            />
          )}
          {onArchive !== undefined && (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconArchive size="sm" />}
              aria-label={`Archive ${title}`}
              onClick={onArchive}
            />
          )}
        </span>
      )}
    </div>
  )
}

/**
 * The row: the panel's own button, full width, with nothing of its own but the alignment.
 *
 * What the sidebar's own entry carries as padding is carried here by the things inside it —
 * see the icon's own note below — because spacing is a component's to decide and not its
 * caller's, and the design system's lint refuses a padding class on a button.
 */
const ENTRY = 'w-full shrink-0 justify-start'

/** The one filled surface of the sidebar: the place being looked at, pressed into the panel. */
const MARK = 'absolute inset-0 rounded-md bg-sidebar-accent'

/**
 * Where the icon of a row sits, and what it weighs when the row is not the one looked at.
 *
 * A margin of one step, and it is not the padding the sidebar's own entry carries: a `Button`
 * draws its own — one step of the density for the size it is drawn at — and a class of padding
 * on one is refused. So the icon is put back where it belongs from the outside, one step plus
 * the transparent border the ghost variant draws, which lands it one pixel right of the middle
 * of the rail. The day the button's density changes, this is the number that follows it.
 */
const ICON_PLACE = 'relative ml-1 flex shrink-0'

const ICON = 'text-muted-foreground'

const ICON_ACTIVE = 'text-sidebar-accent-foreground'

/**
 * The two commands of a row, laid over the end of it.
 *
 * Over it and not beside it: a control that took its width from the row would shorten the
 * title the moment the pointer arrived, which is a list that moves under the hand reading it.
 * The row is a button, so they are its siblings and never its children.
 */
const COMMANDS =
  'absolute inset-y-0 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'

/** The part of a row that goes away with the width, and comes back after it. */
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
      className="relative ml-3 truncate"
      initial={false}
      animate={{ opacity: collapsed ? 0 : 1, x: travel }}
      transition={transition}
    >
      {children}
    </motion.span>
  )
}
