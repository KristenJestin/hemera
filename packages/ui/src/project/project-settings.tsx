import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { AlertDialog } from '../components/alert-dialog/alert-dialog.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { SuggestInput, type Suggestion } from '../components/suggest/suggest-input.tsx'
import { Input } from '../components/field/field.tsx'
import { Select } from '../components/select/select.tsx'
import { useAppForm } from '../form/app-form.ts'
import { projectFormSchema, relativePathSchema } from '../form/schemas.ts'
import { IconArchive, IconFolder, IconGitBranch, IconPencil, IconPlus, IconX } from '../icons.ts'
import { causeOf } from './project-dialog.tsx'
import {
  COMMAND_TYPES,
  COMMAND_TYPE_ICONS,
  COMMAND_TYPE_LABELS,
  type CommandScope,
  type CommandType,
} from '../activity/command-type.ts'
import type { ProjectDraft, RepositoryLine } from './model.ts'

/**
 * The settings of one Project, in its cards (design D4-07).
 *
 * Identity, the folder of `main` and where dedicated Workspaces go are one form with one button,
 * and the button sits with the title of the page rather than under the last field: what it saves
 * is the three cards above it, and a button inside one of them would be claiming only that one.
 * A page that saved each field as it was typed would be a page writing a version of the Project
 * per keystroke, and the engine refuses a stale version rather than merging one.
 *
 * The repositories are their own thing — each line is added or taken away on its own — and the
 * archive sits at the bottom, alone, because it is the one action here that takes the Project
 * out of the bar.
 */
const PAGE = 'flex flex-col gap-4'

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const PATH = 'min-w-0 flex-1 truncate font-mono text-sm'

/** A command's line on its row, which gives way before its name does. */
const LINE = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/** A box to tick and its words: the label is the whole target, as a native one is. */
const TICK = 'flex shrink-0 items-center gap-2 text-sm text-foreground'

/**
 * The ring of the box, worn by what holds it: a checkbox is a replaced element and draws no
 * pseudo-element, so the ring would never show on the input itself.
 */
const TICK_RING = 'flex rounded-sm focus-ring'

const TICK_BOX = 'size-4 accent-primary'

/**
 * A box to tick, as the platform draws it, in the theme's accent.
 *
 * The design system has no checkbox of its own yet, and two boxes on one page are not worth a
 * component: the native one is taken as it is. `hidden` completes the name for a screen reader
 * where the same words sit on every row.
 */
function Tick({
  label,
  hidden,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string
  hidden?: string | undefined
  checked: boolean
  disabled?: boolean | undefined
  onCheckedChange: (checked: boolean) => void
}): ReactNode {
  return (
    <label className={TICK}>
      <span className={TICK_RING}>
        <input
          type="checkbox"
          className={TICK_BOX}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
      </span>
      {label}
      {hidden !== undefined && <span className="sr-only">{hidden}</span>}
    </label>
  )
}

/** What a Project's name gives as a branch prefix when none is set (D8-04). */
function slugOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

export interface ProjectSettingsProps {
  /** What the Project is right now; the form opens on it and says when it has moved away. */
  project: ProjectDraft
  /** A line under the title: when it was created, what it holds. */
  subtitle?: string | undefined
  repositories: RepositoryLine[]
  /** What sits directly under the Workspace, so a path can be offered instead of asked for. */
  folders?: readonly RepositoryLine[] | undefined
  /** What a Project is saved with; the message it answers is shown above the cards. */
  onSave: (draft: ProjectDraft) => Promise<string | null>
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** Asks whatever has a disk what is at a path, and answers the cause when nothing usable is. */
  onCheckFolder?: ((path: string) => Promise<string | null>) | undefined
  /**
   * Says which folder the rest of the page is about, as it is typed.
   *
   * What a declared location holds is read against the folder of `main`, and until this existed
   * it was read against the folder of `main` *as last saved* — so every line said "not there
   * yet" until the page was saved, and then quietly became a branch. The page is about what is
   * on screen, so what is on screen is what it is read against.
   */
  onMainPathChange?: ((path: string) => void) | undefined
  onAddRepository: (path: string) => Promise<string | null>
  onRemoveRepository: (path: string) => void
  /** Says whether a repository is in every dedicated Workspace unless left out (D8-04). */
  onToggleIncluded?: ((path: string, included: boolean) => void) | undefined
  /**
   * The commands of the Project, which are what its Sessions may run (design D6-12).
   *
   * Optional, and the card says so rather than hiding: a Project whose page cannot reach the
   * engine yet is a page whose catalogue is empty, not a page without a catalogue.
   */
  commands?: readonly CommandLine[] | undefined
  /** Adds a command; the message it answers is shown under the form, and what was typed stays. */
  onAddCommand?: ((command: CommandLine) => Promise<string | null>) | undefined
  /** Rewrites a command the catalogue holds, found by its name; answers like `onAddCommand`. */
  onUpdateCommand?: ((command: CommandLine) => Promise<string | null>) | undefined
  onRemoveCommand?: ((id: string) => void) | undefined
  onArchive: () => void
}

