import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SidebarProposal, SinceYouLeftCard } from './places.tsx'

/**
 * Where a mission that is over is found again, and where a team comment of Shipping reaches the
 * user away from the mission. 52, recommended: Done and Cancelled fold apart, Cancelled last.
 */
const meta = {
  title: 'Explorations/Shipping/Places',
  component: SidebarProposal,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { cancelled: 'apart' },
} satisfies Meta<typeof SidebarProposal>

export default meta
type Story = StoryObj<typeof meta>

/** The sidebar: Done folded, Cancelled folded apart under it; its dot says the cleanup waits. */
export const SidebarDoneAndCancelled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const done = canvas.getByRole('button', { name: /Done/ })
    const cancelled = canvas.getByRole('button', { name: /Cancelled/ })
    await expect(done).toHaveAttribute('aria-expanded', 'false')
    await expect(cancelled).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(cancelled)
    await expect(canvas.getByRole('img', { name: 'Needs you' })).toBeVisible()
  },
}

/** Since you left on Home: the team comment among ACME-12's events, a mission a press away. */
export const SinceYouLeft: Story = {
  render: () => <SinceYouLeftCard onStartMission={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Start a mission from C4' })).toBeVisible()
  },
}
