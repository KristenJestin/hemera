import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { MissionBrief } from './mission-brief.tsx'

/** What Hemera handed the agent, as a thin folded line of the thread: never a card. */
const meta = {
  title: 'Blocks/Spec/MissionBrief',
  component: MissionBrief,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    title: 'What the agent was told · Plan',
    detail: '10:44',
    brief:
      '**Plan** · analyse the code and fix the technical approach of `ATL-7`, its risks and how it is verified. Shape is finished; one blocking question is open.\n\nSince the last turn you edited **Scope** (v4).',
  },
  argTypes: {
    title: { control: 'text', description: 'What the line says.' },
    detail: { control: 'text', description: 'When, or why.' },
    brief: { control: 'text', description: 'What was handed over, in Markdown.' },
  },
} satisfies Meta<typeof MissionBrief>

export default meta

type Story = StoryObj<typeof meta>

/** Folded: one line and a rule, read in passing. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /What the agent was told · Plan/ }),
    ).toHaveAttribute('aria-expanded', 'false')
  },
}

/** Unfolded: what the agent was told this turn. */
export const Unfolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /What the agent was told · Plan/ }))
    await expect(await canvas.findByText(/Since the last turn you edited/)).toBeVisible()
  },
}

/** A note with nothing to open: a Spec marked ready, said in the thread. */
export const Note: Story = {
  args: { title: 'ATL-7 marked ready', detail: '11:34', brief: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button')).toBeNull()
    await expect(canvas.getByText('ATL-7 marked ready')).toBeVisible()
  },
}