export function ProjectSettings({
  project,
  subtitle,
  repositories,
  folders = [],
  onSave,
  onBrowse,
  onCheckFolder,
  onMainPathChange,
  onAddRepository,
  onRemoveRepository,
  onToggleIncluded,
  commands = [],
  onAddCommand,
  onUpdateCommand,
  onRemoveCommand,
  onArchive,
}: ProjectSettingsProps): ReactNode {
  const [refusal, setRefusal] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: project,
    validators: { onChange: projectFormSchema },
    onSubmit: async ({ value }) => {
      const said = await onSave(value)
      setRefusal(said)
      // What was saved is what the page is now on. Without this the form stays dirty against the
      // values it opened with, and the button goes on offering to save what is already saved.
      if (said === null) form.reset(value)
    },
  })

  return (
    <div className={PAGE}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-medium">Project settings</h1>
          {subtitle !== undefined && <p className={NOTE}>{subtitle}</p>}
        </div>
        <form.AppForm>
          <form.SubmitButton label="Save" settledLabel="Saved" className="ml-auto" />
        </form.AppForm>
      </div>

      {refusal !== null && (
        <p role="alert" className={REFUSAL}>
          {refusal}
        </p>
      )}

      <Card title="Identity">
        <div className="flex flex-wrap items-start gap-6">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" className="min-w-0 flex-1" />}
          </form.AppField>
          <form.AppField name="tone">{(field) => <field.ToneField label="Colour" />}</form.AppField>
        </div>
      </Card>

      <Card
        title="Main Workspace"
        description="The root every repository path below is relative to."
      >
        <form.AppField
          name="mainPath"
          listeners={{ onChange: ({ value }) => onMainPathChange?.(value) }}
          validators={{ onSubmitAsync: async ({ value }) => await causeOf(value, onCheckFolder) }}
        >
          {(field) => <field.PathField label="Folder" onBrowse={onBrowse} browseLabel="Change…" />}
        </form.AppField>
      </Card>

      <Card
        title="Dedicated Workspaces"
        description="Where the Workspace of a Spec is made, and what its branches are called."
      >
        {/* Both are null when empty (D8-02, D8-04), so the field shows the empty string and
            hands null back: an empty field is Hemera's own folder, and the Project's slug. */}
        <form.AppField name="workspacesRoot">
          {(field) => (
            <Input
              label="Workspaces folder"
              description="Leave empty to use Hemera's own folder, in the Profile."
              value={field.state.value ?? ''}
              onValueChange={(next) => field.handleChange(next === '' ? null : next)}
              onBlur={field.handleBlur}
              action={
                <Button
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => {
                    void onBrowse().then((chosen) => {
                      if (chosen !== null) field.handleChange(chosen)
                    })
                  }}
                >
                  Browse…
                </Button>
              }
            />
          )}
        </form.AppField>
        <form.AppField name="branchPrefix">
          {(field) => (
            <Input
              label="Branch prefix"
              placeholder={slugOf(project.name)}
              description={`Dedicated branches are ${field.state.value ?? slugOf(project.name)}/<KEY>-<slug>.`}
              value={field.state.value ?? ''}
              onValueChange={(next) => field.handleChange(next === '' ? null : next)}
              onBlur={field.handleBlur}
            />
          )}
        </form.AppField>
      </Card>

      <RepositoryList
        repositories={repositories}
        folders={folders}
        onAdd={onAddRepository}
        onRemove={onRemoveRepository}
        onToggleIncluded={onToggleIncluded}
      />

      <CommandList
        commands={commands}
        // A command runs in the Workspace root or in one of the Project's repositories (D6-12):
        // the declared ones are what is offered, and nothing else is accepted.
        folders={repositories}
        onAdd={onAddCommand}
        onUpdate={onUpdateCommand}
        onRemove={onRemoveCommand}
      />

      <DangerZone name={project.name} onArchive={onArchive} />
    </div>
  )
}

