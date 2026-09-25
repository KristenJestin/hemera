import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { LayoutGroup, motion } from 'motion/react'
import { type FunctionComponent, type ReactNode, useId, useState } from 'react'

import { AlertDialog } from '../components/alert-dialog/alert-dialog.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Card, CardRow } from '../components/card/card.tsx'
import { Input } from '../components/field/field.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { useAppForm } from '../form/app-form.ts'
import { projectSettingsSchema } from '../form/schemas.ts'
import {
  IconArchive,
  IconChecklist,
  IconFolders,
  IconGitFork,
  IconPencil,
  IconPlus,
  type IconProps,
  IconSettings,
  IconTerminal2,
  IconVariable,
  IconX,
} from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'
import { CommandDialog, TypeMark } from './command-dialog.tsx'
import type { CommandLine, ProjectSettingsDraft, RepositoryDraft, RepositoryLine } from './model.ts'
import { slugOf } from './naming.ts'
import { causeOf } from './project-dialog.tsx'
import { RepositoryDialog, RepositoryMark } from './repository-dialog.tsx'

export type { CommandLine } from './model.ts'

/**
 * The settings of one Project (design D4-07, recette 1 of lot 20).
 *
 * A navigation on the left and one section on screen at a time: General, Repositories,
 * Workspaces, Commands, Preparation, Variables. A page that held all six one under the other was
 * a page read by scrolling past five things to reach the sixth. The section chosen stays chosen
 * while the page is open; the arrows walk the navigation, as in any list of tabs.
 *
 * General is the one form of the page: the identity and the prefix of the Spec keys, the folder
 * of `main` and where dedicated Workspaces go, saved together by the one button under them. A
 * page that saved each field as it was typed would be a page writing a version of the Project per
 * keystroke, and the engine refuses a stale version rather than merging one. The archive sits at
 * the bottom of General, alone, because it is the one action here that takes the Project out of
 * the bar.
 *
 * Repositories and Commands are lists, and every addition and every edit is a dialog: a row says
 * what a thing is and offers to edit or remove it, and nothing is typed into a row. Workspaces,
 * Preparation and Variables are composed by the caller and drawn here as they are handed.
 */
const PAGE = 'flex flex-col gap-6'

const NOTE = 'text-sm text-muted-foreground'

const REFUSAL = 'text-sm text-destructive-muted-foreground'

const PATH = 'min-w-0 flex-1 truncate font-mono text-sm'

/** A quiet word on a row, where a badge would shout: "not a Git repository". */
const QUIET = 'shrink-0 text-xs text-muted-foreground'

/** The name of a command on its row, which gives way last. */
const COMMAND_NAME = 'shrink-0 text-sm font-medium text-foreground'

/** A command's line on its row, which gives way before its name does. */
const LINE = 'min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground'

/** The address a Portless command answers at, which is what its row says of Portless. */
const ADDRESS = 'shrink-0 font-mono text-xs text-foreground'

/** The mark of a repository a new Workspace takes, or the room it would take. */
const INCLUDED = 'flex shrink-0 rounded-sm text-muted-foreground focus-ring'

const EMPTY_MARK = 'size-icon-sm shrink-0'

const LAYOUT = 'flex items-start gap-8'

const NAV = 'flex w-menu-side shrink-0 flex-col gap-1'

/** One entry of the navigation and the room its mark travels through. */
const NAV_SLOT = 'relative flex'

const NAV_ITEM =
  'relative flex h-control-md w-full items-center gap-2 rounded-md px-3 text-sm text-muted-foreground outline-none select-none focus-ring data-selected:text-foreground'

/** The one fill of the navigation, which travels to the section chosen. */
const NAV_MARK = 'absolute inset-0 rounded-md bg-accent'

const PANEL = 'flex min-w-0 flex-1 flex-col gap-4 outline-none'

/** The sections of the page, in the order the navigation lists them. */
export type ProjectSettingsSection =
  | 'general'
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'

const SECTIONS: {
  value: ProjectSettingsSection
  label: string
  icon: FunctionComponent<IconProps>
}[] = [
  { value: 'general', label: 'General', icon: IconSettings },
  { value: 'repositories', label: 'Repositories', icon: IconFolders },
  { value: 'workspaces', label: 'Workspaces', icon: IconGitFork },
  { value: 'commands', label: 'Commands', icon: IconTerminal2 },
  { value: 'preparation', label: 'Preparation', icon: IconChecklist },
  { value: 'variables', label: 'Variables', icon: IconVariable },
]

