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
 * `link` it instead, and `run` a command of the catalogue — or a line the step carries on its own,
 * which belongs to that step and is never added to the catalogue (recette 2). A step is read as
 * the sentence it is — `copy .env from api`, `link node_modules in web`, `run install`,
 * `run bun run lint` — because the order is the point, and a sentence per line is what makes an
 * order readable. The engine keeps the state of each step per Workspace; this card only says what
 * the recipe is.
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
   * Where a `copy` or a `link` works, and where a `run` of a line of its own runs from: the path
   * of one of the Project's repositories, or null for the Workspace root. Null for a `run` of a
   * command, which runs where its own command says.
   */
  base: string | null
  /**
   * The file or the folder a `copy` or a `link` takes, relative to its base; for a `run` of a line
   * of its own, the folder that line runs in, relative to its base, or null for the base itself.
   * Null for a `run` of a command.
   */
  path: string | null
  /**
   * The command of the catalogue a `run` starts; null for a `copy`, a `link` and a line of its own.
   */
  commandId: string | null
  /** The line a `run` carries on its own; null for a `copy`, a `link` and a command. */
  line: string | null
  /** The line Windows runs instead, when the step says a line per system (D8-07); null otherwise. */
  lineWindows: string | null
  /** The line Linux runs instead, `line` being what every other system runs (D8-07). */
  lineLinux: string | null
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
  /**
   * The system's picker, asked for a base and answered with a path relative to it, or null when
   * nothing was picked. A copy's and a link's path is picked among what `main` holds under its
   * base, and a step's own line picks the folder it runs in (recette 2).
   */
  onBrowse?: ((base: string | null) => Promise<string | null>) | undefined
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

/**
 * The value the command select gives a line of the step's own. A select holds strings, and a
 * command's id is a slug of its name: an asterisk is what no name and no id can hold, so no
 * command of a catalogue is ever mistaken for a step's own line.
 */
const OWN = '*own*'

/** What a step's own line is written as, one line or a line per system (D8-07). */
const LINE_MODE_ITEMS: { value: 'same' | 'system'; label: string }[] = [
  { value: 'same', label: 'Same line on every system' },
  { value: 'system', label: 'A line per system' },
]

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
    // A line of its own is what the step says it runs; a command is named, and one that left the
    // catalogue is said to be gone.
    if (step.line !== null) return `run ${step.line}`
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
  /** The path of a copy or a link, or the folder a step's own line runs in. */
  path: string
  /**
   * The command of the catalogue a `run` starts, `OWN` for a line of its own, and undefined for a
   * `copy` and a `link`.
   */
  commandId: string | undefined
  /** The line the step carries on its own, as the one field holds it. */
  line: string
  /** The line Windows runs instead, in the fields of a line per system. */
  lineWindows: string
  /** The line Linux and macOS run instead, which is the line every other system runs too. */
  lineLinux: string
  /** Whether the step says a line per system rather than one line for all of them. */
  linesPerSystem: boolean
}

const EMPTY: Editing = {
  id: null,
  kind: 'copy',
  base: ROOT,
  path: '',
  commandId: undefined,
  line: '',
  lineWindows: '',
  lineLinux: '',
  linesPerSystem: false,
}

/** The step's own line as the engine writes it: one line, or a line per system and no third (D8-07). */
function linesOf(editing: Editing): Pick<RecipeStepDraft, 'line' | 'lineWindows' | 'lineLinux'> {
  const written = editing.linesPerSystem ? editing.lineLinux.trim() : editing.line.trim()
  return {
    line: written,
    lineWindows: editing.linesPerSystem ? editing.lineWindows.trim() : null,
    lineLinux: editing.linesPerSystem ? written : null,
  }
}