/**
 * The declared repositories, and what the disk says about each of them.
 *
 * An empty list is not a mistake: it means the root itself, which is what the card says instead
 * of offering to initialise anything. Nothing here clones, creates or writes.
 *
 * Each line says whether a dedicated Workspace takes a worktree of it by default (D8-04); the
 * creation dialog still lets the user change that for one Workspace.
 */
export function RepositoryList({
  repositories,
  folders = [],
  onAdd,
  onRemove,
  onToggleIncluded,
}: {
  repositories: RepositoryLine[]
  /** What sits directly under the Workspace, offered rather than asked for. */
  folders?: readonly RepositoryLine[] | undefined
  onAdd: (path: string) => Promise<string | null>
  onRemove: (path: string) => void
  /** Says whether a repository is in every dedicated Workspace unless left out. */
  onToggleIncluded?: ((path: string, included: boolean) => void) | undefined
}): ReactNode {
  const [adding, setAdding] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [taking, setTaking] = useState(false)

  const declared = new Set(repositories.map((one) => one.path))
  /** What is under the Workspace and not declared yet, which is what there is to offer. */
  const spare = folders.filter((one) => !declared.has(one.path))
  /**
   * The ones that hold a repository, which is what "declare them all" means.
   *
   * A Workspace holds plenty of folders that are not repositories — a `docs`, a `scripts`, a
   * folder somebody left there — and declaring those is declaring noise. Every one of them is
   * still on offer in the field below, one at a time, for the case where that is what is meant.
   */
  const repositoriesSpare = spare.filter((one) => one.branch !== null)

  const add = async (path: string) => {
    const read = relativePathSchema.safeParse(path)
    if (!read.success) {
      setRefusal(read.error.issues[0]?.message ?? 'That path cannot be declared.')
      return
    }
    const said = await onAdd(read.data)
    setRefusal(said)
    if (said === null) setAdding('')
  }

  /**
   * Declares everything the Workspace turned out to hold, in one press.
   *
   * One at a time and in order, because each one is a change carrying the version it was read
   * at: sent together, the first would go through and the rest would be refused as stale.
   */
  const takeAll = async () => {
    setTaking(true)
    for (const one of repositoriesSpare) {
      // oxlint-disable-next-line no-await-in-loop -- one version at a time; see above
      const said = await onAdd(one.path)
      if (said !== null) {
        setRefusal(said)
        break
      }
    }
    setTaking(false)
  }

  return (
    <Card
      title="Repositories"
      description="Relative to the folder above. Leave the list empty to use the root itself."
    >
      {repositories.length === 0 ? (
        <p className={NOTE}>
          No repository is declared, so the root is used as it is. Nothing is initialised.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.map((repository) => (
            <li key={repository.path}>
              <CardRow>
                <span className="flex shrink-0 text-muted-foreground">
                  {repository.branch === null ? (
                    <IconFolder size="sm" />
                  ) : (
                    <IconGitBranch size="sm" />
                  )}
                </span>
                <span className={PATH}>{repository.path}</span>
                {repository.branch === null ? (
                  <Badge tone="neutral">
                    {repository.exists ? 'no repository' : 'not there yet'}
                  </Badge>
                ) : (
                  <Badge tone="success">git · {repository.branch}</Badge>
                )}
                <Tick
                  label="In every Workspace by default"
                  hidden={`for ${repository.path}`}
                  checked={repository.includedByDefault}
                  disabled={onToggleIncluded === undefined}
                  onCheckedChange={(included) => onToggleIncluded?.(repository.path, included)}
                />
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconX size="sm" />}
                  aria-label={`Remove ${repository.path}`}
                  onClick={() => onRemove(repository.path)}
                />
              </CardRow>
            </li>
          ))}
        </ul>
      )}

      {repositoriesSpare.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className={NOTE}>
            {repositoriesSpare.length === 1
              ? '1 repository under the Workspace is not declared.'
              : `${String(repositoriesSpare.length)} repositories under the Workspace are not declared.`}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            state={taking ? 'loading' : 'idle'}
            disabled={taking}
            onClick={() => void takeAll()}
          >
            <IconPlus size="sm" />
            Declare them all
          </Button>
        </div>
      )}

      <SuggestInput
        label="Add a path"
        className="flex-1"
        placeholder="./sources/api"
        value={adding}
        onValueChange={(next) => {
          setAdding(next)
          setRefusal(null)
        }}
        error={refusal ?? undefined}
        description="Nothing is cloned or initialised here; preparation comes with lot 7."
        suggestions={suggestionsOf(spare)}
        emptyLabel="Every folder of the Workspace is already declared."
        action={
          <Button
            variant="secondary"
            className="shrink-0"
            disabled={adding.trim() === ''}
            onClick={() => void add(adding)}
          >
            <IconPlus size="sm" />
            Add a path
          </Button>
        }
      />
    </Card>
  )
}

