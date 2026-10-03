import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconDots, IconFolder, IconPencil, IconPlus, IconTrash } from '../../icons.ts'
import type { MenuItem } from './menu.tsx'
import { Menu } from './menu.tsx'

/** The commands of a Project, in two groups, with a separator between them. */
function commands(onSelect: () => void): MenuItem[][] {
  return [
    [
      { label: 'Add a repository', icon: <IconPlus size="sm" />, shortcut: 'Ctrl N', onSelect },
      { label: 'Rename', icon: <IconPencil size="sm" />, shortcut: 'F2', onSelect },
    ],
    [{ label: 'Delete', icon: <IconTrash size="sm" />, disabled: true, onSelect }],
  ]
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/Menu',
  component: Menu,
  args: { label: 'Acme', groups: commands(fn()) },
  argTypes: {
    label: { control: 'text' },
    disabled: { control: 'boolean' },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    icon: { table: { disable: true } },
    trigger: { table: { disable: true } },
    groups: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

/** Closed: a trigger that says what it opens. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Acme' })).toBeInTheDocument()
    expect(within(document.body).queryByRole('menu')).toBeNull()
  },
}

/** Open: the groups parted by a line, the keystrokes drawn as keys, a refused command greyed. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Acme' }))
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    const inside = within(menu)
    expect(inside.getByText('Ctrl')).toBeInTheDocument()
    expect(menu.querySelector('[role="separator"]')).not.toBeNull()
    expect(inside.getByRole('menuitem', { name: /delete/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
  },
}

/** A trigger that is one icon: the label stays the control's name, read by a screen reader. */
export const IconTrigger: Story = {
  args: { label: 'Rename or delete Acme', icon: <IconDots size="sm" /> },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Rename or delete Acme' })
    expect(trigger).not.toHaveTextContent('Rename')
  },
}

/** A trigger of the caller's own, and a quiet word at the end of each command. */
export const CustomTrigger: Story = {
  args: {
    label: 'api, switch to another repository',
    trigger: (
      <>
        <IconFolder size="sm" aria-hidden="true" />
        <span className="font-medium">api</span>
        <span className="text-muted-foreground">1 of 3</span>
      </>
    ),
    groups: [
      [
        { label: 'api', detail: 'main', onSelect: fn() },
        { label: 'web', detail: 'main', onSelect: fn() },
        { label: 'shared', detail: 'release', onSelect: fn() },
      ],
    ],
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'api, switch to another repository',
    })
    await userEvent.click(trigger)
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    expect(within(menu).getByRole('menuitem', { name: /^shared/ })).toHaveTextContent(/release$/)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  },
}

/** Refused: the trigger cannot be pressed. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Acme' })).toBeDisabled()
  },
}

/** From the keyboard: the arrow opens it on its first command, Escape gives the focus back. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Acme' })
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{ArrowDown}')
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(menu).getByRole('menuitem', { name: /add a repository/i }),
      )
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('menu')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}
