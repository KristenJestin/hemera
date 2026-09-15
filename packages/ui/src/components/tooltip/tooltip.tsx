import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

import { durations } from '../../motion.ts'
import { useOverlayContainer } from '../../overlay.ts'
import { Kbd } from '../kbd/kbd.tsx'
import { refusedTag } from './focusable.ts'

/**
 * The tooltip, on Base UI (design D2-04).
 *
 * One delay for all of them, declared once by the provider the shell puts at its root: the
 * first tooltip of a row waits, and the ones the pointer walks onto next appear at once. That
 * is the behaviour a rail of icons needs — a sidebar folded to icons is unreadable if every
 * name costs the same wait — and it is the reason the delay is not a prop of each tooltip.
 *
 * It opens in CSS through Base UI's `data-starting-style` rather than through motion: the
 * element enters and leaves with the popup itself, and a spring driven from React would have
 * to be told when the popup is gone. Opacity and scale only, on the theme's curve.
 */
const POPUP =
  'inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-lg outline-none scale-100 popup-motion data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0'

/** How long a pointer rests on a control before its name appears, in the milliseconds Base UI counts in. */
export const TOOLTIP_DELAY = durations.slow * 1000

/** Which side of the control the name appears on. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

export interface TooltipProps {
  /** The name of the control, which is the whole of what a tooltip says. */
  label: string
  /** The keystroke that does the same thing, drawn as keys beside the name. */
  keys?: string | undefined
  /** Which side it opens on; a rail of icons wants them beside it, not over it. */
  side?: TooltipSide | undefined
  /** The control it belongs to: something the keyboard can land on, never a box. */
  children: ReactElement
}

export function Tooltip({ label, keys, side = 'top', children }: TooltipProps): ReactNode {
  const container = useOverlayContainer()
  const refused = refusedTag(children.type)
  if (refused !== null) {
    throw new Error(`a tooltip needs a focusable control, and <${refused}> is not one`)
  }
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner side={side} sideOffset={4}>
          <BaseTooltip.Popup role="tooltip" className={POPUP}>
            {label}
            {keys !== undefined && <Kbd keys={keys} className="ml-1.5" />}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

/**
 * The shared delay, around whatever holds tooltips. The shell renders one at its root; a story
 * that shows a tooltip renders its own, because the delay is the thing being shown.
 */
export function TooltipProvider({ children }: { children: ReactNode }): ReactNode {
  return <BaseTooltip.Provider delay={TOOLTIP_DELAY}>{children}</BaseTooltip.Provider>
}
