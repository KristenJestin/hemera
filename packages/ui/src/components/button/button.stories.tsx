import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { PRESS_EDGE } from '../../motion.ts'
import { Button, IconButton } from './button.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save', onClick: fn() },
  argTypes: {
    variant: {
      control: 'inline-radio',
      options: ['primary', 'secondary', 'ghost', 'link', 'destructive'],
    },
    shape: { control: 'inline-radio', options: ['default', 'pill'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    state: { control: 'inline-radio', options: ['idle', 'loading', 'success', 'error'] },
    disabled: { control: 'boolean' },
    children: { control: 'text', name: 'label' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

/** What a page asks for once: three sizes, each a step of the scale and not a number. */
export const Primary: Story = {
  args: { variant: 'primary' },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args} size="sm">
        Small
      </Button>
      <Button {...args} size="md">
        Medium
      </Button>
      <Button {...args} size="lg">
        Large
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const heights = within(canvasElement)
      .getAllByRole('button')
      .map((button) => getComputedStyle(button).height)
    expect(heights).toEqual(['32px', '36px', '44px'])
  },
}

/** The default: everything that is not the one thing a page asks for. */
export const Secondary: Story = {
  args: { variant: 'secondary' },
}

/** A button that only lights up under the hand: a toolbar, a row's own action. */
export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Show all' },
}

/** A place to go rather than a thing to press: it reads as text, one line tall. */
export const Link: Story = {
  args: { variant: 'link', children: 'View the history' },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('button')
    expect(getComputedStyle(link).height).toBe('20px')
  },
}

/** What takes something away. */
export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Delete' },
}

/** Round, for a control that floats over what it is about. Nothing else is round. */
export const Pill: Story = {
  args: { shape: 'pill', children: 'Back to the latest' },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button')
    expect(parseFloat(getComputedStyle(pill).borderTopLeftRadius)).toBeGreaterThan(1000)
  },
}

/** A button that is an icon and nothing else: a square of the same height, named for a reader. */
export const IconOnly: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <IconButton {...args} icon={<IconPlus />} aria-label="Add a repository" />
      <IconButton {...args} variant="ghost" icon={<IconSettings />} aria-label="Settings" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const add = within(canvasElement).getByRole('button', { name: 'Add a repository' })
    expect(getComputedStyle(add).width).toBe(getComputedStyle(add).height)
  },
}

/**
 * Working: the mark says so where the label was, and the button keeps its focus while it refuses
 * to be pressed — the keyboard does not fall back to the top of the page.
 */
export const Loading: Story = {
  args: { variant: 'primary', state: 'loading', children: 'Create' },
  play: async ({ canvasElement }) => {
    const working = within(canvasElement).getByRole('button')
    expect(working).toHaveAttribute('aria-disabled', 'true')
    working.focus()
    expect(document.activeElement).toBe(working)
    expect(within(canvasElement).getByRole('status')).toBeInTheDocument()
    expect(getComputedStyle(working).cursor).toBe('not-allowed')
  },
}

/** Done: a check in front of the label, and the button pressable again. */
export const Success: Story = {
  args: { variant: 'primary', state: 'success', children: 'Saved' },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button')
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button.querySelector('svg')).not.toBeNull()
  },
}

/** Failed: a warning in front of the label; what went wrong is said in words beside it. */
export const Error: Story = {
  args: { variant: 'primary', state: 'error', children: 'Try again' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button').querySelector('svg')).not.toBeNull()
  },
}

/** Refused: out of the tab order, and the hand says so. */
export const Disabled: Story = {
  args: { variant: 'primary', disabled: true },
  play: async ({ canvasElement }) => {
    const disabled = within(canvasElement).getByRole('button')
    expect(disabled).toBeDisabled()
    disabled.focus()
    expect(document.activeElement).not.toBe(disabled)
    expect(getComputedStyle(disabled).cursor).toBe('not-allowed')
  },
}

/**
 * Focused from the keyboard: a visible ring, Enter presses, and a disabled button is stepped over.
 */
export const Focused: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args}>First</Button>
      <Button {...args} disabled>
        Skipped
      </Button>
      <IconButton {...args} icon={<IconTrash />} aria-label="Delete" />
    </div>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole('button', { name: 'First' })
    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    // The ring is drawn on a layer of its own, so it is that layer that is asked.
    await waitFor(() => {
      expect(getComputedStyle(first, '::after').opacity).toBe('1')
    })
    expect(getComputedStyle(first, '::after').boxShadow).not.toBe('none')
    expect(getComputedStyle(first).cursor).toBe('pointer')
    await userEvent.keyboard('{Enter}')
    expect(args.onClick).toHaveBeenCalled()
    await userEvent.tab()
    expect(document.activeElement).toBe(canvas.getByRole('button', { name: 'Delete' }))
  },
}

/**
 * Held under the hand: every edge goes in by the same pixels, whatever the control is worth in
 * pixels — a narrow button, a wide one and an icon alike.
 */
export const Pressed: Story = {
  parameters: { layout: 'padded' },
  args: { variant: 'primary' },
  render: (args) => (
    <div className="flex w-full flex-col items-start gap-2">
      <Button {...args} className="w-24">
        Narrow
      </Button>
      <Button {...args} className="w-full">
        Wide
      </Button>
      <IconButton {...args} icon={<IconSettings />} aria-label="Settings" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const name of ['Narrow', 'Wide', 'Settings']) {
      // oxlint-disable-next-line no-await-in-loop -- one pointer presses one control at a time
      const edges = await pressedEdgesOf(canvas.getByRole('button', { name }))
      for (const edge of edges) {
        expect(edge).toBeGreaterThan(0)
        expect(edge).toBeLessThanOrEqual(PRESS_EDGE + 0.05)
      }
    }
  },
}

/** How far each of the four edges of a control goes in while it is held. */
async function pressedEdgesOf(button: HTMLElement): Promise<number[]> {
  const rest = button.getBoundingClientRect()
  await userEvent.hover(button)
  // A real pointer event and not a synthesised click: motion tracks the pointer that went down,
  // and only the matching one up ends the press.
  fireEvent.pointerDown(button, { isPrimary: true, button: 0, pointerId: 1 })
  const pressed = await waitFor(() => {
    const box = button.getBoundingClientRect()
    const gone = [(rest.width - box.width) / 2, (rest.height - box.height) / 2]
    if (gone.some((edge) => edge < 1.2)) throw new globalThis.Error('not pressed yet')
    return box
  })
  fireEvent.pointerUp(button, { isPrimary: true, button: 0, pointerId: 1 })
  await userEvent.unhover(button)
  await waitFor(() => {
    expect(button.getBoundingClientRect().width).toBeCloseTo(rest.width, 1)
  })
  return [
    pressed.left - rest.left,
    rest.right - pressed.right,
    pressed.top - rest.top,
    rest.bottom - pressed.bottom,
  ]
}
