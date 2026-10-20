import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'

import { DeliveryPage } from '../../blocks/project-settings/delivery-page.tsx'
import { HEMERA_RULES, LOCAL_CLEANUP_RULES, LOCAL_MERGE_RULES } from './open-questions-fixtures.ts'

/**
 * The open questions of the delivery rules, each drawn in the settings page it lives in: Hemera's
 * own delivery (47) and the Local preset's merge (80). Who commits (26) is settled: committing is
 * an action of the catalogue, placed in a moment like any other (#422). The
 * recommended variant of each comes first; the variants not chosen are removed before the merge.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery rules',
  component: DeliveryPage,
  parameters: { layout: 'fullscreen' },
  args: { rules: HEMERA_RULES, onSave: fn(), onCopy: fn(), onCheckAgain: fn() },
  argTypes: { rules: { table: { disable: true } }, form: { table: { disable: true } } },
} satisfies Meta<typeof DeliveryPage>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Question 47: Hemera's own delivery with the Application preset — pull requests into `dev`,
 * squashed so each title is the subject semantic-release reads, CI, and the prerelease found by
 * its tag. Promoting `dev` to `main` is a release of its own, not a mission's delivery.
 */
export const HemeraOwnDelivery: Story = {
  args: { name: 'Hemera', mainCheckout: '~/work/hemera', open: ['hemera'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /^hemera, Application, 1 change/ })).toBeVisible()
    const steps = canvas.getByRole('list', { name: 'Steps of hemera' })
    expect(within(steps).getByRole('button', { name: /^Merge, squash/ })).toBeVisible()
    expect(
      within(steps).getByRole('button', {
        name: /^Published version, tag v\*-beta\.\*, added here/,
      }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Pull request title, {title}' })).toBeVisible()
  },
}

/**
 * Question 80, recommended: the Local preset has a step of its own, Merge locally — the mission's
 * branch into `main` on this machine, fast-forward when it can — the one merge with no pull
 * request the rules allow; after it, the cleanup sees the work merged and removes the Workspace.
 */
export const LocalMergeAsAStep: Story = {
  args: { rules: LOCAL_MERGE_RULES, open: ['shared'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: /^shared, Local, as the preset, No forge/ }),
    ).toBeVisible()
    const steps = canvas.getByRole('list', { name: 'Steps of shared' })
    expect(within(steps).getByRole('button', { name: /^Merge locally, into main/ })).toBeVisible()
  },
}

/** Question 80, alternative: Ship only records the delivery; the merge is the cleanup's first step. */
export const LocalMergeInTheCleanup: Story = {
  args: { rules: LOCAL_CLEANUP_RULES, open: ['shared'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText(/^Nothing after Ship/)).toBeVisible()
    const cleanup = canvas.getByRole('list', { name: 'Cleanup' })
    expect(within(cleanup).getAllByRole('listitem')[0]).toHaveTextContent(
      'Merge the branch into main on this machine',
    )
  },
}
