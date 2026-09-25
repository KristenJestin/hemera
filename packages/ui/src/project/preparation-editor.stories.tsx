import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  PreparationEditor,
  type PreparationEditorProps,
  type RecipeCommand,
  type RecipeStepLine,
} from './preparation-editor.tsx'

/**
 * The preparation of a Project, on fixtures (D8-05).
 *
 * A Project of two repositories, `./sources/api` and `./sources/web`, whose recipe copies the
 * api's `.env`, links the web's `node_modules`, links `CLAUDE.md` at the root, and runs
 * `install`. The story holds the recipe the way the application will — a move, a removal, an
 * addition and an edit change the list it hands back — so the order can be tried by hand, with
 * the keyboard, in both themes.
 */
const REPOSITORIES = ['./sources/api', './sources/web']

const STEPS: RecipeStepLine[] = [
  { id: 'copy-env', kind: 'copy', base: './sources/api', path: '.env', commandId: null },
  {
    id: 'link-modules',
    kind: 'link',
    base: './sources/web',
    path: 'node_modules',
    commandId: null,
  },
  { id: 'link-claude', kind: 'link', base: null, path: 'CLAUDE.md', commandId: null },
  { id: 'run-install', kind: 'run', base: null, path: null, commandId: 'install' },
]

/** The Project's catalogue, which is what a `run` step may start. */
const COMMANDS: RecipeCommand[] = [
  { id: 'install', name: 'install', type: 'configure' },
  { id: 'dev', name: 'dev', type: 'serve' },
  { id: 'check', name: 'check', type: 'test' },
]

/** What the engine answers for a source that is not in `main`. */
const MISSING = '.env.local does not exist in main at sources/api.'

