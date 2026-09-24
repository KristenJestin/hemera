import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ReaderBar } from './reader-bar.tsx'

/** A Session reading a draft another one writes, and the one way to take the right over. */
const meta = {
  title: 'Blocks/Spec/ReaderBar',
  component: ReaderBar,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { writer: 'Spec CSV', takeOverRefused: null, onTakeOver: fn() },
  argTypes: {
    writer: { control: 'text', description: 'The Session that holds the write right.' },
    takeOverRefused: {
      control: 'text',
      description: 'Why `Take over` is refused now — the writer is running a turn — or null.',
    },
    onTakeOver: { description: 'Takes the write right, at once.' },
  },
} satisfies Meta<typeof ReaderBar>

export default meta

type Story = StoryObj<typeof meta>

/** Written by « Spec CSV », read here; `Take over` hands the right to this Session. */
export const Reading: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('« Spec CSV »')).toBeVisible()
    await expect(canvas.getByText(/you read/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Take over' }))
    await expect(args.onTakeOver).toHaveBeenCalled()
  },
}

/**
 * The writer is running a turn: `Take over` is disabled, and the bar says why, which the button
 * is described by (Decided 14).
 */
export const TakeOverRefused: Story = {
  args: {
    takeOverRefused:
      'The Session "Spec CSV" is running a turn on ATL-7: take over once it ends.',
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Take over' })
    await expect(button).toBeDisabled()
    await expect(button).toHaveAccessibleDescription(
      'The Session "Spec CSV" is running a turn on ATL-7: take over once it ends.',
    )
    await userEvent.click(button, { pointerEventsCheck: 0 })
    await expect(args.onTakeOver).not.toHaveBeenCalled()
  },
}
