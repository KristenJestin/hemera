import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { MotionConfig } from 'motion/react'

import { ToolCallCard } from '../../activity/tool-call-card.tsx'
import { TooltipProvider } from '../../components/tooltip/tooltip.tsx'
import { IconSparkles } from '../../icons.ts'
import { MessageDaySeparator, MessageGroup } from '../message.tsx'
import type { MessageLine } from '../model.ts'
import {
  LatestPill,
  MessageScroller,
  NavigationRail,
  type NavigationMark,
  type ScrollerEntry,
} from './scroller.tsx'

/**
 * The scroller of a Session (design D4b-09).
 *
 * The thread is the one thing in the page that scrolls, the rail says where in it the reader is
 * and is drawn only when it does not fit, and the pill appears the moment the reader leaves the
 * live edge. A Session opens on what was written last, which is what the live edge is.
 */
const withTooltips: Decorator = (Story) => (
  <TooltipProvider>
    <Story />
  </TooltipProvider>
)

/** What a press on a mark reports back, shared by the two stories that draw a rail. */
const selectMark = fn()

/** What the pill reports back, in the story that draws it alone. */
const goToLatest = fn()

/** Five marks, so that a resting one, its two neighbours and the one being read are all there. */
const MARKS: NavigationMark[] = [
  { id: 'created', label: 'Session created in Atlas' },
  { id: 'ask', label: 'Invoices should export with HT and TTC amounts per line.' },
  { id: 'answer', label: 'Answer from Marie: every line. She wants to filter in Excel.' },
  { id: 'page', label: 'Also: the export runs from the billing page, not from a command.' },
  { id: 'spec', label: 'Ask Marie before turning this into a Spec.' },
]

const CONSTRAINTS: MessageLine[] = [
  {
    id: 'a1',
    body: 'Invoices should export with HT and TTC amounts per line. Today the CSV only has totals, and accounting re-keys everything by hand.',
  },
  {
    id: 'a2',
    body: 'Constraints: one file per month, semicolon separator, UTF-8 with BOM for Excel. The vat_rate column exists on the line model already.',
  },
]

/** A Session nobody has written much in: what the rail is not drawn over. */
const FITS: ScrollerEntry[] = [
  { id: 'day-1', day: true, content: <MessageDaySeparator day="3 days ago" /> },
  {
    id: 'created',
    mark: 'Session created in Atlas',
    content: (
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'created', body: <Note text="Session created in Atlas" /> }]}
      />
    ),
  },
  {
    id: 'ask',
    mark: 'Invoices should export with HT and TTC amounts per line.',
    content: <MessageGroup author="user" name="You" at="14:02" state="saved" lines={CONSTRAINTS} />,
  },
]

/**
 * Three days of one Session, in the order it was written.
 *
 * A thread this long is the only thing a rail can honestly be judged on: days that break it, a
 * group of three lines beside a group of one, and the three states of what the Profile did with
 * what was written — kept, on its way, and refused.
 */
