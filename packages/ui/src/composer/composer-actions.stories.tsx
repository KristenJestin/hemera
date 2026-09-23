import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ComposerActions } from './composer-actions.tsx'

/**
 * The foot of the composer: one glyph, and the two states that share it.
 *
 * A write in flight cannot be interrupted, so its square is disabled. A turn running can be, so
 * its square is the Stop — and the word beside it says which of the two is being drawn.
 *
 * `New Spec` is the Home's and nobody else's since the trial of 22 September 2026: a Spec is
 * made from the question that starts a Session, and a control drawn and disabled in every place
 * it appears says nothing about where it belongs.
 */
const meta = {
  title: 'Blocks/Composer/ComposerActions',
  component: ComposerActions,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    workspaces: [{ name: 'hemera' }],
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
    workspaceFixed: {
      control: 'boolean',
      description: 'Whether the agent has started, which fixes the Workspace.',
      table: { defaultValue: { summary: 'false' } },
    },
    spec: {
      control: 'boolean',
      description: 'Whether the row offers a Spec: the Home does, a Session does not.',
      table: { defaultValue: { summary: 'false' } },
    },
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
    // A Session's foot: the Workspace and the send, and no Spec, because none was asked for.
    await expect(canvas.queryByRole('button', { name: /New Spec/ })).toBeNull()
    await userEvent.click(send)
    await expect(args.onSend).toHaveBeenCalled()
    await expect(args.onStop).not.toHaveBeenCalled()
  },
}

/**
 * The Home's foot, which is the one that offers a Spec.
 *
 * It is drawn and off: a Spec is lot 6. What this story holds is that it is drawn *here* and
 * nowhere else — the same row in a Session has no such button at all.
 */
export const WithASpec: Story = {
  args: { spec: true, action: 'Start chat' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const spec = canvas.getByRole('button', { name: /New Spec/ })
    await expect(spec).toBeDisabled()
    await expect(spec).toHaveAttribute('title', 'A Spec comes with lot 6')
  },
}

/**
 * A write in flight draws the same square and cannot be pressed: interrupting a write is not this
 * lot's, and a control that looked like it could would be the one lie in the row. Nothing of the
 * control changes — same square, same place, same word — and the wait is said by the indicator
 * the button adds in front of that word, never by the word itself. A second press would be a
 * second turn, which is why the control is disabled rather than merely quiet.
 */
export const Sending: Story = {
  args: { sending: true, ready: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const send = canvas.getByRole('button', { name: /Send/ })
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    await expect(send.textContent).not.toContain('Sending')
    await expect(canvas.getByRole('status', { name: 'Working' })).toBeVisible()
  },
}

/** A turn running draws the same square, calls it Stop, says it destroys, and presses. */
export const RunningATurn: Story = {
  args: { running: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const stop = canvas.getByRole('button', { name: 'Stop' })
    await expect(stop).toBeEnabled()
    await expect(stop).toHaveClass('bg-destructive')
    await userEvent.click(stop)
    await expect(args.onStop).toHaveBeenCalled()
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** Pressed once and the turn still running: the next press forces the stop, and says so. */
export const ForceStop: Story = {
  args: { running: true, forcing: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const force = canvas.getByRole('button', { name: 'Force stop' })
    await expect(force).toBeEnabled()
    await userEvent.click(force)
    await expect(args.onStop).toHaveBeenCalled()
  },
}
