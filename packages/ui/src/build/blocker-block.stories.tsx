import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BlockerBlock } from './blocker-block.tsx'
import { BLOCKER, NOW } from './build-fixtures.ts'

/**
 * The agent saying a task contradicts the Spec (D10-08): its reason whole in the build view, one
 * line above the chat's composer. The task and its dependants wait, the others go on, and the user
 * dismisses it — the Spec stands, the task goes back to ready. Ending the build is the build view's
 * own Stop (issue #116), the one there is: a blocker is answered, the build is not ended from it.
 */
const meta = {
  title: 'Blocks/Build/BlockerBlock',
  component: BlockerBlock,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    blocker: BLOCKER,
    now: NOW,
    variant: 'view',
    suspended: ['T4'],
    onDismiss: fn(),
  },
  argTypes: {
    blocker: { control: 'object', description: 'What the agent raised, and why.' },
    now: { control: 'text', description: 'The caller’s now, the time is said from.' },
    variant: {
      control: 'inline-radio',
      options: ['view', 'banner'],
      description: 'In the build view, or as the banner above the composer.',
    },
    suspended: { control: 'object', description: 'The tasks that wait with it.' },
    onDismiss: { action: 'dismissed' },
    onOpen: { action: 'opened' },
  },
} satisfies Meta<typeof BlockerBlock>

export default meta

type Story = StoryObj<typeof meta>

/** In the view: the agent's reason whole, what waits with it, and the answer. */
export const InTheView: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const block = within(
      canvas.getByRole('group', { name: /The agent says this task contradicts the Spec/ }),
    )
    await expect(block.getByText(/the ledger refuses two rows/)).toBeVisible()
    await expect(block.getByText('6 min ago')).toBeVisible()
    await expect(block.getByText(/T4 waits with it; the other tasks go on/)).toBeVisible()
  },
}

/** Above the composer: one line, a way to the task, and the same answer. */
export const Banner: Story = {
  args: { variant: 'banner', onOpen: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const banner = within(
      canvas.getByRole('group', { name: 'T3: the agent says this task contradicts the Spec' }),
    )
    await expect(banner.getByRole('button', { name: 'Open' })).toBeVisible()
    await expect(banner.getByRole('button', { name: 'The Spec stands' })).toBeVisible()
  },
}

/** Answered: the Spec stands, and the answer goes out at once. */
export const Dismissed: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'The Spec stands' }))
    await expect(args.onDismiss).toHaveBeenCalled()
  },
}

/**
 * The keyboard: the banner's Open then its answer, in that order, and the focus lands on the one the
 * reader is being sent to.
 */
export const Keyboard: Story = {
  args: { variant: 'banner', onOpen: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Open' }).focus()
    await userEvent.tab()
    const answer = canvas.getByRole('button', { name: 'The Spec stands' })
    await expect(answer).toHaveFocus()
  },
}