const THREAD: ScrollerEntry[] = [
  { id: 'day-1', day: true, content: <MessageDaySeparator day="3 days ago" /> },
  {
    id: 'created',
    mark: 'Session created in Atlas',
    content: (
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'created', body: <Note text="Session created in Atlas" /> }]}
      />
    ),
  },
  {
    id: 'ask',
    mark: 'Invoices should export with HT and TTC amounts per line.',
    content: <MessageGroup author="user" name="You" at="14:02" state="saved" lines={CONSTRAINTS} />,
  },
  {
    id: 'renamed',
    mark: 'Renamed “Untitled” → “CSV invoice export”',
    content: (
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'renamed', body: <Note text="Renamed “Untitled” → “CSV invoice export”" /> }]}
      />
    ),
  },
  {
    id: 'client',
    mark: 'Does the client number go on every line, or once in a header block?',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="14:20"
        state="saved"
        lines={[
          {
            id: 'b1',
            body: 'Does the client number go on every line, or once in a header block? The accounting export has it once, and Marie re-keys it into the rows.',
          },
        ]}
      />
    ),
  },
  {
    id: 'marie',
    mark: 'Ask Marie before turning this into a Spec.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="14:21"
        state="saved"
        lines={[{ id: 'b2', body: 'Ask Marie before turning this into a Spec.' }]}
      />
    ),
  },
  { id: 'day-2', day: true, content: <MessageDaySeparator day="today" /> },
  {
    id: 'question',
    mark: 'Open question: does the client number go on every line?',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="10:41"
        state="saved"
        lines={[
          {
            id: 'c1',
            body: 'Open question: does the client number go on every line, or once in a header block? Marie answers today.',
          },
        ]}
      />
    ),
  },
  {
    id: 'answer',
    mark: 'Answer from Marie: every line. She wants to filter in Excel.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="10:58"
        state="saving"
        lines={[{ id: 'c2', body: 'Answer from Marie: every line. She wants to filter in Excel.' }]}
      />
    ),
  },
  {
    id: 'page',
    mark: 'Also: the export runs from the billing page, not from a command.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="10:59"
        state="failed"
        error="the profile is read-only"
        onRetry={fn()}
        lines={[
          { id: 'c3', body: 'Also: the export runs from the billing page, not from a command.' },
        ]}
      />
    ),
  },
  {
    id: 'agent',
    mark: 'The billing page is the entry point, then: one file per month.',
    content: (
      <MessageGroup
        author="agent"
        name="Agent"
        at="11:01"
        state="saved"
        lines={[
          {
            id: 'c4',
            body: 'The billing page is the entry point, then, and one file per month is enough.',
          },
        ]}
      />
    ),
  },
  {
    id: 'separator',
    mark: 'The separator is a semicolon, and Excel is told so by the BOM.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="11:04"
        state="saved"
        lines={[
          {
            id: 'd1',
            body: 'The separator is a semicolon, and Excel is told so by the BOM — the same file opens correctly in Numbers and in LibreOffice.',
          },
        ]}
      />
    ),
  },
  {
    id: 'month',
    mark: 'One file per month, named after the month it covers.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="11:07"
        state="saved"
        lines={[
          {
            id: 'e1',
            body: 'One file per month, named after the month it covers: invoices-2026-09.csv, and the export refuses a month it has no lines for.',
          },
        ]}
      />
    ),
  },
  {
    id: 'vat',
    mark: 'The vat_rate column already exists on the line model.',
    content: (
      <MessageGroup
        author="user"
        name="You"
        at="11:12"
        state="saved"
        lines={[
          {
            id: 'f1',
            body: 'The vat_rate column already exists on the line model, so nothing has to be added to the schema for this.',
          },
        ]}
      />
    ),
  },
]

/**
 * The entries of that same thread that asked for a mark: the reader's own questions.
 *
 * A Session with an agent is mostly the agent's: its answers, its thoughts, its tool calls, its
 * consoles. The rail is how a reader gets back to something *they* asked, so an entry names a
 * mark or it draws none — and everything else is read by scrolling, which is how it arrived.
 */
const ASKED_FOR = ['ask', 'client', 'question', 'page']

const ASKED: ScrollerEntry[] = THREAD.map((entry) =>
  entry.day === true || ASKED_FOR.includes(entry.id) ? entry : { ...entry, mark: undefined },
)

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Message/Scroller',
  component: MessageScroller,
  decorators: [withTooltips],
  parameters: { layout: 'fullscreen' },
  args: { label: 'the thread of CSV invoice export', entries: FITS },
  argTypes: {
    label: {
      control: 'text',
      description: 'What the thread is called, said by the thread and by its rail.',
    },
    entries: { control: false, description: 'The thread, in the order it was written.' },
  },
  render: (args) => (
    <div className="h-screen p-6">
      <MessageScroller {...args} />
    </div>
  ),
} satisfies Meta<typeof MessageScroller>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A Session nobody has written much in: two messages, one day, and nothing out of sight.
 *
 * The rail is not drawn at all. A rail over a thread that is entirely on screen is a map of
 * nowhere, and the pill is not offered either — the live edge is the page the reader is on.
 */
export const Playground: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('log', { name: /CSV invoice export/ })).toBeInTheDocument()
    expect(canvas.queryByRole('navigation')).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Latest' })).toBeNull()
  },
}

/**
 * The two shapes of the scroller side by side: a thread that fits, and one that does not.
 *
 * The rail is not a decoration, so it is not drawn on a short thread — a map of a page that is
 * entirely on screen is a map of nowhere — and the long one is what it exists for. Both are
 * read from the bottom, which is what a Session opens on.
 */
