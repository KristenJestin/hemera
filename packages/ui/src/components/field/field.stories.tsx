import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconSearch } from '../../icons.ts'
import { Input, Textarea } from './field.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Field',
  component: Input,
  args: { label: 'Name', placeholder: 'Hemera', onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    icon: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Type in it and the Actions panel shows each value as the field reports it. Put something in
 * `error` and watch the control turn invalid and point at the message.
 */
export const Playground: Story = {
  decorators: [
    (Story) => (
      <div className="w-full max-w-xs">
        <Story />
      </div>
    ),
  ],
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input {...args} label="Name" />
      <Input
        {...args}
        label="Search"
        icon={<IconSearch size="sm" />}
        placeholder="Find a session"
      />
      <Textarea {...args} label="Notes" placeholder="What happened" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Every control is reachable by its label, which is the whole point of the field.
    expect(canvas.getByLabelText('Name')).toBeInTheDocument()
    expect(canvas.getByLabelText('Search')).toBeInTheDocument()
    expect(canvas.getByLabelText('Notes')).toBeInTheDocument()
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input
        {...args}
        label="Project"
        description="The folder Hemera works in"
        placeholder="~/work"
      />
      <Input
        {...args}
        label="Branch"
        error="A branch name has no spaces"
        defaultValue="my branch"
      />
      <Input {...args} label="Locked" disabled defaultValue="Cannot be changed" />
      <Textarea {...args} label="Summary" error="Say something" placeholder="" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const invalid = canvas.getByLabelText('Branch')
    // The error is announced because the control points at it, not because it is nearby.
    expect(invalid).toHaveAttribute('aria-invalid', 'true')
    expect(invalid).toHaveAccessibleDescription('A branch name has no spaces')
    expect(canvas.getByLabelText('Project')).toHaveAccessibleDescription(
      'The folder Hemera works in',
    )
    expect(canvas.getByLabelText('Locked')).toBeDisabled()
  },
}

export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input {...args} label="First" placeholder="" />
      <Textarea {...args} label="Second" placeholder="" />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByLabelText('First')
    const second = canvas.getByLabelText('Second')

    await userEvent.tab()
    expect(document.activeElement).toBe(first)

    // The ring is visible, and it is visible on the box around the control: an input renders
    // no pseudo-element of its own, so a ring drawn on it would never appear at all.
    const ring = first.parentElement!
    await waitFor(() => {
      expect(getComputedStyle(ring, '::after').opacity).toBe('1')
    })
    expect(getComputedStyle(ring, '::after').boxShadow).not.toBe('none')

    await userEvent.type(first, 'hemera')
    expect(first).toHaveValue('hemera')
    expect(args.onValueChange).toHaveBeenCalledWith('hemera')

    await userEvent.tab()
    expect(document.activeElement).toBe(second)

    // The box follows the text rather than scrolling it.
    const before = second.getBoundingClientRect().height
    await userEvent.type(second, 'one{Enter}two{Enter}three{Enter}four{Enter}five')
    expect(second.getBoundingClientRect().height).toBeGreaterThan(before)
  },
}
