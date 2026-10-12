import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ShippingScreen } from './screen.tsx'

/**
 * Cancelled: what the cancel stopped, a partial delivery kept as delivered, the work kept, and the
 * cleanup — the header's one action, confirmed once in a dialog listing what it removes and what
 * the guard would keep, with why.
 */
const meta = {
  title: 'Explorations/Shipping/Cancelled',
  component: ShippingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    stage: 'Cancelled',
    cancelled: 'cancelled',
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

/** Cancelled in Review: what stopped, the branches kept, the cleanup waiting for the user. */
export const Cancelled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('list', { name: 'Stage' })).getByText('Cancelled'),
    ).toBeVisible()
    await expect(
      within(canvas.getByRole('list', { name: 'Work kept' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    await expect(canvas.queryByRole('region', { name: 'Delivered before the cancel' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Clean up' })).toBeVisible()
  },
}

/** Cancelled while shipping: shared was delivered and stays delivered. */
export const PartialDeliveryKept: Story = {
  args: { cancelled: 'partial' },
  play: async ({ canvasElement }) => {
    const delivered = within(
      within(canvasElement).getByRole('region', { name: 'Delivered before the cancel' }),
    )
    await expect(delivered.getByRole('listitem', { name: 'shared' })).toBeVisible()
  },
}

/** The cleanup's confirmation: what goes, and what the guard keeps with its reason. */
export const CleanupConfirmation: Story = {
  args: { cancelled: 'partial' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Clean up' }))
    const dialog = within(
      await waitFor(() => within(document.body).getByRole('dialog', { name: 'Clean up ACME-12?' })),
    )
    const kept = within(dialog.getByRole('region', { name: 'Kept by the guard' }))
    await expect(kept.getByText(/on no branch of the forge/)).toBeVisible()
    await expect(
      within(dialog.getByRole('region', { name: 'Removed' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    await userEvent.click(dialog.getByRole('button', { name: 'Clean up' }))
    await expect(args.onCleanUp).toHaveBeenCalledOnce()
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Clean up' })).toBeNull())
    await expect(canvas.getAllByRole('img', { name: 'Removed' })).toHaveLength(3)
  },
}

/** Cleaned up: what was removed, what the guard kept. */
export const CleanedUp: Story = {
  args: { cancelled: 'cleaned' },
  play: async ({ canvasElement }) => {
    const cleanup = within(within(canvasElement).getByRole('list', { name: 'Cleanup' }))
    await expect(cleanup.getAllByRole('img', { name: 'Kept by the guard' })).toHaveLength(1)
  },
}
