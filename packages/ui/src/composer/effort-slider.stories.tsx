import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_EFFORTS,
  EFFORT_ARG_TYPES,
  OPENCODE_EFFORTS,
  SetEffort,
} from './agent-model-menu-fixtures.tsx'
import type { EffortChoice } from './agent-model-menu-shared.tsx'
import { EffortSlider } from './effort-slider.tsx'

/**
 * **The effort, as the maintainer kept it on 22 September 2026.** One track, one notch per
 * level, a short mark beside each of them, the thumb on the level that is on and the agent's
 * own word for it over the top.
 *
 * Read down, a scale reads as a scale: more at the top, less at the bottom, and the distance
 * between two levels is the distance the thumb travels. It costs the height the row did not
 * spend and buys back the width the row did — which is the trade the panel is being asked to
 * make, since a panel has height to spare and no width at all.
 *
 * It is a slider and not a row of notches: the track is pressed, dragged and walked with the
 * keys. The thumb follows the hand while it is held and drops onto the nearest notch when it is
 * let go, a press anywhere on the track is the nearest notch, and the arrows, the page keys,
 * Home and End walk it without a pointer at all. It takes the focus once and says where it
 * stands in the agent's own word through `aria-valuetext`.
 *
 * Nothing in the panel moves when the level changes: every word of the scale is drawn in the
 * same cell of a grid and all but the one that is on are invisible, so the column is as wide as
 * the longest word whichever one is being shown.
 *
 * **It is drawn three ways** since the pass of 22 September 2026, and `look` is which one:
 * `instrument`, `minimal` and `card`. The three are the same control — same props, same role,
 * same `aria-valuetext`, same drag, same keys, same geometry — and every story below that does
 * not name a look is the one that ships, the instrument.
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
  argTypes: {
    ...EFFORT_ARG_TYPES,
    look: {
      control: 'inline-radio',
      options: ['instrument', 'minimal', 'card'],
      description: 'Which of the three drawings of the same scale is on.',
    },
  },
} satisfies Meta<typeof EffortSlider>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A scale whose levels the agent said something about, which is what `Default` needs.
 *
 * `Default` is announced as a value like the others and ACP never says which level it maps to,
 * so it is drawn as its own notch at the foot of the scale with a mark like the others, and
 * what it means is the agent's own sentence or nothing at all. Two of these carry one and the
 * rest do not, which is the shape an answer actually comes in.
 */
const DESCRIBED: EffortChoice[] = [
  { id: 'default', label: 'Default', description: 'Whatever the agent starts on' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Xhigh' },
  { id: 'max', label: 'Max', description: 'Everything it has, for as long as it takes' },
]

/** What the word for the last of them is, which two stories read and one of them types. */
const EVERYTHING = 'Everything it has, for as long as it takes'

/**
 * The same scale once the agent has said which level its `Default` stood for.
 *
 * The other half of the rule of 22 September 2026, and never the same half twice: the entry is
 * gone and the level it named carries the mark instead. Five notches rather than six, `Medium`
 * ringed on the track, dotted beside its short mark, and named as the recommendation in the
 * word over the top.
 */
const RECOMMENDED: EffortChoice[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium', description: 'Whatever the agent starts on', recommended: true },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Xhigh' },
  { id: 'max', label: 'Max', description: EVERYTHING },
]

/** What a level the agent advises is written as, wherever it is written in words. */
const ADVISED = /recommended/

/** What a dispatched pointer carries: one primary pointer, and an event that can be refused. */
const POINTER = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }

/**
 * One painted frame, twice over: React has answered the event and motion has drawn the answer.
 *
 * A pointer dispatched from a story is answered in a state update like any other, and a story
 * that read the page in the same breath would be reading it before React had touched it.
 */
function painted(): Promise<void> {
  return new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()))
  })
}

/** Where the middle of an element is, down the window. */
function middleOf(element: Element | null): number {
  const box = element!.getBoundingClientRect()
  return box.top + box.height / 2
}

/** Where the middle of a notch is, down the window. */
function notchAt(scale: HTMLElement, id: string): number {
  return middleOf(scale.querySelector(`[data-step="${id}"]`))
}

/** A hand on the track: pressed, moved or let go at that height, and the frame it is drawn in. */
async function hand(track: HTMLElement, what: string, clientY: number): Promise<void> {
  const box = track.getBoundingClientRect()
  track.dispatchEvent(new PointerEvent(what, { ...POINTER, clientX: box.left + 2, clientY }))
  await painted()
}

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, three levels instead of six, and the control turned off. */
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

/**
 * The thumb is dragged: it follows the hand between the notches, and drops onto one when it is
 * let go.
 *
 * Both halves are the point. A thumb that jumped from notch to notch under the hand is a row of
 * buttons being pressed in turn, and a thumb left between two notches once the hand has gone is
 * a value nobody can name — so it follows exactly while it is held, and lands exactly when it
 * is dropped.
 */
