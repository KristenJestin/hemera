import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { type ReactNode, useState } from 'react'

import { Composer } from '../../composer/composer.tsx'
import { IconSparkles, IconUser } from '../../icons.ts'
import {
  LiveMarker,
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
} from '../message.tsx'
import { NavigationRail, type NavigationTick } from './navigation-rail.tsx'
import { MessageScroller, type MessageScrollerProps } from './scroller.tsx'

/**
 * The scrolling of a thread, which is the one behaviour worth a component (design D4b-08).
 *
 * It follows the last message while the reader is at it, lets go the moment they scroll up,
 * and offers the way back as a pill that exists only while there is somewhere to come back
 * from. The rail beside it is the shape of the conversation: one tick per message, a taller
 * one per day, the one being read wider and in the accent.
 *
 * The stories run in a window of a fixed height, because a scroller with nothing to scroll is
 * a scroller with nothing to show.
 */
const WINDOW = 'mx-auto flex h-screen w-full max-w-3xl flex-col gap-3 p-6'

function Face({ who }: { who: 'you' | 'hemera' }): ReactNode {
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-primary-muted text-primary-muted-foreground">
      {who === 'you' ? <IconUser size="sm" /> : <IconSparkles size="sm" />}
    </span>
  )
}

/** Enough messages that the thread runs past the window, which is what makes it a thread. */
const WRITTEN = [
  'Invoices should export with HT and TTC amounts per line.',
  'Today the CSV only has totals, and accounting re-keys everything by hand.',
  'One file per month, semicolon separator, UTF-8 with BOM for Excel.',
  'The vat_rate column exists on the line model already.',
  'Does the client number go on every line, or once in a header block?',
  'Ask Marie before turning any of this into a Spec.',
  'Answer from Marie: every line. She wants to filter in Excel.',
  'Also: the export runs from the billing page, not from a command.',
  'That makes the Spec smaller than I thought.',
  'Last one: the file name carries the month, not the day.',
]

/** One group per message, so each has a tick of its own on the rail. */
function Thread(): ReactNode {
  return (
    <>
      <MessageDaySeparator day="Yesterday" />
      {WRITTEN.map((text, index) => (
        <MessageGroup
          key={text}
          avatar={<Face who="you" />}
          header={<MessageHeader author="You" time={`10:${String(index + 10)}`} />}
          footer={<MessageFooter state="saved" />}
        >
          <MessageRow>
            <MessageBubble>{text}</MessageBubble>
          </MessageRow>
        </MessageGroup>
      ))}
      <LiveMarker />
    </>
  )
}

/**
 * Waits for every bubble to have finished arriving.
 *
 * A colour read halfway through a fade is a colour mixed with what is behind it, which is a
 * contrast the accessibility pass is right to refuse. Every story of this file waits it out
 * before it ends.
 */
async function arrived(canvasElement: HTMLElement): Promise<void> {
  await waitFor(() => {
    for (const bubble of canvasElement.querySelectorAll('[data-tone]')) {
      expect(bubble).toHaveStyle({ opacity: '1' })
    }
  })
}

const TICKS: NavigationTick[] = [
  { key: 'day', kind: 'day' },
  ...WRITTEN.map((text) => ({ key: text, kind: 'message' as const })),
]

const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Message Scroller',
  component: MessageScroller,
  parameters: { layout: 'fullscreen' },
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
  },
  decorators: [
    (Story) => (
      <div className={WINDOW}>
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'Thread of CSV invoice export',
    rail: <NavigationRail ticks={TICKS} activeKey={WRITTEN.at(-1)} />,
    children: <Thread />,
  },
  argTypes: {
    label: { control: 'text', description: 'What the thread is called to a screen reader.' },
    rail: { control: false, description: 'The rail drawn down its side.' },
    children: { control: false, description: 'The groups of the thread.' },
  },
} satisfies Meta<typeof MessageScroller>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

/** With the rail, and without: a thread short enough to read at once needs no map of itself. */
export const Variants: Story = {
  args: { rail: undefined },
  render: (args) => (
    <MessageScroller {...args}>
      <MessageDaySeparator day="Today" />
      <MessageGroup
        avatar={<Face who="you" />}
        header={<MessageHeader author="You" time="10:41" />}
        footer={<MessageFooter state="saved" />}
      >
        <MessageRow>
          <MessageBubble>{WRITTEN[0]}</MessageBubble>
        </MessageRow>
      </MessageGroup>
      <LiveMarker />
    </MessageScroller>
  ),
}

/**
 * Stuck to the live edge, which is where a thread opens: the pill has nowhere to bring anyone
 * back from, so it is not there at all.
 */
export const States: Story = {
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
    const canvas = within(canvasElement)
    const viewport = canvas.getByRole('log')

    await waitFor(() => {
      expect(viewport.scrollTop).toBeGreaterThan(0)
    })
    expect(canvas.queryByRole('button', { name: 'Latest' })).toBeNull()
  },
}

/** Scrolled up: the thread lets go, and the pill appears with the way back. */
export const Unstuck: Story = {
  play: async ({ canvasElement }) => {
    await arrived(canvasElement)
    const canvas = within(canvasElement)
    const viewport = canvas.getByRole('log')

    await waitFor(() => {
      expect(viewport.scrollTop).toBeGreaterThan(0)
    })
    viewport.scrollTop = 0

    const pill = await canvas.findByRole('button', { name: 'Latest' })
    await waitFor(() => {
      expect(pill).toHaveStyle({ opacity: '1' })
    })

    // And pressing it puts the reader back at the last message, where the pill goes again.
    await userEvent.click(pill)
    await waitFor(() => {
      expect(canvas.queryByRole('button', { name: 'Latest' })).toBeNull()
    })
  },
}

/**
 * The whole page, as the Session will assemble it: the thread that scrolls, the rail, and the
 * composer sticky underneath it — the one part of the page that never moves.
 */
export const WholeThread: Story = {
  render: (args) => <SessionPage {...args} />,
}

/** The page the renderer will draw: the thread above, and the composer that writes into it. */
function SessionPage(props: MessageScrollerProps): ReactNode {
  const [value, setValue] = useState('')
  return (
    <>
      <MessageScroller {...props} />
      <div className="shrink-0">
        <Composer
          value={value}
          onValueChange={setValue}
          files={[]}
          onFilesChange={fn()}
          onSearchFiles={async () => await Promise.resolve([])}
          action="Send"
          placeholder="Write in this Session…"
          onSend={async () => {
            setValue('')
            return await Promise.resolve(null)
          }}
        />
      </div>
    </>
  )
}
