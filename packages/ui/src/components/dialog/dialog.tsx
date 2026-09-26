import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import type { ReactNode } from 'react'

import { IconX } from '../../icons.ts'
import { useOverlayContainer } from '../../overlay.ts'
import { Button, IconButton } from '../button/button.tsx'

/**
 * The dialog, on Base UI (design D1-04).
 *
 * The title and the description are parts rather than props of a box, so the dialog is named
 * and described to a screen reader by the same text the eye reads. Base UI traps the focus
 * while it is open and gives it back to whatever opened it on close; Escape and a click
 * outside both close it, because a dialog that can only be dismissed one way is a trap.
 *
 * It rises into place while the page behind it goes soft, and sinks back the same way. The
 * blur is a filter and the rise is a transform, so the compositor carries both on its own.
 */
const BACKDROP =
  'fixed inset-0 bg-overlay backdrop-blur-xs backdrop-motion data-starting-style:opacity-0 data-starting-style:backdrop-blur-none data-ending-style:opacity-0 data-ending-style:backdrop-blur-none'

const POPUP =
  'fixed inset-0 m-auto flex w-full flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg outline-none translate-y-0 scale-100 popup-motion data-starting-style:translate-y-4 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:translate-y-4 data-ending-style:scale-95 data-ending-style:opacity-0'

/**
 * How wide the dialog is, and how tall it may be. `md` is a question and its answer, `wide` a
 * dialog that holds a page of its own — the details of a Session. Neither is taller than what it
 * holds, and neither is taller than `dialog-wide`: past that only the body scrolls, so the
 * buttons stay under it and a short dialog has no hole above them. What it holds scrolls while
 * the title and the close button stay where they are.
 */
export type DialogSize = 'md' | 'wide'

const SIZE: Record<DialogSize, string> = {
  md: 'h-fit max-h-dialog-wide max-w-md',
  wide: 'h-fit max-h-dialog-wide max-w-3xl',
}

/**
 * The body: the only part that scrolls, and the room a control moves in. It carries a little
 * more than the lift of a control under the hand — one per cent of its width, and this is the
 * widest body a dialog may have — so a hover never widens what holds it. Nothing is ever
 * scrolled sideways either: what a dialog is asked to hold wider than itself is cut, not slid.
 */
const BODY = '-mx-2 -my-1 min-h-0 overflow-x-clip overflow-y-auto px-2 py-1'

/** The footer: the buttons, at the same place in every dialog, under a rule that parts it. */
const FOOTER = 'flex shrink-0 justify-end gap-2 border-t border-border pt-4'

export interface DialogProps {
  title: string
  /** A line under the title saying what the dialog is for. */
  description?: string | undefined
  /** What the dialog holds, between its description and its actions. */
  children?: ReactNode
  /** The buttons at the bottom; the dialog draws the row, the caller decides the buttons. */
  actions?: ReactNode
  /** What opens it, when a button is what opens it: a dialog a keystroke opens has none. */
  trigger?: string | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  /** How wide it is: `md`, unless it holds a page of its own. */
  size?: DialogSize | undefined
  /** Where the trigger sits; never how it looks. */
  className?: string | undefined
}

export function Dialog({
  title,
  description,
  children,
  actions,
  trigger,
  open,
  onOpenChange,
  size = 'md',
  className,
}: DialogProps) {
  const container = useOverlayContainer()
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger !== undefined && (
        <BaseDialog.Trigger render={<Button variant="secondary" className={className} />}>
          {trigger}
        </BaseDialog.Trigger>
      )}
      <BaseDialog.Portal container={container}>
        <BaseDialog.Backdrop className={BACKDROP} />
        <BaseDialog.Popup className={cn(POPUP, SIZE[size])}>
          <div className="flex items-start gap-2">
            <div className="flex flex-col gap-1">
              <BaseDialog.Title className="text-lg font-medium">{title}</BaseDialog.Title>
              {description !== undefined && (
                <BaseDialog.Description className="text-sm text-muted-foreground">
                  {description}
                </BaseDialog.Description>
              )}
            </div>
            <BaseDialog.Close
              render={
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label="Close"
                  className="ml-auto"
                />
              }
            />
          </div>
          {children !== undefined && <div className={BODY}>{children}</div>}
          {actions !== undefined && <div className={FOOTER}>{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export const DialogClose = BaseDialog.Close
