import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { LaunchWorkspace } from './model.ts'
import { WorkspaceActions } from './workspace-actions.tsx'

/** `main`, which every Project has, and a Workspace a hand made out of the repositories. */
const MAIN: LaunchWorkspace = { id: 'ws-main', name: 'main' }
const SPIKE: LaunchWorkspace = { id: 'ws-spike', name: 'spike' }

/**
 * The build of a frozen Spec: what it is launched in, and where the launch stands (D8-12, D8-13).
 *
 * With no Workspace yet, the two ways in and the menu that holds the second one; with one ready,
 * the one thing left to do. Then the five states of a launch, each with the one thing it offers
 * from there: the step being prepared, the agent being started, the Session it started, the cause
 * it was refused with and the `Retry` that goes with it, and the Rework that took the Spec back.
 */
const meta = {
  title: 'Blocks/Spec/WorkspaceActions',
  component: WorkspaceActions,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    launch: null,
    workspaces: [MAIN, SPIKE],
    onPrepareAndStart: fn(),
    onPrepareOnly: fn(),
    onUseWorkspace: fn(),
    onStart: fn(),
    onRetry: fn(),
    onOpen: fn(),
  },
  argTypes: {
    launch: { control: false, description: 'Where the launch stands, or null while none runs.' },
    workspace: { control: 'object', description: 'The Workspace the Spec is set on, once ready.' },
    workspaces: { control: 'object', description: 'The Workspaces a build may start in.' },
    onPrepareAndStart: { description: 'Prepares a Workspace from the plan and starts the build.' },
    onPrepareOnly: { description: 'Prepares a Workspace and stops there.' },
    onUseWorkspace: { description: 'Starts the build in one of the existing Workspaces.' },
    onStart: { description: 'Starts the build in the Workspace the Spec is set on.' },
    onRetry: { description: 'Starts the agent again, after it refused to.' },
    onOpen: { description: 'Opens the build Session.' },
  },
} satisfies Meta<typeof WorkspaceActions>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing prepared yet: prepare one and start, prepare one only, or take an existing one. */
export const NoWorkspace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.click(canvas.getByRole('button', { name: 'Prepare and start the build' }))
    await expect(args.onPrepareAndStart).toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Use an existing Workspace' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Prepare a Workspace only' }))
    await expect(args.onPrepareOnly).toHaveBeenCalled()

    await userEvent.click(canvas.getByRole('button', { name: 'Use an existing Workspace' }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'spike' }))
    await expect(args.onUseWorkspace).toHaveBeenCalledWith('ws-spike')
  },
}

/** A Workspace is ready: there is one thing left to do, and it is this. */
export const WorkspaceReady: Story = {
  args: { workspace: MAIN },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start the build' }))
    await expect(args.onStart).toHaveBeenCalled()
    await expect(canvas.queryByRole('button', { name: 'Prepare and start the build' })).toBeNull()
  },
}

/** Waiting on the Workspace: the step being prepared is named, and the dot only runs. */
export const Waiting: Story = {
  args: {
    workspace: MAIN,
    launch: { state: 'waiting', step: 'installing the dependencies' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Preparing the Workspace · installing the dependencies'),
    ).toBeVisible()
    await expect(canvas.queryAllByRole('button')).toEqual([])
  },
}

/** Waiting with no step to name, which is the Workspace itself that is not ready. */
export const WaitingWithNoStep: Story = {
  args: { workspace: MAIN, launch: { state: 'waiting' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Preparing the Workspace')).toBeVisible()
  },
}

/** Handed to the agent: one sentence, and nothing to press. */
export const Starting: Story = {
  args: { workspace: MAIN, launch: { state: 'starting' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Starting the agent…')).toBeVisible()
  },
}

/** Started: the Session it started is what is offered. */
export const Started: Story = {
  args: { workspace: MAIN, launch: { state: 'started' } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Build started')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

/** Refused: the cause as the engine gave it, announced, and the one thing to do about it. */
export const Failed: Story = {
  args: {
    workspace: MAIN,
    launch: { state: 'failed', cause: 'the agent SDK is not installed' },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const refusal = canvas.getByRole('alert')
    await expect(refusal).toHaveTextContent(
      'The agent did not start: the agent SDK is not installed',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/** Taken back by a Rework: said, and nothing offered — the Spec is a draft again. */
export const Cancelled: Story = {
  args: { workspace: MAIN, launch: { state: 'cancelled' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Cancelled by the Rework')).toBeVisible()
    await expect(canvas.queryAllByRole('button')).toEqual([])
  },
}

/** Both ways in, walked with the keyboard, and the menu opened by an arrow. */
export const Keyboard: Story = {
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const body = within(document.body)

    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Prepare and start the build' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onPrepareAndStart).toHaveBeenCalled()

    await userEvent.tab()
    const trigger = canvas.getByRole('button', { name: 'Use an existing Workspace' })
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => body.getByRole('menu'))
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    await expect(args.onUseWorkspace).toHaveBeenCalledWith('ws-main')
    await waitFor(() => {
      expect(body.queryByRole('menu')).toBeNull()
    })
    await expect(trigger).toHaveFocus()
  },
}
