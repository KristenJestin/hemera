import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Kbd } from './kbd.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Kbd',
  component: Kbd,
  args: { keys: 'Ctrl+K' },
  argTypes: {
    keys: { control: 'text' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

/** One key alone. */
export const Single: Story = {
  args: { keys: 'Esc' },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('kbd')).toHaveLength(1)
  },
}

/** A chord: one cap per key, whichever way the platform writes the keystroke. */
export const Chord: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Kbd keys="Ctrl+Shift+P" />
      <Kbd keys="⌘ K" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Shift')).toBeInTheDocument()
    expect(canvas.getByText('⌘')).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('kbd')).toHaveLength(5)
  },
}
