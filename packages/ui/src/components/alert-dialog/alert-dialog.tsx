import { type ReactNode, useState } from 'react'

import { Button } from '../button/button.tsx'
import { Dialog } from '../dialog/dialog.tsx'

/**
 * The one way something is confirmed before it happens (design D1-04).
 *
 * A dialog that asks rather than one that holds a form: it says what is about to happen, in
 * what it is about to happen *to*, and offers the two answers. Everything of the application
 * that cannot simply be undone goes through it — archiving a Project is the first, and it is
 * the reason it exists: the button used to do it on the press, with nothing between the hand
 * and a Project leaving the bar.
 *
 * The confirming button carries the tone of what it does. `destructive` is for what takes
 * something away, and it is a tone and never a colour written here.
 *
 * What it asks is a question and the answer is a press, so there is nothing to validate and
 * nothing to hold: it is the trigger, the question, and two buttons.
 */
export interface AlertDialogProps {
  /** The question, as a sentence. */
  title: string
  /** What is about to happen and what it leaves behind, when the title is not enough. */
  description?: string | undefined
  /** The word on the button that goes through with it: `Archive`, `Remove`, `Discard`. */
  confirmLabel: string
  /** The word on the one that does not; `Cancel` unless something else reads better. */
  cancelLabel?: string | undefined
  /** How the confirming button reads: `destructive` for what takes something away. */
  tone?: 'primary' | 'destructive' | undefined
  /** What opens it: the caller's own control, whatever shape it has. */
  trigger: ReactNode
  /** What is done when the answer is yes. */
  onConfirm: () => void
}

export function AlertDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'destructive',
  trigger,
  onConfirm,
}: AlertDialogProps): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span
        className="contents"
        onClickCapture={(event) => {
          // Captured before the control's own handler, so nothing of what it would have done
          // happens until the question has been answered. That is the whole point: a button
          // wrapped in this one asks first, without having to be rewritten to.
          event.preventDefault()
          event.stopPropagation()
          setOpen(true)
        }}
      >
        {trigger}
      </span>
      <Dialog
        title={title}
        description={description}
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={tone === 'destructive' ? 'destructive' : 'primary'}
              onClick={() => {
                setOpen(false)
                onConfirm()
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      />
    </>
  )
}
