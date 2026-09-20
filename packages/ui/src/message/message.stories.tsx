import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { ReactNode } from 'react'

import { IconSparkles, IconUser } from '../icons.ts'
import {
  LiveMarker,
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
} from './message.tsx'

/**
 * The thread of a Session (design D4b-02, D4b-08).
 *
 * What the user wrote, on their own side, grouped when it was written in one breath; what
 * Hemera noted about the Session itself — created, renamed — on the other, in the ghost tone,
 * because a note is not a message. The foot of a group says where those messages stand with
 * the engine, and it is the one place the difference between written and kept is shown.
 *
 * Nothing answers. No agent, no simulated reply, no indicator of generation: the thread of
 * this lot is the user's alone.
 */
const PAGE = 'mx-auto flex w-full max-w-3xl flex-col gap-5 p-6'

/** Who wrote it, drawn as the page will draw it: the person, or the application. */
function Face({ who }: { who: 'you' | 'hemera' }): ReactNode {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-primary-muted text-primary-muted-foreground">
      {who === 'you' ? <IconUser size="sm" /> : <IconSparkles size="sm" />}
    </span>
  )
}

/** One note of Hemera's own, read out of the Journal: the ghost tone, on the other side. */
function Note({ children }: { children: ReactNode }): ReactNode {
  return (
    <MessageGroup side="other" avatar={<Face who="hemera" />}>
      <MessageRow side="other">
        <MessageBubble tone="ghost">{children}</MessageBubble>
      </MessageRow>
    </MessageGroup>
  )
}

const FIRST =
  'Invoices should export with HT and TTC amounts per line. Today the CSV only has totals, and accounting re-keys everything by hand.'

const SECOND =
  'Constraints: one file per month, semicolon separator, UTF-8 with BOM for Excel. The vat_rate column exists on the line model already.'

const THIRD =
  'Open question: does the client number go on every line, or once in a header block? Ask Marie before turning this into a Spec.'

/** Why the engine would not keep it, in the words it gave. */
const REASON = 'Not saved: the Profile is read-only'

/** Writing it again, which is the one way out of a message that was not kept. */
const retried = fn()

/**
 * Waits for every bubble to have finished arriving.
 *
 * A message rises into the thread, and a colour read halfway through a fade is a colour mixed
 * with what is behind it — which is a contrast the accessibility pass is right to refuse. Every
 * story of this file waits it out before it ends.
 */
async function arrived(canvasElement: HTMLElement): Promise<void> {
  await waitFor(() => {
    for (const bubble of canvasElement.querySelectorAll('[data-tone]')) {
      expect(bubble).toHaveStyle({ opacity: '1' })
    }
  })
}

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Message',
  component: MessageGroup,
  parameters: { layout: 'fullscreen' },
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
  },
  decorators: [
    (Story) => (
      <div className={PAGE}>
        <Story />
      </div>
    ),
  ],
  args: {
    side: 'own',
    avatar: <Face who="you" />,
    header: <MessageHeader author="You" time="14:02" />,
    footer: <MessageFooter state="saved" />,
    children: (
      <MessageRow>
        <MessageBubble>{FIRST}</MessageBubble>
      </MessageRow>
    ),
  },
  argTypes: {
    side: {
      control: 'inline-radio',
      options: ['own', 'other'],
      description: 'Which side of the thread the group is written from.',
      table: { defaultValue: { summary: 'own' } },
    },
    avatar: { control: false, description: 'Drawn once, beside the first row.' },
    header: { control: false, description: 'Who wrote it and when, above the rows.' },
    footer: { control: false, description: 'Where the messages stand with the engine.' },
    children: { control: false, description: 'The rows of the group.' },
  },
} satisfies Meta<typeof MessageGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** The three tones, the break between two days, and the mark at the foot of the thread. */
export const Variants: Story = {
  render: () => (
    <>
      <MessageDaySeparator day="3 days ago" />
      <Note>Session created in Atlas</Note>
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="14:02" />}
      >
        <MessageRow>
          <MessageBubble tone="soft">{FIRST}</MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble tone="tint">{SECOND}</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <LiveMarker />
    </>
  ),
}

/** The three states of a message: kept, being kept, and not kept at all (design D4b-02). */
export const States: Story = {
  render: () => (
    <>
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="10:41" />}
        footer={<MessageFooter state="saved" />}
      >
        <MessageRow>
          <MessageBubble>{THIRD}</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="10:58" />}
        footer={<MessageFooter state="saving" />}
      >
        <MessageRow>
          <MessageBubble pending>
            Answer from Marie: every line. She wants to filter in Excel.
          </MessageBubble>
        </MessageRow>
      </MessageGroup>
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="10:59" />}
        footer={<MessageFooter state="failed" reason={REASON} onRetry={retried} />}
      >
        <MessageRow>
          <MessageBubble pending>
            Also: the export runs from the billing page, not from a command.
          </MessageBubble>
        </MessageRow>
      </MessageGroup>
    </>
  ),
}

