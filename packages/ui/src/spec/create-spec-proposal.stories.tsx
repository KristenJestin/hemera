import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CreateSpecProposal } from './create-spec-proposal.tsx'

/**
 * The agent proposing a Spec in a `free` Session: the title it understood, editable in place,
 * the type as one of three chips, and `Create` or `Not now`.
 */
const meta = {
  title: 'Blocks/Spec/CreateSpecProposal',
  component: CreateSpecProposal,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { title: 'CSV invoice export', type: 'feature', onCreate: fn(), onDecline: fn() },
  argTypes: {
    title: { control: 'text', description: 'The title the agent understood.' },
    type: { control: 'inline-radio', options: ['feature', 'bug', 'maintenance'] },
    state: { control: 'inline-radio', options: ['proposed', 'created', 'declined'] },
    createdKey: { control: 'text', description: 'The key given, once created.' },
    onCreate: { description: 'Creates the Spec with the title and the type as left.' },
    onDecline: { description: 'Not now.' },
  },
} satisfies Meta<typeof CreateSpecProposal>

export default meta

type Story = StoryObj<typeof meta>

/** Proposed: the title, `feature` selected, and the two answers. */
export const Proposed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Title of the Spec' })).toHaveValue(
      'CSV invoice export',
    )
    await expect(canvas.getByRole('radio', { name: 'feature' })).toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Create' }))
    await expect(args.onCreate).toHaveBeenCalledWith('CSV invoice export', 'feature')
  },
}

/** The title edited in place and the type changed before Create. */
export const TitleEdited: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('textbox', { name: 'Title of the Spec' })
    await userEvent.clear(title)
    await userEvent.type(title, 'Monthly CSV export for the ledger')
    await userEvent.tab()
    await userEvent.click(canvas.getByRole('radio', { name: 'maintenance' }))
    await userEvent.click(canvas.getByRole('radio', { name: 'feature' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Create' }))
    await expect(args.onCreate).toHaveBeenCalledWith('Monthly CSV export for the ledger', 'feature')
  },
}

/** Created: folded to the line that says what happened. */
export const Created: Story = {
  args: { state: 'created', createdKey: 'ATL-7' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Created ATL-7')
  },
}

/** Declined: `Not now`, and the conversation goes on as it was. */
export const Declined: Story = {
  args: { state: 'declined' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/was not created/)).toBeVisible()
  },
}
