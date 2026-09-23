import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { VariableLine } from './services-model.ts'
import { VariablesEditor } from './variables-editor.tsx'

/**
 * The variables of a Project and of a Workspace over it (D8-06).
 *
 * The Project `atlas` sets `PORT=3000` and a database; the Workspace `login-form` sets its own
 * `PORT` and lets the database through. What a run in `login-form` receives is `PORT=3001` and
 * the Project's database, which is what the Workspace story shows line by line.
 */
const PROJECT: VariableLine[] = [
  { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas' },
  { key: 'PORT', value: '3000' },
]

const WORKSPACE: VariableLine[] = [
  { key: 'PORT', value: '3001', overrides: '3000' },
  { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas', inherited: true },
]

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Workspace/Variables',
  component: VariablesEditor,
  parameters: { layout: 'padded' },
  args: {
    scope: 'project',
    name: 'atlas',
    variables: PROJECT,
    onSet: fn(async () => await Promise.resolve(null)),
    onRemove: fn(),
  },
  argTypes: {
    scope: {
      control: 'inline-radio',
      options: ['project', 'workspace'],
      description: "Whose variables these are: the Project's, or a Workspace's over them.",
    },
    name: { control: 'text', description: "The Project's or the Workspace's name." },
    variables: {
      control: 'object',
      description: "The scope's lines and, on a Workspace, the Project's that apply to it.",
    },
    onSet: {
      control: false,
      description: 'Sets a key to a value; answers the refusal, or null when written.',
    },
    onRemove: { control: false, description: 'Removes a key this scope owns.' },
    className: { control: false, description: 'Where the editor sits; never how it looks.' },
  },
} satisfies Meta<typeof VariablesEditor>

export default meta

type Story = StoryObj<typeof meta>

type PlayContext = Parameters<NonNullable<Story['play']>>[0]

/** The Project's own variables: every line is its own, so every line can be removed. */
export const Project: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('PORT')).toBeVisible()
    await expect(canvas.queryByText('inherited')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove PORT' }))
    await expect(args.onRemove).toHaveBeenCalledWith('PORT')
    // A key a shell would have to quote is refused before anything is asked of anybody.
    await userEvent.type(canvas.getByLabelText('Key'), 'api-url')
    await userEvent.click(canvas.getByRole('button', { name: 'Set' }))
    // The message arrives from under the field; a colour read halfway through the fade is a
    // contrast the accessibility pass is right to refuse, so the story waits for it to land.
    await waitFor(() => {
      expect(
        canvas.getByText('A variable key is upper-case letters, digits and underscores.'),
      ).toHaveStyle({ opacity: '1' })
    })
    await expect(args.onSet).not.toHaveBeenCalled()
  },
}

// Scenario: "A Workspace's variable overrides the Project's"
async function aWorkspacesVariableOverridesTheProjects({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  const port = within(canvas.getByText('PORT').closest('li')!)
  await expect(port.getByText('3001')).toBeVisible()
  await expect(port.getByText('Overrides 3000')).toBeVisible()
  const database = within(canvas.getByText('DATABASE_URL').closest('li')!)
  await expect(database.getByText('inherited')).toBeVisible()
  // The Project's line is not the Workspace's to remove: it is overridden instead.
  await expect(database.queryByRole('button', { name: 'Remove DATABASE_URL' })).toBeNull()
  await userEvent.click(database.getByRole('button', { name: 'Override DATABASE_URL' }))
  await expect(canvas.getByLabelText('Key')).toHaveValue('DATABASE_URL')
}

/** A Workspace over its Project: `PORT` overridden, the database inherited. */
export const Workspace: Story = {
  args: { scope: 'workspace', name: 'login-form', variables: WORKSPACE },
  play: aWorkspacesVariableOverridesTheProjects,
}

/** Nothing set: the editor says what a run gets instead, and still offers the form. */
export const Empty: Story = {
  args: { variables: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText(
        "No variable is set for atlas. Runs get the machine's environment as it is.",
      ),
    ).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Set' })).toBeDisabled()
  },
}

/** The whole editor by the keyboard: the lines' actions, then the form, in reading order. */
export const Keyboard: Story = {
  args: { scope: 'workspace', name: 'login-form', variables: WORKSPACE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'Remove PORT' }))
    await userEvent.tab()
    await expect(document.activeElement).toBe(
      canvas.getByRole('button', { name: 'Override DATABASE_URL' }),
    )
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByLabelText('Key'))
    await expect(document.activeElement).toHaveValue('DATABASE_URL')
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByLabelText('Value'))
    await userEvent.keyboard('postgres://localhost:5432/login_form')
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'Set' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.onSet).toHaveBeenCalledWith(
      'DATABASE_URL',
      'postgres://localhost:5432/login_form',
    )
  },
}
