import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { badgesOffBaseline, keepsItsLines } from '../../components/mention-field/badge-baseline.ts'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import {
  CONVERSATION,
  HELD_COMMAND,
  LONG_COMMAND,
  LONG_CONVERSATION,
  LONG_MESSAGE,
} from './chat-fixtures.ts'
import { ChatPage, type ChatPageProps } from './chat-page.tsx'

/**
 * A Chat: a conversation with an agent about a Project, outside any mission. Its header says what
 * it talks about and with which model; the thread is the conversation, the agent's actions folded
 * under its answers; the composer at the bottom is the mention field. A call the agent wants to
 * make waits in a card over the composer, Allow once or Deny.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Chat',
  component: ChatPage,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Invoices export',
    project: { name: 'Acme' },
    checkout: '~/code/acme',
    agents: AGENTS,
    model: { agent: 'claude', model: 'sonnet' },
    items: CONVERSATION,
    turn: 'idle',
    mentionables: MENTIONABLES,
    draft: '',
    onDraft: fn(),
    onSend: fn(),
    onStop: fn(),
    onModel: fn(),
    onFavourite: fn(),
    onHide: fn(),
    onAnswer: fn(),
    onOpenMission: fn(),
    onRename: fn(),
    onRetry: fn(),
  },
  render: function Render(args: ChatPageProps) {
    const [draft, setDraft] = useState(args.draft)
    return (
      <div className="flex h-screen flex-col bg-surface-content">
        <ChatPage
          {...args}
          draft={draft}
          onDraft={(next) => {
            setDraft(next)
            args.onDraft(next)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof ChatPage>

export default meta
type Story = StoryObj<typeof meta>

/** A new Chat: nothing said yet, the focus in the composer, Send quiet in its corner. */
export const Empty: Story = {
  args: { title: 'New Chat', items: [] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Message' })).toHaveFocus())
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSend).not.toHaveBeenCalled()
  },
}

/** A conversation; the agent's actions folded under its answers, one unfolded. */
export const Conversation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fold = canvas.getByRole('button', { name: '3 actions' })
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(fold)
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expect(await canvas.findByText('web/src/pages/invoices/list.tsx')).toBeVisible()
    // A mention in a message stands on the line like a word and moves no line.
    const bubble = canvas.getByRole('button', { name: 'api/src/routes/invoices.ts' }).parentElement
    if (bubble === null) throw new Error('no bubble')
    await expect(badgesOffBaseline(bubble)).toEqual([])
    await expect(keepsItsLines(bubble)).toBe(true)
  },
}

/** Long enough to scroll: the thread scrolls under a header and a composer that stay. */
export const LongConversation: Story = { args: { items: LONG_CONVERSATION } }

/** Something typed: Send fills, Enter sends, and so does a press on Send. */
export const Typing: Story = {
  args: { draft: 'Does the PDF need the same columns as the CSV?' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const send = canvas.getByRole('button', { name: 'Send' })
    await expect(send).toBeEnabled()
    await userEvent.click(canvas.getByRole('textbox', { name: 'Message' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.onSend).toHaveBeenCalledTimes(1)
    await userEvent.click(send)
    await expect(args.onSend).toHaveBeenCalledTimes(2)
  },
}

/** The agent working: its face at the end of the thread, and Stop in the composer. */
export const Working: Story = {
  args: {
    items: [...CONVERSATION, { kind: 'message', id: 'm5', from: 'you', text: 'And the PDF?' }],
    turn: 'working',
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Claude Code is working' })).toBeVisible()
    // Send is Stop, in the same corner, while the turn runs.
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalled()
  },
}

/** A turn stopped by the user. */
export const Stopped: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'And the PDF?' },
      { kind: 'line', id: 'l1', tone: 'stopped' },
    ],
  },
}

/** The agent ended on an error: said in words. */
export const AgentError: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'And the PDF?' },
      {
        kind: 'line',
        id: 'l1',
        tone: 'error',
        text: 'The model refused the request: the conversation is longer than its context.',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/The model refused the request/)).toBeVisible()
  },
}

/** A turn that ended without a word: the thread says so. */
export const Silent: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'And the PDF?' },
      { kind: 'line', id: 'l1', tone: 'silent' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Claude Code ended its turn without a word'),
    ).toBeVisible()
  },
}

