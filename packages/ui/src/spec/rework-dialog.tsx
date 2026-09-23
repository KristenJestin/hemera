import { type ReactNode, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Dialog, DialogClose } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'

/**
 * What `Rework` asks before it reopens a `ready` Spec (lot 19, brief screen 5; D7-05).
 *
 * One line for the reason, which the Journal keeps with the reopening when there is one, and
 * one sentence that says exactly what happens: a complete copy becomes the next revision, and the
 * frozen one stays as it is. The reason is optional (decided on 23 September 2026): the field
 * starts empty and `Rework` is pressable at once, because the reason is a courtesy to whoever
 * reads the Journal later and not a gate in front of the one who wants to change something.
 */

const SAYS = 'text-sm text-muted-foreground'

export interface ReworkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  specKey: string
  /** The frozen revision, which the copy is made from. */
  revision: number
  /** The rework, with its reason; empty when none was given. */
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
  function submit(): void {
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
        description="Optional. Kept in the Journal with the new revision."
        placeholder="What changes, in one line"
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
