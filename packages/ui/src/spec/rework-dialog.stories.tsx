import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ReworkDialog } from './rework-dialog.tsx'

/** What Rework asks before reopening a `ready` Spec: one line of reason, and what happens. */
const meta = {
  title: 'Blocks/Spec/ReworkDialog',
  component: ReworkDialog,
  tags: ['autodocs', 'new'],
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

/** The reason, then Rework: a reason is asked for before anything is copied. */
export const Open: Story = {
  play: async ({ args }) => {
    const page = within(document.body)
    // The dialog rises into place; what is asked is where it ends.
    const says = await page.findByText(
      'A complete copy becomes revision 3; revision 2 stays as it is.',
    )
    await waitFor(() => expect(says).toBeVisible())
    await userEvent.click(page.getByRole('button', { name: 'Rework' }))
    await waitFor(() => expect(page.getByText('Say in one line why it is reworked.')).toBeVisible())
    await expect(args.onRework).not.toHaveBeenCalled()
    await userEvent.type(
      page.getByRole('textbox', { name: 'Reason' }),
      'Credit notes must keep the number of their invoice{Enter}',
    )
    await expect(args.onRework).toHaveBeenCalledWith(
      'Credit notes must keep the number of their invoice',
    )
  },
}
