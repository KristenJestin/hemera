import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { WorkspaceRow } from './model.ts'
import { WorkspaceList, type WorkspaceListProps } from './workspace-list.tsx'

/**
 * The Workspaces card of a Project's settings (D8-02), on fixtures.
 *
 * The picker is the system's, and here it is a callback that answers a folder.
 */
const MAIN: WorkspaceRow = {
  id: 'main',
  name: 'main',
  path: '/home/kris/Projects/atlas',
  state: 'ready',
  main: true,
  dedicated: false,
}

const ROOT = '/home/kris/.local/share/hemera/workspaces/atlas'

const FILLED: WorkspaceRow[] = [
  MAIN,
  {
    id: 'login-form',
    name: 'login-form',
    path: `${ROOT}/login-form`,
    state: 'ready',
    main: false,
    dedicated: true,
    specKey: 'HEM-7',
  },
  {
    id: 'billing-export',
    name: 'billing-export',
    path: `${ROOT}/billing-export`,
    state: 'failed',
    main: false,
    dedicated: true,
    specKey: 'HEM-9',
  },
  {
    id: 'spike',
    name: 'spike',
    path: '/home/kris/Projects/spike',
    state: 'ready',
    main: false,
    dedicated: false,
  },
  {
    id: 'onboarding',
    name: 'onboarding',
    path: `${ROOT}/onboarding`,
    state: 'cleaned',
    main: false,
    dedicated: true,
    specKey: 'HEM-3',
  },
]

/** The list as the settings hold it: a Workspace the engine accepted joins it, `ready`. */
function Growing({ workspaces, onCreate, ...rest }: WorkspaceListProps) {
  const [rows, setRows] = useState(workspaces)
  return (
    <WorkspaceList
      {...rest}
      workspaces={rows}
      onCreate={async (path, name) => {
        const said = await onCreate(path, name)
        if (said === null)
          setRows([
            ...rows,
            { id: name, name, path, state: 'ready', main: false, dedicated: false },
          ])
        return said
      }}
    />
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Project/Workspaces',
  component: WorkspaceList,
  parameters: { layout: 'padded' },
  args: {
    workspaces: FILLED,
    onBrowse: fn(async () => await Promise.resolve('/home/kris/Projects/spike')),
    onCreate: fn(async () => await Promise.resolve(null)),
    onCleanup: fn(),
  },
  argTypes: {
    workspaces: { control: 'object', description: 'The Workspaces of the Project, main first.' },
    onBrowse: { control: false, description: 'Asks the system for a folder.' },
    onCreate: { control: false, description: 'Creates a Workspace on the folder, by name.' },
    onCleanup: { control: false, description: 'Asks to clean one up; the caller confirms.' },
    onSelect: { control: false, description: 'Shows one under the list.' },
    selected: { control: 'text', description: 'The one shown, whose row says so.' },
    className: { control: false, description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof WorkspaceList>

export default meta
type Story = StoryObj<typeof meta>
type Context = Parameters<NonNullable<Story['play']>>[0]

// Scenario "main cannot be cleaned up".
async function mainCannotBeCleanedUp({ canvasElement }: Context) {
  const canvas = within(canvasElement)
  await expect(canvas.getByText('/home/kris/Projects/atlas')).toBeVisible()
  await expect(canvas.queryByRole('button', { name: /Clean up/ })).toBeNull()
}

/** A Project with its own folder only: nothing to clean up, one thing to add. */
export const MainOnly: Story = {
  args: { workspaces: [MAIN] },
  play: mainCannotBeCleanedUp,
}

/** `main`, two Workspaces made for Specs, one on a picked folder, and one cleaned up. */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('HEM-7')).toBeVisible()
    // Only the two made for a Spec and not cleaned up yet offer it: main, the cleaned one and
    // `spike`, a folder the user picked, are not Hemera's to remove (D8-14).
    await expect(canvas.getAllByRole('button', { name: /^Clean up/ })).toHaveLength(2)
    await expect(canvas.queryByRole('button', { name: 'Clean up onboarding' })).toBeNull()
    await expect(canvas.getByText('/home/kris/Projects/spike')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Clean up spike' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Clean up login-form' }))
    await expect(args.onCleanup).toHaveBeenCalledWith('login-form')
  },
}

// Scenario "A Workspace on a chosen folder takes the folder's name".
async function aWorkspaceOnAChosenFolderTakesTheFoldersName({ canvasElement, args }: Context) {
  args.onCreate.mockClear()
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'New Workspace' }))
  await expect(args.onBrowse).toHaveBeenCalled()
  const name = await canvas.findByRole('textbox', { name: 'Name' })
  await expect(name).toHaveValue('spike')
  await userEvent.click(canvas.getByRole('button', { name: 'Create' }))
  await waitFor(() => {
    expect(args.onCreate).toHaveBeenCalledWith('/home/kris/Projects/spike', 'spike')
  })
  // Created: the form is gone, and `spike` is a Workspace of the list, ready, on that folder.
  await waitFor(() => {
    expect(canvas.queryByRole('textbox', { name: 'Name' })).toBeNull()
  })
  const spike = within(canvas.getByText('/home/kris/Projects/spike').closest('li')!)
  await expect(spike.getByText('spike')).toBeVisible()
  await expect(spike.getByText('Ready')).toBeVisible()
}

/**
 * The picker answered a folder: its last segment is proposed as the name, and the Workspace
 * joins the list once it is created.
 */
export const Creating: Story = {
  args: { workspaces: [MAIN] },
  render: (args) => <Growing {...args} />,
  play: aWorkspaceOnAChosenFolderTakesTheFoldersName,
}

/** One Workspace is shown under the list: its row's button is pressed, the others are not. */
export const Selected: Story = {
  args: { workspaces: FILLED.slice(0, 3), selected: 'login-form', onSelect: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Show login-form' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Show main' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Show billing-export' }))
    await expect(args.onSelect).toHaveBeenCalledWith('billing-export')
  },
}

/** New Workspace, the name, Create, Cancel, then each Clean up, in that order. */
export const Keyboard: Story = {
  args: { workspaces: FILLED.slice(0, 3) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const add = canvas.getByRole('button', { name: 'New Workspace' })
    add.focus()
    await userEvent.keyboard('{Enter}')
    const name = await canvas.findByRole('textbox', { name: 'Name' })
    await userEvent.tab()
    await expect(name).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Create' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Clean up login-form' })).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Clean up billing-export' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCleanup).toHaveBeenCalledWith('billing-export')
  },
}
