import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { IconSearch } from '../../icons.ts'
import { Input, Textarea } from './field.tsx'

const meta = {
  title: 'Components/Field',
  component: Input,
  args: { label: 'Name' },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const Variants: Story = {
  render: () => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input label="Name" placeholder="Hemera" />
      <Input label="Search" icon={<IconSearch size="sm" />} placeholder="Find a session" />
      <Textarea label="Notes" placeholder="What happened" />
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
  render: () => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input label="Project" description="The folder Hemera works in" placeholder="~/work" />
      <Input label="Branch" error="A branch name has no spaces" defaultValue="my branch" />
      <Input label="Locked" disabled defaultValue="Cannot be changed" />
      <Textarea label="Summary" error="Say something" />
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
  render: () => (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <Input label="First" />
      <Textarea label="Second" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByLabelText('First')
    const second = canvas.getByLabelText('Second')

    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    await userEvent.type(first, 'hemera')
    expect(first).toHaveValue('hemera')

    await userEvent.tab()
    expect(document.activeElement).toBe(second)

    // The box follows the text rather than scrolling it.
    const before = second.getBoundingClientRect().height
    await userEvent.type(second, 'one{Enter}two{Enter}three{Enter}four{Enter}five')
    expect(second.getBoundingClientRect().height).toBeGreaterThan(before)
  },
}

export const Light: Story = {
  args: { label: 'Name', placeholder: 'Hemera' },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { label: 'Name', placeholder: 'Hemera' },
  globals: { theme: 'dark' },
}
