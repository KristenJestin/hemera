import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { OverlayContainerProvider } from '../overlay.ts'
import { ChromeBar } from './chrome-bar.tsx'
import { Gutter } from './gutter.tsx'
import { SIDEBAR_RAIL, type ShellProject, type ShellSession, checkedWidth } from './model.ts'
import { Sidebar } from './sidebar.tsx'

/**
 * The shell every screen of Hemera is drawn inside (design D2-01).
 *
 * It holds no data. Everything it shows is handed to it as props, which is what lets Storybook
 * render the whole window without Electron and what will let lot 4 put real Projects and
 * Sessions in it without touching a line of this file.
 *
 * Two rows: the chrome bar in the strip the platform reserves for a title bar, and everything
 * else underneath. The body is placed rather than padded, so the only element that can scroll
 * is the content area and nothing above it can ever be pushed out of view.
 *
 * One number crosses the whole layout: how wide the sidebar is right now. The sidebar animates
 * it and says so on every frame; the shell writes it down as `--sidebar-current-width` on the
 * chrome bar, whose first column is that variable. Writing a property on an element is not how
 * this repository styles anything — but this is the one value that changes sixty times a second,
 * and a class cannot carry it. One value, one writer, and two columns that cannot come apart.
 *
 * It is written on the bar and not here, and the difference is measurable: a custom property
 * written on an ancestor makes the browser recompute the style of everything beneath it, and
 * beneath the shell is the entire window. On the bar, the fold stops dropping frames.
 */
export interface ShellProps {
  projects: ShellProject[]
  /**
   * The Project everything else is about, and null when there is none at all.
   *
   * Null is the first launch and the moment the last Project is archived (design D4-06): the
   * bar keeps its mark and its fold, the sidebar is not drawn at all, and the content area is
   * handed the whole width. The keystroke that opens the command belongs to the application,
   * and it goes on working here as it does everywhere else.
   */
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onAddProject: () => void
  /** What the bell opens onto; the lot that owns notifications fills it. */
  notifications: ReactNode
  /** Whether anything at all is left to see, which is the dot on the bell. */
  unseen: boolean
  onOpenSettings: () => void
  /** Whether the window is on the settings of the application. */
  settingsActive?: boolean | undefined

  sessions: ShellSession[]
  /** Which entry the window is on, and null when it is somewhere the list does not hold. */
  activeEntryId: string | null
  onSelectEntry: (id: string) => void
  /** How many Sessions of the active Project are archived (design D4b-06). */
  archivedCount?: number | undefined
  onNewSession: () => void
  onRenameSession: (id: string, title: string) => void
  onArchiveSession: (id: string) => void
  onOpenArchived: () => void
  onOpenCommand: () => void
  /** The two keystrokes the shell shows, already written for the platform. */
  commandShortcut: string
  collapseShortcut: string

  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  /** The width the sidebar opens at. Out of bounds, the shell opens at the default and says so. */
  width: number
  onWidthChange: (width: number) => void

  /** What fills the content area. */
  children: ReactNode
}

export function Shell({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  notifications,
  unseen,
  onOpenSettings,
  settingsActive,
  sessions,
  activeEntryId,
  onSelectEntry,
  archivedCount,
  onNewSession,
  onRenameSession,
  onArchiveSession,
  onOpenArchived,
  onOpenCommand,
  commandShortcut,
  collapseShortcut,
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  children,
}: ShellProps): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const checked = checkedWidth(width)

  const poseWidth = useCallback((current: number) => {
    bar.current?.style.setProperty('--sidebar-current-width', `${current}px`)
  }, [])

  // The first frame has no animation to report a width, so the shell writes the resting one —
  // and only that one. Writing it again on every change would put the column at its target
  // while the sidebar is still on its way there, which is one frame of the two coming apart.
  useLayoutEffect(() => {
    poseWidth(collapsed ? SIDEBAR_RAIL : checked.width)
  }, [])

  // A width nobody could have asked for is a mistake in whatever produced it, and a shell that
  // silently opened at something else would be hiding it.
  useEffect(() => {
    if (checked.correction !== null) console.warn(checked.correction)
  }, [checked.correction])

  return (
    <TooltipProvider>
      <OverlayContainerProvider value={overlay}>
        <div ref={root} className="shell-root bg-surface-page text-foreground">
          <ChromeBar
            ref={bar}
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onAddProject={onAddProject}
            collapsed={collapsed}
            onToggleCollapsed={() => onCollapsedChange(!collapsed)}
            collapseShortcut={collapseShortcut}
            notifications={notifications}
            unseen={unseen}
          />
          <div className="shell-body">
            {/* With no Project there is nothing for the sidebar to list and nothing for the
                separator to move: both are left out rather than drawn empty, and the content
                area takes the width they would have had. */}
            {activeProjectId !== null && (
              <>
                <Sidebar
                  collapsed={collapsed}
                  width={checked.width}
                  dragging={dragging}
                  onWidth={poseWidth}
                  sessions={sessions}
                  activeEntryId={activeEntryId}
                  onSelectEntry={onSelectEntry}
                  archivedCount={archivedCount}
                  onNewSession={onNewSession}
                  onRenameSession={onRenameSession}
                  onArchiveSession={onArchiveSession}
                  onOpenArchived={onOpenArchived}
                  onOpenCommand={onOpenCommand}
                  commandShortcut={commandShortcut}
                  onOpenSettings={onOpenSettings}
                  settingsActive={settingsActive}
                />
                <Gutter
                  width={checked.width}
                  collapsed={collapsed}
                  onWidthChange={onWidthChange}
                  onToggleCollapsed={() => onCollapsedChange(!collapsed)}
                  onDraggingChange={setDragging}
                />
              </>
            )}
            <ContentArea>{children}</ContentArea>
          </div>
          <OverlayRoot ref={overlay} />
        </div>
      </OverlayContainerProvider>
    </TooltipProvider>
  )
}

/**
 * The one place of the window that scrolls, and the one surface it is read on.
 *
 * The content carries the strongest colour of the theme and the chrome around it stands back:
 * what is looked at all day is what is in here, not the bar and not the navigation.
 *
 *
 * Everything else is laid out around it and stays where it is, so a wheel over the content
 * never moves the bar or the sidebar, and a wheel over something scrollable inside the content
 * stops at its own edge rather than carrying on into the page.
 */
export function ContentArea({ children }: { children: ReactNode }): ReactNode {
  // A tab stop, because a region that scrolls and cannot be reached by the keyboard is a region
  // whose content some readers cannot get to at all — which is what axe says about it and what
  // the suite refuses. What it wears when it is reached is the ring of the theme rather than
  // the browser's own white line: an outline and not the design system's `focus-ring`, whose
  // pseudo-element would be laid against the scrolled content and travel with it.
  return (
    <main
      tabIndex={0}
      className="content-area bg-surface-content outline-none focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </main>
  )
}

/**
 * Where every popup of the window is drawn (design D2-05).
 *
 * It is the last thing in the shell and it is inside it, which is the whole of what it does:
 * last means a menu paints over the bar without anyone writing a stacking order, and inside
 * means it is under the element the theme class sits on, so a popup is never the one thing on
 * screen still wearing the other theme.
 */
export function OverlayRoot({ ref }: { ref: RefObject<HTMLDivElement | null> }): ReactNode {
  return <div ref={ref} className="overlay-root" />
}
