/** A Project's Chats and one Chat as the window follows them: read, then read again on a change. */

import { StorageFailed, type ChatChanged, type ChatLine, type ChatSummary } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import { followChat, followChats, type ChatState, type ChatsState } from '../src/renderer/chats.ts'
import type { Link } from '../src/renderer/link.ts'

const summary = (id: string, title: string, working = false): ChatSummary => ({
  id,
  projectId: 'acme',
  title,
  setting: { agent: 'claude', model: null, effort: null },
  createdAt: '2026-10-06T16:00:00.000Z',
  lastActivityAt: '2026-10-06T16:00:00.000Z',
  working,
})

const said = (sequence: number, text: string): ChatLine => ({
  sequence,
  kind: 'agent',
  text,
  tool: null,
  outcome: null,
  request: null,
  held: null,
  at: '2026-10-06T16:00:00.000Z',
})

/** A link whose engine answers at once with what the test holds now. */
function scripted() {
  const held = { chats: [summary('invoices', 'Invoices export')], lines: [said(1, 'Hello.')] }
  const listeners = new Set<(change: ChatChanged) => void>()
  const asked: string[] = []
  let failing = false
  const link: Pick<Link, 'chats' | 'transcript' | 'onChatChanges'> = {
    chats: (projectId) => {
      asked.push(`chats.list ${projectId}`)
      return failing
        ? Promise.reject(new StorageFailed({ sentence: 'The data folder is not readable.' }))
        : Promise.resolve(held.chats)
    },
    transcript: (chatId) => {
      asked.push(`chats.transcript ${chatId}`)
      return Promise.resolve({ entries: held.lines, before: null })
    },
    onChatChanges: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    link,
    held,
    asked,
    fail: () => {
      failing = true
    },
    listening: () => listeners.size,
    change: (change: ChatChanged) => {
      for (const listener of listeners) listener(change)
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('A Project’s Chats', () => {
  test('are read once, then again on a change of that Project’s, not of another’s', async () => {
    const engine = scripted()
    const states: ChatsState[] = []
    const following = followChats(engine.link, 'acme', (state) => states.push(state))
    await settle()
    expect(states.at(-1)).toEqual({ kind: 'ready', chats: engine.held.chats })
    engine.held.chats = [...engine.held.chats, summary('release', 'Release notes for 2.4')]
    engine.change({ chatId: 'release', projectId: 'acme' })
    await settle()
    expect(states.at(-1)).toEqual({ kind: 'ready', chats: engine.held.chats })
    engine.change({ chatId: 'other', projectId: 'hemera' })
    await settle()
    expect(engine.asked).toEqual(['chats.list acme', 'chats.list acme'])
    following.stop()
    expect(engine.listening()).toBe(0)
  })

  test('that cannot be read are said in the engine’s words', async () => {
    const engine = scripted()
    engine.fail()
    const states: ChatsState[] = []
    followChats(engine.link, 'acme', (state) => states.push(state))
    await settle()
    expect(states.at(-1)).toEqual({ kind: 'failed', sentence: 'The data folder is not readable.' })
  })
})

describe('One Chat', () => {
  test('is its summary and its transcript, read again on its own changes only', async () => {
    const engine = scripted()
    const states: ChatState[] = []
    followChat(engine.link, 'acme', 'invoices', (state) => states.push(state))
    await settle()
    expect(states.at(-1)).toEqual({
      kind: 'ready',
      chat: engine.held.chats[0],
      lines: engine.held.lines,
    })
    engine.held.chats = [summary('invoices', 'Invoices export', true)]
    engine.change({ chatId: 'invoices', projectId: 'acme' })
    await settle()
    expect(states.at(-1)).toMatchObject({ kind: 'ready', chat: { working: true } })
    engine.change({ chatId: 'release', projectId: 'acme' })
    await settle()
    expect(engine.asked.filter((one) => one.startsWith('chats.transcript'))).toHaveLength(2)
  })

  test('a Chat no longer listed is said to be gone', async () => {
    const engine = scripted()
    const states: ChatState[] = []
    followChat(engine.link, 'acme', 'elsewhere', (state) => states.push(state))
    await settle()
    expect(states.at(-1)).toEqual({ kind: 'failed', sentence: 'This Chat no longer exists.' })
  })
})
