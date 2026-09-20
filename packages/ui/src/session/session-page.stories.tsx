import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within } from 'storybook/test'
import { useState } from 'react'

import { Composer } from '../composer/composer.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { MessageDaySeparator, MessageGroup } from '../message/message.tsx'
import type { MessageLine, MessageState } from '../message/model.ts'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import { SessionEmpty, SessionHeader } from './session.tsx'

/**
 * The page of a Session, assembled from what this package hands out (design D4b-02, D4b-08).
 *
 * The renderer's own page is an adapter: it holds the Session, the entries and the write, and
 * draws nothing of its own. This story is that page with the fixtures standing in for the
 * engine — which is what the UI gate is for: the surface is validated here, on the two themes
 * and at the keyboard, before anything is wired to a database.
 *
 * The thread is the user's alone. No agent answers, nothing is simulated, and the empty state
 * says so rather than showing an invented first line: a thread with a fake reply in it is the
 * one thing the spec forbids this lot to draw.
 */

/** What the harness decides: a thread, how it stands with the profile, and where the page is. */
interface PageProps {
  title: string
  /** The line under the title, already written for the platform. */
  meta: string
  /** The thread, in the order it was written. */
  thread: { day?: string; lines: MessageLine[] }[]
  /** Where the last message stands with the profile. */
  state: MessageState
  /** Why it is not kept, when it is not. */
  error?: string
  /** Whether the title is being typed into. */
  editing?: boolean
  /** Whether the page is a Session with nothing in it yet. */
  empty?: boolean
}

function Page({ title, meta, thread, state, error, editing = false, empty = false }: PageProps) {
  const [name, setName] = useState(title)
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [writes, setWrites] = useState<MessageState>(state)

  /**
   * The write: nothing here reaches a database, and a refusal is the one the engine would give.
   *
   * The sentence is not taken here — the composer hands it over, and what a page does with it
   * is the engine's business. This story only says where the write stands.
   */
  const send = async (): Promise<string | null> => {
    if (error !== undefined) {
      setWrites('failed')
      return error
    }
    setWrites('saving')
    await Promise.resolve()
    setWrites('saved')
    setValue('')
    return null
  }

  const entries: ScrollerEntry[] = thread.flatMap((run, index) => [
    ...(run.day === undefined
      ? []
      : [
          {
            id: `day-${index}`,
            day: true as const,
            content: <MessageDaySeparator day={run.day} />,
          },
        ]),
    {
      id: `run-${index}`,
      mark: String(run.lines[0]?.body ?? ''),
      content: (
        <MessageGroup
          author="user"
          name="You"
          lines={run.lines}
          state={index === thread.length - 1 ? writes : undefined}
          error={index === thread.length - 1 ? error : undefined}
          onRetry={fn()}
        />
      ),
    },
  ])

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-6 pb-4">
          <SessionHeader
            title={name}
            projectName="Atlas"
            meta={meta}
            onRename={setName}
            editing={editing}
            onStartEditing={fn()}
            onCancelEditing={fn()}
            onArchive={fn()}
            archiveDisabled={empty}
          />
        </div>
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6">
          {empty ? (
            <SessionEmpty />
          ) : (
            <MessageScroller label="The thread of this Session" entries={entries} />
          )}
        </div>
        <div className="mx-auto w-full max-w-3xl px-6 pb-4">
          <Composer
            value={value}
            onValueChange={setValue}
            files={files}
            onFilesChange={setFiles}
            onSearchFiles={() => Promise.resolve([])}
            variant="inline"
            action="Send"
            placeholder="Write to this Session…"
            onSend={send}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

const THREAD = [
  {
    day: '3 days ago',
    lines: [
      { id: 'a', body: 'The CSV export drops the invoice date on every second row.' },
      {
        id: 'b',
        body: 'It is the same in the monthly report, so it is the writer and not the report.',
      },
    ],
  },
  {
    day: 'today',
    lines: [
      { id: 'c', body: 'I moved the date into the same column as the amount.' },
      { id: 'd', body: 'Now the totals line up with the bank statement.' },
    ],
  },
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Session page',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'CSV invoice export',
    meta: 'created 3 days ago · 4 messages',
    thread: THREAD,
    state: 'saved',
  },
  argTypes: {
    title: { control: 'text', description: 'What the Session is called.' },
    meta: { control: 'text', description: 'The line under the title, already written.' },
    thread: { table: { disable: true } },
    state: {
      control: 'inline-radio',
      options: ['saving', 'saved', 'failed'],
      description: 'Where the last message stands with the profile.',
    },
    error: { control: 'text', description: 'Why the last message is not kept.' },
    editing: { control: 'boolean', description: 'Whether the title is being typed into.' },
    empty: { control: 'boolean', description: 'Whether the Session has nothing in it yet.' },
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** A Session with a thread in it: the head, the run of messages, and the foot that writes. */
export const Playground: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeInTheDocument()
    expect(canvas.getByRole('log', { name: 'The thread of this Session' })).toBeInTheDocument()
    // Every line is in the thread, in the order it was written, and the days break it.
    const thread = canvas.getByRole('log', { name: 'The thread of this Session' })
    expect(within(thread).getAllByText(/column|totals|writer|date/)).toHaveLength(4)
    expect(within(thread).getAllByRole('separator')).toHaveLength(2)
    expect(canvas.getByRole('button', { name: /Send/ })).toBeInTheDocument()
  },
}