/** What a folder under the Workspace is worth saying, on the line that offers it. */
function suggestionsOf(folders: readonly RepositoryLine[]): Suggestion[] {
  return folders.map((one) => {
    const offer: Suggestion = { value: one.path }
    if (one.branch !== null) offer.hint = `git · ${one.branch}`
    return offer
  })
}

/**
 * The commands of a Project, which are what its Sessions may run (design D6-12).
 *
 * A command is named once and run by name: the agent asks for `check`, and what runs is the line
 * the reader wrote, in the folder they wrote it for. That indirection is the whole point — the
 * catalogue is the reader's, the agent cannot invent a line, and what a Session may run is what
 * this card holds and nothing else.
 *
 * The type is what the interface says about a command and not a permission (D8-07): `serve` is a
 * server the reader wants an address for, and the six others end and answer with a code. Each is
 * drawn with the icon the design system fixes for it. A command has one default line and may
 * carry its own for Windows or Linux, which the machine runs instead; a `serve` says whether it
 * runs once per Workspace or once for the Project, and whether it goes through Portless (D8-10).
 * What each one is allowed to do is the same: it runs inside the Workspace.
 *
 * An empty catalogue is a Project whose Sessions run no command, and the card says that rather
 * than showing an empty box: a reader who sees "no command" knows why the agent's `commands_run`
 * was refused, which is the answer they came for.
 */
export interface CommandLine {
  /** What the command is called, which is what the agent asks for. */
  id: string
  /** The name the reader gave it, shown everywhere the catalogue is read. */
  name: string
  /** The default line, run in the folder below on a system with no line of its own. */
  command: string
  /** What Windows runs instead of the default line, or null. */
  lineWindows: string | null
  /** What Linux runs instead of the default line, or null. */
  lineLinux: string | null
  /** What the command is for, which is how it is drawn everywhere (D8-07). */
  type: CommandType
  /** Where a `serve` runs: once per Workspace, or once for the Project in `main`. */
  scope: CommandScope
  /** Whether a `serve` goes through Portless at launch (D8-10). */
  portless: boolean
  /** The folder it runs in, relative to the Workspace root. */
  folder: string
}

/** What a scope is read as on a command's row. */
const SCOPE_WORDS: Record<CommandScope, string> = {
  workspace: 'Per Workspace',
  project: 'Project, in main',
}

/** The type offered in the form, each with its fixed icon. */
const TYPE_ITEMS = COMMAND_TYPES.map((one) => {
  const Icon = COMMAND_TYPE_ICONS[one]
  return { value: one, label: COMMAND_TYPE_LABELS[one], icon: <Icon size="sm" /> }
})

