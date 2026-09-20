import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { Button, IconButton } from './button.tsx'

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'destructive'] as const
const SHAPES = ['default', 'pill'] as const
const SIZES = ['sm', 'md', 'lg'] as const
const STATES = ['idle', 'loading', 'success', 'error'] as const

const meta = {
  tags: ['autodocs'],
  title: 'Components/Button',
  component: Button,
  args: { children: 'Save', onClick: fn() },
  argTypes: {
    variant: { control: 'inline-radio', options: VARIANTS },
    shape: { control: 'inline-radio', options: SHAPES },
    size: { control: 'inline-radio', options: SIZES },
    state: { control: 'inline-radio', options: STATES },
    disabled: { control: 'boolean' },
    children: { control: 'text', name: 'label' },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The button with every prop on a control. Turn `state` and watch the width follow what the
 * button now says; the Actions panel shows each click as it is handled.
 */
export const Playground: Story = {
  args: { variant: 'primary', size: 'md', state: 'idle' },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex flex-col gap-4">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-2">
          {VARIANTS.map((variant) => (
            <Button {...args} key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
          <IconButton {...args} size={size} icon={<IconPlus />} aria-label={`Add, ${size}`} />
          <IconButton
            {...args}
            variant="ghost"
            size={size}
            icon={<IconSettings />}
            aria-label={`Settings, ${size}`}
          />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('button')).toHaveLength(SIZES.length * (VARIANTS.length + 2))
    // A size is a step of the scale and not a number a caller passed in: one row per size,
    // and the first button of each row says how tall that step is.
    const rows = SIZES.map(
      (_size, row) => canvas.getAllByRole('button')[row * (VARIANTS.length + 2)]!,
    )
    expect(rows.map((button) => getComputedStyle(button).height)).toEqual(['32px', '36px', '44px'])
  },
}

/**
 * The two radii of the design system: the corner of the theme, and the round shape a control
 * wears when it floats over what it is about — the pill that takes a reader back to the live
 * edge of a thread. Nothing else is round, and a caller asks for it rather than writing it.
 */
export const Shapes: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args}>Default</Button>
      <Button {...args} shape="pill">
        Pill
      </Button>
      <IconButton {...args} shape="pill" icon={<IconSettings />} aria-label="Settings, round" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const corner = getComputedStyle(canvas.getByRole('button', { name: 'Default' }))
    const pill = getComputedStyle(canvas.getByRole('button', { name: 'Pill' }))

    // The corner is a step of the theme and the pill is round: a difference of shape, and not
    // a number a caller passed in.
    expect(corner.borderTopLeftRadius).not.toBe(pill.borderTopLeftRadius)
    expect(parseFloat(pill.borderTopLeftRadius)).toBeGreaterThan(1000)
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-2">
      {STATES.map((state) => (
        <Button {...args} key={state} variant="primary" state={state}>
          {state}
        </Button>
      ))}
      <Button {...args} variant="primary" disabled>
        disabled
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Working and disabled are not the same thing: one keeps its focus, the other gives it up.
    // Base UI says so with `aria-disabled` rather than the attribute, which is what lets the
    // button stay in the tab order while it refuses to be pressed.
    const working = canvas.getByRole('button', { name: /loading/i })
    expect(working).toHaveAttribute('aria-disabled', 'true')
    working.focus()
    expect(document.activeElement).toBe(working)
    expect(canvas.getByRole('status')).toBeInTheDocument()

    const disabled = canvas.getByRole('button', { name: /disabled/i })
    expect(disabled).toBeDisabled()
    disabled.focus()
    expect(document.activeElement).not.toBe(disabled)

    // A hand where something can be pressed, and never where it refuses to be. Tailwind 4
    // dropped the pointer cursor from its reset, so the theme has to put it back.
    expect(getComputedStyle(canvas.getByRole('button', { name: /idle/i })).cursor).toBe('pointer')
    expect(getComputedStyle(disabled).cursor).toBe('not-allowed')
    expect(getComputedStyle(working).cursor).toBe('not-allowed')
  },
}

export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
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
    const remove = canvas.getByRole('button', { name: 'Delete' })

    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    // A visible focus ring, which is a real ring and not a colour nobody can see. It is drawn
    // on a layer of its own so that it can arrive by opacity rather than by a shadow nobody
    // can animate, so that layer is what has to be asked.
    await waitFor(() => {
      expect(getComputedStyle(first, '::after').opacity).toBe('1')
    })
    expect(getComputedStyle(first, '::after').boxShadow).not.toBe('none')
    await userEvent.keyboard('{Enter}')
    expect(args.onClick).toHaveBeenCalled()

    // The disabled one is stepped over; the next tab lands on the icon button.
    await userEvent.tab()
    expect(document.activeElement).toBe(remove)
  },
}

/**
 * What the hand gets back. The hover and the press are on the `press` preset — stiff and
 * light — because the spring that carries a panel into place takes long enough to settle that
 * a press on it cannot be seen at all. An icon button answers exactly the same way.
 */
export const Press: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { variant: 'primary', children: 'Press and hold me' },
  render: (args) => (
    <div className="flex items-center gap-2">
      <Button {...args} />
      <IconButton {...args} icon={<IconSettings />} aria-label="Settings" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // One pointer, one button at a time: a hand does not press two things at once.
    await pressAndRelease(canvas.getByRole('button', { name: 'Press and hold me' }))
    await pressAndRelease(canvas.getByRole('button', { name: 'Settings' }))
  },
}

/** How far a button is from its resting size right now. */
function scaleOf(element: Element): number {
  return new DOMMatrixReadOnly(getComputedStyle(element).transform).a
}

/** Hovers, holds and lets go, checking that the button answers each and comes back. */
async function pressAndRelease(button: HTMLElement): Promise<void> {
  expect(scaleOf(button)).toBeCloseTo(1, 2)

  await userEvent.hover(button)
  await waitFor(() => {
    expect(scaleOf(button)).toBeGreaterThan(1.01)
  })

  // A real pointer event and not a synthesised click: motion tracks the pointer that went
  // down, and only the matching one up ends the press.
  fireEvent.pointerDown(button, { isPrimary: true, button: 0, pointerId: 1 })
  await waitFor(() => {
    expect(scaleOf(button)).toBeLessThan(0.96)
  })

  fireEvent.pointerUp(button, { isPrimary: true, button: 0, pointerId: 1 })
  await userEvent.unhover(button)
  await waitFor(() => {
    expect(scaleOf(button)).toBeCloseTo(1, 2)
  })
}
