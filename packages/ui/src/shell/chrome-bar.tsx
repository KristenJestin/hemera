import { cn } from 'cn'
import { LayoutGroup, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconBell, IconLayoutSidebar, IconPlus, IconSettings } from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'
import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import type { ProjectTone, ShellProject } from './model.ts'

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
 * shell as the sidebar folds, so the left segment and the sidebar are the same width at every
 * frame and the Projects always start at the sidebar's right edge. The left segment carries the
 * name of the application and the button that folds the sidebar — above the sidebar rather than
 * inside it, so it does not move when the panel it commands does.
 *
 * The mark of the active Project is one element that slides between the tabs on `arrival`,
 * which is the movement the prototype earned. It lives inside the scrolling strip with the
 * tabs, never outside it, or it would be left behind by its own tab.
 */
const BAR = 'title-bar chrome-columns items-center border-b border-border bg-background'

const BRAND = 'flex min-w-0 items-center gap-2 overflow-hidden pr-1 pl-3'

const STRIP = 'no-drag-children flex min-w-0 flex-1 items-center gap-1 overflow-x-auto'

const TAB = 'relative shrink-0 gap-1.5'

const MARK = 'absolute inset-0 rounded-md bg-accent'

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
  activeProjectId: string
  onSelectProject: (id: string) => void
  onAddProject: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** The keystroke that folds the sidebar, already written for the platform. */
  collapseShortcut: string
  /** What the bell opens onto; the lot that owns notifications fills it. */
  notifications: ReactNode
  onOpenSettings: () => void
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
  onOpenSettings,
}: ChromeBarProps): ReactNode {
  const transition = useTransition(arrival)
  const fold = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'

  return (
    <header className={BAR}>
      <div className={BRAND}>
        <span className="truncate font-medium">Hemera</span>
        <span className="no-drag-children ml-auto flex">
          <Tooltip label={fold} keys={collapseShortcut} side="bottom">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconLayoutSidebar size="sm" />}
              aria-label={fold}
              aria-expanded={!collapsed}
              onClick={onToggleCollapsed}
            />
          </Tooltip>
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1 pr-2">
        <div className={STRIP}>
          <LayoutGroup id="projects">
            {projects.map((project) => (
              <Button
                key={project.id}
                variant="ghost"
                size="sm"
                className={TAB}
                aria-current={project.id === activeProjectId ? 'page' : undefined}
                onClick={() => onSelectProject(project.id)}
              >
                {project.id === activeProjectId && (
                  <motion.span layoutId="active-project" className={MARK} transition={transition} />
                )}
                <span
                  className={cn('relative size-1.5 shrink-0 rounded-full', TONE[project.tone])}
                />
                <span className="relative">{project.name}</span>
                {project.pending > 0 && (
                  <Badge tone="neutral" className="relative">
                    {project.pending}
                  </Badge>
                )}
              </Button>
            ))}
          </LayoutGroup>
          {/* Whatever the strip is too narrow to show is still one press away: the same list
              lives in the panel the add button opens, which is also where a new one is made. */}
          <Popover
            title="Projects"
            side="bottom"
            align="start"
            trigger={
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconPlus size="sm" />}
                aria-label="Projects and adding one"
              />
            }
          >
            <div className="flex flex-col gap-1">
              {projects.map((project) => (
                <Button
                  key={project.id}
                  variant="ghost"
                  className="justify-start gap-2"
                  onClick={() => onSelectProject(project.id)}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', TONE[project.tone])} />
                  {project.name}
                </Button>
              ))}
              <Button variant="secondary" className="justify-start gap-2" onClick={onAddProject}>
                <IconPlus size="sm" />
                Add a Project
              </Button>
            </div>
          </Popover>
        </div>

        <div className="no-drag-children flex shrink-0 items-center gap-1">
          <Popover
            title="Notifications"
            trigger={
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconBell size="sm" />}
                aria-label="Notifications"
              />
            }
          >
            {notifications}
          </Popover>
          <Tooltip label="Settings" side="bottom">
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconSettings size="sm" />}
              aria-label="Settings"
              onClick={onOpenSettings}
            />
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
