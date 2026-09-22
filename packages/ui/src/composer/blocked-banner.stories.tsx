import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BlockedBanner } from './blocked-banner.tsx'

/**
 * The composer while a turn waits on a person: what is being waited on, and the way out.
 */
const meta = {
  title: 'Blocks/Session/BlockedBanner',
  component: BlockedBanner,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    waiting: 'the agent asked to run pnpm --filter @hemera/ui test',
    onStop: fn(),
  },
  argTypes: {
    waiting: { control: 'text', description: 'What the turn is waiting on.' },
    onStop: { description: 'Ends the turn, for a reader who does not want to answer.' },
  },
} satisfies Meta<typeof BlockedBanner>

export default meta

type Story = StoryObj<typeof meta>

/** A turn that is not moving, said where the reader is already looking. */
export const WaitingOnAnAnswer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Waiting for you/)).toBeVisible()
    await expect(canvas.getByText(/asked to run/)).toBeVisible()
  },
}

/** The Stop stays: the one control that must never be taken away while something is running. */
export const StoppingInsteadOfAnswering: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalled()
  },
}
