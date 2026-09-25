import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Composer } from '../composer/composer.tsx'
import { IconButton } from '../components/button/button.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { IconChevronRight, IconFileDescription } from '../icons.ts'
import { MessageText } from '../message/message-text.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import { MissionPanel } from './mission-panel.tsx'
import { type ChatState, SessionLayout } from './session-layout.tsx'
import { SessionHeader } from './session.tsx'

/**
 * The page of a Session (lot 5c, issue #115): the head across the top with the chat's own control
 * at its right end, the chat at the centre, and the mission panel beside it.
 *
 * What this file is about is the layout and nothing else, so the panel here is a plain one: the
 * Spec's own surface story draws it as a `define` Session has it. Two things are worth looking at.
 * The chat is laid at what the panel leaves it and is *covered* when it is minimised, never
 * squashed, so its text does not reflow on the way and never has to be found again. And the
 * control — one round button where the Session's `…` menu stood — wears the chat's state in a ring:
 * it turns while the agent works, breathes while it waits for the hand, and holds still when the
 * state has settled.
 */

const THREAD: ScrollerEntry[] = [
  {
    id: 'said-1',
    mark: 'the invoices',
    content: (
      <MessageText body="Lay the January invoices out for the accountants, the way they asked." />
    ),
  },
  {
    id: 'said-2',
    content: (
      <MessageText body="I will: the ledger first, then the two columns they keep asking about." />
    ),
  },
]

/** The head these stories wear: a Session of the atlas Project, whatever state the chat is in. */
function headOf(): ReactNode {
  return (
    <SessionHeader
      title="Invoices for the accountants"
      projectName="Atlas"
      meta="DEFINE · Claude Code · Sonnet 5"
      onRename={fn()}
      onStartEditing={fn()}
    />
  )
}

/** The chat of these stories: a short thread and the box, at whatever width the layout gives it. */
function Chat(): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  return (
    <>
      <MessageScroller label="The thread of this Session" entries={THREAD} className="flex-1" />
      <div className="flex w-full flex-col px-6 pb-4">
        <Composer
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSearchFiles={() => Promise.resolve([])}
          variant="inline"
          action="Send"
          placeholder="Say something to the agent…"
          onSend={() => Promise.resolve(null)}
          running
          onStop={fn()}
        />
      </div>
    </>
  )
}

/** The mission's panel: a band that folds, and a stage the mission itself would fill. */
function Panel({ page }: { page: boolean }): ReactNode {
  return (
    <MissionPanel
      label="Spec ATL-7"
      noun="Spec"
      page={page}
      width="wide"
      defaultFolded={false}
      head={(fold) => (
        <header className="flex items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="text-sm font-medium text-foreground">Spec</h2>
          {page ? null : (
            <span className="ml-auto flex">
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconChevronRight size="sm" />}
                aria-label="Fold the Spec"
                data-fold
                onClick={fold}
              />
            </span>
          )}
        </header>
      )}
      rail={null}
      band={
        <div className="flex flex-col items-center gap-3 pt-3 text-muted-foreground">
          <IconFileDescription size="md" aria-hidden="true" />
        </div>
      }
      stage={
        <div className="flex flex-col gap-2 p-4 text-sm text-muted-foreground">
          <p>The tasks the Spec asks for, one stage at a time.</p>
          <p>None of this is the layout's: the panel is the mission's own.</p>
        </div>
      }
    />
  )
}

interface ScreenProps {
  /** What the chat's control says the chat is doing. */
  state?: ChatState | undefined
  /** What waits, in a few words, in place of the state's own. */
  words?: string | undefined
  /** The first line of it, in the control's tooltip. */
  detail?: string | undefined
  /** Whether the Session has a mission panel at all: a `free` Session has none. */
  panel?: boolean | undefined
  /** Whether the chat starts open, which is where every mission but a build starts. */
  open?: boolean | undefined
}

/** One Session: the head, the chat, and the panel when the mission has one. */
function Screen({
  state = 'idle',
  words,
  detail,
  panel = true,
  open = true,
}: ScreenProps): ReactNode {
  const [chatOpen, setChatOpen] = useState(open)
  return (
    <TooltipProvider>
      <div className="h-screen">
        <SessionLayout
          head={headOf()}
          chat={<Chat />}
          {...(panel ? { panel: (page: boolean) => <Panel page={page} /> } : {})}
          chatOpen={chatOpen}
          onChatOpenChange={setChatOpen}
          chatState={state}
          chatWords={words}
          chatDetail={detail}
        />
      </div>
    </TooltipProvider>
  )
}

