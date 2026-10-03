import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconSearch } from '../../icons.ts'
import { Input, Textarea } from './field.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Field',
  component: Input,
  args: { label: 'Name', placeholder: 'Acme', onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    description: { control: 'text' },
    error: { control: 'text' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    icon: { table: { disable: true } },
    action: { table: { disable: true } },
    className: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="flex w-full max-w-xs flex-col gap-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing typed yet: the label above, the placeholder inside. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Name')).toHaveValue('')
  },
}

/** A value, and a line under it that says what is expected. */
export const Filled: Story = {
  args: {
    label: 'Folder',
    defaultValue: '~/work/acme',
    description: 'Where the repositories of the Project live',
  },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Folder')).toHaveAccessibleDescription(
      'Where the repositories of the Project live',
    )
  },
}

/** With an icon drawn inside the box, before the text. */
export const WithIcon: Story = {
  args: { label: 'Search', icon: <IconSearch size="sm" />, placeholder: 'Find a repository' },
}

/** Wrong: the box turns invalid and points at the message, said in words. */
export const Error: Story = {
  args: { label: 'Branch', defaultValue: 'my branch', error: 'A branch name has no spaces' },
  play: async ({ canvasElement }) => {
    const invalid = within(canvasElement).getByLabelText('Branch')
    expect(invalid).toHaveAttribute('aria-invalid', 'true')
    expect(invalid).toHaveAccessibleDescription('A branch name has no spaces')
  },
}

/** Refused: shown, and not editable. */
export const Disabled: Story = {
  args: { label: 'Remote', defaultValue: 'origin', disabled: true },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByLabelText('Remote')).toBeDisabled()
  },
}

/** Several lines: the box follows the text instead of scrolling it. */
export const Multiline: Story = {
  render: (args) => <Textarea {...args} label="Notes" placeholder="What to remember" />,
  play: async ({ canvasElement }) => {
    const notes = within(canvasElement).getByLabelText('Notes')
    const before = notes.getBoundingClientRect().height
    await userEvent.type(notes, 'one{Enter}two{Enter}three{Enter}four{Enter}five')
    expect(notes.getBoundingClientRect().height).toBeGreaterThan(before)
  },
}

/** From the keyboard: a visible ring on the box, and what is typed reported as it is typed. */
export const Focused: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByLabelText('Name')
    await userEvent.tab()
    expect(document.activeElement).toBe(field)
    // The ring is on the box around the control: an input renders no pseudo-element.
    const ring = field.parentElement!
    await waitFor(() => {
      expect(getComputedStyle(ring, '::after').opacity).toBe('1')
    })
    await userEvent.type(field, 'Acme')
    expect(args.onValueChange).toHaveBeenCalledWith('Acme')
  },
}
