import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LIFT_EDGE } from '../../motion.ts'
import { Button } from '../button/button.tsx'
import { Select } from '../select/select.tsx'
import { Dialog, DialogClose } from './dialog.tsx'

const ACTIONS = (
  <>
    <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
    <DialogClose render={<Button variant="destructive" />}>Delete</DialogClose>
  </>
)

/** A body of one line, for the stories that are not about how much a dialog holds. */
const SHORT = 'This runs on your machine and nowhere else.'

/** The lines of a body too long for any dialog, and where the dialog stops reading them. */
const LINES = Array.from({ length: 60 }, (_, index) => `Line ${index + 1} of what the dialog holds`)

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    title: 'Delete the session',
    description: 'Everything it holds goes with it.',
    trigger: 'Delete',
    actions: ACTIONS,
    children: <p className="text-sm">This cannot be undone.</p>,
    onOpenChange: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    trigger: { control: 'text' },
    size: { control: 'inline-radio', options: ['md', 'wide'] },
    open: { control: 'boolean' },
    actions: { table: { disable: true } },
    children: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** Open it from the control or from its trigger; the Actions panel reports both. */
export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-start gap-4">
      <Dialog {...args} />
      <Dialog
        {...args}
        title="Rename the session"
        description="The name is only for you; nothing else reads it."
        trigger="Rename"
        actions={undefined}
        children={undefined}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete' }))
    const dialog = await waitFor(() => within(document.body).getByRole('dialog'))

    // The dialog is named and described by the same text the eye reads.
    expect(dialog).toHaveAccessibleName('Delete the session')
    expect(dialog).toHaveAccessibleDescription('Everything it holds goes with it.')
    expect(args.onOpenChange).toHaveBeenCalledWith(true)

    // A click outside closes it, which is what a backdrop is for.
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Delete' })

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{Enter}')

    const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
    // The focus goes inside and stays there: tabbing walks the dialog's own controls rather
    // than leaving for the page behind it.
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    await userEvent.tab()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(trigger)

    // Escape closes it and hands the focus back to what opened it.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}

/** Opens one of the story's dialogs and reads the box, waiting for it to rise into place. */
async function shown(canvas: ReturnType<typeof within>, trigger: string) {
  await userEvent.click(canvas.getByRole('button', { name: trigger }))
  const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
  // Read once it is in place: it arrives from transparent and from a smaller scale.
  await waitFor(() => {
    expect(getComputedStyle(dialog).opacity).toBe('1')
  })
  const body = within(dialog).getByText(SHORT).parentElement!
  return {
    box: dialog.getBoundingClientRect(),
    body,
    headTop: dialog.firstElementChild!.getBoundingClientRect().top,
    footerBottom: dialog.lastElementChild!.getBoundingClientRect().bottom,
    /** Closes it from its own button, and waits until it has gone. */
    close: async () => {
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => {
        expect(within(document.body).queryByRole('dialog')).toBeNull()
      })
    },
  }
}

/**
 * A short body, in both sizes: the dialog is as tall as what it holds, so the buttons sit right
 * under it, one step from the body and inside the dialog's own frame. The same body in `md` and
 * in `wide` is the same height — the size decides the width, not the height.
 */
export const ShortBody: Story = {
  name: 'A short body keeps its footer right under it',
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: {
    title: 'Rename the session',
    description: 'The name is only for you; nothing else reads it.',
    children: <p className="text-sm">{SHORT}</p>,
  },
  render: (args) => (
    <div className="flex items-start gap-4">
      <Dialog {...args} trigger="Rename" />
      <Dialog {...args} size="wide" trigger="Rename, wider" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const narrow = await shown(canvas, 'Rename')
    // The body holds one line: nothing to scroll, and nothing the dialog is stretched for.
    expect(narrow.body.scrollHeight).toBe(narrow.body.clientHeight)
    expect(narrow.headTop - narrow.box.top).toBeCloseTo(17, 0)
    expect(narrow.box.bottom - narrow.footerBottom).toBeCloseTo(17, 0)
    await narrow.close()

    const wide = await shown(canvas, 'Rename, wider')
    expect(wide.body.scrollHeight).toBe(wide.body.clientHeight)
    expect(wide.headTop - wide.box.top).toBeCloseTo(17, 0)
    expect(wide.box.bottom - wide.footerBottom).toBeCloseTo(17, 0)
    await wide.close()

    expect(wide.box.height).toBeCloseTo(narrow.box.height, 0)
    expect(wide.box.width).toBeGreaterThan(narrow.box.width)
  },
}

/**
 * A long body: the dialog stops at the height it may take, its body is the only part that
 * scrolls, and the buttons stay where they are while it does. A control under the hand lifts
 * without widening what holds it either: the body has nothing to scroll sideways.
 */
export const LongBody: Story = {
  name: 'A long body scrolls under a footer that stays',
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: {
    size: 'wide',
    title: 'Session details',
    description: undefined,
    trigger: 'Details',
    children: (
      <>
        <ol className="flex flex-col gap-2 text-sm">
          {LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        {/* A control at the far edge of the body, where its lift has the least room left. */}
        <div className="mt-4 flex flex-col gap-1">
          <span className="text-sm font-medium">Runs from</span>
          <Select
            className="w-full"
            label="Runs from"
            defaultValue="root"
            items={[
              { value: 'root', label: 'Workspace root' },
              { value: 'atlas', label: 'atlas' },
            ]}
          />
        </div>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }))
    const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
    // Read once it is in place: it arrives from transparent and from a smaller scale.
    await waitFor(() => {
      expect(getComputedStyle(dialog).opacity).toBe('1')
    })

    // The most it may take, and wider than a question.
    await waitFor(() => {
      expect(dialog.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.7, 0)
    })
    expect(dialog.getBoundingClientRect().width).toBeGreaterThan(448)

    // The body is the only part that scrolls…
    const body = within(dialog).getByRole('list').parentElement!
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)

    // …and the buttons do not move while it does.
    const where = dialog.lastElementChild!.getBoundingClientRect().top
    body.scrollTop = body.scrollHeight
    expect(body.scrollTop).toBeGreaterThan(0)
    expect(dialog.lastElementChild!.getBoundingClientRect().top).toBeCloseTo(where, 0)
    expect(dialog.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.7, 0)

    // A control under the hand lifts, and the body it sits in has room for it: nothing to
    // scroll sideways, whatever the lift does. The lift is waited on to its end, since it grows
    // over the frames of a spring.
    const trigger = within(dialog).getByRole('combobox', { name: 'Runs from' })
    const before = trigger.getBoundingClientRect().width
    await userEvent.hover(trigger)
    await waitFor(() => {
      expect(trigger.getBoundingClientRect().width).toBeCloseTo(before + 2 * LIFT_EDGE, 0)
    })
    expect(body.scrollWidth).toBe(body.clientWidth)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}