const SCOPE_ITEMS: { value: CommandScope; label: string }[] = [
  { value: 'workspace', label: 'One instance per Workspace' },
  { value: 'project', label: 'One instance, run in main' },
]

/** A line of a system, typed or left empty: empty is the default line (D8-07). */
function lineOrNull(typed: string): string | null {
  return typed.trim() === '' ? null : typed.trim()
}

export function CommandList({
  commands,
  folders = [],
  onAdd,
  onUpdate,
  onRemove,
}: {
  commands: readonly CommandLine[]
  /** The repositories of the Project, offered as the folder a command runs in. */
  folders?: readonly RepositoryLine[] | undefined
  onAdd?: ((command: CommandLine) => Promise<string | null>) | undefined
  /** Rewrites the command of the same name; its row's pencil puts it in the form first. */
  onUpdate?: ((command: CommandLine) => Promise<string | null>) | undefined
  onRemove?: ((id: string) => void) | undefined
}): ReactNode {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [folder, setFolder] = useState('')
  const [lineWindows, setLineWindows] = useState('')
  const [lineLinux, setLineLinux] = useState('')
  const [type, setType] = useState<CommandType>('script')
  const [scope, setScope] = useState<CommandScope>('workspace')
  const [portless, setPortless] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /**
   * The command being edited, by name, or null when the form adds one.
   *
   * A command is found by its name, which is what the agent asks for: the name is kept while the
   * lines, the type and the folder are rewritten, and a new name is a new command.
   */
  const [editing, setEditing] = useState<string | null>(null)

  const clear = () => {
    setName('')
    setCommand('')
    setFolder('')
    setLineWindows('')
    setLineLinux('')
    setType('script')
    setScope('workspace')
    setPortless(false)
    setEditing(null)
  }

  const submit = async () => {
    const drafted: CommandLine = {
      id: name.trim(),
      name: name.trim(),
      command: command.trim(),
      lineWindows: lineOrNull(lineWindows),
      lineLinux: lineOrNull(lineLinux),
      type,
      // Meaningful for a `serve` only (D8-07, D8-10): anything else is one run per call.
      scope: type === 'serve' ? scope : 'workspace',
      portless: type === 'serve' && portless,
      folder: folder.trim() === '' ? '.' : folder.trim(),
    }
    const said = await (editing === null ? onAdd : onUpdate)?.(drafted)
    setRefusal(said ?? null)
    if (said === null || said === undefined) clear()
  }

  const edit = (one: CommandLine) => {
    setName(one.name)
    setCommand(one.command)
    setLineWindows(one.lineWindows ?? '')
    setLineLinux(one.lineLinux ?? '')
    setType(one.type)
    setScope(one.scope)
    setPortless(one.portless)
    setFolder(one.folder === '.' ? '' : one.folder)
    setRefusal(null)
    setEditing(one.name)
  }

  return (
    <Card
      title="Commands"
      description="Named once and run by name. A Session may run these and nothing else."
    >
      {commands.length === 0 ? (
        <p className={NOTE}>
          No command is declared, so this Project's Sessions run none. The agent asking for one is
          refused, and the refusal says the catalogue is empty.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {commands.map((one) => (
            <li key={one.id}>
              <CardRow>
                <CommandTypeIcon type={one.type} />
                <span className={PATH}>{one.name}</span>
                <span className={LINE}>{one.command}</span>
                <Badge tone="neutral">{COMMAND_TYPE_LABELS[one.type]}</Badge>
                <SystemLine system="Windows" line={one.lineWindows} />
                <SystemLine system="Linux" line={one.lineLinux} />
                {one.type === 'serve' && <Badge tone="neutral">{SCOPE_WORDS[one.scope]}</Badge>}
                {one.type === 'serve' && one.portless && <Badge tone="info">Portless</Badge>}
                <Badge tone="neutral">{one.folder === '.' ? 'Workspace root' : one.folder}</Badge>
                {onUpdate === undefined ? null : (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconPencil size="sm" />}
                    aria-label={`Edit ${one.name}`}
                    onClick={() => edit(one)}
                  />
                )}
                {onRemove === undefined ? null : (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconX size="sm" />}
                    aria-label={`Remove ${one.name}`}
                    onClick={() => onRemove(one.id)}
                  />
                )}
              </CardRow>
            </li>
          ))}
        </ul>
      )}

      {onAdd === undefined ? null : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              label="Command name"
              className="min-w-0 flex-1"
              placeholder="check"
              value={name}
              onValueChange={setName}
              // What is edited is found by its name: the name stays while the rest is rewritten.
              disabled={editing !== null}
            />
            <Input
              label="Default line"
              className="min-w-0 flex-1"
              placeholder="pnpm check"
              value={command}
              onValueChange={setCommand}
            />
            <Select
              label="Type"
              value={type}
              onValueChange={setType}
              mark={<CommandTypeIcon type={type} />}
              items={TYPE_ITEMS}
            />
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <Input
              label="Windows line"
              className="min-w-0 flex-1"
              placeholder="scripts\check.cmd"
              description="Leave empty to run the default line on that system."
              value={lineWindows}
              onValueChange={setLineWindows}
            />
            <Input
              label="Linux line"
              className="min-w-0 flex-1"
              placeholder="./scripts/check.sh"
              description="Leave empty to run the default line on that system."
              value={lineLinux}
              onValueChange={setLineLinux}
            />
          </div>
          {type === 'serve' && (
            <div className="flex flex-wrap items-center gap-3">
              <Select label="Scope" value={scope} onValueChange={setScope} items={SCOPE_ITEMS} />
              <Tick
                label="Serve through Portless"
                checked={portless}
                onCheckedChange={setPortless}
              />
            </div>
          )}
          <SuggestInput
            label="Command folder"
            placeholder="."
            value={folder}
            onValueChange={(next) => {
              setFolder(next)
              setRefusal(null)
            }}
            error={refusal ?? undefined}
            description="Relative to the Workspace root. A folder of this Project is offered."
            suggestions={folders.map((one) => ({ value: one.path }))}
            emptyLabel="The Workspace holds no folder yet."
            action={
              editing === null ? (
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={name.trim() === '' || command.trim() === ''}
                  onClick={() => void submit()}
                >
                  <IconPlus size="sm" />
                  Add a command
                </Button>
              ) : (
                <span className="flex shrink-0 gap-2">
                  <Button variant="ghost" onClick={clear}>
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={command.trim() === ''}
                    onClick={() => void submit()}
                  >
                    Save {editing}
                  </Button>
                </span>
              )
            }
          />
        </>
      )}
    </Card>
  )
}

