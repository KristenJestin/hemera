import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconMoon, IconSun } from '../../icons.ts'
import { PRESS_EDGE } from '../../motion.ts'
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

/** How far the measured width of the anchor and of the control may differ, in pixels. */
const ROUNDING = 2

const meta = {
  tags: ['autodocs', 'updated'],
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
    // As wide as the control, give or take the pixel the anchor is measured to. The list is
    // laid out against the wrapper the trigger hangs off — that wrapper is what keeps the list
    // still while the button gives under the press — and Base UI rounds the anchor's width
    // where `getBoundingClientRect` does not.
    expect(popup.width).toBeGreaterThanOrEqual(control.width - ROUNDING)

    // Closed before the story ends, and waited for: the accessibility pass runs on whatever is
    // on the page when the play is over, and a popup still on its way out has Base UI's focus
    // guards in it, which read as an error nobody can act on.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
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
    // The list is open before it is walkable: Base UI puts the highlight on the chosen item
    // once the popup has settled, and a key pressed before then lands on nothing. Waiting for
    // the highlight to be on that item, and then for it to have moved, is what makes the walk
    // the same walk every time: waiting only for *a* highlight leaves the first arrow racing
    // the popup, and Enter then chooses the item it opened on.
    const highlighted = (): Element | null =>
      document.querySelector('[role="option"][data-highlighted]')
    await waitFor(() => {
      expect(highlighted()).toHaveTextContent('Opus')
    })
    // The list takes the keys once it has the focus, and the highlight lands before the focus
    // does: an arrow pressed in between is an arrow nobody hears, and the walk then waits five
    // seconds on a highlight that never moves — seen twice in a row on a loaded Linux runner.
    // So the focus is waited for, and the arrow is pressed again if the highlight has not moved
    // within a moment all the same: the walk is the same walk, pressed once or twice.
    await waitFor(() => {
      expect(within(document.body).getByRole('listbox').contains(document.activeElement)).toBe(true)
    })
    for (let pressed = 0; pressed < 3; pressed += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one press, then a look, then the next: the order is the point
      await userEvent.keyboard('{ArrowDown}')
      try {
        // oxlint-disable-next-line no-await-in-loop -- see above
        await waitFor(
          () => {
            expect(highlighted()).toHaveTextContent('Sonnet')
          },
          { timeout: 1500 },
        )
        break
      } catch {
        // Not moved yet: pressed again, which is what a hand would do.
      }
    }
    expect(highlighted()).toHaveTextContent('Sonnet')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(args.onValueChange).toHaveBeenCalledWith('sonnet')
    })

    // Escape closes it, and the trigger gets the focus back. The popup that choosing closed is
    // waited out first: an arrow pressed while it is still leaving is an arrow that reopens
    // nothing, and the story would then be waiting for a list nobody asked for again.
    await waitFor(() => {
      expect(within(document.body).queryByRole('listbox')).toBeNull()
    })
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

/**
 * A select filling what it is given, held: the widest control of the catalogue, and the one a
 * share of the size caved in the most — ten pixels an edge on the trigger of a dialog. It goes
 * in by the same pixels as a narrow one now (issue #108).
 */
export const Pressed: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true }, layout: 'padded' },
  args: { defaultValue: 'opus' },
  render: (args) => (
    <div className="flex w-full flex-col items-start gap-2">
      <Select {...args} className="w-24" label="Narrow" />
      <Select {...args} className="w-full" label="Wide" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByLabelText('Wide')
    const rest = trigger.getBoundingClientRect()

    await userEvent.hover(trigger)
    // A real pointer event and not a synthesised click: motion tracks the pointer that went
    // down, and only the matching one up ends the press.
    fireEvent.pointerDown(trigger, { isPrimary: true, button: 0, pointerId: 1 })
    const pressed = await waitFor(() => {
      const box = trigger.getBoundingClientRect()
      const edge = (rest.width - box.width) / 2
      if (edge < 1.2) throw new Error(`the trigger has gone in by ${edge.toFixed(2)}px and no more`)
      return box
    })
    fireEvent.pointerUp(trigger, { isPrimary: true, button: 0, pointerId: 1 })
    await userEvent.unhover(trigger)

    // In by the two pixels of every other control, and no more — the list hangs off a wrapper
    // around the trigger, so the anchor it is measured against does not move with it.
    expect((rest.width - pressed.width) / 2).toBeLessThanOrEqual(PRESS_EDGE + 0.05)
    expect((rest.height - pressed.height) / 2).toBeGreaterThan(0)
  },
}
