import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SidebarProposal } from './places.tsx'
import { ShippingScreen } from './screen.tsx'

/**
 * The alternatives to the recommendations of #265, one per open question, removed before the
 * merge once the maintainer chose.
 */
const meta = {
  title: 'Explorations/Shipping/Alternatives',
  component: ShippingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    stage: 'Shipping',
    moment: 'waitingOnSomeone',
    onStopDelivery: fn(),
    onResumeDelivery: fn(),
    onRetry: fn(),
    onForge: fn(),
    onOpenLink: fn(),
    onStartMission: fn(),
    onDismissComment: fn(),
    onAcceptFix: fn(),
    onRefuseFix: fn(),
    onKeep: fn(),
    onStopLeftover: fn(),
    onCleanUp: fn(),
    onNeed: fn(),
  },
} satisfies Meta<typeof ShippingScreen>

export default meta
type Story = StoryObj<typeof meta>

/** 76: each repository's delivery a tab of the page rather than a view over it. */
export const DeliveryAsTabs: Story = {
  args: { navigation: 'tabs' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'shared' }))
    await waitFor(() =>
      expect(canvas.getByRole('list', { name: 'Journal of Merge' })).toBeVisible(),
    )
  },
}

/** 77: Hemera's face as the header's ball while the agent works, beside the card's own face. */
export const FaceAsBall: Story = {
  args: { moment: 'fixing', face: 'ball' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole('img', { name: 'Agent working' }).length,
    ).toBeGreaterThan(0)
  },
}

/** 49: the ball stays Hemera's while it watches a forge's CI or an approval. */
export const BallWithHemera: Story = {
  args: { ball: 'agent' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/^Hemera watches ana\.lopez’s approval/),
    ).toBeVisible()
  },
}

/** 84: Done holds the outcome only; the history is a view of its own, from the header's `…`. */
export const HistoryInAView: Story = {
  args: { stage: 'Done', done: 'done', history: 'view' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'History' })).toBeNull()
  },
}

/** 52: Cancelled folded into Done, a cancelled row saying so by its event. */
export const CancelledWithDone: Story = {
  render: () => <SidebarProposal cancelled="withDone" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: /Cancelled/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /Done/ }))
    await expect(canvas.getByText('Cancelled · the cleanup waits for you')).toBeVisible()
  },
}
