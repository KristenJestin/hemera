import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, within } from 'storybook/test'

import { SidebarRow } from '../../shell/sidebar.tsx'
import { MOMENTS } from './fixtures.ts'
import { measuresOf } from './building.tsx'

/**
 * Open question 24, recommended: the sidebar shows a mission's percentage beside it while it is in
 * Building, and only then; the percentage counts the tasks done and verified, never those done but
 * not verified yet, so it never falls back. Before Building there is nothing to count; after it,
 * the stage says more than a figure stuck at 100%.
 */
function Rows(): ReactNode {
  const percent = measuresOf(MOMENTS.working()).percent
  return (
    <nav aria-label="Missions" className="flex w-sidebar flex-col gap-1 p-3">
      <SidebarRow
        missionKey="ACME-12"
        title="Export invoices as CSV from the billing page"
        ball="agent"
        event="T8 · second try"
        needsYou={false}
        percent={percent}
        current
        onPress={fn()}
      />
      <SidebarRow
        missionKey="ACME-10"
        title="Read rules for invoices"
        ball="you"
        event="A permission waits"
        needsYou
        percent={80}
        onPress={fn()}
      />
      <SidebarRow
        missionKey="ACME-14"
        title="An audit log of who read what"
        ball="you"
        event="Ready to launch"
        needsYou={false}
        onPress={fn()}
      />
      <SidebarRow
        missionKey="ACME-8"
        title="Faster search in the billing page"
        ball="you"
        event="Round 1 addressed"
        needsYou
        onPress={fn()}
      />
    </nav>
  )
}

const meta = {
  title: 'Explorations/Building/Sidebar',
  component: Rows,
  tags: ['autodocs'],
} satisfies Meta<typeof Rows>

export default meta
type Story = StoryObj<typeof meta>

/** Two missions in Building with their percentage; one Ready and one in Review without. */
export const PercentInBuilding: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('28%')).toBeVisible()
    await expect(canvas.getByText('80%')).toBeVisible()
    await expect(canvas.queryAllByText(/%$/)).toHaveLength(2)
  },
}
