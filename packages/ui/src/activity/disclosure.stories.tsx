import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AT_ONCE, movesLess, withinFrames } from '../../.storybook/reduced-motion.ts'
import { Button } from '../components/button/button.tsx'
import { Disclosure } from './disclosure.tsx'

/**
 * What folds: the line a block is read by, and what it holds once it is asked for (design
 * D17-05).
 *
 * Three stories, which are the three things a fold has to answer for: opened; closed while it is
 * still opening — the moment it used to grow for a frame after the press instead of turning round
 * (issue #64); and a body on its way out, which the keyboard can no longer reach (issue #69).
 */
const BODY = Array.from(
  { length: 12 },
  (_, index) => `[${index}] packages/ui/src/session/session.tsx:${index * 3} read`,
).join('\n')

const meta = {
  tags: ['autodocs', 'updated'],
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

/** The press the body holds, which is what the keyboard reaches while the fold is open. */
const INSIDE = 'Open the file the call read'

/** The body the room holds: what the fold takes out of the keyboard's reach as it closes. */
function bodyOf(room: HTMLElement): HTMLElement | null {
  const body = room.firstElementChild
  return body instanceof HTMLElement ? body : null
}

/**
 * A body on its way out is out of the reader's reach (issue #69).
 *
 * The fold is the opening played backwards, so the body stays in the page for the whole of the
 * exit while the line already says the fold is closed. Tab walked into it there: the reader
 * closes a block and the next Tab lands in what they have just closed, on a press that still
 * fires. From the press the body is `inert` — the keyboard does not walk into it and nothing it
 * holds is announced — while the row goes on naming it, because a reference that resolves to
 * nothing is a broken one and only the end of the exit says the body has left. A focus that was
 * inside it goes back to the row rather than being dropped on the document.
 *
 * What is asserted is what the keyboard does, mid-fold: the body is `inert` and the row names it,
 * the press it holds cannot take the focus back, and no Tab of a walk that keeps to the frames of
 * the fold lands in it. Then that the body has left and that the row stops naming it.
 */
export const NothingReachableWhileFolding: Story = {
  args: {
    children: (
      <div className="flex flex-col items-start gap-2">
        <div className="font-mono text-xs whitespace-pre text-muted-foreground">{BODY}</div>
        <Button size="sm">{INSIDE}</Button>
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = canvasElement.ownerDocument
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    const written = /\[11\] packages\/ui\/src\/session\/session\.tsx/

    // The reader is on the press the body holds when the row is pressed: it is the only thing
    // under the line that the keyboard can land on.
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const inside = await waitFor(() => canvas.getByRole('button', { name: INSIDE }))
    inside.focus()
    await expect(inside).toHaveFocus()

    // A press that does not move the focus: a pointer would put it on the row before the press
    // runs, and the hand-over below would then pass with nothing handed over.
    row.click()
    await expect(
      await withinFrames(() => row.getAttribute('aria-expanded') === 'false', AT_ONCE),
    ).toBe(true)

    if (movesLess()) {
      // Asked for less movement there is no journey to walk into: the body is gone with the few
      // frames a press takes to land, and what is left to answer for is that it left and that the
      // row stopped naming it.
      await expect(await withinFrames(() => roomOf(canvasElement, row) === null, AT_ONCE)).toBe(
        true,
      )
      // The focus that was inside it is on the row all the same: the hand-over is the press's, and
      // it does not depend on how long the fold takes.
      await expect(page.activeElement).toBe(row)
      await expect(row).not.toHaveAttribute('aria-controls')
      return
    }

    // Mid-exit: the line already says the fold is closed, the body is still in the page, and the
    // row still names it.
    const room = roomOf(canvasElement, row)
    expect(
      room,
      'the row named no body while the body folds, or one that is not in the page',
    ).not.toBeNull()
    // Out of the keyboard's reach from the press, rather than unlikely to be reached: the body is
    // `inert` while it is still in the page.
    const body = bodyOf(room!)
    expect(body, 'the room holds nothing to be inert').not.toBeNull()
    await expect(body!).toHaveAttribute('inert')
    // The press inside it cannot take the focus back, and the one it had is on the row.
    inside.focus()
    await expect(page.activeElement).toBe(row)

    // Tab while it folds, a frame at a time, and read where the keyboard landed on each: a walk
    // that keeps to the frames of the fold, so a landing is caught on the frame it happens.
    const landings: boolean[] = []
    while (roomOf(canvasElement, row) !== null && landings.length < PATIENCE) {
      // oxlint-disable-next-line no-await-in-loop -- one Tab, then a look, then the next: the order is the point
      await userEvent.tab()
      const folding = roomOf(canvasElement, row)
      landings.push(folding !== null && folding.contains(page.activeElement))
    }
    await expect(landings.length, 'the fold was over before a single Tab').toBeGreaterThan(0)
    await expect(landings.filter((landed) => landed)).toEqual([])

    // Gone, and the row names nothing: a reference that resolves to nothing is a broken one.
    await expect(await withinFrames(() => roomOf(canvasElement, row) === null, PATIENCE)).toBe(true)
    await expect(row).not.toHaveAttribute('aria-controls')
    await expect(canvas.queryByText(written)).toBeNull()
  },
}
