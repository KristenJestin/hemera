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

import {
  commandRunOf,
  contextDeliveryOf,
  foldedCallsOf,
  hemeraToolCallOf,
  hemeraToolNamed,
} from '#renderer/agent-tool-payloads.ts'

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

describe('The agent starts the app and the user opens it', () => {
  test('a command_run entry draws the address and the output its run pushed since', () => {
    const entry = entryOf(
      'command_run',
      'hemera',
      'dev',
      JSON.stringify({
        runId: 'run-1',
        name: 'dev',
        line: 'pnpm dev',
        kind: 'app',
        state: 'running',
        cwd: '/home/ana/atlas',
        url: null,
        exitCode: null,
        oneOff: false,
      }),
    )
    const pushed = {
      id: 'run-1',
      projectId: 'atlas',
      sessionId: 'session-1',
      commandId: 'command-1',
      name: 'dev',
      line: 'pnpm dev',
      kind: 'app' as const,
      cwd: '/home/ana/atlas',
      state: 'running' as const,
      pid: 4242,
      url: 'http://localhost:5173',
      exitCode: null,
      output: 'ready on http://localhost:5173\n',
      dropped: 0,
      startedAt: '2026-09-23T08:00:00.000Z',
      endedAt: null,
      joined: false,
    }

    // Before the window heard of the run, the entry alone: running, no address yet.
    expect(commandRunOf(entry)).toMatchObject({ runId: 'run-1', url: undefined, output: '' })
    // Once it has, the address and what it printed are the run's.
    expect(commandRunOf(entry, [pushed])).toMatchObject({
      runId: 'run-1',
      state: 'running',
      url: 'http://localhost:5173',
      output: 'ready on http://localhost:5173\n',
    })
    // And a run of another entry is not this one's.
    expect(commandRunOf(entry, [{ ...pushed, id: 'run-2' }])?.url).toBeUndefined()
  })
})

describe('A Hemera tool call is drawn once', () => {
  /** The agent's own report of a call, as the runtime stores it under `tool_call`. */
  const reported = (id: string, title: string, status: string): SessionEntry => ({
    ...entryOf(
      'tool_call',
      'agent',
      title,
      JSON.stringify({
        call: {
          title,
          kind: 'other',
          status,
          locations: [],
          content: [],
          rawInput: null,
          rawOutput: null,
        },
      }),
    ),
    id,
  })
  /** The entry Hemera writes for one of its calls once it has answered it. */
  const answered = (id: string, tool: string): SessionEntry => ({
    ...entryOf(
      'hemera_tool_call',
      'agent',
      'read notes.md',
      JSON.stringify({
        tool,
        state: 'completed',
        caller: 'acf1119ed715',
        paths: [],
        arguments: '{}',
      }),
    ),
    id,
  })

  test("the agent's report of it is recognised under each agent's prefix", () => {
    expect(hemeraToolNamed('hemera_fs_read')).toBe('fs_read')
    expect(hemeraToolNamed('mcp__hemera__commands_run')).toBe('commands_run')
    expect(hemeraToolNamed('search')).toBe('search')
    // A native call is not one of Hemera's, whatever it is called.
    expect(hemeraToolNamed('Read')).toBeNull()
    expect(hemeraToolNamed('mcp__github__search_code')).toBeNull()
  })

  test("Hemera's block is drawn where the agent reported the call, and not a second time", () => {
    // The OpenCode trial of 23 September 2026: the agent's `hemera_fs_read`, then Hemera's entry.
    const thread = [reported('native', 'hemera_fs_read', 'completed'), answered('own', 'fs_read')]
    const folded = foldedCallsOf(thread)

    expect(folded.hidden).toEqual(new Set(['own']))
    expect(folded.inPlaceOf.get('native')?.id).toBe('own')
    // Both stay in the thread: only the drawing is folded.
    expect(thread).toHaveLength(2)
  })

  test('while Hemera has not answered, the report stands on its own, in the state it reports', () => {
    const folded = foldedCallsOf([reported('native', 'hemera_fs_read', 'in_progress')])

    expect(folded.hidden.size).toBe(0)
    expect(folded.inPlaceOf.has('native')).toBe(false)
  })

  test('two calls of one tool pair in order, and a native call is left alone', () => {
    const thread = [
      reported('n1', 'hemera_fs_read', 'completed'),
      reported('shell', 'bash', 'completed'),
      answered('h1', 'fs_read'),
      reported('n2', 'hemera_fs_read', 'completed'),
      answered('h2', 'fs_read'),
    ]
    const folded = foldedCallsOf(thread)

    expect([...folded.inPlaceOf].map(([at, own]) => [at, own.id])).toEqual([
      ['n1', 'h1'],
      ['n2', 'h2'],
    ])
    expect(folded.inPlaceOf.has('shell')).toBe(false)
  })
})