export const Dragging: Story = {
  args: { effort: 'high' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const track = canvas.getByTestId('effort-scale')
    const thumb = canvas.getByTestId('effort-thumb')

    // Taken hold of at Medium, which is where the press landed rather than where it was.
    await hand(track, 'pointerdown', notchAt(scale, 'medium'))
    await expect(scale).toHaveAttribute('aria-valuetext', 'Medium')

    // Dragged up between High and Xhigh, a little short of Xhigh: the level that is set is the
    // nearer of the two, and the thumb is where the hand is rather than where that level is.
    const between = (notchAt(scale, 'high') + notchAt(scale, 'xhigh')) / 2 - 4
    await hand(track, 'pointermove', between)
    await expect(scale).toHaveAttribute('aria-valuetext', 'Xhigh')
    await expect(Math.abs(middleOf(thumb) - between)).toBeLessThan(1)
    await expect(Math.abs(middleOf(thumb) - notchAt(scale, 'xhigh'))).toBeGreaterThan(1)

    // Let go where it was and not on a notch: the thumb goes to the notch on its own.
    await hand(track, 'pointerup', between)
    await expect(args.onEffortChange).toHaveBeenLastCalledWith('xhigh')
    await waitFor(
      () => {
        expect(Math.abs(middleOf(thumb) - notchAt(scale, 'xhigh'))).toBeLessThan(1)
      },
      { timeout: 2000 },
    )
  },
}

/**
 * A press anywhere on the track sets the nearest notch, and a press off every notch is still a
 * press on the track.
 *
 * This is what the control did not do before the pass of 22 September 2026: the notches
 * answered and the track between them answered nothing, so a reader aiming at a level and
 * missing it by three pixels was a reader whose press did nothing at all.
 */
export const ClickOnTrack: Story = {
  args: { effort: 'high' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const track = canvas.getByTestId('effort-scale')

    // Between Default and Low, four pixels nearer Low, and on neither of their notches.
    const between = (notchAt(scale, 'default') + notchAt(scale, 'low')) / 2 - 4
    await hand(track, 'pointerdown', between)
    await hand(track, 'pointerup', between)
    await expect(args.onEffortChange).toHaveBeenLastCalledWith('low')
    await expect(scale).toHaveAttribute('aria-valuetext', 'Low')

    // And the press hands the control the focus, so what a pointer began the keys can finish.
    await expect(scale).toHaveFocus()
  },
}

/** The arrows walk it, the page keys take a third of it, Home and End are its two ends. */
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

    // A page is a third of the scale: two of Claude's six levels, and more than an arrow.
    await userEvent.keyboard('{PageUp}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Xhigh')
    })
    await userEvent.keyboard('{PageDown}')
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
 * **The level the agent advises**, which is what `Default` becomes once the agent says what it
 * stood for (decision of 22 September 2026).
 *
 * There is no `Default` notch here at all: the agent named the level its default resolves to,
 * so the entry is gone and `Medium` wears the mark in its place — ringed on the track, dotted
 * beside its short mark, and named in the word over the top and in `aria-valuetext`. The one
 * thing a scale must never show is both, because a `Default` standing beside the level it names
 * offers the same thing twice under two names.
 *
 * It is pre-selected, and that is the agent's doing rather than this control's: what the scale
 * stands on is what was handed to it.
 */
export const WithRecommended: Story = {
  args: { efforts: RECOMMENDED, effort: 'medium' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })

    // The entry is gone, and what it stood for is what the scale is on.
    await expect(canvas.queryByText('Default')).toBeNull()
    await expect(scale).toHaveAttribute('aria-valuemax', '4')
    await expect(scale).toHaveAttribute(
      'aria-valuetext',
      'Medium, Whatever the agent starts on, recommended',
    )

    // Said in words beside the level's own name, quietly, because the name is what is set.
    await expect(canvas.getByText(ADVISED)).toBeVisible()
    // And once: a scale that marked two levels would be a scale marking nothing.
    await expect(canvas.getAllByText(ADVISED)).toHaveLength(1)

    // The mark travels with the level rather than with the thumb: walking off Medium leaves it
    // where it is, because it is the agent's recommendation and not where the reader stands.
    scale.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', `Max, ${EVERYTHING}`)
    })
    await expect(canvas.getAllByText(ADVISED)).toHaveLength(1)
  },
}

/**
 * Neither list holds both: a `Default` entry, or a level marked as recommended.
 *
 * The two halves of the rule side by side, measured rather than argued. On the left the agent
 * said nothing, so `Default` stands at the foot of the scale and no level is marked; on the
 * right it said which level its default was, so that level is marked and there is no `Default`
 * at all. A scale showing both would be offering the same level twice under two names, which is
 * exactly what the decision of 22 September 2026 refuses.
 */
