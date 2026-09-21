import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { StoppedTurn } from './stopped-turn.tsx'

/**
 * A turn that was cut off, said for what it is: not an ending, and not an error.
 */
const meta = {
  title: 'Blocks/Session/StoppedTurn',
  component: StoppedTurn,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { at: '14:07' },
  argTypes: {
    doing: { control: 'text', description: 'What the turn was doing when it stopped.' },
    at: { control: 'text', description: 'When it stopped, already written for the platform.' },
    byTheReader: { control: 'boolean', description: 'Whether the reader stopped it.' },
  },
} satisfies Meta<typeof StoppedTurn>

export default meta

type Story = StoryObj<typeof meta>

/** A stop and nothing else: who, and when. */
export const StoppedByYou: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped by you')).toBeVisible()
    await expect(canvas.getByText('14:07')).toBeVisible()
  },
}

/** What was going on when it stopped, so the thread does not end on a blank. */
export const StoppedWhileWorking: Story = {
  args: { doing: 'running the design system’s tests' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Stopped by you while running the design system’s tests'),
    ).toBeVisible()
  },
}

/** The agent stopped on its own, which is the same line without a person in it. */
export const StoppedOnItsOwn: Story = {
  args: { byTheReader: false, at: '14:11' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped')).toBeVisible()
  },
}
