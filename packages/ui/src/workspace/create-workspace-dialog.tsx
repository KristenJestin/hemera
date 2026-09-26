import { cn } from 'cn'
import { type ReactNode, useEffect, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Input } from '../components/field/field.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Select, type SelectItem } from '../components/select/select.tsx'
import { IconLoader } from '../icons.ts'
import type { PlanRepositoryLine, PlanRepositoryRead, WorkspaceDraft } from './model.ts'

/**
 * Where a dedicated Workspace is created, from the plan the engine proposed (D8-04).
 *
 * Everything the creation will do is on screen before it is done: the folder it makes, and for
 * each repository whether it gets a worktree, from which base and on which branch. The base is
 * chosen from the branches the repository has here, and the branch is a proposal the user may
 * rewrite; a location of the Project that holds no repository in `main` is shown and cannot be
 * ticked, because it gets no worktree.
 *
 * The dialog checks nothing that needs Git: the engine checks every base, every branch and the
 * folder before it writes anything, and one failed check refuses the whole creation. What it
 * answers is shown under the form as it was said, and the form stays as it was typed. A machine
 * without `git` is said up front, and nothing can be created on it (D8-03).
 *
 * The dialog opens at once: the plan names the folder and every location of the Project before
 * Git has read any of them, and each location is read on its own afterwards, one after the other.
 * A row not read yet says so and reserves the room of the two fields it will have, so the dialog
 * keeps its height while the answers arrive, and Create waits for the last of them — a repository
 * that is slow, refused or gone holds back its own row alone, and never the dialog.
 *
 * Opened from a Spec, the name is the Spec's slug and the branches are the Spec's. Opened from the
 * settings, there is no Spec: the name may start empty, and each branch follows the name as it is
 * typed (`branchOf`) until the user writes that branch by hand.
 */
const FORM = 'flex flex-col gap-4'

const NOTE = 'text-sm text-muted-foreground'

const FOLDER = 'min-w-0 font-mono text-sm break-all text-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const ROWS = 'flex flex-col gap-2'

const ROW = 'flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted px-3 py-2'

/** The box, named by the path it includes, and what is said of a location with no repository. */
const INCLUDE = 'flex min-w-0 flex-1 basis-full items-center gap-2'

const PATH = 'min-w-0 truncate font-mono'

/**
 * The base is a branch of the repository, read as it is; the branch of the Workspace is the
 * longer of the two, and gets the room.
 */
const BASE_FIELD = 'flex min-w-0 flex-1 flex-col gap-1'

const BASE_LABEL = 'text-sm font-medium text-foreground'

/** The commit `main` is on, when it is on no branch: said quietly beside the base it stands for. */
const HINT = 'text-xs text-muted-foreground'

/** A message under a field, at the size of the messages the fields themselves show. */
const FIELD_ERROR = 'text-xs text-destructive-muted-foreground'

const BRANCH_FIELD = 'min-w-0 flex-2'

/** What a row says while Git is reading it (#110), on the line its checkbox stands on. */
const READING = 'flex items-center gap-1 text-xs text-muted-foreground'

/**
 * The box of a control that is not there yet: the height, the corner and the outline of the one
 * that will be, and nothing of what it will say.
 */
const RESERVED_CONTROL = 'h-control-md rounded-md border border-input bg-muted'

/** The commit a repository is on when it is on none of its branches (D8-04). */
interface Commit {
  /** The commit itself: what the base is set to when it is chosen back. */
  readonly commit: string
  /** The hash as Git abbreviates it, which is all the dialog shows of it. */
  readonly short: string
}

/** What the dialog keeps of a row while it is edited: the plan's line, with text to type in. */
interface Row {
  path: string
  /** Whether that location has been read yet: a row not read shows nothing, and is not created. */
  read: boolean
  holdsRepository: boolean
  /** The branches the base may be chosen from: this repository's own, in Git's order. */
  branches: readonly string[]
  base: string
  /** The commit `main` is on when it is on none of its branches, and null when it is on one. */
  detached: Commit | null
  branch: string
  included: boolean
  /** What Git said when it would not read the location, and null when it answered (D8-04). */
  reason: string | null
  /** Whether the user wrote this branch by hand, after which it stops following the name. */
  written: boolean
}

