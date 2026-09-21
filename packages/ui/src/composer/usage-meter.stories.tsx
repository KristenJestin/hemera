import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { UsageMeter } from './usage-meter.tsx'

/**
 * What a session has spent, in the two halves it is ever asked about.
 */
const meta = {
  title: 'Components/UsageMeter',
  component: UsageMeter,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { used: 12400, size: 200000 },
  argTypes: {
    used: { control: 'number', description: 'How much of the window the session has used.' },
    size: { control: 'number', description: 'How big the window is, as the agent reported.' },
    cost: { control: 'object', description: 'What the turn cost, when the agent reports one.' },
  },
} satisfies Meta<typeof UsageMeter>

export default meta

type Story = StoryObj<typeof meta>

/** Claude reports a cost, so the cost is shown. */
export const WithACost: Story = {
  args: { cost: { amount: 0.42, currency: 'USD' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('12,400 / 200,000 tokens')).toBeVisible()
    await expect(canvas.getByText(/0\.42/)).toBeVisible()
  },
}

/** Codex reports no cost, and the meter says which of the two it is rather than showing a zero. */
export const WithoutACost: Story = {
  args: { used: 8431, size: 400000 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('8,431 / 400,000 tokens')).toBeVisible()
    await expect(canvas.getByText('Cost not provided')).toBeVisible()
  },
}
