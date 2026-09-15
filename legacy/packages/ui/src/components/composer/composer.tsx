/**
 * The message composer: a multiline field, a toolbar and a footer.
 *
 * Sending goes through the field's own submission; the application never intercepts `Enter`.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { PublicInstance } from '@gpuix/react'

import { useFocusedElement } from '#lib/interaction.ts'
import { focusRing, mergeStyle } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { Box } from '#primitives/box.tsx'
import { Stack } from '#primitives/stack.tsx'
import { radius, space } from '#tokens/primitives.ts'
import { useTheme } from '#theme/provider.tsx'
import { Textarea } from '#components/textarea/textarea.tsx'
import { useComposer } from './use-composer.ts'

export interface ComposerProps {
  draft: string
  onDraftChange: (draft: string) => void
  onSend: (draft: string) => void
  placeholder?: string
  disabled?: boolean
  /** Controls sitting above the footer, such as a mission picker. */
  toolbar?: ReactNode
  /** Controls sitting at the bottom right, such as the send button. */
  footer?: ReactNode
  style?: Style
  testId?: string
  'aria-label'?: string
}

export function Composer({
  draft,
  onDraftChange,
  onSend,
  placeholder,
  disabled = false,
  toolbar,
  footer,
  style,
  testId,
  'aria-label': ariaLabel,
}: ComposerProps) {
  const theme = useTheme()
  const behaviour = useComposer({ draft, onDraftChange, onSend, disabled })
  const focusedElement = useFocusedElement()
  const fieldTestId = testId === undefined ? undefined : `${testId}-field`

  // The renderer has no focus-within: the frame follows the element its own field painted.
  const [field, setField] = useState<PublicInstance | null>(null)
  const focusWithin = field !== null && focusedElement === field.id

  const frame: Style = {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line2,
    borderRadius: radius['2xl'],
    padding: space.lg,
  }

  return (
    <Box
      style={mergeStyle(frame, focusWithin && focusRing(theme), style)}
      {...(testId === undefined ? {} : { testId })}
    >
      {toolbar === undefined ? null : (
        <Stack gap="md" align="center">
          {toolbar}
        </Stack>
      )}
      <Textarea
        value={draft}
        onValueChange={behaviour.change}
        onSubmit={behaviour.send}
        onInstance={setField}
        disabled={behaviour.inert}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        {...(fieldTestId === undefined ? {} : { testId: fieldTestId })}
      />
      {footer === undefined ? null : (
        <Stack gap="md" align="center" justify="end">
          {footer}
        </Stack>
      )}
    </Box>
  )
}
