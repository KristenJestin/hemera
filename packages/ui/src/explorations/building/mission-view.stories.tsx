import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { BuildingScreen } from './screen.tsx'

/**
 * The alternative to open questions 67, 68 and 84, not recommended: the mission's dependencies,
 * its "Allow for this mission" grants and its budget leave the rail for a view of their own,
 * "About ACME-12", opened from the header's `…`. The rail is shorter; but a budget nearly spent or
 * a dependency not Done no longer shows where the user looks, and a grant is two presses away.
 */
const meta = {
  title: 'Explorations/Building/About view',
  component: BuildingScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'working',
    things: 'view',
    onOpenTask: fn(),
    onOpenDiff: fn(),
    onService: fn(),
    onRevoke: fn(),
  },
} satisfies Meta<typeof BuildingScreen>

export default meta
type Story = StoryObj<typeof meta>

/** The rail without the mission's things. */
export const RailWithout: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('region', { name: 'This mission' })).toBeNull()
  },
}

/** The view opened from the header's `…`: dependencies, grants and budget, folded as in the rail. */
export const AboutOpened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'More for ACME-12' }))
    await userEvent.click(
      await waitFor(() => within(document.body).getByRole('menuitem', { name: 'About ACME-12' })),
    )
    const view = within(await waitFor(() => canvas.getByRole('region', { name: 'About ACME-12' })))
    await expect(view.getByRole('button', { name: /^Allowed for this mission/ })).toBeVisible()
  },
}
