import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { WorkspacePill } from './workspace-pill.tsx'

/**
 * Which Workspace a Session works in (D8-08).
 *
 * The pill offers the Project's Workspaces that are `ready`, `main` first, and the choice is
 * fixed once the agent has started. A Project with no dedicated Workspace offers `main` alone.
 */
const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Composer/WorkspacePill',
  component: WorkspacePill,
  parameters: { layout: 'padded' },
  args: {
    workspaces: [{ name: 'main', path: '/home/someone/Projects/atlas' }],
    workspace: 'main',
    onWorkspaceChange: fn(),
    fixed: false,
  },
  argTypes: {
    workspaces: {
      control: 'object',
      description: 'The Workspaces in state ready, main first, filtered by the caller.',
    },
    workspace: { control: 'text', description: 'The Workspace chosen.' },
    onWorkspaceChange: { control: false, description: 'Chooses another Workspace.' },
    fixed: {
      control: 'boolean',
      description: 'Whether the agent has started, which fixes the choice.',
      table: { defaultValue: { summary: 'false' } },
    },
  },
} satisfies Meta<typeof WorkspacePill>

export default meta

type Story = StoryObj<typeof meta>

type StoryContext = Parameters<NonNullable<Story['play']>>[0]

/** The three ready Workspaces of the Project, `main` first. */
const SEVERAL = [
  { name: 'main', path: '/home/someone/Projects/atlas' },
  { name: 'login-form', path: '/home/someone/.local/share/hemera/workspaces/atlas/login-form' },
  { name: 'spike', path: '/home/someone/Projects/spike' },
]

/** A Project with no dedicated Workspace: `main`, alone. */
export const Single: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Workspace')).toHaveTextContent('main')
    await expect(canvas.getByLabelText('Workspace')).toBeEnabled()
  },
}

/** Three ready Workspaces, `main` first; choosing one says so. */
export const Several: Story = {
  args: { workspaces: SEVERAL },
  play: async ({ canvasElement, args }) => {
    args.onWorkspaceChange.mockClear()
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByLabelText('Workspace'))
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    await expect(
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['main', 'login-form', 'spike'])
    await userEvent.click(within(list).getByRole('option', { name: 'login-form' }))
    await expect(args.onWorkspaceChange).toHaveBeenCalledWith('login-form')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
  },
}

/**
 * Once the agent has started, the choice is a plain label with the Workspace's name, and the
 * reason is its tooltip only: no sentence stays on screen for the whole Session (issue #128).
 */
async function theWorkspaceIsFixedOnceTheAgentHasStarted({ canvasElement, args }: StoryContext) {
  // "The Workspace is fixed once the agent has started"
  args.onWorkspaceChange.mockClear()
  const canvas = within(canvasElement)
  const label = canvas.getByRole('img', { name: 'Workspace: login-form' })
  await expect(label).toHaveTextContent('login-form')
  // Not a choice any more, and not drawn as one.
  await expect(canvas.queryByRole('combobox')).toBeNull()
  await expect(canvas.queryByText('The Workspace is fixed once the agent has started.')).toBeNull()
  // The reason is the tooltip, reached by the keyboard as by the pointer.
  await userEvent.tab()
  await expect(document.activeElement).toBe(label)
  await waitFor(() => {
    expect(within(document.body).getByRole('tooltip')).toHaveTextContent(
      'The Workspace is fixed once the agent has started.',
    )
  })
  // A press on it opens nothing and changes nothing.
  await userEvent.click(label)
  await expect(within(document.body).queryByRole('listbox')).toBeNull()
  await expect(args.onWorkspaceChange).not.toHaveBeenCalled()
}

export const Fixed: Story = {
  args: { workspaces: SEVERAL, workspace: 'login-form', fixed: true },
  play: theWorkspaceIsFixedOnceTheAgentHasStarted,
}

/** The pill is one stop of the tab order: Enter opens it, Escape closes it back onto it. */
export const Keyboard: Story = {
  args: { workspaces: SEVERAL },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByLabelText('Workspace')
    await userEvent.tab()
    await expect(document.activeElement).toBe(pill)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(document.body).getByRole('listbox')).toBeInTheDocument()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(pill)
    })
  },
}
