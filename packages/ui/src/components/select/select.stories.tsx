import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Select } from './select.tsx'

const meta = {
  title: 'Components/Select',
  component: Select,
  args: { label: 'Model', items: [] },
} satisfies Meta<typeof Select<string>>

export default meta
type Story = StoryObj<typeof meta>

const FLAT = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku', disabled: true },
]

const GROUPED = [
  { label: 'Anthropic', items: FLAT },
  { label: 'Local', items: [{ value: 'llama', label: 'Llama' }] },
]

export const Variants: Story = {
  render: () => (
    <div className="flex items-start gap-4">
      <Select label="Model" items={FLAT} defaultValue="opus" />
      <Select label="Grouped model" items={GROUPED} placeholder="Pick one" />
      <Select label="Locked" items={FLAT} defaultValue="sonnet" disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByLabelText('Model')).toHaveTextContent('Opus')
    expect(canvas.getByLabelText('Grouped model')).toHaveTextContent('Pick one')
    expect(canvas.getByLabelText('Locked')).toHaveAttribute('data-disabled')
  },
}

export const States: Story = {
  render: () => <Select label="Model" items={GROUPED} defaultValue="sonnet" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Model')
    await userEvent.click(trigger)
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    // The groups are named, and a disabled item says so rather than simply not reacting.
    expect(within(list).getByText('Anthropic')).toBeInTheDocument()
    expect(within(list).getByText('Local')).toBeInTheDocument()
    expect(within(list).getByRole('option', { name: 'Haiku' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}

export const Keyboard: Story = {
  render: () => <Select label="Model" items={FLAT} defaultValue="opus" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Model')

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)

    // An arrow opens the list, Escape closes it, and the trigger gets the focus back.
    await userEvent.keyboard('{ArrowDown}')
    const list = await waitFor(() => within(document.body).getByRole('listbox'))
    expect(list).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}

export const Light: Story = {
  args: { label: 'Model', items: FLAT, defaultValue: 'opus' },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { label: 'Model', items: FLAT, defaultValue: 'opus' },
  globals: { theme: 'dark' },
}
