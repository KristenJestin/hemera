import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { COMMAND_TYPE_LABELS } from '../activity/command-type.ts'
import type { ProjectDraft, RepositoryLine } from './model.ts'
import {
  ProjectSettings,
  type CommandLine,
  type ProjectSettingsProps,
} from './project-settings.tsx'

/**
 * The settings of one Project, on fixtures (design D4-07).
 *
 * What a name and a path are allowed to be is the domain's rule, and the panel stands in for
 * it: `saveRefusal` and `addRefusal` are what the engine would have answered. What is under
 * test here is the page — what it shows, what it saves, and what it does with a refusal.
 *
 * Lot 20 gives the catalogue its seven types, a line per system, a scope and Portless (D8-07,
 * D8-10), each repository its place in a dedicated Workspace, and the page the folder and the
 * branch prefix of dedicated Workspaces (D8-02, D8-04).
 */
const ATLAS: ProjectDraft = {
  name: 'Atlas',
  tone: 'primary',
  mainPath: '/home/someone/Projects/atlas',
  workspacesRoot: null,
  branchPrefix: null,
}

const REPOSITORIES: RepositoryLine[] = [
  { path: './sources/api', branch: 'main', exists: true, includedByDefault: true },
  { path: './sources/front', branch: 'develop', exists: true, includedByDefault: true },
  { path: './docs', branch: null, exists: true, includedByDefault: false },
]

/** What a command of the catalogue is unless a fixture says otherwise. */
const PLAIN = {
  lineWindows: null,
  lineLinux: null,
  scope: 'workspace',
  portless: false,
} as const

/**
 * The catalogue of a Project that has one command of each of the seven types (D8-07).
 *
 * Named the way a reader names them, and each with the folder it runs in: `dev` in the front,
 * `check` at the root, an `auth` server shared by the Project and run through Portless, and a
 * `seed` whose Windows line is its own (scenario "The machine runs its own variant").
 */
const COMMANDS: CommandLine[] = [
  { ...PLAIN, id: 'check', name: 'check', command: 'pnpm check', type: 'test', folder: '.' },
  {
    ...PLAIN,
    id: 'dev',
    name: 'dev',
    command: 'pnpm dev',
    type: 'serve',
    folder: './sources/front',
  },
  {
    ...PLAIN,
    id: 'auth',
    name: 'auth',
    command: 'pnpm auth:serve',
    type: 'serve',
    scope: 'project',
    portless: true,
    folder: './sources/api',
  },
  {
    ...PLAIN,
    id: 'lint',
    name: 'lint',
    command: 'pnpm lint',
    type: 'lint',
    folder: './sources/api',
  },
  {
    ...PLAIN,
    id: 'build',
    name: 'build',
    command: 'pnpm build',
    type: 'build',
    folder: './sources/api',
  },
  {
    ...PLAIN,
    id: 'env',
    name: 'env',
    command: 'pnpm env:configure',
    type: 'configure',
    folder: './sources/api',
  },
  {
    ...PLAIN,
    id: 'inspect',
    name: 'inspect',
    command: 'node --inspect dist/main.js',
    type: 'debug',
    folder: './sources/api',
  },
  {
    ...PLAIN,
    id: 'seed',
    name: 'seed',
    command: './scripts/seed.sh',
    lineWindows: 'scripts\\seed.cmd',
    type: 'script',
    folder: './sources/api',
  },
]

/**
 * What the disk holds under the root: the declared paths, and folders that are not repositories.
 *
 * The page offers these when a repository is declared. A command's folder is offered among the
 * declared repositories only: it runs in the Workspace root or in one of them (D6-12).
 */
const FOLDERS: RepositoryLine[] = [
  ...REPOSITORIES,
  { path: './scripts', branch: null, exists: true, includedByDefault: false },
]

interface Extra {
  /** What saving answers: nothing, or the refusal the engine sent back. */
  saveRefusal?: string | null
  /** What adding a path answers: nothing, or the refusal the domain sent back. */
  addRefusal?: string | null
  /** What adding a command answers: nothing, or the refusal the engine sent back. */
  commandRefusal?: string | null
}

/**
 * The page holds the Project and its repositories; the panel decides what the engine answers.
 *
 * Written out rather than hidden in a harness, because it is exactly what the application does
 * with the same component: keep what came back, hand it in again.
 */
