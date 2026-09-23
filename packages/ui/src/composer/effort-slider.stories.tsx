import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_EFFORTS,
  EFFORT_ARG_TYPES,
  OPENCODE_EFFORTS,
  SetEffort,
  UNRESOLVED_EFFORTS,
} from './agent-model-menu-fixtures.tsx'
import { EffortSlider } from './effort-slider.tsx'

/**
 * **How hard the agent is to think, as the instrument the maintainer kept on 22 September
 * 2026.** One track sunk into a groove, one notch per level, a short mark beside each of them,
 * a lit thumb on the level that is on and the agent's own word for it over the top.
 *
 * Read down, a scale reads as a scale: more at the top, less at the bottom, and the distance
 * between two levels is the distance the thumb travels. It costs the height a row of steps did
 * not spend and buys back the width that row did — which is the trade the panel wanted, since
 * a panel has height to spare and no width at all.
 *
 * It is a slider and not a row of notches: the track is pressed, dragged and walked with the
 * keys. The thumb follows the hand while it is held and drops onto the nearest notch when it is
 * let go, a press anywhere on the track is the nearest notch, and the arrows, the page keys,
 * Home and End walk it without a pointer at all. It takes the focus once and says where it
 * stands in the agent's own word through `aria-valuetext`.
 *
 * The level the model puts a Session on by itself — its own default, handed over as
 * `defaultId` — is a thin accent rule laid across the track at its notch, never a value of its
 * own, and it is where the scale opens. What the agent *advises* draws nothing: Claude advises
 * `Medium` for every model, which says nothing about any of them. An agent that announced a `Default` nobody
 * could resolve gets no notch for it at all: the real levels are the scale, and the thumb waits
 * at the foot of it with `Default` written above until a level is chosen.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Composer/EffortSlider',
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

/** What the model's default is written as beside its level's name. */
const DEFAULTED = /· default/

/** What the agent said its highest level is, which two stories read. */
const EVERYTHING = 'Everything it has, for as long as it takes'

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

/**
 * The three things drawn at one level stand at one height, to the pixel: the thumb, the notch's
 * own dot (or the rule, where that level is the model's default) and the level's mark.
 */
function standTogether(scale: HTMLElement, id: string): void {
  const thumb = middleOf(within(scale).getByTestId('effort-thumb'))
  const dot = middleOf(scale.querySelector(`[data-step="${id}"]`)?.firstElementChild ?? null)
  const mark = middleOf(scale.querySelector(`[data-mark="${id}"]`))
  expect(Math.abs(thumb - dot), `the thumb is off the notch of ${id}`).toBeLessThan(1)
  expect(Math.abs(mark - dot), `the mark of ${id} is off its notch`).toBeLessThan(1)
}

/** A hand on the track: pressed, moved or let go at that height, and the frame it is drawn in. */
async function hand(track: HTMLElement, what: string, clientY: number): Promise<void> {
  const box = track.getBoundingClientRect()
  track.dispatchEvent(new PointerEvent(what, { ...POINTER, clientX: box.left + 2, clientY }))
  await painted()
}

/**
 * Every prop as a control, and the answer wired to a page that keeps it.
 *
 * Claude Code's five levels on Opus, with the model's default ruled across the track: press it,
 * drag it, walk it with the keys, and hand it another agent's scale from the controls.
 */
export const Playground: Story = { args: { defaultId: 'xhigh' } }

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

    // Taken hold of at Low, which is where the press landed rather than where it was.
    await hand(track, 'pointerdown', notchAt(scale, 'low'))
    await expect(scale).toHaveAttribute('aria-valuetext', 'Low')

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
 * **The thumb, the notch and the mark are at one height**, at every level of the scale — the
 * defect of the trial of 22 September 2026, where the thumb stood between `XH` and `H` with
 * `Xhigh` set.
 *
 * Read the moment the scale is drawn, and not once something has had time to settle: the thumb
 * used to be carried to its notch in pixels measured against a rail still being laid out, which
 * is a thumb off its notch for as long as the reader is looking at it. Then walked from the foot
 * to the head, and measured again at every notch once the thumb has arrived.
 */
export const Aligned: Story = {
  args: { effort: 'xhigh' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })

    // Where the scale opens, at once: the thumb is drawn where it stands, never carried there.
    standTogether(scale, 'xhigh')

    scale.focus()
    await userEvent.keyboard('{Home}')
    await walkUp(scale, 0)
  },
}

/**
 * Walks Claude Code's scale up from that notch, one at a time, and measures every notch once the
 * thumb has arrived on it. One step after the other and never at once: each one is a key the
 * scale has to have answered before the next is pressed.
 */
async function walkUp(scale: HTMLElement, index: number): Promise<void> {
  const level = CLAUDE_EFFORTS[index]
  if (level === undefined) return
  if (index > 0) await userEvent.keyboard('{ArrowUp}')
  await waitFor(
    () => {
      standTogether(scale, level.id)
    },
    { timeout: 2000 },
  )
  await walkUp(scale, index + 1)
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

    // Between Low and Medium, four pixels nearer Medium, and on neither of their notches.
    const between = (notchAt(scale, 'low') + notchAt(scale, 'medium')) / 2 - 4
    await hand(track, 'pointerdown', between)
    await hand(track, 'pointerup', between)
    await expect(args.onEffortChange).toHaveBeenLastCalledWith('medium')
    await expect(scale).toHaveAttribute('aria-valuetext', 'Medium')

    // And the press hands the control the focus, so what a pointer began the keys can finish.
    await expect(scale).toHaveFocus()
  },
}

