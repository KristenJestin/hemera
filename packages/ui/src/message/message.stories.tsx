import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { IconSparkles } from '../icons.ts'
import { AgentText } from './agent-text.tsx'
import { MessageText } from './message-text.tsx'
import { LiveMarker, MessageDaySeparator, MessageGroup, MessageRow } from './message.tsx'
import type { MessageLine, MessageState } from './model.ts'

/**
 * The thread of a Session (design D4b-08, D4b-09).
 *
 * Consecutive lines by the same author are one group with one head and one foot, the user is on
 * the right, and Hemera's own notes are lines without a surface. Nothing here answers: the
 * thread is what the user wrote, and the last thing written is the last thing shown.
 *
 * The agent of `Conversation` and of `ARealThread` is a fixture and not a reply — nothing in
 * this catalogue answers — but the author itself is drawn, and `AgentAnswer` is what it looks
 * like: an agent writes Markdown and writes it while thinking, so its lines are drawn from the
 * text as it arrives (`AgentText`) while what the user wrote is drawn as it was typed. A thread
 * that drew the two the same way would show the syntax of an answer instead of the answer.
 */
const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Message/Message',
  component: MessageGroup,
  parameters: { layout: 'padded' },
  args: {
    author: 'user',
    name: 'You',
    at: '14:02',
    state: 'saved',
    lines: [{ id: 'one', body: 'Invoices should export with HT and TTC amounts per line.' }],
  },
  argTypes: {
    author: { control: 'inline-radio', options: ['user', 'hemera', 'agent'] },
    tone: { control: 'inline-radio', options: ['soft', 'tint', 'ghost'] },
    state: { control: 'inline-radio', options: [undefined, 'saved', 'saving', 'failed'] },
    name: { control: 'text', description: 'Said once, over the group.' },
    at: {
      control: 'text',
      description: 'Already written for the platform; the component formats nothing.',
    },
    lines: {
      control: false,
      description: 'The messages of the group, in the order they were written.',
    },
    error: { control: 'text', description: 'Why the Profile did not take the last line.' },
    onRetry: { control: false, description: 'What the retry does; nothing without an engine.' },
  },
} satisfies Meta<typeof MessageGroup>

export default meta
type Story = StoryObj<typeof meta>

/**
 * How far up from its place a foot is drawn, in pixels, off its computed transform.
 *
 * A foot at rest is not the same thing as a foot in place: the second is the one that has
 * arrived, and the first is a few pixels higher with a fade on it.
 */
function liftOf(foot: HTMLElement): number {
  const drawn = getComputedStyle(foot).transform
  return drawn === 'none' ? 0 : new DOMMatrixReadOnly(drawn).m42
}

/** One message from the user, saved. The simplest thing a thread can hold. */
export const Playground: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const group = canvas.getByRole('group', { name: 'Messages from You' })
    expect(canvas.getByText('You')).toBeInTheDocument()
    // The state of a kept group is the quiet half of a thread: it is away until the hand or the
    // keyboard asks for it, which is what stops a column of messages from carrying a line each.
    const foot = canvas.getByText('Saved').closest('p')!
    expect(getComputedStyle(foot).filter).toBe('opacity(0)')
    // Away is not only a fade: the line also sits a few pixels up, which is the part the eye
    // reads as arriving. The hand is put on the group by its own event rather than by a pointer,
    // because this harness aims one wherever the story's geometry allows.
    expect(liftOf(foot)).toBeLessThan(0)
    fireEvent.pointerOver(group)
    await waitFor(() => expect(getComputedStyle(foot).filter).toBe('opacity(1)'))
    // In place, and it stays there: the foot has settled rather than jumped.
    expect(liftOf(foot)).toBe(0)
  },
}

/**
 * A burst: ten lines written quickly, which is one turn and not ten.
 *
 * The name, the time and the state are said once, at the top and at the bottom of the run, and
 * the lines in between are drawn as one block — that is what a group is for.
 */
