/**
 * The tool calls of a turn, folded into one group between two things the agent said (recette of
 * 26 September 2026, issue #149).
 *
 * The page draws the group with `@hemera/ui`'s `ActionGroup`, which needs a browser and is proved
 * in Storybook; what is tested here is `action-groups.ts`, which decides what goes in a group and
 * what its line says.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { SessionEntry } from '@hemera/ipc'
import { type Grouping, groupActions, groupingOf, summaryOf } from '#renderer/action-groups.ts'

function entryOf(kind: SessionEntry['kind'], payload: string, id: string = kind): SessionEntry {
  return {
    id,
    sessionId: 'session-1',
    seq: 1,
    role: 'agent',
    kind,
    body: '',
    payload,
    correlationId: null,
    turnId: null,
    state: null,
    origin: 'live',
    createdAt: 0,
  }
}

/** The agent's report of a call, as the runtime stores it. */
function call(kind: string | null, status = 'completed', title = 'Read a file'): string {
  return JSON.stringify({ call: { title, kind, status, locations: [], content: [] } })
}

const READ: Grouping = { kind: 'read', status: 'completed' }
const RUN: Grouping = { kind: 'execute', status: 'completed' }

describe('Tool calls between two agent texts are one folded group', () => {
  test('every run of two calls or more between two texts is one group, whatever the tools', () => {
    const pieces = groupActions([
      { item: 'text-1', grouping: null },
      { item: 'read-1', grouping: READ },
      { item: 'read-2', grouping: READ },
      { item: 'hemera', grouping: { kind: 'hemera', status: 'completed' } },
      { item: 'run', grouping: RUN },
      { item: 'text-2', grouping: null },
    ])
    expect(pieces).toEqual([
      { kind: 'one', item: 'text-1' },
      {
        kind: 'group',
        items: ['read-1', 'read-2', 'hemera', 'run'],
        count: 4,
        summary: 'read 2 files, 1 Hemera call, ran 1 command',
        status: 'completed',
      },
      { kind: 'one', item: 'text-2' },
    ])
  })

  test('a thought or a diff between two calls stays in the group, uncounted', () => {
    const pieces = groupActions([
      { item: 'read-1', grouping: READ },
      { item: 'thought', grouping: 'companion' },
      { item: 'read-2', grouping: READ },
    ])
    expect(pieces).toEqual([
      {
        kind: 'group',
        items: ['read-1', 'thought', 'read-2'],
        count: 2,
        summary: 'read 2 files',
        status: 'completed',
      },
    ])
  })

  test('a thought before the first call and a diff after the last stay outside the group', () => {
    const pieces = groupActions([
      { item: 'thought', grouping: 'companion' },
      { item: 'read-1', grouping: READ },
      { item: 'read-2', grouping: READ },
      { item: 'diff', grouping: 'companion' },
    ])
    expect(pieces.map((one) => one.kind)).toEqual(['one', 'group', 'one'])
  })

  test('a single call stays its own row, and anything that is not a call ends the run', () => {
    expect(
      groupActions([
        { item: 'read-1', grouping: READ },
        { item: 'question', grouping: null },
        { item: 'read-2', grouping: READ },
      ]),
    ).toEqual([
      { kind: 'one', item: 'read-1' },
      { kind: 'one', item: 'question' },
      { kind: 'one', item: 'read-2' },
    ])
  })

  test('the group runs while a call runs, and says a failure while folded', () => {
    const running = groupActions([
      { item: 'a', grouping: READ },
      { item: 'b', grouping: { kind: 'execute', status: 'in_progress' } },
    ])
    expect(running[0]).toMatchObject({ kind: 'group', status: 'in_progress' })
    const failed = groupActions([
      { item: 'a', grouping: { kind: 'execute', status: 'failed' } },
      { item: 'b', grouping: READ },
    ])
    expect(failed[0]).toMatchObject({ kind: 'group', status: 'failed' })
  })

  test('the line counts the kinds as they first came, in words', () => {
    expect(
      summaryOf([
        { kind: 'read', status: 'completed' },
        { kind: 'search', status: 'completed' },
        { kind: 'read', status: 'completed' },
        { kind: 'search', status: 'completed' },
        { kind: 'edit', status: 'completed' },
        { kind: 'other', status: 'completed' },
      ]),
    ).toBe('read 2 files, searched 2 times, edited 1 file, 1 other call')
  })
})

describe('What an entry is to a run of calls', () => {
  test('an agent call is counted by its kind, and an unknown kind as another call', () => {
    expect(groupingOf(entryOf('tool_call', call('read')))).toEqual(READ)
    expect(groupingOf(entryOf('tool_call', call('execute', 'in_progress')))).toEqual({
      kind: 'execute',
      status: 'in_progress',
    })
    expect(groupingOf(entryOf('tool_call', call('telepathy')))).toEqual({
      kind: 'other',
      status: 'completed',
    })
  })

  test('a call to one of Hemera’s tools is counted as Hemera’s, reported or answered', () => {
    expect(groupingOf(entryOf('tool_call', call(null, 'pending', 'spec_write')))).toEqual({
      kind: 'hemera',
      status: 'in_progress',
    })
    const answered = entryOf(
      'hemera_tool_call',
      JSON.stringify({
        tool: 'spec_write',
        state: 'refused',
        caller: 'agent',
        paths: [],
        arguments: '{}',
      }),
    )
    expect(groupingOf(answered)).toEqual({ kind: 'hemera', status: 'failed' })
  })

  test('a thought and a diff go with the calls; the agent’s text and the rest end the run', () => {
    expect(groupingOf(entryOf('thought', ''))).toBe('companion')
    expect(groupingOf(entryOf('diff', '[]'))).toBe('companion')
    expect(groupingOf(entryOf('message', ''))).toBe(null)
    expect(groupingOf(entryOf('permission_request', '{}'))).toBe(null)
    expect(groupingOf(entryOf('tool_call', '{'))).toBe(null)
  })
})
