import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
import { Checkbox } from '../checkbox/checkbox.tsx'
import { Input } from '../field/field.tsx'
import { Dialog, DialogClose, type DialogProps } from './dialog.tsx'

const ACTIONS = (
  <>
    <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
    <DialogClose render={<Button variant="destructive" />}>Remove</DialogClose>
  </>
)

/** A body of one line, for the stories that are not about how much a dialog holds. */
const SHORT = 'The folder stays on the disk; only Acme forgets it.'

/** The lines of a body too long for any dialog. */
const LINES = Array.from({ length: 60 }, (_, index) => `Line ${index + 1} of the history of api`)

const meta = {
  tags: ['autodocs'],
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    title: 'Remove shared from Acme',
    description: 'The repository leaves the Project.',
    trigger: 'Remove',
    actions: ACTIONS,
    children: <p className="text-sm">{SHORT}</p>,
    onOpenChange: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    trigger: { control: 'text' },
    size: { control: 'inline-radio', options: ['md', 'wide'] },
    open: { control: 'boolean' },
    lead: { table: { disable: true } },
    actions: { table: { disable: true } },
    children: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

/** Opens the story's dialog from its trigger and waits for it to be in place. */
async function opened(canvasElement: HTMLElement, trigger: string): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name: trigger }))
  const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
  await waitFor(() => {
    expect(getComputedStyle(dialog).opacity).toBe('1')
  })
  return dialog
}

/** Closes whatever dialog is open with Escape, and waits until it has gone. */
async function closed(): Promise<void> {
  await userEvent.keyboard('{Escape}')
  await waitFor(() => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  })
}

/** Closed: its trigger, and nothing over the page. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}

/**
 * Open: named and described by the words the eye reads, as tall as what it holds, its buttons
 * right under the body. A click outside closes it.
 */
export const Open: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = await opened(canvasElement, 'Remove')
    expect(dialog).toHaveAccessibleName('Remove shared from Acme')
    expect(dialog).toHaveAccessibleDescription('The repository leaves the Project.')
    expect(args.onOpenChange).toHaveBeenCalledWith(true)
    const body = within(dialog).getByText(SHORT).parentElement!.parentElement!
    expect(body.scrollHeight).toBe(body.clientHeight)
    const box = dialog.getBoundingClientRect()
    expect(box.bottom - dialog.lastElementChild!.getBoundingClientRect().bottom).toBeCloseTo(17, 0)
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Wide, for a dialog that holds a page of its own: wider, and no taller for it. */
export const Wide: Story = {
  args: { size: 'wide' },
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement, 'Remove')
    expect(dialog.getBoundingClientRect().width).toBeGreaterThan(448)
    await closed()
  },
}

/**
 * Holding more than it can show: it stops at the height it may take, its body is the only part
 * that scrolls, and the buttons stay where they are while it does.
 */
export const Overflowing: Story = {
  args: {
    size: 'wide',
    title: 'History of api',
    description: undefined,
    trigger: 'History',
    actions: <DialogClose render={<Button variant="secondary" />}>Done</DialogClose>,
    children: (
      <ol className="flex flex-col gap-2 text-sm">
        {LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    ),
  },
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement, 'History')
    await waitFor(() => {
      expect(dialog.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.7, 0)
    })
    const body = within(dialog).getByRole('list').parentElement!.parentElement!
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    const footer = dialog.lastElementChild!.getBoundingClientRect().top
    body.scrollTop = body.scrollHeight
    expect(body.scrollTop).toBeGreaterThan(0)
    expect(dialog.lastElementChild!.getBoundingClientRect().top).toBeCloseTo(footer, 0)
    expect(body.scrollWidth).toBe(body.clientWidth)
    await closed()
  },
}

/** A dialog whose body a choice makes taller: the field the box brings in. */
function Growing(args: DialogProps): ReactNode {
  const [more, setMore] = useState(false)
  return (
    <Dialog {...args} trigger="Add">
      <div className="flex flex-col gap-3">
        <Checkbox label="Track a branch" checked={more} onCheckedChange={setMore} />
        {more && <Input label="Branch" value="main" onValueChange={() => undefined} />}
      </div>
    </Dialog>
  )
}

/**
 * Grown: what a choice brings in, the body grows to hold, and nothing of it is cut or scrolled.
 * The journey on `morph` is seen on the image sequences; here, where it lands.
 */
export const Grown: Story = {
  args: { title: 'Add a repository', description: 'It joins Acme.', actions: undefined },
  render: (args) => <Growing {...args} />,
  play: async ({ canvasElement }) => {
    const dialog = await opened(canvasElement, 'Add')
    const box = within(dialog).getByRole('checkbox', { name: 'Track a branch' })
    const body = [...dialog.children].find((part) => part.contains(box))!
    const from = body.getBoundingClientRect().height
    await userEvent.click(box)
    await expect(within(dialog).getByRole('textbox', { name: 'Branch' })).toBeInTheDocument()
    await waitFor(() => {
      expect(body.getBoundingClientRect().height).toBeCloseTo(
        body.firstElementChild!.getBoundingClientRect().height,
        0,
      )
    })
    expect(body.getBoundingClientRect().height).toBeGreaterThan(from)
    expect(body.scrollHeight).toBe(body.clientHeight)
    await closed()
  },
}

/** From the keyboard: the focus is trapped inside while it is open and comes back on close. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Remove' })
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{Enter}')
    const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    // Past its last control and round again: the focus never leaves it.
    for (let step = 0; step < 4; step += 1) {
      // oxlint-disable-next-line no-await-in-loop -- one key at a time, as a hand presses them
      await userEvent.tab()
      // oxlint-disable-next-line no-await-in-loop -- the trap hands the focus back on its own frame
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true)
      })
    }
    await closed()
    expect(document.activeElement).toBe(trigger)
  },
}