/** The recipe as the application keeps it: the card says what changed, the page applies it. */
function Controlled({ steps, onAdd, onUpdate, onRemove, onMove, ...rest }: PreparationEditorProps) {
  const [recipe, setRecipe] = useState(steps)
  return (
    <div className="mx-auto flex max-w-3xl flex-col p-6">
      <PreparationEditor
        {...rest}
        steps={recipe}
        onAdd={async (step) => {
          const said = await onAdd(step)
          if (said !== null) return said
          setRecipe([...recipe, { id: `${step.kind}-${String(recipe.length)}`, ...step }])
          return null
        }}
        onUpdate={async (id, step) => {
          const said = await onUpdate(id, step)
          if (said !== null) return said
          setRecipe(recipe.map((one) => (one.id === id ? { id, ...step } : one)))
          return null
        }}
        onRemove={(id) => {
          onRemove(id)
          setRecipe(recipe.filter((one) => one.id !== id))
        }}
        onMove={(id, direction) => {
          onMove(id, direction)
          const from = recipe.findIndex((one) => one.id === id)
          const to = direction === 'up' ? from - 1 : from + 1
          const moved = recipe.slice()
          const [taken] = moved.splice(from, 1)
          if (taken !== undefined) moved.splice(to, 0, taken)
          setRecipe(moved)
        }}
      />
    </div>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/PreparationEditor',
  component: PreparationEditor,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    steps: [],
    repositories: REPOSITORIES,
    commands: COMMANDS,
    onAdd: fn(async (): Promise<string | null> => await Promise.resolve(null)),
    onUpdate: fn(async () => await Promise.resolve(null)),
    onRemove: fn(),
    onMove: fn(),
  },
  argTypes: {
    steps: { control: 'object', description: 'The recipe, in the order it runs.' },
    repositories: {
      control: 'object',
      description: "The Project's repositories by path: the bases a copy or a link can take.",
    },
    commands: {
      control: 'object',
      description: "The Project's catalogue, which is what a run step may start.",
    },
    onAdd: {
      action: 'step added',
      description: "Adds a step at the end; answers the engine's refusal, or null.",
    },
    onUpdate: {
      action: 'step updated',
      description: "Rewrites a step where it stands; answers the engine's refusal, or null.",
    },
    onRemove: { action: 'step removed', description: 'Takes a step out of the recipe.' },
    onMove: { action: 'step moved', description: 'Moves a step one place up or down.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof PreparationEditor>

export default meta

type Story = StoryObj<typeof meta>

type StoryContext = Parameters<NonNullable<Story['play']>>[0]

/** The dialog on screen, once it is there. */
async function dialogShown() {
  return await waitFor(() => within(document.body).getByRole('dialog'))
}

/** Waits the dialog out: a popup still leaving is a popup the accessibility pass still reads. */
async function dialogGone() {
  await waitFor(() => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  })
}

/** Opens a select of the dialog by its name and chooses one of its items, then waits it out. */
async function choose(dialog: HTMLElement, label: string, option: RegExp): Promise<void> {
  await userEvent.click(within(dialog).getByLabelText(label))
  const list = await waitFor(() => within(document.body).getByRole('listbox'))
  await userEvent.click(within(list).getByRole('option', { name: option }))
  // Waited out: a popup still leaving carries focus guards the accessibility pass reads as an
  // error nobody can act on.
  await waitFor(() => {
    expect(within(document.body).queryByRole('listbox')).toBeNull()
  })
}

/** The sentences of the list, top to bottom. */
function sentencesIn(canvasElement: HTMLElement): (string | null)[] {
  return within(within(canvasElement).getByRole('list', { name: 'Steps' }))
    .getAllByRole('listitem')
    .map((row) => row.textContent)
}

/** No step: a Workspace is ready as soon as its worktrees are, and the card says so. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('No step: a Workspace is ready as soon as its worktrees are.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Add step' })).toBeEnabled()
  },
}

/** The four steps, read as sentences in the order they run, and one moved down. */
async function theStepsFollowTheRecipeInOrder({ canvasElement, args }: StoryContext) {
  // "The steps follow the recipe in order"
  args.onMove.mockClear()
  const canvas = within(canvasElement)
  await expect(sentencesIn(canvasElement)).toEqual([
    'copy .env from api',
    'link node_modules in web',
    'link CLAUDE.md at the root',
    'run install',
  ])
  // The first cannot go further up, the last further down.
  await expect(canvas.getByRole('button', { name: 'Move up: copy .env from api' })).toBeDisabled()
  await expect(canvas.getByRole('button', { name: 'Move down: run install' })).toBeDisabled()

  await userEvent.click(canvas.getByRole('button', { name: 'Move down: copy .env from api' }))
  await expect(args.onMove).toHaveBeenCalledWith('copy-env', 'down')
  await waitFor(() => {
    expect(sentencesIn(canvasElement)).toEqual([
      'link node_modules in web',
      'copy .env from api',
      'link CLAUDE.md at the root',
      'run install',
    ])
  })
}

export const Filled: Story = {
  args: { steps: STEPS },
  play: theStepsFollowTheRecipeInOrder,
}

/**
 * Add step: a path that leaves its base is refused before anybody is asked, and a `run` offers
 * the catalogue with each command's type.
 */
export const Adding: Story = {
  args: { steps: STEPS.slice(0, 3) },
  play: async ({ canvasElement, args }) => {
    args.onAdd.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add step' }))
    const shown = await dialogShown()
    const dialog = within(shown)
    await expect(dialog.getByRole('heading', { name: 'Add step' })).toBeInTheDocument()
    await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), '../secrets.env')
    await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(dialog.getByText('A path is relative to its base.')).toHaveStyle({ opacity: '1' })
    })
    await expect(args.onAdd).not.toHaveBeenCalled()

    await choose(shown, 'Step kind', /^Run a command/)
    await expect(dialog.queryByRole('textbox', { name: 'Path' })).toBeNull()
    await choose(shown, 'Command', /^install/)
    await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(args.onAdd).toHaveBeenCalledWith({
        kind: 'run',
        base: null,
        path: null,
        commandId: 'install',
      })
    })
    await dialogGone()
    await expect(canvas.getByText('run install')).toBeVisible()
  },
}

/**
 * A row's pencil: the same dialog, filled with the step. Two repositories that share a last
 * segment are told apart by their path.
 */
