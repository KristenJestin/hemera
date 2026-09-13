/**
 * A decision panel.
 *
 * The renderer has no modal and no focus trap: the panel is explicit, carries its own
 * buttons, and hands the focus back to whatever opened it when it closes. Nothing outside is
 * blocked; the panel simply sits above, anchored rather than ordered by plane.
 */

import type { EventPayload } from '@gpuix/react'
import type { ReactNode } from 'react'

import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { content } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import { useTheme } from '../../theme/provider.tsx'
import { Separator } from '../separator/separator.tsx'
import { useDialogPanel } from './use-dialog-panel.ts'

export interface DialogPanelProps {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  /** The buttons the decision is taken with. */
  actions?: ReactNode
  style?: Style
  testId?: string
}

export function DialogPanel({
  open,
  onClose,
  title,
  children,
  actions,
  style,
  testId,
}: DialogPanelProps) {
  const theme = useTheme()
  const behaviour = useDialogPanel({ open, onClose })
  if (!behaviour.open) return null

  const panel: Style = {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: radius['2xl'],
    boxShadow: theme.shadows.lg,
    maxWidth: content.maxWidth,
  }

  return (
    <div onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}>
      <Box style={mergeStyle(panel, style)} {...(testId === undefined ? {} : { testId })}>
        <Box style={{ display: 'flex', padding: space.xl }}>
          <Text color="text" scale="xl" weight="semibold">
            {title}
          </Text>
        </Box>
        <Separator />
        <Box style={{ display: 'flex', flexDirection: 'column', padding: space.xl }}>
          {children}
        </Box>
        {actions === undefined ? null : (
          <>
            <Separator />
            <Stack gap="md" align="center" justify="end" style={{ padding: space.xl }}>
              {actions}
            </Stack>
          </>
        )}
      </Box>
    </div>
  )
}
