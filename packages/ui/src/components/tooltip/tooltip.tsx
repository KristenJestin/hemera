import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cn } from 'cn'
import type { ReactElement, ReactNode } from 'react'

import { useOverlayContainer } from '../../overlay.ts'
import { Kbd } from '../kbd/kbd.tsx'
import { refusedTag } from './focusable.ts'

/**
 * The tooltip, on Base UI (design D2-04).
 *
 * It answers at once. A tooltip in Hemera names a control that is already under the hand —
 * the fold, the bell, an icon in a folded rail — and a name that arrives half a second after
 * the pointer is a name the hand has already given up on and moved past. What a delay buys is
 * quiet on a page dense with things to hover over by accident; the chrome of this window is a
 * handful of deliberate controls, and it does not have that problem to solve.
 *
 * It is still declared once by the provider the shell puts at its root rather than per tooltip:
 * one answer for the whole window is a decision, and a prop would make it a habit.
 *
 * It opens in CSS through Base UI's `data-starting-style` rather than through motion: the
 * element enters and leaves with the popup itself, and a spring driven from React would have
 * to be told when the popup is gone. Opacity and scale only, on the theme's curve.
 */
const POPUP =
  'inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-lg outline-none scale-100 popup-motion data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0'

/**
 * A quote rather than a name: a measure of its own, and two lines at most before an ellipsis. A
 * name is a few words and sits on one line; a quote is somebody's sentence, which is as long as
 * they made it, and a popup as wide as it was would cover the page it quotes.
 */
const QUOTE = 'max-w-xs'

const QUOTED = 'line-clamp-2 break-words'

/** How long a pointer rests on a control before its name appears, in milliseconds. */
export const TOOLTIP_DELAY = 0

/** Which side of the control the name appears on. */
export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

export interface TooltipProps {
  /** The name of the control, which is the whole of what a tooltip says. */
  label: string
  /** The keystroke that does the same thing, drawn as keys beside the name. */
  keys?: string | undefined
  /** Which side it opens on; a rail of icons wants them beside it, not over it. */
  side?: TooltipSide | undefined
  /**
   * Whether the label quotes a text rather than naming the control: a message a mark of the
   * thread stands for. It wraps over two lines at most, in a measure of its own, then truncates.
   */
  quote?: boolean | undefined
  /**
   * Whether the name is offered at all.
   *
   * A control that already wears its label says so here rather than by being rendered without a
   * tooltip around it: a wrapper that comes and goes takes the control with it — React remounts
   * the element underneath — and a button remounted under the hand is a button the keyboard has
   * just lost the focus of.
   */
  disabled?: boolean | undefined
  /** The control it belongs to: something the keyboard can land on, never a box. */
  children: ReactElement
}

export function Tooltip({
  label,
  keys,
  side = 'top',
  quote = false,
  disabled = false,
  children,
}: TooltipProps): ReactNode {
  const container = useOverlayContainer()
  const refused = refusedTag(children.type)
  if (refused !== null) {
    throw new Error(`a tooltip needs a focusable control, and <${refused}> is not one`)
  }
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal container={container}>
        <BaseTooltip.Positioner side={side} sideOffset={4}>
          <BaseTooltip.Popup role="tooltip" className={cn(POPUP, quote && QUOTE)}>
            {quote ? <span className={QUOTED}>{label}</span> : label}
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