function Controlled({
  project,
  repositories,
  saveRefusal = null,
  addRefusal = null,
  commandRefusal = null,
  onSave,
  onAddRepository,
  onRemoveRepository,
  onToggleIncluded,
  onAddCommand,
  onUpdateCommand,
  onRemoveCommand,
  ...rest
}: ProjectSettingsProps & Extra) {
  const [kept, setKept] = useState(project)
  const [lines, setLines] = useState(repositories)
  const [catalogue, setCatalogue] = useState(rest.commands ?? [])
  return (
    <div className="mx-auto flex max-w-3xl flex-col p-6">
      <ProjectSettings
        {...rest}
        project={kept}
        repositories={lines}
        onSave={async (draft) => {
          await onSave(draft)
          if (saveRefusal !== null) return saveRefusal
          setKept(draft)
          return null
        }}
        onAddRepository={async (path) => {
          await onAddRepository(path)
          if (addRefusal !== null) return addRefusal
          setLines([...lines, { path, branch: null, exists: false, includedByDefault: true }])
          return null
        }}
        onRemoveRepository={(path) => {
          onRemoveRepository(path)
          setLines(lines.filter((one) => one.path !== path))
        }}
        onToggleIncluded={(path, included) => {
          onToggleIncluded?.(path, included)
          setLines(
            lines.map((one) =>
              one.path === path
                ? { path, branch: one.branch, exists: one.exists, includedByDefault: included }
                : one,
            ),
          )
        }}
        commands={catalogue}
        onAddCommand={async (command) => {
          await onAddCommand?.(command)
          if (commandRefusal !== null) return commandRefusal
          setCatalogue([...catalogue, command])
          return null
        }}
        onUpdateCommand={async (command) => {
          await onUpdateCommand?.(command)
          if (commandRefusal !== null) return commandRefusal
          setCatalogue(catalogue.map((one) => (one.name === command.name ? command : one)))
          return null
        }}
        onRemoveCommand={(id) => {
          onRemoveCommand?.(id)
          setCatalogue(catalogue.filter((one) => one.id !== id))
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Surfaces/Project/Settings',
  component: ProjectSettings,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    project: ATLAS,
    subtitle: 'Atlas · created 12 days ago',
    repositories: REPOSITORIES,
    folders: FOLDERS,
    saveRefusal: null,
    addRefusal: null,
    commandRefusal: null,
    commands: COMMANDS,
    onSave: fn(async () => await Promise.resolve(null)),
    onAddCommand: fn(async () => await Promise.resolve(null)),
    onUpdateCommand: fn(async () => await Promise.resolve(null)),
    onRemoveCommand: fn(),
    onBrowse: fn(async () => await Promise.resolve('/home/someone/Projects/atlas-2')),
    onAddRepository: fn(async () => await Promise.resolve(null)),
    onRemoveRepository: fn(),
    onToggleIncluded: fn(),
    onArchive: fn(),
  },
  argTypes: {
    project: { control: 'object', description: 'What the Project is right now.' },
    subtitle: { control: 'text', description: 'A line under the title of the page.' },
    repositories: { control: 'object', description: 'The declared paths and what the disk says.' },
    folders: {
      control: 'object',
      description: 'The folders of the Workspace, offered to fill in.',
    },
    saveRefusal: {
      control: 'text',
      description: 'What saving answers; null accepts the change.',
    },
    addRefusal: {
      control: 'text',
      description: 'What adding a path answers; null accepts it.',
    },
    commands: { control: 'object', description: 'The commands this Project may run.' },
    commandRefusal: {
      control: 'text',
      description: 'What adding a command answers; null accepts it.',
    },
    onSave: { action: 'saved' },
    onAddCommand: { action: 'command added' },
    onUpdateCommand: { action: 'command updated' },
    onRemoveCommand: { action: 'command removed' },
    onBrowse: { action: 'folder picked' },
    onAddRepository: { action: 'repository added' },
    onRemoveRepository: { action: 'repository removed' },
    onToggleIncluded: {
      action: 'repository included by default',
      description: 'Says whether a repository is in every dedicated Workspace by default.',
    },
    onArchive: { action: 'archived' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

type StoryContext = Parameters<NonNullable<Story['play']>>[0]

/** Opens a select of the page by its name and chooses one of its items, then waits it out. */
async function choose(canvasElement: HTMLElement, label: string, option: RegExp): Promise<void> {
  await userEvent.click(within(canvasElement).getByLabelText(label))
  const list = await waitFor(() => within(document.body).getByRole('listbox'))
  await userEvent.click(within(list).getByRole('option', { name: option }))
  // The list is waited out: the accessibility pass runs on whatever is on the page at the end,
  // and a popup still leaving carries focus guards that read as an error.
  await waitFor(() => {
    expect(within(document.body).queryByRole('listbox')).toBeNull()
  })
}

export const Playground: Story = {}

/**
 * Saved: nothing has been touched, so there is nothing to save and the button says so.
 *
 * Scenario « Branche lue à l'affichage » of `specs/project-workspaces/spec.md`: each declared
 * path says what the disk holds right now, and a folder with no repository says that.
 */
export const Variants: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Saved' })).toBeDisabled()
    expect(canvas.getByText('git · main')).toBeInTheDocument()
    expect(canvas.getByText('git · develop')).toBeInTheDocument()
    expect(canvas.getByText('no repository')).toBeInTheDocument()
  },
}

/** Scenario « Édition durable » of `specs/project-workspaces/spec.md`, as far as a page goes. */
export const States: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSave.mockClear()
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Atlas II')
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSave).toHaveBeenCalledWith({ ...ATLAS, name: 'Atlas II' })
    })
    // Once it is saved, the page is on what it saved, and there is nothing left to do.
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Saved' })).toBeDisabled()
    })
  },
}