export const Variants: Story = {
  render: () => (
    <div className="grid h-screen grid-cols-2 gap-6 p-6">
      <MessageScroller
        className="min-w-0"
        label="a Session nobody has written much in"
        entries={FITS}
      />
      <MessageScroller
        className="min-w-0"
        label="the thread of CSV invoice export"
        entries={THREAD}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const short = canvas.getByRole('log', { name: 'a Session nobody has written much in' })
    const long = canvas.getByRole('log', { name: 'the thread of CSV invoice export' })

    // One mark per message and none for the days: a day is a heading over what follows it, and
    // a heading is not somewhere the reader can be taken.
    expect(canvas.getAllByRole('navigation')).toHaveLength(1)
    const rail = canvas.getByRole('navigation', {
      name: 'Marks of the thread of CSV invoice export',
    })
    expect(within(rail).getAllByRole('button')).toHaveLength(12)
    // The short thread has no rail at all, and neither of them offers a way back yet: both open
    // on the last thing written.
    expect(canvas.queryByRole('navigation', { name: /nobody has written much/ })).toBeNull()
    expect(canvas.queryAllByRole('button', { name: 'Latest' })).toHaveLength(0)
    expect(short.scrollTop).toBe(0)
    expect(long.scrollTop).toBeGreaterThan(0)
  },
}

/**
 * Where the reader is, side by side: at the live edge, and having left it.
 *
 * A thread read from the bottom knows one position for certain — the end — and everything else
 * is a guess read off the middle of the screen. The pill is drawn by the thread the reader left
 * and by that one only, so it is never a control that does nothing.
 */
export const States: Story = {
  render: () => (
    <div className="grid h-screen grid-cols-2 gap-6 p-6">
      <MessageScroller className="min-w-0" label="the thread, at the live edge" entries={THREAD} />
      <MessageScroller
        className="min-w-0"
        label="the thread, away from the edge"
        entries={THREAD}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [atEdge, away] = canvas.getAllByRole('log')
    const marksOf = (name: string): HTMLElement[] =>
      within(canvas.getByRole('navigation', { name })).getAllByRole('button')

    const EDGE = 'Marks of the thread, at the live edge'
    const AWAY = 'Marks of the thread, away from the edge'

    // A Session opens on what was written last: both rails are on their last mark, and neither
    // thread offers a way back to an edge the reader has not left.
    expect(marksOf(EDGE).at(-1)).toHaveAttribute('aria-current', 'true')
    expect(marksOf(AWAY).at(-1)).toHaveAttribute('aria-current', 'true')
    expect(canvas.queryAllByRole('button', { name: 'Latest' })).toHaveLength(0)

    // The middle of the scrollable range: as far from the live edge as this thread allows.
    away!.scrollTop = (away!.scrollHeight - away!.clientHeight) / 2

    // The pill is the one thing that says how to get back, and the rail that moved with the
    // reader says they are no longer at the end.
    const pill = await waitFor(() =>
      within(away!.parentElement!).getByRole('button', { name: 'Latest' }),
    )
    expect(pill).toBeInTheDocument()
    expect(within(atEdge!.parentElement!).queryByRole('button', { name: 'Latest' })).toBeNull()
    expect(marksOf(AWAY).at(-1)).not.toHaveAttribute('aria-current')
    expect(marksOf(EDGE).at(-1)).toHaveAttribute('aria-current', 'true')
  },
}

/**
 * A thread three days long, and the shape the rail exists for.
 *
 * The Session opens on what was written last, so the rail opens on its last mark: nothing is
 * offered that would take the reader where they already are.
 */
export const ARealThread: Story = {
  args: { entries: THREAD },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: /^Marks of/ })
    const marks = within(rail).getAllByRole('button')

    // Twelve messages and two days: one mark per message, and none for the days — a day is a
    // heading over what follows it, and a heading is not somewhere to go.
    expect(marks).toHaveLength(12)
    expect(canvas.getByRole('log').scrollTop).toBeGreaterThan(0)
    expect(marks.at(-1)).toHaveAttribute('aria-current', 'true')
    expect(canvas.queryByRole('button', { name: 'Latest' })).toBeNull()
  },
}