/** The width of what a region or a thread is called, which only a browser can answer. */
function widthOf(canvasElement: HTMLElement, name: string): number {
  return within(canvasElement).getByLabelText(name).getBoundingClientRect().width
}

/** The row the chat and the panel share, which is what "the whole page" is measured against. */
function rowOf(canvasElement: HTMLElement): HTMLElement {
  const box = canvasElement.querySelector('[data-chat]')
  if (box?.parentElement == null) throw new Error('the chat is not in a row')
  return box.parentElement
}

const meta = {
  title: 'Surfaces/Session/Layout',
  component: SessionLayout,
  parameters: { layout: 'fullscreen' },
  // Created by lot 5c (issue #115), which is what this badge says: the first thing a lot that
  // touches the design system does is take the previous lot's badges off.
  tags: ['autodocs', 'new'],
  // Every story here draws its own Session, the chat and the panel together being the point: the
  // two props the layout cannot do without are given a value and never read.
  args: { head: null, chat: null },
} satisfies Meta<typeof SessionLayout>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Everything in place: the chat at the centre with the agent working in it, the mission panel on
 * its right, and the control at the head's right end wearing the state of the chat.
 */
export const Complete: Story = {
  render: () => <Screen state="working" words="T2 · the column order" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The chat is the larger part of the row, and the panel takes the share beside it.
    await expect(widthOf(canvasElement, 'The thread of this Session')).toBeGreaterThan(
      widthOf(canvasElement, 'Spec ATL-7'),
    )
    await expect(
      canvas.getByRole('heading', { name: 'Invoices for the accountants' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Minimise the chat' })).toBeVisible()
  },
}

/** A `free` Session: the chat alone, the whole row, and nothing that could minimise it. */
export const Free: Story = {
  render: () => <Screen panel={false} state="working" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('log', { name: 'The thread of this Session' })).toBeVisible()
    await expect(canvasElement.querySelector('[data-chat-control]')).toBeNull()
  },
}

/**
 * The chat minimised: the panel is the page over it, and the control says what waits for the hand
 * in the chat it stands for.
 */
export const Minimised: Story = {
  render: () => <Screen open={false} state="working" words="T2 · the column order" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('log', { name: 'The thread of this Session' })).toBeNull()
    await expect(widthOf(canvasElement, 'Spec ATL-7')).toBeGreaterThan(
      rowOf(canvasElement).getBoundingClientRect().width * 0.95,
    )
    const control = canvas.getByRole('button', { name: 'Open the chat · T2 · the column order' })
    await expect(control).toBeVisible()
    await expect(control.parentElement?.querySelector('[data-ring]')).not.toBeNull()
  },
}

/**
 * The chat brought back: it is uncovered at exactly the width it was covered at, so not one line of
 * it moved — the whole point of covering it instead of squashing it.
 */
export const Back: Story = {
  render: () => <Screen open={false} state="working" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Open the chat/ }))
    await expect(canvas.getByRole('log', { name: 'The thread of this Session' })).toBeVisible()
    const back = widthOf(canvasElement, 'The thread of this Session')
    await userEvent.click(canvas.getByRole('button', { name: 'Minimise the chat' }))
    await expect(canvas.queryByRole('log', { name: 'The thread of this Session' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^Open the chat/ }))
    await expect(canvas.getByRole('log', { name: 'The thread of this Session' })).toBeVisible()
    await expect(widthOf(canvasElement, 'The thread of this Session')).toBe(back)
  },
}

/** The agent waiting for an answer: the one state whose ring breathes rather than turns. */
export const Waiting: Story = {
  render: () => <Screen state="waiting" detail="Approve the export, or say what to change" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const control = canvas.getByRole('button', { name: 'Minimise the chat' })
    await expect(control.parentElement).toHaveAttribute('data-state', 'waiting')
    await expect(control.parentElement?.querySelector('[data-ring="waiting"]')).not.toBeNull()
  },
}

/**
 * The keyboard: covering the chat sends it to the control that covered it, and bringing the chat
 * back sends it where it was — into the box of a chat that is on screen again.
 */
export const Keyboard: Story = {
  render: () => <Screen state="working" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = canvas.getByRole('textbox')
    await userEvent.click(box)
    await expect(box).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Minimise the chat' }))
    await expect(canvas.getByRole('button', { name: /^Open the chat/ })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: /^Open the chat/ }))
    await expect(canvas.getByRole('textbox')).toHaveFocus()
  },
}
