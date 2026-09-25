import type { ReactNode } from 'react'

import { AlertDialog } from '../components/alert-dialog/alert-dialog.tsx'
import { Button } from '../components/button/button.tsx'
import { IconPlayerStop } from '../icons.ts'

/**
 * "Stop build", which asks first: a stopped build is over for good (D10-08, D10-11). Nothing is
 * undone — the files stay in the Workspace and the build stays readable — but nothing runs in it
 * any more, and a new build of the same Spec starts from the beginning. The same control in the
 * head of the build view and on a blocker, so the question is the same wherever it is asked.
 */
export function StopBuild({
  specKey,
  onStop,
}: {
  /** The Spec the build is of, which the question names. */
  specKey: string
  onStop: () => void
}): ReactNode {
  return (
    <AlertDialog
      title={`Stop the build of ${specKey}?`}
      description="Nothing is undone: the files stay in the Workspace and the build stays readable. Nothing runs in it any more."
      confirmLabel="Stop build"
      cancelLabel="Keep building"
      onConfirm={onStop}
      trigger={
        <Button variant="secondary" size="sm">
          <IconPlayerStop size="sm" />
          Stop build
        </Button>
      }
    />
  )
}
