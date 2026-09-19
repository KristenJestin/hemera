import { cn } from 'cn'
import { type ReactNode, type RefObject, useRef } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconLayoutSidebar, IconPlus } from '../icons.ts'
import { NotificationBell } from '../notifications/notifications.tsx'
import { HemeraMark } from './mark.tsx'
import type { ProjectTone, ShellProject } from './model.ts'
import { Scrollable } from './scrollable.tsx'
import { TabMark } from './tab-mark.tsx'

/**
 * The one bar of chrome, which is also the title bar (design D2-02).
 *
 * It sits in the strip the platform gives a frameless window and stops where the system draws
 * its own window buttons, because that is what `env(titlebar-area-*)` says and the bar reads it
 * at every render: nothing of ours is ever laid under the close button, whichever side the
 * desktop puts it on. The whole strip moves the window and each control opts back out, so the
 * bar is a title bar everywhere the eye sees nothing to press.
 *
 * Two segments in one grid. The first column is the sidebar's current width, written by the
 * shell as the sidebar folds, and it carries the name of the application and nothing else: the
 * mark stays exactly where it is at either width — dead centre of the rail once folded — and
 * the word beside it leaves with the labels of the sidebar. Everything that is pressed lives in
 * the second segment, the button that folds the sidebar first, then a rule, then the Projects,
 * so that the first column can be as narrow as a rail without dragging a control into it.
 *
 * The mark of the active Project is one element that slides between the tabs on `arrival`,
 * which is the movement the prototype earned. It lives inside the scrolling strip with the
 * tabs, never outside it, or it would be left behind by its own tab.
 */
/**
 * The two segments are as tall as the bar: `items-stretch` and not `items-center`.
 *
 * The active tab is drawn joined to the content below, which it can only reach if the column
 * holding it reaches the bottom of the bar. Centring is done inside each segment instead, by
 * whatever in it is a control rather than a tab.
 */
const BAR = 'title-bar chrome-columns items-stretch bg-surface-page'

/** The first column of the bar sits over the sidebar, and the two are one column. */
const BRAND = 'flex min-w-0 items-center gap-2 overflow-hidden pr-2 pl-6'

/**
 * A tab says what it is by how present it is, not by a second background.
 *
 * A hover that fills the tab looks exactly like the slab that marks the active one, and two
 * things that look the same are one thing the eye cannot read. The inactive tabs are dimmed
 * instead and come up to full on hover; the slab is the only fill in the strip.
 */
const TAB = 'no-drag relative shrink-0 gap-2 bg-transparent hover:bg-transparent'

const TAB_ACTIVE = 'text-foreground'

const TAB_QUIET = 'text-muted-foreground hover:text-foreground'

const RULE = 'mx-1 h-6 shrink-0 self-center border-l border-border'

/** The dot a Project is told apart by: a tone of the theme, and never a colour written here. */
const TONE: Record<ProjectTone, string> = {
  primary: 'bg-primary',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  neutral: 'bg-mission-free',
}

export interface ChromeBarProps {
  projects: ShellProject[]
  /** Null when there is no Project at all, which is what a first launch is. */
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onAddProject: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** The keystroke that folds the sidebar, already written for the platform. */
  collapseShortcut: string
  /** What the bell opens onto; the lot that owns notifications fills it. */
  notifications: ReactNode
  /** Whether anything at all is left to see, which is the whole of what the dot says. */
  unseen: boolean
  /**
   * Where the shell writes the sidebar's current width, sixty times a second.
   *
   * On the bar itself and not on the shell: a custom property written on an ancestor makes the
   * browser recompute the style of everything under it, and everything under the shell is the
   * sidebar, the separator and the whole content area. Written here it reaches the one grid
   * that reads it, and the fold stops dropping frames.
   */
  ref?: RefObject<HTMLElement | null> | undefined
}

export function ChromeBar({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  collapsed,
  onToggleCollapsed,
  collapseShortcut,
  notifications,
  unseen,
  ref,
}: ChromeBarProps): ReactNode {
  const fold = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'

  return (
    <header ref={ref} className={BAR}>
      <div className={BRAND}>
        <HemeraMark />
        {/* Taken out rather than faded: the column is only as wide as the rail once folded, and
            a word left in it at nought opacity is a word still half on screen — text the eye
            cannot read and the accessibility pass is right to refuse. The mark is what stays,
            and it has not moved. */}
        {!collapsed && <span className="truncate font-medium">Hemera</span>}
      </div>

      <div className="flex min-w-0 items-center gap-1 pr-2">
        <span className="no-drag-children flex shrink-0 items-center">
          <Tooltip label={fold} keys={collapseShortcut} side="bottom">
            <IconButton
              variant="ghost"
              icon={<IconLayoutSidebar size="md" />}
              aria-label={fold}
              aria-expanded={!collapsed}
              onClick={onToggleCollapsed}
            />
          </Tooltip>
        </span>

        {/* Before the first Project, the bar is the mark and the fold and nothing else: there
            is no tab to draw, nothing to add a Project beside, and no event to have missed.
            The one action there is belongs to the page underneath (design D4-06). */}
        {activeProjectId === null ? null : (
          <>
            <span aria-hidden="true" className={RULE} />
            <Tabs
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject}
              onAddProject={onAddProject}
            />
            <div className="no-drag-children flex shrink-0 items-center gap-1">
              <NotificationBell unseen={unseen}>{notifications}</NotificationBell>
            </div>
          </>
        )}
      </div>
    </header>
  )
}

/** The Projects of the bar, which only exist once there is one. */
function Tabs({
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
}: {
  projects: ShellProject[]
  activeProjectId: string
  onSelectProject: (id: string) => void
  onAddProject: () => void
}): ReactNode {
  const tabs = useRef<(HTMLElement | null)[]>([])
  const active = projects.findIndex((project) => project.id === activeProjectId)
  return (
    <Scrollable label="Projects" className="tab-bleed flex-1 self-stretch">
      <TabMark tabs={tabs} active={active} count={projects.length} />
      {projects.map((project, rank) => (
        <span
          key={project.id}
          ref={(node) => {
            tabs.current[rank] = node
          }}
          className="relative flex shrink-0 items-center"
        >
          <Button
            variant="ghost"
            className={cn(TAB, project.id === activeProjectId ? TAB_ACTIVE : TAB_QUIET)}
            aria-current={project.id === activeProjectId ? 'page' : undefined}
            onClick={() => onSelectProject(project.id)}
          >
            <span className={cn('size-2 shrink-0 rounded-full', TONE[project.tone])} />
            {project.name}
            {project.pending > 0 && <Badge tone="neutral">{project.pending}</Badge>}
          </Button>
        </span>
      ))}
      {/* One press, one Project. It sits after the last tab, where the next one will be. */}
      <Tooltip label="Add a Project" side="bottom">
        {/* Centred on its own: the strip stretches its children now, and this one is a control
            rather than a tab — it has no sheet under it to reach down to. */}
        <IconButton
          variant="ghost"
          className="no-drag self-center"
          icon={<IconPlus size="md" />}
          aria-label="Add a Project"
          onClick={onAddProject}
        />
      </Tooltip>
    </Scrollable>
  )
}
