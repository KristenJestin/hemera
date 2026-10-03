import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
import { AlertDialog } from './alert-dialog.tsx'

/**
 * Confirming something before it happens. The caller's own control is the trigger and keeps its
 * look; nothing of what it would have done happens until the question is answered.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/AlertDialog',
  component: AlertDialog,
  args: {
    title: 'Archive Acme?',
    description: 'It leaves the list of Projects. Nothing is deleted, and it can be restored.',
    confirmLabel: 'Archive it',
    cancelLabel: 'Cancel',
    tone: 'destructive',
    trigger: <Button variant="destructive">Archive Acme</Button>,
    onConfirm: fn(),
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    confirmLabel: { control: 'text' },
    cancelLabel: { control: 'text' },
    tone: { control: 'radio', options: ['destructive', 'primary'] },
    trigger: { table: { disable: true } },
    onConfirm: { action: 'confirmed' },
  },
} satisfies Meta<typeof AlertDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Asked, then confirmed: nothing happens on the press that opens the question. */
export const Confirmed: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Archive Acme' }))
    const asking = await within(document.body).findByRole('dialog')
    expect(args.onConfirm).not.toHaveBeenCalled()
    await userEvent.click(within(asking).getByRole('button', { name: 'Archive it' }))
    expect(args.onConfirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Cancelled, or left with Escape: everything stays as it was. */
export const Cancelled: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    const trigger = within(canvasElement).getByRole('button', { name: 'Archive Acme' })
    await userEvent.click(trigger)
    const asking = await within(document.body).findByRole('dialog')
    await userEvent.click(within(asking).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await userEvent.click(trigger)
    await within(document.body).findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

/** What merely needs saying out loud: the confirming button in the primary tone. */
export const Primary: Story = {
  args: {
    tone: 'primary',
    title: 'Pull every repository of Acme?',
    description: 'api, web and shared are brought up to date with their remote.',
    confirmLabel: 'Pull them',
    trigger: <Button variant="primary">Pull all</Button>,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Pull all' }))
    const asking = await within(document.body).findByRole('dialog')
    expect(within(asking).getByRole('button', { name: 'Pull them' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Opened, walked and answered with the keyboard alone; the focus comes back to the trigger. */
export const Focused: Story = {
  play: async ({ args, canvasElement }) => {
    args.onConfirm.mockClear()
    const trigger = within(canvasElement).getByRole('button', { name: 'Archive Acme' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const asking = await within(document.body).findByRole('dialog')
    within(asking).getByRole('button', { name: 'Archive it' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(args.onConfirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  },
}
