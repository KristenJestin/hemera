import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InputDot } from './planning-marks.tsx'

/**
 * Where an input of the user stands (CT-26): a ring once received, a blue dot once delivered to the
 * Planner, a green dot once integrated in the Spec. The words are in the tooltip, never beside it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/InputDot',
  component: InputDot,
  args: { state: 'received' },
} satisfies Meta<typeof InputDot>

export default meta
type Story = StoryObj<typeof meta>

/** Received by Hemera: a ring. */
export const Received: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Received' })).toBeVisible()
  },
}

/** Delivered to the Planner: a blue dot; its words come with the tooltip. */
export const Delivered: Story = {
  args: { state: 'delivered' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dot = canvas.getByRole('img', { name: 'Delivered to the Planner' })
    await userEvent.hover(dot)
    await waitFor(() =>
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent(
        'Delivered to the Planner',
      ),
    )
  },
}

/** Integrated in the Spec by the Planner: a green dot. */
export const Integrated: Story = {
  args: { state: 'integrated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Integrated in the Spec' })).toBeVisible()
  },
}

/** A version a later answer replaced: a quiet ring. */
export const Superseded: Story = {
  args: { state: 'superseded' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Replaced by a later answer' })).toBeVisible()
  },
}
