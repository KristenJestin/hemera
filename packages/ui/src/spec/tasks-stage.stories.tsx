import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { TASKS } from './spec-fixtures.ts'
import { TasksStage } from './tasks-stage.tsx'

/** The tasks of a Spec: what each waits on, what it covers, and who runs it. */
const meta = {
  title: 'Blocks/Spec/TasksStage',
  component: TasksStage,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { tasks: TASKS },
  argTypes: {
    tasks: { control: 'object', description: 'The tasks, in order.' },
    stale: { control: 'boolean', description: 'Stale after a rework.' },
  },
} satisfies Meta<typeof TasksStage>

export default meta

type Story = StoryObj<typeof meta>

/** Four slices, the last one yours: `after T2`, `covers S1`, `human` as small chips. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('4 tasks, 1 for you')).toBeVisible()
    const last = canvas.getByText('The file imports into the ledger').closest('li')!
    await expect(within(last).getByText('after T2')).toBeVisible()
    await expect(within(last).getByText('covers S2')).toBeVisible()
    await expect(within(last).getByText('human')).toBeVisible()
  },
}

/** Before Decompose: no task, and the line says when they come. */
export const BeforeDecompose: Story = {
  args: { tasks: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Tasks are written in Decompose/)).toBeVisible()
  },
}

/** Copied by a rework, and stale until Decompose is declared again. */
export const Stale: Story = {
  args: { stale: true },
}