/** A Session nobody has written in yet: it says so, and invents nothing to fill the page. */
export const EmptyThread: Story = {
  render: () => (
    <>
      <Note>Session created in Atlas · just now</Note>
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <p className="font-medium">Nothing written yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Your first message names the Session for you. Everything you write here is kept, whether
          or not an agent ever joins.
        </p>
      </div>
    </>
  ),
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
    const canvas = within(canvasElement)
    expect(canvas.getByText('Nothing written yet')).toBeInTheDocument()
  },
}

/** One message, and the whole apparatus of a group around it: a name, a time, a state. */
export const OneMessage: Story = {
  render: () => (
    <MessageGroup
      avatar={<Face who="you" />}
      header={<MessageHeader author="You" time="14:02" />}
      footer={<MessageFooter state="saved" />}
    >
      <MessageRow>
        <MessageBubble>{FIRST}</MessageBubble>
      </MessageRow>
    </MessageGroup>
  ),
}

/** What ten messages over three days look like: two breaks, and four groups rather than ten. */
export const ABurstOfTen: Story = {
  render: () => (
    <>
      <MessageDaySeparator day="3 days ago" />
      <Note>Session created in Atlas</Note>
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="14:02" />}
        footer={<MessageFooter state="saved" />}
      >
        <MessageRow>
          <MessageBubble>{FIRST}</MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>{SECOND}</MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>One file per month, and the month in the file name.</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <Note>Renamed “Untitled” → “CSV invoice export”</Note>
      <MessageDaySeparator day="Yesterday" />
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="09:12" />}
        footer={<MessageFooter state="saved" />}
      >
        <MessageRow>
          <MessageBubble>Marie is back on Thursday, so the header block waits.</MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>Meanwhile: the totals line stays where it is.</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <MessageDaySeparator day="Today" />
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="10:41" />}
        footer={<MessageFooter state="saved" />}
      >
        <MessageRow>
          <MessageBubble>{THIRD}</MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>
            Answer from Marie: every line. She wants to filter in Excel.
          </MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>
            Also: the export runs from the billing page, not from a command.
          </MessageBubble>
        </MessageRow>
        <MessageRow>
          <MessageBubble>That makes the Spec smaller than I thought.</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <LiveMarker />
    </>
  ),
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
    const canvas = within(canvasElement)
    // Three days, three breaks; ten messages, and the name said four times and not ten.
    expect(canvas.getAllByText(/^You$/)).toHaveLength(3)
    expect(canvas.getAllByText('Saved')).toHaveLength(3)
  },
}

/** Scenario « Message enregistré » of the Spec · sessions, caught between the two. */
export const BeingSaved: Story = {
  render: () => (
    <MessageGroup
      avatar={<Face who="you" />}
      header={<MessageHeader author="You" time="10:58" />}
      footer={<MessageFooter state="saving" />}
    >
      <MessageRow>
        <MessageBubble pending>
          Answer from Marie: every line. She wants to filter in Excel.
        </MessageBubble>
      </MessageRow>
    </MessageGroup>
  ),
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
    const canvas = within(canvasElement)
    // Not shown as kept while it is not: the word "Saved" is nowhere on the page (D4b-02).
    expect(canvas.getByText('Saving…')).toBeInTheDocument()
    expect(canvas.queryByText('Saved')).toBeNull()
  },
}

/** Scenario « Échec d'enregistrement » of the Spec · sessions: it says so, and offers the way back. */
export const FailedOffersRetry: Story = {
  render: () => (
    <MessageGroup
      avatar={<Face who="you" />}
      header={<MessageHeader author="You" time="10:59" />}
      footer={<MessageFooter state="failed" reason={REASON} onRetry={retried} />}
    >
      <MessageRow>
        <MessageBubble pending>
          Also: the export runs from the billing page, not from a command.
        </MessageBubble>
      </MessageRow>
    </MessageGroup>
  ),
  play: async ({ canvasElement }) => {
    retried.mockClear()
    await arrived(canvasElement)
    const canvas = within(canvasElement)

    // Said as an alert, because a message that was not kept is not a thing to notice later.
    expect(canvas.getByRole('alert')).toHaveTextContent(REASON)
    // And never shown as kept: the word is nowhere on the page (D4b-02).
    expect(canvas.queryByText('Saved')).toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(retried).toHaveBeenCalled()
    })
  },
}
