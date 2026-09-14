/**
 * The window shell: a projects bar on top, a collapsible sidebar on the left, and the content.
 *
 * Controlled throughout: the caller owns the active project, the sidebar width and whether it
 * is collapsed, and persists them. A width outside its bounds falls back to the default
 * rather than failing the start.
 *
 * The shell is also where an overlay is laid: the renderer positions an absolute box against
 * its own parent, so a panel rendered inside the content could only ever cover the content.
 */

import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from '@gpuix/react'
import type { EventPayload } from '@gpuix/react'

import { transition } from '../lib/motion.ts'
import { mergeStyle } from '../lib/style.ts'
import type { Style } from '../lib/style.ts'
import { Box } from '../primitives/box.tsx'
import { Scroll } from '../primitives/scroll.tsx'
import { Stack } from '../primitives/stack.tsx'
import { Gutter } from '../components/gutter/gutter.tsx'
import { sizeWithinBounds } from '../components/gutter/use-gutter.ts'
import { IconButton } from '../components/icon-button/icon-button.tsx'
import { shell } from '../tokens/components.ts'
import { space } from '../tokens/primitives.ts'
import { useTheme } from '../theme/provider.tsx'
import { decideTitleBar, decorationsOf } from './title-bar.ts'
import type { WindowCommands } from './title-bar.ts'

export interface WindowShellProps {
  /** Project tabs and the action that adds one. */
  projects: ReactNode
  /** Sessions of the active project, listed in the sidebar. */
  sidebar: ReactNode
  /** The session in view. */
  children: ReactNode
  /** A decision laid over the whole window, above everything else. */
  overlay?: ReactNode

  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  sidebarCollapsed: boolean
  onSidebarCollapsedChange: (collapsed: boolean) => void

  /** Name of the collapse action; painted nowhere, announced everywhere. */
  collapseLabel: string
  /** Name of what the gutter resizes; painted nowhere, announced everywhere. */
  resizeLabel: string

  /**
   * The renderer's window commands, when the application opened a frameless window.
   *
   * Given both, the projects bar becomes the title bar: it carries the region the window is
   * dragged by and the three window buttons. Missing either, the system title bar stays
   * above and nothing here changes — a frameless window whose buttons do nothing is a window
   * the user is locked inside of.
   */
  windowCommands?: WindowCommands
  framelessWindow?: boolean
  /** Names of the window buttons; painted nowhere, announced everywhere. */
  windowLabels?: { minimize: string; maximize: string; close: string }

  style?: Style
  testId?: string
}

/** Bounds the sidebar width is kept within. */
export const SIDEBAR_BOUNDS = {
  min: shell.sidebar.minWidth,
  max: shell.sidebar.maxWidth,
  defaultSize: shell.sidebar.width,
} as const

