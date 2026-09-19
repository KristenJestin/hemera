import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { Menu } from './menu.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Menu',
  component: Menu,
  args: { label: 'Session', groups: [] },
  argTypes: {
    label: { control: 'text' },
    disabled: { control: 'boolean' },
    groups: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

/** Each command reports itself in the Actions panel when it is chosen. */
function commands(onSelect: () => void) {
  return [
    [
      { label: 'New session', icon: <IconPlus size="sm" />, shortcut: 'Ctrl N', onSelect },
      { label: 'Settings', icon: <IconSettings size="sm" />, shortcut: 'Ctrl ,', onSelect },
    ],
    [{ label: 'Delete', icon: <IconTrash size="sm" />, disabled: true, onSelect }],
  ]
}

export const Playground: Story = {
  args: { groups: commands(fn()) },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-start gap-4">
      <Menu {...args} label="Session" groups={commands(fn())} />
      <Menu {...args} label="Locked" groups={commands(fn())} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Session' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Locked' })).toBeDisabled()
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { groups: commands(fn()) },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Session' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    const inside = within(menu)

    // A shortcut is shown beside the command it stands for, and a separator sits between groups.
    // The keystroke is drawn as keys, one cap each, the way every shortcut of the shell is.
    expect(inside.getAllByText('Ctrl').length).toBeGreaterThan(0)
    expect(inside.getByText('N')).toBeInTheDocument()
    expect(menu.querySelector('[role="separator"]')).not.toBeNull()
    expect(inside.getByRole('menuitem', { name: /delete/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // Closed before the story ends, and waited for: the accessibility pass runs on whatever is
    // on the page when the play is over, and a popup on its way out is not what it judges.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: function Keyboard(args) {
    const chosen = fn()
    return <Menu {...args} groups={commands(chosen)} />
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Session' })

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)

    // An arrow opens the menu and lands on the first command; Escape hands the focus back.
    await userEvent.keyboard('{ArrowDown}')
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(menu).getByRole('menuitem', { name: /new session/i }),
      )
    })

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}