export const NeverBoth: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-8">
      <EffortSlider efforts={DESCRIBED} effort="default" onEffortChange={fn()} />
      <EffortSlider efforts={RECOMMENDED} effort="medium" onEffortChange={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scales = canvas.getAllByRole('slider', { name: 'Effort' })
    await expect(scales).toHaveLength(2)

    const held = scales.map((scale) => ({
      stands: within(scale).queryAllByText('Default').length,
      named: within(scale).queryAllByText(ADVISED).length,
    }))
    // One or the other, and exactly one of the two: never both, and never neither.
    await expect(held.map((one) => one.stands > 0 && one.named > 0)).toEqual([false, false])
    await expect(held.map((one) => one.stands + one.named > 0)).toEqual([true, true])

    await expect(within(scales[0]!).getByText('Default')).toBeInTheDocument()
    await expect(within(scales[1]!).getByText(ADVISED)).toBeInTheDocument()
  },
}

/**
 * `Default` as its own notch at the foot of the scale, and what the agent said about it.
 *
 * The unresolved case, and the only one that draws this entry at all: the agent announced
 * `Default` as a value like the others and said nothing about which level it maps to. Hemera
 * does not invent one — it is the lowest notch, marked `D` as every level is marked, and what
 * it means is the agent's own sentence under the name, or nothing at all for the levels the
 * agent said nothing about. Nothing is marked as recommended here, because nothing was named.
 */
export const WithDefault: Story = {
  args: { efforts: DESCRIBED, effort: 'default' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    // The marks, and not the words over the track: `Max` is both, and only one of them is a
    // mark on the scale.
    const marks = within(canvas.getByTestId('effort-marks'))

    // Nothing named, nothing marked: the entry stands for itself and no level wears the ring.
    await expect(canvas.queryByText(ADVISED)).toBeNull()

    // Its own notch at the foot of the scale: under every other mark, and marked like them.
    await expect(marks.getByText('D')).toBeVisible()
    await expect(middleOf(marks.getByText('D'))).toBeGreaterThan(middleOf(marks.getByText('L')))
    await expect(middleOf(marks.getByText('Max'))).toBeLessThan(middleOf(marks.getByText('XH')))

    // The sentence is the agent's, and it is read as part of where the control stands.
    await expect(canvas.getByText('Whatever the agent starts on')).toBeVisible()
    await expect(scale).toHaveAttribute('aria-valuetext', 'Default, Whatever the agent starts on')

    // A level the agent said nothing about is given no sentence rather than an invented one.
    scale.focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Low')
    })
    await expect(canvas.getByText('Whatever the agent starts on')).not.toBeVisible()
  },
}

/**
 * Nothing moves when the level does — measured, and not argued.
 *
 * This is the defect the pass of 22 September 2026 was asked to fix: the word over the track is
 * the level's own, the levels are not the same length, and a column as wide as the word being
 * shown is a menu that jumps every time the reader walks the scale. The words are stacked in
 * one cell of a grid, the descriptions in another, and the marks stand in a column of one
 * width — so the box is the same at both ends of the scale, and so is where it sits.
 */
export const NoMovement: Story = {
  args: { efforts: DESCRIBED, effort: 'default', caption: 'Opus 4.5' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const panel = canvasElement.firstElementChild!

    const before = panel.getBoundingClientRect()
    const stood = scale.getBoundingClientRect()

    scale.focus()
    // Right across the scale: the longest word to the shortest, a level the agent described to
    // one it did not, and the first notch to the last.
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', `Max, ${EVERYTHING}`)
    })
    await painted()

    const after = panel.getBoundingClientRect()
    await expect(after.width).toBeCloseTo(before.width, 1)
    await expect(after.height).toBeCloseTo(before.height, 1)

    const stands = scale.getBoundingClientRect()
    await expect(stands.width).toBeCloseTo(stood.width, 1)
    await expect(stands.height).toBeCloseTo(stood.height, 1)
    await expect(stands.left).toBeCloseTo(stood.left, 1)
    await expect(stands.top).toBeCloseTo(stood.top, 1)
  },
}

/**
 * The same scale for a reader who asked for less movement: the thumb is on its notch, and
 * nothing carried it there.
 *
 * `MotionConfig` is the way the preference is said here rather than the browser's own media
 * query, for the reason the thread's own fold gives: the query is read once, when a component
 * mounts, and a story that emulates it afterwards is testing a tree that never heard. What is
 * proved is the rule — a scale told to move less is not one whose thumb travels quickly, it is
 * one where the thumb is simply on the level that is set.
 */