export const BurstOfTen: Story = {
  args: {
    at: '10:41',
    lines: Array.from({ length: 10 }, (_, index) => ({
      id: `burst-${String(index)}`,
      body: `Constraint ${String(index + 1)}: the export runs from the billing page, one file per month.`,
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Ten lines, one head between them, one foot under them: the group says it once.
    expect(canvasElement.querySelectorAll('[aria-label="Messages from You"] > div')).toHaveLength(
      10,
    )
    expect(canvas.getAllByText('You')).toHaveLength(1)
    expect(canvas.getAllByText('Saved')).toHaveLength(1)
  },
}

/** On its way: the Profile has not committed yet, so nothing claims it has. */
export const Saving: Story = {
  args: {
    at: '10:58',
    state: 'saving',
    lines: [
      { id: 'pending', body: 'Answer from Marie: every line. She wants to filter in Excel.' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Saving…')).toBeInTheDocument()
    // The one thing this story exists for: a line on its way is never shown as kept.
    expect(canvas.queryByText('Saved')).toBeNull()
  },
}

/** Refused: the engine said no, the text is still there, and the retry is one press away. */
export const Failed: Story = {
  args: {
    at: '10:59',
    state: 'failed',
    error: 'the profile is read-only',
    onRetry: fn(),
    lines: [
      { id: 'refused', body: 'Also: the export runs from the billing page, not from a command.' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByText('Not saved: the profile is read-only').closest('p')!
    expect(line).toBeInTheDocument()
    const retry = canvas.getByRole('button', { name: 'Retry' })
    // What went wrong and the way back are one sentence: the words, then the press right
    // against them, with no line of empty space between the two.
    const words = line.querySelector('span')!
    expect(line.lastElementChild).toBe(retry)
    expect(retry.getBoundingClientRect().left - words.getBoundingClientRect().right).toBeLessThan(
      12,
    )
    // And the pair sits with the message it belongs to, on the side that message is on: the
    // press ends where the words inside the bubble end, which is the line's own padding in.
    expect(retry.getBoundingClientRect().right).toBeCloseTo(
      line.getBoundingClientRect().right - 12,
      0,
    )
    // A quiet button, and not a second bubble: no surface of its own, so the retry does not
    // read as another line of the thread.
    expect(getComputedStyle(retry).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    // A refusal is the one state that is not waiting for the hand to pass over it.
    await waitFor(() => expect(getComputedStyle(line).filter).toBe('opacity(1)'))
    expect(canvas.queryByText('Saved')).toBeNull()
  },
}

/**
 * What the tone does to the same words: a surface with a rim, the accent colour, or a sentence
 * with no surface at all — which is what Hemera's own notes are made of.
 */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-4">
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        state="saved"
        lines={[{ id: 'soft', body: 'A message on a surface with a rim.' }]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="14:03"
        tone="tint"
        state="saved"
        lines={[{ id: 'tint', body: 'The same words, in the accent colour.' }]}
      />
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'ghost', body: 'Session created in Atlas' }]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const soft = canvas.getByText('A message on a surface with a rim.')
    const tint = canvas.getByText('The same words, in the accent colour.')
    const ghost = canvas.getByText('Session created in Atlas')

    // Three tones, three surfaces: the body colour, the accent colour, and nothing behind the
    // words at all — which is what makes a note of the application a sentence and not a
    // message. The rim is what tells the soft one from the two that have none.
    expect(getComputedStyle(soft).backgroundColor).not.toBe(getComputedStyle(tint).backgroundColor)
    expect(getComputedStyle(ghost).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(soft).borderTopWidth).toBe('1px')
    expect(getComputedStyle(tint).borderTopWidth).toBe('0px')
    expect(getComputedStyle(ghost).borderTopWidth).toBe('0px')
  },
}

/**
 * What the Profile did with what was written, side by side: kept, on its way, and refused.
 *
 * The three states of one foot, drawn together so they can be told apart: `Saved` is said only
 * once the transaction committed, `Saving…` never claims it has, and a refusal keeps the text
 * and offers the retry — which is the one thing this lot refuses to get wrong (D4b-02).
 *
 * The foot is the same foot on both sides of the thread, and only the name above it moves, so
 * the three are drawn on the two sides rather than three times on one.
 */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid w-full grid-cols-3 items-start gap-4">
      <MessageGroup
        author="agent"
        name="Agent"
        at="14:02"
        state="saved"
        lines={[{ id: 'saved', body: 'Kept: the Profile took this line.' }]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="14:03"
        state="saving"
        lines={[{ id: 'saving', body: 'On its way: the write has not committed yet.' }]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="14:04"
        state="failed"
        error="the profile is read-only"
        onRetry={fn()}
        lines={[{ id: 'failed', body: 'Refused: the engine said no.' }]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const foot = (text: string): HTMLElement => canvas.getByText(text).closest('p')!

    // One state per group, said once under each: a message on its way is never drawn as kept.
    expect(canvas.getAllByText('Saved')).toHaveLength(1)
    expect(canvas.getAllByText('Saving…')).toHaveLength(1)
    expect(canvas.getAllByText('Not saved: the profile is read-only')).toHaveLength(1)
    // The two quiet states are the ones that wait for the hand; the refusal is drawn all the
    // time, because it is the one state the reader has to act on.
    expect(getComputedStyle(foot('Saved')).filter).toBe('opacity(0)')
    expect(getComputedStyle(foot('Saving…')).filter).toBe('opacity(0)')
    await waitFor(() =>
      expect(getComputedStyle(foot('Not saved: the profile is read-only')).filter).toBe(
        'opacity(1)',
      ),
    )
    // And the hand draws the foot of the group it is on, and of that group alone. Put on the
    // group by its own event rather than by a pointer: this harness aims one wherever the
    // story's geometry allows.
    fireEvent.pointerOver(canvas.getByRole('group', { name: 'Messages from Agent' }))
    await waitFor(() => expect(getComputedStyle(foot('Saved')).filter).toBe('opacity(1)'))
    expect(getComputedStyle(foot('Saving…')).filter).toBe('opacity(0)')
    // And the refusal is the one that keeps its text and offers the way back.
    expect(canvas.getByText('Refused: the engine said no.')).toBeInTheDocument()
    expect(canvas.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  },
}

/**
 * A write and the three things that can happen to it, for the hand to try.
 *
 * A harness and not a component: the state of a write is the engine's to give, and taking one
 * away on purpose is the only way to watch a foot leave. The three presses are the hand's.
 */
function AWriteUnderTheHand(): ReactNode {
  const [state, setState] = useState<MessageState | undefined>('saved')
  return (
    <div className="flex w-full flex-col gap-6">
      <MessageGroup
        author="user"
        name="You"
        at="14:05"
        state={state}
        lines={[{ id: 'harness', body: 'The write this state is about.' }]}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setState('saving')}>
          Write
        </Button>
        <Button size="sm" onClick={() => setState('saved')}>
          Commit
        </Button>
        <Button size="sm" onClick={() => setState(undefined)}>
          Forget the write
        </Button>
      </div>
    </div>
  )
}

/**
 * A foot arriving, settling and being let go: what a state does when it comes and goes.
 *
 * One thing is held here, and it is the half of the animation that is easy to lose: a foot that
 * is gone goes rather than vanishes. The state has left the engine, and the page still has the
 * line that says so for as long as it takes it to travel back the way it came.
 */
export const ArrivingAndLeaving: Story = {
  parameters: { controls: { disable: true } },
  render: () => <AWriteUnderTheHand />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const foot = canvas.getByText('Saved').closest('p')!
    fireEvent.pointerOver(canvas.getByRole('group', { name: 'Messages from You' }))
    await waitFor(() => expect(getComputedStyle(foot).filter).toBe('opacity(1)'))
    await userEvent.click(canvas.getByRole('button', { name: 'Forget the write' }))
    expect(canvas.queryByText('Saved')).not.toBeNull()
    await waitFor(() => expect(canvas.queryByText('Saved')).toBeNull())
  },
}

/**
 * An exchange rather than a monologue: what the user asked, what an agent answered, and what
 * the user said next.
 *
 * This is the story the grouping is judged on. Three authors in one column, the user on one
 * side and the others on the other, and the name — once, over the group — is the whole of what
 * tells them apart.
 */
export const Conversation: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-6">
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'created', body: <Note text="Session created in Atlas" /> }]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        state="saved"
        lines={[
          { id: 'ask-1', body: 'The invoice export needs HT and TTC per line.' },
          {
            id: 'ask-2',
            body: 'Semicolon separator, UTF-8 with BOM: accounting opens it in Excel.',
          },
        ]}
      />
      <MessageGroup
        author="agent"
        name="Agent"
        at="14:03"
        state="saved"
        lines={[{ id: 'answer', body: 'The billing page is then the only entry point.' }]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="14:04"
        state="saved"
        lines={[{ id: 'ask-3', body: 'Yes — and the client number on every line.' }]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const place = (text: string): DOMRect => canvas.getByText(text).getBoundingClientRect()

    // Two turns of the user and one of the agent, each with its name said once.
    expect(canvas.getAllByText('You')).toHaveLength(2)
    expect(canvas.getByText('Agent')).toBeInTheDocument()
    // What the user wrote is on one side and what everyone else wrote on the other, which is
    // the whole of how a reader finds their own words without reading the thread.
    expect(place('Yes — and the client number on every line.').left).toBeGreaterThan(
      place('The billing page is then the only entry point.').left,
    )
  },
}

/**
 * Three days of one Session, as the page assembles it: days break the thread, the notes of the
 * application stand aside in the ghost tone, and the live edge closes the column.
 */
export const ARealThread: Story = {
  parameters: { controls: { disable: true } },
  render: () => <Thread />,
}

const FIRST: MessageLine[] = [
  {
    id: 'a1',
    body: 'Invoices should export with HT and TTC amounts per line. Today the CSV only has totals, and accounting re-keys everything by hand.',
  },
  {
    id: 'a2',
    body: 'Constraints: one file per month, semicolon separator, UTF-8 with BOM for Excel.',
  },
]

function Thread() {
  return (
    <div className="flex w-full flex-col gap-6">
      <MessageDaySeparator day="3 days ago" />
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'created', body: <Note text="Session created in Atlas" /> }]}
      />
      <MessageGroup author="user" name="You" at="14:02" state="saved" lines={FIRST} />
      <MessageGroup
        author="hemera"
        name="Hemera"
        tone="ghost"
        lines={[{ id: 'renamed', body: <Note text="Renamed “Untitled” → “CSV invoice export”" /> }]}
      />
      <MessageDaySeparator day="today" />
      <MessageGroup
        author="user"
        name="You"
        at="10:41"
        state="saved"
        lines={[
          {
            id: 'b1',
            body: 'Open question: does the client number go on every line, or once in a header block?',
          },
        ]}
      />
      <MessageGroup
        author="user"
        name="You"
        at="10:58"
        state="saving"
        lines={[{ id: 'b2', body: 'Answer from Marie: every line. She wants to filter in Excel.' }]}
      />
      <MessageGroup
        author="agent"
        name="Agent"
        at="11:04"
        state="saved"
        lines={[
          {
            id: 'b3',
            body: 'Then the billing page is the entry point, and one file per month is enough.',
          },
        ]}
      />
      <LiveMarker>You are at the latest message</LiveMarker>
    </div>
  )
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

/**
 * A row on its own, for whoever assembles a thread of their own — the group is the usual way,
 * and this is what it is made of.
 */
export const Rows: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-3">
      <MessageRow author="user" tail>
        One line, and nothing around it.
      </MessageRow>
      <MessageGroup
        author="user"
        name="You"
        at="10:41"
        state="saved"
        lines={[
          { id: 'c1', body: 'A group says the name once, over the lines it holds.' },
          { id: 'c2', body: 'A burst of ten is one turn, and not ten names.' },
        ]}
      />
    </div>
  ),
}

