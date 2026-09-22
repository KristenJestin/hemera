import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { DiffBlock } from './diff-block.tsx'
import { ToolCallCard, type ToolCallCardProps } from './tool-call-card.tsx'

/**
 * One tool call of a turn (design D17-04).
 *
 * The states of the life of a call are the stories: a call in flight, one that is done and
 * folded, the same one opened onto what it sent and what came back, one that answered nothing,
 * one that failed, and one the reader stopped. What they are here to show is what the thread
 * does with each — the fold is a state of the card and not a corner of it, a failure is the one
 * state nobody is allowed to fold away, and a card with nothing behind it does not open at all.
 *
 * Where a call stands is a dot and no longer a word since the trial of 22 September 2026: `Done`
 * under `Done` under `Done` said nothing the reader did not already know and took the eye off
 * the one line that had gone wrong. The word is still there, for whatever reads the page.
 */
const OUTPUT = `export function SessionPage() {
  return <SessionThread />
}
`

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Activity/ToolCallCard',
  component: ToolCallCard,
  parameters: { layout: 'padded' },
  args: {
    title: 'Read src/session/session.tsx',
    kind: 'read',
    status: 'completed',
    locations: [{ path: 'packages/ui/src/session/session.tsx', line: 42 }],
    input: 'path: packages/ui/src/session/session.tsx\nlimit: 40',
    output: OUTPUT,
    onOpenLocation: fn(),
  },
  argTypes: {
    title: { control: 'text', description: 'What the call is called, as the agent wrote it.' },
    kind: {
      control: 'inline-radio',
      options: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'],
      description: 'The kind of the call, which decides the mark and nothing else.',
    },
    status: {
      control: 'inline-radio',
      options: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
      description: 'Where the call is in its life: running and failed are open, and stay open.',
    },
    locations: { control: false, description: 'The files the call touched, in the agent’s order.' },
    error: { control: 'text', description: 'What went wrong, when it did.' },
    input: { control: 'text', description: 'What the agent sent, in its own words.' },
    output: {
      control: 'text',
      description: 'What came back; the section says so when nothing did.',
    },
    onOpenLocation: { control: false, description: 'What a press on the file does.' },
    children: { control: false, description: 'What the call returned, handed over already drawn.' },
  },
} satisfies Meta<typeof ToolCallCard>

export default meta

type Story = StoryObj<typeof meta>

/** The state the other stories are read against: a call that is done, and folded. */
export const CompletedFolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    // A finished call says so on its line and keeps its body shut: the parameters of a read are
    // noise once the read worked.
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    // The word is announced and not drawn: the colour of the dot is what the eye reads.
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeInTheDocument()
    await expect(canvas.queryByText('Done')).toBeNull()
    // The title is a caption rather than a line of the thread: quieter than what the agent said.
    const title = canvas.getByText('Read src/session/session.tsx')
    await expect(getComputedStyle(title).color).not.toBe(getComputedStyle(canvasElement).color)
    await expect(canvas.getByText('packages/ui/src/session/session.tsx:42')).toBeVisible()
  },
}

/** Opened: what the agent sent and what came back, each under its own word. */
export const WithOutput: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Input')).toBeVisible()
    await expect(canvas.getByText('Output')).toBeVisible()
    await expect(canvas.getByText(/limit: 40/)).toBeVisible()
    const answer = canvas.getByText(/return <SessionThread \/>/)
    // Read the way it was written: the line breaks the agent put in are the line breaks shown.
    await expect(getComputedStyle(answer).whiteSpace).toBe('pre-wrap')
    await userEvent.click(row)
    await expect(row, 'a finished call does not fold when the reader asks it to').toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

/** A call that returned nothing: the section is drawn all the same, and says so. */
export const Empty: Story = {
  args: {
    title: 'Search for resumeSession',
    kind: 'search',
    output: undefined,
    locations: undefined,
    defaultOpen: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Both halves are drawn: a card showing an input and no output reads as a call still
    // running, and a finished call has to be able to say it answered nothing at all.
    await expect(canvas.getByText('Input')).toBeVisible()
    await expect(canvas.getByText('Output')).toBeVisible()
    await expect(canvas.getByText('Nothing was returned.')).toBeVisible()
  },
}

