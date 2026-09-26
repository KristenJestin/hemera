import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { VariableLine } from './services-model.ts'
import { VariablesEditor, type VariablesEditorProps } from './variables-editor.tsx'

/**
 * The variables of a Project and of a Workspace over it (D8-06).
 *
 * The Project `atlas` sets `PORT=3000` and a database; the Workspace `login-form` sets its own
 * `PORT` and lets the database through. What a run in `login-form` receives is `PORT=3001` and
 * the Project's database, which is what the Workspace story shows line by line.
 *
 * The story keeps the lines the way the application does: a key set through a dialog is a line
 * of the list once the dialog closes.
 */
const PROJECT: VariableLine[] = [
  { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas' },
  { key: 'PORT', value: '3000' },
]

const WORKSPACE: VariableLine[] = [
  { key: 'PORT', value: '3001', overrides: '3000' },
  { key: 'DATABASE_URL', value: 'postgres://localhost:5432/atlas', inherited: true },
]

function Kept({ variables, onSet, ...rest }: VariablesEditorProps) {
  const [lines, setLines] = useState(variables)
  return (
    <VariablesEditor
      {...rest}
      variables={lines}
      onSet={async (key, value) => {
        const said = await onSet(key, value)
        if (said !== null) return said
        // A key already listed keeps its place and what it overrides; a new one comes first.
        const listed = lines.find((line) => line.key === key)
        const overrides = listed?.inherited === true ? listed.value : listed?.overrides
        const written: VariableLine = { key, value, overrides }
        setLines(
          listed === undefined
            ? [written, ...lines]
            : lines.map((line) => (line === listed ? written : line)),
        )
        return null
      }}
    />
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Workspace/VariablesEditor',
  component: VariablesEditor,
  render: (args) => <Kept {...args} />,
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

/** The dialog on screen, once it is there. */
async function dialogShown() {
  return await waitFor(() => within(document.body).getByRole('dialog'))
}

/**
 * Waits the dialog out: a popup still leaving is a popup the accessibility pass still reads, and
 * a loaded runner plays the leave slowly: the second it gives can end while it is in flight.
 */
async function dialogGone() {
  await waitFor(
    () => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    },
    { timeout: 10_000 },
  )
}

/** The Project's own variables: every line is its own, so every line is edited and removed. */
export const Project: Story = {
  play: async ({ canvasElement, args }) => {
    args.onRemove.mockClear()
    const canvas = within(canvasElement)
    await expect(canvas.getByText('PORT')).toBeVisible()
    await expect(canvas.queryByText('inherited')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Edit PORT' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove PORT' }))
    await expect(args.onRemove).toHaveBeenCalledWith('PORT')
  },
}

// Scenario: "A Workspace's variable overrides the Project's"
async function aWorkspacesVariableOverridesTheProjects({ canvasElement, args }: PlayContext) {
  args.onSet.mockClear()
  const canvas = within(canvasElement)
  const port = within(canvas.getByText('PORT').closest('li')!)
  await expect(port.getByText('3001')).toBeVisible()
  await expect(port.getByText('Overrides 3000')).toBeVisible()
  const database = within(canvas.getByText('DATABASE_URL').closest('li')!)
  await expect(database.getByText('inherited')).toBeVisible()
  // The Project's line is not the Workspace's to edit nor to remove: it is overridden instead.
  await expect(database.queryByRole('button', { name: 'Remove DATABASE_URL' })).toBeNull()
  await expect(database.queryByRole('button', { name: 'Edit DATABASE_URL' })).toBeNull()
  await userEvent.click(database.getByRole('button', { name: 'Override DATABASE_URL' }))
  const dialog = within(await dialogShown())
  await expect(dialog.getByRole('heading', { name: 'Add variable' })).toBeInTheDocument()
  await expect(dialog.getByRole('textbox', { name: 'Key' })).toHaveValue('DATABASE_URL')
  // Not a key that exists here: it is the Project's, and the Workspace sets none of its own.
  await expect(dialog.queryByRole('alert')).toBeNull()
  await userEvent.type(
    dialog.getByRole('textbox', { name: 'Value' }),
    'postgres://localhost:5432/login_form',
  )
  await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
  await waitFor(() => {
    expect(args.onSet).toHaveBeenCalledWith('DATABASE_URL', 'postgres://localhost:5432/login_form')
  })
  await dialogGone()
  await expect(
    within(canvas.getByText('postgres://localhost:5432/login_form').closest('li')!).getByText(
      'Overrides postgres://localhost:5432/atlas',
    ),
  ).toBeVisible()
}

/** A Workspace over its Project: `PORT` overridden, the database inherited and overridden here. */
export const Workspace: Story = {
  args: { scope: 'workspace', name: 'login-form', variables: WORKSPACE },
  play: aWorkspacesVariableOverridesTheProjects,
}

