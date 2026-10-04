import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconSearch } from '../../icons.ts'
import { Kbd } from '../kbd/kbd.tsx'
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
    trailing: { table: { disable: true } },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
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
  play: async ({ canvasElement }) => {
    const { box, input, leading } = partsOf(canvasElement, 'Search')
    // Inset from the edge, and a gap before the text: never glued to either.
    expect(leading!.left - box.left).toBeGreaterThanOrEqual(8)
    expect(input.left - leading!.right).toBeGreaterThanOrEqual(8)
  },
}

/** Where the parts of a field's box stand: the box, the text, and what leads and trails it. */
interface Parts {
  readonly box: DOMRect
  readonly input: DOMRect
  readonly leading: DOMRect | null
  readonly trailing: DOMRect | null
}

function partsOf(canvasElement: HTMLElement, label: string): Parts {
  const control = within(canvasElement).getByLabelText(label)
  const box = control.closest<HTMLElement>('[data-input-box]')!
  const rectOf = (slot: string): DOMRect | null =>
    box.querySelector(`[data-slot="${slot}"]`)?.getBoundingClientRect() ?? null
  return {
    box: box.getBoundingClientRect(),
    input: control.getBoundingClientRect(),
    leading: rectOf('leading'),
    trailing: rectOf('trailing'),
  }
}

/** A hint at the end of the box — the keystroke that reaches it — inside the box, never beside. */
export const WithKbd: Story = {
  args: { label: 'Search', placeholder: 'Find a repository', trailing: <Kbd keys="Ctrl K" /> },
  play: async ({ canvasElement }) => {
    const { box, input, trailing } = partsOf(canvasElement, 'Search')
    expect(trailing!.right).toBeLessThanOrEqual(box.right - 4)
    expect(trailing!.top).toBeGreaterThanOrEqual(box.top)
    expect(trailing!.bottom).toBeLessThanOrEqual(box.bottom)
    expect(trailing!.left - input.right).toBeGreaterThanOrEqual(8)
    // The field has a fill of its own, lighter than the keys' surface, so the hint stands out.
    const field = within(canvasElement).getByLabelText('Search').closest('[data-input-box]')!
    const key = field.querySelector('kbd')!
    expect(getComputedStyle(field).backgroundColor).not.toBe(getComputedStyle(key).backgroundColor)
    expect(getComputedStyle(field).backgroundColor).toBe(fillOf(field, 'bg-input-fill'))
  },
}

/** Reads the background a theme class resolves to beside an element, off a probe. */
function fillOf(beside: Element, className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  beside.parentElement!.append(probe)
  const fill = getComputedStyle(probe).backgroundColor
  probe.remove()
  return fill
}

/** Both: the icon before the text, the keystroke after it, in the same box. */
export const WithIconAndKbd: Story = {
  args: {
    label: 'Search',
    icon: <IconSearch size="sm" />,
    placeholder: 'Find a repository',
    trailing: <Kbd keys="Ctrl K" />,
  },
  play: async ({ canvasElement }) => {
    const { box, input, leading, trailing } = partsOf(canvasElement, 'Search')
    expect(leading!.left - box.left).toBeGreaterThanOrEqual(8)
    expect(input.left - leading!.right).toBeGreaterThanOrEqual(8)
    expect(trailing!.left - input.right).toBeGreaterThanOrEqual(8)
    expect(trailing!.right).toBeLessThanOrEqual(box.right - 4)
  },
}

/** Small, beside small controls: the same slots, the same insets, a step shorter. */
export const Small: Story = {
  args: {
    label: 'Search',
    size: 'sm',
    icon: <IconSearch size="sm" />,
    placeholder: 'Find a repository',
    trailing: <Kbd keys="Ctrl K" />,
  },
  play: async ({ canvasElement }) => {
    const { box, input, leading } = partsOf(canvasElement, 'Search')
    expect(box.height).toBe(28)
    expect(leading!.left - box.left).toBeGreaterThanOrEqual(8)
    expect(input.left - leading!.right).toBeGreaterThanOrEqual(8)
  },
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
  args: {
    label: 'Remote',
    defaultValue: 'origin',
    disabled: true,
    icon: <IconSearch size="sm" />,
    trailing: <Kbd keys="Ctrl K" />,
  },
  play: async ({ canvasElement }) => {
    const remote = within(canvasElement).getByLabelText('Remote')
    expect(remote).toBeDisabled()
    // The whole box goes quiet, its icon with it; the keystroke that reaches it is not shown.
    const box = remote.closest<HTMLElement>('[data-input-box]')!
    expect(getComputedStyle(box).opacity).toBe('0.5')
    expect(box.querySelector('[data-slot="trailing"]')).toBeNull()
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
