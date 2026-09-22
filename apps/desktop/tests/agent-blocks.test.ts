/**
 * The three kinds this lot adds to the thread, and what they read off their payload (design
 * D5-11, D6-06, D6-12).
 *
 * `agent-blocks.tsx` draws these with `@hemera/ui`'s components, which read the theme at module
 * scope and so need a real browser to import — this suite has none. What it checks instead is
 * `agent-tool-payloads.ts`, the pure module `agent-blocks.tsx` spreads onto each block: given an
 * entry, does it read the shape the block needs, or leave it out when the payload does not
 * parse.
 */

import { describe, expect, test } from 'vite-plus/test'

import type { SessionEntry } from '@hemera/ipc'

import { commandRunOf, contextDeliveryOf, hemeraToolCallOf } from '#renderer/agent-tool-payloads.ts'

/** A thread entry with every field but `kind`, `role`, `body` and `payload` held to a fixed default. */
function entryOf(
  kind: SessionEntry['kind'],
  role: SessionEntry['role'],
  body: string,
  payload: string,
): SessionEntry {
  return {
    id: 'entry-1',
    sessionId: 'session-1',
    seq: 1,
    role,
    kind,
    body,
    payload,
    correlationId: null,
    turnId: null,
    state: null,
    origin: 'live',
    createdAt: 0,
  }
}

describe('A read inside the Workspace goes through on its own', () => {
  test('a hemera_tool_call entry draws the tool name and the summary', () => {
    const entry = entryOf(
      'hemera_tool_call',
      'agent',
      'Read 42 lines of src/index.ts',
      JSON.stringify({
        tool: 'fs_read',
        state: 'completed',
        caller: 'a1b2c3d4e5f6',
        paths: ['src/index.ts'],
        arguments: JSON.stringify({ path: 'src/index.ts' }),
      }),
    )
    const drawn = hemeraToolCallOf(entry)
    expect(drawn?.tool).toBe('fs_read')
    expect(drawn?.summary).toBe('Read 42 lines of src/index.ts')
    expect(drawn?.status).toBe('completed')
    expect(drawn?.arguments).toEqual([{ label: 'path', value: 'src/index.ts' }])
    expect(drawn?.provenance).toEqual({
      session: 'session-1',
      agent: 'agent',
      token: 'a1b2c3d4e5f6',
    })
  })

  test('arguments the bound cut short than no longer parse draw as the raw text', () => {
    const entry = entryOf(
      'hemera_tool_call',
      'agent',
      'Wrote src/index.ts',
      JSON.stringify({
        tool: 'fs_write',
        state: 'completed',
        caller: 'a1b2c3d4e5f6',
        paths: ['src/index.ts'],
        arguments: '{"path":"src/index.ts","content":"trunc',
      }),
    )
    const drawn = hemeraToolCallOf(entry)
    expect(drawn?.arguments).toEqual([
      { label: 'arguments', value: '{"path":"src/index.ts","content":"trunc' },
    ])
  })

  test('a hemera_tool_call entry whose payload does not parse is left out', () => {
    const entry = entryOf('hemera_tool_call', 'agent', 'Read a file', '{"tool":"fs_read"}')
    expect(hemeraToolCallOf(entry)).toBeNull()
  })
})

describe('A one-off command shows and is not promoted', () => {
  test('a command_run entry draws the name and exit code', () => {
    const entry = entryOf(
      'command_run',
      'hemera',
      'pnpm dev',
      JSON.stringify({
        name: 'pnpm dev',
        line: 'pnpm dev',
        kind: 'app',
        state: 'exited',
        cwd: '.',
        url: null,
        exitCode: 0,
        oneOff: true,
      }),
    )
    const drawn = commandRunOf(entry)
    expect(drawn?.name).toBe('pnpm dev')
    expect(drawn?.exitCode).toBe(0)
    expect(drawn?.oneOff).toBe(true)
    // `exited` is what the engine writes; `finished` is the word the block reads it as.
    expect(drawn?.state).toBe('finished')
  })
})

describe('A delivery shows in the timeline', () => {
  test('a context_delivery entry draws the sentence and the short fingerprint', () => {
    const entry = entryOf(
      'context_delivery',
      'hemera',
      'Hemera gave the agent AGENTS.md.',
      JSON.stringify({
        kind: 'native',
        path: 'AGENTS.md',
        fingerprint: 'a'.repeat(64),
        deliveredAt: '2026-09-22T10:00:00.000Z',
      }),
    )
    const drawn = contextDeliveryOf(entry)
    expect(drawn?.body).toBe(`Hemera gave the agent AGENTS.md. (${'a'.repeat(12)})`)
  })
})
