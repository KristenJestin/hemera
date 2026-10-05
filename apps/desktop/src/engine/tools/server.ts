/**
 * Hemera's MCP server: one for the whole engine, on the loopback interface, over streamable HTTP,
 * and the `HemeraEndpoint` agents are started with (its address, and a token per session).
 *
 * A request carries its session's bearer token. A token this engine never minted, or one it has
 * revoked, gets HTTP 401 with a generic body, and a line in the diagnostic (at most 20 a minute)
 * naming the session the token once served and never the token. The host and origin are
 * restricted to the loopback names: a web page of another site cannot post here.
 *
 * Each request is served by a server built for it, with only the tools its grant offers: the
 * session's role, minus what was withdrawn from it. `tools/list` never shows a tool the role does
 * not have. Each tool's input schema is generated from its `Schema`, its description from that
 * schema's annotations, and a tool that only reads says so (`readOnlyHint`). Every call goes to the
 * single gate, linked to the request's abort signal: an agent that cancels interrupts it.
 */

import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { TOOLS, TOOL_NAMES, type ToolName, readOnlyHint } from '@hemera/core/domain'
import { toToolInputSchema } from '@hemera/core/schema'
import {
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { Server, createMcpHandler } from '@modelcontextprotocol/server'
import { Context, Effect, FiberSet, Layer, Option, Predicate, Schema } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { ToolAccess } from './access.ts'
import { ToolGate } from './gate.ts'

/** The path agents are given: any path is served, and one is named so a configuration reads. */
const PATH = '/mcp'

/** The largest request read, token or not: well above a write of a large file. */
const BODY_LIMIT_BYTES = 16 * 1024 * 1024

/** All a caller that is not allowed is told. */
const REFUSED = JSON.stringify({ error: 'unauthorized' })

export class ToolServer extends Context.Service<
  ToolServer,
  {
    /** Where agents ask: `http://127.0.0.1:<port>/mcp`. */
    readonly url: string
  }
>()('ToolServer') {}

/** The token of a bearer header, and null without one. */
const bearerOf = (request: Request): string | null => {
  const header = request.headers.get('authorization')
  if (header === null) return null
  return /^bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? null
}

const ToolCallSent = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.Literal('tools/call'),
    params: Schema.Struct({ name: Schema.String }),
  }),
)
const readToolCall = Schema.decodeUnknownOption(ToolCallSent)

/** The tool a refused request asked for, to name it in the diagnostic; null for anything else. */
const toolAskedIn = async (request: Request): Promise<string | null> => {
  const body = await request
    .clone()
    .text()
    .catch(() => '')
  return Option.match(readToolCall(body), {
    onNone: () => null,
    onSome: (call) => call.params.name.slice(0, 64),
  })
}

/**
 * Where an agent names its own key of a call: Claude Code sends the id it reports the call under,
 * and Hemera's patch of Codex's adapter the id of the dynamic tool call. A retry carries it again.
 */
const CallKey = Schema.Union([
  Schema.Struct({ 'claudecode/toolUseId': Schema.NonEmptyString }),
  Schema.Struct({ 'hemera/callId': Schema.NonEmptyString }),
])
const readCallKey = Schema.decodeUnknownOption(CallKey)

const callKeyIn = (meta: Schema.Json | undefined): string | null =>
  Option.match(readCallKey(meta), {
    onNone: () => null,
    onSome: (found) =>
      'claudecode/toolUseId' in found ? found['claudecode/toolUseId'] : found['hemera/callId'],
  })

const readJson = Schema.decodeUnknownOption(Schema.Json)

/** One tool as `tools/list` shows it. */
const listed = (name: ToolName) => {
  const inputSchema = toToolInputSchema(TOOLS[name].input)
  return {
    name,
    title: TOOLS[name].label.label,
    description: Predicate.isString(inputSchema.description) ? inputSchema.description : name,
    inputSchema,
    annotations: { readOnlyHint: readOnlyHint(name) },
  }
}

/** The tools as they are listed, generated once. */
const LISTED = new Map(TOOL_NAMES.map((name) => [name, listed(name)]))

/** The request as the adapter reads it, its body bounded. */
const asNodeRequest = (request: IncomingMessage): NodeIncomingMessageLike => ({
  method: request.method ?? 'GET',
  url: request.url ?? '/',
  headers: request.headers,
  [Symbol.asyncIterator]: () => bounded(request),
})

