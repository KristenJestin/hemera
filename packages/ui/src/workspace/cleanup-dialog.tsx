import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { IconGitBranch } from '../icons.ts'

/**
 * The confirmation a cleanup goes through, and the refusal it can come back with (D8-14).
 *
 * A cleanup is a human click and never a tool: the dialog says what goes — the worktrees, then
 * the folder — and what stays, which is every branch, named one by one so nobody has to take it
 * on trust. When the engine refuses (a service still running, a `build` Session not archived,
 * Git refusing to remove a worktree with changes in it) the dialog says why, as it was said,
 * and offers nothing but closing: nothing was removed, and there is nothing left to confirm.
 *
 * Drawn on `Dialog` with the answers `AlertDialog` gives, because the caller owns the opening
 * — the list asks, the caller opens — and the refusal replaces the question in the same place.
 */
const BODY = 'flex flex-col gap-2'

const LABEL = 'text-sm font-medium'

const BRANCHES = 'flex flex-col gap-1'

const BRANCH = 'flex items-center gap-2 font-mono text-sm'

const REFUSAL = 'text-sm break-words text-destructive-muted-foreground'

export interface CleanupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The Workspace being cleaned up. */
  name: string
  /** The branches its worktrees are on, all of which are kept. */
  branches: readonly string[]
  /** Why the engine refused, as it said it; the dialog then offers only Close. */
  refusal?: string | null | undefined
  /** The click that cleans it up. */
  onConfirm: () => void
}

export function CleanupDialog({
  open,
  onOpenChange,
  name,
  branches,
  refusal = null,
  onConfirm,
}: CleanupDialogProps): ReactNode {
  const refused = refusal !== null
  return (
    <Dialog
      title={refused ? `${name} was not cleaned up` : `Clean up ${name}?`}
      description={
        refused
          ? 'Nothing was removed.'
          : 'Its worktrees are removed and its folder is deleted. No branch is deleted.'
      }
      open={open}
      onOpenChange={onOpenChange}
      actions={
        refused ? (
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              Clean up
            </Button>
          </>
        )
      }
    >
      {refused ? (
        <p role="alert" className={REFUSAL}>
          {refusal}
        </p>
      ) : (
        <div className={BODY}>
          <p className={LABEL}>Branches kept</p>
          <ul className={BRANCHES} aria-label="Branches kept">
            {branches.map((branch) => (
              <li key={branch} className={BRANCH}>
                <IconGitBranch size="sm" aria-hidden="true" />
                {branch}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  )
}