/** A call with nothing behind it at all: one line, and no way to open it. */
export const NothingToOpen: Story = {
  args: { input: undefined, output: undefined, locations: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // No chevron, no press: a control that opens onto nothing is a control that lied.
    await expect(canvas.queryByRole('button')).toBeNull()
    await expect(canvas.getByText('Read src/session/session.tsx')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeInTheDocument()
  },
}

/** A call in flight: it opens itself, because it is the one the reader is waiting on. */
export const Running: Story = {
  args: { status: 'in_progress', output: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    // The one dot of the five that moves, because it is the one the reader is waiting on.
    const dot = canvas.getByRole('img', { name: 'Running' })
    await expect(getComputedStyle(dot).animationName).toBe('breathe')
  },
}

/**
 * A card opened by default still closes (trial of 22 September 2026).
 *
 * The first call of a chat arrives in flight, opens itself, and used to be *held* open: the
 * card was controlled from its status, so the chevron did nothing for as long as the call ran —
 * minutes, for a build — and a failed call could never be folded away at all. Opening itself is
 * where the card starts; the press is the reader's from the first one, and their answer is
 * remembered against the status it was given at, so the entry being written again on every word
 * the agent adds does not undo it.
 */
export const OpenedByDefault: Story = {
  args: { status: 'in_progress', defaultOpen: true, output: undefined },
  render: (args) => <Rewritten {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(row)
    await expect(row, 'a card opened by default cannot be closed').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    // The entry is written again — the same call, with more of it — and the fold is where the
    // reader left it. That rewrite is what happens on every word of a running turn.
    await userEvent.click(canvas.getByRole('button', { name: 'Write more of it' }))
    await expect(row, 'a rewrite of the entry reopened the card').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await userEvent.click(row)
    await expect(row, 'and it cannot be opened again').toHaveAttribute('aria-expanded', 'true')
  },
}

/**
 * The same call, written again with more of it, which is what an entry of a running turn is.
 *
 * The engine does not append to a card: it writes the whole entry again on every update, and the
 * card is rendered from what it said this time. What the reader did to the fold has to live
 * through that, which is the whole of the defect the trial found.
 */
function Rewritten(args: ToolCallCardProps): ReactNode {
  const [written, setWritten] = useState(1)
  return (
    <div className="flex flex-col items-start gap-2">
      <ToolCallCard {...args} output={OUTPUT.repeat(written)} />
      <Button variant="secondary" size="sm" onClick={() => setWritten((was) => was + 1)}>
        Write more of it
      </Button>
    </div>
  )
}

/** What a shape of its own looks like inside the card: a diff, handed over already drawn. */
export const Expanded: Story = {
  args: { defaultOpen: true, input: undefined, output: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read src\/session\/session\.tsx/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/export function SessionPage/)).toBeVisible()
  },
  render: (args) => (
    <ToolCallCard {...args}>
      <DiffBlock
        defaultOpen
        path="packages/ui/src/session/session.tsx"
        oldText={'export function SessionPage() {\n  return null\n}\n'}
        newText={
          'export function SessionPage() {\n  return <SessionThread />\n}\n\nfunction SessionThread() {\n  return null\n}\n'
        }
      />
    </ToolCallCard>
  ),
}

/** A call that failed: it opens itself — an error behind a fold is an error nobody sees. */
export const Failed: Story = {
  args: {
    title: 'pnpm test --project=repository',
    kind: 'execute',
    status: 'failed',
    input: undefined,
    output: 'FAIL packages/ui/tests/stories.test.ts\n  3 tests failed',
    locations: undefined,
    error: 'exit 1 · 3 tests failed in packages/ui/tests/stories.test.ts',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm test --project=repository/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('img', { name: 'Failed' })).toBeInTheDocument()
    await expect(canvas.getByText(/3 tests failed in/)).toBeVisible()
    // Read, and then put away: a failure opens itself and is not a card the reader is locked
    // out of (trial of 22 September 2026).
    await userEvent.click(row)
    await expect(row, 'a failure cannot be folded away once read').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    // A command keeps the face it was written in: it is read character by character.
    await expect(
      getComputedStyle(canvas.getByText('pnpm test --project=repository')).fontFamily,
    ).toMatch(/mono|Fira/i)
  },
}

/** A call the reader stopped: nothing went wrong, and nothing finished either. */
export const Cancelled: Story = {
  args: {
    title: 'pnpm build',
    kind: 'execute',
    status: 'cancelled',
    input: 'cwd: .',
    output: undefined,
    locations: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm build/ })
    // Neither done nor failed: the quietest of the five, and folded like anything settled.
    await expect(canvas.getByRole('img', { name: 'Cancelled' })).toBeInTheDocument()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  },
}

/** The kinds, each on its own line: the mark is what tells a read from a command at a glance. */
export const EveryKind: Story = {
  args: { status: 'in_progress' },
  render: () => (
    <div className="flex flex-col gap-1">
      {(
        [
          ['read', 'Read AGENTS.md'],
          ['edit', 'Edit session.tsx'],
          ['delete', 'Delete draft.md'],
          ['move', 'Move notes.md'],
          ['search', 'Search for resumeSession'],
          ['execute', 'pnpm test'],
          ['think', 'Think about the migration'],
          ['fetch', 'Fetch the ACP schema'],
          ['other', 'Something else entirely'],
        ] as const
      ).map(([kind, title]) => (
        <ToolCallCard key={kind} kind={kind} title={title} status="in_progress" />
      ))}
    </div>
  ),
}
