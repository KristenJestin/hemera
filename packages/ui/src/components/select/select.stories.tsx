import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconFolder, IconGitBranch } from '../../icons.ts'
import { PRESS_EDGE } from '../../motion.ts'
import { Select } from './select.tsx'

const BRANCHES = [
  { value: 'main', label: 'main' },
  { value: 'release', label: 'release' },
  { value: 'legacy', label: 'legacy', disabled: true },
]

const REPOSITORIES = [
  {
    label: 'Acme',
    items: [
      { value: 'api', label: 'api', icon: <IconFolder size="sm" /> },
      { value: 'web', label: 'web', icon: <IconFolder size="sm" /> },
    ],
  },
  {
    label: 'Shared',
    items: [{ value: 'shared', label: 'shared', icon: <IconFolder size="sm" /> }],
  },
]

const meta = {
  tags: ['autodocs'],
  title: 'Components/Select',
  component: Select,
  args: { label: 'Branch', items: BRANCHES, onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    defaultValue: { control: 'select', options: ['main', 'release', 'legacy'] },
    disabled: { control: 'boolean' },
    tooltip: { control: 'text' },
    items: { table: { disable: true } },
    mark: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Select<string>>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing chosen yet: the placeholder says what to do. */
export const Empty: Story = {
  args: { placeholder: 'Choose a branch' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Branch')).toHaveTextContent('Choose a branch')
  },
}

/** A value chosen, with a mark at the head of the trigger saying what the value is about. */
export const Filled: Story = {
  args: { defaultValue: 'main', mark: <IconGitBranch size="sm" /> },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Branch')).toHaveTextContent('main')
  },
}

/** Open: named groups, a refused item, the list as wide as its trigger and below it. */
export const Open: Story = {
  args: { label: 'Repository', items: REPOSITORIES, defaultValue: 'web' },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Repository')
    await userEvent.click(trigger)
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    expect(within(list).getByText('Acme')).toBeInTheDocument()
    expect(within(list).getByText('Shared')).toBeInTheDocument()
    for (const option of within(list).getAllByRole('option')) {
      expect(getComputedStyle(option).cursor).toBe('pointer')
    }
    expect(getComputedStyle(trigger).cursor).toBe('pointer')
    const popup = list.getBoundingClientRect()
    expect(popup.top).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().top)
    expect(popup.width).toBeGreaterThanOrEqual(trigger.offsetWidth - 1)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
  },
}

/** Refused: it shows its value and cannot be opened. */
export const Disabled: Story = {
  args: { defaultValue: 'release', disabled: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Branch')).toHaveAttribute('data-disabled')
  },
}

/** From the keyboard: the arrows walk the list, Enter chooses, Escape gives the focus back. */
export const Focused: Story = {
  args: { defaultValue: 'main' },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Branch')
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{ArrowDown}')
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    const highlighted = (): Element | null =>
      document.querySelector('[role="option"][data-highlighted]')
    await waitFor(() => {
      expect(highlighted()).toHaveTextContent('main')
    })
    await waitFor(() => {
      expect(list.contains(document.activeElement)).toBe(true)
    })
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(highlighted()).toHaveTextContent('release')
    })
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onValueChange).toHaveBeenCalledWith('release')
    })
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}

/** Held under the hand: a select as wide as its column goes in by the same pixels as a button. */
export const Pressed: Story = {
  parameters: { layout: 'padded' },
  args: { defaultValue: 'main', className: 'w-full' },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Branch')
    const rest = trigger.getBoundingClientRect()
    await userEvent.hover(trigger)
    fireEvent.pointerDown(trigger, { isPrimary: true, button: 0, pointerId: 1 })
    const pressed = await waitFor(() => {
      const box = trigger.getBoundingClientRect()
      if ((rest.width - box.width) / 2 < 1.2) throw new Error('not pressed yet')
      return box
    })
    fireEvent.pointerUp(trigger, { isPrimary: true, button: 0, pointerId: 1 })
    await userEvent.unhover(trigger)
    for (const edge of [(rest.width - pressed.width) / 2, (rest.height - pressed.height) / 2]) {
      expect(edge).toBeGreaterThan(0)
      expect(edge).toBeLessThanOrEqual(PRESS_EDGE + 0.05)
    }
    await userEvent.keyboard('{Escape}')
  },
}
