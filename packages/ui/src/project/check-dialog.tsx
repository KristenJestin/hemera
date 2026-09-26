import { type ReactNode, useEffect, useState } from 'react'

import { COMMAND_TYPE_ICONS } from '../activity/command-type.ts'
import { Button } from '../components/button/button.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Dialog } from '../components/dialog/dialog.tsx'
import { Input } from '../components/field/field.tsx'
import { Select } from '../components/select/select.tsx'
import type { CheckLine, CheckWhen, CommandLine, RepositoryLine } from './model.ts'
import { repositoryNamesOf } from './naming.ts'

/**
 * The dialog a check of the build is added or edited in (D10-06).
 *
 * What it runs: a command of the catalogue, picked from the list — its line, its folder and its
 * systems are the catalogue's — or a line of the user's. Where: "Where the command runs" for a
 * command, which is the catalogue's own folder, or "Workspace root" for a line (D10-06); one of the
 * Project's repositories; or each repository the task changed. When: after each task, after each
 * story once its tasks are done, or once at the end.
 *
 * Two things are optional and each says how it is read. An expected result is a pattern and a
 * minimum: the first number the pattern captures is compared, and the check is green only when it
 * exited 0 and the number is at least the minimum (D10-06). A files filter makes the line's
 * `{files}` the files the task changed that match it, so only the tests the agent wrote run; when
 * none match, the check is skipped. Every refusal is said under the field it is about, and nothing
 * is written until Save.
 */

const FORM = 'flex flex-col gap-4'

const ROW = 'flex flex-wrap items-start gap-3'

const FIELD = 'min-w-0 flex-1'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

/** What a check runs: a command of the catalogue, or a line of the user's. */
type Source = 'command' | 'line'

const SOURCE_ITEMS: { value: Source; label: string }[] = [
  { value: 'command', label: 'A command of the catalogue' },
  { value: 'line', label: 'A line of yours' },
]

/** When a check runs, in the words the dialog and the list say it in. */
export const WHEN_LABELS: Record<CheckWhen, string> = {
  task: 'After each task',
  story: 'After each story',
  end: 'At the end',
}

const WHEN_ITEMS = (['task', 'story', 'end'] as const).map((value) => ({
  value,
  label: WHEN_LABELS[value],
}))

/** A repository base is its path; these two cannot be one, since no path starts with a colon. */
const ROOT = ':root'
const CHANGED = ':changed'

/** The value of the Where select a check stands on. */
function baseOf(check: CheckLine | null): string {
  if (check === null || check.where === 'root') return ROOT
  if (check.where === 'changed') return CHANGED
  return check.repository ?? ROOT
}

/** Where a check runs, in words (D10-06): the root is the command's own place for a command. */
export function whereLabel(
  check: Pick<CheckLine, 'where' | 'repository' | 'commandId'>,
  repositories: readonly RepositoryLine[],
): string {
  if (check.where === 'changed') return 'Each repository the task changed'
  if (check.where === 'root') {
    return check.commandId === null ? 'Workspace root' : 'Where the command runs'
  }
  const names = repositoryNamesOf(repositories.map((one) => one.path))
  return check.repository === null
    ? 'A repository'
    : (names.get(check.repository) ?? check.repository)
}

/** Why a pattern cannot be used, or undefined when it can: it compiles and captures a number. */
function patternProblem(pattern: string): string | undefined {
  if (pattern.trim() === '') return 'Write the pattern the number is read with.'
  try {
    // A pattern that matches the empty string through a trailing alternative counts its groups:
    // the match has one entry per group, plus the whole.
    const groups = (new RegExp(`${pattern}|`).exec('') ?? []).length - 1
    return groups === 0 ? 'Capture the number in parentheses, as in coverage ([\\d.]+).' : undefined
  } catch {
    return 'This is not a pattern Hemera can read.'
  }
}

/** Why a minimum cannot be used, or undefined when it is a number. */
function minimumProblem(minimum: string): string | undefined {
  if (minimum.trim() === '' || !Number.isFinite(Number(minimum))) return 'A number, such as 70.'
  return undefined
}

export interface CheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The check edited, or null when one is added. */
  check: CheckLine | null
  /** The catalogue a command is picked from. */
  commands: readonly CommandLine[]
  /** The Project's repositories, one of which a check may run in. */
  repositories: readonly RepositoryLine[]
  /** The names of the Project's other checks, which a new name may not take. */
  takenNames: readonly string[]
  /** Writes the check; answers the refusal to show, or null once it is written. */
  onSubmit: (check: CheckLine) => Promise<string | null>
}

