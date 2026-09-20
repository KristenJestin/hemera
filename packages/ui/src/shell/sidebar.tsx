import { cn } from 'cn'
import { LayoutGroup, motion } from 'motion/react'
import type { Transition } from 'motion/react'
import { type ReactElement, type ReactNode, useId } from 'react'

import { IconCommand, IconHome, IconPlus, IconSettings, IconTimelineEvent } from '../icons.ts'
import { LABEL_DELAY, LABEL_TRAVEL, instant, morph, useTransition } from '../motion.ts'
import { Button, IconButton } from '../components/button/button.tsx'
import { Kbd } from '../components/kbd/kbd.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { SidebarSessionEntry } from '../session/session.tsx'
import {
  HOME_ENTRY,
  JOURNAL_ENTRY,
  PROJECT_SETTINGS_ENTRY,
  SIDEBAR_RAIL,
  type ShellSession,
} from './model.ts'

/**
 * The sidebar, session-first, folding to a rail of icons (design D2-03).
 *
 * What it lists is the navigation of the product and nothing else: the command, the Home, the
 * Sessions of the active Project, the Journal, that Project's settings, and the application's
 * settings at the bottom. The button that folds it is not here but in the chrome bar above it,
 * where it stays in the same place at either width.
 *
 * Folded, it does not go away: it becomes its icons, each one keeping its name where a screen
 * reader reads it and showing it in a tooltip for everyone else. The width morphs on a preset
 * of its own — a spring past critical damping, because a panel that overshoots its width drags
 * the columns beside it back and forth — and the labels fade and slide, letting the width go
 * first on the way out and leaving with it on the way in. Under a hand on the separator there
 * is no spring at all: a width that springs while the pointer moves feels like one that sticks.
 *
 * This is the one file allowed to animate a width, and why is written down beside the rule it
 * bends, in `tools/motion-properties.ts` (design D2-09): the fold is played by the frame
 * counter at every recipe, and the exception falls the day a frame goes above two periods.
 */
/**
 * The panel is chrome, and chrome is the quiet surface.
 *
 * What is read all day is the content, so the content carries the strongest colour of the theme
 * and everything around it stands back: the bar, this panel and the column that joins them all
 * read as the page. The one filled thing in here is the entry being looked at.
 *
 * It says so in roles of its own — `--sidebar` and the two that go with it — rather than in the
 * page's and the content's. Borrowing them tied this panel to the chrome bar above it, which is
 * drawn on the same page surface and carries the same mark: the active entry could not be given
 * weight without the active tab taking it too.
 */
const PANEL =
  'relative flex shrink-0 flex-col gap-1 overflow-hidden bg-sidebar p-2 text-sidebar-foreground'

/**
 * Every entry is padded so that the middle of its icon lands on the middle of the rail: the
 * sidebar's own padding, plus this one, plus half an icon, is half of `--spacing-sidebar-rail`.
 * That is what makes folding move the panel and not the icons inside it — and it is why the
 * border goes: a ghost button draws a transparent one, and one pixel is one pixel.
 */
const ENTRY = 'w-full shrink-0 justify-start gap-3 border-0 px-4'

/**
 * The command keeps that shape and draws its edge: it is the one thing in the panel you type
 * into rather than go to, and it says so the way every other field does. The border is its
 * own — `border-0` goes, and with it the pixel the note above buys back, which is the price of
 * looking like what it is.
 */
const COMMAND = 'w-full shrink-0 justify-start gap-3 px-4'

/**
 * The one filled surface of the sidebar: the place being looked at, pressed into the panel.
 *
 * Denser than what surrounds it and not lighter. A light theme has nothing above white to lift
 * a selection to, so lifting it there says almost nothing; weight is a difference both themes
 * can carry. Nothing is raised, so nothing casts a shadow.
 */
const MARK = 'absolute inset-0 rounded-md bg-sidebar-accent'

/** What an icon weighs when its entry is not the one being looked at. */
const ICON = 'text-muted-foreground'

/** And when it is: whatever reads on the filled surface. */
const ICON_ACTIVE = 'text-sidebar-accent-foreground'

const GROUP =
  'shrink-0 px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

