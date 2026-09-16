import { Dialog as BaseDialog } from '@base-ui/react/dialog'
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
  'fixed inset-0 m-auto flex h-fit w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-lg outline-none translate-y-0 scale-100 popup-motion data-starting-style:translate-y-4 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:translate-y-4 data-ending-style:scale-95 data-ending-style:opacity-0'

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
        <BaseDialog.Popup className={POPUP}>
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
          {children}
          {actions !== undefined && <div className="flex justify-end gap-2">{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}

export const DialogClose = BaseDialog.Close
