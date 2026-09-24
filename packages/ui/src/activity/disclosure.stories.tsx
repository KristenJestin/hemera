import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AT_ONCE, movesLess, withinFrames } from '../../.storybook/reduced-motion.ts'
import { Disclosure } from './disclosure.tsx'

/**
 * What folds: the line a block is read by, and what it holds once it is asked for (design
 * D17-05).
 *
 * Two stories, which are the two ways a fold is read: opened, and closed while it is still
 * opening — the moment it used to grow for a frame after the press instead of turning round
 * (issue #64).
 */
const BODY = Array.from(
  { length: 12 },
  (_, index) => `[${index}] packages/ui/src/session/session.tsx:${index * 3} read`,
).join('\n')

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Activity/Disclosure',
  component: Disclosure,
  parameters: { layout: 'padded' },
  args: {
    summary: 'Read src/session/session.tsx',
    children: <div className="font-mono text-xs whitespace-pre text-muted-foreground">{BODY}</div>,
  },
  argTypes: {
    summary: { control: 'text', description: 'The line that is read while the body is closed.' },
    children: { control: false, description: 'What the block holds; drawn only while it is open.' },
    holdsPress: {
      control: 'boolean',
      description: 'Whether the summary holds a press of its own.',
    },
    open: { control: 'boolean', description: 'Whether it is open, when the caller decides.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts open.' },
    onOpenChange: { control: false, description: 'What a fold or an unfold reports.' },
  },
} satisfies Meta<typeof Disclosure>

export default meta

type Story = StoryObj<typeof meta>

/** How much room the opening spring must have made before the press that closes it, in pixels. */
const MID_OPENING = 4

/** How long a fold is watched for at the most, in frames, so one that never answers still ends. */
const PATIENCE = 240

/** The room the body is given, read off the control that names it. */
function roomOf(canvasElement: HTMLElement, row: HTMLElement): HTMLElement | null {
  const named = row.getAttribute('aria-controls')
  return named === null ? null : canvasElement.ownerDocument.getElementById(named)
}

/** One frame of the fold: what the room measures, and what the line said on that same frame. */
interface FoldFrame {
  closed: boolean
  height: number
}

/**
 * The fold read frame by frame, from before the press until three frames have followed the one the
 * line first reports itself closed on.
 *
 * Frame by frame rather than waited out, because the frame the press lands on is the frame the
 * line turns to `false`, and what the fold does with the three after it is the whole question: a
 * `waitFor` hands back a fold already on its way down, with the frame that grew missing.
 */
function foldOverFrames(row: HTMLElement, room: HTMLElement): Promise<FoldFrame[]> {
  return new Promise((settle) => {
    const seen: FoldFrame[] = []
    const look = (left: number): void => {
      seen.push({
        closed: row.getAttribute('aria-expanded') === 'false',
        height: room.getBoundingClientRect().height,
      })
      const closedAt = seen.findIndex((frame) => frame.closed)
      if (left === 0 || (closedAt !== -1 && seen.length >= closedAt + 4)) {
        settle(seen)
        return
      }
      requestAnimationFrame(() => {
        look(left - 1)
      })
    }
    look(PATIENCE)
  })
}

/** Open, which is what a press on the line asks for. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => {
      expect(canvas.getByText(/\[11\] packages\/ui\/src\/session\/session\.tsx/)).toBeVisible()
    })
  },
}

/**
 * The press that closes a fold while it is still opening (issue #64).
 *
 * The room grows on a spring, and a spring turned round mid-flight carries the speed it had: the
 * fold went on growing for the frame the press landed on — 6.8 px in the light theme, 7.4 px in
 * the dark, measured on the twelve-line body below — before it came back down, which reads as a
 * fold that did not hear the hand. It leaves on the `fold` kind now, the same spring with no
 * speed to carry.
 *
 * What is asserted is what the eye sees: the body is still in the page when the line already says
 * the fold is closed, and the room is smaller on each of the three frames that follow.
 */
export const ClosedWhileOpening: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    const written = /\[11\] packages\/ui\/src\/session\/session\.tsx/

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    // Mid-opening, not at the end of it: the spring has made some of its room and is still
    // growing when the press lands.
    // Waited for by frames, never by the clock: a saturated machine may give the spring no frame
    // in any fixed time, and a press on a room still at 0 px would prove nothing.
    await expect(
      await withinFrames(() => {
        const opening = roomOf(canvasElement, row)
        return opening !== null && opening.getBoundingClientRect().height > MID_OPENING
      }, PATIENCE),
      'the fold never started to open',
    ).toBe(true)
    const room = roomOf(canvasElement, row)
    expect(room, 'the fold is open, so the body is in the page').not.toBeNull()

    const watched = foldOverFrames(row, room!)
    await userEvent.click(row)
    const seen = await watched
    const closedAt = seen.findIndex((frame) => frame.closed)
    expect(closedAt, 'the line never said the fold was closed').toBeGreaterThanOrEqual(0)

    if (movesLess()) {
      // Asked for less movement there is no journey to be caught in: the fold is its end state
      // with the press, and the body leaves within the few frames a press takes to land.
      await expect(await withinFrames(() => canvas.queryByText(written) === null, AT_ONCE)).toBe(
        true,
      )
      return
    }
    // Mid-exit: the line already says the fold is closed, and the body is still in the page,
    // folding away from where the opening had got to.
    await expect(canvas.getByText(written)).toBeInTheDocument()
    const heights = seen.slice(closedAt, closedAt + 4).map((frame) => frame.height)
    await expect(heights).toHaveLength(4)
    // The three frames of the closing, each against the one before it: no step of the way down
    // is upwards. A spring carrying the opening's speed grows on the first of them — 6.8 to 7.4 px
    // measured against dev — and this is what reads it.
    const steps = heights.slice(1).map((height, frame) => height - heights[frame]!)
    await expect(
      Math.max(...steps),
      `the fold grew on its way down: ${heights.join(' ')}`,
    ).toBeLessThan(0)
    await waitFor(() => {
      expect(canvas.queryByText(written)).toBeNull()
    })
  },
}