/**
 * The files a message named, drawn as the box drew them (design D4-07).
 *
 * What was written is what is read: the `@` of a mention is the chip the composer left, in the
 * accent and with its mark, and the name is the file rather than the folders above it. And a
 * mention is what the sentence says it is — an address is not a file, a word in front of the `@`
 * is what tells the two apart, and a mention may end the sentence it is in.
 */
export const NamedFiles: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-3">
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        state="saved"
        lines={[
          {
            id: 'one',
            body: (
              <MessageText body="Check @sources/front/src/pages/billing.tsx before the export lands." />
            ),
          },
          {
            id: 'two',
            body: (
              <MessageText body="Write to kris@example.com, and copy the @README.md in the reply." />
            ),
          },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chips = canvasElement.querySelectorAll('[data-file]')

    // Two mentions in two lines, and the address is not one of them.
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveAttribute('data-file', 'sources/front/src/pages/billing.tsx')
    expect(chips[0]).toHaveAttribute('data-kind', 'mention')
    expect(chips[0]).toHaveTextContent('billing.tsx')
    expect(chips[1]).toHaveAttribute('data-file', 'README.md')

    // The sentence around them is untouched, down to the full stop that ends it.
    expect(canvas.getByText(/before the export lands\./)).toBeInTheDocument()
    expect(canvas.getByText(/kris@example\.com/)).toBeInTheDocument()
  },
}

