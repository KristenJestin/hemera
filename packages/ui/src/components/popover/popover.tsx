import { Popover as BasePopover } from '@base-ui/react/popover'
import type { ReactElement, ReactNode } from 'react'

import { useOverlayContainer } from '../../overlay.ts'

/**
 * The popover, on Base UI (design D2-04).
 *
 * What a menu is to a list of commands, a popover is to a panel: it is anchored to what opened
 * it, Escape and a click outside both close it, and the focus goes back to the trigger — a
 * panel that can only be dismissed one way is a trap, and one that drops the focus sends the
 * keyboard back to the top of the page.
 *
 * The trigger is the caller's own control rather than a button this component draws: a bell
 * and a plus are not the same shape, and a popover has no opinion about either. It renders
 * into the shell's overlay root when there is one, so it is drawn over the chrome and in the
 * theme the page is wearing.
 *
 * It comes down from its trigger and folds back up into it, in CSS, like every other popup of
 * the catalogue.
 */
const POPUP =
  'min-w-48 rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-lg outline-none translate-y-0 popup-motion data-starting-style:-translate-y-2 data-starting-style:opacity-0 data-ending-style:-translate-y-2 data-ending-style:opacity-0'

export interface PopoverProps {
  /** What opens it: the caller's own control, whatever shape it has. */
  trigger: ReactElement
  /** What the panel holds. */
  children: ReactNode
  /** A line at the top, which is also what a screen reader announces the panel by. */
  title?: string | undefined
  /** Which side of the trigger it opens on. */
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined
  /** Which end of the trigger it lines up with. */
  align?: 'start' | 'center' | 'end' | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
}

export function Popover({
  trigger,
  children,
  title,
  side = 'bottom',
  align = 'end',
  open,
  onOpenChange,
}: PopoverProps): ReactNode {
  const container = useOverlayContainer()
  return (
    <BasePopover.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner side={side} align={align} sideOffset={4}>
          <BasePopover.Popup className={POPUP}>
            {title !== undefined && (
              <BasePopover.Title className="mb-2 text-sm font-medium">{title}</BasePopover.Title>
            )}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
