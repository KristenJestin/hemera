import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ReviewScreen } from './screen.tsx'

/**
 * The alternatives not recommended, one per open question where the choice is genuinely open, to
 * compare with the recommended stories of `Explorations/Review/Review`. The ones not chosen are
 * removed before the merge.
 */
const meta = {
  title: 'Explorations/Review/Alternatives',
  component: ReviewScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'back',
    onShip: fn(),
    onService: fn(),
    onRemark: fn(),
    onFix: fn(),
    onVerify: fn(),
    onTeam: fn(),
    onPull: fn(),
    onOpenDiff: fn(),
    onOpenLink: fn(),
    onCopy: fn(),
    onPoint: fn(),
    onOpenBuilding: fn(),
  },
} satisfies Meta<typeof ReviewScreen>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Open question 33, the alternative: every remark in one list, the newest first, narrowed by what
 * it waits for — the round it went into a quiet number on its line. Shorter to scan when there
 * are many rounds; the price is that what one round answered is no longer read together.
 */
export const FeedbackAsOneList: Story = {
  args: { feedback: 'list' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const filters = within(canvas.getByRole('group', { name: 'Show' }))
    await expect(filters.getByRole('button', { name: /To resolve/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const list = within(canvas.getByRole('list', { name: 'Remarks' }))
    await expect(list.getAllByRole('listitem')).toHaveLength(4)
    await userEvent.click(filters.getByRole('button', { name: /All/ }))
    await waitFor(() => {
      expect(list.getAllByRole('listitem')).toHaveLength(9)
    })
  },
}

/**
 * Open question 49, the alternative: the ball stays the user's in Review — Ship is theirs to
 * press — and what the team holds is a mark spelled beside it, "Waiting on api #412's approval".
 */
export const BallStaysWithYou: Story = {
  args: { moment: 'waitingOnTeam', ball: 'yours' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Needs you' })).toBeVisible()
    await expect(canvas.getByText(/Waiting on ana\.lopez’s approval/)).toBeVisible()
  },
}

/**
 * Open question 80, the alternative: Mark as delivered only stamps the mission, merging nothing;
 * the branch stays, and the cleanup's guard keeps it since it is not merged.
 */
export const LocalStampOnly: Story = {
  args: { moment: 'local', preview: 'stamp' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Mark as delivered' }))
    const dialog = within(await waitFor(() => within(document.body).getByRole('dialog')))
    await expect(dialog.queryByText(/into develop, here/)).toBeNull()
    await expect(dialog.getByText(/Nothing is merged/)).toBeVisible()
  },
}
