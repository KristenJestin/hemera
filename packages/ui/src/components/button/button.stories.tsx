import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { PRESS_EDGE } from '../../motion.ts'
import { Button, IconButton } from './button.tsx'

const VARIANTS = ['primary', 'secondary', 'ghost', 'link', 'destructive'] as const
const SHAPES = ['default', 'pill'] as const
const SIZES = ['sm', 'md', 'lg'] as const
const STATES = ['idle', 'loading', 'success', 'error'] as const

const meta = {
  tags: ['autodocs', 'updated'],
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
 * a press on it cannot be seen at all.
 *
 * What is read is the box, and not a ratio (issue #108). A share of the size moved the edges of
 * a wide control by ten pixels and those of a small one by none: a name, a select filling a
 * dialog and an icon button all go in by the same pixels now, and the hand feels the same thing
 * whichever it presses.
 */
export const Press: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true }, layout: 'padded' },
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
    // One pointer, one control at a time: a hand does not press two things at once.
    const pressed = [
      await pressedEdgesOf(canvas.getByRole('button', { name: 'Narrow' })),
      await pressedEdgesOf(canvas.getByRole('button', { name: 'Wide' })),
      await pressedEdgesOf(canvas.getByRole('button', { name: 'Settings' })),
    ]
    for (const edges of pressed) {
      for (const edge of edges) {
        // Every edge has gone in, by the same pixels, whatever the control is worth in pixels
        // — and by no more than the two a reader is promised.
        expect(edge).toBeGreaterThan(0)
        expect(edge).toBeLessThanOrEqual(PRESS_EDGE + 0.05)
      }
    }
  },
}

/**
 * How far each of the four edges of a control goes in while it is held — read off the box, since
 * what the press promises is a distance and no longer a share of the size.
 */
async function pressedEdgesOf(button: HTMLElement): Promise<number[]> {
  const rest = button.getBoundingClientRect()
  await userEvent.hover(button)

  // A real pointer event and not a synthesised click: motion tracks the pointer that went
  // down, and only the matching one up ends the press.
  fireEvent.pointerDown(button, { isPrimary: true, button: 0, pointerId: 1 })
  const pressed = await waitFor(() => {
    const box = button.getBoundingClientRect()
    const gone = [(rest.width - box.width) / 2, (rest.height - box.height) / 2]
    if (gone.some((edge) => edge < 1.2)) {
      throw new Error(`the control has gone in by ${gone.map((it) => it.toFixed(2)).join(' / ')}px`)
    }
    return box
  })
  fireEvent.pointerUp(button, { isPrimary: true, button: 0, pointerId: 1 })
  await userEvent.unhover(button)
  await waitFor(() => {
    expect(button.getBoundingClientRect().width).toBeCloseTo(rest.width, 1)
    expect(button.getBoundingClientRect().height).toBeCloseTo(rest.height, 1)
  })

  return [
    pressed.left - rest.left,
    rest.right - pressed.right,
    pressed.top - rest.top,
    rest.bottom - pressed.bottom,
  ]
}