/** Scenario « Version périmée » of `specs/project-workspaces/spec.md`, as the eye sees it. */
export const StaleVersion: Story = {
  args: { saveRefusal: 'the Project changed somewhere else; reopen it and try again' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const name = canvas.getByRole('textbox', { name: 'Name' })

    await userEvent.clear(name)
    await userEvent.type(name, 'Atlas II')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(canvas.getByRole('alert')).toHaveTextContent('changed somewhere else')
    })
    // What was typed stays: a refusal is not a reason to throw the edit away.
    expect(name).toHaveValue('Atlas II')
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Save' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/** Scenario « Liste vide » of `specs/project-workspaces/spec.md`. */
export const NoRepositoryDeclared: Story = {
  args: { repositories: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/the root is used as it is/)).toBeInTheDocument()
    // Nothing is offered that would create anything.
    expect(canvas.queryByRole('button', { name: /Initialise/ })).toBeNull()
  },
}

/**
 * Scenario « Chemin hors racine refusé » of `specs/project-workspaces/spec.md`, as the eye sees
 * it — the rule itself is checked in `packages/core/tests/project.test.ts`.
 */
export const PathOutsideTheRoot: Story = {
  // Refused by the field itself, before anything is asked of anybody: the three rules a path is
  // refused by are rules a form can check, and a refusal that took a round trip to say "that is
  // absolute" is a refusal that arrives after the next character has been typed. What the domain
  // says is still shown when it is the domain that says no — a path already declared, say.
  args: { addRefusal: 'the repository location "/tmp/x" is refused: it is absolute' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a path' }), '/tmp/x')
    await userEvent.click(canvas.getByRole('button', { name: 'Add a path' }))

    // The message arrives from under the field, and the story waits for it to land: a colour
    // read halfway through a fade is a contrast the accessibility pass is right to refuse.
    await waitFor(() => {
      expect(canvas.getByText(/is absolute/)).toHaveStyle({ opacity: '1' })
    })
    // The page holds two lists now, and the same path can be read in both: what is counted here
    // is the rows of declared paths, which the Repositories card draws before the Commands card.
    // SAFETY: the first reading of the path is that card's row, so the `<ul>` above it is the
    // list; the count below fails loudly if it ever is not.
    const paths = canvas.getAllByText('./sources/api')[0]?.closest('ul') as HTMLElement
    expect(within(paths).getAllByRole('listitem')).toHaveLength(REPOSITORIES.length)
    expect(canvas.getByRole('textbox', { name: 'Add a path' })).toHaveValue('/tmp/x')
  },
}

/** Adding and removing a path, which is the whole of what the list does. */
export const RepositoriesComeAndGo: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRemoveRepository.mockClear()
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('textbox', { name: 'Add a path' }), './sources/worker')
    await userEvent.click(canvas.getByRole('button', { name: 'Add a path' }))
    await waitFor(() => {
      expect(canvas.getByText('./sources/worker')).toBeInTheDocument()
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Remove ./docs' }))
    await waitFor(() => {
      expect(canvas.queryByText('./docs')).toBeNull()
    })
    expect(args.onRemoveRepository).toHaveBeenCalledWith('./docs')
  },
}

/** Scenario « Archivé puis restauré » of `specs/project-workspaces/spec.md`, its first half. */
export const Archiving: Story = {
  play: async ({ canvasElement, args }) => {
    args.onArchive.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.queryByRole('button', { name: /Delete/ })).toBeNull()

    // It asks first. Archiving takes a Project out of the bar, and a press that did it on the
    // way past is a press nobody meant: the button opens the question, and the question is what
    // archives it.
    await userEvent.click(canvas.getByRole('button', { name: `Archive ${ATLAS.name}` }))
    const asking = within(document.body).getByRole('dialog')
    expect(args.onArchive).not.toHaveBeenCalled()

    await userEvent.click(within(asking).getByRole('button', { name: 'Archive it' }))
    expect(args.onArchive).toHaveBeenCalled()
  },
}

