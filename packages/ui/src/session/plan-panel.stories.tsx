import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { PlanPanel } from './plan-panel.tsx'

/**
 * The plan the agent is holding, folded to the count of what is done.
 */
const meta = {
  title: 'Components/PlanPanel',
  component: PlanPanel,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    entries: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Draw the stopped turn line', priority: 'medium', status: 'in_progress' },
      { content: 'Wire the plan into the side column', priority: 'low', status: 'pending' },
    ],
  },
  argTypes: {
    entries: { control: 'object', description: 'The whole plan, as the agent last sent it.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts unfolded.' },
  },
} satisfies Meta<typeof PlanPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A plan that is being worked to: the count is read, the steps are asked for. */
export const BeingWorkedTo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = canvas.getByRole('button', { name: /Plan/ })
    await expect(summary).toHaveTextContent('1 of 3')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(summary)
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Draw the stopped turn line')).toBeVisible()
  },
}

/** Every step done, which the count says without the panel being opened. */
export const Done: Story = {
  args: {
    entries: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Draw the stopped turn line', priority: 'medium', status: 'completed' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Plan/ })).toHaveTextContent('2 of 2')
  },
}

/** An agent that has not sent one, said rather than left as an empty box. */
export const NothingYet: Story = {
  args: { entries: [], defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('The agent has not sent a plan.')).toBeVisible()
  },
}
