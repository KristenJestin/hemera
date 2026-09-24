import { type FunctionComponent, type ReactNode, useState } from 'react'

import { COMMAND_TYPE_ICONS, type CommandType } from '../activity/command-type.ts'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { Select } from '../components/select/select.tsx'
import { relativePathSchema } from '../form/schemas.ts'
import {
  IconArrowDown,
  IconArrowUp,
  IconCopy,
  IconLink,
  IconPencil,
  IconPlayerPlay,
  type IconProps,
  IconPlus,
  IconX,
} from '../icons.ts'

/**
 * The preparation of a Project: the ordered recipe every dedicated Workspace replays once its
 * worktrees are made (D8-05).
 *
 * Three kinds of step and nothing else: `copy` a file or a folder of `main` to the same place,
 * `link` it instead, and `run` a command of the catalogue. A step is read as the sentence it is —
 * `copy .env from api`, `link node_modules in web`, `run install` — because the order is the
 * point, and a sentence per line is what makes an order readable. The engine keeps the state of
 * each step per Workspace; this card only says what the recipe is.
 *
 * A copy or a link works from a base — the Workspace root, or one of the Project's repositories,
 * named by the last segment of its path — and a path relative to that base. Two repositories are
 * two steps: a step works in one place. A path that is absolute or climbs out of its base is
 * refused here, before anybody is asked; whether the source exists in `main` is the engine's to
 * check, and its answer is shown in the dialog, which stays open on what was typed.
 *
 * The list is only a list: a step is added and edited in the same dialog, opened empty by
 * **Add step** and filled by a row's pencil.
 */

/** What a step does. */
export type RecipeKind = 'copy' | 'link' | 'run'

/** One step of the recipe, as the card draws it. */
export interface RecipeStepLine {
  id: string
  kind: RecipeKind
  /**
   * Where a `copy` or a `link` works: the path of one of the Project's repositories, or null for
   * the Workspace root. Null for a `run`.
   */
  base: string | null
  /** The file or the folder a `copy` or a `link` takes, relative to its base; null for a `run`. */
  path: string | null
  /** The command of the catalogue a `run` starts; null for a `copy` and a `link`. */
  commandId: string | null
}

/** A step the dialog hands over: the line without its id, which the engine gives. */
export type RecipeStepDraft = Omit<RecipeStepLine, 'id'>

/** A command of the catalogue, as a `run` step offers it. */
export interface RecipeCommand {
  id: string
  name: string
  type: CommandType
}

export interface PreparationEditorProps {
  /** The recipe, in the order it runs. */
  steps: readonly RecipeStepLine[]
  /** The Project's repositories, by their path relative to `main`: the bases a step can take. */
  repositories: readonly string[]
  /** The Project's catalogue, which is what a `run` step may start. */
  commands: readonly RecipeCommand[]
  /**
   * Adds a step at the end; answers the engine's refusal — a source missing in `main` — or null.
   */
  onAdd: (step: RecipeStepDraft) => Promise<string | null>
  /** Rewrites a step where it stands; answers the engine's refusal, or null. */
  onUpdate: (id: string, step: RecipeStepDraft) => Promise<string | null>
  onRemove: (id: string) => void
  /** Moves a step one place up or down the recipe. */
  onMove: (id: string, direction: 'up' | 'down') => void
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const SENTENCE = 'min-w-0 flex-1 truncate text-sm text-foreground'

const MARK = 'flex shrink-0 text-muted-foreground'

const STEPS = 'flex flex-col gap-2'

const FORM = 'flex flex-col gap-4'

/**
 * The base and the path, on one line when it fits: the path takes what the base leaves, and the
 * select sits on the path's line, as a select of a dialog does beside a field.
 */
const WHERE = 'flex flex-wrap items-end gap-3'

const PATH_FIELD = 'min-w-0 flex-1'

const KIND_ICONS: Record<RecipeKind, FunctionComponent<IconProps>> = {
  copy: IconCopy,
  link: IconLink,
  run: IconPlayerPlay,
}

const KIND_ITEMS: { value: RecipeKind; label: string; icon: ReactNode }[] = [
  { value: 'copy', label: 'Copy a file or a folder', icon: <IconCopy size="sm" /> },
  { value: 'link', label: 'Link a file or a folder', icon: <IconLink size="sm" /> },
  { value: 'run', label: 'Run a command', icon: <IconPlayerPlay size="sm" /> },
]

/**
 * The value the base select gives the Workspace root. A select holds strings, and the root is
 * no repository: `/` is what no relative path can be.
 */
const ROOT = '/'

/** The one thing said about a path that is not relative, whatever is wrong with it. */
const NOT_RELATIVE = 'A path is relative to its base.'

/** The last segment of a path, which is the name a repository goes by. */
function lastSegmentOf(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== '' && segment !== '.') ?? path
}

/**
 * The name each repository goes by: the last segment of its path, with the path beside it when
 * two repositories share that segment.
 */
function repositoryNamesOf(repositories: readonly string[]): Map<string, string> {
  const segments = repositories.map(lastSegmentOf)
  return new Map(
    repositories.map((path, index) => {
      const segment = segments[index] ?? path
      const shared = segments.filter((other) => other === segment).length > 1
      return [path, shared ? `${segment} (${path})` : segment]
    }),
  )
}

/** A step read as the sentence it is. */
function sentenceOf(
  step: RecipeStepLine,
  names: ReadonlyMap<string, string>,
  commands: readonly RecipeCommand[],
): string {
  if (step.kind === 'run') {
    const command = commands.find((one) => one.id === step.commandId)
    return `run ${command?.name ?? 'a command no longer in the catalogue'}`
  }
  const path = step.path ?? ''
  if (step.base === null) return `${step.kind} ${path} at the root`
  const where = names.get(step.base) ?? step.base
  return step.kind === 'copy' ? `copy ${path} from ${where}` : `link ${path} in ${where}`
}

