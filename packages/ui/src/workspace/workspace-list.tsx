import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Input } from '../components/field/field.tsx'
import { IconFolder, IconFolderPlus, IconTrash } from '../icons.ts'
import type { WorkspaceRow } from './model.ts'
import { WorkspaceBadges } from './workspace-card.tsx'

/**
 * The Workspaces of a Project, in its settings (D8-02).
 *
 * `main` first, then the ones made for a Spec and the ones made on a folder the user picked:
 * all of them are Workspaces, so all of them are rows of the same list. A new one here is a
 * folder the system's picker answers, named after its last segment unless the user renames it;
 * nothing is created in that folder and nothing is prepared in it.
 *
 * Cleaning up is offered on a dedicated Workspace that is not cleaned up yet, and never on
 * `main` nor on a folder the user picked, which is theirs (D8-14). The list asks for it and the caller confirms it: what is removed is said in the
 * cleanup dialog, not here.
 */
const ROWS = 'flex flex-col gap-2'

const LINE = 'flex min-w-0 flex-1 flex-col gap-0.5'

const HEAD = 'flex min-w-0 flex-wrap items-center gap-2'

const NAME = 'min-w-0 truncate text-sm font-medium'

const PATH = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

const ICON = 'flex shrink-0 text-muted-foreground'

/** Create and Cancel, at the end of the name's line. */
const FORM_ACTIONS = 'flex shrink-0 gap-2'

const CLEANUP = 'shrink-0'

/** The last segment of a folder, which is the name a Workspace on it is proposed (D8-02). */
function lastSegmentOf(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== '') ?? ''
}

export interface WorkspaceListProps {
  /** The Workspaces of the Project, `main` first. */
  workspaces: readonly WorkspaceRow[]
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** Creates a Workspace on the folder picked; answers the refusal to show, or null. */
  onCreate: (path: string, name: string) => Promise<string | null>
  /** Asks to clean one up; the caller confirms it with the cleanup dialog. */
  onCleanup: (id: string) => void
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

export function WorkspaceList({
  workspaces,
  onBrowse,
  onCreate,
  onCleanup,
  className,
}: WorkspaceListProps): ReactNode {
  /** The folder the picker answered, while its name is being settled; null otherwise. */
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const browse = async () => {
    const path = await onBrowse()
    if (path === null) return
    setPicked(path)
    setName(lastSegmentOf(path))
    setRefusal(null)
  }

  const create = async (path: string) => {
    setCreating(true)
    const said = await onCreate(path, name.trim())
    setCreating(false)
    setRefusal(said)
    if (said === null) setPicked(null)
  }

  const unnamed = name.trim() === ''

  return (
    <Card
      title="Workspaces"
      description="Where this Project's Sessions work. main is the Project's own folder."
      className={className}
      actions={
        <Button variant="secondary" size="sm" onClick={() => void browse()}>
          <IconFolderPlus size="sm" aria-hidden="true" />
          New Workspace
        </Button>
      }
    >
      {picked !== null && (
        <Input
          label="Name"
          value={name}
          onValueChange={(next) => {
            setName(next)
            setRefusal(null)
          }}
          description={`On ${picked}, as it is: no worktree is made and no step is run.`}
          error={refusal ?? (unnamed ? 'A Workspace needs a name.' : undefined)}
          action={
            <span className={FORM_ACTIONS}>
              <Button
                variant="primary"
                state={creating ? 'loading' : 'idle'}
                disabled={unnamed}
                onClick={() => void create(picked)}
              >
                Create
              </Button>
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Cancel
              </Button>
            </span>
          }
        />
      )}
      <ul className={ROWS} aria-label="Workspaces">
        {workspaces.map((workspace) => (
          <li key={workspace.id}>
            <CardRow>
              <span className={ICON}>
                <IconFolder size="sm" aria-hidden="true" />
              </span>
              <span className={LINE}>
                <span className={HEAD}>
                  <span className={NAME}>{workspace.name}</span>
                  <WorkspaceBadges state={workspace.state} main={workspace.main} />
                  {workspace.specKey !== undefined && (
                    <Badge tone="neutral">{workspace.specKey}</Badge>
                  )}
                </span>
                <span className={PATH}>{workspace.path}</span>
              </span>
              {workspace.dedicated && workspace.state !== 'cleaned' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={CLEANUP}
                  aria-label={`Clean up ${workspace.name}`}
                  onClick={() => onCleanup(workspace.id)}
                >
                  <IconTrash size="sm" aria-hidden="true" />
                  Clean up
                </Button>
              )}
            </CardRow>
          </li>
        ))}
      </ul>
    </Card>
  )
}