export function WindowShell({
  projects,
  sidebar,
  children,
  overlay,
  sidebarWidth,
  onSidebarWidthChange,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  collapseLabel,
  resizeLabel,
  windowCommands,
  framelessWindow = false,
  windowLabels,
  style,
  testId,
}: WindowShellProps) {
  const theme = useTheme()
  const titleBar = decideTitleBar(decorationsOf(windowCommands, framelessWindow))
  const ownChrome = titleBar.mode === 'projects-bar' && windowLabels !== undefined
  // A drag reads the pointer in window coordinates, so the width is what the pointer is at,
  // not a delta to accumulate. The shell listens rather than the gutter: once the pointer
  // leaves the six pixels of the gutter, only an ancestor still sees it move.
  const [dragging, setDragging] = useState(false)
  const width = sidebarCollapsed
    ? shell.sidebar.collapsedWidth
    : sizeWithinBounds(sidebarWidth, SIDEBAR_BOUNDS)

  const dragTo = useCallback(
    (event: EventPayload) => {
      if (typeof event.x !== 'number') return
      onSidebarWidthChange(
        Math.min(SIDEBAR_BOUNDS.max, Math.max(SIDEBAR_BOUNDS.min, Math.round(event.x))),
      )
    },
    [onSidebarWidthChange],
  )

  const frame: Style = {
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.bg,
  }

  return (
    <Box
      style={mergeStyle(frame, style)}
      {...(testId === undefined ? {} : { testId })}
      {...(dragging
        ? {
            onMouseMove: (event: EventPayload) => dragTo(event),
            onMouseUp: () => setDragging(false),
          }
        : {})}
    >
      <Stack
        gap="md"
        align="center"
        {...(testId === undefined ? {} : { testId: `${testId}-projects` })}
        style={{
          height: shell.topbar.height,
          paddingLeft: space.lg,
          paddingRight: space.lg,
          borderBottomWidth: 1,
          borderColor: theme.colors.line,
        }}
      >
        <IconButton
          name={sidebarCollapsed ? 'panel-left-open' : 'panel-left'}
          label={collapseLabel}
          size="sm"
          onPress={() => onSidebarCollapsedChange(!sidebarCollapsed)}
          {...(testId === undefined ? {} : { testId: `${testId}-collapse` })}
        />
        {projects}

        {!ownChrome ? null : (
          <>
            {/* The window is dragged by the empty stretch of the bar, never by a control:
                the platform takes the pointer on mouse down, and the mouse up that follows
                belongs to the move rather than to whatever sat under it. */}
            <Box
              style={{ flexGrow: 1, height: '100%' }}
              onMouseDown={() => windowCommands?.startWindowMove?.()}
              onClick={(event: EventPayload) => {
                if (event.clickCount === 2) windowCommands?.zoomWindow?.()
              }}
              {...(testId === undefined ? {} : { testId: `${testId}-drag-region` })}
            />
            <Stack gap="xs" align="center">
              <IconButton
                name="minus"
                label={windowLabels.minimize}
                size="sm"
                onPress={() => windowCommands?.minimizeWindow?.()}
                {...(testId === undefined ? {} : { testId: `${testId}-minimize` })}
              />
              <IconButton
                name="square"
                label={windowLabels.maximize}
                size="sm"
                onPress={() => windowCommands?.zoomWindow?.()}
                {...(testId === undefined ? {} : { testId: `${testId}-maximize` })}
              />
              <IconButton
                name="x"
                label={windowLabels.close}
                size="sm"
                onPress={() => windowCommands?.closeWindow?.()}
                {...(testId === undefined ? {} : { testId: `${testId}-close` })}
              />
            </Stack>
          </>
        )}
      </Stack>

      <Box style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <motion.div
          animate={{ width }}
          // A drag would otherwise chase the pointer one transition behind it.
          transition={dragging ? { duration: 0 } : transition('base')}
          style={{ display: 'flex', flexDirection: 'column', width, overflow: 'hidden' }}
          {...(testId === undefined ? {} : { testId: `${testId}-sidebar` })}
        >
          {/* Collapsed, the sidebar paints nothing: its rows have no icon-only form, and
              squeezed into a rail they read one letter per line. */}
          {sidebarCollapsed ? null : (
            <Scroll style={{ flexGrow: 1, padding: space.md }}>{sidebar}</Scroll>
          )}
        </motion.div>

        {sidebarCollapsed ? null : (
          <Gutter
            label={resizeLabel}
            size={width}
            onSizeChange={onSidebarWidthChange}
            dragging={dragging}
            onDragStart={() => setDragging(true)}
            {...SIDEBAR_BOUNDS}
            {...(testId === undefined ? {} : { testId: `${testId}-gutter` })}
          />
        )}

        <Box
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minWidth: 0,
            backgroundColor: theme.colors.surface2,
          }}
          {...(testId === undefined ? {} : { testId: `${testId}-content` })}
        >
          {children}
        </Box>
      </Box>

      {overlay === undefined ? null : (
        <Box
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            display: 'flex',
          }}
          {...(testId === undefined ? {} : { testId: `${testId}-overlay` })}
        >
          {overlay}
        </Box>
      )}
    </Box>
  )
}
