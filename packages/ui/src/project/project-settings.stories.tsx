import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { VariablesEditor } from '../workspace/variables-editor.tsx'
import { WorkspaceList } from '../workspace/workspace-list.tsx'
import type { CommandLine, ProjectSettingsDraft, RepositoryLine } from './model.ts'
import { PreparationEditor } from './preparation-editor.tsx'
import { ProjectSettings, type ProjectSettingsProps } from './project-settings.tsx'

/**
 * The settings of one Project, on fixtures (design D4-07, recette 1 of lot 20).
 *
 * A navigation on the left and one section at a time; one story per section, opened on it, and
 * the states the page has beyond them. What a name and a path are allowed to be is the domain's
 * rule, and the panel stands in for it: `saveRefusal`, `repositoryRefusal` and `commandRefusal`
 * are what the engine would have answered.
 *
 * The Workspaces, the preparation and the variables are composed by the caller: the stories hand
 * in the blocks the application hands in, with their own fixtures.
 */
const ATLAS: ProjectSettingsDraft = {
  name: 'Atlas',
  tone: 'primary',
  mainPath: '/home/someone/Projects/atlas',
  workspacesRoot: null,
  branchPrefix: null,
  specPrefix: 'ATL',
}

const REPOSITORIES: RepositoryLine[] = [
  { path: './sources/api', branch: 'main', exists: true, includedByDefault: true, icon: 'server' },
  {
    path: './sources/front',
    branch: 'develop',
    exists: true,
    includedByDefault: true,
    icon: 'browser',
  },
  { path: './docs', branch: null, exists: true, includedByDefault: false, icon: null },
  { path: './sources/mobile', branch: null, exists: false, includedByDefault: false, icon: null },
]

/** What a command of the catalogue is unless a fixture says otherwise. */
const PLAIN = {
  lineWindows: null,
  lineLinux: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  folder: '',
} as const

/**
 * The catalogue of a Project that has one command of each of the seven types (D8-07): `dev` in
 * the front, `check` at the root, an `auth` server shared by the Project and run through
 * Portless, and a `seed` whose Windows line is its own.
 */
const COMMANDS: CommandLine[] = [
  { ...PLAIN, id: 'check', name: 'check', command: 'pnpm check', type: 'test', folderBase: null },
  {
    ...PLAIN,
    id: 'dev',
    name: 'dev',
    command: 'pnpm dev',
    type: 'serve',
    folderBase: './sources/front',
  },
  {
    ...PLAIN,
    id: 'auth',
    name: 'auth',
    command: 'pnpm auth:serve',
    type: 'serve',
    scope: 'project',
    portless: true,
    portlessName: 'atlas',
    folderBase: './sources/api',
  },
  { ...PLAIN, id: 'lint', name: 'lint', command: 'pnpm lint', type: 'lint', folderBase: null },
  {
    ...PLAIN,
    id: 'build',
    name: 'build',
    command: 'pnpm build',
    type: 'build',
    folderBase: './sources/api',
  },
  {
    ...PLAIN,
    id: 'env',
    name: 'env',
    command: 'pnpm env:configure',
    type: 'configure',
    folderBase: './sources/api',
  },
  {
    ...PLAIN,
    id: 'inspect',
    name: 'inspect',
    command: 'node --inspect dist/main.js',
    type: 'debug',
    folderBase: './sources/api',
    folder: 'dist',
  },
  {
    ...PLAIN,
    id: 'seed',
    name: 'seed',
    command: './scripts/seed.sh',
    lineWindows: 'scripts\\seed.cmd',
    type: 'script',
    folderBase: './sources/api',
  },
]

/** What the disk holds under the root: the declared paths, and folders not declared yet. */
const FOLDERS: RepositoryLine[] = [
  ...REPOSITORIES,
  { path: './sources/worker', branch: 'main', exists: true, includedByDefault: true, icon: null },
  { path: './scripts', branch: null, exists: true, includedByDefault: true, icon: null },
]

