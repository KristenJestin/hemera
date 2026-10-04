import { type ReactNode, useId } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { IconFolderOpen, IconGitBranch, IconPlus } from '../../icons.ts'

/**
 * Adding a Project by hand: a folder, the repositories found in it, a name.
 *
 * The folder comes first, typed or chosen with the system's own picker; Hemera looks in it, and
 * what it finds is proposed, each repository ticked — the folder itself when it is one, `.`, and
 * the repositories under it by their paths. A folder that is not a repository and holds none is a
 * Project all the same: the list says none was found, and a repository is added by its path,
 * by hand, from the field under the list. The name is the folder's until the user writes another.
 *
 * While Hemera looks, the list holds the rows' own shape. A folder Hemera cannot use is said
 * under its field, in words; a Project it refuses to create is said above the buttons.
 */
export interface FoundRepository {
  /** Its path in the folder; `.` for the folder itself. */
  path: string
  chosen: boolean
  /** Whether the user added it by hand rather than Hemera finding it. */
  byHand?: boolean | undefined
}

export interface AddProjectProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: string
  onFolder: (folder: string) => void
  onChooseFolder: () => void
  /** Why the folder cannot be used, in words. */
  folderError?: string | undefined
  name: string
  onName: (name: string) => void
  nameError?: string | undefined
  /** What was found in the folder; null before a folder is given. */
  found: readonly FoundRepository[] | null
  /** Whether Hemera is looking in the folder. */
  detecting?: boolean | undefined
  onChoose: (path: string, chosen: boolean) => void
  /** The path being typed in the field that adds a repository by hand. */
  byHand: string
  onByHand: (path: string) => void
  byHandError?: string | undefined
  onAddByHand: () => void
  /** Why the Project was not created, in words. */
  refused?: string | undefined
  creating?: boolean | undefined
  onCreate: () => void
}

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex h-control-lg min-w-0 items-center gap-3 px-4'

const PATH = 'min-w-0 truncate font-mono text-sm'

const QUIET = 'flex h-control-lg items-center px-4 text-sm text-muted-foreground'

const LABEL = 'flex items-center gap-2 text-sm font-medium'

const COUNT = 'text-sm font-normal text-muted-foreground tabular-nums'

const REFUSAL = 'mr-auto self-center text-sm text-destructive-muted-foreground'

/** How a found repository is named: the folder itself is said so. */
function nameOf(path: string): string {
  return path === '.' ? '. (the folder itself)' : path
}

/** A found repository's row while Hemera looks: the box, the path, at their own sizes. */
function FoundSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <span className={ROW}>
        <span className="flex size-icon-md rounded-sm bg-skeleton motion-safe:animate-breathe" />
        <span className={PATH}>
          <Skeleton>packages/ui-kit</Skeleton>
        </span>
      </span>
    </li>
  )
}

export function AddProject({
  open,
  onOpenChange,
  folder,
  onFolder,
  onChooseFolder,
  folderError,
  name,
  onName,
  nameError,
  found,
  detecting = false,
  onChoose,
  byHand,
  onByHand,
  byHandError,
  onAddByHand,
  refused,
  creating = false,
  onCreate,
}: AddProjectProps): ReactNode {
  const chosen = found?.filter((one) => one.chosen).length ?? 0
  const looked = found !== null || detecting
  const listId = useId()
  return (
    <Dialog
      title="Add a Project"
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      actions={
        <>
          {refused !== undefined && (
            <p role="alert" className={REFUSAL}>
              {refused}
            </p>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {looked && (
            <Button
              variant="primary"
              state={creating ? 'loading' : 'idle'}
              disabled={detecting}
              onClick={onCreate}
            >
              Add {name.trim() === '' ? 'the Project' : name}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Input
          label="Folder"
          icon={<IconFolderOpen size="sm" />}
          placeholder="~/work/acme"
          value={folder}
          onValueChange={onFolder}
          error={folderError}
          action={<Button onClick={onChooseFolder}>Choose…</Button>}
        />
        {looked && (
          <>
            <Input label="Name" value={name} onValueChange={onName} error={nameError} />
            <div className="flex flex-col gap-2">
              <span className={LABEL} id={listId}>
                Repositories
                {!detecting && <span className={COUNT}>{chosen}</span>}
              </span>
              <Frame>
                <ul aria-labelledby={listId} aria-busy={detecting} className="flex flex-col">
                  {detecting ? (
                    <>
                      <FoundSkeleton />
                      <FoundSkeleton />
                      <FoundSkeleton />
                    </>
                  ) : found !== null && found.length > 0 ? (
                    found.map((repository) => (
                      <li key={repository.path} className={RULE} data-found={repository.path}>
                        <span className={ROW}>
                          <Checkbox
                            checked={repository.chosen}
                            onCheckedChange={(next) => onChoose(repository.path, next)}
                            label={
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="flex text-muted-foreground" aria-hidden="true">
                                  {repository.byHand === true ? (
                                    <IconPlus size="sm" />
                                  ) : (
                                    <IconGitBranch size="sm" />
                                  )}
                                </span>
                                <span className={PATH}>{nameOf(repository.path)}</span>
                              </span>
                            }
                          />
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className={QUIET}>None in this folder</li>
                  )}
                </ul>
              </Frame>
              {!detecting && (
                <Input
                  label="Add a repository by its path"
                  placeholder="services/billing"
                  value={byHand}
                  onValueChange={onByHand}
                  error={byHandError}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    onAddByHand()
                  }}
                  action={
                    <Button onClick={onAddByHand}>
                      <IconPlus size="sm" />
                      Add
                    </Button>
                  }
                />
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
