/**
 * Hemera's patch of Codex's adapter, run for real against a Codex that is not one (design D6-02).
 *
 * `@agentclientprotocol/codex-acp` is started as the supervisor starts it, with the environment
 * and the `_meta` Codex's adapter declares, and pointed through `CODEX_PATH` at a fake
 * `codex app-server`: a script of this suite that answers the adapter's requests and writes down
 * what it was asked. Hemera's tools are a fake MCP server on the loopback interface. No model is
 * asked anything; what is under test is what the adapter asks Codex for, and where a call of a
 * dynamic tool goes.
 */

import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { createRequire } from 'node:module'
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { Effect } from 'effect'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { bareOptionsOf } from '#engine/agents/bare.ts'
import { codex } from '#engine/agents/adapters/codex.ts'

/** Where the repository's root is, from this suite. */
const ROOT = join(import.meta.dirname, '..', '..', '..')

/** The adapter as this installation carries it, patched or not. */
const ADAPTER_ENTRY = join(
  dirname(
    createRequire(join(ROOT, 'apps', 'desktop', 'package.json')).resolve(
      '@agentclientprotocol/codex-acp/package.json',
    ),
  ),
  'dist',
  'index.js',
)

/**
 * A `codex app-server` that answers what the adapter asks at start, at `session/new` and at a
 * prompt, and writes every request down. Its one turn asks for one dynamic tool, the way Codex
 * does when the model calls one, and ends when the adapter has answered it.
 */
const FAKE_APP_SERVER = `
const { appendFileSync } = require('node:fs')
const log = process.env.FAKE_APP_SERVER_LOG
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const thread = (id, cwd) => ({ id, sessionId: id, cwd, environments: [], turns: [], preview: '',
  ephemeral: false, status: { type: 'idle' }, modelProvider: 'openai', model: 'fake',
  createdAt: 1, updatedAt: 1, historyMode: 'full', name: null })
const results = {
  initialize: () => ({ userAgent: 'fake', codexHome: 'unused', platformFamily: 'unix', platformOs: 'linux' }),
  'account/read': () => ({ account: { type: 'chatgpt', email: 'nobody@example.invalid', planType: 'plus' }, requiresOpenaiAuth: true }),
  'config/read': () => ({ config: { mcp_servers: { user_server: { command: 'user-server' } } }, layers: [] }),
  'skills/list': (params) => ({ data: [{ cwd: (params.cwds ?? [''])[0], errors: [], skills: [
    { name: 'deploy', description: '', path: '/home/ana/.agents/skills/deploy/SKILL.md', scope: 'user', enabled: true, pluginId: null },
    { name: 'review', description: '', path: '/work/.agents/skills/review/SKILL.md', scope: 'repo', enabled: true, pluginId: null },
  ] }] }),
  'model/list': () => ({ data: [{ id: 'fake', model: 'fake', displayName: 'Fake', description: '', hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }], defaultReasoningEffort: 'low',
    inputModalities: ['text'], isDefault: true }], nextCursor: null }),
  'thread/start': (params) => ({ thread: thread('thread-1', params.cwd), model: 'fake', modelProvider: 'openai',
    serviceTier: null, reasoningEffort: 'low', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' }, cwd: params.cwd }),
  'thread/goal/get': () => ({ goal: null }),
  'turn/start': () => ({ turn: { id: 'turn-1', items: [], status: 'inProgress', error: null } }),
}
let buffer = ''
process.stdin.on('end', () => process.exit(0))
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString()
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const line = buffer.slice(0, at).trim()
    buffer = buffer.slice(at + 1)
    if (line === '') continue
    const message = JSON.parse(line)
    appendFileSync(log, JSON.stringify(message) + '\\n')
    if (message.method === undefined) {
      // The adapter's answer to the tool call: the turn is over.
      if (message.id === 'call') send({ method: 'turn/completed', params: { threadId: 'thread-1',
        turn: { id: 'turn-1', items: [], status: 'completed', error: null } } })
      continue
    }
    if (message.id === undefined) continue
    const answer = results[message.method]
    send({ id: message.id, result: answer === undefined ? {} : answer(message.params ?? {}) })
    if (message.method === 'turn/start') {
      send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1', items: [], status: 'inProgress', error: null } } })
      send({ id: 'call', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1',
        callId: 'call-1', namespace: null, tool: 'hemera_fs_read', arguments: { path: 'notes.md' } } })
    }
  }
})
`

