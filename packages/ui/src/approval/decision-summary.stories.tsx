import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { DecisionSummary } from './decision-summary.tsx'

/**
 * The line a decision leaves behind, read at a glance in a thread that kept going.
 */
const meta = {
  title: 'Blocks/Session/DecisionSummary',
  component: DecisionSummary,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { answer: 'Allowed once', at: '14:02' },
  argTypes: {
    answer: { control: 'text', description: 'What was answered, in the words it was read in.' },
    at: { control: 'text', description: 'When it was answered, already written for the platform.' },
    refused: { control: 'boolean', description: 'Whether the answer was a refusal.' },
  },
} satisfies Meta<typeof DecisionSummary>

export default meta

type Story = StoryObj<typeof meta>

/** A permission given once, which is the answer a reader scrolls past without stopping. */
export const Allowed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Allowed once')).toBeVisible()
    await expect(canvas.getByText('14:02')).toBeVisible()
  },
}

/** A refusal, drawn as a note rather than as an agreement: the same line, without the check. */
export const Refused: Story = {
  args: { answer: 'Rejected', at: '14:05', refused: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Rejected')).toBeVisible()
  },
}
