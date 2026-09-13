/** The resizable separator between two panels. */

import type { EventPayload } from '@gpuix/react'

import { useFocusable, useFocusedElement } from '../../lib/interaction.ts'
import { focusRing, mergeStyle, withoutUndefined } from '../../lib/style.ts'
import type { Style } from '../../lib/style.ts'
import { shell } from '../../tokens/components.ts'
import { useTheme } from '../../theme/provider.tsx'
import { useGutter } from './use-gutter.ts'
import { useState } from 'react'
import type { PublicInstance } from '@gpuix/react'

export interface GutterProps {
  size: number
  onSizeChange: (size: number) => void
  min: number
  max: number
  /** Size a double activation returns to. */
  defaultSize: number
  orientation?: 'vertical' | 'horizontal'
  /** Name of what is being resized; painted nowhere, announced everywhere. */
  label: string
  style?: Style
  testId?: string
}

export function Gutter({
  size,
  onSizeChange,
  min,
  max,
  defaultSize,
  orientation = 'vertical',
  label,
  style,
  testId,
}: GutterProps) {
  const theme = useTheme()
  const behaviour = useGutter({ size, onSizeChange, min, max, defaultSize, orientation })
  const focusable = useFocusable()
  const focusedElement = useFocusedElement()
  const [instance, setInstance] = useState<PublicInstance | null>(null)
  const focused = instance !== null && focusedElement === instance.id

  const bar: Style =
    behaviour.orientation === 'vertical'
      ? {
          width: shell.gutter.size,
          height: '100%',
          cursor: 'col-resize',
          backgroundColor: theme.colors.line,
          hover: { backgroundColor: theme.colors.primary },
        }
      : {
          height: shell.gutter.size,
          width: '100%',
          cursor: 'row-resize',
          backgroundColor: theme.colors.line,
          hover: { backgroundColor: theme.colors.primary },
        }

  return (
    <div
      ref={setInstance}
      tabIndex={focusable.tabIndex}
      role="separator"
      aria-label={label}
      onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}
      onClick={(event: EventPayload) => {
        // A double activation returns the panel to its default size.
        if (event.clickCount === 2) behaviour.reset()
      }}
      {...withoutUndefined({
        testId,
        style: mergeStyle(bar, focused && focusRing(theme), style),
      })}
    />
  )
}