export const Editing: Story = {
  args: { steps: STEPS, repositories: [...REPOSITORIES, './legacy/api'] },
  play: async ({ canvasElement, args }) => {
    args.onUpdate.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'Edit: copy .env from api (./sources/api)' }),
    )
    const shown = await dialogShown()
    const dialog = within(shown)
    await expect(dialog.getByRole('heading', { name: 'Edit step' })).toBeInTheDocument()
    await expect(dialog.getByLabelText('Base')).toHaveTextContent('api (./sources/api)')
    const path = dialog.getByRole('textbox', { name: 'Path' })
    await expect(path).toHaveValue('.env')
    await userEvent.clear(path)
    await userEvent.type(path, '.env.local')
    await choose(shown, 'Base', /^web$/)
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onUpdate).toHaveBeenCalledWith('copy-env', {
        kind: 'copy',
        base: './sources/web',
        path: '.env.local',
        commandId: null,
      })
    })
    await dialogGone()
    await expect(sentencesIn(canvasElement)[0]).toBe('copy .env.local from web')
  },
}

// Scenario "A copy never overwrites and skips a missing source", as the recipe is written: the
// dialog checks that the source exists in main before it accepts the step.
async function aSourceMissingInMainIsRefused({ canvasElement, args }: StoryContext) {
  args.onAdd.mockClear()
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Add step' }))
  const shown = await dialogShown()
  const dialog = within(shown)
  await choose(shown, 'Base', /^api$/)
  await userEvent.type(dialog.getByRole('textbox', { name: 'Path' }), '.env.local')
  await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
  await waitFor(() => {
    expect(args.onAdd).toHaveBeenCalledWith({
      kind: 'copy',
      base: './sources/api',
      path: '.env.local',
      commandId: null,
    })
  })
  // The refusal is the engine's sentence, and the dialog stays open on what was typed.
  await waitFor(() => {
    expect(dialog.getByRole('alert')).toHaveTextContent(MISSING)
  })
  await expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
  await expect(dialog.getByRole('textbox', { name: 'Path' })).toHaveValue('.env.local')
  await expect(canvas.queryByRole('list')).toBeNull()
  // The button comes back from its own quiet before the colours are judged.
  await waitFor(() => {
    expect(dialog.getByRole('button', { name: 'Add' })).toHaveStyle({ opacity: '1' })
  })
}

/** The engine found no such source in `main`: its sentence is shown, and nothing is added. */
export const SourceMissing: Story = {
  args: { onAdd: fn(async () => await Promise.resolve(MISSING)) },
  play: aSourceMissingInMainIsRefused,
}

/**
 * The card by the keyboard: Add step, then every row's controls in reading order — the ends that
 * cannot move are skipped — then the dialog walked field by field, added with Enter, and the
 * focus back on Add step.
 */
export const Keyboard: Story = {
  args: { steps: STEPS.slice(0, 2) },
  play: async ({ canvasElement, args }) => {
    args.onAdd.mockClear()
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'Add step' })
    const order = [
      add,
      canvas.getByRole('button', { name: 'Move down: copy .env from api' }),
      canvas.getByRole('button', { name: 'Edit: copy .env from api' }),
      canvas.getByRole('button', { name: 'Remove: copy .env from api' }),
      canvas.getByRole('button', { name: 'Move up: link node_modules in web' }),
      canvas.getByRole('button', { name: 'Edit: link node_modules in web' }),
      canvas.getByRole('button', { name: 'Remove: link node_modules in web' }),
    ]
    for (const next of order) {
      // oxlint-disable-next-line no-await-in-loop -- one key, then where it landed: the order is the point
      await userEvent.tab()
      expect(document.activeElement).toBe(next)
    }

    add.focus()
    await userEvent.keyboard('{Enter}')
    const shown = await dialogShown()
    await waitFor(() => {
      expect(shown.contains(document.activeElement)).toBe(true)
    })
    const dialog = within(shown)
    dialog.getByLabelText('Step kind').focus()
    await userEvent.tab()
    await expect(dialog.getByLabelText('Base')).toHaveFocus()
    await userEvent.tab()
    await expect(dialog.getByRole('textbox', { name: 'Path' })).toHaveFocus()
    await userEvent.keyboard('CLAUDE.md')
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Add' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onAdd).toHaveBeenCalledWith({
        kind: 'copy',
        base: null,
        path: 'CLAUDE.md',
        commandId: null,
      })
    })
    await dialogGone()
    await waitFor(() => {
      expect(add).toHaveFocus()
    })
  },
}
