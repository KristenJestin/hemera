import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { Kbd } from './kbd.tsx'

const meta = {
  title: 'Components/Kbd',
  component: Kbd,
  args: { keys: 'Ctrl+B' },
  argTypes: {
    keys: { control: 'text' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      <Kbd keys="Ctrl+K" />
      <Kbd keys="Ctrl+Shift+P" />
      <Kbd keys="⌘ K" />
      <Kbd keys="Esc" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    // One cap per key, whichever way the platform writes the keystroke.
    expect(within(canvasElement).getAllByText('Ctrl')).toHaveLength(2)
    expect(within(canvasElement).getByText('Shift')).toBeInTheDocument()
    expect(within(canvasElement).getByText('⌘')).toBeInTheDocument()
  },
}