/**
 * The reader has scrolled up to check something written earlier.
 *
 * The mark of the reading position has moved with them, and the pill is now the only thing on
 * screen that says how to get back — which is the whole of what it is for.
 */
export const TheReaderLeftTheEdge: Story = {
  args: { entries: THREAD },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thread = canvas.getByRole('log')
    const rail = canvas.getByRole('navigation', { name: /^Marks of/ })
    const marks = within(rail).getAllByRole('button')

    // The middle of the scrollable range: as far from the live edge as this thread allows.
    thread.scrollTop = (thread.scrollHeight - thread.clientHeight) / 2

    const pill = await waitFor(() => canvas.getByRole('button', { name: 'Latest' }))
    expect(marks.at(-1)).not.toHaveAttribute('aria-current')
    expect(marks.filter((mark) => mark.getAttribute('aria-current') === 'true')).toHaveLength(1)

    await userEvent.click(pill)

    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Latest' })).toBeNull()
    })
    expect(marks.at(-1)).toHaveAttribute('aria-current', 'true')
  },
}

/**
 * A mark pressed: the reader is taken to the message it stands for.
 *
 * The rail is not a scrollbar, so a press is not a proportion of the thread — it is the message
 * itself, centred, and the rail says so by moving its reading position onto the mark pressed.
 */
export const AMarkPressed: Story = {
  args: { entries: THREAD },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: /^Marks of/ })
    const marks = within(rail).getAllByRole('button')

    await userEvent.click(marks[4]!)

    await waitFor(() => {
      expect(marks[4]).toHaveAttribute('aria-current', 'true')
    })
    // The reader is on a message in the middle of the thread, so the way back is offered.
    expect(canvas.getByRole('button', { name: 'Latest' })).toBeInTheDocument()
  },
}

/**
 * A thread where only some entries asked for a mark, which is how a Session with an agent reads.
 *
 * The rail is how a reader finds their way back to something *they* asked. A tick for every
 * block an agent reported was forty ticks for one question, and the trial of 22 September 2026
 * made the mark an opt-in: an entry that names none draws none, and the rail's reading position
 * steps over it exactly as it steps over a day. What matters here is that the two stay in step —
 * a rail whose active index counted one list and drew another would point at the wrong message
 * every time an unmarked entry went past.
 */
export const OnlyWhatAsksForAMark: Story = {
  args: { entries: ASKED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: /^Marks of/ })
    const marks = within(rail).getAllByRole('button')

    // Four marks where `ARealThread` drew twelve: only what asked for one has one.
    expect(marks).toHaveLength(ASKED_FOR.length)
    // And the reading position is still the last mark, which is where the Session opened.
    expect(marks.at(-1)).toHaveAttribute('aria-current', 'true')

    // Pressed, a mark still lands on its own entry and on no other: the rail counts what it
    // drew, so its indices and its anchors cannot come apart.
    await userEvent.click(marks[1]!)
    await waitFor(() => {
      expect(marks[1]).toHaveAttribute('aria-current', 'true')
    })
    expect(marks.filter((mark) => mark.getAttribute('aria-current') === 'true')).toHaveLength(1)
  },
}

/** The three states of a mark, with nothing else around them: read, beside it, and the rest. */
export const TheRail: Story = {
  render: () => (
    <div className="flex h-screen items-start justify-end p-6">
      <NavigationRail label="Marks of the thread" marks={MARKS} active={2} onSelect={selectMark} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Marks of the thread' })
    const marks = within(rail).getAllByRole('button')

    expect(marks).toHaveLength(MARKS.length)
    expect(marks[2]).toHaveAttribute('aria-current', 'true')
    expect(marks.filter((mark) => mark.getAttribute('aria-current') === 'true')).toHaveLength(1)

    // The mark being read is drawn wider than the two beside it, and those wider than the rest:
    // one tick alone is a cursor, and a tick its neighbours grow towards is a position.
    const width = (index: number): number =>
      marks[index]!.firstElementChild!.getBoundingClientRect().width
    expect(width(2)).toBeGreaterThan(width(1))
    expect(width(1)).toBeGreaterThan(width(0))

    await userEvent.click(marks[4]!)
    expect(selectMark).toHaveBeenCalledWith(MARKS[4]!.id)
  },
}