export interface SidebarProps {
  collapsed: boolean
  /** The width it is open at, in pixels, already inside the bounds. */
  width: number
  /** Whether the separator is under a hand right now. */
  dragging: boolean
  /** Told the width on every frame of the fold, so the chrome bar's left segment follows it. */
  onWidth: (width: number) => void
  sessions: ShellSession[]
  /** Which entry is the one being looked at: a Session, the Journal or the Project settings. */
  /**
   * Which entry the window is on, and null when it is somewhere the list does not hold.
   *
   * The settings of the application are such a place: they are reached from the foot of the
   * panel and not from the list, so while they are open no entry of the list is the one being
   * looked at. Two marks at once is the panel saying the window is in two places.
   */
  activeEntryId: string | null
  onSelectEntry: (id: string) => void
  /**
   * Starts a Session in the Project and opens it.
   *
   * Absent when the window cannot write yet — before there is a Project, and while the engine
   * has not said it can be written to — and the list then offers nothing rather than a control
   * that would refuse.
   */
  onNewSession?: (() => void) | undefined
  /** Renames a Session in place, from its own row in the list. */
  onRenameSession?: ((id: string) => void) | undefined
  /** Takes a Session out of the list and keeps it, from its own row. */
  onArchiveSession?: ((id: string) => void) | undefined
  onOpenCommand: () => void
  /** The keystroke that opens the command, already written for the platform. */
  commandShortcut: string
  onOpenSettings: () => void
  /** Whether the window is on the settings of the application rather than on an entry. */
  settingsActive?: boolean | undefined
}

export function Sidebar({
  collapsed,
  width,
  dragging,
  onWidth,
  sessions,
  activeEntryId,
  onSelectEntry,
  onNewSession,
  onRenameSession,
  onArchiveSession,
  onOpenCommand,
  commandShortcut,
  onOpenSettings,
  settingsActive = false,
}: SidebarProps): ReactNode {
  const transition = useTransition(morph)
  // Scoped to this sidebar: `LayoutGroup` prefixes the `layoutId` of everything under it, and
  // two sidebars on one page — Storybook shows both themes at once — are not one list with two
  // marks handing a single element back and forth between them.
  const group = useId()
  // `useTransition` hands back this very object when the system asks for less movement, and a
  // delay is still a wait: the labels take theirs only when there is a journey to wait for.
  const still = transition === instant
  const labels = collapsed || still ? transition : { ...transition, delay: LABEL_DELAY }
  const target = collapsed ? SIDEBAR_RAIL : width

  return (
    <motion.aside
      aria-label="Sessions and places of the active Project"
      className={PANEL}
      initial={false}
      animate={{ width: target }}
      transition={dragging ? instant : transition}
      onUpdate={(latest) => onWidth(Number.parseFloat(String(latest.width)))}
    >
      <Folding collapsed={collapsed} label="Command">
        {/* A field to the eye and a button to the hand: it opens the palette rather than taking
            a caret, so it stays a button and borrows nothing but the look of an input. What is
            filled in this panel is still the place being looked at — this one is filled because
            a field is, and its edge is what tells the two apart. */}
        <Button
          variant="secondary"
          className={COMMAND}
          aria-label="Command"
          onClick={onOpenCommand}
        >
          <span className={cn('flex shrink-0', ICON)}>
            <IconCommand size="md" />
          </span>
          <Label collapsed={collapsed} transition={labels}>
            Command
          </Label>
          <motion.span
            className="ml-auto"
            initial={false}
            animate={{ opacity: collapsed ? 0 : 1 }}
            transition={labels}
          >
            <Kbd keys={commandShortcut} />
          </motion.span>
        </Button>
      </Folding>

      {/* The group holds the list *and* the foot of the panel: the mark is one element handed
          between them, and a settings left outside the group would be a second mark with an
          identifier of its own — shared, in Storybook, with every other sidebar on the page. */}
      <LayoutGroup id={group}>
        {/* The places scroll and the two ends do not: a window short enough to cut the list off
            used to cut it off for good, with the theme and the settings pushed out of reach. */}
        <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto">
          {/* The Home of the Project is the first place, above what it holds: it is where a
              Session is started from, and the one page the palette is not needed to reach. */}
          <Entry
            id={HOME_ENTRY}
            label="Home"
            icon={<IconHome size="md" />}
            active={activeEntryId === HOME_ENTRY}
            collapsed={collapsed}
            transition={transition}
            labels={labels}
            onSelect={onSelectEntry}
          />
          <Rule />
          <div className="flex items-center gap-1">
            <motion.p
              className={cn(GROUP, 'flex-1')}
              initial={false}
              animate={{ opacity: collapsed ? 0 : 1 }}
              transition={labels}
            >
              Sessions
            </motion.p>
            {/* The `+` is the one control that makes a Session, and it is the same control in the
                same place whatever the list holds: a second way to start, further down, is a
                control the eye has to look for twice. */}
            {onNewSession !== undefined && (
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconPlus size="sm" />}
                aria-label="New Session"
                onClick={onNewSession}
              />
            )}
          </div>
          {/* A Session is the one entry of this list that carries commands of its own, so its
              row is its own component — see `session/session.tsx`. The mark is still the panel's:
              the `LayoutGroup` above prefixes the identifier, and the filled surface is handed
              from a Session to the Journal rather than drawn once per row. */}
          {sessions.map((session) => (
            <SidebarSessionEntry
              key={session.id}
              title={session.title}
              active={session.id === activeEntryId}
              collapsed={collapsed}
              onSelect={() => onSelectEntry(session.id)}
              onRename={
                onRenameSession === undefined ? undefined : () => onRenameSession(session.id)
              }
              onArchive={
                onArchiveSession === undefined ? undefined : () => onArchiveSession(session.id)
              }
            />
          ))}
          {/* No Session yet, said in words — the way to make one is the `+` above, which is where
              it is whether the list holds one Session or none. An empty list that says nothing is
              a list the user believes is still loading. */}
          {sessions.length === 0 && !collapsed && (
            <p className="px-3 py-1 text-xs text-muted-foreground">No Session yet</p>
          )}
          <Rule />
          <motion.p
            className={GROUP}
            initial={false}
            animate={{ opacity: collapsed ? 0 : 1 }}
            transition={labels}
          >
            Project
          </motion.p>
          <Entry
            id={JOURNAL_ENTRY}
            label="Journal"
            icon={<IconTimelineEvent size="md" />}
            active={activeEntryId === JOURNAL_ENTRY}
            collapsed={collapsed}
            transition={transition}
            labels={labels}
            onSelect={onSelectEntry}
          />
          <Entry
            id={PROJECT_SETTINGS_ENTRY}
            label="Project settings"
            icon={<IconSettings size="md" />}
            active={activeEntryId === PROJECT_SETTINGS_ENTRY}
            collapsed={collapsed}
            transition={transition}
            labels={labels}
            onSelect={onSelectEntry}
          />
        </div>

        <Rule />
        <div className="flex shrink-0 flex-col gap-1">
          {/* The theme is not here: it is one of the settings, and the settings are one press
              away. A control offered twice is a control that has to be explained twice. */}
          <Action
            label="Settings"
            icon={<IconSettings size="md" />}
            active={settingsActive}
            collapsed={collapsed}
            transition={transition}
            labels={labels}
            onSelect={onOpenSettings}
          />
        </div>
      </LayoutGroup>
    </motion.aside>
  )
}

