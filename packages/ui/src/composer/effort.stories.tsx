import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { EffortVariant } from './agent-model-menu-shared.tsx'
import { CLAUDE_EFFORTS, EFFORT_ARG_TYPES, SetEffort } from './agent-model-menu-fixtures.tsx'
import type { EffortLook } from './effort-slider.tsx'
import { EffortSlider } from './effort-slider.tsx'
import { EffortControl } from './effort.tsx'

/**
 * The three ways of asking one question, on one canvas and on the same scale.
 *
 * 1 — **the row**: every step written out, side by side. 2 — **the slider**: the same scale read
 * down a track, one word at a time. 3 — **the dial**: the same scale read across a line of dots,
 * with what is set said in full over it and what it is set for under it.
 *
 * They take the same props and are handed the same six efforts, so what is being compared is
 * the shape and nothing else. Each keeps its own answer: set one and the other two are
 * untouched, which is what makes them three candidates rather than three views of one state.
 * The question is how much of the panel each of them spends, and how much of the scale a reader
 * can hold in their head after looking at it once.
 *
 * **The maintainer kept the slider on 22 September 2026**, and it is the one that was worked on
 * afterwards: dragged, pressed anywhere along its track, and still whatever the level is. The
 * row and the dial stay here as what it was chosen against, and the word is still an argument
 * of the panels — so any of the three can be drawn while the change is being read.
 *
 * What is being compared since the pass of that same evening is no longer the shape but the
 * drawing: `Looks` puts the slider's three — the instrument, the minimal and the card — beside
 * the row and the dial it was chosen over, on one canvas and at the same scale.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Effort/Compare',
  component: EffortControl,
  parameters: { layout: 'padded' },
  args: {
    efforts: CLAUDE_EFFORTS,
    effort: 'high',
    caption: 'Opus 4.5',
    onEffortChange: fn(),
  },
  argTypes: {
    ...EFFORT_ARG_TYPES,
    variant: {
      control: 'inline-radio',
      options: ['row', 'slider', 'dial'],
      description: 'Which of the three is drawn; the panels take the same word.',
    },
  },
} satisfies Meta<typeof EffortControl>

export default meta
type Story = StoryObj<typeof meta>

/** One control, in whichever of the three shapes you ask for. */
export const Playground: Story = {
  render: (args) => <SetEffort {...args} render={(props) => <EffortControl {...props} />} />,
}

const CANDIDATE = 'flex min-w-0 flex-1 flex-col items-center gap-2'

const NAME = 'text-sm font-medium'

const SAID = 'text-center text-xs text-muted-foreground'

function Candidate({
  name,
  said,
  variant,
}: {
  name: string
  said: string
  variant: EffortVariant
}): ReactNode {
  return (
    <div className={CANDIDATE}>
      <span className={NAME}>{name}</span>
      <span className={SAID}>{said}</span>
      <SetEffort
        efforts={CLAUDE_EFFORTS}
        effort="high"
        caption="Opus 4.5"
        onEffortChange={fn()}
        render={(props) => <EffortControl {...props} variant={variant} />}
      />
    </div>
  )
}

/** The three, side by side, each with its own answer and the same six steps to give it in. */
export const SideBySide: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-6">
      <Candidate name="1 · Row" said="Every step written out." variant="row" />
      <Candidate name="2 · Slider" said="Kept: the scale read down a track." variant="slider" />
      <Candidate name="3 · Dial" said="The scale read across, said in full." variant="dial" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // One of the three is a group of buttons; the other two are one control each.
    const row = canvas.getByRole('group', { name: 'Effort' })
    await expect(within(row).getAllByRole('button')).toHaveLength(6)
    const scales = canvas.getAllByRole('slider', { name: 'Effort' })
    await expect(scales).toHaveLength(2)

    // The row spends the width the panel has not got; the dial spends the same width and says
    // one word, and the slider spends the height instead. Measured rather than argued.
    const wide = row.getBoundingClientRect()
    const tall = scales[0]!.getBoundingClientRect()
    await expect(tall.height).toBeGreaterThan(wide.height)
    await expect(tall.width).toBeLessThan(wide.width)

    // Each keeps its own answer: setting one leaves the other two where they were.
    scales[0]!.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scales[0]).toHaveAttribute('aria-valuetext', 'Max')
    })
    await expect(scales[1]).toHaveAttribute('aria-valuetext', 'High')
    await expect(within(row).getByRole('button', { name: 'High' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

/** One of the slider's three drawings, named and said, beside the two shapes it was chosen over. */
function Look({ name, said, look }: { name: string; said: string; look: EffortLook }): ReactNode {
  return (
    <div className={CANDIDATE}>
      <span className={NAME}>{name}</span>
      <span className={SAID}>{said}</span>
      <SetEffort
        efforts={CLAUDE_EFFORTS}
        effort="high"
        caption="Opus 4.5"
        onEffortChange={fn()}
        render={(props) => <EffortSlider {...props} look={look} />}
      />
    </div>
  )
}

/**
 * The slider's three looks, beside the row and the dial: five drawings of one question.
 *
 * The three in the middle are the same control — same props, same role, same drag, same keys —
 * and differ in nothing but how they are drawn, which is what this canvas is for. The row and
 * the dial stand at each end as the two shapes the slider was kept over, so the drawing is
 * judged against something and not against itself.
 */
export const Looks: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-6">
      <Candidate name="Row" said="The shape it was chosen over." variant="row" />
      <Look name="Instrument" said="A track sunk into a well, and a lit thumb." look="instrument" />
      <Look name="Minimal" said="A hairline, and the room around it." look="minimal" />
      <Look name="Card" said="The reference: a bolt, a level, a model." look="card" />
      <Candidate name="Dial" said="The same scale read across." variant="dial" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Four sliders on the canvas: the three looks and the dial. The row is a group of buttons.
    const scales = canvas.getAllByRole('slider', { name: 'Effort' })
    await expect(scales).toHaveLength(4)
    await expect(scales.map((one) => one.getAttribute('data-look'))).toEqual([
      'instrument',
      'minimal',
      'card',
      null,
    ])

    // Each look brings its own distinctive piece and none of the others'.
    await expect(canvas.getAllByTestId('effort-well')).toHaveLength(1)
    await expect(canvas.getAllByTestId('effort-chip')).toHaveLength(1)
    await expect(canvas.getAllByTestId('effort-head')).toHaveLength(1)
    // The marks belong to the instrument alone among the three.
    await expect(canvas.getAllByTestId('effort-marks')).toHaveLength(1)

    // And the three are one control: each keeps its own answer, and all three start on High.
    await Promise.all(scales.map((one) => expect(one).toHaveAttribute('aria-valuetext', 'High')))
    scales[1]!.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scales[1]).toHaveAttribute('aria-valuetext', 'Max')
    })
    await expect(scales[0]).toHaveAttribute('aria-valuetext', 'High')
    await expect(scales[2]).toHaveAttribute('aria-valuetext', 'High')
    // And the focus is handed back: a canvas five drawings are compared on is a canvas where
    // one of them wearing a focus ring is one of them being shown differently from the rest.
    scales[1]!.blur()
  },
}
