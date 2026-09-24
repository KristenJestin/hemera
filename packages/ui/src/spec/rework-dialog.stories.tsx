import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ReworkDialog } from './rework-dialog.tsx'

/** What Rework asks before reopening a `ready` Spec: one line of reason, and what happens. */
const meta = {
  title: 'Blocks/Spec/ReworkDialog',
  component: ReworkDialog,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { open: true, onOpenChange: fn(), specKey: 'ATL-7', revision: 2, onRework: fn() },
  argTypes: {
    open: { control: 'boolean' },
    onOpenChange: { description: 'Opens or closes it.' },
    specKey: { control: 'text' },
    revision: { control: 'number', description: 'The frozen revision the copy is made from.' },
    onRework: { description: 'The rework, with its reason.' },
  },
} satisfies Meta<typeof ReworkDialog>

export default meta

type Story = StoryObj<typeof meta>

/** The reason is optional: Rework is pressable at once, with nothing typed. */
export const Open: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    // The dialog rises into place; what is asked is where it ends.
    const says = await page.findByText(
      'A complete copy becomes revision 3; revision 2 stays as it is.',
    )
    await waitFor(() => expect(says).toBeVisible())
    await expect(page.getByRole('textbox', { name: 'Reason' })).toHaveValue('')
    await userEvent.click(page.getByRole('button', { name: 'Rework' }))
    await expect(args.onRework).toHaveBeenCalledWith('')
  },
}

/** With a reason typed, Enter reworks and hands the reason over. */
export const WithAReason: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    const field = await page.findByRole('textbox', { name: 'Reason' })
    await waitFor(() => expect(field).toBeVisible())
    await userEvent.type(field, 'Credit notes must keep the number of their invoice{Enter}')
    await expect(args.onRework).toHaveBeenCalledWith(
      'Credit notes must keep the number of their invoice',
    )
  },
}
