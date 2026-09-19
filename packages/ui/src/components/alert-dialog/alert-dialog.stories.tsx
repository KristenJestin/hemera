import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
import { AlertDialog } from './alert-dialog.tsx'

/**
 * Confirming something before it happens (design D1-04).
 *
 * The control the caller already has is handed over as the trigger and keeps its own look; what
 * this adds is the question in front of it. Nothing of what the trigger would have done happens
 * until the question is answered, which is the whole of what it is for.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/AlertDialog',
  component: AlertDialog,
  args: {
    title: 'Archive Atlas?',
    description: 'Its tab disappears. Nothing is deleted, and it is restored from Settings.',
    confirmLabel: 'Archive it',
    cancelLabel: 'Cancel',
    tone: 'destructive',
    trigger: <Button variant="destructive">Archive Atlas</Button>,
    onConfirm: fn(),
  },
  argTypes: {
    title: { control: 'text', description: 'The question, as a sentence.' },
    description: { control: 'text', description: 'What it leaves behind.' },
    confirmLabel: { control: 'text', description: 'The word on the button that goes ahead.' },
    cancelLabel: { control: 'text', description: 'The word on the one that does not.' },
    tone: {
      control: 'radio',
      options: ['destructive', 'primary'],
      description: 'How the confirming button reads.',
      table: { defaultValue: { summary: 'destructive' } },
    },
    trigger: { table: { disable: true } },
    onConfirm: { action: 'confirmed' },
  },
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The two tones: what takes something away, and what merely needs saying out loud. */
export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-start gap-4">
      <AlertDialog {...args} />
      <AlertDialog
        {...args}
        tone="primary"
        title="Send this to every Project?"
        confirmLabel="Send it"
        trigger={<Button variant="primary">Send everywhere</Button>}
      />
    </div>
  ),
}

/** Asked, then answered: nothing happens on the press that opens the question. */
export const States: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Archive Atlas' }))

    const asking = within(document.body).getByRole('dialog')
    expect(args.onConfirm).not.toHaveBeenCalled()

    await userEvent.click(within(asking).getByRole('button', { name: 'Archive it' }))
    expect(args.onConfirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Cancelling leaves everything as it was, and so does Escape. */
export const Refused: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    const canvas = within(canvasElement)

    await userEvent.click(canvas.getByRole('button', { name: 'Archive Atlas' }))
    await userEvent.click(
      within(within(document.body).getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    )
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Archive Atlas' }))
    await within(document.body).findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** Opened, walked and answered with the keyboard alone. */
export const Keyboard: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    const trigger = within(canvasElement).getByRole('button', { name: 'Archive Atlas' })

    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const asking = await within(document.body).findByRole('dialog')

    const confirm = within(asking).getByRole('button', { name: 'Archive it' })
    confirm.focus()
    await userEvent.keyboard('{Enter}')
    expect(args.onConfirm).toHaveBeenCalled()

    // And the focus comes back to what opened it.
    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  },
}
