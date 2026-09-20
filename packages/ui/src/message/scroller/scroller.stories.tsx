import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

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

const meta = {
  tags: ['autodocs'],
  title: 'Components/Message Scroller',
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
