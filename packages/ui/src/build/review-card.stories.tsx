import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ReviewCard } from './review-card.tsx'

/**
 * The last step of a build is the user's (D10-07, issue #117): every story is done and the final
 * checks are green, so the panel says so and sends the review where it is written — the chat, where
 * a review is a message like any other, screenshots and all. Sending it hands it to the agent, and
 * the build goes back to work; Accept waits in the head, refused while that work runs.
 */
const meta = {
  title: 'Blocks/Build/ReviewCard',
  component: ReviewCard,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { onOpenChat: fn() },
  argTypes: {
    onOpenChat: { action: 'chat opened' },
    className: { control: 'text', description: 'Where the card sits; never how it looks.' },
  },
} satisfies Meta<typeof ReviewCard>

export default meta

type Story = StoryObj<typeof meta>

/** The build waits for the user: what is left, and where to write it. */
export const WaitingForYourReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Every story is done/)).toBeVisible()
    await expect(canvas.getByText(/Write what to change in the chat/)).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Write your review in the chat' }),
    ).toBeEnabled()
  },
}

/** The button opens the chat, which is where the review is written and sent. */
export const OpeningTheChat: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByRole('button', { name: 'Write your review in the chat' })
    open.focus()
    await expect(open).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onOpenChat).toHaveBeenCalledTimes(1)
  },
}
