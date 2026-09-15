/**
 * The resizable separator between two panels.
 *
 * What is painted is a one-pixel rule; what is grabbed is six pixels wide. Filling those six
 * pixels with a colour turns the separator into a band, and lighting the whole band on hover
 * reads as a selection rather than as a handle.
 *
 * The pointer is followed by the shell, not here: past the first pixel of a drag the pointer
 * is outside this element, and only an ancestor still sees it move.
 */

import type { EventPayload } from '@gpuix/react'

import { useFocusable, useFocusedElement } from '#lib/interaction.ts'
import { focusRing, mergeStyle, withoutUndefined } from '#lib/style.ts'
import type { Style } from '#lib/style.ts'
import { shell } from '#tokens/components.ts'
import { useTheme } from '#theme/provider.tsx'
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
  /** True while the shell is following the pointer for this gutter. */
  dragging?: boolean
  /** The pointer went down on the handle: the shell takes the drag from here. */
  onDragStart?: () => void
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
  dragging = false,
  onDragStart,
  style,
  testId,
}: GutterProps) {
  const theme = useTheme()
  const behaviour = useGutter({ size, onSizeChange, min, max, defaultSize, orientation })
  const focusable = useFocusable()
  const focusedElement = useFocusedElement()
  const [instance, setInstance] = useState<PublicInstance | null>(null)
  const focused = instance !== null && focusedElement === instance.id
  const vertical = behaviour.orientation === 'vertical'

  const handle: Style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: vertical ? 'col-resize' : 'row-resize',
    ...(vertical
      ? { width: shell.gutter.size, height: '100%' }
      : { height: shell.gutter.size, width: '100%' }),
  }

  const rule: Style = {
    backgroundColor: dragging ? theme.colors.primary : theme.colors.line,
    hover: { backgroundColor: dragging ? theme.colors.primary : theme.colors.line2 },
    ...(vertical
      ? { width: shell.gutter.rule, height: '100%' }
      : { height: shell.gutter.rule, width: '100%' }),
  }

  return (
    <div
      ref={setInstance}
      tabIndex={focusable.tabIndex}
      role="separator"
      aria-label={label}
      onKeyDown={(event: EventPayload) => behaviour.onKeyDown(event)}
      onMouseDown={() => onDragStart?.()}
      onClick={(event: EventPayload) => {
        // A double activation returns the panel to its default size.
        if (event.clickCount === 2) behaviour.reset()
      }}
      {...withoutUndefined({
        testId,
        style: mergeStyle(handle, focused && focusRing(theme), style),
      })}
    >
      <div style={rule} />
    </div>
  )
}