/**
 * What a mark says when the pointer rests on it, or when the keyboard lands on it.
 *
 * A mark is six pixels of line, and what it stands for is a sentence: the preview is the design
 * system's own tooltip, on the inside of the rail, and its words are the mark's name — what the
 * eye reads is what is announced, and not a shorter truth about where the mark goes.
 */
export const APreviewUnderTheHand: Story = {
  render: () => (
    <div className="flex h-screen items-start justify-end p-6">
      <NavigationRail label="Marks of the thread" marks={MARKS} active={2} onSelect={selectMark} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Marks of the thread' })
    const marks = within(rail).getAllByRole('button')

    await userEvent.hover(marks[0]!)

    const preview = await waitFor(() => within(document.body).getByRole('tooltip'))
    expect(preview).toHaveTextContent(MARKS[0]!.label)
  },
}

/**
 * A thread with a fold in it, and something under the fold to be pushed.
 *
 * Three entries and no rail: what is read here is what happens to the third one when the second
 * opens, and a thread long enough to scroll would put it out of sight.
 */
const FOLDS: ScrollerEntry[] = [
  {
    id: 'ask',
    mark: 'Where does the export build the file?',
    content: (
      <MessageGroup
        author="user"
        name="You"
        lines={[{ id: 'ask-1', body: 'Where does the export build the file?' }]}
      />
    ),
  },
  {
    id: 'call',
    content: (
      <ToolCallCard
        title="Read src/billing/export.ts"
        kind="read"
        status="completed"
        input={'path: src/billing/export.ts\noffset: 20\nlimit: 40'}
        output={
          'export function exportInvoices(rows: Invoice[]): string {\n  return rows.join()\n}\n'
        }
      />
    ),
  },
  {
    id: 'after',
    content: <p data-testid="under-the-fold">It builds the whole file before writing a byte.</p>,
  },
]

/** The block under the fold, and the element motion carries it on. */
function underTheFold(canvasElement: HTMLElement) {
  const block = within(canvasElement).getByTestId('under-the-fold')
  return { block, carried: block.parentElement! }
}

/**
 * A fold opening pushes what is under it instead of teleporting it (trial of 22 September 2026).
 *
 * Every block of the thread is a layout element of one group: motion measures where each of them
 * ended up once the card opened and plays the difference as a transform, so the answer under the
 * call travels to its new place rather than being drawn there between two frames. Nothing of a
 * block's own size is animated — a paragraph stretching under the eye reading it is the one
 * thing a growing thread must not do.
 */
export const AFoldOpening: Story = {
  args: { entries: FOLDS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { block, carried } = underTheFold(canvasElement)
    const before = block.getBoundingClientRect().top
    // At rest, nothing is being carried anywhere.
    await expect(getComputedStyle(carried).transform).toBe('none')

    await userEvent.click(canvas.getByRole('button', { name: /Read src\/billing\/export\.ts/ }))

    // Caught in flight: the block is somewhere between where it was and where it is going, and
    // a transform is what is holding it there.
    await waitFor(() => {
      expect(getComputedStyle(carried).transform, 'the thread jumped instead of moving').not.toBe(
        'none',
      )
    })
    // And it arrives: the transform is spent, and the block is lower than it was.
    await waitFor(() => {
      expect(getComputedStyle(carried).transform).toBe('none')
    })
    await expect(block.getBoundingClientRect().top).toBeGreaterThan(before)
  },
}

/**
 * The same fold for a reader who asked for less movement: the end state, and no journey.
 *
 * `MotionConfig` is the way the preference is said here rather than the browser's own media
 * query, and on purpose: the query is read once, when a component mounts, and a story that
 * emulates it afterwards is testing a tree that never heard. What is being proved is the rule
 * itself — a thread told to move less is not a thread whose blocks travel quickly, it is one
 * where a block is simply where it belongs and nothing is carrying it there.
 */
