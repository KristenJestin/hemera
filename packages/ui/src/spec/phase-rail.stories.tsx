import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { PhaseRail } from './phase-rail.tsx'
import { phases } from './spec-fixtures.ts'

/**
 * The four phases of `define` and the one sentence under them: finished, open, pending, stale
 * after a rework, and `prototype` unavailable in this version.
 */
const meta = {
  title: 'Blocks/Spec/PhaseRail',
  component: PhaseRail,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    phases: phases('finished', 'open', 'pending'),
    now: 'Plan · the agent is writing the plan',
  },
  argTypes: {
    phases: { control: 'object', description: 'The four phases, in order, with their state.' },
    now: { control: 'text', description: 'The sentence under the rail.' },
  },
} satisfies Meta<typeof PhaseRail>

export default meta

type Story = StoryObj<typeof meta>

/** Shape finished, plan open, decompose pending, prototype unavailable. */
export const MidPlan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = canvasElement.querySelector('[aria-current="step"]')
    await expect(open).toHaveTextContent('Plan, open')
    await expect(canvas.getByText('Prototype')).toHaveClass('line-through')
    await expect(canvas.getByText('Plan · the agent is writing the plan')).toBeVisible()
    // The sentence is the sentence: no `Focus:` in front of it.
    await expect(canvas.queryByText(/Focus/)).toBeNull()
  },
}

/** Shape open and waiting on an answer; nothing after it has started. */
export const Shaping: Story = {
  args: {
    phases: phases('open', 'pending', 'pending'),
    now: 'Shape · waiting for your answer on one question',
  },
}

/** Every phase finished; `prototype` still unavailable, and not a blocker. */
export const Finished: Story = {
  args: {
    phases: phases('finished', 'finished', 'finished'),
    now: 'Decompose · finished, the agent attests the contract is complete',
  },
}

/** After a rework: plan and decompose stale, each with its small `rework`. */
export const Stale: Story = {
  args: {
    phases: phases('finished', 'stale', 'stale'),
    now: 'Rework · the agent re-declares each phase',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('rework')).toHaveLength(2)
    await expect(canvas.getByText('Plan').closest('li')).toHaveTextContent('Plan, stale')
  },
}
