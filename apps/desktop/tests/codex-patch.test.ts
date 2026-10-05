/**
 * A bare Codex offers only `hemera_*` tools: Hemera's patch of `@agentclientprotocol/codex-acp`,
 * run for real against a Codex that is not one.
 *
 * The patched adapter is started with the options Codex's declaration produces, and pointed
 * through `CODEX_PATH` at a fake `codex app-server`: a script of this suite that answers the
 * adapter's requests and writes down what it was asked. Hemera's tools are a fake MCP server on
 * the loopback interface. No Codex starts, no model is asked anything: what is checked is how the
 * adapter rewrites its requests to Codex, and where a call of a dynamic tool goes.
 */

import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'

import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import { Match, Schema } from 'effect'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { codex } from '../src/engine/agents/adapters/codex.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

const ROOT = join(import.meta.dirname, '..', '..', '..')

/** The adapter as this installation carries it, patched. */
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
 * prompt, and writes every message down. Its one turn calls one dynamic tool, as Codex does when
 * the model calls one, and ends once the adapter has answered it.
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

/** One message the fake was sent, as far as this suite reads it. */
const Logged = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
    method: Schema.optionalKey(Schema.String),
    params: Schema.optionalKey(Schema.Unknown),
    result: Schema.optionalKey(Schema.Unknown),
  }),
)

const ThreadStart = Schema.Struct({
  config: Schema.Struct({
    features: Schema.Record(Schema.String, Schema.Boolean),
    mcp_servers: Schema.Record(Schema.String, Schema.Struct({ enabled: Schema.Boolean })),
    skills: Schema.Struct({
      include_instructions: Schema.Boolean,
      config: Schema.Array(Schema.Struct({ path: Schema.String, enabled: Schema.Boolean })),
    }),
  }),
  environments: Schema.Array(Schema.Unknown),
  dynamicTools: Schema.Array(Schema.Struct({ name: Schema.String })),
})

const TurnStart = Schema.Struct({ environments: Schema.Array(Schema.Unknown) })

const ToolAnswer = Schema.Struct({
  success: Schema.Boolean,
  contentItems: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
})

const McpRequest = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    method: Schema.String,
    params: Schema.optionalKey(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        _meta: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      }),
    ),
  }),
)
type McpRequest = typeof McpRequest.Type

/** Hemera's tools: a server that knows one of them and writes down what it was asked. */
const hemeraTools = async () => {
  const asked: { readonly request: McpRequest; readonly authorization: string | undefined }[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      const sent = Schema.decodeUnknownSync(McpRequest)(body)
      asked.push({ request: sent, authorization: request.headers.authorization })
      if (sent.id === undefined) {
        response.writeHead(202).end()
        return
      }
      const result = Match.value(sent.method).pipe(
        Match.when('initialize', () => ({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'hemera', version: '1' },
        })),
        Match.when('tools/list', () => ({
          tools: [
            { name: 'fs_read', description: 'Reads a file.', inputSchema: { type: 'object' } },
          ],
        })),
        Match.orElse(() => ({
          content: [{ type: 'text', text: 'The heron waits at dawn.' }],
          isError: false,
        })),
      )
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: sent.id, result }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // SAFETY: a server listening on a TCP port answers its address as an object, never a pipe name.
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/mcp`, asked, close: () => server.close() }
}

/** The fake, written where the adapter starts it as it starts `codex`. */
const fakeCodex = (folder: string): string => {
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

describe('The patch of the Codex adapter is applied', () => {
  test('it is declared, its file exists, and every line it adds is in the installed adapter', () => {
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

describe('A bare Codex offers only hemera_* tools', () => {
  test("no environment, Hemera's tools as dynamic tools, a call answered by Hemera's server", async () => {
    const folder = temporaryFolder('codex-patch')
    const tools = await hemeraTools()
    const log = join(folder, 'app-server.jsonl')
    const bare = codex.bareOptions({
      agentDirectory: folder,
      systemPrompt: 'the system prompt',
      hemera: { url: tools.url, token: 'token-of-the-session' },
    })
    const adapter = spawn(process.execPath, [ADAPTER_ENTRY], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, ...bare.env, CODEX_PATH: fakeCodex(folder), FAKE_APP_SERVER_LOG: log },
    })
    const output = new ReadableStream<Uint8Array>({
      start: (controller) => {
        adapter.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
        adapter.stdout.on('end', () => controller.close())
      },
    })
    try {
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
        mcpServers: [...bare.mcpServers],
        // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
        _meta: { ...bare.meta },
      })
      await connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: 'Read notes.md.' }],
      })

      const lines = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => Schema.decodeUnknownSync(Logged)(line))
      const started = Schema.decodeUnknownSync(ThreadStart)(
        lines.find((one) => one.method === 'thread/start')?.params,
      )
      // No environment: no shell, no apply_patch, no image viewer.
      expect(started.environments).toEqual([])
      // Hemera's tools are Codex's own, under Hemera's prefix, and no MCP server is started for
      // them: the user's own server is turned off by name, Hemera's is not there at all.
      expect(started.dynamicTools.map((tool) => tool.name)).toEqual(['hemera_fs_read'])
      expect(started.config.mcp_servers).toEqual({ user_server: { enabled: false } })
      expect(started.config.skills.include_instructions).toBe(false)
      expect(started.config.skills.config).toEqual([
        { path: '/home/ana/.agents/skills/deploy/SKILL.md', enabled: false },
      ])
      expect(started.config.features.shell_tool).toBe(false)
      // Every turn says it again, which is what a resumed thread needs.
      const turns = lines.filter((one) => one.method === 'turn/start')
      expect(
        turns.map((one) => Schema.decodeUnknownSync(TurnStart)(one.params).environments),
      ).toEqual([[]])
      // The call went to Hemera's server with the session's token and the call id, and back.
      const call = tools.asked.find((one) => one.request.method === 'tools/call')
      expect(call?.request.params?.name).toBe('fs_read')
      expect(call?.request.params?.arguments).toEqual({ path: 'notes.md' })
      // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
      expect(call?.request.params?._meta).toEqual({ 'hemera/callId': 'call-1' })
      expect(call?.authorization).toBe('Bearer token-of-the-session')
      expect(
        Schema.decodeUnknownSync(ToolAnswer)(lines.find((one) => one.id === 'call')?.result),
      ).toEqual({
        success: true,
        contentItems: [{ type: 'inputText', text: 'The heron waits at dawn.' }],
      })
      // No thread of its own is started for a title.
      expect(lines.filter((one) => one.method === 'thread/start')).toHaveLength(1)
    } finally {
      const ended = new Promise((resolve) => adapter.once('exit', resolve))
      adapter.kill()
      await ended
      tools.close()
    }
  })
})
