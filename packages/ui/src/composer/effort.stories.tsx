import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { EffortVariant } from './agent-model-menu-shared.tsx'
import { CLAUDE_EFFORTS, EFFORT_ARG_TYPES, SetEffort } from './agent-model-menu-fixtures.tsx'
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
      <Candidate name="2 · Slider" said="The scale read down a track." variant="slider" />
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
