import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { SectionMark } from './planning-marks.tsx'

/**
 * A section's state, beside its name in the list and on its heading: not written, being written,
 * written with questions still open on it, settled. The green check means settled: written, and no
 * open question will change it any more.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/SectionMark',
  component: SectionMark,
  args: { state: 'written', open: 0 },
} satisfies Meta<typeof SectionMark>

export default meta
type Story = StoryObj<typeof meta>

/** Written and no open question touches it: the green check. */
export const Settled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Settled' })).toBeVisible()
  },
}

/** Written, but two open questions will still change it: in progress, with the count. */
export const WrittenWithQuestionsOpen: Story = {
  args: { open: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Written · 2 questions open' })).toBeVisible()
    await expect(canvas.queryByRole('img', { name: 'Settled' })).toBeNull()
    await expect(canvas.getByText('2')).toBeVisible()
  },
}

/** One question open on it: said in the singular. */
export const WrittenWithAQuestionOpen: Story = {
  args: { open: 1 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Written · 1 question open' })).toBeVisible()
  },
}

/** The Planner writes it now. */
export const BeingWritten: Story = {
  args: { state: 'being_written' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Being written' })).toBeVisible()
  },
}

/** Nothing written yet. */
export const NotWritten: Story = {
  args: { state: 'empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Not written yet' })).toBeVisible()
  },
}
