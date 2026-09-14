/**
 * A decision taken over the whole window.
 *
 * The panel is laid over everything, centred, behind a scrim that hides what sits behind and
 * swallows the clicks it receives. It is given to the shell rather than rendered in place:
 * the renderer positions an absolute box against its own parent, so a panel rendered inside
 * the content would only ever cover the content, and would push the rest of it aside.
 *
 * The entry is animated; there is no exit animation, because the renderer has none — an
 * element stops painting the frame it is removed.
 */

import type { ReactNode } from 'react'
import { motion } from '@gpuix/react'
import type { EventPayload } from '@gpuix/react'

import { transition } from '../../lib/motion.ts'
import { mergeStyle } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { Box } from '../../primitives/box.tsx'
import { Stack } from '../../primitives/stack.tsx'
import { Text } from '../../primitives/text.tsx'
import { dialog } from '../../tokens/components.ts'
import { radius, space } from '../../tokens/primitives.ts'
import { useTheme } from '../../theme/provider.tsx'
import { Separator } from '../separator/separator.tsx'
import { useModal } from './use-modal.ts'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  /** The buttons the decision is taken with. */
  actions?: ReactNode
  /** Off for a decision that has to be taken rather than dismissed. */
  dismissOnScrim?: boolean
  style?: Style
  testId?: string
}

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  dismissOnScrim,
  style,
  testId,
}: ModalProps) {
  const theme = useTheme()
  const behaviour = useModal({
    open,
    onClose,
    ...(dismissOnScrim === undefined ? {} : { dismissOnScrim }),
  })
  if (!behaviour.open) return null

  const panel: Style = {
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    width: dialog.width,
    maxWidth: dialog.width,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: radius['2xl'],
    boxShadow: theme.shadows.lg,
  }

  return (
    <Box
      {...(testId === undefined ? {} : { testId: `${testId}-scrim` })}
      onClick={behaviour.onScrimPress}
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space['2xl'],
        backgroundColor: theme.colors.scrim,
      }}
    >
      <div onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}>
        <motion.div
          initial={{ opacity: 0, top: dialog.entryOffset }}
          animate={{ opacity: 1, top: 0 }}
          transition={transition('base')}
          style={mergeStyle(panel, style)}
          {...(testId === undefined ? {} : { testId })}
        >
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
        </motion.div>
      </div>
    </Box>
  )
}
