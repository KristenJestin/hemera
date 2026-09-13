/**
 * The window shell: a projects bar on top, a collapsible sidebar on the left, and the content.
 *
 * Controlled throughout: the caller owns the active project, the sidebar width and whether it
 * is collapsed, and persists them. A width outside its bounds falls back to the default
 * rather than failing the start.
 */

import type { ReactNode } from 'react'

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

export interface WindowShellProps {
  /** Project tabs and the action that adds one. */
  projects: ReactNode
  /** Sessions of the active project, listed in the sidebar. */
  sidebar: ReactNode
  /** The session in view. */
  children: ReactNode

  sidebarWidth: number
  onSidebarWidthChange: (width: number) => void
  sidebarCollapsed: boolean
  onSidebarCollapsedChange: (collapsed: boolean) => void

  /** Name of the collapse action; painted nowhere, announced everywhere. */
  collapseLabel: string
  /** Name of what the gutter resizes; painted nowhere, announced everywhere. */
  resizeLabel: string

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
  sidebarWidth,
  onSidebarWidthChange,
  sidebarCollapsed,
  onSidebarCollapsedChange,
  collapseLabel,
  resizeLabel,
  style,
  testId,
}: WindowShellProps) {
  const theme = useTheme()
  const width = sidebarCollapsed
    ? shell.sidebar.collapsedWidth
    : sizeWithinBounds(sidebarWidth, SIDEBAR_BOUNDS)

  const frame: Style = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.bg,
  }

  return (
    <Box style={mergeStyle(frame, style)} {...(testId === undefined ? {} : { testId })}>
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
          name={sidebarCollapsed ? 'chevron-right' : 'panel-left'}
          label={collapseLabel}
          size="sm"
          onPress={() => onSidebarCollapsedChange(!sidebarCollapsed)}
          {...(testId === undefined ? {} : { testId: `${testId}-collapse` })}
        />
        {projects}
      </Stack>

      <Box style={{ display: 'flex', flexDirection: 'row', flexGrow: 1, minHeight: 0 }}>
        <Box
          style={{ display: 'flex', flexDirection: 'column', width }}
          {...(testId === undefined ? {} : { testId: `${testId}-sidebar` })}
        >
          <Scroll style={{ flexGrow: 1, padding: space.md }}>{sidebar}</Scroll>
        </Box>

        {sidebarCollapsed ? null : (
          <Gutter
            label={resizeLabel}
            size={width}
            onSizeChange={onSidebarWidthChange}
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
    </Box>
  )
}