export interface ProjectSettingsProps {
  /** What the Project is right now; the form opens on it and says when it has moved away. */
  project: ProjectSettingsDraft
  /** A line under the title: when it was created, what it holds. */
  subtitle?: string | undefined
  repositories: RepositoryLine[]
  /** What sits directly under the Workspace, so a path can be offered instead of asked for. */
  folders?: readonly RepositoryLine[] | undefined
  /** What a Project is saved with; the message it answers is shown under the form. */
  onSave: (draft: ProjectSettingsDraft) => Promise<string | null>
  /** Asks the system for a folder, and answers null when the picker was dismissed. */
  onBrowse: () => Promise<string | null>
  /** Asks whatever has a disk what is at a path, and answers the cause when nothing usable is. */
  onCheckFolder?: ((path: string) => Promise<string | null>) | undefined
  /**
   * Says which folder the rest of the page is about, as it is typed.
   *
   * What a declared location holds is read against the folder of `main` as it is on screen, not
   * as it was last saved: until then every line would say "not there yet".
   */
  onMainPathChange?: ((path: string) => void) | undefined
  /** Declares a path; answers the refusal to show in the dialog, or null. */
  onAddRepository: (path: string) => Promise<string | null>
  /**
   * Rewrites a declared repository, found by the path it had: its path, its icon and whether a
   * new Workspace takes it (D8-04). Answers the refusal to show in its dialog, which stays open.
   */
  onUpdateRepository: (path: string, next: RepositoryDraft) => Promise<string | null>
  onRemoveRepository: (path: string) => void
  /**
   * The commands of the Project, which are what its Sessions may run (design D6-12).
   *
   * Optional, and the section says so rather than hiding: a Project whose page cannot reach the
   * engine yet is a page whose catalogue is empty, not a page without a catalogue.
   */
  commands?: readonly CommandLine[] | undefined
  /** Adds a command; the message it answers is shown in the dialog, which stays open. */
  onAddCommand?: ((command: CommandLine) => Promise<string | null>) | undefined
  /** Rewrites a command the catalogue holds, found by its name; answers like `onAddCommand`. */
  onUpdateCommand?: ((command: CommandLine) => Promise<string | null>) | undefined
  onRemoveCommand?: ((id: string) => void) | undefined
  /** Asks for a folder a command runs in, handed the base it runs from (recette 2). */
  onBrowseCommandFolder?: ((base: string | null) => Promise<string | null>) | undefined
  /** Whether `portless` is on this machine, which is what offers it on a server (D8-10). */
  portlessInstalled: boolean
  onArchive: () => void
  /** The Workspaces of the Project, composed by the caller: the section draws them as handed. */
  workspaces?: ReactNode
  /** The preparation recipe of the Project, composed by the caller (D8-05). */
  preparation?: ReactNode
  /** The Project's variables, composed by the caller (D8-06). */
  variables?: ReactNode
  /**
   * What the engine last refused about the Workspaces, the preparation or the variables, in its
   * words, shown at the top of those three sections; null or absent when nothing was.
   */
  slotRefusal?: string | null | undefined
  /** The section shown first; General unless said otherwise. */
  defaultSection?: ProjectSettingsSection | undefined
  /** The section shown, for a caller that keeps it itself. */
  section?: ProjectSettingsSection | undefined
  onSectionChange?: ((section: ProjectSettingsSection) => void) | undefined
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
  onUpdateRepository,
  onRemoveRepository,
  commands = [],
  onAddCommand,
  onUpdateCommand,
  onRemoveCommand,
  onBrowseCommandFolder,
  portlessInstalled,
  onArchive,
  workspaces,
  preparation,
  variables,
  slotRefusal = null,
  defaultSection = 'general',
  section,
  onSectionChange,
}: ProjectSettingsProps): ReactNode {
  const [chosen, setChosen] = useState<ProjectSettingsSection>(defaultSection)
  const current = section ?? chosen
  const transition = useTransition(arrival)
  const group = useId()
  const [refusal, setRefusal] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: project,
    validators: { onChange: projectSettingsSchema },
    onSubmit: async ({ value }) => {
      const said = await onSave(value)
      setRefusal(said)
      // What was saved is what the page is now on. Without this the form stays dirty against the
      // values it opened with, and the button goes on offering to save what is already saved.
      if (said === null) form.reset(value)
    },
  })

  /** A section the caller composes, under what the engine last refused about it. */
  const slot = (content: ReactNode, empty: string) => (
    <>
      {slotRefusal !== null && (
        <p role="alert" className={REFUSAL}>
          {slotRefusal}
        </p>
      )}
      {content ?? <p className={NOTE}>{empty}</p>}
    </>
  )

  const panels: Record<ProjectSettingsSection, ReactNode> = {
    general: (
      <>
        <Card title="Identity">
          <div className="flex flex-wrap items-start gap-6">
            <form.AppField name="name">
              {(field) => <field.TextField label="Name" className="min-w-0 flex-1" />}
            </form.AppField>
            <form.AppField name="tone">
              {(field) => <field.ToneField label="Colour" />}
            </form.AppField>
          </div>
          <form.AppField name="specPrefix">
            {(field) => (
              <field.TextField
                label="Spec prefix"
                description="What the keys of new Specs start with. Keys already given keep theirs."
              />
            )}
          </form.AppField>
        </Card>

        <Card title="Main Workspace" description="The root every repository path is relative to.">
          <form.AppField
            name="mainPath"
            listeners={{ onChange: ({ value }) => onMainPathChange?.(value) }}
            validators={{
              onSubmitAsync: async ({ value }) => await causeOf(value, onCheckFolder),
            }}
          >
            {(field) => (
              <field.PathField label="Folder" onBrowse={onBrowse} browseLabel="Change…" />
            )}
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
                      void onBrowse().then((picked) => {
                        if (picked !== null) field.handleChange(picked)
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

        {/* The button is under the three cards it saves, and says so by being nowhere else. */}
        <div className="flex items-center gap-3">
          {refusal !== null && (
            <p role="alert" className={REFUSAL}>
              {refusal}
            </p>
          )}
          <form.AppForm>
            <form.SubmitButton label="Save" settledLabel="Saved" className="ml-auto" />
          </form.AppForm>
        </div>

        <DangerZone name={project.name} onArchive={onArchive} />
      </>
    ),
    repositories: (
      <RepositoryList
        repositories={repositories}
        folders={folders}
        onAdd={onAddRepository}
        onUpdate={onUpdateRepository}
        onRemove={onRemoveRepository}
      />
    ),
    workspaces: slot(workspaces, 'The Workspaces of this Project cannot be read yet.'),
    commands: (
      <CommandList
        commands={commands}
        // A command runs from the Workspace root or from one of the Project's repositories
        // (D8-07): the declared ones are what is offered, and nothing else is accepted.
        repositories={repositories}
        portlessInstalled={portlessInstalled}
        projectName={project.name}
        onAdd={onAddCommand}
        onUpdate={onUpdateCommand}
        onRemove={onRemoveCommand}
        onBrowse={onBrowseCommandFolder}
      />
    ),
    preparation: slot(preparation, 'The preparation of this Project cannot be read yet.'),
    variables: slot(variables, 'The variables of this Project cannot be read yet.'),
  }

  return (
    <div className={PAGE}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-medium">Project settings</h1>
        {subtitle !== undefined && <p className={NOTE}>{subtitle}</p>}
      </div>

      <BaseTabs.Root
        orientation="vertical"
        value={current}
        onValueChange={(next: ProjectSettingsSection) => {
          setChosen(next)
          onSectionChange?.(next)
        }}
        className={LAYOUT}
      >
        <BaseTabs.List activateOnFocus aria-label="Project settings" className={NAV}>
          <LayoutGroup id={group}>
            {SECTIONS.map((one) => (
              <span key={one.value} className={NAV_SLOT}>
                {one.value === current && (
                  <motion.span
                    layoutId={`${group}-section`}
                    className={NAV_MARK}
                    transition={transition}
                  />
                )}
                <BaseTabs.Tab value={one.value} className={NAV_ITEM}>
                  <one.icon size="sm" aria-hidden="true" />
                  {one.label}
                </BaseTabs.Tab>
              </span>
            ))}
          </LayoutGroup>
        </BaseTabs.List>
        {SECTIONS.map((one) => (
          // Not a stop of the tab order of its own: the Tab key goes from the navigation to the
          // first control of the section, which is what a reader moving on is looking for.
          <BaseTabs.Panel key={one.value} value={one.value} tabIndex={-1} className={PANEL}>
            {panels[one.value]}
          </BaseTabs.Panel>
        ))}
      </BaseTabs.Root>
    </div>
  )
}

/**
 * The declared repositories, and what the disk says about each of them.
 *
 * An empty list is not a mistake: it means the root itself, which is what the card says instead
 * of offering to initialise anything. Nothing here clones, creates or writes.
 *
 * A row says where the repository is, what it is on, and — as one quiet mark — whether a new
 * dedicated Workspace takes a worktree of it (D8-04). What it is drawn with, its path and that
 * inclusion are changed in its dialog; the creation dialog of a Workspace still lets the user
 * change the inclusion for one Workspace.
 */
export function RepositoryList({
  repositories,
  folders = [],
  onAdd,
  onUpdate,
  onRemove,
}: {
  repositories: RepositoryLine[]
  /** What sits directly under the Workspace, offered rather than asked for. */
  folders?: readonly RepositoryLine[] | undefined
  onAdd: (path: string) => Promise<string | null>
  onUpdate: (path: string, next: RepositoryDraft) => Promise<string | null>
  onRemove: (path: string) => void
}): ReactNode {
  /**
   * The repository the dialog edits, or null when it adds one. Kept while the dialog closes, so
   * it does not change its title on its way out.
   */
  const [editing, setEditing] = useState<RepositoryLine | null>(null)
  const [open, setOpen] = useState(false)
  const openOn = (repository: RepositoryLine | null) => {
    setEditing(repository)
    setOpen(true)
  }
  const [refusal, setRefusal] = useState<string | null>(null)
  const [taking, setTaking] = useState(false)

  const declared = new Set(repositories.map((one) => one.path))
  /** What is under the Workspace and not declared yet, which is what there is to offer. */
  const spare = folders.filter((one) => !declared.has(one.path))
  /**
   * The ones that hold a repository, which is what "declare them all" means: a Workspace holds
   * plenty of folders that are not repositories, and declaring those is declaring noise. Every
   * one of them is still offered in the dialog, one at a time.
   */
  const repositoriesSpare = spare.filter((one) => one.branch !== null)

  /**
   * Declares everything the Workspace turned out to hold, in one press.
   *
   * One at a time and in order, because each one is a change carrying the version it was read
   * at: sent together, the first would go through and the rest would be refused as stale.
   */
  const takeAll = async () => {
    setTaking(true)
    setRefusal(null)
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

  /**
   * What the dialog's Save does. An addition is a declaration, then — only when the dialog
   * asked for more than a declaration gives by default, an icon or a repository left out — the
   * rewrite of what was just declared.
   */
  const submit = async (draft: RepositoryDraft): Promise<string | null> => {
    if (editing !== null) return await onUpdate(editing.path, draft)
    const said = await onAdd(draft.path)
    if (said !== null) return said
    if (draft.icon === null && draft.includedByDefault) return null
    return await onUpdate(draft.path, draft)
  }

  return (
    <Card
      title="Repositories"
      description="Relative to the folder of main. Leave the list empty to use the root itself."
      actions={
        <Button variant="secondary" size="sm" onClick={() => openOn(null)}>
          <IconPlus size="sm" />
          Add repository
        </Button>
      }
    >
      {repositories.length === 0 ? (
        <p className={NOTE}>
          No repository is declared, so the root is used as it is. Nothing is initialised.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Repositories">
          {repositories.map((repository) => (
            <li key={repository.path}>
              <CardRow>
                <RepositoryMark icon={repository.icon} branch={repository.branch} />
                <span className={PATH}>{repository.path}</span>
                {repository.branch === null ? (
                  <span className={QUIET}>
                    {repository.exists ? 'not a Git repository' : 'not there yet'}
                  </span>
                ) : (
                  <Badge tone="success">git · {repository.branch}</Badge>
                )}
                {repository.includedByDefault ? (
                  <Tooltip label="In every new Workspace">
                    <i
                      role="img"
                      // Focusable so the keyboard reaches its tooltip as the pointer does.
                      tabIndex={0}
                      aria-label={`${repository.path} is in every new Workspace`}
                      className={INCLUDED}
                    >
                      <IconGitFork size="sm" aria-hidden="true" />
                    </i>
                  </Tooltip>
                ) : (
                  <span className={EMPTY_MARK} />
                )}
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconPencil size="sm" />}
                  aria-label={`Edit ${repository.path}`}
                  onClick={() => openOn(repository)}
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
      {refusal !== null && (
        <p role="alert" className={REFUSAL}>
          {refusal}
        </p>
      )}

      <RepositoryDialog
        open={open}
        onOpenChange={setOpen}
        repository={editing}
        folders={spare}
        onSubmit={submit}
      />
    </Card>
  )
}

/**
 * The commands of a Project, which are what its Sessions may run (design D6-12, D8-07).
 *
 * A command is named once and run by name: the agent asks for `check`, and what runs is the line
 * the reader wrote, from the folder they wrote it for. That indirection is the whole point — the
 * catalogue is the reader's, the agent cannot invent a line, and what a Session may run is what
 * this list holds and nothing else.
 *
 * A row says the type of a command with its fixed icon, its name, its line and, for a Portless
 * server, the address it answers at. The scope, where it runs from and the line of each system
 * are in the dialog its pencil opens: a badge saying `Workspace root` told the reader where a
 * command ran and never what it ran, and four badges on every row said the same thing four times
 * (recette 2).
 *
 * An empty catalogue is a Project whose Sessions run no command, and the card says that rather
 * than showing an empty box: a reader who sees "no command" knows why the agent's `commands_run`
 * was refused, which is the answer they came for.
 */
export function CommandList({
  commands,
  repositories = [],
  portlessInstalled,
  projectName,
  onAdd,
  onUpdate,
  onRemove,
  onBrowse,
}: {
  commands: readonly CommandLine[]
  /** The repositories of the Project, which a command's folder may start from. */
  repositories?: readonly RepositoryLine[] | undefined
  /** Whether `portless` is on this machine (D8-10). */
  portlessInstalled: boolean
  /** The Project's name, whose slug Portless is offered first. */
  projectName: string
  onAdd?: ((command: CommandLine) => Promise<string | null>) | undefined
  /** Rewrites the command of the same name. */
  onUpdate?: ((command: CommandLine) => Promise<string | null>) | undefined
  onRemove?: ((id: string) => void) | undefined
  /** Asks for a folder, handed the base a command runs from; null for the Workspace root. */
  onBrowse?: ((base: string | null) => Promise<string | null>) | undefined
}): ReactNode {
  /**
   * The command the dialog edits, or null when it adds one. Kept while the dialog closes, so it
   * does not change its title on its way out.
   */
  const [editing, setEditing] = useState<CommandLine | null>(null)
  const [open, setOpen] = useState(false)
  const openOn = (command: CommandLine | null) => {
    setEditing(command)
    setOpen(true)
  }
  const submit = async (command: CommandLine): Promise<string | null> => {
    const write = editing === null ? onAdd : onUpdate
    return (await write?.(command)) ?? null
  }

  return (
    <Card
      title="Commands"
      description="Named once and run by name. A Session may run these and nothing else."
      actions={
        onAdd === undefined ? undefined : (
          <Button variant="secondary" size="sm" onClick={() => openOn(null)}>
            <IconPlus size="sm" />
            Add command
          </Button>
        )
      }
    >
      {commands.length === 0 ? (
        <p className={NOTE}>
          No command is declared, so this Project's Sessions run none. The agent asking for one is
          refused, and the refusal says the catalogue is empty.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Commands">
          {commands.map((one) => (
            <li key={one.id}>
              <CardRow>
                <TypeMark type={one.type} />
                <span className={COMMAND_NAME}>{one.name}</span>
                <span className={LINE}>{one.command}</span>
                {one.type === 'serve' && one.portless && (
                  <span className={ADDRESS}>
                    https://{one.portlessName ?? slugOf(projectName)}.localhost
                  </span>
                )}
                {onUpdate === undefined ? null : (
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconPencil size="sm" />}
                    aria-label={`Edit ${one.name}`}
                    onClick={() => openOn(one)}
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

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        command={editing}
        repositories={repositories}
        portlessInstalled={portlessInstalled}
        projectName={projectName}
        onBrowse={onBrowse}
        onSubmit={submit}
      />
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
