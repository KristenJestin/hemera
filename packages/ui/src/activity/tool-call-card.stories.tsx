import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AT_ONCE, movesLess, withinFrames } from '../../.storybook/reduced-motion.ts'
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
 *
 * The line reads the way a Hemera call's does since recette 3 of 23 September 2026: the mark of
 * the kind, the label the kind is read by, and what the call is about — the file, the query, the
 * command — which is the press that goes to the file when it is one.
 */
const OUTPUT = `export function SessionPage() {
  return <SessionThread />
}
`

const meta = {
  tags: ['autodocs', 'updated'],
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
    title: {
      control: 'text',
      description:
        'What the call is called, as the agent wrote it: the label of a call of no kind.',
    },
    kind: {
      control: 'inline-radio',
      options: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'other'],
      description: 'The kind of the call, which decides the mark and the label.',
    },
    subject: {
      control: 'object',
      description: 'What the call is about; the first file it touched when left out.',
    },
    name: { control: 'text', description: 'The tool’s own name, when the adapter gives one.' },
    status: {
      control: 'inline-radio',
      options: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
      description: 'Where the call is in its life: the dot on the row, never the fold.',
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

/** How many frames a fold is watched for: the better part of the journey of the spring. */
const A_FOLD = 30

/**
 * The fold opening, with the file the call touched on its line (trial of 23 September 2026).
 *
 * The press on the file sat beside the whole fold and was centred on it, so it slid down the
 * card while the body opened under it. It is on the fold's own line now, the one line that never
 * moves, and pressing it goes to the file without opening the card.
 */
export const AFoldOpening: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
    const path = canvas.getByRole('button', { name: 'packages/ui/src/session/session.tsx:42' })
    // A press inside the fold's own button would be one the keyboard walks over.
    await expect(row.contains(path)).toBe(false)
    await userEvent.click(path)
    await expect(args.onOpenLocation).toHaveBeenCalledWith({
      path: 'packages/ui/src/session/session.tsx',
      line: 42,
    })
    await expect(row, 'a press on the file opened the card').toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const closed = path.getBoundingClientRect().top
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const moved = () => Math.abs(path.getBoundingClientRect().top - closed) > 0.5
    await expect(await withinFrames(moved, A_FOLD), 'the file slid while the card opened').toBe(
      false,
    )
    await expect(canvas.getByText('Input')).toBeVisible()
  },
}

/**
 * The fold closing, which is the fold opening played backwards (trial of 22 September 2026).
 *
 * The maintainer saw the body disappear the instant the row was pressed, while opening it took
 * its time. Two things did that: the body carried no `exit` at all, and Base UI's `Collapsible`
 * took it out of the page the frame the state changed, so there was nothing left for an exit to
 * play on. The body is the `collapse` kind of the preset now, held in the page by
 * `AnimatePresence` for exactly as long as the fold lasts.
 */
export const AFoldClosing: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
    const path = canvas.getByRole('button', { name: 'packages/ui/src/session/session.tsx:42' })
    await expect(canvas.getByText('Input')).toBeVisible()
    const open = path.getBoundingClientRect().top
    const moved = () => Math.abs(path.getBoundingClientRect().top - open) > 0.5

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    if (movesLess()) {
      // Asked for less movement, the fold is its end state with no journey to be caught in:
      // the body is gone with the press, within a few frames where the spring takes dozens.
      await expect(await withinFrames(() => canvas.queryByText('Input') === null, AT_ONCE)).toBe(
        true,
      )
      return
    }
    // Mid-exit: the row already says it is closed, and the body is still in the page folding
    // away. A body that vanished under the press would fail here.
    await expect(canvas.getByText('Input')).toBeInTheDocument()
    // The file stays on its line the whole way: it was centred on the card and slid with it.
    await expect(await withinFrames(moved, A_FOLD), 'the file slid while the card closed').toBe(
      false,
    )

    await waitFor(() => {
      expect(canvas.queryByText('Input')).toBeNull()
    })
    await expect(moved()).toBe(false)
  },
}

/** The state the other stories are read against: a call that is done, and folded. */
export const CompletedFolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
    // A finished call says so on its line and keeps its body shut: the parameters of a read are
    // noise once the read worked.
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    // The word is announced and not drawn: the colour of the dot is what the eye reads.
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeInTheDocument()
    await expect(canvas.queryByText('Done')).toBeNull()
    // The line is read by the label of its kind, and what it is about is the file, in mono.
    await expect(canvas.getByText('Read file')).toBeVisible()
    await expect(canvas.queryByText('Read src/session/session.tsx')).toBeNull()
    const subject = canvas.getByText('packages/ui/src/session/session.tsx:42')
    await expect(subject).toBeVisible()
    await expect(getComputedStyle(subject).fontFamily).toMatch(/mono|Fira/i)
    await expect(canvasElement.querySelector('[data-mark]')).toHaveAttribute('data-mark', 'read')
  },
}

/** Opened: what the agent sent and what came back, each under its own word. */
export const WithOutput: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
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
    await expect(canvas.getByText('Read file')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeInTheDocument()
  },
}

/**
 * A call in flight: folded like every other card (trial of 22 September 2026, evening). The dot
 * says it is running; what it is doing is the reader's to open, and stays open once they did,
 * however many times the entry is written again and when the call is done.
 */