/**
 * What Git answered of a location, as a row takes it (#110): the fields a read fills in, and none
 * of the ones the user edits.
 */
function answered(read: PlanRepositoryRead): Partial<Row> {
  return {
    read: true,
    holdsRepository: read.holdsRepository,
    branches: read.branches,
    base: read.base ?? '',
    // A plan names a commit as the base and says so in the same breath: the two go together, and
    // the commit is kept so that choosing a branch afterwards leaves it something to choose back.
    detached:
      read.detachedCommit !== null && read.base !== null
        ? { commit: read.base, short: read.detachedCommit }
        : null,
    branch: read.branch,
    // A location without a repository cannot be included, whatever the plan says (D8-04).
    included: read.holdsRepository && read.included,
    reason: read.reason,
  }
}

/**
 * The room of the two fields a row will have, drawn while Git is reading it (#110).
 *
 * The dialog opens before Git has read anything and fills in one location at a time, so a row that
 * reserved nothing would make the whole dialog jump at every answer. What is drawn is the shape of
 * the fields themselves — their labels, and a box the height of the control that will be under
 * each, at the width the field has. None of it is read out: it is a box, and the row beside it
 * already says the location is being read.
 */
function ReservedFields(): ReactNode {
  return (
    <>
      <span aria-hidden="true" className={BASE_FIELD}>
        <span className={BASE_LABEL}>Base</span>
        <span className={RESERVED_CONTROL} />
      </span>
      <span aria-hidden="true" className={cn('flex flex-col gap-1', BRANCH_FIELD)}>
        <span className={BASE_LABEL}>Branch</span>
        <span className={RESERVED_CONTROL} />
      </span>
    </>
  )
}

function rowsOf(plan: readonly PlanRepositoryLine[]): Row[] {
  return plan.map((line) => {
    // The plan names its locations before Git has read them, so a row may have no answer yet: it
    // is then shown as one that says nothing, and no field of it is filled in from nothing.
    const row: Row = {
      path: line.path,
      read: false,
      holdsRepository: false,
      branches: [],
      base: '',
      detached: null,
      branch: '',
      included: false,
      reason: null,
      written: false,
    }
    return line.read === null ? row : { ...row, ...answered(line.read) }
  })
}

/**
 * What a base may be chosen from: everything this repository has here, and the commit `main` is on
 * when it is on none of its branches — the one place a hash is read, because there is no branch
 * name to read in its place (D8-04).
 */
