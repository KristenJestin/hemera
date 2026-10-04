import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconBan, IconDots, IconFolder, IconPencil, IconPlus, IconTrash } from '../../icons.ts'
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

/** Reads the colour a theme class resolves to on this page, off a probe. */
function colourOf(className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  document.body.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

/** The commands of a mission, the last one destructive, with or without its icon. */
function mission(icon: boolean): MenuItem[][] {
  return [
    [
      { label: 'Rename', icon: <IconPencil size="sm" />, onSelect: fn() },
      { label: 'Duplicate', icon: <IconPlus size="sm" />, onSelect: fn() },
    ],
    [
      {
        label: 'Cancel mission…',
        icon: icon ? <IconBan size="sm" /> : undefined,
        destructive: true,
        onSelect: fn(),
      },
    ],
  ]
}

/** Opens the menu and gives back its destructive item, highlighted under the keyboard. */
async function destructiveItem(canvasElement: HTMLElement): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name: 'ACME-12' }))
  const menu = await waitFor(() => within(document.body).getByRole('menu'))
  const item = within(menu).getByRole('menuitem', { name: 'Cancel mission…' })
  // Said in the destructive tone, and touched in it: a faint tint of its own, not the neutral one.
  expect(getComputedStyle(item).color).toBe(colourOf('text-destructive'))
  await userEvent.hover(item)
  await waitFor(() => {
    expect(item).toHaveAttribute('data-highlighted')
  })
  expect(getComputedStyle(item).boxShadow).toContain('inset')
  expect(item.dataset.tone).toBe('destructive')
  return item
}

/**
 * A command that cannot be undone, in the destructive tone: its words and its icon in red, and
 * the hand's tint faintly red as well.
 */
export const DestructiveItem: Story = {
  args: { label: 'ACME-12', groups: mission(true) },
  play: async ({ canvasElement }) => {
    const item = await destructiveItem(canvasElement)
    const icon = item.querySelector('svg')!
    expect(getComputedStyle(icon).color).toBe(colourOf('text-destructive'))
  },
}

/** The same command without an icon: the tone alone says it. */
export const DestructiveItemWithoutIcon: Story = {
  args: { label: 'ACME-12', groups: mission(false) },
  play: async ({ canvasElement }) => {
    const item = await destructiveItem(canvasElement)
    expect(item.querySelector('svg')).toBeNull()
  },
}