/**
 * What tells one block of the panel from the next.
 *
 * The panel is three things in a column — the places, the Sessions it holds, and the places that
 * are not Sessions — and with one gap between every row they read as a single list with words in
 * it: a list of Sessions under a label looked like it was inside whatever came before it. The
 * rule says where a block ends, at every width, folded or open.
 */
function Rule(): ReactNode {
  return (
    <div data-separator="" aria-hidden="true" className="mx-3 border-t border-sidebar-border" />
  )
}

/**
 * A control of the rail wears its name in a tooltip; the same control open already says it.
 *
 * The tooltip is always there and turns itself off when the sidebar is open, rather than being
 * wrapped around the control only when it is folded: a wrapper that comes and goes is a control
 * React unmounts and mounts again, and folding with a sidebar entry focused would drop the
 * keyboard back to the top of the page.
 */
function Folding({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean
  label: string
  children: ReactElement
}): ReactNode {
  return (
    <Tooltip label={label} side="right" disabled={!collapsed}>
      {children}
    </Tooltip>
  )
}

/** The part of an entry that goes away with the width, and comes back after it. */
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

/**
 * One place the sidebar can take you.
 *
 * The mark of the active entry is one element that moves between them, not one per entry that
 * appears: a shared `layoutId` hands it over and motion carries it across, which is a transform
 * and costs nothing.
 */
function Entry({
  id,
  label,
  icon,
  active,
  collapsed,
  transition,
  labels,
  onSelect,
}: {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  collapsed: boolean
  transition: Transition
  labels: Transition
  onSelect: (id: string) => void
}): ReactNode {
  return (
    <Folding collapsed={collapsed} label={label}>
      <Button
        variant="ghost"
        className={ENTRY}
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        onClick={() => onSelect(id)}
      >
        {active && <motion.span layoutId="active-nav" className={MARK} transition={transition} />}
        <span className={cn('relative flex shrink-0', active ? ICON_ACTIVE : ICON)}>{icon}</span>
        <Label collapsed={collapsed} transition={labels}>
          {label}
        </Label>
      </Button>
    </Folding>
  )
}

/** The two at the bottom, which change something rather than take you somewhere. */
function Action({
  label,
  icon,
  active = false,
  collapsed,
  transition,
  labels,
  onSelect,
}: {
  label: string
  icon: ReactNode
  /** Whether the window is on it. The settings are a place like any other, and say so. */
  active?: boolean | undefined
  collapsed: boolean
  transition: Transition
  labels: Transition
  onSelect: () => void
}): ReactNode {
  return (
    <Folding collapsed={collapsed} label={label}>
      <Button
        variant="ghost"
        className={ENTRY}
        aria-label={label}
        aria-current={active ? 'true' : undefined}
        onClick={onSelect}
      >
        {active && <motion.span layoutId="active-nav" className={MARK} transition={transition} />}
        <span className={cn('relative flex shrink-0', active ? ICON_ACTIVE : ICON)}>{icon}</span>
        <Label collapsed={collapsed} transition={labels}>
          {label}
        </Label>
      </Button>
    </Folding>
  )
}