/** The Workspaces section as the application composes it: the list of the Project's. */
const WORKSPACES = (
  <WorkspaceList
    workspaces={[
      {
        id: 'main',
        name: 'main',
        path: ATLAS.mainPath,
        state: 'ready',
        main: true,
        dedicated: false,
      },
      {
        id: 'login-form',
        name: 'login-form',
        path: '/home/someone/.local/share/hemera/workspaces/atlas/login-form',
        state: 'ready',
        main: false,
        dedicated: true,
      },
    ]}
    onBrowse={fn(async () => await Promise.resolve(null))}
    onCreate={fn(async () => await Promise.resolve(null))}
    onCleanup={fn()}
  />
)

/** The Preparation section: the recipe every dedicated Workspace replays (D8-05). */
const PREPARATION = (
  <PreparationEditor
    steps={[
      { id: 'copy-env', kind: 'copy', path: '.env', scope: 'repositories' },
      { id: 'link-claude', kind: 'link', path: 'CLAUDE.md', scope: 'root' },
      { id: 'run-env', kind: 'run', commandName: 'env' },
    ]}
    commands={[
      { id: 'env', name: 'env', type: 'configure' },
      { id: 'check', name: 'check', type: 'test' },
    ]}
    onAdd={fn(async () => await Promise.resolve(null))}
    onRemove={fn()}
    onMove={fn()}
  />
)

