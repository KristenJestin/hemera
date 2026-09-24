import { type ReactNode, useEffect, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { IconFolderOpen } from '../icons.ts'

/**
 * A Workspace on a folder the user already has (D8-02): the second way to add one, beside the
 * dedicated Workspace Hemera assembles.
 *
 * Hemera makes nothing there: no worktree, no preparation. The folder is picked with the system's
 * picker, or typed, and the Workspace takes the folder's last segment as its name until the user
 * writes one. What the engine refuses — a name already taken, a folder that is not there — is
 * shown under the form as it was said, and the form stays as it was typed.
 */
const FORM = 'flex flex-col gap-4'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** The last segment of a folder, which is the name a Workspace on it is proposed (D8-02). */
function lastSegmentOf(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== '') ?? ''
}

export interface MapFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** Maps the folder as a Workspace of that name; answers the refusal to show, or null. */
  onMap: (path: string, name: string) => Promise<string | null>
}

export function MapFolderDialog({
  open,
  onOpenChange,
  onBrowse,
  onMap,
}: MapFolderDialogProps): ReactNode {
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  /** Whether the name was written by hand, after which it stops following the folder. */
  const [written, setWritten] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [mapping, setMapping] = useState(false)

  // Opened is opened anew: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setFolder('')
    setName('')
    setWritten(false)
    setRefusal(null)
  }, [open])

  const choose = (path: string) => {
    setFolder(path)
    if (!written) setName(lastSegmentOf(path))
    setRefusal(null)
  }

  const browse = async () => {
    const path = await onBrowse()
    if (path !== null) choose(path)
  }

  const map = async () => {
    setMapping(true)
    const said = await onMap(folder.trim(), name.trim())
    setMapping(false)
    setRefusal(said)
    if (said === null) onOpenChange(false)
  }

  const ready = folder.trim() !== '' && name.trim() !== ''

  return (
    <Dialog
      title="Map an existing folder"
      description="Hemera uses this folder as it is: no worktree is made and no preparation runs."
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button
            variant="primary"
            state={mapping ? 'loading' : 'idle'}
            disabled={!ready}
            onClick={() => void map()}
          >
            Map
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className={FORM}>
        <Input
          label="Folder"
          placeholder="/home/kris/Projects/spike"
          value={folder}
          onValueChange={choose}
          action={
            <Button variant="secondary" onClick={() => void browse()}>
              <IconFolderOpen size="sm" aria-hidden="true" />
              Browse
            </Button>
          }
        />
        <Input
          label="Name"
          value={name}
          onValueChange={(next) => {
            setName(next)
            setWritten(true)
            setRefusal(null)
          }}
        />
        {refusal !== null && (
          <p role="alert" className={REFUSAL}>
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}