/** Nothing set: the editor says what a run gets instead, and still offers to add one. */
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
    await expect(canvas.getByRole('button', { name: 'Add variable' })).toBeEnabled()
  },
}

/** The add dialog: a key a shell would have to quote is refused, a good one joins the list. */
export const Adding: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSet.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }))
    const dialog = within(await dialogShown())
    const key = dialog.getByRole('textbox', { name: 'Key' })
    await userEvent.type(key, 'api-url')
    // The message arrives from under the field; a colour read halfway through the fade is a
    // contrast the accessibility pass is right to refuse, so the story waits for it to land.
    // A loaded runner plays the fade slowly: the second it gives can end while it is in flight.
    await waitFor(
      () => {
        expect(
          dialog.getByText('A variable key is upper-case letters, digits and underscores.'),
        ).toHaveStyle({ opacity: '1' })
      },
      { timeout: 10_000 },
    )
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.clear(key)
    await userEvent.type(key, 'API_URL')
    await userEvent.type(dialog.getByRole('textbox', { name: 'Value' }), 'http://localhost:4000')
    await userEvent.click(dialog.getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(args.onSet).toHaveBeenCalledWith('API_URL', 'http://localhost:4000')
    })
    await dialogGone()
    await expect(canvas.getByText('API_URL')).toBeVisible()
  },
}

/** The pencil of a line: its key is fixed, its value is rewritten, and Save writes it. */
export const Editing: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSet.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Edit PORT' }))
    const dialog = within(await dialogShown())
    await expect(dialog.getByRole('heading', { name: 'Edit variable' })).toBeInTheDocument()
    await expect(dialog.queryByRole('textbox', { name: 'Key' })).toBeNull()
    await expect(dialog.getByText('PORT')).toBeInTheDocument()
    const value = dialog.getByRole('textbox', { name: 'Value' })
    await expect(value).toHaveValue('3000')
    await userEvent.clear(value)
    await userEvent.type(value, '3100')
    await userEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(args.onSet).toHaveBeenCalledWith('PORT', '3100')
    })
    await dialogGone()
    await expect(within(canvas.getByText('PORT').closest('li')!).getByText('3100')).toBeVisible()
  },
}

/** A key this scope already sets, typed in the add dialog: it says so and offers to edit it. */
export const KeyExists: Story = {
  play: async ({ canvasElement, args }) => {
    args.onSet.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add variable' }))
    const dialog = within(await dialogShown())
    await userEvent.type(dialog.getByRole('textbox', { name: 'Key' }), 'PORT')
    await expect(dialog.getByRole('alert')).toHaveTextContent('PORT is already set for atlas.')
    await expect(dialog.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.click(dialog.getByRole('button', { name: 'Edit PORT' }))
    await expect(dialog.getByRole('heading', { name: 'Edit variable' })).toBeInTheDocument()
    const value = dialog.getByRole('textbox', { name: 'Value' })
    await expect(value).toHaveValue('3000')
    await waitFor(() => {
      expect(value).toHaveFocus()
    })
    await expect(args.onSet).not.toHaveBeenCalled()
    // Save comes back from the quiet Add was in before the colours are judged.
    await waitFor(() => {
      expect(dialog.getByRole('button', { name: 'Save' })).toHaveStyle({ opacity: '1' })
    })
  },
}

/**
 * The editor by the keyboard: the lines' actions in reading order, then the edit dialog walked
 * field by field, saved with Enter, and the focus back on the pencil that opened it.
 */
export const Keyboard: Story = {
  args: { scope: 'workspace', name: 'login-form', variables: WORKSPACE },
  play: async ({ canvasElement, args }) => {
    args.onSet.mockClear()
    const canvas = within(canvasElement)
    const order = [
      canvas.getByRole('button', { name: 'Add variable' }),
      canvas.getByRole('button', { name: 'Edit PORT' }),
      canvas.getByRole('button', { name: 'Remove PORT' }),
      canvas.getByRole('button', { name: 'Override DATABASE_URL' }),
    ]
    for (const next of order) {
      // oxlint-disable-next-line no-await-in-loop -- one key, then where it landed: the order is the point
      await userEvent.tab()
      expect(document.activeElement).toBe(next)
    }
    const pencil = canvas.getByRole('button', { name: 'Edit PORT' })
    pencil.focus()
    await userEvent.keyboard('{Enter}')
    const shown = await dialogShown()
    await waitFor(() => {
      expect(shown.contains(document.activeElement)).toBe(true)
    })
    const dialog = within(shown)
    const value = dialog.getByRole('textbox', { name: 'Value' })
    value.focus()
    await userEvent.keyboard('{Control>}a{/Control}3002')
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Save' })).toHaveFocus()
    await userEvent.tab()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onSet).toHaveBeenCalledWith('PORT', '3002')
    })
    await dialogGone()
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Edit PORT' })).toHaveFocus()
    })
  },
}