/** Scenario « Catalogue du projet » of `specs/agent-tools/spec.md`: what a Session may run. */
export const CommandCatalogue: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRemoveCommand?.mockClear()
    const canvas = within(canvasElement)

    expect(canvas.getByText('Commands')).toBeInTheDocument()
    // The name is what the agent asks for; the line is what runs, and it is shown as written.
    expect(canvas.getByText('pnpm check')).toBeInTheDocument()
    // The folder is read on the command's own row, and the same path is a declared repository:
    // both are true, and both are shown.
    expect(canvas.getAllByText('./sources/front')).toHaveLength(2)
    // A command in the root says so in words: a dot is not a folder a reader recognises.
    expect(canvas.getByText('Workspace root')).toBeInTheDocument()

    await userEvent.click(canvas.getByRole('button', { name: 'Remove seed' }))
    await waitFor(() => {
      expect(canvas.queryByText('./scripts/seed.sh')).toBeNull()
    })
    expect(args.onRemoveCommand).toHaveBeenCalledWith('seed')
  },
}

/**
 * Scenario « Catalogue vide » of `specs/agent-tools/spec.md`: no command, and the page says why
 * the agent's `commands_run` would be refused.
 */
export const NoCommandDeclared: Story = {
  args: { commands: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/No command is declared/)).toBeInTheDocument()
    expect(canvas.queryByText('pnpm check')).toBeNull()
  },
}

/** Adding one, and the refusal when the engine will not have it. */
export const ACommandIsAdded: Story = {
  args: { commandRefusal: 'a command named "check" is already declared' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('textbox', { name: 'Command name' }), 'check')
    await userEvent.type(canvas.getByRole('textbox', { name: 'Default line' }), 'pnpm check')
    await userEvent.click(canvas.getByRole('button', { name: 'Add a command' }))

    // The refusal lands under the folder field, and what was typed stays: a refusal is not a
    // reason to throw the line away.
    await waitFor(() => {
      expect(canvas.getByText(/already declared/)).toHaveStyle({ opacity: '1' })
    })
    expect(canvas.getByRole('textbox', { name: 'Default line' })).toHaveValue('pnpm check')
  },
}

/**
 * Scenario « Dossier du projet » of `specs/agent-tools/spec.md`: a command runs in a folder of
 * the Project, and the folders it already holds are offered rather than asked for.
 */
export const CommandFolderIsARepository: Story = {
  play: async ({ canvasElement, args }) => {
    args.onAddCommand?.mockClear()
    const canvas = within(canvasElement)

    await userEvent.type(canvas.getByRole('textbox', { name: 'Command name' }), 'test')
    await userEvent.type(canvas.getByRole('textbox', { name: 'Default line' }), 'pnpm test')
    const folder = canvas.getByRole('textbox', { name: 'Command folder' })
    await userEvent.type(folder, 'sou')

    // The folders the Project already holds are offered rather than asked for, and the popover is
    // drawn outside the story's canvas: it is read where it lands.
    await waitFor(() => {
      expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0)
    })
    const offered = document.querySelectorAll('[role="option"]')[0]
    expect(offered?.textContent).toBe('./sources/api')
    await userEvent.keyboard('{Enter}')
    expect(folder).toHaveValue('./sources/api')

    await userEvent.click(canvas.getByRole('button', { name: 'Add a command' }))
    await waitFor(() => {
      expect(args.onAddCommand).toHaveBeenCalledWith({
        id: 'test',
        name: 'test',
        command: 'pnpm test',
        ...PLAIN,
        type: 'script',
        folder: './sources/api',
      })
    })
  },
}

/**
 * Scenario « The catalogue is edited and read »: a command of the catalogue is edited in place.
 * Its name is what it is found by, so the name stays and the lines, the type and the folder are
 * rewritten.
 */
