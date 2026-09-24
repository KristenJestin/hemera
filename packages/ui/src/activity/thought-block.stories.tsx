import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ThoughtBlock } from './thought-block.tsx'

/**
 * What the agent thought before it acted (design D17-05).
 *
 * Two stories, which are the two states of it: folded, which is what a turn shows, and open,
 * which is what a reader who wants to know why the turn went the way it did asks for. What is
 * being judged here is the line — an agent thinks for four seconds and says forty lines, and
 * the forty lines have to cost the thread one.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Message/ThoughtBlock',
  component: ThoughtBlock,
  parameters: { layout: 'padded' },
  args: {
    seconds: 6,
    children:
      'The migration has to add the table without rewriting the sessions already on disk. A new table plus a backfill is the only shape that survives a downgrade, so the entries move in a second statement.',
  },
  argTypes: {
    seconds: { control: 'number', description: 'How long it thought, as the notification says.' },
    children: { control: 'text', description: 'What it thought, handed over already written.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts open.' },
  },
} satisfies Meta<typeof ThoughtBlock>

export default meta

type Story = StoryObj<typeof meta>

/** Folded, which is how a thought arrives in a thread. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Thought for 6s/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByText('Thought for 6s')).toBeVisible()
  },
}

/** Open, which is the answer to “why did it do that”. */
export const Opened: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Thought for 6s/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/A new table plus a backfill/)).toBeVisible()
    await userEvent.click(row)
    await expect(row, 'the thought does not fold when the reader asks it to').toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}
