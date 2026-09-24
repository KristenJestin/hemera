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

import { hemeraToolNamed } from '@hemera/core'
import type { SessionEntry } from '@hemera/ipc'

import {
  commandProposalOf,
  commandRunOf,
  contextDeliveryOf,
  elsewhereOf,
  foldedCallsOf,
  hemeraPermissionOf,
  hemeraToolCallOf,
  nativeSubjectOf,
  questionOpen,
  subjectOf,
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
    // The provenance is the entry's and the Journal's: nothing of it is drawn (recette 4).
    expect(drawn).not.toHaveProperty('provenance')
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
        type: 'serve',
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

describe('A proposal enters the catalogue only when accepted', () => {
  /** A proposal entry as `commands_propose` writes it, and as a decision writes it again. */
  const proposal = (state: string, folder: string | null) =>
    entryOf(
      'command_proposal',
      'hemera',
      'seed',
      JSON.stringify({
        proposalId: 'proposal-1',
        name: 'seed',
        line: 'node scripts/seed.js',
        type: 'script',
        folder,
        why: 'the seed is run before every test',
        state,
      }),
    )

  test('a proposal entry is read with its outcome', () => {
    expect(commandProposalOf(proposal('pending', null))).toEqual({
      proposalId: 'proposal-1',
      name: 'seed',
      line: 'node scripts/seed.js',
      type: 'script',
      // The Workspace root, in the word the block reads it in.
      folder: '.',
      why: 'the seed is run before every test',
      state: 'pending',
    })
    expect(commandProposalOf(proposal('accepted', './sources/api'))?.state).toBe('accepted')
    expect(commandProposalOf(proposal('accepted', './sources/api'))?.folder).toBe('./sources/api')
    expect(commandProposalOf(proposal('declined', null))?.state).toBe('declined')
  })

  test('an entry that does not parse is left out', () => {
    expect(commandProposalOf(proposal('withdrawn', null))).toBeNull()
    expect(commandProposalOf(entryOf('command_proposal', 'hemera', 'seed', '{'))).toBeNull()
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
        type: 'serve',
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
      type: 'serve' as const,
      scope: 'workspace' as const,
      cwd: '/home/ana/atlas',
      folder: null,
      workspaceId: null,
      workspaceName: 'main',
      environment: {},
      state: 'running' as const,
      pid: 4242,
      url: 'http://localhost:5173',
      readyAt: null,
      readiness: 'starting' as const,
      portConflict: null,
      heldAgainst: [],
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

    // A Project-scoped service runs in `main` whichever Session asked for it (D8-07): the block
    // of a Session in another Workspace names `main`, and a Session in `main` names nothing.
    expect(elsewhereOf(pushed, 'login-form')).toBe('main')
    expect(elsewhereOf(pushed, 'main')).toBeUndefined()
    // Nor while the Session's own Workspace is not known yet.
    expect(elsewhereOf(pushed, undefined)).toBeUndefined()
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

  /** A report as the runtime correlates it, with what the agent said it sent. */
  const reportedAs = (id: string, callId: string, sent: Record<string, string>): SessionEntry => {
    const base = reported(id, 'mcp__hemera__fs_write', 'completed')
    const read = JSON.parse(base.payload)
    const rawInput = { text: JSON.stringify(sent), truncated: false, length: 0 }
    return {
      ...base,
      correlationId: `call:${callId}`,
      payload: JSON.stringify({ call: { ...read.call, rawInput } }),
    }
  }
  /** Hemera's entry of one call, naming the call as the request did. */
  const answeredAs = (id: string, names: { callId?: string; key?: string }): SessionEntry => {
    const base = answered(id, 'fs_write')
    return { ...base, payload: JSON.stringify({ ...JSON.parse(base.payload), ...names }) }
  }

  test("calls that finish out of order pair by the agent's identifier of each", () => {
    const thread = [
      reportedAs('n1', 'toolu_a', { path: 'a.md' }),
      reportedAs('n2', 'toolu_b', { path: 'b.md' }),
      answeredAs('h2', { callId: 'toolu_b' }),
      answeredAs('h1', { callId: 'toolu_a' }),
    ]
    const folded = foldedCallsOf(thread)

    expect(folded.inPlaceOf.get('n1')?.id).toBe('h1')
    expect(folded.inPlaceOf.get('n2')?.id).toBe('h2')
  })

  test('a retry answered from memory has no entry, and the call after it keeps its own', () => {
    const thread = [
      reportedAs('n1', 'c1', { path: 'a.md', key: 'k1' }),
      answeredAs('h1', { key: 'k1' }),
      reportedAs('n2', 'c2', { path: 'a.md', key: 'k1' }),
      reportedAs('n3', 'c3', { path: 'b.md', key: 'k2' }),
      answeredAs('h3', { key: 'k2' }),
    ]
    const folded = foldedCallsOf(thread)

    expect(folded.inPlaceOf.get('n1')?.id).toBe('h1')
    expect(folded.inPlaceOf.has('n2')).toBe(false)
    expect(folded.inPlaceOf.get('n3')?.id).toBe('h3')
  })
})

describe('Every tool shows its subject', () => {
  const args = (value: Record<string, string>) => JSON.stringify(value)

  test('the file, the folder, the query, the command and the run, and nothing for the rest', () => {
    const runs = [{ id: 'run-7', name: 'check' }]
    expect(subjectOf('fs_read', args({ path: 'notes.md' }))).toEqual({
      text: 'notes.md',
      path: 'notes.md',
    })
    expect(subjectOf('fs_write', args({ path: 'src/a.ts', content: 'x', key: 'k' }))?.text).toBe(
      'src/a.ts',
    )
    expect(
      subjectOf('fs_edit', args({ path: 'src/b.ts', old: 'a', new: 'b', key: 'k' }))?.path,
    ).toBe('src/b.ts')
    expect(subjectOf('fs_list', args({ path: 'src/billing' }))?.text).toBe('src/billing')
    expect(subjectOf('fs_list', args({ path: '.' }))).toEqual({ text: 'root' })
    expect(subjectOf('fs_list', '{}')).toEqual({ text: 'root' })
    expect(subjectOf('search', args({ query: 'exportInvoices' }))?.text).toBe('"exportInvoices"')
    expect(subjectOf('search', args({ query: 'todo', path: 'src' }))?.text).toBe('"todo" in src')
    expect(subjectOf('commands_run', args({ name: 'check', key: 'k' }))?.text).toBe('check')
    expect(subjectOf('commands_run', args({ line: 'pnpm test', key: 'k' }))?.text).toBe('pnpm test')
    expect(subjectOf('commands_stop', args({ run: 'run-7' }), runs)?.text).toBe('check')
    expect(subjectOf('commands_output', args({ run: 'run-7' }), runs)?.text).toBe('check')
    expect(subjectOf('commands_list', '{}')).toBeUndefined()
    expect(subjectOf('project_get', '{}')).toBeUndefined()
    expect(subjectOf('session_get', '{}')).toBeUndefined()
  })

  test('a long line is cut on the line and whole in its title', () => {
    const line = `node -e "${'x'.repeat(80)}"`
    const subject = subjectOf('commands_run', args({ line, key: 'k' }))
    expect(subject?.text.length).toBe(60)
    expect(subject?.text.endsWith('…')).toBe(true)
    expect(subject?.full).toBe(line)
  })

  test('a path is still read from arguments the bound cut short', () => {
    expect(subjectOf('fs_write', '{"path":"src/index.ts","content":"trunc')).toEqual({
      text: 'src/index.ts',
      path: 'src/index.ts',
    })
  })

  test('the drawn call carries the label, the mark and the subject', () => {
    const entry = entryOf(
      'hemera_tool_call',
      'agent',
      'Listed 3 entries',
      JSON.stringify({
        tool: 'fs_list',
        state: 'completed',
        caller: 'c',
        paths: [],
        arguments: args({ path: 'src' }),
      }),
    )
    const drawn = hemeraToolCallOf(entry)
    expect(drawn?.label).toBe('List folder')
    expect(drawn?.mark).toBe('list-folder')
    expect(drawn?.subject?.text).toBe('src')
  })

  test("an agent's own call is about its first file, else what its input names", () => {
    const call = (
      rawInput: string | null,
      locations: { path: string; line: number | null }[] = [],
    ) => ({
      title: 'Bash',
      locations,
      rawInput: rawInput === null ? null : { text: rawInput },
    })
    expect(nativeSubjectOf('read', call(null, [{ path: '/w/a.ts', line: 4 }]))).toEqual({
      text: '/w/a.ts:4',
      path: '/w/a.ts',
    })
    expect(nativeSubjectOf('execute', call(args({ command: 'ls -la' })))?.text).toBe('ls -la')
    expect(nativeSubjectOf('execute', call('{"command":["git","status"]}'))?.text).toBe(
      'git status',
    )
    expect(nativeSubjectOf('search', call(args({ pattern: 'TODO' })))?.text).toBe('"TODO"')
    expect(nativeSubjectOf('fetch', call(args({ url: 'https://example.com' })))?.text).toBe(
      'https://example.com',
    )
    expect(nativeSubjectOf('execute', call(null))?.text).toBe('Bash')
    expect(nativeSubjectOf('other', call(null))).toBeUndefined()
  })

  test("a question of Hemera's is headed by the label, what it names and what it asks", () => {
    expect(
      hemeraPermissionOf(
        'fs_write',
        'fs_write asks to act outside the Workspace: /home/k/outside.txt',
        { named: '../outside.txt', resolved: '/home/k/outside.txt', line: null },
      ),
    ).toEqual({
      label: 'Write file',
      subject: '../outside.txt',
      intent: 'asks to act outside the Workspace',
    })
    expect(
      hemeraPermissionOf('commands_run', 'commands_run asks to run pnpm test in /w/app', {
        named: 'app',
        resolved: '/w/app',
        line: 'pnpm test',
      }),
    ).toEqual({ label: 'Run command', subject: 'pnpm test', intent: 'asks to run in /w/app' })
  })
})

describe('A Session read back draws a decided question as decided', () => {
  /**
   * A question of `fs_write` and its answer, as `sessions.read` gave them back on the Linux trial
   * of 23 September 2026: the request rewritten in the state it closed in, the decision after it.
   */
  const asked = (state: string): SessionEntry => ({
    ...entryOf(
      'permission_request',
      'hemera',
      'fs_write asks to act outside the Workspace: /tmp/outside.txt',
      JSON.stringify({
        toolCallId: 'q1',
        options: [
          { optionId: 'refused', name: 'Refuse', kind: 'reject_once' },
          { optionId: 'allowed', name: 'Allow once', kind: 'allow_once' },
        ],
        tool: 'fs_write',
        named: '/tmp/outside.txt',
        resolved: '/tmp/outside.txt',
        root: '/tmp/hemera-linux-claude-ws',
        line: null,
      }),
    ),
    id: 'request',
    seq: 42,
    correlationId: 'perm:q1',
    state,
  })

  test('a question decided, refused or stopped is not drawn waiting, and a pending one is', () => {
    // Its decision is what the thread draws for it: allowed, refused or stopped, and no button.
    expect(questionOpen(asked('decided'))).toBe(false)
    expect(questionOpen(asked('refused'))).toBe(false)
    expect(questionOpen(asked('cancelled'))).toBe(false)
    // Only a question nobody has answered yet is waiting for the reader.
    expect(questionOpen(asked('pending'))).toBe(true)
  })
})
