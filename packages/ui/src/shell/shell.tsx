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
 * it and says so on every frame; the shell writes it down as `--sidebar-current-width`, and the
 * chrome bar's first column is that variable. Writing a property on an element is not how this
 * repository styles anything — but this is the one value that changes sixty times a second, and
 * a class cannot carry it. One value, one writer, and two columns that cannot come apart.
 */
export interface ShellProps {
  projects: ShellProject[]
  activeProjectId: string
  onSelectProject: (id: string) => void
  onAddProject: () => void
  /** What the bell opens onto; the lot that owns notifications fills it. */
  notifications: ReactNode
  onOpenSettings: () => void

  sessions: ShellSession[]
  activeEntryId: string
  onSelectEntry: (id: string) => void
  onOpenCommand: () => void
  /** The two keystrokes the shell shows, already written for the platform. */
  commandShortcut: string
  collapseShortcut: string

  theme: 'light' | 'dark'
  onToggleTheme: () => void

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
  onOpenSettings,
  sessions,
  activeEntryId,
  onSelectEntry,
  onOpenCommand,
  commandShortcut,
  collapseShortcut,
  theme,
  onToggleTheme,
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  children,
}: ShellProps): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const checked = checkedWidth(width)

  const poseWidth = useCallback((current: number) => {
    root.current?.style.setProperty('--sidebar-current-width', `${current}px`)
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
        <div ref={root} className="shell-root bg-background text-foreground">
          <ChromeBar
            projects={projects}
            activeProjectId={activeProjectId}
            onSelectProject={onSelectProject}
            onAddProject={onAddProject}
            collapsed={collapsed}
            onToggleCollapsed={() => onCollapsedChange(!collapsed)}
            collapseShortcut={collapseShortcut}
            notifications={notifications}
            onOpenSettings={onOpenSettings}
          />
          <div className="shell-body">
            <Sidebar
              collapsed={collapsed}
              width={checked.width}
              dragging={dragging}
              onWidth={poseWidth}
              sessions={sessions}
              activeEntryId={activeEntryId}
              onSelectEntry={onSelectEntry}
              onOpenCommand={onOpenCommand}
              commandShortcut={commandShortcut}
              theme={theme}
              onToggleTheme={onToggleTheme}
              onOpenSettings={onOpenSettings}
            />
            <Gutter
              width={checked.width}
              collapsed={collapsed}
              onWidthChange={onWidthChange}
              onToggleCollapsed={() => onCollapsedChange(!collapsed)}
              onDraggingChange={setDragging}
            />
            <ContentArea>{children}</ContentArea>
          </div>
          <OverlayRoot ref={overlay} />
        </div>
      </OverlayContainerProvider>
    </TooltipProvider>
  )
}

/**
 * The one place of the window that scrolls.
 *
 * Everything else is laid out around it and stays where it is, so a wheel over the content
 * never moves the bar or the sidebar, and a wheel over something scrollable inside the content
 * stops at its own edge rather than carrying on into the page.
 */
export function ContentArea({ children }: { children: ReactNode }): ReactNode {
  return (
    <main tabIndex={0} className="content-area">
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
  return <div ref={ref} />
}
