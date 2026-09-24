import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AT_ONCE, movesLess, withinFrames } from '../../.storybook/reduced-motion.ts'
import { TerminalOutput } from './terminal-output.tsx'

/**
 * A console the agent is running, as it writes (design D17-06).
 *
 * The two stories are the two moments that matter: while the command runs — open, at its bottom,
 * following what arrives — and once it is over, when the block folds and its output stays in the
 * thread. The output is long on purpose: a console of four lines does not tell anybody whether
 * the box follows anything.
 */
const LINES = Array.from(
  { length: 40 },
  (_, index) => `[${index}] packages/ui/src/session/session.tsx:${index * 3} done`,
).join('\n')

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Activity/TerminalOutput',
  component: TerminalOutput,
  parameters: { layout: 'padded' },
  args: { terminalId: 'pnpm check', output: LINES, released: false },
  argTypes: {
    terminalId: { control: 'text', description: 'What the console is called: the agent’s id.' },
    output: { control: 'text', description: 'Everything it has written, as it arrived.' },
    released: {
      control: 'boolean',
      description: 'Whether the agent has let it go; a released console keeps its output.',
    },
  },
} satisfies Meta<typeof TerminalOutput>

export default meta

type Story = StoryObj<typeof meta>

/** A command that is still writing: open, and kept at its bottom. */
export const Live: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm check/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Running')).toBeVisible()
    const box = canvas.getByText(/\[39\] packages\/ui\/src\/session\/session\.tsx/)
    // The newest line is where the reader is looking: the box drives its own scroll, and it is
    // the only place in the application where what arrives moves the view.
    await waitFor(async () => {
      await expect(box.scrollTop).toBeGreaterThan(0)
    })
  },
}

/** A command that is over: folded, and its output is still there under a press. */
export const Released: Story = {
  args: { released: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm check/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByText('Released')).toBeVisible()
    await userEvent.click(row)
    // Waited out rather than read the frame the press landed: the body unfolds from no height
    // at all, and nothing of it is visible until the room under the row has been made.
    await waitFor(() => {
      expect(canvas.getByText(/\[39\] packages\/ui\/src\/session\/session\.tsx/)).toBeVisible()
    })
  },
}

/**
 * The fold closing, which is the fold opening played backwards (trial of 22 September 2026).
 *
 * The maintainer saw the output disappear the instant the row was pressed, while opening it
 * took its time. Two things did that: the body carried no `exit` at all, and Base UI's
 * `Collapsible` took it out of the page the frame the state changed, so there was nothing left
 * for an exit to play on. It is the `collapse` kind of the preset now, held in the page by
 * `AnimatePresence` for exactly as long as the fold lasts — so what is asserted is that the
 * output is still there mid-flight, and gone once the fold is over.
 */
export const AFoldClosing: Story = {
  args: { released: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm check/ })
    const written = /\[39\] packages\/ui\/src\/session\/session\.tsx/

    await userEvent.click(row)
    // Waited out until the fold has made its room, not until the output is "visible": the body
    // arrives at no height and faded by a filter, which `toBeVisible` reads as visible from the
    // first frame. Pressed again before the spring has played a frame, the fold would close from
    // no height to no height — nothing to play, so it is gone at once — and the check below
    // would be reading the press, not the fold.
    await waitFor(() => {
      const room = canvasElement.ownerDocument.getElementById(row.getAttribute('aria-controls')!)
      expect(room?.getBoundingClientRect().height).toBeGreaterThan(0)
    })

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    if (movesLess()) {
      // Asked for less movement, the fold is its end state with no journey to be caught in:
      // the output is gone with the press, within a few frames where the spring takes dozens.
      await expect(await withinFrames(() => canvas.queryByText(written) === null, AT_ONCE)).toBe(
        true,
      )
      return
    }
    // Mid-exit: the row already says it is closed, and the output is still in the page folding
    // away. A body that vanished under the press would fail here.
    await expect(canvas.getByText(written)).toBeInTheDocument()

    await waitFor(() => {
      expect(canvas.queryByText(written)).toBeNull()
    })
  },
}
