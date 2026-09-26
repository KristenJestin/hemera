import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { emulateReducedMotion } from '../../.storybook/reduced-motion.ts'
import { ActivityRow } from './activity-row.tsx'

/**
 * What the turn is doing right now, at the end of the thread (design D17-04, D17-13).
 *
 * Four states, one row. A turn writes nothing for minutes at a time, and a thread that said
 * nothing while it ran was a thread the reader could not tell from a dead one. Each state is a
 * story, because each of them is a different promise: thinking and writing are work in flight,
 * running names the command it is on, and waiting is the turn stopped and asking. Three more
 * say how the turn ended, and stay until the next message: done, stopped, failed.
 */
const THOUGHT = `The join on invoice_lines is the cost, not the formatting. Streaming will not fix
it on its own, so the query goes first and the loop after.`

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Session/ActivityRow',
  component: ActivityRow,
  parameters: { layout: 'padded' },
  args: { state: 'thinking' },
  argTypes: {
    state: {
      control: 'inline-radio',
      options: ['thinking', 'running', 'waiting', 'streaming', 'done', 'stopped', 'failed'],
      description: 'What the turn is doing, as the engine reports it.',
    },
    detail: {
      control: 'text',
      description: 'What it is doing it to: the title of the tool call. Only `running` has one.',
    },
    thought: { control: 'text', description: 'The thought arriving now, which the chevron opens.' },
    elapsedMs: {
      control: 'number',
      description: 'How long the turn took, in milliseconds. Only `done` says it.',
    },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof ActivityRow>

export default meta
type Story = StoryObj<typeof meta>

/** The row on its own, in whichever state and with whatever it is carrying. */
export const Playground: Story = {}

/** Thinking: the turn is between two blocks, and the row is what says so. */
export const Thinking: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thinking…')).toBeVisible()
    // Nothing to open: the thought is not arriving yet, and a chevron over an empty body lies.
    await expect(canvas.queryByRole('button')).toBeNull()
    // The indicator is the design system's own, and it is what says the turn is alive.
    await expect(canvas.getByRole('status', { name: 'Thinking…' })).toBeInTheDocument()
  },
}

/** Running: the row names the command, because that is what the reader is watching for. */
export const Running: Story = {
  args: { state: 'running', detail: 'cat recap.md' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Running cat recap.md')).toBeVisible()
  },
}

/** Waiting: the turn has stopped and is asking. Nothing here is moving, and the dot says so. */
export const Waiting: Story = {
  args: { state: 'waiting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting for your permission')).toBeVisible()
    await expect(
      canvas.getByRole('status', { name: 'Waiting for your permission' }),
    ).toBeInTheDocument()
  },
}

/** Writing: an answer is arriving into the thread above, and the row is the edge of it. */
export const Streaming: Story = {
  args: { state: 'streaming' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Writing…')).toBeVisible()
  },
}

/**
 * Done: the turn is over, and the row says so quietly, with how long it took. No indicator —
 * nothing is in flight — and the success dot in its place.
 */
export const Done: Story = {
  args: { state: 'done', elapsedMs: 12_400 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Done in 12 s')).toBeVisible()
    // Nothing is working any more, so nothing says it is.
    await expect(canvas.queryByRole('status')).toBeNull()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Stopped: the reader stopped the turn, and the row says so without a figure. */
export const Stopped: Story = {
  args: { state: 'stopped', elapsedMs: 40_000 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped')).toBeVisible()
    await expect(canvas.queryByRole('status')).toBeNull()
  },
}

/** Failed: the agent went away under the turn. */
export const Failed: Story = {
  args: { state: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Failed')).toBeVisible()
    await expect(canvas.queryByRole('status')).toBeNull()
  },
}

/**
 * The thought arriving now, one press away.
 *
 * Only the thought that is arriving: the thoughts already in the thread are blocks of their own
 * and stay exactly where they are, because a row that swallowed them would be a second copy of
 * the turn drawn at the bottom of it.
 */
export const WithAThought: Story = {
  args: { state: 'thinking', thought: THOUGHT },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Thinking…/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/The join on invoice_lines is the cost/)).toBeVisible()
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  },
}

/**
 * Quiet: the turn has heard nothing from its agent for half a minute, and the line says for how
 * long (issue #131). Nothing is offered yet: an agent thinking hard is quiet for that long too.
 */
export const Quiet: Story = {
  args: { state: 'thinking', quietMs: 47_000, onStop: fn(), onOpenTrace: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thinking… · 45 s, no answer yet')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
  },
}

/**
 * Stuck: two minutes of nothing, and the line offers what can be done about it — stop the turn,
 * or open the trace of what the agent and Hemera said to find out why nothing comes.
 */
export const Stuck: Story = {
  args: {
    state: 'running',
    detail: 'fs_read src/app.ts',
    quietMs: 150_000,
    onStop: fn(),
    onOpenTrace: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Running fs_read src/app.ts · 2 min, no answer yet'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
    await userEvent.click(canvas.getByRole('button', { name: 'Open the trace' }))
    await expect(args.onOpenTrace).toHaveBeenCalledOnce()
  },
}

/** A Session with no trace offers Stop alone: there is nothing to open. */
export const StuckWithoutATrace: Story = {
  args: { state: 'thinking', quietMs: 600_000, onStop: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Thinking… · 10 min, no answer yet')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Open the trace' })).toBeNull()
  },
}

/** Waiting on the reader is not the agent being silent, however long it lasts. */
export const WaitingIsNotQuiet: Story = {
  args: { state: 'waiting', quietMs: 600_000, onStop: fn(), onOpenTrace: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Waiting for your permission')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
  },
}

/** The seven states in one column, which is the only way to check that seven read as seven. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-3">
      <ActivityRow state="thinking" />
      <ActivityRow state="running" detail="cat recap.md" />
      <ActivityRow state="waiting" />
      <ActivityRow state="streaming" />
      <ActivityRow state="done" elapsedMs={72_000} />
      <ActivityRow state="stopped" />
      <ActivityRow state="failed" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const said = [
      'Thinking…',
      'Running cat recap.md',
      'Waiting for your permission',
      'Writing…',
      'Done in 1 min 12 s',
      'Stopped',
      'Failed',
    ]
    await Promise.all(said.map(async (one) => expect(canvas.getByText(one)).toBeVisible()))
  },
}

/**
 * The same row under a system that asked for less movement: the words, standing still.
 *
 * The preference is emulated in the browser, because that is where the media query is answered.
 * Opened in the catalogue by hand there is nothing to emulate with, and the reader sees what
 * their own system asked for.
 */
export const ReducedMotion: Story = {
  parameters: { controls: { disable: true } },
  args: { state: 'running', detail: 'cat recap.md' },
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const canvas = within(canvasElement)
      const ring = canvas.getByRole('status').children[0]!
      await expect(getComputedStyle(ring).animationName).toBe('none')
    } finally {
      await restore()
    }
  },
}