/** A start past its delay: said, with Retry. */
export const SlowStart: Story = {
  args: {
    items: [
      { kind: 'message', id: 'm1', from: 'you', text: 'How are invoices exported today?' },
      { kind: 'line', id: 'l1', tone: 'slow' },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Claude Code did not start within 30 s')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/**
 * A call held for your approval: its line in the thread, and its card over the composer — Allow
 * once or Deny, nothing for a mission since a Chat has none.
 */
export const HeldCall: Story = {
  args: {
    turn: 'working',
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'Add the PDF column to the schema.' },
      {
        kind: 'held',
        id: 'h1',
        command: HELD_COMMAND,
        reason: 'The new column needs a migration before the route can read it.',
        answer: 'waiting',
      },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('region', { name: 'Claude Code asks to run a command' })
    await expect(within(card).getByText(HELD_COMMAND)).toBeVisible()
    await expect(within(card).queryByRole('button', { name: /for this mission/ })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Allow once' }))
    await expect(args.onAnswer).toHaveBeenCalledWith('h1', 'allow')
  },
}

/** The same call, answered: one faint line in the thread, and the card is gone. */
export const HeldCallAnswered: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'Add the PDF column to the schema.' },
      {
        kind: 'held',
        id: 'h1',
        command: HELD_COMMAND,
        reason: 'The new column needs a migration before the route can read it.',
        answer: 'allowed',
      },
      {
        kind: 'message',
        id: 'm6',
        from: 'agent',
        text: 'The migration ran; the column is there.',
        actions: [{ id: 'a9', kind: 'run', label: HELD_COMMAND }],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: /asks to run a command/ })).toBeNull()
    await expect(canvas.getByText('Allowed once')).toBeVisible()
  },
}

/** A mission drafted from the Chat: its key is a link to it. */
export const MissionDrafted: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'created', id: 'c1', missionKey: 'ACME-16', title: 'Export invoices as PDF' },
    ],
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'ACME-16' }))
    await expect(args.onOpenMission).toHaveBeenCalledWith('ACME-16')
  },
}

/** The agent's draft is close to a mission that exists: it drafted none, and says which. */
export const SomethingClose: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'close', id: 'c1', missionKey: 'ACME-12', title: 'Invoices export to CSV' },
    ],
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'ACME-12' }))
    await expect(args.onOpenMission).toHaveBeenCalledWith('ACME-12')
  },
}

/** Hemera restarted during a turn: said once, where the turn was. */
export const Restarted: Story = {
  args: {
    items: [
      ...CONVERSATION,
      { kind: 'message', id: 'm5', from: 'you', text: 'And the PDF?' },
      { kind: 'line', id: 'l1', tone: 'restarted' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Hemera restarted; the agent’s turn was interrupted'),
    ).toBeVisible()
  },
}

/** The Chat's model, changed with the picker at the foot of the composer. */
export const ChangingTheModel: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', {
        name: 'Model of this Chat: Claude Code · Sonnet',
      }),
    )
    const body = within(document.body)
    await userEvent.click(await body.findByRole('option', { name: /Opus/ }))
    await expect(args.onModel).toHaveBeenCalledWith({ agent: 'claude', model: 'opus' })
  },
}

/** Renaming the Chat: a dialog with its name, Save. */
export const Renaming: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Rename this Chat' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Rename this Chat' })
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'PDF export')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await expect(args.onRename).toHaveBeenCalledWith('PDF export')
  },
}

/** Long text in every field: the title, the path, a message, a held command. */
export const LongText: Story = {
  args: {
    title:
      'Invoices export, the PDF format beside the CSV one, and what the shared money formatting has to say about it',
    project: { name: 'Acme Platform Services and Internal Tooling (monorepo, 2026)' },
    checkout: '~/code/clients/acme/platform-services-and-internal-tooling-monorepo-2026',
    turn: 'working',
    items: [
      { kind: 'message', id: 'm1', from: 'you', text: LONG_MESSAGE },
      { kind: 'message', id: 'm2', from: 'agent', text: LONG_MESSAGE },
      {
        kind: 'held',
        id: 'h1',
        command: LONG_COMMAND,
        reason: LONG_MESSAGE,
        answer: 'waiting',
      },
    ],
    draft: LONG_MESSAGE,
  },
}

/** Reduced motion: the folds and the card appear without moving. */
export const ReducedMotion: Story = {
  render: function Render(args: ChatPageProps) {
    return (
      <MotionConfig reducedMotion="always">
        <div className="flex h-screen flex-col bg-surface-content">
          <ChatPage {...args} />
        </div>
      </MotionConfig>
    )
  },
}
