import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Checkbox } from './checkbox.tsx'

/** A box whose state the story keeps, so ticking it in the canvas does what it says. */
function Kept({
  initial,
  label,
  description,
  disabled,
}: {
  initial: boolean
  label: string
  description?: string
  disabled?: boolean
}) {
  const [checked, setChecked] = useState(initial)
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={setChecked}
      label={label}
      description={description}
      disabled={disabled}
    />
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  args: {
    checked: false,
    label: 'Include in every new Workspace',
    onCheckedChange: fn(),
  },
  argTypes: {
    checked: { control: 'boolean', description: 'Whether the box is ticked.' },
    label: { control: 'text', description: 'The words beside the box, which are its name.' },
    description: { control: 'text', description: 'A muted line under the label.' },
    hiddenLabel: {
      control: 'text',
      description: 'Words a screen reader hears after the label, where the label repeats.',
    },
    disabled: { control: 'boolean' },
    onCheckedChange: { description: 'Called with the new state when the box is toggled.' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

/** One box, in whichever state you ask for. */
export const Playground: Story = {}

/** With a label alone, and with a line that says what ticking it does. */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <Kept initial={false} label="Serve through Portless" />
      <Kept
        initial
        label="Include in every new Workspace"
        description="A dedicated Workspace gets a worktree of it unless it is left out."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('checkbox', { name: /portless/i })).not.toBeChecked()
    expect(canvas.getByRole('checkbox', { name: /every new workspace/i })).toBeChecked()
  },
}

/** Unticked, ticked, and both of them disabled. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-3">
      <Kept initial={false} label="Unticked" />
      <Kept initial label="Ticked" />
      <Kept initial={false} label="Unticked, disabled" disabled />
      <Kept initial label="Ticked, disabled" disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const ticked = canvas.getByRole('checkbox', { name: 'Ticked' })
    const plain = canvas.getByRole('checkbox', { name: 'Unticked' })
    // The ticked box wears the theme's primary role, and the unticked one does not.
    expect(getComputedStyle(ticked).backgroundColor).not.toBe(
      getComputedStyle(plain).backgroundColor,
    )
    expect(canvas.getByRole('checkbox', { name: 'Ticked, disabled' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** Tab reaches the box, Space ticks it, and a press on its words ticks it as well. */
export const Keyboard: Story = {
  parameters: { controls: { disable: true } },
  render: () => <Kept initial={false} label="Serve through Portless" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('checkbox', { name: /portless/i })
    await userEvent.tab()
    expect(document.activeElement).toBe(box)
    await userEvent.keyboard(' ')
    expect(box).toBeChecked()
    await userEvent.click(canvas.getByText('Serve through Portless'))
    expect(box).not.toBeChecked()
  },
}
