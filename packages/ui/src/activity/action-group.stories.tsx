import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { AgentText } from '../message/agent-text.tsx'
import { ActionGroup } from './action-group.tsx'
import { HemeraToolCall } from './hemera-tool-call.tsx'
import { ThoughtBlock } from './thought-block.tsx'
import { ToolCallCard } from './tool-call-card.tsx'

/**
 * The tool calls of a turn between two things the agent said, folded into one row (recette of 26
 * September 2026, issue #149).
 *
 * The line says how many actions and what kinds — `read 3 files, ran 2 commands` — and a dot for
 * where the run stands; it unfolds to the rows it holds, each the row it always was. What is
 * judged here is the thread with and without it: the agent's answer, not the plumbing before it,
 * is what the eye lands on.
 */

/** The rows of a run: three reads, a thought, a command and one of Hemera's calls. */
function rows(failed = false) {
  return (
    <>
      <ToolCallCard
        title="Read src/billing/export.ts"
        kind="read"
        status="completed"
        subject={{ text: 'src/billing/export.ts' }}
      />
      <ToolCallCard
        title="Read src/billing/invoice.ts"
        kind="read"
        status="completed"
        subject={{ text: 'src/billing/invoice.ts' }}
      />
      <ThoughtBlock seconds={4}>The totals are computed in the export, not stored.</ThoughtBlock>
      <ToolCallCard
        title="Read src/billing/line.ts"
        kind="read"
        status="completed"
        subject={{ text: 'src/billing/line.ts' }}
      />
      <ToolCallCard
        title="pnpm test billing"
        kind="execute"
        status={failed ? 'failed' : 'completed'}
        subject={{ text: 'pnpm test billing' }}
        error={failed ? 'Exited with code 1.' : undefined}
      />
      <HemeraToolCall
        tool="spec_write"
        label="Write the Spec"
        subject={{ text: 'Problem' }}
        status="completed"
        summary="Wrote the problem."
      />
    </>
  )
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Activity/ActionGroup',
  component: ActionGroup,
  parameters: { layout: 'padded' },
  args: {
    count: 5,
    summary: 'read 3 files, ran 1 command, 1 Hemera call',
    status: 'completed',
    children: rows(),
  },
  argTypes: {
    count: { control: 'number', description: 'How many calls the run holds.' },
    summary: { control: 'text', description: 'What kinds they were, already written.' },
    status: {
      control: 'inline-radio',
      options: ['in_progress', 'failed', 'completed'],
      description: 'Where the run stands, as the dot at the end of the line.',
    },
    children: { table: { disable: true } },
    defaultOpen: { control: 'boolean', description: 'Whether it starts unfolded.' },
  },
} satisfies Meta<typeof ActionGroup>

export default meta

type Story = StoryObj<typeof meta>

/** Folded, which is how a run of calls arrives in the thread: one line, and what it holds said. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /5 actions/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(row).toHaveTextContent('read 3 files, ran 1 command, 1 Hemera call')
    await expect(canvas.queryByText('src/billing/export.ts')).toBeNull()
  },
}

/** Unfolded by the hand: the rows it holds, each the row it always was, folding on its own. */
export const Unfolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /5 actions/ })
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(await canvas.findByText('src/billing/export.ts')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Thought for 4s/ })).toBeVisible()
    row.focus()
    await userEvent.keyboard('{Enter}')
    await expect(row, 'the group does not fold back when asked').toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

/** Running: one of its calls has not answered yet, and the dot says so while folded. */
export const Running: Story = {
  args: { status: 'in_progress' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Running' })).toBeInTheDocument()
  },
}

/** Failed: a call went wrong, and the folded line says so rather than hiding it. */
export const Failed: Story = {
  args: { status: 'failed', children: rows(true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'One failed' })).toBeInTheDocument()
  },
}

/** In the thread: what the agent said, the run folded between, and its answer after it. */
export const InTheThread: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex max-w-3xl flex-col gap-5">
      <AgentText text="I'll look at how the export builds its totals first." />
      <ActionGroup {...args} />
      <AgentText text="The totals are computed in the export: each line needs its **HT** and **TTC** amounts." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('button', { name: /actions/ })).toHaveLength(1)
    await expect(canvas.getByText(/each line needs its/)).toBeVisible()
  },
}