export const AFoldWithoutMotion: Story = {
  args: { entries: FOLDS },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <div className="h-screen p-6">
        <MessageScroller {...args} />
      </div>
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { block, carried } = underTheFold(canvasElement)
    const before = block.getBoundingClientRect().top

    await userEvent.click(canvas.getByRole('button', { name: /Read src\/billing\/export\.ts/ }))

    /*
     * Arrived, and arrived at once. The window is a fifth of a second, which is where the
     * assertion is: the spring this fold reads takes the better part of one to settle, so a
     * block already in its new place with nothing carrying it is a block that was given no
     * journey rather than one that finished the journey quickly.
     */
    await waitFor(
      () => {
        expect(block.getBoundingClientRect().top).toBeGreaterThan(before)
        expect(
          getComputedStyle(carried).transform,
          'a reader who asked for less movement was taken on the journey anyway',
        ).toBe('none')
      },
      { timeout: 200, interval: 10 },
    )
  },
}

/** A word of an answer still arriving, repeated as many times as the agent has written. */
const WORDS = 'The export builds the whole file in memory before it writes a byte. '

/**
 * A thread whose last entry is being written into, which is what an answer arriving is.
 *
 * The engine does not add an entry per word: it writes the same entry again with more of it, so
 * the thread grows taller without the list ever growing longer. The button is the agent typing.
 */
function Streaming(): ReactNode {
  const [written, setWritten] = useState(1)
  const entries: ScrollerEntry[] = [
    ...THREAD,
    {
      id: 'answer-arriving',
      content: <p data-testid="arriving">{WORDS.repeat(written)}</p>,
    },
  ]
  return (
    <div className="flex h-screen flex-col gap-2 p-6">
      <div className="min-h-0 flex-1">
        <MessageScroller label="the thread of CSV invoice export" entries={entries} />
      </div>
      <button type="button" onClick={() => setWritten((was) => was + 8)}>
        Write another line
      </button>
    </div>
  )
}

/** How far the last thing written is from the bottom of what is on screen, in pixels. */
function fromTheEdge(thread: HTMLElement): number {
  return thread.scrollHeight - thread.scrollTop - thread.clientHeight
}

/**
 * A thread the reader is at the end of follows the answer as it is written (trial of
 * 22 September 2026).
 *
 * The thread used to follow what arrived by counting entries, and an answer is not an entry
 * arriving: it is the last one being written again, with more of it. So the column grew and the
 * scroll stayed where it was — the reader watched the first line of an answer and read the rest
 * of it by scrolling down after the fact. What is watched is the height of what is written.
 *
 * And it is the reader's own scroll that decides: someone who went up to check something is
 * reading, and the thread lets go of them until they come back.
 */
export const AnAnswerArriving: Story = {
  render: () => <Streaming />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const thread = canvas.getByRole('log', { name: /CSV invoice export/ })
    const write = canvas.getByRole('button', { name: 'Write another line' })

    // A Session opens on what was written last, which is where this starts.
    await waitFor(() => {
      expect(fromTheEdge(thread)).toBeLessThanOrEqual(56)
    })

    await userEvent.click(write)
    await userEvent.click(write)
    await waitFor(() => {
      expect(canvas.getByTestId('arriving').textContent!.length).toBeGreaterThan(WORDS.length * 16)
    })
    await waitFor(() => {
      expect(
        fromTheEdge(thread),
        'the thread stopped following what was written',
      ).toBeLessThanOrEqual(56)
    })

    // The reader goes up to read something again: the thread lets go, and what arrives after
    // that leaves them exactly where they were.
    thread.scrollTop = 0
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Latest' })).toBeInTheDocument()
    })
    const held = thread.scrollTop
    await userEvent.click(write)
    await waitFor(() => {
      expect(canvas.getByTestId('arriving').textContent!.length).toBeGreaterThan(WORDS.length * 24)
    })
    await expect(thread.scrollTop, 'the thread moved under a reader who had gone up').toBe(held)
  },
}

/** The pill on its own: the one control a reader who scrolled up is offered. */
export const Latest: Story = {
  parameters: { layout: 'padded' },
  render: () => <LatestPill onGoToLatest={goToLatest} />,
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole('button', { name: 'Latest' })
    await userEvent.click(pill)
    expect(goToLatest).toHaveBeenCalled()
  },
}

/** A note of the application about the Session: an icon, a word, and no surface under it. */
function Note({ text }: { text: ReactNode }) {
  return (
    <>
      <IconSparkles size="sm" />
      {text}
    </>
  )
}