/** One line of what the fake was asked or answered, as far as these suites read it. */
const LOGGED = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.record(z.string(), z.unknown()).optional(),
})

/** What a `thread/start` carried, as far as bare mode goes. */
const THREAD_START = z.object({
  config: z.object({
    features: z.record(z.string(), z.boolean()),
    mcp_servers: z.record(z.string(), z.object({ enabled: z.boolean() })).optional(),
    skills: z.object({
      include_instructions: z.boolean(),
      config: z.array(z.object({ path: z.string(), enabled: z.boolean() })),
    }),
  }),
  environments: z.array(z.unknown()),
  dynamicTools: z.array(z.object({ type: z.string(), name: z.string(), inputSchema: z.unknown() })),
})

/** What the adapter answered the tool call with. */
const TOOL_ANSWER = z.object({
  success: z.boolean(),
  contentItems: z.array(z.object({ type: z.string(), text: z.string() })),
})

/** One JSON-RPC request the fake MCP server received. */
const MCP_REQUEST = z.object({
  id: z.number().optional(),
  method: z.string(),
  params: z
    .object({
      name: z.string().optional(),
      arguments: z.record(z.string(), z.string()).optional(),
      _meta: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

type McpRequest = z.infer<typeof MCP_REQUEST>

/** Hemera's tools, as a server that knows one of them and writes down what it was asked. */
const hemeraTools = async () => {
  const asked: { readonly request: McpRequest; readonly authorization: string | undefined }[] = []
  const answerOf = (request: McpRequest) => {
    if (request.method === 'initialize') {
      return {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'hemera', version: '1' },
      }
    }
    if (request.method === 'tools/list') {
      return {
        tools: [
          {
            name: 'fs_read',
            description: 'Reads a file of the Workspace.',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      }
    }
    return { content: [{ type: 'text', text: 'The heron waits at dawn.' }], isError: false }
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      const sent = MCP_REQUEST.parse(JSON.parse(body))
      asked.push({ request: sent, authorization: request.headers.authorization })
      if (sent.id === undefined) {
        response.writeHead(202).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result: answerOf(sent) }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a server listening on a TCP port answers its address as an object, never a pipe name.
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/mcp`, asked, close: () => server.close() }
}

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-codex-patch-'))
})

afterEach(() => {
  // The fake may still be closing when the adapter is gone: Windows keeps its folder until then.
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

/** The fake, written where the adapter can start it as it starts `codex`. */
const fakeCodex = (): string => {
  const script = join(folder, 'fake-app-server.cjs')
  writeFileSync(script, FAKE_APP_SERVER)
  if (process.platform === 'win32') {
    // The adapter starts `"<CODEX_PATH>" app-server` through the shell on Windows.
    const command = join(folder, 'codex.cmd')
    writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`)
    return command
  }
  const command = join(folder, 'codex')
  writeFileSync(command, `#!${process.execPath}\nrequire(${JSON.stringify(script)})\n`)
  chmodSync(command, 0o755)
  return command
}

describe('The adapter patch is applied', () => {
  test('the patch is declared, its file exists, and every line it adds is in the installed adapter', () => {
    // The one entry of `patchedDependencies`, read as the line pnpm wrote it.
    const declared = /^\s+'@agentclientprotocol\/codex-acp@1\.12\.0': (\S+)$/m.exec(
      readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'),
    )?.[1]
    expect(declared).toBeDefined()
    const patch = join(ROOT, declared ?? '')
    expect(existsSync(patch)).toBe(true)

    const installed = readFileSync(ADAPTER_ENTRY, 'utf8')
    const added = readFileSync(patch, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
    expect(added.length).toBeGreaterThan(0)
    expect(added.filter((line) => !installed.includes(line))).toEqual([])
  })
})

describe("A bare Codex offers only Hemera's tools", () => {
  test("no environment, Hemera's tools as dynamic tools, and a call answered by Hemera's server", async () => {
    const tools = await hemeraTools()
    const log = join(folder, 'app-server.jsonl')
    const bare = await Effect.runPromise(
      bareOptionsOf(codex, process.platform, { ownerDirectory: folder, base: 'the base' }),
    )
    const adapter = spawn(process.execPath, [ADAPTER_ENTRY], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...bare.env, CODEX_PATH: fakeCodex(), FAKE_APP_SERVER_LOG: log },
    })
    // What the adapter writes, as the bytes the protocol's stream reads.
    const output = new ReadableStream<Uint8Array>({
      start: (controller) => {
        adapter.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        adapter.stdout.on('end', () => controller.close())
      },
    })
    try {
      if (bare.meta === undefined) throw new Error('Codex declares no _meta for its session')
      const connection = new ClientSideConnection(
        () => ({
          sessionUpdate: async () => undefined,
          requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        }),
        ndJsonStream(Writable.toWeb(adapter.stdin), output),
      )
      await connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
      const session = await connection.newSession({
        cwd: folder,
        mcpServers: [
          {
            type: 'http',
            name: 'hemera',
            url: tools.url,
            headers: [{ name: 'Authorization', value: 'Bearer token-of-the-session' }],
          },
        ],
        // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
        _meta: bare.meta,
      })
      await connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Read notes.md.' }],
      })

      const lines = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => LOGGED.parse(JSON.parse(line)))
      const started = THREAD_START.parse(lines.find((one) => one.method === 'thread/start')?.params)
      // No environment: no shell, no apply_patch, no image viewer.
      expect(started.environments).toEqual([])
      // Hemera's tools are Codex's own, under Hemera's prefix, and no MCP server is started for
      // them: the user's own server is turned off by name, and Hemera's is not there at all.
      expect(started.dynamicTools.map((tool) => tool.name)).toEqual(['hemera_fs_read'])
      expect(started.config.mcp_servers).toEqual({ user_server: { enabled: false } })
      // No index of the skills, and every skill Codex found is disabled by its path, so a `$name`
      // mention injects nothing either.
      expect(started.config.skills.include_instructions).toBe(false)
      expect(started.config.skills.config).toEqual([
        { path: '/home/ana/.agents/skills/deploy/SKILL.md', enabled: false },
        { path: '/work/.agents/skills/review/SKILL.md', enabled: false },
      ])
      expect(started.config.features.shell_tool).toBe(false)
      // Every turn says it again, which is what a resumed thread needs.
      const turns = lines.filter((one) => one.method === 'turn/start')
      expect(turns.map((one) => one.params?.environments)).toEqual([[]])
      // The call went to Hemera's server with the session's token, and came back to Codex.
      const call = tools.asked.find((one) => one.request.method === 'tools/call')
      expect(call?.request.params?.name).toBe('fs_read')
      expect(call?.request.params?.arguments).toEqual({ path: 'notes.md' })
      // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
      expect(call?.request.params?._meta).toEqual({ 'hemera/callId': 'call-1' })
      expect(call?.authorization).toBe('Bearer token-of-the-session')
      const answer = TOOL_ANSWER.parse(lines.find((one) => one.id === 'call')?.result)
      expect(answer).toEqual({
        success: true,
        contentItems: [{ type: 'inputText', text: 'The heron waits at dawn.' }],
      })
      // And no thread of its own is started for a title: a bare session starts no other thread.
      expect(lines.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    } finally {
      const ended = new Promise((resolve) => adapter.once('exit', resolve))
      adapter.kill()
      await ended
      tools.close()
    }
  })
})
