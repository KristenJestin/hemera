import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconBell } from '../../icons.ts'
import { Button, IconButton } from '../button/button.tsx'
import { Popover } from './popover.tsx'

const meta = {
  title: 'Components/Popover',
  component: Popover,
  args: {
    title: 'Notifications',
    trigger: <IconButton variant="ghost" icon={<IconBell />} aria-label="Notifications" />,
    children: <p className="text-muted-foreground">Nothing yet.</p>,
  },
  argTypes: {
    title: { control: 'text' },
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
    align: { control: 'select', options: ['start', 'center', 'end'] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-4">
      <Popover {...args} title="Below" trigger={<Button>Below</Button>} side="bottom" />
      <Popover {...args} title="Beside" trigger={<Button>Beside</Button>} side="right" />
    </div>
  ),
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Notifications' })
    await userEvent.click(trigger)
    const panel = await waitFor(() => within(document.body).getByRole('dialog'))
    expect(within(panel).getByText('Nothing yet.')).toBeInTheDocument()

    // A click outside closes it: a panel with only one way out is a trap.
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Scenario « Overlay au-dessus de la coquille et focus rendu » of `specs/window-shell/spec.md`. */
export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Notifications' })

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)

    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
    })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    // The focus comes back to what opened it, instead of falling to the top of the page.
    expect(document.activeElement).toBe(trigger)
  },
}
