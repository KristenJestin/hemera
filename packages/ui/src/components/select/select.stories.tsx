import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconMoon, IconSun } from '../../icons.ts'
import { Select } from './select.tsx'

const FLAT = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku', disabled: true },
]

/** The same list with an icon on every item, which is what a theme or a mission looks like. */
const WITH_ICONS = [
  { value: 'light', label: 'Light', icon: <IconSun size="sm" /> },
  { value: 'dark', label: 'Dark', icon: <IconMoon size="sm" /> },
]

const GROUPED = [
  { label: 'Anthropic', items: FLAT },
  { label: 'Local', items: [{ value: 'llama', label: 'Llama' }] },
]

const meta = {
  title: 'Components/Select',
  component: Select,
  args: { label: 'Model', items: FLAT, onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    placeholder: { control: 'text' },
    defaultValue: { control: 'select', options: ['opus', 'sonnet', 'haiku', 'llama'] },
    disabled: { control: 'boolean' },
    items: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Select<string>>

export default meta
type Story = StoryObj<typeof meta>

/** Open it, choose, and watch each choice land in the Actions panel. */
export const Playground: Story = {
  args: { defaultValue: 'opus' },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-start gap-4">
      <Select {...args} label="Model" items={FLAT} defaultValue="opus" />
      <Select {...args} label="Grouped model" items={GROUPED} placeholder="Pick one" />
      <Select {...args} label="Theme" items={WITH_ICONS} defaultValue="dark" />
      <Select {...args} label="Locked" items={FLAT} defaultValue="sonnet" disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByLabelText('Model')).toHaveTextContent('Opus')
    expect(canvas.getByLabelText('Grouped model')).toHaveTextContent('Pick one')
    expect(canvas.getByLabelText('Theme')).toHaveTextContent('Dark')
    expect(canvas.getByLabelText('Locked')).toHaveAttribute('data-disabled')
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { items: GROUPED, defaultValue: 'sonnet' },
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

    // It hangs off the trigger and never rises over it. Base UI would otherwise lay the chosen
    // item on the trigger the way a native macOS menu does, which puts the top of the list
    // above the control whenever the chosen item is not the first — the list swallows the
    // thing it belongs to and nothing on screen says where it came from. How far below it
    // lands is the browser's business, since there is not always room.
    const popup = list.getBoundingClientRect()
    const control = trigger.getBoundingClientRect()
    expect(popup.top, 'the list rises over the trigger it belongs to').toBeGreaterThanOrEqual(
      control.top,
    )
    expect(popup.width).toBeGreaterThanOrEqual(control.width)

    await userEvent.keyboard('{Escape}')
  },
}

export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { defaultValue: 'opus' },
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Model')

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)

    // An arrow opens the list, the next one moves, Enter chooses.
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(within(document.body).getByRole('listbox')).toBeInTheDocument()
    })
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => {
      expect(args.onValueChange).toHaveBeenCalledWith('sonnet')
    })

    // Escape closes it, and the trigger gets the focus back.
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(within(document.body).getByRole('listbox')).toBeInTheDocument()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}
