import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ConflictBanner } from './conflict-banner.tsx'

/** Your text was written on an older version: compare, apply yours, or let it go. */
const meta = {
  title: 'Blocks/Spec/ConflictBanner',
  component: ConflictBanner,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    base: 3,
    current: 5,
    comparing: false,
    onCompare: fn(),
    onApply: fn(),
    onDiscard: fn(),
  },
  argTypes: {
    base: { control: 'number', description: 'The version your text was written on.' },
    current: { control: 'number', description: 'The version the section is at.' },
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
      canvas.getByText('Your text was written on v3; the section is at v5.'),
    ).toBeVisible()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Compare' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onCompare).toHaveBeenCalled()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Apply mine on v5' })).toHaveFocus()
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