export const ACommandIsEdited: Story = {
  play: async ({ canvasElement, args }) => {
    args.onUpdateCommand?.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Edit dev' }))
    const name = canvas.getByRole('textbox', { name: 'Command name' })
    expect(name).toHaveValue('dev')
    expect(name).toBeDisabled()
    const line = canvas.getByRole('textbox', { name: 'Default line' })
    expect(line).toHaveValue('pnpm dev')
    await userEvent.clear(line)
    await userEvent.type(line, 'pnpm dev --host')
    await userEvent.click(canvas.getByRole('button', { name: 'Save dev' }))

    await waitFor(() => {
      expect(args.onUpdateCommand).toHaveBeenCalledWith({
        id: 'dev',
        name: 'dev',
        command: 'pnpm dev --host',
        ...PLAIN,
        type: 'serve',
        folder: './sources/front',
      })
    })
    expect(canvas.getByText('pnpm dev --host')).toBeInTheDocument()
    // The form is back to adding one.
    expect(canvas.getByRole('button', { name: 'Add a command' })).toBeInTheDocument()
  },
}

/**
 * The seven types, each with its fixed icon and word, and a command whose Windows line is its
 * own (D8-07).
 */
async function theMachineRunsItsOwnVariant({ canvasElement }: StoryContext): Promise<void> {
  // "The machine runs its own variant"
  const canvas = within(canvasElement)
  // SAFETY: the default line of `seed` is drawn on its own row of the catalogue, which is a list
  // item; the lookups below fail loudly if it ever is not.
  const row = canvas.getByText('./scripts/seed.sh').closest('li') as HTMLElement
  const seed = within(row)
  // The badge names the system and carries the line it runs there, beside the default one.
  const windows = seed.getByText('Windows')
  await expect(windows.closest('[title]')).toHaveAttribute('title', 'scripts\\seed.cmd')
  await expect(seed.getByText(': scripts\\seed.cmd')).toBeInTheDocument()
  await expect(seed.getByText('./scripts/seed.sh')).toBeVisible()
  // No Linux line is set, so Linux runs the default and no badge says otherwise.
  await expect(seed.queryByText('Linux')).toBeNull()
  // Every type of the catalogue is drawn with its word.
  const drawn = Object.values(COMMAND_TYPE_LABELS).filter(
    (word) => canvas.queryAllByText(word, { exact: true }).length > 0,
  )
  await expect(drawn).toEqual(Object.values(COMMAND_TYPE_LABELS))
  // The shared server says it is the Project's and goes through Portless.
  await expect(canvas.getByText('Project, in main')).toBeVisible()
  await expect(canvas.getByText('Portless')).toBeVisible()
}

export const CommandTypes: Story = {
  play: theMachineRunsItsOwnVariant,
}

/** A scope and Portless are a `serve`'s alone: the form offers them for that type only. */
export const ServeScope: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Scope')).toBeNull()
    await expect(canvas.queryByRole('checkbox', { name: 'Serve through Portless' })).toBeNull()

    await choose(canvasElement, 'Type', /^Serve/)
    await waitFor(() => {
      expect(canvas.getByLabelText('Scope')).toBeInTheDocument()
    })
    await expect(canvas.getByRole('checkbox', { name: 'Serve through Portless' })).not.toBeChecked()

    await choose(canvasElement, 'Type', /^Test/)
    await waitFor(() => {
      expect(canvas.queryByLabelText('Scope')).toBeNull()
    })
    await expect(canvas.queryByRole('checkbox', { name: 'Serve through Portless' })).toBeNull()
  },
}

/** Each repository says whether a dedicated Workspace takes it by default (D8-04). */
export const RepositoriesDefault: Story = {
  play: async ({ canvasElement, args }) => {
    args.onToggleIncluded?.mockClear()
    const canvas = within(canvasElement)
    const api = canvas.getByRole('checkbox', {
      name: 'In every Workspace by default for ./sources/api',
    })
    await expect(api).toBeChecked()
    await expect(
      canvas.getByRole('checkbox', { name: 'In every Workspace by default for ./docs' }),
    ).not.toBeChecked()

    await userEvent.click(api)
    await expect(args.onToggleIncluded).toHaveBeenCalledWith('./sources/api', false)
    await waitFor(() => {
      expect(api).not.toBeChecked()
    })
  },
}

/** Where dedicated Workspaces go and what their branches are called, saved with the page. */
export const DedicatedWorkspaces: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSave.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Workspaces folder' })).toHaveValue('')
    const prefix = canvas.getByRole('textbox', { name: 'Branch prefix' })
    // Empty, the prefix is the Project's slug, and the description says what a branch becomes.
    await expect(prefix).toHaveAttribute('placeholder', 'atlas')
    await expect(canvas.getByText('Dedicated branches are atlas/<KEY>-<slug>.')).toBeVisible()

    await userEvent.type(prefix, 'kris')
    await expect(canvas.getByText('Dedicated branches are kris/<KEY>-<slug>.')).toBeVisible()
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSave).toHaveBeenCalledWith({ ...ATLAS, branchPrefix: 'kris' })
    })
  },
}