/** A path handed over from anywhere: the kind is in the words, and the words are in the quote. */
const HANDED = 'C:\\Users\\kris\\Pictures\\ChatGPT Image Sep 19, 2026, 11_53_54 PM.png'

/**
 * A file handed over rather than pointed at, and a name with spaces in it.
 *
 * The paperclip writes `@"path"` where the `@` menu writes `@path`, and the thread reads the two
 * apart: the file a Session was given is drawn as the file it is — the paperclip, and the tone the
 * header above the box gives it — while a file that was merely named keeps its `@`. The quote is
 * also what keeps a path together: a name with spaces in it used to end at the first one, and the
 * rest of the path came out as words about nothing.
 *
 * The thread here is narrower than the name, which is what a narrow window is: the name gives way
 * rather than the page.
 */
export const AFileHandedOver: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="w-sidebar">
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        state="saved"
        lines={[
          {
            id: 'one',
            body: <MessageText body={`Write this up with @"${HANDED}" parce que la`} />,
          },
          {
            id: 'two',
            body: <MessageText body="And @sources/front/src/pages/billing.tsx still holds." />,
          },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chips = canvasElement.querySelectorAll('[data-file]')

    // The file that was handed over, whole: the path, and the name as it is called.
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveAttribute('data-kind', 'file')
    expect(chips[0]).toHaveAttribute('data-file', HANDED)
    expect(chips[0]).toHaveTextContent('ChatGPT Image Sep 19, 2026, 11_53_54 PM.png')
    // A mention is still a mention, and still named the same way.
    expect(chips[1]).toHaveAttribute('data-kind', 'mention')
    expect(chips[1]).toHaveAttribute('data-file', 'sources/front/src/pages/billing.tsx')

    // Neither sentence was eaten by the spaces in the path.
    expect(canvas.getByText(/parce que la/)).toBeInTheDocument()
    expect(canvas.getByText(/still holds\./)).toBeInTheDocument()

    // The name gives way to the narrow thread instead of the thread widening: a chip that cannot
    // shorten is a chip that takes the composer and the whole page sideways with it.
    const name = chips[0]?.lastElementChild
    expect(name?.scrollWidth ?? 0).toBeGreaterThan(name?.clientWidth ?? 0)
    const narrow = canvasElement.firstElementChild
    expect(narrow?.scrollWidth ?? 0).toBeLessThanOrEqual((narrow?.clientWidth ?? 0) + 1)
  },
}

