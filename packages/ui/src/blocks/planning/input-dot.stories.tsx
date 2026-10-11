import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InputDot } from './planning-marks.tsx'

/**
 * Where an answer of the user stands, from the press to the Spec: a ring in the warning tone while
 * nothing is answered, a ring once sent, a blue dot once the Planner has it, a green dot once it is
 * taken into account. The dot follows the answer alone; its tooltip says the step and the next one.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/InputDot',
  component: InputDot,
  args: { state: 'received' },
} satisfies Meta<typeof InputDot>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing answered yet: a ring in the warning tone, the question waits for the user. */
export const Unanswered: Story = {
  args: { state: 'unanswered' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dot = canvas.getByRole('img', { name: /^Not answered yet/ })
    await expect(dot.querySelector('[data-input="unanswered"]')).not.toBeNull()
  },
}

/** Sent: Hemera has it, the Planner has not read it yet. */
export const Received: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: /^Sent/ })).toBeVisible()
  },
}

/** With the Planner: a blue dot; the tooltip says what comes next. */
export const Delivered: Story = {
  args: { state: 'delivered' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dot = canvas.getByRole('img', { name: /^With the Planner/ })
    await userEvent.hover(dot)
    await waitFor(() =>
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent(
        'next, taken into account in the Spec',
      ),
    )
  },
}

/** Taken into account in the Spec: a green dot, and only then. */
export const Integrated: Story = {
  args: { state: 'integrated' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Taken into account in the Spec' })).toBeVisible()
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
