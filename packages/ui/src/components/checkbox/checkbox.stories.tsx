import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Checkbox, type CheckboxProps } from './checkbox.tsx'

/** A box whose state the story keeps, so ticking it in the canvas does what it says. */
function Kept(props: CheckboxProps) {
  const [checked, setChecked] = useState(props.checked)
  return <Checkbox {...props} checked={checked} onCheckedChange={setChecked} />
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { checked: false, label: 'Fetch on open', onCheckedChange: fn() },
  argTypes: {
    checked: { control: 'boolean' },
    label: { control: 'text' },
    description: { control: 'text' },
    hiddenLabel: { control: 'text' },
    disabled: { control: 'boolean' },
    className: { table: { disable: true } },
  },
  render: (args) => <Kept {...args} />,
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

/** How much of the tick is drawn, from nothing (0) to all of it (1), as motion writes it. */
function drawnOf(box: HTMLElement): number {
  return Number.parseFloat(box.querySelector('path')!.getAttribute('stroke-dasharray') ?? '0')
}

/** Not ticked: an empty box, no tick drawn. */
export const Unchecked: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Fetch on open' })
    expect(box).not.toBeChecked()
    expect(drawnOf(box)).toBe(0)
  },
}

/** Ticked: the filled box and its tick, drawn whole. */
export const Checked: Story = {
  args: { checked: true },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Fetch on open' })
    expect(box).toBeChecked()
    expect(drawnOf(box)).toBe(1)
  },
}

/** With a line under the label that says what ticking it does. */
export const Described: Story = {
  args: {
    checked: true,
    label: 'Include in every new Workspace',
    description: 'A new Workspace gets a worktree of this repository unless it is left out.',
  },
}

/** Refused, ticked or not: greyed, and out of the hand's reach. */
export const Disabled: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Checkbox checked={false} onCheckedChange={fn()} label="Unticked, disabled" disabled />
      <Checkbox checked onCheckedChange={fn()} label="Ticked, disabled" disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('checkbox', { name: 'Ticked, disabled' }),
    ).toHaveAttribute('aria-disabled', 'true')
  },
}

/** From the keyboard: Tab reaches the box, Space ticks it, and a press on its words as well. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: 'Fetch on open' })
    await userEvent.tab()
    expect(document.activeElement).toBe(box)
    await userEvent.keyboard(' ')
    expect(box).toBeChecked()
    await waitFor(() => {
      expect(drawnOf(box)).toBe(1)
    })
    await userEvent.click(canvas.getByText('Fetch on open'))
    expect(box).not.toBeChecked()
    await waitFor(() => {
      expect(drawnOf(box)).toBe(0)
    })
  },
}