export function CheckDialog({
  open,
  onOpenChange,
  check,
  commands,
  repositories,
  takenNames,
  onSubmit,
}: CheckDialogProps): ReactNode {
  const [name, setName] = useState('')
  const [source, setSource] = useState<Source>('command')
  const [commandId, setCommandId] = useState('')
  const [line, setLine] = useState('')
  const [where, setWhere] = useState(ROOT)
  const [when, setWhen] = useState<CheckWhen>('task')
  const [expecting, setExpecting] = useState(false)
  const [pattern, setPattern] = useState('')
  const [minimum, setMinimum] = useState('')
  const [files, setFiles] = useState('')
  // Refusals are said once Save was pressed, and then as they are fixed: not while a field is
  // first typed, which would be every field refused before anything was written.
  const [tried, setTried] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Opened is opened anew, on the check it is handed: the dialog outlives its openings.
  useEffect(() => {
    if (!open) return
    setName(check?.name ?? '')
    setSource(check === null || check.line === null ? 'command' : 'line')
    setCommandId(check?.commandId ?? commands[0]?.id ?? '')
    setLine(check?.line ?? '')
    setWhere(baseOf(check))
    setWhen(check?.when ?? 'task')
    setExpecting(check !== null && check.expect !== null)
    setPattern(check?.expect?.pattern ?? '')
    setMinimum(check === null || check.expect === null ? '' : String(check.expect.minimum))
    setFiles(check?.files ?? '')
    setTried(false)
    setRefusal(null)
  }, [open])

  const adding = check === null
  const names = repositoryNamesOf(repositories.map((one) => one.path))
  const command = commands.find((one) => one.id === commandId)
  const runs = source === 'command' ? (command?.command ?? '') : line

  const commandItems = commands.map((one) => {
    const Icon = COMMAND_TYPE_ICONS[one.type]
    return { value: one.id, label: one.name, icon: <Icon size="sm" /> }
  })
  const whereItems = [
    { value: ROOT, label: source === 'command' ? 'Where the command runs' : 'Workspace root' },
    ...repositories.map((one) => ({
      value: one.path,
      label: `In ${names.get(one.path) ?? one.path}`,
    })),
    { value: CHANGED, label: 'Each repository the task changed' },
  ]

  const nameError =
    name.trim() === ''
      ? 'Name the check.'
      : takenNames.includes(name.trim()) && name.trim() !== check?.name
        ? `A check named “${name.trim()}” already exists.`
        : undefined
  const sourceError =
    source === 'command'
      ? command === undefined
        ? 'Pick a command of the catalogue.'
        : undefined
      : line.trim() === ''
        ? 'Write the line it runs.'
        : undefined
  const patternError = expecting ? patternProblem(pattern) : undefined
  const minimumError = expecting ? minimumProblem(minimum) : undefined
  const filesError =
    files.trim() !== '' && runs !== '' && !runs.includes('{files}')
      ? 'The line has no {files} for the files to take the place of.'
      : undefined
  const invalid = [nameError, sourceError, patternError, minimumError, filesError].some(
    (problem) => problem !== undefined,
  )
  /** A refusal, once it is time to say it. */
  const said = (problem: string | undefined) => (tried ? problem : undefined)

  const submit = async () => {
    setTried(true)
    if (invalid) return
    setSaving(true)
    const answer = await onSubmit({
      id: check?.id ?? name.trim(),
      name: name.trim(),
      commandId: source === 'command' ? commandId : null,
      line: source === 'line' ? line.trim() : null,
      where: where === ROOT ? 'root' : where === CHANGED ? 'changed' : 'repository',
      repository: where === ROOT || where === CHANGED ? null : where,
      when,
      expect: expecting ? { pattern, minimum: Number(minimum) } : null,
      files: files.trim() === '' ? null : files.trim(),
    })
    setSaving(false)
    setRefusal(answer)
    if (answer === null) onOpenChange(false)
  }

  return (
    <Dialog
      title={adding ? 'Add check' : 'Edit check'}
      description="What Hemera runs to judge the agent's work, where and when. The agent never runs it."
      size="wide"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            state={saving ? 'loading' : 'idle'}
            disabled={tried && invalid}
            onClick={() => void submit()}
          >
            {adding ? 'Add check' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={FORM}>
        <Input
          label="Name"
          placeholder="unit tests"
          value={name}
          onValueChange={setName}
          error={said(nameError)}
        />
        <div className={ROW}>
          <Labelled label="Runs">
            <Select label="Runs" value={source} onValueChange={setSource} items={SOURCE_ITEMS} />
          </Labelled>
          {source === 'command' ? (
            <div className={FIELD}>
              <Labelled label="Command">
                <Select
                  label="Command"
                  value={commandId === '' ? undefined : commandId}
                  onValueChange={setCommandId}
                  placeholder="The catalogue is empty"
                  items={commandItems}
                />
              </Labelled>
              {said(sourceError) !== undefined && <p className={REFUSAL}>{sourceError}</p>}
            </div>
          ) : (
            <Input
              label="Line"
              className={FIELD}
              placeholder="pnpm vitest run {files}"
              value={line}
              onValueChange={setLine}
              error={said(sourceError)}
            />
          )}
        </div>
        <div className={ROW}>
          <Labelled label="Where">
            <Select label="Where" value={where} onValueChange={setWhere} items={whereItems} />
          </Labelled>
          <Labelled label="When">
            <Select label="When" value={when} onValueChange={setWhen} items={WHEN_ITEMS} />
          </Labelled>
        </div>
        <div className="flex flex-col gap-3">
          <Checkbox
            label="Expect a number in its output"
            description="The first number the pattern captures is compared: green only when the check exits 0 and the number is at least the minimum."
            checked={expecting}
            onCheckedChange={setExpecting}
          />
          {expecting && (
            <div className={ROW}>
              <Input
                label="Pattern"
                className={FIELD}
                placeholder="All files\s*\|\s*([\d.]+)"
                value={pattern}
                onValueChange={setPattern}
                error={said(patternError)}
              />
              <Input
                label="Minimum"
                placeholder="70"
                value={minimum}
                onValueChange={setMinimum}
                error={said(minimumError)}
              />
            </div>
          )}
        </div>
        <Input
          label="Files"
          placeholder="e2e/**/*.e2e.ts"
          description="Optional. The line's {files} becomes the files the task changed that match; when none match, the check is skipped."
          value={files}
          onValueChange={setFiles}
          error={said(filesError)}
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