/**
 * What an agent answered, under the question that was asked of it.
 *
 * The two bodies of a thread side by side, because they are drawn differently on purpose. What
 * the user wrote is what they typed: a star in a message is a star, and the line breaks they put
 * in are the line breaks they meant. An agent answers in Markdown and answers while writing, so
 * its text is reparsed as it arrives and what is read is the answer so far rather than the syntax
 * of it (D5-14). `AgentText` is the whole of that difference, and this is the story that holds
 * the two apart: the same punctuation, drawn two ways.
 */
export const AgentAnswer: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col gap-3">
      <MessageGroup
        author="user"
        name="You"
        at="14:02"
        state="saved"
        lines={[
          {
            id: 'asked',
            body: (
              <MessageText body="Why does a January run export December, and why is the sheet empty *sometimes*?" />
            ),
          },
        ]}
      />
      <MessageGroup
        author="agent"
        name="Claude Code"
        at="14:02"
        lines={[
          {
            id: 'answered',
            body: (
              <AgentText
                text={`Two things, and they are the same thing twice.

The month comes from \`query.get('month')\`, which is the *previous* month:

- A run in January exports December.
- The file is written before the totals are checked.`}
              />
            ),
          },
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fromAgent = canvasElement.querySelector('[aria-label="Messages from Claude Code"]')!
    const fromUser = canvasElement.querySelector('[aria-label="Messages from You"]')!

    // The two voices are not on the same side: an answer begins at the left edge of the thread
    // and a question ends against the right one, which is what `items-end` on the group of the
    // user does. The group itself is a full-width block, so what is measured is the body inside
    // it — the same measurement the file makes of a line that has to sit under a sentence.
    const asked = canvas.getByText(/empty \*sometimes\*/).getBoundingClientRect()
    const answered = canvas
      .getByText(/Two things, and they are the same thing twice/)
      .getBoundingClientRect()
    expect(answered.left).toBeLessThan(asked.left)

    // The answer is Markdown: a list of two items, code in a sentence, and an emphasis.
    expect(fromAgent.querySelectorAll('li')).toHaveLength(2)
    expect(fromAgent.querySelector('code')?.textContent).toBe("query.get('month')")
    expect(fromAgent.querySelector('em')?.textContent).toBe('previous')

    // And what the user wrote is not: a star in a message is a star, and no part of a message
    // is an element a parser made. The same punctuation, and the one place where the two
    // bodies of a thread could be confused for each other.
    expect(fromUser.querySelector('em')).toBeNull()
    expect(fromUser.querySelectorAll('code, li')).toHaveLength(0)
    expect(canvas.getByText(/empty \*sometimes\*/)).toBeInTheDocument()
  },
}