/** The arrows walk it, the page keys take a third of it, Home and End are its two ends. */
export const Keyboard: Story = {
  args: { efforts: OPENCODE_EFFORTS, effort: 'medium' },
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

    // A page is a third of the scale, and never less than an arrow: one of OpenCode's three.
    await userEvent.keyboard('{PageUp}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'High')
    })
    await userEvent.keyboard('{PageDown}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Medium')
    })

    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'High')
    })

    await userEvent.keyboard('{Home}')
    await waitFor(() => {
      expect(scale).toHaveAttribute('aria-valuetext', 'Low')
    })
    // And it stops at the end rather than wrapping round: a scale that came back to the top
    // from the bottom would be a scale nobody can hold the shape of.
    await userEvent.keyboard('{ArrowDown}')
    await expect(scale).toHaveAttribute('aria-valuetext', 'Low')
  },
}

/**
 * **The model's own default, and the `Default` nobody could resolve**, side by side.
 *
 * On the left the scale is on Opus, which puts a Session on `Xhigh` by itself: there is no
 * `Default` entry at all, a thin accent rule is laid across the track at `Xhigh`, the word
 * `default` stands beside that level's name while it is the one showing, and the scale opens on
 * it although nothing has been set — because that is what the next turn would run at. `Medium`
 * is the level the agent *advises*, for every model alike, and it draws nothing (probe of
 * 22 September 2026).
 *
 * On the right the agent said nothing, and nothing is invented: `Default` is not drawn as a
 * notch, because a scale cannot place a level whose meaning nobody knows. The five real levels
 * are the scale, the thumb waits at the foot of the track, and the word above it reads
 * `Default` with the agent's own sentence under it until a level is chosen.
 */
export const DefaultOfTheModel: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-8">
      <SetEffort
        efforts={CLAUDE_EFFORTS}
        effort={null}
        defaultId="xhigh"
        onEffortChange={fn()}
        render={(props) => <EffortSlider {...props} />}
      />
      {/* Wired to a page of its own, because the last thing this story asks is what happens
          once a level is chosen, and a control nobody answers cannot be walked. */}
      <SetEffort
        efforts={UNRESOLVED_EFFORTS}
        effort="default"
        onEffortChange={fn()}
        render={(props) => <EffortSlider {...props} />}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [defaulted, unresolved] = canvas.getAllByRole('slider', { name: 'Effort' })

    // The rule is drawn once, on the model's default and not on the level advised, and nowhere
    // on the scale whose default nobody knows.
    await expect(within(defaulted!).getAllByTestId('effort-rule')).toHaveLength(1)
    await expect(
      defaulted!.querySelector('[data-step="xhigh"] [data-testid="effort-rule"]'),
    ).not.toBeNull()
    await expect(within(defaulted!).getByText(DEFAULTED)).toBeVisible()
    await expect(within(defaulted!).queryByText(/recommended/)).toBeNull()
    await expect(within(unresolved!).queryByTestId('effort-rule')).toBeNull()
    await expect(within(unresolved!).queryByText(DEFAULTED)).toBeNull()

    // Nothing set, and the scale opens on the model's default rather than at the foot.
    await expect(defaulted).toHaveAttribute('aria-valuetext', 'Xhigh, default')
    await expect(defaulted).toHaveAttribute('aria-valuenow', '3')
    const thumb = within(defaulted!).getByTestId('effort-thumb')
    await waitFor(() => {
      expect(Math.abs(middleOf(thumb) - notchAt(defaulted!, 'xhigh'))).toBeLessThan(1)
    })

    // And the unresolved `Default`: five notches, none of them its own, the thumb at the foot
    // of the track and the agent's own word for what it is above it.
    await expect(unresolved).toHaveAttribute('aria-valuemax', '4')
    await expect(unresolved!.querySelector('[data-step="default"]')).toBeNull()
    await expect(unresolved).toHaveAttribute(
      'aria-valuetext',
      'Default, Whatever the agent starts on',
    )
    await expect(within(unresolved!).getByText('Default')).toBeVisible()
    const waiting = within(unresolved!).getByTestId('effort-thumb')
    await waitFor(() => {
      expect(Math.abs(middleOf(waiting) - notchAt(unresolved!, 'low'))).toBeLessThan(1)
    })

    // Until a level is chosen, which is when the scale starts answering for itself.
    unresolved!.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => {
      expect(unresolved).toHaveAttribute('aria-valuetext', `Max, ${EVERYTHING}`)
    })
    await expect(within(unresolved!).queryByText('Default')).not.toBeVisible()
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
  args: { efforts: UNRESOLVED_EFFORTS, effort: 'default' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scale = canvas.getByRole('slider', { name: 'Effort' })
    const panel = canvasElement.firstElementChild!

    const before = panel.getBoundingClientRect()
    const stood = scale.getBoundingClientRect()

    scale.focus()
    // Right across the scale: the longest word to the shortest, a level the agent described to
    // one it did not, and the foot of the track to the head of it.
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
  args: { effort: 'low' },
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
