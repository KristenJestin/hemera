import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { AgentText } from './agent-text.tsx'
import { MessageBubble } from './message.tsx'

/**
 * What an agent says, drawn from the text that is still arriving (design D5-14).
 *
 * The catalogue of this file is about the two halves of one decision: what an answer is made of
 * once it has arrived, and what it is made of while it is still being written. The second half is
 * the one worth a catalogue of its own — a text on its way is a fence that has been opened and
 * not closed, a list whose last item is a marker and nothing after it, an emphasis with one of
 * its two stars — and every one of those has to be drawn as the text so far rather than as an
 * error, a blank line, or a row of punctuation the reader was never meant to see.
 *
 * The answers are read in a bubble, because that is where they are read: the thread gives a
 * message its surface, and an answer inherits the line breaks of that surface unless it says
 * otherwise. `TruncatedFence` is the story this file exists for.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Message/AgentText',
  component: AgentText,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-full max-w-3xl">
        <MessageBubble tone="soft">
          <Story />
        </MessageBubble>
      </div>
    ),
  ],
  argTypes: {
    text: {
      control: 'text',
      description: 'The answer as it stands, which may stop in the middle of a fence or a list.',
    },
  },
  args: {
    text: 'The export reads the month from the query, so a run in January exports December.',
  },
} satisfies Meta<typeof AgentText>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Whether something above this element hands down a `white-space` that keeps the source's breaks.
 *
 * The bubble a message is read in says `pre-wrap`, and it is right to: a message keeps the line
 * breaks its author put there with Shift+Enter. An answer is the one thing that may not inherit
 * them, so what its own wrapper says is only worth measuring against what is above it.
 */
function inheritsABreakKeepingWhiteSpace(node: Element): boolean {
  for (let up = node.parentElement; up !== null; up = up.parentElement) {
    if (getComputedStyle(up).whiteSpace === 'pre-wrap') return true
  }
  return false
}

/** An answer that has arrived: a heading, a sentence with code in it, and a list. */
export const Playground: Story = {
  args: {
    text: `## What I found

The export runs from \`billing/export.ts\`, and two things follow from that:

- The month is read from the query, so a run in January exports December.
- The file is written before the totals are
  checked, which is why an empty sheet is possible.`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The heading of a reply is a heading, one step below a page's own rather than a page's.
    const heading = canvas.getByRole('heading', { level: 2, name: 'What I found' })
    expect(heading).toBeInTheDocument()

    // Code in a sentence is code: the theme's mono face, and not a fence.
    const code = canvas.getByText('billing/export.ts')
    expect(code.tagName).toBe('CODE')
    expect(getComputedStyle(code).fontFamily).toContain('Fira Code')
    expect(canvasElement.querySelector('pre')).toBeNull()

    // The two items are two items, drawn with the markers the reset takes away.
    expect(canvas.getAllByRole('listitem')).toHaveLength(2)

    // And the line break inside the second item is a space, not a break: in Markdown a single
    // newline is a space, and the parser has already decided where the blocks are. The bubble
    // above says `pre-wrap` — which is what the thread wants for what a user wrote — so the
    // answer is the one thing that has to give it up, and this is the whole of that decision.
    const item = canvas.getByText(/which is why an empty sheet is possible/)
    const answer = item.closest('p, li')!.parentElement!
    expect(getComputedStyle(answer).whiteSpace).toBe('normal')
    expect(inheritsABreakKeepingWhiteSpace(answer)).toBe(true)
  },
}

/**
 * An answer the agent has not finished writing, with a fence open across it.
 *
 * The whole of what has arrived is reparsed on every render, so the text on screen halfway
 * through is a shorter text and not a broken one: the fence has no closing row yet, and what it
 * holds is drawn as the code it is rather than as three backticks and a line of characters. This
 * is the state an agent's answer spends most of its life in, and the one a parser chosen for its
 * handling of complete documents gets wrong.
 */
