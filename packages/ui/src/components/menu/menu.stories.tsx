import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { Menu } from './menu.tsx'

const meta = {
  title: 'Components/Menu',
  component: Menu,
  args: { label: 'Session', groups: [] },
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

const GROUPS = [
  [
    { label: 'New session', icon: <IconPlus size="sm" />, shortcut: 'Ctrl N' },
    { label: 'Settings', icon: <IconSettings size="sm" />, shortcut: 'Ctrl ,' },
  ],
  [{ label: 'Delete', icon: <IconTrash size="sm" />, disabled: true }],
]

export const Variants: Story = {
  render: () => (
    <div className="flex items-start gap-4">
      <Menu label="Session" groups={GROUPS} />
      <Menu label="Locked" groups={GROUPS} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Session' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Locked' })).toBeDisabled()
  },
}

export const States: Story = {
  render: () => <Menu label="Session" groups={GROUPS} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Session' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    const inside = within(menu)

    // A shortcut is shown beside the command it stands for, and a separator sits between groups.
    expect(inside.getByText('Ctrl N')).toBeInTheDocument()
    expect(menu.querySelector('[role="separator"]')).not.toBeNull()
    expect(inside.getByRole('menuitem', { name: /delete/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}

export const Keyboard: Story = {
  render: () => {
    const chosen: string[] = []
    return (
      <Menu
        label="Session"
        groups={[
          [
            { label: 'New session', shortcut: 'Ctrl N', onSelect: () => chosen.push('new') },
            { label: 'Settings', shortcut: 'Ctrl ,' },
          ],
          [{ label: 'Delete', disabled: true }],
        ]}
      />
    )
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

export const Light: Story = {
  args: { label: 'Session', groups: GROUPS },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { label: 'Session', groups: GROUPS },
  globals: { theme: 'dark' },
}
