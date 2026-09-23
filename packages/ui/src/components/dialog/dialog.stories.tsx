import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
import { Dialog, DialogClose } from './dialog.tsx'

const ACTIONS = (
  <>
    <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
    <DialogClose render={<Button variant="destructive" />}>Delete</DialogClose>
  </>
)

const meta = {
  tags: ['autodocs'],
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

/**
 * A dialog that holds a page of its own: as wide as the thread, seven tenths of the window tall
 * whatever it holds, and what it holds scrolls inside it while the title and the close button
 * stay in place.
 */
export const Wide: Story = {
  parameters: { controls: { disable: true } },
  args: {
    size: 'wide',
    title: 'Session details',
    description: undefined,
    trigger: 'Details',
    actions: undefined,
    children: (
      <ol className="flex flex-col gap-2 text-sm">
        {Array.from({ length: 60 }, (_, index) => (
          <li key={index}>{`Line ${index + 1} of what the dialog holds`}</li>
        ))}
      </ol>
    ),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Details' }))
    const dialog = await waitFor(() => within(document.body).getByRole('dialog'))
    // Read once it has risen into place: it arrives from transparent.
    await waitFor(() => {
      expect(getComputedStyle(dialog).opacity).toBe('1')
    })
    // Seven tenths of the window, whatever it holds, and wider than a question. Waited on, because
    // it rises from a smaller scale as well as from transparent.
    await waitFor(() => {
      expect(dialog.getBoundingClientRect().height).toBeCloseTo(window.innerHeight * 0.7, 0)
    })
    expect(dialog.getBoundingClientRect().width).toBeGreaterThan(448)
    const list = within(dialog).getByRole('list')
    const room = list.parentElement!
    // The content is what scrolls, and the close button stays where it is.
    expect(room.scrollHeight).toBeGreaterThan(room.clientHeight)
    await expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}
