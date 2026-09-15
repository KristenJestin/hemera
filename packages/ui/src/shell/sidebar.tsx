import { LayoutGroup, motion } from 'motion/react'
import type { Transition } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import {
  IconCommand,
  IconMessages,
  IconMoon,
  IconSettings,
  IconSun,
  IconTimelineEvent,
} from '../icons.ts'
import { LABEL_DELAY, LABEL_TRAVEL, instant, morph, useTransition } from '../motion.ts'
import { Button } from '../components/button/button.tsx'
import { Kbd } from '../components/kbd/kbd.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { JOURNAL_ENTRY, PROJECT_SETTINGS_ENTRY, SIDEBAR_RAIL, type ShellSession } from './model.ts'

/**
 * The sidebar, session-first, folding to a rail of icons (design D2-03).
 *
 * What it lists is the navigation of the product and nothing else: the command, the Sessions of
 * the active Project, the Journal, that Project's settings; the theme and the application's
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
const PANEL =
  'relative flex shrink-0 flex-col gap-1 overflow-hidden border-r border-border bg-card p-2'

/**
 * Every entry is padded so that the middle of its icon lands on the middle of the rail: the
 * sidebar's own padding, plus this one, plus half an icon, is half of `--spacing-sidebar-rail`.
 * That is what makes folding move the panel and not the icons inside it — and it is why the
 * border goes: a ghost button draws a transparent one, and one pixel is one pixel.
 */
const ENTRY = 'w-full justify-start gap-3 border-0 px-4'

const MARK = 'absolute inset-0 rounded-md bg-accent'

const GROUP = 'px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

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
  activeEntryId: string
  onSelectEntry: (id: string) => void
  onOpenCommand: () => void
  /** The keystroke that opens the command, already written for the platform. */
  commandShortcut: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenSettings: () => void
}

export function Sidebar({
  collapsed,
  width,
  dragging,
  onWidth,
  sessions,
  activeEntryId,
  onSelectEntry,
  onOpenCommand,
  commandShortcut,
  theme,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps): ReactNode {
  const transition = useTransition(morph)
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
        <Button variant="secondary" className={ENTRY} aria-label="Command" onClick={onOpenCommand}>
          <span className="flex shrink-0">
            <IconCommand size="lg" />
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

      <LayoutGroup id="sidebar">
        <motion.p
          className={GROUP}
          initial={false}
          animate={{ opacity: collapsed ? 0 : 1 }}
          transition={labels}
        >
          Sessions
        </motion.p>
        {sessions.map((session) => (
          <Entry
            key={session.id}
            id={session.id}
            label={session.title}
            icon={<IconMessages size="lg" />}
            active={session.id === activeEntryId}
            collapsed={collapsed}
            transition={transition}
            labels={labels}
            onSelect={onSelectEntry}
          />
        ))}
        <Entry
          id={JOURNAL_ENTRY}
          label="Journal"
          icon={<IconTimelineEvent size="lg" />}
          active={activeEntryId === JOURNAL_ENTRY}
          collapsed={collapsed}
          transition={transition}
          labels={labels}
          onSelect={onSelectEntry}
        />
        <Entry
          id={PROJECT_SETTINGS_ENTRY}
          label="Project settings"
          icon={<IconSettings size="lg" />}
          active={activeEntryId === PROJECT_SETTINGS_ENTRY}
          collapsed={collapsed}
          transition={transition}
          labels={labels}
          onSelect={onSelectEntry}
        />
      </LayoutGroup>

      <div className="mt-auto flex flex-col gap-1">
        <Action
          label={theme === 'dark' ? 'Use the light theme' : 'Use the dark theme'}
          icon={theme === 'dark' ? <IconSun size="lg" /> : <IconMoon size="lg" />}
          collapsed={collapsed}
          labels={labels}
          onSelect={onToggleTheme}
        />
        <Action
          label="Settings"
          icon={<IconSettings size="lg" />}
          collapsed={collapsed}
          labels={labels}
          onSelect={onOpenSettings}
        />
      </div>
    </motion.aside>
  )
}

/** A control of the rail wears its name in a tooltip; the same control open already says it. */
function Folding({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean
  label: string
  children: ReactElement
}): ReactNode {
  return collapsed ? (
    <Tooltip label={label} side="right">
      {children}
    </Tooltip>
  ) : (
    children
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
        <span className="relative flex shrink-0">{icon}</span>
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
  collapsed,
  labels,
  onSelect,
}: {
  label: string
  icon: ReactNode
  collapsed: boolean
  labels: Transition
  onSelect: () => void
}): ReactNode {
  return (
    <Folding collapsed={collapsed} label={label}>
      <Button variant="ghost" className={ENTRY} aria-label={label} onClick={onSelect}>
        <span className="flex shrink-0">{icon}</span>
        <Label collapsed={collapsed} transition={labels}>
          {label}
        </Label>
      </Button>
    </Folding>
  )
}
