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
