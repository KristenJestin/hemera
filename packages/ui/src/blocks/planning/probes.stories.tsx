import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { EMOJI_PROBE, PROBES, SIZE_PROBE } from '../../surfaces/planning/planning-fixtures.ts'
import { ProbesCard } from './probes.tsx'

/**
 * The Probes of a mission in the rail of the Planning page: a card, a LiveChip per Probe and
 * nothing beside it. A Probe runs in the background while the Planner goes on with the user; there
 * is no stop. Pressed once it has ended, a chip opens the Probe's report over the page.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/ProbesCard',
  component: ProbesCard,
  args: {
    probes: PROBES,
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProbesCard>

export default meta
type Story = StoryObj<typeof meta>

/** One running beside two that ended: a chip each, no stop, no ×. */
export const Running: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('region', { name: 'Probes' })
    await expect(within(card).getAllByRole('button')).toHaveLength(3)
    await expect(within(card).queryByRole('button', { name: /Stop/ })).toBeNull()
  },
}

/** Ended: the chip opens the report. */
export const Ended: Story = {
  args: { probes: [EMOJI_PROBE] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Probe #3/ }))
    await expect(args.onOpen).toHaveBeenCalledWith('p3')
  },
}

/** Running: the chip opens its glance, with the step it is on and its details. */
export const Glance: Story = {
  args: { probes: [SIZE_PROBE] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Probe #2/ }))
    const body = within(document.body)
    await waitFor(() => expect(body.getByText(/Seeding 5 000 notes/)).toBeVisible())
    await userEvent.click(body.getByRole('button', { name: 'Details' }))
    await expect(args.onOpen).toHaveBeenCalledWith('p2')
  },
}

/** No Probe: the card is not drawn. */
export const None: Story = {
  args: { probes: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('region', { name: 'Probes' })).toBeNull()
  },
}
