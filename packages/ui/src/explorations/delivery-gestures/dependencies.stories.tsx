import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { RULES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { findOpen } from '../../overlay-play.ts'
import { ListedUnderTheWaves, TickedInItsDialog } from './dependencies.tsx'
import { MANIFESTS } from './fixtures.ts'

const body = () => within(document.body)

/**
 * Gesture 4 of #467, removing an accepted dependency. Under the waves is recommended: the
 * accepted ones stand where the proposed ones already are, Remove beside them as Accept is beside
 * these, so the reason for the waves' order is read and changed in one place. In its dialog puts
 * it with the repository's remote and base, out of sight of the order it changes.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Explorations/Delivery gestures/4 Remove a dependency',
  component: ListedUnderTheWaves,
  parameters: { layout: 'fullscreen' },
  args: { rules: RULES, manifests: MANIFESTS },
  argTypes: { rules: { table: { disable: true } }, manifests: { table: { disable: true } } },
} satisfies Meta<typeof ListedUnderTheWaves>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Recommended: api and web deliver after shared; removing api's puts api in the first wave, and
 * since its manifest still names shared, it is proposed again, with Accept.
 */
export const ListedUnderTheWavesRemoved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const accepted = canvas.getByRole('list', { name: 'Dependencies' })
    expect(within(accepted).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(
      within(accepted).getByRole('button', { name: 'Remove: api delivers after shared' }),
    )
    await waitFor(() =>
      expect(
        within(canvas.getByRole('list', { name: 'Wave 1' })).getAllByRole('listitem'),
      ).toHaveLength(2),
    )
    const proposed = canvas.getByRole('list', { name: 'Proposed dependencies' })
    expect(
      within(proposed).getByRole('button', { name: 'Accept: api delivers after shared' }),
    ).toBeVisible()
  },
}

/** The alternative: web's dialog ticks what it delivers after; api, proposed, unticked. */
export const TickedInTheRepositoryDialog: Story = {
  render: (args) => <TickedInItsDialog rules={args.rules} repository="web" />,
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'web' })
    const shared = within(dialog).getByRole('checkbox', { name: /^shared/ })
    expect(shared).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: /^api/ })).not.toBeChecked()
    await userEvent.click(shared)
    await waitFor(() => expect(shared).not.toBeChecked())
  },
}