export const ReducedMotion: Story = {
  args: { effort: 'default' },
  parameters: { controls: { disable: true } },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <SetEffort {...args} render={(props) => <EffortSlider {...props} />} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const thumb = canvas.getByTestId('effort-thumb')

    scale.focus()
    await userEvent.keyboard('{End}')
    await painted()
    // The whole length of the track inside one frame: `morph` would be a tenth of the way up
    // it, which is the difference this assertion measures.
    await expect(scale).toHaveAttribute('aria-valuetext', 'Max')
    await expect(Math.abs(middleOf(thumb) - notchAt(scale, 'max'))).toBeLessThan(1)
  },
}

/**
 * **The instrument**, which is what ships: the track sunk into a pill-shaped well a surface
 * below the panel, dots that light up in the accent as they are passed, a twenty-pixel thumb
 * with a domed core and two layers of halo — a wide, blurred glow under a crisp ring — and the
 * level's short mark in a chip that travels beside it.
 *
 * The well is the whole of why it reads as one crafted piece rather than as a form control: a
 * track drawn on the panel is a line somebody put there, and a track sunk into a groove is a
 * part of something. The chip is what a gauge has and a form control does not — the scale down
 * the side says what the levels are, the chip says where the needle is.
 */
export const Instrument: Story = {
  args: { efforts: DESCRIBED, effort: 'high', caption: 'Opus 4.5' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    await expect(scale).toHaveAttribute('data-look', 'instrument')

    // The well is the look's own piece: no other draws one.
    await expect(canvas.getByTestId('effort-well')).toBeVisible()
    // And the chip travels with the thumb, carrying the short mark of the level that is on.
    const chip = canvas.getByTestId('effort-chip')
    await expect(chip).toHaveTextContent('H')
    await expect(
      Math.abs(middleOf(chip) - middleOf(canvas.getByTestId('effort-thumb'))),
    ).toBeLessThan(1)

    // It is the largest of the three thumbs: twenty pixels, one step of the theme's scale.
    await expect(canvas.getByTestId('effort-knob').getBoundingClientRect().width).toBeCloseTo(20, 0)

    // The mark follows the level rather than the other way round.
    scale.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(chip).toHaveTextContent('Max')
    })
  },
}

/**
 * **The minimal**, where the drawing is the room around it: a hairline track two pixels wide,
 * notches at two, a fourteen-pixel thumb, the level's name in one weight and nothing else.
 *
 * No marks down the side, no sentence under the name, no well. What is left has to be spaced
 * and aligned exactly or there is nothing there to carry it — which is the point of keeping it
 * beside the other two.
 */
export const Minimal: Story = {
  args: { look: 'minimal', efforts: DESCRIBED, effort: 'high' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    await expect(scale).toHaveAttribute('data-look', 'minimal')

    // Nothing but the scale and the word: no column of marks, no well, no chip.
    await expect(canvas.queryByTestId('effort-marks')).toBeNull()
    await expect(canvas.queryByTestId('effort-well')).toBeNull()
    await expect(canvas.queryByTestId('effort-chip')).toBeNull()
    // Nor the agent's sentence, which this look has no line for.
    await expect(canvas.queryByText('Whatever the agent starts on')).toBeNull()

    // The smallest of the three thumbs: fourteen pixels, and the scale's own step for it.
    await expect(canvas.getByTestId('effort-knob').getBoundingClientRect().width).toBeCloseTo(14, 0)
    // The word is still the agent's, and still the value.
    await expect(canvas.getByText('High')).toBeVisible()
  },
}

/**
 * **The card**, which is the shape the maintainer brought back from another application: a bolt
 * at the top left, the level in the accent with a chevron after it, the model under it in the
 * quiet colour, and the scale under that — the whole of it on a card that lifts by one step of
 * the shadow scale when the hand comes over it.
 *
 * It is the only look that says the model beside the level rather than under the control, which
 * is what makes it read as one object: a thing that knows what it is set to and what it is set
 * for. It costs a card's worth of room, which is the trade.
 */
export const Card: Story = {
  args: { look: 'card', effort: 'high', caption: 'Opus 4.5' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    await expect(scale).toHaveAttribute('data-look', 'card')

    // The header is the look's own piece: the bolt, the level and the model on one line each.
    const head = canvas.getByTestId('effort-head')
    await expect(head).toBeVisible()
    await expect(within(head).getByText('High')).toBeVisible()
    await expect(within(head).getByText('Opus 4.5')).toBeVisible()
    // The bolt and the chevron are drawn, and both are marks rather than anything to read.
    await expect(head.querySelectorAll('svg')).toHaveLength(2)

    // The model is said once: the caption under the control belongs to the other two looks.
    await expect(canvas.getAllByText('Opus 4.5')).toHaveLength(1)
    await expect(canvas.queryByTestId('effort-marks')).toBeNull()
  },
}