function baseItemsOf(row: Row): SelectItem<string>[] {
  const branches = row.branches.map((branch) => ({ value: branch, label: branch }))
  if (row.detached === null) return branches
  return [...branches, { value: row.detached.commit, label: 'The current commit' }]
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
  /** The name proposed: the Spec's slug, or empty when there is no Spec to take one from. */
  defaultName: string
  /** The plan: each repository of the Project, with its base and its branch. */
  repositories: readonly PlanRepositoryLine[]
  /**
   * The branch a name makes, when the branches follow the name as it is typed: a Workspace made
   * from the settings has no Spec to name its branches after. A branch the user wrote by hand
   * stops following it. Left out, the plan's branches stay as they were proposed.
   */
  branchOf?: ((name: string) => string) | undefined
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
  branchOf,
  gitMissing = false,
  onCreate,
}: CreateWorkspaceDialogProps): ReactNode {
  const [name, setName] = useState(defaultName)
  /** Whether the name was typed in: an empty one is only said to be wrong once it was. */
  const [typed, setTyped] = useState(false)
  const [rows, setRows] = useState(() => rowsOf(repositories))
  const [refusal, setRefusal] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Opened is opened anew, on the plan it is handed: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setTyped(false)
    setRows(rowsOf(repositories))
    setRefusal(null)
  }, [open])

  // Each answer fills its own row in as it arrives (#110): the dialog opened on the plan, and
  // every location of it is read on its own, so a row nothing has been read of yet stays as it is
  // and a repository that is slow, refused or gone holds back its own row alone.
  useEffect(() => {
    if (!open) return
    setRows((current) => {
      let filled = false
      const next = current.map((row) => {
        if (row.read) return row
        const line = repositories.find((one) => one.path === row.path)
        if (line === undefined || line.read === null) return row
        filled = true
        return { ...row, ...answered(line.read) }
      })
      return filled ? next : current
    })
  }, [open, repositories])

  // What a form can refuse on its own is refused here, and Create waits until nothing is: the
  // engine is asked only about what only Git and the disk can answer (D8-04).
  const nameRefusal = nameRefusalOf(name)
  // A dialog opened with no name to propose does not open on a mistake: the empty name holds
  // Create back all the same, and is said once the name was typed in.
  const nameShown = typed || name.trim() !== '' ? nameRefusal : undefined
  const included = rows.filter((row) => row.included)
  // A plan with nothing to include is a Project whose Workspace is its folder alone (D8-04):
  // only a plan that offers a repository can be left with none.
  const noneIncluded = included.length === 0 && rows.some((row) => row.holdsRepository)
  const incomplete = included.some((row) => row.base.trim() === '' || row.branch.trim() === '')
  // Every location of the plan is read on its own, and Create waits for the last of them: a
  // repository that is slow, refused or gone holds back its own row alone, and never what the
  // other rows say.
  const reading = rows.some((row) => !row.read)
  const refused = nameRefusal !== undefined || reading || noneIncluded || incomplete

  const change = (path: string, next: Partial<Row>) => {
    setRows(rows.map((row) => (row.path === path ? { ...row, ...next } : row)))
  }

  const rename = (next: string) => {
    setName(next)
    setTyped(true)
    if (branchOf === undefined) return
    const branch = branchOf(next.trim())
    setRows(rows.map((row) => (row.written ? row : { ...row, branch })))
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
      description="Each ticked repository gets a new branch, started from its base, in a folder of its own. Nothing is fetched."
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
        <Input label="Name" value={name} onValueChange={rename} error={nameShown} />
        {/* The folder is the Workspace's own, so it is shown once the name makes one: before
            that the line reads as the Project's folder, which is Hemera's own id for it. */}
        {name.trim() !== '' && (
          <p className={NOTE}>
            Folder <span className={FOLDER}>{folderOf(root, name)}</span>
          </p>
        )}
        <ul className={ROWS} aria-label="Repositories">
          {rows.map((row) => (
            <li key={row.path} className={ROW}>
              <span className={INCLUDE}>
                <Checkbox
                  className="min-w-0"
                  label={<span className={PATH}>{row.path}</span>}
                  checked={row.included}
                  disabled={!row.read || !row.holdsRepository}
                  onCheckedChange={(checked) => change(row.path, { included: checked })}
                />
                {/* A row Git has not answered for yet says so, on the checkbox's own line, and a
                    repository Git would not read says it in Git's own words, where a location
                    that simply holds none is not the user's problem (D8-04). */}
                {!row.read ? (
                  <span className={READING}>
                    <IconLoader size="sm" aria-hidden="true" />
                    being read
                  </span>
                ) : (
                  !row.holdsRepository && (
                    <Badge tone={row.reason === null ? 'neutral' : 'destructive'}>
                      {row.reason ?? 'no repository in main'}
                    </Badge>
                  )
                )}
              </span>
              {/* Nothing has been read of this row yet: the room its fields will take, which is
                  what holds the dialog's height while the answers come in (#110). */}
              {!row.read && <ReservedFields />}
              {row.read && row.holdsRepository && (
                <>
                  <div className={BASE_FIELD}>
                    <span className={BASE_LABEL}>
                      Base
                      {row.detached !== null && <span className={HINT}> {row.detached.short}</span>}
                    </span>
                    <Select
                      label="Base"
                      value={row.base}
                      disabled={!row.included}
                      items={baseItemsOf(row)}
                      onValueChange={(base) => change(row.path, { base })}
                    />
                    {row.included && row.base.trim() === '' && (
                      <p className={FIELD_ERROR}>An included repository needs a base.</p>
                    )}
                  </div>
                  <Input
                    label="Branch"
                    className={BRANCH_FIELD}
                    value={row.branch}
                    disabled={!row.included}
                    error={
                      row.included && row.branch.trim() === ''
                        ? 'An included repository needs a branch.'
                        : undefined
                    }
                    onValueChange={(branch) => change(row.path, { branch, written: true })}
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
