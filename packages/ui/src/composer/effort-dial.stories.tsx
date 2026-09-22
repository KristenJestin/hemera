import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_EFFORTS,
  EFFORT_ARG_TYPES,
  OPENCODE_EFFORTS,
  SetEffort,
} from './agent-model-menu-fixtures.tsx'
import { EffortDial } from './effort-dial.tsx'

/**
 * **Variant 3 of the effort — the horizontal dial**, and the maintainer's own reference.
 *
 * A line of dots, a round thumb on one of them, the agent's word for where it stands over the
 * middle, and what the effort is being set for under it. It is the shape the maintainer brought
 * back from another application, and what it buys over the row is that the step that is on is
 * said once, in full, rather than every step being written out and each of them cut short.
 *
 * Same contract as the vertical slider: one `slider`, the focus taken once, `aria-valuetext` in
 * the agent's own word, the arrows and Home and End. The thumb travels on `morph`; the two
 * lines of type do not travel with it, because a word sliding along a row of dots would make
 * this read as two controls instead of one.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Effort/Dial',
  component: EffortDial,
  render: (args) => <SetEffort {...args} render={(props) => <EffortDial {...props} />} />,
  parameters: { layout: 'padded' },
  args: {
    efforts: CLAUDE_EFFORTS,
    effort: 'high',
    caption: 'Opus 4.5',
    onEffortChange: fn(),
  },
  argTypes: EFFORT_ARG_TYPES,
} satisfies Meta<typeof EffortDial>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, no model to name under it, three steps, and turned off. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <EffortDial efforts={CLAUDE_EFFORTS} effort={null} onEffortChange={fn()} />
      <EffortDial
        efforts={CLAUDE_EFFORTS}
        effort="max"
        caption="Sonnet 4.5"
        onEffortChange={fn()}
      />
      <EffortDial efforts={OPENCODE_EFFORTS} effort="medium" onEffortChange={fn()} />
      <EffortDial efforts={CLAUDE_EFFORTS} effort="low" onEffortChange={fn()} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dials = canvas.getAllByRole('slider', { name: 'Effort' })
    await expect(dials).toHaveLength(4)
    await expect(dials[0]).toHaveAttribute('aria-valuetext', 'Not set')
    // The word is what is read over the dots, and the model under them.
    await expect(dials[1]).toHaveTextContent('Max')
    await expect(dials[1]).toHaveTextContent('Sonnet 4.5')
    // Nothing to name is no line at all, rather than an empty one under the dots.
    await expect(dials[2]).not.toHaveTextContent('Sonnet')
    await expect(dials[3]).toHaveAttribute('aria-disabled', 'true')
  },
}

/** Right is more of it, left is less, and Home and End are the two ends of the dial. */
export const Keyboard: Story = {
  args: { effort: 'medium' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const dial = canvas.getByRole('slider', { name: 'Effort' })

    dial.focus()
    await expect(dial).toHaveFocus()

    await userEvent.keyboard('{ArrowRight}')
    await expect(args.onEffortChange).toHaveBeenCalledWith('high')
    await waitFor(() => {
      expect(dial).toHaveAttribute('aria-valuetext', 'High')
    })

    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(dial).toHaveAttribute('aria-valuetext', 'Medium')
    })

    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(dial).toHaveTextContent('Max')
    })

    await userEvent.keyboard('{Home}')
    await waitFor(() => {
      expect(dial).toHaveTextContent('Default')
    })
  },
}

/** A press on a dot sets it, and it is the dial that answers rather than the dot. */
export const Pointed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const dial = canvas.getByRole('slider', { name: 'Effort' })
    const dot = dial.querySelector('[data-step="default"]')
    await expect(dot).not.toBeNull()
    if (dot === null) return

    await userEvent.click(dot)
    await expect(args.onEffortChange).toHaveBeenCalledWith('default')
    await waitFor(() => {
      expect(dial).toHaveAttribute('aria-valuetext', 'Default')
    })
  },
}
