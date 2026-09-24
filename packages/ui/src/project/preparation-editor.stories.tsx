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
 * The recipe of the scenario "The steps follow the recipe in order": copy `.env` in each
 * repository, link `CLAUDE.md` at the root, run `install`. The story holds the recipe the way
 * the application will — a move, a removal and an addition change the list it hands back — so
 * the order can be tried by hand, with the keyboard, in both themes.
 */
const STEPS: RecipeStepLine[] = [
  { id: 'copy-env', kind: 'copy', path: '.env', scope: 'repositories' },
  { id: 'link-claude', kind: 'link', path: 'CLAUDE.md', scope: 'root' },
  { id: 'run-install', kind: 'run', commandName: 'install' },
]

/** The Project's catalogue, which is what a `run` step may start. */
const COMMANDS: RecipeCommand[] = [
  { id: 'install', name: 'install', type: 'configure' },
  { id: 'dev', name: 'dev', type: 'serve' },
  { id: 'check', name: 'check', type: 'test' },
]

/** The recipe as the application keeps it: the card says what changed, the page applies it. */
function Controlled({ steps, commands, onAdd, onRemove, onMove, ...rest }: PreparationEditorProps) {
  const [recipe, setRecipe] = useState(steps)
  return (
    <div className="mx-auto flex max-w-3xl flex-col p-6">
      <PreparationEditor
        {...rest}
        steps={recipe}
        commands={commands}
        onAdd={async (step) => {
          const said = await onAdd(step)
          if (said !== null) return said
          const added: RecipeStepLine =
            step.kind === 'run'
              ? {
                  id: `run-${step.commandId}-${String(recipe.length)}`,
                  kind: 'run',
                  commandName: commands.find((one) => one.id === step.commandId)?.name,
                }
              : { id: `${step.kind}-${step.path}-${String(recipe.length)}`, ...step }
          setRecipe([...recipe, added])
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
  tags: ['autodocs', 'new'],
  title: 'Blocks/Workspace/PreparationEditor',
  component: PreparationEditor,
  render: (args) => <Controlled {...args} />,
  parameters: { layout: 'fullscreen' },
  args: {
    steps: [],
    commands: COMMANDS,
    onAdd: fn(async () => await Promise.resolve(null)),
    onRemove: fn(),
    onMove: fn(),
  },
  argTypes: {
    steps: { control: 'object', description: 'The recipe, in the order it runs.' },
    commands: {
      control: 'object',
      description: "The Project's catalogue, which is what a run step may start.",
    },
    onAdd: {
      action: 'step added',
      description: "Adds a step at the end; answers the engine's refusal, or null.",
    },
    onRemove: { action: 'step removed', description: 'Takes a step out of the recipe.' },
    onMove: { action: 'step moved', description: 'Moves a step one place up or down.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof PreparationEditor>

export default meta

type Story = StoryObj<typeof meta>

type StoryContext = Parameters<NonNullable<Story['play']>>[0]

/** Opens a select of the card by its name and chooses one of its items, then waits it out. */
async function choose(canvasElement: HTMLElement, label: string, option: RegExp): Promise<void> {
  await userEvent.click(within(canvasElement).getByLabelText(label))
  const list = await waitFor(() => within(document.body).getByRole('listbox'))
  await userEvent.click(within(list).getByRole('option', { name: option }))
  // Waited out: a popup still leaving carries focus guards the accessibility pass reads as an
  // error nobody can act on.
  await waitFor(() => {
    expect(within(document.body).queryByRole('listbox')).toBeNull()
  })
}

/** No step: a Workspace is ready as soon as its worktrees are, and the card says so. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('No step: a Workspace is ready as soon as its worktrees are.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
  },
}

/** The three steps of the scenario, read as sentences, in the order they run. */
async function theStepsFollowTheRecipeInOrder({ canvasElement, args }: StoryContext) {
  // "The steps follow the recipe in order"
  args.onMove.mockClear()
  const canvas = within(canvasElement)
  const rows = within(canvas.getByRole('list')).getAllByRole('listitem')
  await expect(rows.map((row) => row.textContent)).toEqual([
    'copy .env in each repository',
    'link CLAUDE.md at the root',
    'run install',
  ])
  // The first cannot go further up, the last further down.
  await expect(
    canvas.getByRole('button', { name: 'Move up: copy .env in each repository' }),
  ).toBeDisabled()
  await expect(canvas.getByRole('button', { name: 'Move down: run install' })).toBeDisabled()

  await userEvent.click(
    canvas.getByRole('button', { name: 'Move down: copy .env in each repository' }),
  )
  await expect(args.onMove).toHaveBeenCalledWith('copy-env', 'down')
  await waitFor(() => {
    expect(
      within(canvas.getByRole('list'))
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual(['link CLAUDE.md at the root', 'copy .env in each repository', 'run install'])
  })
}

export const Filled: Story = {
  args: { steps: STEPS },
  play: theStepsFollowTheRecipeInOrder,
}

/** The form on `run`: the catalogue is offered with each command's type, and Add adds it. */
export const Adding: Story = {
  args: { steps: STEPS.slice(0, 2) },
  play: async ({ canvasElement, args }) => {
    args.onAdd.mockClear()
    const canvas = within(canvasElement)
    // A path that leaves the Workspace is refused before anybody is asked.
    await userEvent.type(canvas.getByRole('textbox', { name: 'File' }), '../secrets.env')
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(canvas.getByText('A path is relative to the Workspace root.')).toHaveStyle({
        opacity: '1',
      })
    })
    await expect(args.onAdd).not.toHaveBeenCalled()

    await choose(canvasElement, 'Step kind', /^Run a command/)
    await expect(canvas.queryByRole('textbox', { name: 'File' })).toBeNull()
    await choose(canvasElement, 'Command', /^install/)
    await userEvent.click(canvas.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(args.onAdd).toHaveBeenCalledWith({ kind: 'run', commandId: 'install' })
    })
    await waitFor(() => {
      expect(canvas.getByText('run install')).toBeVisible()
    })
  },
}

/** Every row's controls in reading order, then the form; the ends that cannot move are skipped. */
export const Keyboard: Story = {
  args: { steps: STEPS },
  play: async ({ canvasElement, args }) => {
    args.onMove.mockClear()
    const canvas = within(canvasElement)
    const order = [
      canvas.getByRole('button', { name: 'Move down: copy .env in each repository' }),
      canvas.getByRole('button', { name: 'Remove: copy .env in each repository' }),
      canvas.getByRole('button', { name: 'Move up: link CLAUDE.md at the root' }),
      canvas.getByRole('button', { name: 'Move down: link CLAUDE.md at the root' }),
      canvas.getByRole('button', { name: 'Remove: link CLAUDE.md at the root' }),
      canvas.getByRole('button', { name: 'Move up: run install' }),
      canvas.getByRole('button', { name: 'Remove: run install' }),
      canvas.getByLabelText('Step kind'),
      canvas.getByRole('textbox', { name: 'File' }),
      canvas.getByLabelText('Where'),
    ]
    for (const next of order) {
      // oxlint-disable-next-line no-await-in-loop -- one key, then where it landed: the order is the point
      await userEvent.tab()
      expect(document.activeElement).toBe(next)
    }
    // Add is off until a file is named, so the walk ends on the last field.
    await expect(canvas.getByRole('button', { name: 'Add' })).toBeDisabled()

    canvas.getByRole('button', { name: 'Move up: run install' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onMove).toHaveBeenCalledWith('run-install', 'up')
  },
}