export const TruncatedFence: Story = {
  args: { text: '' },
  render: () => <Arriving source={REPORT} upTo={CLOSING} step={8} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // The last line of code to have arrived is drawn, and it is drawn inside a fence. Waited
    // for and not read at once: the text of this story is arriving while the story is played,
    // which is the whole of what it is here to show.
    await waitFor(() =>
      expect(canvasElement.querySelector('pre')?.textContent).toContain(
        'const rows = await invoiceRows(month)',
      ),
    )
    expect(canvas.getByText(/Here is what the export does/)).toBeInTheDocument()

    // Nothing of the syntax is on screen: no closing row, and no backtick anywhere.
    expect(canvasElement.textContent).not.toContain('`')

    // And the sentence after the fence is not there yet, because it has not been written yet.
    expect(canvas.queryByText(/in one pass/)).toBeNull()
  },
}

/** The same answer, once the agent has stopped writing: the fence is closed by its own row. */
export const ClosedFence: Story = {
  args: { text: '' },
  render: () => <Arriving source={REPORT} upTo={REPORT.length} step={8} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await waitFor(() => expect(canvas.getByText(/in one pass/)).toBeInTheDocument())
    // One fence, holding the whole of the code, and the sentence that follows it outside.
    expect(canvasElement.querySelectorAll('pre')).toHaveLength(1)
    expect(canvasElement.querySelector('pre')?.textContent).toContain('const month = query.get')
    expect(canvasElement.textContent).not.toContain('`')
    expect(canvas.getByText(/Here is what the export does/)).toBeInTheDocument()
  },
}

/**
 * An emphasis whose closing star has not arrived.
 *
 * Half of a pair of stars is not an emphasis, and guessing that it is would bolden a word and
 * unbolden it a keystroke later — a flicker in the middle of a sentence, in exchange for nothing.
 * The characters are drawn as they are until the star that closes them arrives, which is the
 * whole of what this story is here to hold.
 */
export const UnclosedEmphasis: Story = {
  args: { text: 'The totals are **read from the query and never from the sheet.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.querySelector('strong')).toBeNull()
    expect(canvas.getByText(/\*\*read from the query/)).toBeInTheDocument()
  },
}

/**
 * A list whose last item is a marker and nothing after it.
 *
 * An agent that has typed `- ` and not yet the first word of the item has written a list of two
 * items and an empty one, and an empty item is a bullet with nothing beside it — a blank line
 * with a dot on it, in the middle of an answer that is otherwise being read. The parser of a
 * complete document keeps that item, and the streaming profile is what drops it: without it this
 * text parses to two items, one of them empty, which is what this story holds.
 */
export const EmptyMarker: Story = {
  args: { text: 'Two things follow from that:\n\n- The month comes from the query.\n- ' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('listitem')).toHaveLength(1)
  },
}

/**
 * A heading whose own text has not been typed yet.
 *
 * The same state as the list above, one marker up: `## ` on its own is a heading with nothing in
 * it, and an answer is not improved by a row of empty space where a title is about to be. The
 * profile drops the block rather than the reader waiting for it.
 */
export const EmptyHeading: Story = {
  args: { text: '## What I found\n\nThe month comes from the query, and then\n\n## ' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('heading')).toHaveLength(1)
    expect(canvas.getByRole('heading', { level: 2, name: 'What I found' })).toBeInTheDocument()
  },
}

/**
 * An answer, cut off inside its own fence.
 *
 * Written as one text with a cut in it rather than as two texts, because that is what an agent
 * sends: the same string, longer. `CLOSING` is where the row that closes the fence begins, which
 * is the last character a text in flight has not been given yet.
 */
const REPORT = `Here is what the export does.

\`\`\`ts
const month = query.get('month')
const rows = await invoiceRows(month)
\`\`\`

It reads the month from the query and writes the file in one pass.`

/** Where the fence is closed, which is where a text in flight stops. */
const CLOSING = REPORT.indexOf('```', REPORT.indexOf('```') + 3)

/**
 * A text that arrives the way an agent's does, and stops where the story tells it to.
 *
 * A real timer and not a fixed pair of frames: what is being drawn is a text that grows, and the
 * story is the only place where the growing is the subject. It stops rather than looping, so that
 * what the play function measures is a state the reader can be left in.
 */
function Arriving({
  source,
  upTo,
  step,
}: {
  source: string
  upTo: number
  step: number
}): ReactNode {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (shown >= upTo) return
    const timer = setTimeout(() => setShown(Math.min(upTo, shown + step)), 16)
    return () => clearTimeout(timer)
  }, [shown, upTo, step])
  return <AgentText text={source.slice(0, shown)} />
}
