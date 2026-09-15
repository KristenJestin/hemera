/**
 * A decision taken over the whole window.
 *
 * The panel is laid over everything, centred, behind a scrim that hides what sits behind and
 * swallows the clicks it receives. It is given to the shell rather than rendered in place:
 * the renderer positions an absolute box against its own parent, so a panel rendered inside
 * the content would only ever cover the content, and would push the rest of it aside.
 *
 * It arrives and it leaves. The renderer paints nothing on removal, so the panel outlives
 * its own closing by the length of its exit — see `usePresence`.
 */

import type { ReactNode } from 'react'
import { motion } from '@gpuix/react'
import type { EventPayload } from '@gpuix/react'

import { transition } from '#lib/motion.ts'
import { usePresence } from '#lib/presence.ts'
import { mergeStyle } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { Box } from '#primitives/box.tsx'
import { Stack } from '#primitives/stack.tsx'
import { Text } from '#primitives/text.tsx'
import { dialog } from '#tokens/components.ts'
import { radius, space } from '#tokens/primitives.ts'
import { useTheme } from '#theme/provider.tsx'
import { Separator } from '#components/separator/separator.tsx'
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
  // Painted while it leaves, so the exit has somewhere to play.
  const presence = usePresence({ open: behaviour.open })
  if (!presence.present) return null
  const leaving = presence.stage === 'leaving'

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
      style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}
      {...(testId === undefined ? {} : { testId: `${testId}-overlay` })}
    >
      {/* The scrim is its own layer so it can fade on its own: an opacity applies to an
          element and everything inside it, and the panel does not rise at the same pace. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={transition('fast', leaving ? 'exit' : 'enter')}
        onClick={behaviour.onScrimPress}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          opacity: 0,
          backgroundColor: theme.colors.scrim,
        }}
        {...(testId === undefined ? {} : { testId: `${testId}-scrim` })}
      />
      <div
        onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          padding: space['2xl'],
          // The centring layer must not take the clicks meant for the scrim behind it.
          pointerEvents: 'none',
        }}
      >
        <motion.div
          initial={{ opacity: 0, top: dialog.entryOffset }}
          // It rises into place and settles; on the way out it drops back and goes, faster
          // than it came, because a decision taken should not be waited on.
          animate={leaving ? { opacity: 0, top: dialog.exitOffset } : { opacity: 1, top: 0 }}
          transition={
            leaving
              ? transition('fast', 'exit')
              : // Behind the scrim by a frame or two: the window dims, then the panel arrives.
                transition('base', 'settle', dialog.entryDelay)
          }
          style={mergeStyle(panel, { pointerEvents: 'auto' }, style)}
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