/** What the dialog holds while it is open: the step being written, and whose it is. */
interface Editing {
  /** The step being edited, or null for a new one. */
  id: string | null
  kind: RecipeKind
  /** The base as the select holds it: a repository's path, or `ROOT`. */
  base: string
  path: string
  commandId: string | undefined
}

const EMPTY: Editing = { id: null, kind: 'copy', base: ROOT, path: '', commandId: undefined }

function editingOf(step: RecipeStepLine): Editing {
  return {
    id: step.id,
    kind: step.kind,
    base: step.base ?? ROOT,
    path: step.path ?? '',
    commandId: step.commandId ?? undefined,
  }
}

export function PreparationEditor({
  steps,
  repositories,
  commands,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
  className,
}: PreparationEditorProps): ReactNode {
  /** What the dialog holds; kept while it closes, so it does not empty on its way out. */
  const [editing, setEditing] = useState<Editing>(EMPTY)
  const [open, setOpen] = useState(false)
  const [pathError, setPathError] = useState<string | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const names = repositoryNamesOf(repositories)
  const running = editing.kind === 'run'
  const ready = running ? editing.commandId !== undefined : editing.path.trim() !== ''

  const show = (next: Editing) => {
    setEditing(next)
    setPathError(undefined)
    setRefusal(null)
    setOpen(true)
  }

  const change = (next: Partial<Editing>) => {
    setEditing({ ...editing, ...next })
    setPathError(undefined)
    setRefusal(null)
  }

  const save = async () => {
    let step: RecipeStepDraft
    if (running) {
      if (editing.commandId === undefined) return
      step = { kind: 'run', base: null, path: null, commandId: editing.commandId }
    } else {
      // Refused here, before anybody is asked: a path that is absolute or climbs out of its
      // base is not a place a Workspace has (D8-05).
      if (!relativePathSchema.safeParse(editing.path).success) {
        setPathError(NOT_RELATIVE)
        return
      }
      step = {
        kind: editing.kind,
        base: editing.base === ROOT ? null : editing.base,
        path: editing.path.trim(),
        commandId: null,
      }
    }
    setSaving(true)
    const said = editing.id === null ? await onAdd(step) : await onUpdate(editing.id, step)
    setSaving(false)
    setRefusal(said)
    if (said === null) setOpen(false)
  }

  const adding = editing.id === null

  return (
    <Card
      title="Preparation"
      description="What every dedicated Workspace does, in this order, once its worktrees are made."
      className={className}
      actions={
        <Button variant="secondary" size="sm" onClick={() => show(EMPTY)}>
          <IconPlus size="sm" aria-hidden="true" />
          Add step
        </Button>
      }
    >
      {steps.length === 0 ? (
        <p className={NOTE}>No step: a Workspace is ready as soon as its worktrees are.</p>
      ) : (
        <ul className={STEPS} aria-label="Steps">
          {steps.map((step, index) => {
            const Icon = KIND_ICONS[step.kind]
            const sentence = sentenceOf(step, names, commands)
            return (
              <li key={step.id}>
                <CardRow>
                  <span className={MARK}>
                    <Icon size="sm" aria-hidden="true" />
                  </span>
                  <span className={SENTENCE}>{sentence}</span>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconArrowUp size="sm" />}
                    aria-label={`Move up: ${sentence}`}
                    disabled={index === 0}
                    onClick={() => onMove(step.id, 'up')}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconArrowDown size="sm" />}
                    aria-label={`Move down: ${sentence}`}
                    disabled={index === steps.length - 1}
                    onClick={() => onMove(step.id, 'down')}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconPencil size="sm" />}
                    aria-label={`Edit: ${sentence}`}
                    onClick={() => show(editingOf(step))}
                  />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="sm" />}
                    aria-label={`Remove: ${sentence}`}
                    onClick={() => onRemove(step.id)}
                  />
                </CardRow>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        title={adding ? 'Add step' : 'Edit step'}
        description="A copy or a link takes a file or a folder relative to its base, and is checked against main before it is kept."
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <Button
              variant="primary"
              state={saving ? 'loading' : 'idle'}
              disabled={!ready}
              onClick={() => void save()}
            >
              {adding ? 'Add' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        }
      >
        <div className={FORM}>
          <Select
            label="Step kind"
            value={editing.kind}
            onValueChange={(kind) => change({ kind })}
            items={KIND_ITEMS}
          />
          {running ? (
            commands.length === 0 ? (
              <p className={NOTE}>The catalogue holds no command yet.</p>
            ) : (
              <Select
                label="Command"
                placeholder="Choose a command"
                value={editing.commandId}
                onValueChange={(commandId) => change({ commandId })}
                items={commands.map((one) => {
                  const Icon = COMMAND_TYPE_ICONS[one.type]
                  return { value: one.id, label: one.name, icon: <Icon size="sm" /> }
                })}
              />
            )
          ) : (
            <div className={WHERE}>
              <Select
                label="Base"
                value={editing.base}
                onValueChange={(base) => change({ base })}
                items={[
                  { value: ROOT, label: 'Workspace root' },
                  ...repositories.map((path) => ({ value: path, label: names.get(path) ?? path })),
                ]}
              />
              <Input
                label="Path"
                className={PATH_FIELD}
                placeholder=".env"
                value={editing.path}
                error={pathError}
                onValueChange={(path) => change({ path })}
              />
            </div>
          )}
          {refusal !== null && (
            <p role="alert" className={REFUSAL}>
              {refusal}
            </p>
          )}
        </div>
      </Dialog>
    </Card>
  )
}
