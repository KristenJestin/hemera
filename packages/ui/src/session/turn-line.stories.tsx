import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { onOneLine } from '../../.storybook/one-line.ts'
import { TurnLine } from './turn-line.tsx'

/**
 * The row above the box: what the turn is doing on the left, what it has spent on the right.
 *
 * Drawn at the foot of a column, as the page draws it above the composer: the row grows upwards
 * when the thought it carries opens, and the meter stays at its foot (issue #134).
 */
const THOUGHT = `The join on invoice_lines is the cost, not the formatting. Streaming will not fix
it on its own, so the query goes first and the loop after. The index on invoice_id is there, but
the planner does not use it on the export's own query, which sorts on the date first.`

const USAGE = { used: 12_400, size: 200_000, cost: { amount: 0.42, currency: 'EUR' } }

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Session/TurnLine',
  component: TurnLine,
  parameters: { layout: 'fullscreen' },
  args: { activity: { state: 'thinking', thought: THOUGHT }, usage: USAGE },
  argTypes: {
    activity: { control: 'object', description: 'What the turn is doing, or null.' },
    usage: { control: 'object', description: 'What the Session has spent, or null.' },
  },
  // The foot of a column, as above the composer: what grows, grows upwards.
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col justify-end p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TurnLine>

export default meta
type Story = StoryObj<typeof meta>

/** Folded: what the turn is doing and what it has spent read as one line. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const doing = canvas.getByText('Thinking…')
    const meter = canvas.getByLabelText(/12,400 of 200,000 tokens used/)
    await expect(onOneLine(doing, meter), 'the meter left the activity’s line').toBe(true)
  },
}

/**
 * The thought open: the row grows upwards from the box, and the meter stays at its foot, where it
 * was before the thought opened (recette of 26 September 2026).
 */
export const ThoughtOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const meter = canvas.getByLabelText(/12,400 of 200,000 tokens used/)
    const foot = meter.getBoundingClientRect().bottom
    const row = canvas.getByRole('button', { name: /Thinking…/ })
    await userEvent.click(row)
    await expect(canvas.getByText(/The join on invoice_lines is the cost/)).toBeVisible()
    // Once the thought has finished opening, the line it opened from has risen above the meter,
    // and the meter has not moved.
    await waitFor(() => {
      expect(row.getBoundingClientRect().bottom).toBeLessThan(meter.getBoundingClientRect().top)
    })
    await expect(meter.getBoundingClientRect().bottom, 'the meter moved').toBe(foot)
  },
}

/** Nothing running since the last message: the meter alone, at its end of the row. */
export const MeterOnly: Story = {
  args: { activity: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText(/12,400 of 200,000 tokens used/)).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}
