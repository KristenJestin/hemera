import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ComposerActions } from './composer-actions.tsx'

/**
 * The foot of the composer: one glyph, and the two states that share it.
 *
 * A write in flight cannot be interrupted, so its square is disabled. A turn running can be, so
 * its square is the Stop — and the word beside it says which of the two is being drawn.
 */
const meta = {
  title: 'Components/ComposerActions',
  component: ComposerActions,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    workspaces: ['hemera'],
    workspace: 'hemera',
    onWorkspaceChange: fn(),
    ready: true,
    sending: false,
    running: false,
    action: 'Send',
    onSend: fn(),
    onStop: fn(),
  },
  argTypes: {
    ready: { control: 'boolean', description: 'Whether there is anything to send.' },
    sending: { control: 'boolean', description: 'Whether a write is in flight.' },
    running: { control: 'boolean', description: 'Whether an agent turn is running.' },
    onStop: { description: 'Cancels the running turn, when there is one to cancel.' },
  },
} satisfies Meta<typeof ComposerActions>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing is happening: the arrow, the word, and the keyboard, all pointing at sending. */
export const ReadyToSend: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const send = canvas.getByRole('button', { name: /Send/ })
    await expect(send).toBeEnabled()
    await userEvent.click(send)
    await expect(args.onSend).toHaveBeenCalled()
    await expect(args.onStop).not.toHaveBeenCalled()
  },
}

/**
 * A write in flight draws the square, says it is sending, and cannot be pressed: interrupting a
 * write is not this lot's, and a control that looked like it could would be the one lie in the
 * row. The button is busy rather than merely disabled — there is a sentence in front of it
 * either way, and a second press would be a second turn.
 */
export const Sending: Story = {
  args: { sending: true, ready: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Sending/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(canvas.getByRole('status', { name: 'Working' })).toBeVisible()
  },
}

/** A turn running draws the same square, calls it Stop, and presses. */
export const RunningATurn: Story = {
  args: { running: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const stop = canvas.getByRole('button', { name: /Stop/ })
    await expect(stop).toBeEnabled()
    await userEvent.click(stop)
    await expect(args.onStop).toHaveBeenCalled()
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}
