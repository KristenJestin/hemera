import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { PlanPanel, type PlanEntry } from './plan-panel.tsx'

/**
 * The plan the agent is holding: its own list of steps, each with the state it is in, folded to
 * the count of what is done — and, in the folded line, the step it is on now.
 *
 * A plan arrives whole from the agent and replaces what was there, so what the panel ever draws
 * is one list and not two. The stories below keep a plan of the size a real one is — a handful of
 * steps, some done, one being worked on, the rest waiting — because a plan of one entry says
 * nothing about how the list reads.
 */
const PLANNED: PlanEntry[] = [
  { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
  { content: 'Draw the stopped turn line', priority: 'medium', status: 'completed' },
  { content: 'Wire the plan into the side column', priority: 'high', status: 'in_progress' },
  { content: 'Fold the tool calls by default', priority: 'medium', status: 'pending' },
  { content: 'Say what a rebuilt thread is', priority: 'medium', status: 'pending' },
  { content: 'Hand the lot to the gate', priority: 'low', status: 'pending' },
]

const meta = {
  title: 'Components/PlanPanel',
  component: PlanPanel,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { entries: PLANNED },
  argTypes: {
    entries: { control: 'object', description: 'The whole plan, as the agent last sent it.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts unfolded.' },
  },
} satisfies Meta<typeof PlanPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A plan being worked to: the count, the step in hand, and the steps behind a press. */
export const BeingWorkedTo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const summary = canvas.getByRole('button', { name: /Plan/ })
    await expect(summary).toHaveTextContent('2 of 6')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    // What the agent is doing now is read without opening anything.
    await expect(summary).toHaveTextContent('Wire the plan into the side column')

    await userEvent.click(summary)
    await expect(summary).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Fold the tool calls by default')).toBeVisible()
    await expect(canvas.getByText('Hand the lot to the gate')).toBeVisible()
    // One chip, on the step that has earned it: the one in progress.
    await expect(canvas.getAllByText('High')).toHaveLength(1)
  },
}

/** The same plan, every step of it behind the reader. */
const ALL_DONE: PlanEntry[] = [
  { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
  { content: 'Draw the stopped turn line', priority: 'medium', status: 'completed' },
  { content: 'Wire the plan into the side column', priority: 'high', status: 'completed' },
  { content: 'Fold the tool calls by default', priority: 'medium', status: 'completed' },
  { content: 'Say what a rebuilt thread is', priority: 'medium', status: 'completed' },
  { content: 'Hand the lot to the gate', priority: 'low', status: 'completed' },
]

/** Every step done, which the count says without the panel being opened. */
export const Done: Story = {
  args: { entries: ALL_DONE, defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Plan/ })).toHaveTextContent('6 of 6')
    // Nothing is left to do, so nothing is flagged as urgent.
    await expect(canvas.queryByText('High')).toBeNull()
  },
}

/** A step being worked on is the only one whose priority is still worth saying. */
export const OneStepInHand: Story = {
  args: {
    entries: [
      { content: 'Read the session page and the scroller', priority: 'high', status: 'completed' },
      { content: 'Wire the plan into the side column', priority: 'high', status: 'in_progress' },
    ],
    defaultOpen: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('High')).toHaveLength(1)
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
