import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ConflictBanner } from './conflict-banner.tsx'

/** The agent changed the part while you wrote yours: compare, keep yours, or let it go. */
const meta = {
  title: 'Blocks/Spec/ConflictBanner',
  component: ConflictBanner,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    comparing: false,
    onCompare: fn(),
    onApply: fn(),
    onDiscard: fn(),
  },
  argTypes: {
    comparing: { control: 'boolean', description: 'Whether the current text is shown.' },
    onCompare: { description: 'Shows or hides the current text.' },
    onApply: { description: 'Writes yours on top of the current version.' },
    onDiscard: { description: 'Lets yours go.' },
  },
} satisfies Meta<typeof ConflictBanner>

export default meta

type Story = StoryObj<typeof meta>

/** Conflict actions, in the order the keyboard reaches them. */
export const Conflict: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The agent changed this part while you were writing yours.'),
    ).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Compare' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCompare).toHaveBeenCalled()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Keep mine' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onApply).toHaveBeenCalled()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Discard mine' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onDiscard).toHaveBeenCalled()
  },
}

/** Comparing: the Compare button stays pressed while the current text is shown. */
export const Comparing: Story = {
  args: { comparing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Compare' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
