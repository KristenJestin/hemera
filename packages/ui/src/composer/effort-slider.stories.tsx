import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_EFFORTS,
  EFFORT_ARG_TYPES,
  OPENCODE_EFFORTS,
  SetEffort,
} from './agent-model-menu-fixtures.tsx'
import { EffortSlider } from './effort-slider.tsx'

/**
 * **Variant 2 of the effort — the vertical slider.** One track, one notch per step, the thumb
 * on the one that is on, and the agent's word for it beside the thumb.
 *
 * Read down, a scale reads as a scale: more at the top, less at the bottom, and the distance
 * between two steps is the distance the thumb travels. It costs the height the row did not
 * spend and buys back the width the row did — which is the trade the panel is being asked to
 * make, since a panel has height to spare and no width at all.
 *
 * It is one control and not six: it takes the focus once, says where it stands in the agent's
 * own word through `aria-valuetext`, and the arrows walk it with Home and End at the two ends.
 * The thumb travels on `morph`; the word is set where it lands, because a word stretched
 * between two lengths on the way is a word nobody can read mid-flight.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Effort/Slider',
  component: EffortSlider,
  render: (args) => <SetEffort {...args} render={(props) => <EffortSlider {...props} />} />,
  parameters: { layout: 'padded' },
  args: {
    efforts: CLAUDE_EFFORTS,
    effort: 'high',
    onEffortChange: fn(),
  },
  argTypes: EFFORT_ARG_TYPES,
} satisfies Meta<typeof EffortSlider>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, three steps instead of six, and the control turned off. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-8">
      <EffortSlider efforts={CLAUDE_EFFORTS} effort={null} onEffortChange={fn()} />
      <EffortSlider efforts={CLAUDE_EFFORTS} effort="max" onEffortChange={fn()} />
      <EffortSlider efforts={OPENCODE_EFFORTS} effort="medium" onEffortChange={fn()} />
      <EffortSlider efforts={CLAUDE_EFFORTS} effort="low" onEffortChange={fn()} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scales = canvas.getAllByRole('slider', { name: 'Effort' })
    await expect(scales).toHaveLength(4)
    // The word, not a number out of six: "High" is what the agent said and what the reader set.
    await expect(scales[0]).toHaveAttribute('aria-valuetext', 'Not set')
    await expect(scales[1]).toHaveAttribute('aria-valuetext', 'Max')
    await expect(scales[2]).toHaveAttribute('aria-valuemax', '2')
    // Off is still read, and still says where it stands: a slider the browser disabled would be
    // passed over by whatever reads the page without a word.
    await expect(scales[3]).toHaveAttribute('aria-disabled', 'true')
    await expect(scales[3]).toHaveAttribute('tabindex', '-1')
  },
}

/** The arrows walk it, Home and End are its two ends, and the thumb follows. */
export const Keyboard: Story = {
  args: { effort: 'medium' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })

    scale.focus()
    await expect(scale).toHaveFocus()

    // Up is more of it, which is the one thing a vertical scale must not get wrong.
    await userEvent.keyboard('{ArrowUp}')
    await expect(args.onEffortChange).toHaveBeenCalledWith('high')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'High')
    })

    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Medium')
    })

    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Max')
    })

    await userEvent.keyboard('{Home}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Default')
    })
    // And it stops at the end rather than wrapping round: a scale that came back to the top
    // from the bottom would be a scale nobody can hold the shape of.
    await userEvent.keyboard('{ArrowDown}')
    await expect(scale).toHaveAttribute('aria-valuetext', 'Default')
  },
}

/**
 * A press on a notch sets it, and it is the scale that answers rather than the notch.
 *
 * The mark is pressed and not the word beside it: every word is drawn so that the control is as
 * wide as its widest step whatever is on, and the ones that are not on are drawn and not shown.
 */
export const Pointed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const notch = scale.querySelector('[data-step="default"]')?.firstElementChild
    await expect(notch ?? null).not.toBeNull()
    if (notch === null || notch === undefined) return

    await userEvent.click(notch)
    await expect(args.onEffortChange).toHaveBeenCalledWith('default')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Default')
    })
  },
}
