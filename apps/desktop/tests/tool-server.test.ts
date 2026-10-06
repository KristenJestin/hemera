/**
 * Hemera's MCP server, over real HTTP on the loopback interface: each role lists exactly its tools,
 * with input schemas generated from their `Schema` and the read-only hint of each; a token that is
 * revoked or was never minted gets 401 and a line in the diagnostic, at most 20 a minute; a page
 * of another site is turned away; and the fake agent of the agents' suites, started bare with
 * Hemera's endpoint, reaches the tools over real MCP. No real agent runs here.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROLES, type Role, TOOLS, type ToolName, readOnlyHint, toolsOf } from '@hemera/core/domain'
import { toToolInputSchema } from '@hemera/core/schema'
import { Effect, Layer, Option, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { TextBlock, defaultPermissionAnswerLayer } from '../src/engine/agents/client.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { callOverMcp, fakeAgent } from '../src/engine/agents/fake.ts'
import { IdleAgents } from '../src/engine/agents/idle.ts'
import {
  AgentRuntime,
  AgentStarter,
  SessionInstructions,
  agentRuntimeLayer,
} from '../src/engine/agents/runtime.ts'
import { openAgentSession } from '../src/engine/agents/sessions.ts'
import { acpTracesLayer } from '../src/engine/agents/trace.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { ALLOW, acmeWithMission, sessionOf, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('tool-server'))
  work = realpathSync.native(temporaryFolder('tool-server-work'))
})
afterEach(removeFolders)

const ListedTools = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String,
        inputSchema: Schema.Json,
        annotations: Schema.Struct({ readOnlyHint: Schema.Boolean }),
      }),
    ),
  }),
})
const readListed = Schema.decodeUnknownOption(ListedTools)

const bearer = (url: string, token: string) => ({
  url,
  headers: [{ name: 'authorization', value: `Bearer ${token}` }],
})

describe('Each request is served with only the tools its grant offers', () => {
  test('tools/list for each role shows exactly its tools, schema and read-only hint', async () => {
    const listed = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const url = yield* HemeraEndpoint.use((endpoint) => endpoint.url)
          const byRole = new Map<Role, Schema.Json>()
          for (const role of ROLES) {
            const session = yield* sessionOf(role, main, { kind: 'mission', id: mission.id })
            byRole.set(
              role,
              yield* Effect.promise(() =>
                callOverMcp(bearer(url, session.token), 'tools/list', {}),
              ),
            )
          }
          return byRole
        }),
      ),
    )
    for (const role of ROLES) {
      const read = readListed(listed.get(role))
      expect(Option.isSome(read), role).toBe(true)
      if (Option.isNone(read)) continue
      const tools = read.value.result.tools
      expect(tools.map((tool) => tool.name)).toEqual(toolsOf(role))
      for (const tool of tools) {
        // SAFETY: the names listed were just checked to be the role's tools, every one a ToolName.
        const name = tool.name as ToolName
        expect(tool.inputSchema).toEqual(
          JSON.parse(JSON.stringify(toToolInputSchema(TOOLS[name].input))),
        )
        expect(tool.annotations.readOnlyHint).toBe(readOnlyHint(name))
      }
    }
  })
})

describe('A token is the right to ask, for as long as its session lasts', () => {
  test('a revoked token gets 401 with a body that names nothing', async () => {
    const [before, after] = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const session = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const url = yield* HemeraEndpoint.use((endpoint) => endpoint.url)
          const ask = () =>
            fetch(url, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${session.token}`,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            }).then(async (response) => ({ status: response.status, body: await response.text() }))
          const live = yield* Effect.promise(ask)
          yield* HemeraEndpoint.use((endpoint) => endpoint.revoke(session.sessionId))
          const revoked = yield* Effect.promise(ask)
          return [live, revoked] as const
        }),
      ),
    )
    expect(before.status).toBe(200)
    expect(after).toEqual({ status: 401, body: '{"error":"unauthorized"}' })
  })

  test('the lines of refused accesses are at most 20 a minute, and never the token', async () => {
    const [logged, sessionId] = await commandsEngine(data)(({ profile, lines }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const session = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const url = yield* HemeraEndpoint.use((endpoint) => endpoint.url)
          yield* HemeraEndpoint.use((endpoint) => endpoint.revoke(session.sessionId))
          for (let knock = 0; knock < 25; knock += 1) {
            yield* Effect.promise(() =>
              callOverMcp(bearer(url, session.token), 'tools/call', {
                name: 'fs_read\nforged line',
                arguments: { path: 'a' },
              }),
            )
          }
          return [lines, session.sessionId] as const
        }),
      ),
    )
    const refused = logged.filter((line) => line.startsWith('tools: refused'))
    expect(refused).toHaveLength(20)
    expect(refused[0]).toBe(`tools: refused a call to fs_read forged line for session ${sessionId}`)
    expect(logged.join('\n')).not.toContain('Bearer')
  })

  test('a request from a page of another site is refused by its origin', async () => {
    const status = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const session = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const url = yield* HemeraEndpoint.use((endpoint) => endpoint.url)
          return yield* Effect.promise(() =>
            fetch(url, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${session.token}`,
                origin: 'https://acme.example',
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
            }).then((response) => response.status),
          )
        }),
      ),
    )
    expect(status).toBe(403)
  })
})

describe('An agent started bare reaches Hemera’s tools over real MCP', () => {
  test('the fake agent reads and writes through the gate with the token it was handed', async () => {
    const verdicts = verdictsSaying(() => ALLOW)
    const answers = await commandsEngine(data, { tools: { verdicts: verdicts.layer } })(
      ({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            writeFileSync(join(main, 'hello.txt'), 'hello\n')
            const session = yield* openAgentSession({
              provider: 'claude',
              ownerKind: 'mission',
              ownerId: mission.id,
              role: 'builder',
              folder: main,
            })
            const agent = fakeAgent({
              steps: [
                { does: 'uses', id: 'toolu_1', tool: 'fs_read', arguments: { path: 'hello.txt' } },
                {
                  does: 'uses',
                  id: 'toolu_2',
                  tool: 'fs_write',
                  arguments: { path: 'hello.txt', content: 'hello, Acme\n' },
                },
                { does: 'uses', id: 'toolu_3', tool: 'git_push', arguments: {} },
              ],
            })
            const world = Layer.mergeAll(
              Layer.succeed(AgentStarter, { start: () => Effect.succeed(agent.process) }),
              Layer.succeed(Discovery, {
                list: Effect.succeed([]),
                probe: () => Effect.succeed(null),
                resolve: (id) =>
                  Effect.succeed({
                    adapter: ADAPTERS[id],
                    from: 'bundled' as const,
                    program: '/adapters/fake.mjs',
                    args: [],
                    env: {},
                    own: {},
                  }),
              }),
              Layer.succeed(IdleAgents, {
                hold: () => Effect.void,
                touch: () => Effect.void,
                drop: () => Effect.void,
              }),
              acpTracesLayer(data),
              defaultPermissionAnswerLayer,
              Layer.succeed(SessionInstructions, { of: () => Effect.succeed('# Instructions') }),
            )
            yield* AgentRuntime.use((runtime) =>
              runtime.prompt(session.id, [TextBlock.make({ text: 'say hello to Acme' })]),
            ).pipe(
              Effect.provide(agentRuntimeLayer({ dataFolder: data, log: () => {} })),
              Effect.provide(world),
            )
            return agent.answers.toolAnswers
          }),
        ),
    )
    expect(answers[0]?.isError).toBe(false)
    expect(answers[0]?.text).toContain('hello')
    expect(answers[1]).toEqual({ isError: false, text: 'wrote hello.txt (12 bytes)' })
    expect(answers[2]).toEqual({
      isError: true,
      text: 'refused: Hemera has no tool named git_push',
    })
    expect(readFileSync(join(work, 'acme', 'hello.txt'), 'utf8')).toBe('hello, Acme\n')
  })
})
