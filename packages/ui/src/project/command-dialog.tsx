import { type ReactNode, useEffect, useState } from 'react'

import {
  COMMAND_TYPES,
  COMMAND_TYPE_ICONS,
  COMMAND_TYPE_LABELS,
  type CommandScope,
  type CommandType,
} from '../activity/command-type.ts'
import { Button } from '../components/button/button.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { Select } from '../components/select/select.tsx'
import { relativePathSchema } from '../form/schemas.ts'
import type { CommandLine, RepositoryLine } from './model.ts'
import { repositoryNamesOf, slugOf } from './naming.ts'

/**
 * The dialog a command of the catalogue is added or edited in (recette 1 of lot 20, D8-07, as
 * amended by recette 2).
 *
 * The row of a command says its type, its name, its line and the address it is served under;
 * everything else — a line per system, the scope of a server, the folder it runs in, Portless —
 * is written here. The name is what the agent asks for, so it is fixed once the command exists:
 * a new name is a new command.
 *
 * The lines are one or two and never three (recette 2): either the same line runs on every
 * system, or there is a line per system, asked for Windows and for Linux and macOS. There is no
 * third field to ask what a system with none of its own runs: what Linux and macOS run is what
 * every other system runs, and a field saying it a second time would only be the same line
 * written twice.
 *
 * The folder is a base and a path under it. The base is the Workspace root or one of the
 * Project's repositories, named as a reader names them, and it follows the Workspace the run is
 * in: the same command runs in the `api` of `main` and in the `api` worktree of a dedicated one.
 * The folder is typed or picked, and what the picker answers is written relative to the folder
 * the command runs from.
 *
 * Portless is offered on a server alone, and only where it can run (D8-10): not installed, the
 * option is not drawn at all; a line that already calls `portless` runs as it is written, and
 * the option is not drawn either.
 */
const FORM = 'flex flex-col gap-4'

const ROW = 'flex flex-wrap items-start gap-3'

const FIELD = 'min-w-0 flex-1'

const NOTE = 'text-sm text-muted-foreground'

const URL = 'font-mono text-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** The base that is the Workspace root: no repository path starts with a colon. */
const ROOT = ':root'

const TYPE_ITEMS = COMMAND_TYPES.map((one) => {
  const Icon = COMMAND_TYPE_ICONS[one]
  return { value: one, label: COMMAND_TYPE_LABELS[one], icon: <Icon size="sm" /> }
})

const SCOPE_ITEMS: { value: CommandScope; label: string }[] = [
  { value: 'workspace', label: 'One instance per Workspace' },
  { value: 'project', label: 'One instance, run in main' },
]

/** The two ways a command says what it runs, and there is no third (recette 2). */
const LINE_MODE_ITEMS: { value: 'same' | 'system'; label: string }[] = [
  { value: 'same', label: 'Same line on every system' },
  { value: 'system', label: 'A line per system' },
]

/** Whether a line already goes through Portless, in which case it runs as it is written. */
export function callsPortless(line: string): boolean {
  return /(^|[\s/\\])portless(\s|$|\.)/.test(line)
}

/** What a Portless name may be: the first label of an address. */
function portlessNameRefusal(name: string): string | undefined {
  if (name.trim() === '') return 'Name the address it is served under.'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.trim())) {
    return 'Lowercase letters, digits and single dashes only.'
  }
  return undefined
}

/** The fixed icon of a command's type, in the muted colour of a mark (D8-07). */
export function TypeMark({ type }: { type: CommandType }): ReactNode {
  const Icon = COMMAND_TYPE_ICONS[type]
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <Icon size="sm" />
    </span>
  )
}

/**
 * The visible name above a select, set like a field's label. The select is named by its own
 * `aria-label`, so the words are for the eye and hidden from a screen reader, which would hear
 * them twice.
 */
