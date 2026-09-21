import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

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
  tags: ['autodocs', 'new'],
  title: 'Components/TerminalOutput',
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
    await expect(canvas.getByText(/\[39\] packages\/ui\/src\/session\/session\.tsx/)).toBeVisible()
  },
}
