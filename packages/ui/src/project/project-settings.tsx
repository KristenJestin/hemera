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
import { IconArchive, IconCommand, IconFolder, IconGitBranch, IconPlus, IconX } from '../icons.ts'
import { causeOf } from './project-dialog.tsx'
import type { CommandKind } from '../activity/command-run.tsx'
import type { ProjectDraft, RepositoryLine } from './model.ts'

/**
 * The settings of one Project, in four cards (design D4-07).
 *
 * Identity and the folder of `main` are one form with one button, and the button sits with the
 * title of the page rather than under the last field: what it saves is the two cards above it,
 * and a button inside one of them would be claiming only that one. A page that saved each field
 * as it was typed would be a page writing a version of the Project per keystroke, and the engine
 * refuses a stale version rather than merging one.
 *
 * The repositories are their own thing — each line is added or taken away on its own — and the
 * archive sits at the bottom, alone, because it is the one action here that takes the Project
 * out of the bar.
 */
const PAGE = 'flex flex-col gap-4'

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const PATH = 'min-w-0 flex-1 truncate font-mono text-sm'

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
  /**
   * The commands of the Project, which are what its Sessions may run (design D6-12).
   *
   * Optional, and the card says so rather than hiding: a Project whose page cannot reach the
   * engine yet is a page whose catalogue is empty, not a page without a catalogue.
   */
  commands?: readonly CommandLine[] | undefined
  /** What the Project turned out to hold, offered as the folder a command runs in. */
  onAddCommand?: ((command: CommandLine) => Promise<string | null>) | undefined
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
  commands = [],
  onAddCommand,
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

      <RepositoryList
        repositories={repositories}
        folders={folders}
        onAdd={onAddRepository}
        onRemove={onRemoveRepository}
      />

      <CommandList
        commands={commands}
        folders={folders}
        onAdd={onAddCommand}
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
 */
export function RepositoryList({
  repositories,
  folders = [],
  onAdd,
  onRemove,
}: {
  repositories: RepositoryLine[]
  /** What sits directly under the Workspace, offered rather than asked for. */
  folders?: readonly RepositoryLine[] | undefined
  onAdd: (path: string) => Promise<string | null>
  onRemove: (path: string) => void
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
 * The kind is what the interface says about a command and not a permission: `app` is a server the
 * reader wants an address for, `check` is something that ends and answers with a code, `utility`
 * is everything else. What each one is allowed to do is the same: it runs inside the Workspace.
 *
 * An empty catalogue is a Project whose Sessions run no command, and the card says that rather
 * than showing an empty box: a reader who sees "no command" knows why the agent's `commands.run`
 * was refused, which is the answer they came for.
 */
export interface CommandLine {
  /** What the command is called, which is what the agent asks for. */
  id: string
  /** The name the reader gave it, shown everywhere the catalogue is read. */
  name: string
  /** The line itself, run in the folder below. */
  command: string
  /** What the command is for, which is how the panel draws it. */
  kind: CommandKind
  /** The folder it runs in, relative to the Workspace root. */
  folder: string
}

export function CommandList({
  commands,
  folders = [],
  onAdd,
  onRemove,
}: {
  commands: readonly CommandLine[]
  /** The folders of the Project, offered rather than asked for. */
  folders?: readonly RepositoryLine[] | undefined
  onAdd?: ((command: CommandLine) => Promise<string | null>) | undefined
  onRemove?: ((id: string) => void) | undefined
}): ReactNode {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [folder, setFolder] = useState('')
  const [kind, setKind] = useState<CommandKind>('utility')
  const [refusal, setRefusal] = useState<string | null>(null)

  const add = async () => {
    const said = await onAdd?.({
      id: name.trim(),
      name: name.trim(),
      command: command.trim(),
      kind,
      folder: folder.trim() === '' ? '.' : folder.trim(),
    })
    setRefusal(said ?? null)
    if (said === null || said === undefined) {
      setName('')
      setCommand('')
    }
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
                <span className="flex shrink-0 text-muted-foreground">
                  <IconCommand size="sm" />
                </span>
                <span className={PATH}>{one.name}</span>
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {one.command}
                </span>
                <Badge tone="neutral">{one.kind}</Badge>
                <Badge tone="neutral">{one.folder === '.' ? 'Workspace root' : one.folder}</Badge>
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
            />
            <Input
              label="Command line"
              className="min-w-0 flex-1"
              placeholder="pnpm check"
              value={command}
              onValueChange={setCommand}
            />
            <Select
              label="Kind"
              value={kind}
              onValueChange={setKind}
              items={[
                { value: 'app', label: 'App' },
                { value: 'check', label: 'Check' },
                { value: 'utility', label: 'Utility' },
              ]}
            />
          </div>
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
              <Button
                variant="secondary"
                className="shrink-0"
                disabled={name.trim() === '' || command.trim() === ''}
                onClick={() => void add()}
              >
                <IconPlus size="sm" />
                Add a command
              </Button>
            }
          />
        </>
      )}
    </Card>
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