/** The fixed icon of a command's type, in the muted colour of a row's mark (D8-07). */
function CommandTypeIcon({ type }: { type: CommandType }): ReactNode {
  const Icon = COMMAND_TYPE_ICONS[type]
  return (
    <span className="flex shrink-0 text-muted-foreground">
      <Icon size="sm" />
    </span>
  )
}

/**
 * The line a system runs instead of the default one, as a badge that names the system and
 * carries the line: in its title for the pointer, in its words for a screen reader (D8-07).
 */
function SystemLine({ system, line }: { system: string; line: string | null }): ReactNode {
  if (line === null) return null
  return (
    <span className="flex shrink-0" title={line}>
      <Badge tone="neutral">{system}</Badge>
      <span className="sr-only">: {line}</span>
    </span>
  )
}

/** The one end of life a Project has, which keeps everything it holds. */
export function DangerZone({
  name,
  onArchive,
}: {
  name: string
  onArchive: () => void
}): ReactNode {
  return (
    <Card
      tone="danger"
      title="Archive this Project"
      description="Its tab disappears; its Sessions and its Journal stay whole. Restore it from Settings."
    >
      <div>
        <AlertDialog
          title={`Archive ${name}?`}
          description="Its tab disappears and it stops being one of the Projects you switch between. Nothing is deleted: its Sessions and its Journal stay whole, and it is restored from Settings."
          confirmLabel="Archive it"
          onConfirm={onArchive}
          trigger={
            <Button variant="destructive">
              <IconArchive size="sm" />
              Archive {name}
            </Button>
          }
        />
      </div>
    </Card>
  )
}