export const Running: Story = {
  args: { status: 'in_progress', output: undefined },
  render: (args) => <Rewritten {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
    await expect(row, 'a running call opened itself').toHaveAttribute('aria-expanded', 'false')
    // The one dot of the five that moves, because it is the one the reader is waiting on.
    const dot = canvas.getByRole('img', { name: 'Running' })
    await expect(getComputedStyle(dot).animationName).toBe('breathe')
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Write more of it' }))
    await expect(row, 'a rewrite of the entry closed the card').toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Finish it' }))
    await expect(row, 'the call ending closed the card').toHaveAttribute('aria-expanded', 'true')
  },
}

/**
 * A card a caller explicitly asked to start open, which nothing in the application does: every
 * card starts folded, whatever its state (trial of 22 September 2026, evening). `defaultOpen` is
 * where the card starts and nothing more — it still closes on the first press, and the reader's
 * answer lives through the entry being written again on every word the agent adds.
 */
export const OpenedByDefault: Story = {
  args: { status: 'completed', defaultOpen: true, output: undefined },
  render: (args) => <Rewritten {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
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
  const [status, setStatus] = useState(args.status)
  return (
    <div className="flex flex-col items-start gap-2">
      <ToolCallCard {...args} status={status} output={OUTPUT.repeat(written)} />
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setWritten((was) => was + 1)}>
          Write more of it
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setStatus('completed')}>
          Finish it
        </Button>
      </div>
    </div>
  )
}

/** What a shape of its own looks like inside the card: a diff, handed over already drawn. */
export const Expanded: Story = {
  args: { defaultOpen: true, input: undefined, output: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^Read file/ })
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

/**
 * A call that failed: folded like every other card, and a Session reopened on it is not reopened
 * on its error (trial of 22 September 2026, evening). The red dot says it failed; the reason is
 * the first thing the body says once the reader opens it.
 */
export const Failed: Story = {
  args: {
    title: 'pnpm test --project=repository',
    kind: 'execute',
    subject: { text: 'pnpm test --project=repository' },
    status: 'failed',
    input: undefined,
    output: 'FAIL packages/ui/tests/stories.test.ts\n  3 tests failed',
    locations: undefined,
    error: 'exit 1 · 3 tests failed in packages/ui/tests/stories.test.ts',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /pnpm test --project=repository/ })
    await expect(row, 'a failed call opened itself').toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByRole('img', { name: 'Failed' })).toBeInTheDocument()
    await expect(canvas.queryByText(/3 tests failed in/)).toBeNull()
    // Opened by the reader, the error is the first thing read; and put away again.
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/3 tests failed in/)).toBeVisible()
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
    subject: { text: 'pnpm build' },
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

/** The kinds, each with its subject, as the thread reads them in a Session. */
const KINDS = [
  ['read', 'Read AGENTS.md', 'Read file', 'AGENTS.md'],
  ['edit', 'Edit session.tsx', 'Edit file', 'src/session/session.tsx'],
  ['delete', 'Delete draft.md', 'Delete file', 'notes/draft.md'],
  ['move', 'Move notes.md', 'Move file', 'notes.md'],
  ['search', 'Search for resumeSession', 'Search', '"resumeSession"'],
  ['execute', 'pnpm test', 'Run command', 'pnpm test --project=repository'],
  ['think', 'Think about the migration', 'Thinking', null],
  ['fetch', 'Fetch the ACP schema', 'Fetch', 'https://agentclientprotocol.com/schema'],
  ['other', 'Something else entirely', 'Something else entirely', null],
] as const

/**
 * The kinds, each on its own line (recette 3 of 23 September 2026): the mark and the label say
 * what the call is, the subject what it is about, and a call of no kind is read by its title.
 */
export const EveryKind: Story = {
  args: { status: 'in_progress' },
  render: () => (
    <div className="flex flex-col gap-1">
      {KINDS.map(([kind, title, , subject]) => (
        <ToolCallCard
          key={kind}
          kind={kind}
          title={title}
          subject={subject === null ? undefined : { text: subject }}
          name={kind === 'read' ? 'Read' : undefined}
          status="in_progress"
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const marks = [...canvasElement.querySelectorAll('[data-mark]')].map((mark) =>
      mark.getAttribute('data-mark'),
    )
    await expect(marks).toEqual(KINDS.map(([kind]) => kind))
    for (const [, , label, subject] of KINDS) {
      expect(canvas.getByText(label)).toBeVisible()
      if (subject !== null) expect(canvas.getByText(subject)).toBeVisible()
    }
    // The whole line is a caption (recette 5 of 24 September 2026): the label and the subject in
    // the tone of the mark.
    const quiet = getComputedStyle(canvasElement.querySelector('[data-mark]')!).color
    await expect(getComputedStyle(canvas.getByText('Read file')).color).toBe(quiet)
    await expect(getComputedStyle(canvas.getByText('AGENTS.md')).color).toBe(quiet)
    // The agent's own name for the tool is not on the line: it heads the body once it is opened.
    await expect(canvas.queryByText('Read')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^Read file/ }))
    await expect(canvas.getByText('Read')).toBeVisible()
    await expect(canvas.getByText('Read').previousElementSibling).toHaveTextContent('tool')
  },
}
