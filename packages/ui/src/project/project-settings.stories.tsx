import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import type { ProjectDraft, RepositoryLine } from './model.ts'
import { ProjectSettings, type ProjectSettingsProps } from './project-settings.tsx'

/**
 * The settings of one Project, on fixtures (design D4-07).
 *
 * What a name and a path are allowed to be is the domain's rule, and the panel stands in for
 * it: `saveRefusal` and `addRefusal` are what the engine would have answered. What is under
 * test here is the page — what it shows, what it saves, and what it does with a refusal.
 */
const ATLAS: ProjectDraft = {
  name: 'Atlas',
  tone: 'primary',
  mainPath: '/home/someone/Projects/atlas',
}

const REPOSITORIES: RepositoryLine[] = [
  { path: './sources/api', branch: 'main', exists: true },
  { path: './sources/front', branch: 'develop', exists: true },
  { path: './docs', branch: null, exists: true },
]

interface Extra {
  /** What saving answers: nothing, or the refusal the engine sent back. */
  saveRefusal?: string | null
  /** What adding a path answers: nothing, or the refusal the domain sent back. */
  addRefusal?: string | null
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
  onSave,
  onAddRepository,
  onRemoveRepository,
  ...rest
}: ProjectSettingsProps & Extra) {
  const [kept, setKept] = useState(project)
  const [lines, setLines] = useState(repositories)
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
          setLines([...lines, { path, branch: null, exists: false }])
          return null
        }}
        onRemoveRepository={(path) => {
          onRemoveRepository(path)
          setLines(lines.filter((one) => one.path !== path))
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Project/Settings',
  component: ProjectSettings,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    project: ATLAS,
    subtitle: 'Atlas · created 12 days ago',
    repositories: REPOSITORIES,
    saveRefusal: null,
    addRefusal: null,
    onSave: fn(async () => await Promise.resolve(null)),
    onBrowse: fn(async () => await Promise.resolve('/home/someone/Projects/atlas-2')),
    onAddRepository: fn(async () => await Promise.resolve(null)),
    onRemoveRepository: fn(),
    onArchive: fn(),
  },
  argTypes: {
    project: { control: 'object', description: 'What the Project is right now.' },
    subtitle: { control: 'text', description: 'A line under the title of the page.' },
    repositories: { control: 'object', description: 'The declared paths and what the disk says.' },
    saveRefusal: {
      control: 'text',
      description: 'What saving answers; null accepts the change.',
    },
    addRefusal: {
      control: 'text',
      description: 'What adding a path answers; null accepts it.',
    },
    onSave: { action: 'saved' },
    onBrowse: { action: 'folder picked' },
    onAddRepository: { action: 'repository added' },
    onRemoveRepository: { action: 'repository removed' },
    onArchive: { action: 'archived' },
  },
} satisfies Meta<typeof Controlled>

export default meta
type Story = StoryObj<typeof meta>

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
    expect(canvas.getAllByRole('listitem')).toHaveLength(REPOSITORIES.length)
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
