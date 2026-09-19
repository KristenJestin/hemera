import { Popover as BasePopover } from '@base-ui/react/popover'
import { type ReactElement, type ReactNode, useRef } from 'react'

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
 * The panel hangs off a wrapper around the trigger and not off the trigger itself, exactly as
 * the menu does. A pressed button is a scaled button, its box shrinks and swells with the
 * press, and a panel anchored to that box rides the whole way — which reads as a wave running
 * through the panel while it opens. The wrapper never moves, so neither does the panel.
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
  /**
   * Whether the focus stays where it is when the panel opens.
   *
   * A panel opened by a hand is a place to go, and the focus goes there. A panel opened *by
   * typing* — the composer's mention menu — is a list beside what is being typed, and taking
   * the focus would stop the typing that opened it.
   */
  keepFocus?: boolean | undefined
  /**
   * What the panel is called, for a panel whose title is already drawn inside it.
   *
   * A popup is a dialog to everything that reads the page, and a dialog with no name is one a
   * screen reader announces as nothing at all. A panel that shows its own heading says it here
   * instead of drawing a second one.
   */
  label?: string | undefined
  /**
   * Whether what it hangs off is an anchor rather than something that opens it.
   *
   * Almost always it is a control — a bell, a plus, a clip — and pressing it is what opens the
   * panel. It is not when the panel belongs to a field: the box is what the panel is placed
   * against, what opens it is typing into it, and a text box declared as a button is a box
   * every screen reader announces as one.
   */
  anchorOnly?: boolean | undefined
}

export function Popover({
  trigger,
  children,
  title,
  side = 'bottom',
  align = 'end',
  open,
  onOpenChange,
  keepFocus = false,
  label,
  anchorOnly = false,
}: PopoverProps): ReactNode {
  const anchor = useRef<HTMLSpanElement>(null)
  const container = useOverlayContainer()
  return (
    <BasePopover.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      <span ref={anchor} className="inline-flex">
        {anchorOnly ? trigger : <BasePopover.Trigger render={trigger} />}
      </span>
      <BasePopover.Portal container={container}>
        <BasePopover.Positioner anchor={anchor} side={side} align={align} sideOffset={4}>
          <BasePopover.Popup
            className={POPUP}
            aria-label={title === undefined ? label : undefined}
            initialFocus={keepFocus ? false : undefined}
            finalFocus={keepFocus ? false : undefined}
          >
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
