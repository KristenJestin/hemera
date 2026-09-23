import { type ReactNode, useEffect, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Input } from '../components/field/field.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import type { PlanRepositoryLine, WorkspaceDraft } from './model.ts'

/**
 * Where a dedicated Workspace is created, from the plan the engine proposed (D8-04).
 *
 * Everything the creation will do is on screen before it is done: the folder it makes, and for
 * each repository whether it gets a worktree, from which base and on which branch. The base and
 * the branch are proposals the user may rewrite; a location of the Project that holds no
 * repository in `main` is shown and cannot be ticked, because it gets no worktree.
 *
 * The dialog checks nothing that needs Git: the engine checks every base, every branch and the
 * folder before it writes anything, and one failed check refuses the whole creation. What it
 * answers is shown under the form as it was said, and the form stays as it was typed. A machine
 * without `git` is said up front, and nothing can be created on it (D8-03).
 */
const FORM = 'flex flex-col gap-4'

const NOTE = 'text-sm text-muted-foreground'

const FOLDER = 'min-w-0 font-mono text-sm break-all text-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const ROWS = 'flex flex-col gap-2'

const ROW = 'flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted px-3 py-2'

/** The checkbox and the path it names, which is what the box is read as. */
const INCLUDE = 'flex min-w-0 flex-1 basis-full items-center gap-2 text-sm'

const CHECK_RING = 'flex rounded-sm focus-ring'

const CHECK = 'size-icon-sm accent-primary outline-none disabled:opacity-50'

const PATH = 'min-w-0 truncate font-mono'

/** What the dialog keeps of a row while it is edited: the plan's line, with text to type in. */
interface Row {
  path: string
  holdsRepository: boolean
  base: string
  branch: string
  included: boolean
}

function rowsOf(plan: readonly PlanRepositoryLine[]): Row[] {
  return plan.map((line) => ({
    path: line.path,
    holdsRepository: line.holdsRepository,
    base: line.base ?? '',
    branch: line.branch,
    // A location without a repository cannot be included, whatever the plan says (D8-04).
    included: line.holdsRepository && line.included,
  }))
}

/**
 * What is wrong with the name, before anything is asked of the engine: it is one folder under the
 * root (D8-02), so a separator or a climb out of it cannot be one.
 */
function nameRefusalOf(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'A Workspace needs a name.'
  if (/[\\/]/.test(trimmed) || trimmed.includes('..')) return 'A Workspace name is one folder name.'
  return undefined
}

/** The folder the Workspace will be, written with the separator its root is written with. */
function folderOf(root: string, name: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root}${separator}${name.trim()}`
}

export interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where the Project's dedicated Workspaces live (D8-02). */
  root: string
  /** The name proposed: the Spec's slug. */
  defaultName: string
  /** The plan: each repository of the Project, with its base and its branch. */
  repositories: readonly PlanRepositoryLine[]
  /** Whether `git` is missing on this machine, which refuses any creation (D8-03). */
  gitMissing?: boolean | undefined
  /** Creates the Workspace; answers the refusal to show, or null once it is created. */
  onCreate: (draft: WorkspaceDraft) => Promise<string | null>
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  root,
  defaultName,
  repositories,
  gitMissing = false,
  onCreate,
}: CreateWorkspaceDialogProps): ReactNode {
  const [name, setName] = useState(defaultName)
  const [rows, setRows] = useState(() => rowsOf(repositories))
  const [refusal, setRefusal] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Opened is opened anew, on the plan it is handed: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setRows(rowsOf(repositories))
    setRefusal(null)
  }, [open])

  // What a form can refuse on its own is refused here, and Create waits until nothing is: the
  // engine is asked only about what only Git and the disk can answer (D8-04).
  const nameRefusal = nameRefusalOf(name)
  const included = rows.filter((row) => row.included)
  // A plan with nothing to include is a Project whose Workspace is its folder alone (D8-04):
  // only a plan that offers a repository can be left with none.
  const noneIncluded = included.length === 0 && rows.some((row) => row.holdsRepository)
  const incomplete = included.some((row) => row.base.trim() === '' || row.branch.trim() === '')
  const refused = nameRefusal !== undefined || noneIncluded || incomplete

  const change = (path: string, next: Partial<Row>) => {
    setRows(rows.map((row) => (row.path === path ? { ...row, ...next } : row)))
  }

  const create = async () => {
    setCreating(true)
    const said = await onCreate({
      name: name.trim(),
      repositories: included.map((row) => ({
        path: row.path,
        base: row.base.trim(),
        branch: row.branch.trim(),
      })),
    })
    setCreating(false)
    setRefusal(said)
    if (said === null) onOpenChange(false)
  }

  return (
    <Dialog
      title="New Workspace"
      description="Each ticked repository gets a worktree on its branch, from its base. Nothing is fetched."
      size="wide"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        // Create comes before Cancel, in the tab order and on screen: it is what the keyboard
        // walks to once the last branch is filled in.
        <>
          <Button
            variant="primary"
            state={creating ? 'loading' : 'idle'}
            disabled={gitMissing || refused}
            onClick={() => void create()}
          >
            Create
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className={FORM}>
        {gitMissing && (
          <p role="alert" className={REFUSAL}>
            git was not found on this machine. A dedicated Workspace is made of worktrees, and only
            git makes them: install it or put it on the PATH, then open this dialog again.
          </p>
        )}
        <Input label="Name" value={name} onValueChange={setName} error={nameRefusal} />
        <p className={NOTE}>
          Folder <span className={FOLDER}>{folderOf(root, name)}</span>
        </p>
        <ul className={ROWS} aria-label="Repositories">
          {rows.map((row) => (
            <li key={row.path} className={ROW}>
              <label className={INCLUDE}>
                <span className={CHECK_RING}>
                  <input
                    type="checkbox"
                    className={CHECK}
                    checked={row.included}
                    disabled={!row.holdsRepository}
                    onChange={(event) => change(row.path, { included: event.target.checked })}
                  />
                </span>
                <span className={PATH}>{row.path}</span>
                {!row.holdsRepository && <Badge tone="neutral">no repository in main</Badge>}
              </label>
              {row.holdsRepository && (
                <>
                  <Input
                    label="Base"
                    className="min-w-0 flex-1"
                    value={row.base}
                    disabled={!row.included}
                    error={
                      row.included && row.base.trim() === ''
                        ? 'An included repository needs a base.'
                        : undefined
                    }
                    onValueChange={(base) => change(row.path, { base })}
                  />
                  <Input
                    label="Branch"
                    className="min-w-0 flex-2"
                    value={row.branch}
                    disabled={!row.included}
                    error={
                      row.included && row.branch.trim() === ''
                        ? 'An included repository needs a branch.'
                        : undefined
                    }
                    onValueChange={(branch) => change(row.path, { branch })}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
        {noneIncluded && (
          <p role="alert" className={REFUSAL}>
            Include at least one repository.
          </p>
        )}
        {refusal !== null && (
          <p role="alert" className={REFUSAL}>
            {refusal}
          </p>
        )}
      </div>
    </Dialog>
  )
}
