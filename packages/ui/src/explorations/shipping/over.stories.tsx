import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { tabTo } from '../review/play.ts'
import { ShippingScreen } from './screen.tsx'

/**
 * Done, recommended (84: the history has its place here): the page is the mission's record. The
 * rail says what Done still does — a closing conflict with both versions, the cleanup with what
 * the guard kept and why, what still runs with Stop — and the middle reads what was delivered per
 * repository, the living spec's requirements it merged with their origin, then the history one
 * quiet line each: rounds, feedback, proofs, evidence, the Memory.
 */
const meta = {
  title: 'Explorations/Shipping/Done',
  component: ShippingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    stage: 'Done',
    done: 'done',
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

/** Done in full: delivered per repository, merged requirements with their origin, the history. */
export const Done: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const delivered = canvas.getByRole('list', { name: 'Delivered' })
    await expect(within(delivered).getAllByRole('listitem')).toHaveLength(5)
    await userEvent.click(within(delivered).getByRole('button', { name: /Version 2\.4\.0/ }))
    await expect(args.onOpenLink).toHaveBeenCalledWith(
      'https://github.example/acme/shop/releases/tag/v2.4.0',
    )
    await expect(canvas.getByText('changed R3 of ACME-4')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^Rounds/ }))
    await userEvent.click(await waitFor(() => canvas.getByRole('button', { name: /^Round 3/ })))
    await waitFor(() => expect(canvas.getByRole('region', { name: 'Round 3' })).toBeVisible())
  },
}

/** A closing conflict waits: R3 changed in the living spec under the mission, both versions. */
export const ClosingConflict: Story = {
  args: { done: 'conflict' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const conflict = within(canvas.getByRole('region', { name: 'Closing waits for you' }))
    await expect(conflict.getByText(/none for the yen/)).toBeVisible()
    await expect(conflict.getByText(/two decimals, except/)).toBeVisible()
    await userEvent.click(conflict.getByRole('button', { name: 'Keep this mission’s' }))
    await expect(args.onKeep).toHaveBeenCalledWith('R3', 'mission')
  },
}

/** The cleanup runs: one item removed, one on its way, one to do. */
export const CleanupRunning: Story = {
  args: { done: 'cleaning' },
  play: async ({ canvasElement }) => {
    const cleanup = within(within(canvasElement).getByRole('list', { name: 'Cleanup' }))
    await expect(cleanup.getByRole('img', { name: 'Removed' })).toBeVisible()
    await expect(cleanup.getByRole('img', { name: 'Removing' })).toBeVisible()
    await expect(cleanup.getByRole('img', { name: 'To remove' })).toBeVisible()
  },
}

/** The guard kept two items, each with its reason in words. */
export const CleanupKept: Story = {
  args: { done: 'kept' },
  play: async ({ canvasElement }) => {
    const cleanup = within(within(canvasElement).getByRole('list', { name: 'Cleanup' }))
    await expect(cleanup.getAllByRole('img', { name: 'Kept by the guard' })).toHaveLength(2)
    await expect(cleanup.getByText(/1 commit that no branch of the forge has/)).toBeVisible()
  },
}

/** What still runs after Done, each with its reason and Stop. */
export const StillRunning: Story = {
  args: { done: 'leftovers' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('ACME-15 uses it too, and is still in Building')).toBeVisible()
    await userEvent.click(
      canvas.getByRole('button', { name: 'Stop The preview deployment of web #413' }),
    )
    await expect(args.onStopLeftover).toHaveBeenCalledWith('preview')
  },
}

/** Done on its way: the face loading in the card. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Reading the mission')
  },
}

/** The keyboard path: the conflict's two answers, then the history's folds, Enter on each. */
export const KeyboardPath: Story = {
  args: { done: 'conflict' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await tabTo(canvas.getByRole('button', { name: 'Keep this mission’s' }))
    const rounds = canvas.getByRole('button', { name: /^Rounds/ })
    await tabTo(rounds)
    await userEvent.keyboard('{Enter}')
    await expect(rounds).toHaveAttribute('aria-expanded', 'true')
  },
}
