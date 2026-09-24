import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { TASKS } from './spec-fixtures.ts'
import { TasksPart } from './tasks-part.tsx'

const MARKS = ['empty', 'agent', 'human', 'stale', 'conflict', 'writing']

/** The tasks of the Spec document: what each waits on, what it covers, and who runs it. */
const meta = {
  title: 'Blocks/Spec/TasksPart',
  component: TasksPart,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { tasks: TASKS, mark: 'agent' },
  argTypes: {
    tasks: { control: 'object', description: 'The tasks, in order.' },
    mark: {
      control: 'select',
      options: MARKS,
      description: 'The state, said to a screen reader in the heading.',
    },
  },
} satisfies Meta<typeof TasksPart>

export default meta

type Story = StoryObj<typeof meta>

/** Four slices, the last one yours: `after T2`, `covers S1`, `human` as small chips. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Tasks · 4/ })).toBeVisible()
    await expect(canvas.getByText('1 for you')).toBeVisible()
    const last = canvas.getByText('The file imports into the ledger').closest('li')!
    await expect(within(last).getByText('after T2')).toBeVisible()
    await expect(within(last).getByText('covers S2')).toBeVisible()
    await expect(within(last).getByText('human')).toBeVisible()
  },
}

/** Before Decompose: no task, and the facts say when they come. */
export const BeforeDecompose: Story = {
  args: { tasks: [], mark: 'empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('after decompose')).toBeVisible()
    await expect(canvas.getByText(/Tasks are written in Decompose/)).toBeVisible()
  },
}

/** Copied by a Rework, and to review until the agent goes over Decompose again. */
export const Stale: Story = {
  args: { mark: 'stale' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('to review')).toBeVisible()
  },
}