/**
 * The two pages a Session is: one with a thread, and one that has nothing in it yet.
 *
 * A new Session is a real page and not an empty column: the head says what it is called and
 * what can be done to it, the middle says the thread is empty rather than showing an invented
 * first message, and the foot is ready.
 */
export const Variants: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-2">
      <Page
        title="CSV invoice export"
        meta="created 3 days ago · 4 messages"
        thread={THREAD}
        state="saved"
      />
      <Page title="New session" meta="just now" thread={[]} state="saved" empty editing />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('log')).toHaveLength(1)
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
    // The title of a Session that has just been made is the one thing it has to say, so the
    // field is open on it and the page is not waiting to be asked.
    expect(canvas.getByRole('textbox', { name: /Session title|Title/ })).toBeInTheDocument()
  },
}

/** The three states of the foot: a write in flight, a write kept, and a write refused. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-3">
      <Page title="In flight" meta="just now · 5 messages" thread={THREAD} state="saving" />
      <Page title="Kept" meta="just now · 5 messages" thread={THREAD} state="saved" />
      <Page
        title="Refused"
        meta="just now · 5 messages"
        thread={THREAD}
        state="failed"
        error="the profile is read-only"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByText('Saving…')).toHaveLength(1)
    expect(canvas.getAllByText('Saved')).toHaveLength(1)
    // A message that was not kept is never shown as kept, and the sentence is still there to
    // be sent again: the reason is said, and the way back is offered.
    expect(canvas.getByText('Not saved: the profile is read-only')).toBeInTheDocument()
    expect(canvas.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  },
}

/**
 * A Session nothing has been written into: no invented entry, and a way to start.
 *
 * The composer is the way in, which is why the empty state does not carry a button of its own.
 */
export const Empty: Story = {
  parameters: { controls: { disable: true } },
  args: { title: 'New session', meta: 'just now', thread: [], empty: true, editing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
    expect(canvas.queryByRole('log')).toBeNull()
    // The way in is the composer: the box is there, named by what it asks for, and empty.
    const box = canvas.getByRole('textbox', { name: 'Write to this Session…' })
    expect(box).toHaveTextContent('')
  },
}

/**
 * A thread long enough to be out of sight, which is when the rail is drawn at all.
 *
 * The rail is a map of the thread and not a scrollbar: one mark per message, the one being
 * read drawn wider than its neighbours.
 */
export const AThreadThatDoesNotFit: Story = {
  parameters: { controls: { disable: true } },
  args: {
    thread: [
      {
        day: 'last week',
        lines: Array.from({ length: 12 }, (_, index) => ({
          id: `long-${index}`,
          body: `Line ${index + 1} of a thread that is taller than the window it is read in.`,
        })),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('navigation', { name: /thread/i })).toBeInTheDocument()
    // A thread is read from its end: the page opens on what was written last.
    const thread = canvas.getByRole('log', { name: 'The thread of this Session' })
    expect(thread.scrollTop).toBeGreaterThan(0)
  },
}
