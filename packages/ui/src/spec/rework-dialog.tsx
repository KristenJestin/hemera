import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Dialog, DialogClose } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'

/**
 * What `Rework` asks before it reopens a `ready` Spec (lot 19, brief screen 5; D7-05).
 *
 * One line for the reason, which the Journal keeps with the reopening, and one sentence that
 * says exactly what happens: a complete copy becomes the next revision, and the frozen one stays
 * as it is. Nothing is lost by reworking, and the dialog says so before the press rather than
 * after it.
 */

const SAYS = 'text-sm text-muted-foreground'

export interface ReworkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  specKey: string
  /** The frozen revision, which the copy is made from. */
  revision: number
  /** The rework, with its reason. */
  onRework: (reason: string) => void
}

export function ReworkDialog({
  open,
  onOpenChange,
  specKey,
  revision,
  onRework,
}: ReworkDialogProps): ReactNode {
  const [reason, setReason] = useState('')
  const [asked, setAsked] = useState(false)
  const missing = asked && reason.trim() === ''
  function submit(): void {
    setAsked(true)
    if (reason.trim() === '') return
    onRework(reason.trim())
  }
  return (
    <Dialog
      title={`Rework ${specKey}`}
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="primary" onClick={submit}>
            Rework
          </Button>
        </>
      }
    >
      <Input
        label="Reason"
        value={reason}
        onValueChange={setReason}
        placeholder="What changes, in one line"
        error={missing ? 'Say in one line why it is reworked.' : undefined}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          submit()
        }}
      />
      <p className={SAYS}>
        {`A complete copy becomes revision ${revision + 1}; revision ${revision} stays as it is.`}
      </p>
    </Dialog>
  )
}
