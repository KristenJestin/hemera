/** A Chat's transcript as the page draws it (#52): messages, folded actions, held calls, lines. */

import { CHAT_INTERRUPTED, CHAT_STOPPED, draftNotice } from '@hemera/core/domain'
import type { AgentState, ChatLine } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  chatItemsOf,
  mentionsIn,
  pickerAgentsOf,
  settingOfChoice,
} from '../src/renderer/chat-items.ts'

let sequence = 0
const line = (kind: ChatLine['kind'], text: string, more: Partial<ChatLine> = {}): ChatLine => {
  sequence += 1
  return {
    sequence,
    kind,
    text,
    tool: null,
    outcome: null,
    request: null,
    held: null,
    at: '2026-10-06T16:00:00.000Z',
    ...more,
  }
}

describe('The thread of a Chat', () => {
  test('the messages in order; the actions folded under the answer that follows them', () => {
    const items = chatItemsOf(
      [
        line('user', 'Where are the invoices exported?'),
        line('action', 'Search · csv', { tool: 'search', outcome: 'completed' }),
        line('action', 'Read file · api/export.ts', { tool: 'fs_read', outcome: 'completed' }),
        line('action', 'Run command · pnpm test', { tool: 'commands_run', outcome: 'failed' }),
        line('agent', 'In `api/export.ts`.'),
      ],
      false,
    )
    expect(items).toMatchObject([
      { kind: 'message', from: 'you', text: 'Where are the invoices exported?' },
      {
        kind: 'message',
        from: 'agent',
        text: 'In `api/export.ts`.',
        actions: [
          { kind: 'search', label: 'csv' },
          { kind: 'read', label: 'api/export.ts' },
          { kind: 'run', label: 'pnpm test', failed: true },
        ],
      },
    ])
  })

  test('a turn that ended with actions and no words is a silent turn; one still running is not', () => {
    const lines = [
      line('user', 'Fix the export.'),
      line('action', 'Edit file · api/export.ts', { tool: 'fs_edit', outcome: 'completed' }),
    ]
    expect(chatItemsOf(lines, false).at(-1)).toMatchObject({ kind: 'line', tone: 'silent' })
    expect(chatItemsOf(lines, true).map((item) => item.kind)).toEqual(['message'])
  })

  test('a held call is its own item, with its command, the agent’s reason and the answer', () => {
    const items = chatItemsOf(
      [
        line('user', 'Read the .env file.'),
        line('action', 'Read file · .env', {
          tool: 'fs_read',
          outcome: 'held',
          request: 1,
          held: {
            needId: 'need-1',
            command: 'Read .env',
            reason: 'The user asked for it.',
            answer: 'waiting',
          },
        }),
        line('agent', 'It waits for your approval.'),
      ],
      false,
    )
    expect(items[1]).toEqual({
      kind: 'held',
      id: 'need-1',
      command: 'Read .env',
      reason: 'The user asked for it.',
      answer: 'waiting',
    })
  })

  test('Hemera’s lines: stopped, restarted, a mission drafted, anything else said as it is', () => {
    const items = chatItemsOf(
      [
        line('notice', CHAT_STOPPED),
        line('notice', CHAT_INTERRUPTED),
        line('notice', draftNotice('ACME-16', 'Export the invoices as JSON')),
        line('notice', 'The agent could not start: Claude Code is not signed in.'),
      ],
      false,
    )
    expect(items).toMatchObject([
      { kind: 'line', tone: 'stopped' },
      { kind: 'line', tone: 'restarted' },
      { kind: 'created', missionKey: 'ACME-16', title: 'Export the invoices as JSON' },
      {
        kind: 'line',
        tone: 'error',
        text: 'The agent could not start: Claude Code is not signed in.',
      },
    ])
  })
})

describe('The mentions of a message', () => {
  const MENTIONABLES = [
    { kind: 'file', id: 'api/export.ts', label: 'api/export.ts' },
    { kind: 'mission', id: 'ACME-12', label: 'ACME-12', detail: 'Export the invoices as CSV' },
    { kind: 'command', id: 'cmd-1', label: 'api: test', detail: 'pnpm test' },
  ] as const

  test('are what the field wrote after `@`, each once, as the engine names them', () => {
    expect(
      mentionsIn(
        'Compare @api/export.ts with @ACME-12, then run @api: test. Again @api/export.ts.',
        MENTIONABLES,
      ),
    ).toEqual([
      { kind: 'file', ref: 'api/export.ts' },
      { kind: 'mission', ref: 'ACME-12' },
      { kind: 'command', ref: 'cmd-1' },
    ])
  })

  test('a label is a mention only where it ends: before a space, a punctuation mark or the end', () => {
    const offered = [
      { kind: 'mission', id: 'ACME-1', label: 'ACME-1', detail: 'Import the invoices' },
      { kind: 'command', id: 'cmd-2', label: 'test', detail: 'pnpm test' },
    ] as const
    expect(mentionsIn('Look at @ACME-12 and run @test:e2e.', offered)).toEqual([])
    expect(mentionsIn('After @ACME-1, run @test.', offered)).toEqual([
      { kind: 'mission', ref: 'ACME-1' },
      { kind: 'command', ref: 'cmd-2' },
    ])
    expect(mentionsIn('Run @test', offered)).toEqual([{ kind: 'command', ref: 'cmd-2' }])
  })

  test('an `@` that names nothing the field offered is text', () => {
    expect(mentionsIn('Write to someone@example.invalid about @nothing.', MENTIONABLES)).toEqual([])
  })
})

describe('The agents the Chat’s model picker offers', () => {
  const agent = (id: AgentState['id'], label: string, installed: boolean, signedIn: boolean) =>
    ({ id, label, installed, signedIn }) as const

  test('the installed ones, each with its own default first, the models marked and the Chat’s own', () => {
    const agents = pickerAgentsOf(
      [
        agent('claude', 'Claude Code', true, true),
        agent('codex', 'Codex', true, false),
        agent('opencode', 'OpenCode', false, false),
      ],
      [{ agent: 'claude', model: 'large', favourite: true, hidden: false }],
      { agent: 'claude', model: 'small', effort: null },
    )
    expect(agents).toEqual([
      {
        id: 'claude',
        name: 'Claude Code',
        models: [
          { id: 'default', name: 'Its default model' },
          { id: 'large', name: 'large', favourite: true, hidden: false },
          { id: 'small', name: 'small', favourite: undefined, hidden: undefined },
        ],
        unavailable: undefined,
      },
      {
        id: 'codex',
        name: 'Codex',
        models: [{ id: 'default', name: 'Its default model' }],
        unavailable: 'Codex is not signed in',
      },
    ])
  })
})

describe('A model chosen in the picker', () => {
  test('an agent’s own default is no model named; another is its name', () => {
    expect(settingOfChoice('claude', { agent: 'claude', model: 'default' })).toEqual({
      agent: 'claude',
      model: null,
      effort: null,
    })
    expect(settingOfChoice('codex', { agent: 'codex', model: 'large', effort: 'high' })).toEqual({
      agent: 'codex',
      model: 'large',
      effort: 'high',
    })
  })
})