async function* bounded(request: IncomingMessage): AsyncGenerator<Buffer> {
  let read = 0
  for await (const chunk of request) {
    // SAFETY: a request without an encoding set streams Buffers, and this one never sets one.
    const bytes = chunk as Buffer
    read += bytes.length
    if (read > BODY_LIMIT_BYTES) {
      request.destroy()
      return
    }
    yield bytes
  }
}

const asNodeResponse = (response: ServerResponse): NodeServerResponseLike => ({
  writeHead: (statusCode, headers) => response.writeHead(statusCode, headers),
  write: (chunk) => response.write(chunk),
  end: (chunk) => response.end(chunk),
  on: (event, listener) => {
    response.on(event, listener)
    return response
  },
  get destroyed() {
    return response.destroyed
  },
})

export const toolServerLayer = (log: Log, version: string) =>
  Layer.effect(
    ToolServer,
    Effect.gen(function* () {
      const access = yield* ToolAccess
      const gate = yield* ToolGate
      const runOwned = yield* FiberSet.makeRuntimePromise()

      /** The server of one request, with the tools of the grant its token named. */
      const mcp = createMcpHandler(
        async (context) => {
          const grant = await runOwned(access.byId(context.authInfo?.clientId ?? ''))
          const server = new Server(
            { name: 'hemera', version },
            { capabilities: { tools: { listChanged: false } } },
          )
          const tools = grant?.tools ?? []
          server.setRequestHandler('tools/list', () => ({
            tools: tools.flatMap((name) => {
              const one = LISTED.get(name)
              return one === undefined ? [] : [one]
            }),
          }))
          server.setRequestHandler('tools/call', async (request, call) => {
            const answer = await runOwned(
              gate.call({
                grantId: grant?.id ?? '',
                tool: request.params.name,
                arguments: Option.getOrElse(readJson(request.params.arguments ?? {}), () => ({})),
                // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
                callKey: callKeyIn(Option.getOrUndefined(readJson(call.mcpReq._meta))),
              }),
              { signal: call.mcpReq.signal },
            ).catch(() => ({ ok: false, text: 'the call was stopped before it ended' }))
            return { content: [{ type: 'text', text: answer.text }], isError: !answer.ok }
          })
          return server
        },
        { maxRequestBodySize: BODY_LIMIT_BYTES },
      )

      const door = {
        fetch: async (request: Request) => {
          const token = bearerOf(request)
          const grant = await runOwned(access.byToken(token))
          if (grant === null) {
            const sessionId = await runOwned(access.sessionOf(token))
            const tool = await toolAskedIn(request)
            await runOwned(
              access.refused(
                `refused ${tool === null ? 'a request' : `a call to ${tool}`} for ${
                  sessionId === null ? 'no session this engine knows' : `session ${sessionId}`
                }`,
              ),
            )
            return new Response(REFUSED, {
              status: 401,
              headers: { 'content-type': 'application/json' },
            })
          }
          // The digest stands where the token would: the tools are told the caller, not the secret.
          return mcp.fetch(request, {
            authInfo: { token: grant.id, clientId: grant.id, scopes: [] },
          })
        },
      }

      const nodeHandler = toNodeHandler(door, {
        maxRequestBodySize: BODY_LIMIT_BYTES,
        onerror: (error) => log(`tools: a request failed: ${error.message}`),
      })
      const allowedHost = localhostHostValidation()
      const allowedOrigin = localhostOriginValidation()
      const listener = createServer((request, response) => {
        if (!allowedHost(request, response)) return
        if (!allowedOrigin(request, response)) return
        void nodeHandler(asNodeRequest(request), asNodeResponse(response))
      })

      const origin = yield* Effect.acquireRelease(
        Effect.callback<string>((resume) => {
          listener.once('error', (cause) => resume(Effect.die(cause)))
          listener.listen(0, '127.0.0.1', () => {
            // SAFETY: once listening on a TCP port, `address()` is an AddressInfo, not a pipe name.
            const bound = listener.address() as AddressInfo
            resume(Effect.succeed(`http://127.0.0.1:${String(bound.port)}`))
          })
        }),
        () =>
          Effect.promise(async () => {
            await mcp.close()
            listener.closeAllConnections()
            await new Promise<void>((resolve) => listener.close(() => resolve()))
          }),
      )
      return { url: `${origin}${PATH}` }
    }),
  )
