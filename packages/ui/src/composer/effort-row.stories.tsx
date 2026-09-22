import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import {
  CLAUDE_EFFORTS,
  EFFORT_ARG_TYPES,
  OPENCODE_EFFORTS,
  SetEffort,
} from './agent-model-menu-fixtures.tsx'
import { EffortRow } from './effort-row.tsx'

/**
 * **Variant 1 of the effort — the row.** Every step written out, side by side, with the one
 * that is on lifted off the strip.
 *
 * It is what the panel has shown since the menu was written, and it is here to be judged
 * against the two the trial of 22 September 2026 added. What it does best is say the whole
 * scale at once: nothing is behind a press, and the distance between "Low" and "Max" is read
 * without moving anything. What it does worst is width — six steps across a panel as wide as a
 * mention menu leaves each of them four characters — which is exactly what the slider and the
 * dial are answers to.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Effort/Row',
  component: EffortRow,
  render: (args) => <SetEffort {...args} render={(props) => <EffortRow {...props} />} />,
  parameters: { layout: 'padded' },
  args: {
    efforts: CLAUDE_EFFORTS,
    effort: 'high',
    onEffortChange: fn(),
  },
  argTypes: EFFORT_ARG_TYPES,
} satisfies Meta<typeof EffortRow>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, three steps instead of six, and the control turned off. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <EffortRow efforts={CLAUDE_EFFORTS} effort={null} onEffortChange={fn()} />
      <EffortRow efforts={CLAUDE_EFFORTS} effort="xhigh" onEffortChange={fn()} />
      <EffortRow efforts={OPENCODE_EFFORTS} effort="medium" onEffortChange={fn()} />
      <EffortRow efforts={CLAUDE_EFFORTS} effort="low" onEffortChange={fn()} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scales = canvas.getAllByRole('group', { name: 'Effort' })
    await expect(scales).toHaveLength(4)
    // Nothing set is nothing lifted: a row that pre-selected a step would be saying the agent
    // announced one when it announced none.
    const none = within(scales[0]!).getAllByRole('button')
    await expect(none.filter((step) => step.getAttribute('aria-pressed') === 'true')).toHaveLength(
      0,
    )
    await expect(within(scales[1]!).getByRole('button', { name: 'Xhigh' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(within(scales[2]!).getAllByRole('button')).toHaveLength(3)
    const off = within(scales[3]!).getAllByRole('button')
    await expect(off.filter((step) => step.hasAttribute('disabled'))).toHaveLength(off.length)
  },
}

/** The row is a row of buttons: Tab walks it, and a press answers with the id. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('group', { name: 'Effort' })
    const steps = within(scale).getAllByRole('button')

    steps[0]!.focus()
    await expect(steps[0]).toHaveFocus()
    await userEvent.tab()
    await expect(steps[1]).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect(args.onEffortChange).toHaveBeenCalledWith('low')
    await expect(within(scale).getByRole('button', { name: 'Low' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}