function editingOf(step: RecipeStepLine): Editing {
  return {
    id: step.id,
    kind: step.kind,
    base: step.base ?? ROOT,
    path: step.path ?? '',
    commandId: step.kind === 'run' && step.commandId === null ? OWN : (step.commandId ?? undefined),
    line: step.line ?? '',
    lineWindows: step.lineWindows ?? '',
    lineLinux: step.lineLinux ?? '',
    // A step that runs a line of its own on a system is a line per system: the two fields, where a
    // step with one line opens on the one field, as the command dialog does (recette 2).
    linesPerSystem: step.lineWindows !== null || step.lineLinux !== null,
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
  onBrowse,
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
  /** A run of a line of its own, which the Project's catalogue never holds (recette 2). */
  const own = running && editing.commandId === OWN
  const carried = editing.linesPerSystem ? editing.lineLinux : editing.line
  const ready = running
    ? editing.commandId !== undefined && (!own || carried.trim() !== '')
    : editing.path.trim() !== ''

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

  /**
   * The mode changed: one line or a line per system. A field left empty takes the line the other
   * mode was holding, so that switching neither loses what was typed nor opens on an empty field,
   * as the command dialog does (recette 2).
   */
  const chooseLines = (perSystem: boolean) => {
    if (perSystem === editing.linesPerSystem) return
    change({
      linesPerSystem: perSystem,
      lineLinux: perSystem && editing.lineLinux.trim() === '' ? editing.line : editing.lineLinux,
      line: !perSystem && editing.line.trim() === '' ? editing.lineLinux : editing.line,
    })
  }

  /**
   * The system's picker, asked for the base the step works in and answered with a path relative to
   * it. What it answers outside that base climbs out, which is a path no step may take: the field
   * refuses it there and then, in the words of the schema the engine shares (recette 2).
   */
  const browse = (base: string) => {
    if (onBrowse === undefined) return
    void onBrowse(base === ROOT ? null : base).then((chosen) => {
      if (chosen === null) return
      const read = relativePathSchema.safeParse(chosen)
      if (!read.success) {
        setPathError(read.error.issues[0]?.message ?? NOT_RELATIVE)
        return
      }
      change({ path: chosen })
    })
  }

  const browseButton =
    onBrowse === undefined ? undefined : (
      <Button variant="ghost" size="sm" onClick={() => browse(editing.base)}>
        Browse…
      </Button>
    )

  const save = async () => {
    let step: RecipeStepDraft
    if (running) {
      if (editing.commandId === undefined) return
      // A line of its own belongs to the step and to it alone (recette 2): it is never written in
      // the catalogue, which is what keeps every agent from seeing it.
      step = own
        ? {
            kind: 'run',
            base: editing.base === ROOT ? null : editing.base,
            path: editing.path.trim() === '' ? null : editing.path.trim(),
            commandId: null,
            ...linesOf(editing),
          }
        : {
            kind: 'run',
            base: null,
            path: null,
            commandId: editing.commandId ?? null,
            line: null,
            lineWindows: null,
            lineLinux: null,
          }
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
        line: null,
        lineWindows: null,
        lineLinux: null,
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
            <>
              <Select
                label="Command"
                placeholder="Choose a command"
                value={editing.commandId ?? ''}
                onValueChange={(commandId) => change({ commandId })}
                items={[
                  ...commands.map((one) => {
                    const Icon = COMMAND_TYPE_ICONS[one.type]
                    return { value: one.id, label: one.name, icon: <Icon size="sm" /> }
                  }),
                  { value: OWN, label: 'A line of its own' },
                ]}
              />
              {own && (
                <>
                  <p className={NOTE}>
                    A line of its own stays with this step: it is never written in the catalogue,
                    and no agent ever sees it.
                  </p>
                  <Select
                    label="Lines"
                    value={editing.linesPerSystem ? 'system' : 'same'}
                    onValueChange={(mode) => chooseLines(mode === 'system')}
                    items={LINE_MODE_ITEMS}
                  />
                  {editing.linesPerSystem ? (
                    <div className={WHERE}>
                      <Input
                        label="Windows line"
                        className={PATH_FIELD}
                        placeholder="bun run lint:win"
                        value={editing.lineWindows}
                        onValueChange={(lineWindows) => change({ lineWindows })}
                      />
                      <Input
                        label="Linux and macOS line"
                        className={PATH_FIELD}
                        placeholder="bun run lint"
                        value={editing.lineLinux}
                        onValueChange={(lineLinux) => change({ lineLinux })}
                      />
                    </div>
                  ) : (
                    <Input
                      label="Line"
                      placeholder="bun run lint"
                      value={editing.line}
                      onValueChange={(line) => change({ line })}
                    />
                  )}
                  <div className={WHERE}>
                    <Select
                      label="Runs from"
                      value={editing.base}
                      onValueChange={(base) => change({ base })}
                      items={[
                        { value: ROOT, label: 'Workspace root' },
                        ...repositories.map((path) => ({
                          value: path,
                          label: names.get(path) ?? path,
                        })),
                      ]}
                    />
                    <Input
                      label="Folder"
                      className={PATH_FIELD}
                      placeholder="./tools"
                      value={editing.path}
                      error={pathError}
                      onValueChange={(path) => change({ path })}
                      action={browseButton}
                    />
                  </div>
                </>
              )}
            </>
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
                action={browseButton}
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