function Labelled({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden="true" className="text-sm font-medium text-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

export interface CommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The command edited, or null when one is added. */
  command: CommandLine | null
  /** The Project's repositories, which are the bases a command's folder may start from. */
  repositories: readonly RepositoryLine[]
  /** Whether `portless` is on this machine; the option is not drawn when it is not (D8-10). */
  portlessInstalled: boolean
  /** The Project's name, whose slug is the name Portless is offered first. */
  projectName: string
  /**
   * Asks for a folder, handed the base the command runs from — null for the Workspace root — and
   * answers what the field holds, relative to that base, or null when the picker was dismissed.
   * No button is drawn without it.
   */
  onBrowse?: ((base: string | null) => Promise<string | null>) | undefined
  /** Writes the command; answers the refusal to show, or null once it is written. */
  onSubmit: (command: CommandLine) => Promise<string | null>
}

export function CommandDialog({
  open,
  onOpenChange,
  command,
  repositories,
  portlessInstalled,
  projectName,
  onBrowse,
  onSubmit,
}: CommandDialogProps): ReactNode {
  const [name, setName] = useState('')
  const [line, setLine] = useState('')
  const [linesPerSystem, setLinesPerSystem] = useState(false)
  const [type, setType] = useState<CommandType>('script')
  const [lineWindows, setLineWindows] = useState('')
  const [lineLinux, setLineLinux] = useState('')
  const [scope, setScope] = useState<CommandScope>('workspace')
  const [base, setBase] = useState(ROOT)
  const [folder, setFolder] = useState('')
  const [portless, setPortless] = useState(false)
  const [portlessName, setPortlessName] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Opened is opened anew, on the command it is handed: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setName(command?.name ?? '')
    // A command that runs a line of its own on a system is a line per system: the two fields,
    // where a command with one line opens on the one field (recette 2).
    setLinesPerSystem(
      command !== null && (command.lineWindows !== null || command.lineLinux !== null),
    )
    setLine(command?.command ?? '')
    setType(command?.type ?? 'script')
    setLineWindows(command?.lineWindows ?? '')
    setLineLinux(command?.lineLinux ?? '')
    setScope(command?.scope ?? 'workspace')
    setBase(command?.folderBase ?? ROOT)
    setFolder(command?.folder ?? '')
    setPortless(command?.portless ?? false)
    setPortlessName(command?.portlessName ?? slugOf(projectName))
    setRefusal(null)
  }, [open])

  const adding = command === null
  const serve = type === 'serve'
  /** Every line this command runs, whichever of its fields holds it (recette 2). */
  const lines = linesPerSystem ? [lineWindows, lineLinux] : [line]
  const offersPortless = serve && portlessInstalled && !lines.some(callsPortless)

  const names = repositoryNamesOf(repositories.map((one) => one.path))
  const baseItems = [
    { value: ROOT, label: 'Workspace root' },
    ...repositories.map((one) => ({ value: one.path, label: names.get(one.path) ?? one.path })),
    // A base the Project no longer declares is still what the command says: it is shown by its
    // path rather than silently moved to the root.
    ...(base === ROOT || names.has(base) ? [] : [{ value: base, label: base }]),
  ]

  const folderRead = relativePathSchema.safeParse(folder)
  const folderError =
    folder.trim() === '' || folderRead.success
      ? undefined
      : (folderRead.error.issues[0]?.message ?? 'That folder cannot be used.')
  const nameError = offersPortless && portless ? portlessNameRefusal(portlessName) : undefined
  const incomplete =
    name.trim() === '' ||
    (linesPerSystem ? lineWindows.trim() === '' || lineLinux.trim() === '' : line.trim() === '')
  const slug = portlessName.trim()

  /**
   * What is written about Portless. Offered, it is what the box says. Not offered because the
   * line calls it itself, it is off. Not offered because this machine has no Portless, it is
   * what the command already said: a machine without the tool does not rewrite the catalogue.
   */
  const portlessOf = (): Pick<CommandLine, 'portless' | 'portlessName'> => {
    if (!serve || lines.some(callsPortless)) return { portless: false, portlessName: null }
    if (offersPortless) {
      return portless
        ? { portless: true, portlessName: slug }
        : { portless: false, portlessName: null }
    }
    return { portless: command?.portless ?? false, portlessName: command?.portlessName ?? null }
  }

  /**
   * The mode changed: one line or two. A field left empty takes the line the other mode was
   * holding, so that switching neither loses what was typed nor opens on an empty field.
   */
  const chooseLines = (perSystem: boolean) => {
    if (perSystem === linesPerSystem) return
    if (perSystem && lineLinux.trim() === '') setLineLinux(line)
    if (!perSystem && line.trim() === '') setLine(lineLinux)
    setLinesPerSystem(perSystem)
  }

  const submit = async () => {
    setSaving(true)
    const typedFolder = folder.trim()
    // One line, it is `line` and no system has one of its own; a line per system, `line` is what
    // Linux and macOS run — and with them every system that has no line of its own (recette 2).
    const written = linesPerSystem ? lineLinux.trim() : line.trim()
    const said = await onSubmit({
      id: command?.id ?? name.trim(),
      name: command?.name ?? name.trim(),
      command: written,
      lineWindows: linesPerSystem ? lineWindows.trim() : null,
      lineLinux: linesPerSystem ? written : null,
      type,
      // Meaningful for a `serve` only (D8-07): anything else is one run per call.
      scope: serve ? scope : 'workspace',
      ...portlessOf(),
      folderBase: base === ROOT ? null : base,
      folder: typedFolder === '.' ? '' : typedFolder,
    })
    setSaving(false)
    setRefusal(said)
    if (said === null) onOpenChange(false)
  }

  return (
    <Dialog
      title={adding ? 'Add command' : 'Edit command'}
      description={
        adding
          ? 'Named once and run by name. A Session may run what the catalogue holds and nothing else.'
          : `What ${command.name} runs, where, and on which system.`
      }
      size="wide"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button
            variant="primary"
            state={saving ? 'loading' : 'idle'}
            disabled={incomplete || folderError !== undefined || nameError !== undefined}
            onClick={() => void submit()}
          >
            {adding ? 'Add command' : 'Save'}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      }
    >
      <div className={FORM}>
        <div className={ROW}>
          <Input
            label="Name"
            className={FIELD}
            placeholder="check"
            description={
              adding ? 'What the agent asks for.' : 'Fixed: a new name is a new command.'
            }
            value={name}
            onValueChange={setName}
            disabled={!adding}
          />
          <Labelled label="Type">
            <Select
              label="Type"
              value={type}
              onValueChange={setType}
              mark={<TypeMark type={type} />}
              items={TYPE_ITEMS}
            />
          </Labelled>
        </div>
        <Labelled label="Lines">
          <Select
            label="Lines"
            value={linesPerSystem ? 'system' : 'same'}
            onValueChange={(mode) => {
              chooseLines(mode === 'system')
            }}
            items={LINE_MODE_ITEMS}
          />
        </Labelled>
        {linesPerSystem ? (
          <div className={ROW}>
            <Input
              label="Windows line"
              className={FIELD}
              placeholder="scripts\check.cmd"
              description="Run on Windows."
              value={lineWindows}
              onValueChange={setLineWindows}
            />
            <Input
              label="Linux and macOS line"
              className={FIELD}
              placeholder="./scripts/check.sh"
              description="Run on Linux and macOS, and on any other system."
              value={lineLinux}
              onValueChange={setLineLinux}
            />
          </div>
        ) : (
          <Input
            label="Line"
            placeholder="pnpm check"
            description="Run on every system."
            value={line}
            onValueChange={setLine}
          />
        )}
        {serve && (
          <Labelled label="Scope">
            <Select label="Scope" value={scope} onValueChange={setScope} items={SCOPE_ITEMS} />
          </Labelled>
        )}
        <div className={ROW}>
          <Labelled label="Runs from">
            <Select label="Runs from" value={base} onValueChange={setBase} items={baseItems} />
          </Labelled>
          <Input
            label="Folder"
            className={FIELD}
            placeholder="."
            description="Relative to where it runs from; leave empty for that folder itself."
            value={folder}
            onValueChange={setFolder}
            error={folderError}
            action={
              onBrowse === undefined ? undefined : (
                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => {
                    void onBrowse(base === ROOT ? null : base).then((chosen) => {
                      if (chosen !== null) setFolder(chosen)
                    })
                  }}
                >
                  {folder === '' ? 'Browse…' : 'Change…'}
                </Button>
              )
            }
          />
        </div>
        {offersPortless && (
          <div className="flex flex-col gap-3">
            <Checkbox
              label="Serve through Portless"
              description="Hemera starts the line through portless, which gives it a stable address."
              checked={portless}
              onCheckedChange={setPortless}
            />
            {portless && (
              <>
                <Input
                  label="Portless name"
                  value={portlessName}
                  onValueChange={setPortlessName}
                  error={nameError}
                />
                {nameError === undefined && (
                  <p className={NOTE}>
                    Served at <span className={URL}>https://{slug}.localhost</span>, and at{' '}
                    <span className={URL}>https://&lt;branch&gt;.{slug}.localhost</span> in a
                    Workspace's worktree.
                  </p>
                )}
              </>
            )}
          </div>
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