/** The Variables section: the Project's own (D8-06). */
const VARIABLES = (
  <VariablesEditor
    scope="project"
    name="Atlas"
    variables={[
      { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas' },
      { key: 'PORT', value: '3000' },
    ]}
    onSet={fn(async () => await Promise.resolve(null))}
    onRemove={fn()}
  />
)

interface Extra {
  /** What saving answers: nothing, or the refusal the engine sent back. */
  saveRefusal?: string | null
  /** What adding or editing a repository answers: nothing, or the domain's refusal. */
  repositoryRefusal?: string | null
  /** What adding or editing a command answers: nothing, or the engine's refusal. */
  commandRefusal?: string | null
}

/**
 * The page holds the Project, its repositories and its catalogue; the panel decides what the
 * engine answers. Written out rather than hidden in a harness, because it is exactly what the
 * application does with the same component: keep what came back, hand it in again.
 */
function Controlled({
  project,
  repositories,
  saveRefusal = null,
  repositoryRefusal = null,
  commandRefusal = null,
  onSave,
  onAddRepository,
  onUpdateRepository,
  onRemoveRepository,
  onAddCommand,
  onUpdateCommand,
  onRemoveCommand,
  ...rest
}: ProjectSettingsProps & Extra) {
  const [kept, setKept] = useState(project)
  const [lines, setLines] = useState(repositories)
  const [catalogue, setCatalogue] = useState(rest.commands ?? [])
  return (
    <div className="mx-auto flex max-w-5xl flex-col p-6">
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
          if (repositoryRefusal !== null) return repositoryRefusal
          setLines((now) => [
            ...now,
            { path, branch: null, exists: false, includedByDefault: true, icon: null },
          ])
          return null
        }}
        onUpdateRepository={async (path, next) => {
          await onUpdateRepository(path, next)
          if (repositoryRefusal !== null) return repositoryRefusal
          setLines((now) =>
            now.map((one) =>
              one.path === path
                ? {
                    path: next.path,
                    branch: one.branch,
                    exists: one.exists,
                    includedByDefault: next.includedByDefault,
                    icon: next.icon,
                  }
                : one,
            ),
          )
          return null
        }}
        onRemoveRepository={(path) => {
          onRemoveRepository(path)
          setLines((now) => now.filter((one) => one.path !== path))
        }}
        commands={catalogue}
        onAddCommand={async (command) => {
          await onAddCommand?.(command)
          if (commandRefusal !== null) return commandRefusal
          setCatalogue((now) => [...now, command])
          return null
        }}
        onUpdateCommand={async (command) => {
          await onUpdateCommand?.(command)
          if (commandRefusal !== null) return commandRefusal
          setCatalogue((now) => now.map((one) => (one.name === command.name ? command : one)))
          return null
        }}
        onRemoveCommand={(id) => {
          onRemoveCommand?.(id)
          setCatalogue((now) => now.filter((one) => one.id !== id))
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
    repositoryRefusal: null,
    commandRefusal: null,
    commands: COMMANDS,
    portlessInstalled: true,
    workspaces: WORKSPACES,
    preparation: PREPARATION,
    variables: VARIABLES,
    slotRefusal: null,
    onSave: fn(async () => await Promise.resolve(null)),
    onAddCommand: fn(async () => await Promise.resolve(null)),
    onUpdateCommand: fn(async () => await Promise.resolve(null)),
    onRemoveCommand: fn(),
    onBrowse: fn(async () => await Promise.resolve('/home/someone/Projects/atlas-2')),
    onAddRepository: fn(async () => await Promise.resolve(null)),
    onUpdateRepository: fn(async () => await Promise.resolve(null)),
    onRemoveRepository: fn(),
    onArchive: fn(),
    onSectionChange: fn(),
  },
  argTypes: {
    project: { control: 'object', description: 'What the Project is right now.' },
    subtitle: { control: 'text', description: 'A line under the title of the page.' },
    repositories: { control: 'object', description: 'The declared paths and what the disk says.' },
    folders: {
      control: 'object',
      description: 'The folders of the Workspace, offered to fill in.',
    },
    saveRefusal: { control: 'text', description: 'What saving answers; null accepts the change.' },
    repositoryRefusal: {
      control: 'text',
      description: 'What adding or editing a repository answers; null accepts it.',
    },
    commands: { control: 'object', description: 'The commands this Project may run.' },
    commandRefusal: {
      control: 'text',
      description: 'What adding or editing a command answers; null accepts it.',
    },
    portlessInstalled: {
      control: 'boolean',
      description: 'Whether portless is on this machine, which offers it on a server.',
    },
    workspaces: { control: false, description: 'The Workspaces section, composed by the caller.' },
    preparation: {
      control: false,
      description: 'The Preparation section, composed by the caller.',
    },
    variables: { control: false, description: 'The Variables section, composed by the caller.' },
    slotRefusal: {
      control: 'text',
      description: 'What the engine last refused about the three composed sections.',
    },
    defaultSection: {
      control: 'select',
      options: ['general', 'repositories', 'workspaces', 'commands', 'preparation', 'variables'],
      description: 'The section shown first.',
    },
    section: { control: false, description: 'The section shown, for a caller that keeps it.' },
    onSectionChange: { action: 'section chosen' },
    onSave: { action: 'saved' },
    onAddCommand: { action: 'command added' },
    onUpdateCommand: { action: 'command updated' },
    onRemoveCommand: { action: 'command removed' },
    onBrowse: { action: 'folder picked' },
    onAddRepository: { action: 'repository added' },
    onUpdateRepository: { action: 'repository updated' },
    onRemoveRepository: { action: 'repository removed' },
    onArchive: { action: 'archived' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

/** The section shown: the one panel of the page. */
function panelOf(canvasElement: HTMLElement) {
  return within(within(canvasElement).getByRole('tabpanel'))
}

function dialog() {
  return within(within(document.body).getByRole('dialog'))
}

/** The row of a list that holds the text given, found by the list item it sits in. */
function rowOf(canvasElement: HTMLElement, text: string) {
  return within(within(canvasElement).getByText(text).closest('li')!)
}

/**
 * Everything in place, on General: the navigation of six sections, the form, its button, the
 * archive at the bottom.
 */
export const Complete: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('tablist', { name: 'Project settings' })
    await expect(
      within(nav)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['General', 'Repositories', 'Workspaces', 'Commands', 'Preparation', 'Variables'])
    await expect(canvas.getByRole('tab', { name: 'General' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // One section on screen at a time.
    await expect(canvas.getAllByRole('tabpanel')).toHaveLength(1)
    await expect(canvas.getByRole('button', { name: 'Saved' })).toBeDisabled()
  },
}

/**
 * General: the identity and the prefix of the Spec keys, the folder of main, where dedicated
 * Workspaces go and their branch prefix, saved by the one button under them, and the archive at
 * the bottom (scenario « Édition durable » of `specs/project-workspaces/spec.md`, as far as a
 * page goes).
 */
export const General: Story = {
  args: { defaultSection: 'general' },
  play: async ({ canvasElement, args }) => {
    args.onSave.mockClear()
    const panel = panelOf(canvasElement)
    await expect(panel.getByRole('textbox', { name: 'Spec prefix' })).toHaveValue('ATL')
    await expect(panel.getByRole('textbox', { name: 'Workspaces folder' })).toHaveValue('')
    const prefix = panel.getByRole('textbox', { name: 'Branch prefix' })
    await expect(prefix).toHaveAttribute('placeholder', 'atlas')
    await expect(panel.getByText('Dedicated branches are atlas/<KEY>-<slug>.')).toBeVisible()

    const name = panel.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Atlas II')
    await userEvent.type(prefix, 'kris')
    await waitFor(() => {
      expect(panel.getByRole('button', { name: 'Save' })).toBeEnabled()
    })
    await userEvent.click(panel.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSave).toHaveBeenCalledWith({ ...ATLAS, name: 'Atlas II', branchPrefix: 'kris' })
    })
    // Once it is saved, the page is on what it saved, and there is nothing left to do.
    await waitFor(() => {
      expect(panel.getByRole('button', { name: 'Saved' })).toBeDisabled()
    })
    // The archive is the last thing of the section.
    await expect(panel.getByRole('button', { name: 'Archive Atlas II' })).toBeVisible()
  },
}

/**
 * The prefix of the Spec keys (lot 19, Decided 2), in General with the identity: refused while it
 * is not 2 to 4 capital letters, and saved with the rest of the section once it is.
 */
export const SpecPrefix: Story = {
  args: { defaultSection: 'general' },
  play: async ({ canvasElement, args }) => {
    args.onSave.mockClear()
    const panel = panelOf(canvasElement)
    const prefix = panel.getByRole('textbox', { name: 'Spec prefix' })
    await expect(prefix).toHaveValue('ATL')

    await userEvent.clear(prefix)
    await userEvent.type(prefix, 'at1')
    await waitFor(() => {
      expect(panel.getByText('A prefix is 2 to 4 capital letters, A to Z.')).toBeVisible()
    })

    await userEvent.clear(prefix)
    await userEvent.type(prefix, 'ATX')
    // Gone before anything else is read: the check of the page's contrast would otherwise read
    // the message halfway through fading out.
    await waitFor(() => {
      expect(panel.queryByText('A prefix is 2 to 4 capital letters, A to Z.')).toBeNull()
    })
    await userEvent.click(panel.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSave).toHaveBeenCalledWith({ ...ATLAS, specPrefix: 'ATX' })
    })
  },
}

/** Scenario « Version périmée » of `specs/project-workspaces/spec.md`, as the eye sees it. */
export const StaleVersion: Story = {
  args: { saveRefusal: 'the Project changed somewhere else; reopen it and try again' },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    const name = panel.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Atlas II')
    await userEvent.click(panel.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(panel.getByRole('alert')).toHaveTextContent('changed somewhere else')
    })
    // What was typed stays: a refusal is not a reason to throw the edit away.
    await expect(name).toHaveValue('Atlas II')
    await waitFor(() => {
      expect(panel.getByRole('button', { name: 'Save' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/** Scenario « Archivé puis restauré » of `specs/project-workspaces/spec.md`, its first half. */
export const Archiving: Story = {
  play: async ({ canvasElement, args }) => {
    args.onArchive.mockClear()
    const panel = panelOf(canvasElement)
    await expect(panel.queryByRole('button', { name: /Delete/ })).toBeNull()
    // It asks first: the button opens the question, and the question is what archives it.
    await userEvent.click(panel.getByRole('button', { name: `Archive ${ATLAS.name}` }))
    const asking = within(document.body).getByRole('dialog')
    await expect(args.onArchive).not.toHaveBeenCalled()
    await userEvent.click(within(asking).getByRole('button', { name: 'Archive it' }))
    await expect(args.onArchive).toHaveBeenCalled()
  },
}

/**
 * Repositories: each row its icon, its path, its branch or a quiet word, and one mark when a new
 * Workspace takes it (scenario « Branche lue à l'affichage » of
 * `specs/project-workspaces/spec.md`); its pencil opens its dialog.
 */
export const Repositories: Story = {
  args: { defaultSection: 'repositories' },
  play: async ({ canvasElement, args }) => {
    args.onUpdateRepository.mockClear()
    const panel = panelOf(canvasElement)
    await expect(panel.getByText('git · main')).toBeVisible()
    await expect(panel.getByText('git · develop')).toBeVisible()
    await expect(panel.getByText('not a Git repository')).toBeVisible()
    await expect(panel.getByText('not there yet')).toBeVisible()
    // One quiet mark says a new Workspace takes it, and no box is ticked on a row.
    await expect(panel.queryByRole('checkbox')).toBeNull()
    await expect(
      panel.getByRole('img', { name: './sources/api is in every new Workspace' }),
    ).toBeVisible()
    await expect(panel.queryByRole('img', { name: './docs is in every new Workspace' })).toBeNull()

    await userEvent.click(panel.getByRole('button', { name: 'Edit ./docs' }))
    const inside = dialog()
    await userEvent.click(inside.getByRole('radio', { name: 'Book' }))
    await userEvent.click(inside.getByRole('checkbox', { name: /Include in every new Workspace/ }))
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onUpdateRepository).toHaveBeenCalledWith('./docs', {
        path: './docs',
        icon: 'book',
        includedByDefault: true,
      })
    })
    await waitFor(() => {
      expect(panel.getByRole('img', { name: './docs is in every new Workspace' })).toBeVisible()
    })
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Adding one in its dialog and removing one from its row, which is what the list does. */
export const RepositoriesComeAndGo: Story = {
  args: { defaultSection: 'repositories' },
  play: async ({ canvasElement, args }) => {
    args.onAddRepository.mockClear()
    args.onRemoveRepository.mockClear()
    const panel = panelOf(canvasElement)

    await userEvent.click(panel.getByRole('button', { name: 'Add repository' }))
    const inside = dialog()
    await userEvent.type(inside.getByRole('textbox', { name: 'Path' }), './sources/worker')
    await userEvent.click(inside.getByRole('button', { name: 'Add repository' }))
    await waitFor(() => {
      expect(panel.getByText('./sources/worker')).toBeVisible()
    })
    await expect(args.onAddRepository).toHaveBeenCalledWith('./sources/worker')

    await userEvent.click(panel.getByRole('button', { name: 'Remove ./docs' }))
    await waitFor(() => {
      expect(panel.queryByText('./docs')).toBeNull()
    })
    await expect(args.onRemoveRepository).toHaveBeenCalledWith('./docs')
  },
}

/** Scenario « Liste vide » of `specs/project-workspaces/spec.md`. */
export const NoRepositoryDeclared: Story = {
  args: { defaultSection: 'repositories', repositories: [] },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByText(/the root is used as it is/)).toBeVisible()
    // Nothing is offered that would create anything.
    await expect(panel.queryByRole('button', { name: /Initialise/ })).toBeNull()
  },
}

/**
 * Commands: each row its name, its line, and its badges together at its end (scenario
 * « Catalogue du projet » of `specs/agent-tools/spec.md`); the pencil opens its dialog.
 */
export const Commands: Story = {
  args: { defaultSection: 'commands' },
  play: async ({ canvasElement, args }) => {
    args.onUpdateCommand?.mockClear()
    const panel = panelOf(canvasElement)
    const auth = rowOf(canvasElement, 'pnpm auth:serve')
    await expect(auth.getByText('Serve')).toBeVisible()
    await expect(auth.getByText('Project, in main')).toBeVisible()
    await expect(auth.getByText('Portless')).toBeVisible()
    await expect(auth.getByText('api')).toBeVisible()
    await expect(rowOf(canvasElement, 'pnpm check').getByText('Workspace root')).toBeVisible()
    // The line of another system is the dialog's, not the row's.
    await expect(panel.queryByText('scripts\\seed.cmd')).toBeNull()

    await userEvent.click(panel.getByRole('button', { name: 'Edit dev' }))
    const inside = dialog()
    const line = inside.getByRole('textbox', { name: 'Default line' })
    await userEvent.clear(line)
    await userEvent.type(line, 'pnpm dev --host')
    await userEvent.click(inside.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onUpdateCommand).toHaveBeenCalledWith({
        ...COMMANDS[1],
        command: 'pnpm dev --host',
      })
    })
    await waitFor(() => {
      expect(panel.getByText('pnpm dev --host')).toBeVisible()
    })
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Adding one, and the refusal the dialog keeps open on when the engine will not have it. */
export const ACommandIsAdded: Story = {
  args: {
    defaultSection: 'commands',
    commandRefusal: 'a command named "check" is already declared',
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(panelOf(canvasElement).getByRole('button', { name: 'Add command' }))
    const inside = dialog()
    await userEvent.type(inside.getByRole('textbox', { name: 'Name' }), 'check')
    await userEvent.type(inside.getByRole('textbox', { name: 'Default line' }), 'pnpm check')
    await userEvent.click(inside.getByRole('button', { name: 'Add command' }))
    await waitFor(() => {
      expect(inside.getByRole('alert')).toHaveTextContent('already declared')
    })
    await expect(inside.getByRole('textbox', { name: 'Default line' })).toHaveValue('pnpm check')
    await waitFor(() => {
      expect(inside.getByRole('button', { name: 'Add command' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/**
 * Scenario « Catalogue vide » of `specs/agent-tools/spec.md`: no command, and the page says why
 * the agent's `commands_run` would be refused.
 */
export const NoCommandDeclared: Story = {
  args: { defaultSection: 'commands', commands: [] },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByText(/No command is declared/)).toBeVisible()
    await expect(panel.queryByText('pnpm check')).toBeNull()
  },
}

/** Workspaces: the list the caller composes, drawn as it is handed. */
export const Workspaces: Story = {
  args: { defaultSection: 'workspaces' },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByRole('list', { name: 'Workspaces' })).toBeVisible()
    await expect(panel.getByText('login-form')).toBeVisible()
  },
}

/** Preparation: the recipe the caller composes, drawn as it is handed. */
export const Preparation: Story = {
  args: { defaultSection: 'preparation' },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByText('copy .env in each repository')).toBeVisible()
  },
}

/** Variables: the Project's own, composed by the caller. */
export const Variables: Story = {
  args: { defaultSection: 'variables' },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByText('DATABASE_URL')).toBeVisible()
  },
}

/** What the engine refused about a composed section, said at its top, as it said it. */
export const Refused: Story = {
  args: {
    defaultSection: 'workspaces',
    slotRefusal: 'the Workspaces of Atlas could not be read: the engine is not answering',
  },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    await expect(panel.getByRole('alert')).toHaveTextContent('the engine is not answering')
    await expect(panel.getByRole('list', { name: 'Workspaces' })).toBeVisible()
  },
}

/**
 * The navigation with the keyboard: one stop, the arrows walk it and show each section, Tab
 * goes on into the section; a dialog opened from a row gives the focus back to its pencil.
 */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSectionChange?.mockClear()
    const canvas = within(canvasElement)
    const general = canvas.getByRole('tab', { name: 'General' })
    general.focus()
    await userEvent.keyboard('{ArrowDown}')
    const repositories = canvas.getByRole('tab', { name: 'Repositories' })
    await expect(repositories).toHaveFocus()
    await expect(repositories).toHaveAttribute('aria-selected', 'true')
    await expect(args.onSectionChange).toHaveBeenCalledWith('repositories')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await expect(canvas.getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // Tab leaves the navigation for the first control of the section.
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Add command' })).toHaveFocus()

    const pencil = canvas.getByRole('button', { name: 'Edit check' })
    pencil.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeVisible()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await expect(pencil).toHaveFocus()
    // The section chosen stays chosen.
    await expect(canvas.getByRole('tab', { name: 'Commands' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}
