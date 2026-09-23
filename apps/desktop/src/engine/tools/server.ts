/**
 * The address an agent asks Hemera's tools on (design D6-01, D6-02).
 *
 * One server for the whole engine, bound to the loopback interface on a port the system picks,
 * and a token per Session inside it: what a call carries is not a port of its own but the token
 * the agent's process was handed at start. Two consequences are the point of the design. The
 * tools exist once, whether or not any Session is running — creating one is answering requests
 * and nothing else — and the port is not published anywhere: an agent gets an address and a
 * token, and the address alone gets a 401.
 *
 * The token travels as a bearer header (D6-01): the three agents take `headers` in the
 * `mcpServers` of ACP, and a header is not what a proxy logs or a crash report quotes. The query
 * of the address is read only for a grant minted to carry it there, which no agent is today, and
 * never over a header that is present. Neither is logged — what the diagnostics call a caller is
 * the digest, never the secret.
 *
 * A refused access is answered generically: the caller learns that it is not allowed, and
 * nothing about which Sessions exist or what the tools are called. The line the user may have to
 * read is written to the engine's own sink, where it belongs.
 */

import {
  TOOL_ARGUMENTS,
  TOOL_DESCRIPTIONS,
  flatArguments,
  type ToolArguments,
} from './arguments.ts'
import { type AccessGrant, type GrantedAccess, ToolAccess } from './access.ts'
import { ToolCatalogue, type ToolCall } from './catalogue.ts'
import { TOOL_NAMES } from '@hemera/core'
import {
  McpServer,
  type RequestMeta,
  type ServerContext,
  createMcpHandler,
} from '@modelcontextprotocol/server'
import {
  type FetchLikeMcpHandler,
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node'
import { Context, Effect, Layer } from 'effect'
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { z } from 'zod'

/** The path an agent asks on: any path is served, and one is named so a configuration reads. */
const PATH = '/mcp'

/** What a caller that is not allowed is told, and everything it is told. */
const REFUSED = { error: 'unauthorized' }

/**
 * The largest request read, token or not: 16 MiB, well above a write of a large file.
 *
 * The body is read whole before the token is — the MCP adapter builds a request out of it — so
 * without a bound any process of this machine could make the engine hold hundreds of megabytes.
 */
const BODY_LIMIT_BYTES = 16 * 1024 * 1024

export interface ToolServerService {
  /** Where this engine's tools are served: `http://127.0.0.1:<port>`. */
  readonly origin: string
  /** The address an agent's configuration carries: the token is in it only when the grant says so. */
  readonly forAgent: (granted: GrantedAccess) => string
}

export class ToolServer extends Context.Service<ToolServer, ToolServerService>()('ToolServer') {}

/** What a JSON-RPC call to a tool reads as: the method, and the tool it names. */
const TOOL_CALL = z.object({
  method: z.literal('tools/call'),
  params: z.object({ name: z.string() }),
})

/**
 * The tool a refused request asked for, and null for anything that is not one call to a tool.
 *
 * Read from a copy of the body, and only to name the tool in the diagnostic: what the request
 * asked is not trusted for anything else, and a body that does not read is simply not a call.
 */
async function toolAskedIn(request: Request): Promise<string | null> {
  const body = await request
    .clone()
    .text()
    .catch(() => '')
  const sent = z
    .string()
    .transform((text, context) => {
      try {
        return JSON.parse(text)
      } catch {
        context.addIssue({ code: 'custom', message: 'not JSON' })
        return z.NEVER
      }
    })
    .pipe(TOOL_CALL)
    .safeParse(body)
  return sent.success ? sent.data.params.name.slice(0, 64) : null
}

/** The token of a bearer header, and null without one. */
function bearerOf(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const found = /^bearer\s+(\S+)$/i.exec(header.trim())
  return found?.[1] ?? null
}

/** The token of the address's query, and null without one. */
function queryTokenOf(request: Request): string | null {
  const fromQuery = new URL(request.url).searchParams.get('t')
  return fromQuery === null || fromQuery === '' ? null : fromQuery
}

/**
 * The tools of this engine, served on the loopback interface.
 *
 * Scoped, because a socket is a resource: an engine that quits closes its listener, and a
 * listener nobody closed is a port that outlives the process that took it.
 */
export const toolServerLayer: Layer.Layer<ToolServer, never, ToolAccess | ToolCatalogue> =
  Layer.effect(
    ToolServer,
    Effect.gen(function* () {
      const access = yield* ToolAccess
      const catalogue = yield* ToolCatalogue

      /**
       * The tools, as one MCP server built for one request and for the grant that request carried.
       *
       * The handler asks for a fresh server per request and connects it to that request's own
       * transport: a server kept and handed to a second request would be connected a second time,
       * and the answer of a call still waiting — on the human, on a command — would go to the
       * transport of the call that came after it. Building one is registering eleven tools, which
       * is nothing next to the call itself.
       */
      const serverFor = (grant: AccessGrant): McpServer => {
        const server = new McpServer({ name: 'hemera', version: '1.0.0' })
        for (const tool of TOOL_NAMES) {
          server.registerTool(
            tool,
            { description: TOOL_DESCRIPTIONS[tool], inputSchema: TOOL_ARGUMENTS[tool] },
            async (
              argumentsSent: Record<string, string | number | boolean | null>,
              context: ServerContext,
            ) => {
              const argumentsRead = flatArguments(Object.entries(argumentsSent ?? {}))
              // The request's own signal: an agent that gives up on a call — its timeout, its
              // cancel, a connection closed — stops what the call was doing (D6-05).
              const outcome = await Effect.runPromise(
                catalogue.call({
                  sessionId: grant.sessionId,
                  tool,
                  arguments: argumentsRead,
                  key: keyIn(argumentsRead),
                  offered: grant.offered,
                  caller: grant.id,
                  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
                  callId: callIdIn(context.mcpReq._meta),
                }),
                { signal: context.mcpReq.signal },
              )
              return {
                content: [{ type: 'text' as const, text: outcome.text }],
                isError: !outcome.ok,
              }
            },
          )
        }
        return server
      }

      /**
       * The server of one request, for the grant the door resolved for it.
       *
       * The door hands the digest over as the caller's identity, and the grant is read back from it
       * here rather than from a map of this file's: a grant revoked between the two is served a
       * server with no tools, so a call that raced the end of its Session is answered "no such
       * tool" rather than served on behalf of nobody.
       */
      const mcp = createMcpHandler(async (context) => {
        const grant = await Effect.runPromise(access.byId(context.authInfo?.clientId ?? ''))
        return grant === null
          ? new McpServer({ name: 'hemera', version: '1.0.0' })
          : serverFor(grant)
      })

      /**
       * The grant a request carries: the bearer header's, else the query's when that grant was
       * minted to be carried there. A token in the query of an agent that was not is refused, so a
       * URL that leaked into a log is not a key.
       */
      const grantOf = (request: Request): Effect.Effect<AccessGrant | null> =>
        Effect.gen(function* () {
          const bearer = bearerOf(request)
          if (bearer !== null) return yield* access.byToken(bearer)
          const inQuery = yield* access.byToken(queryTokenOf(request))
          return inQuery?.tokenInQuery === true ? inQuery : null
        })

      /**
       * The fetch door: the token is read, the grant behind it is looked up, and only then does
       * anything reach the tools. A token this engine never minted, or one it has revoked, ends
       * here — with a 401 that names nothing.
       */
      const door: FetchLikeMcpHandler = {
        fetch: async (request) => {
          const grant = await Effect.runPromise(grantOf(request))
          if (grant === null) {
            // The line names the Session the token served and the tool it asked for — what the
            // user needs to tell which agent was turned away — and never the token (D6-01).
            const sessionId = await Effect.runPromise(
              access.sessionOf(bearerOf(request) ?? queryTokenOf(request)),
            )
            const tool = await toolAskedIn(request)
            await Effect.runPromise(
              access.refusedAccess(
                `refused ${tool === null ? 'a request' : `a call to ${tool}`} for ${
                  sessionId === null ? 'no Session this engine knows' : `Session ${sessionId}`
                }`,
              ),
            )
            return new Response(JSON.stringify(REFUSED), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            })
          }
          // A call the server will turn away before any tool sees it is recorded all the same:
          // the refusal is an entry and a Journal line like any other (D6-03).
          const turnedAway = await refusalOf(request, grant)
          if (turnedAway !== null)
            await Effect.runPromise(catalogue.refuse(turnedAway.asked, turnedAway.reason))
          // The digest stands where the token would: the agent's own name for itself is not the
          // secret it was handed, and the tools are told the caller, not the credential.
          return mcp.fetch(request, {
            authInfo: { token: grant.id, clientId: grant.id, scopes: [] },
          })
        },
      }

      const nodeHandler = toNodeHandler(door)
      // A browser on this machine is not an agent, and the loopback interface is not private
      // from everything else that runs here (D6-01). The host header refuses a name rebound onto
      // the loopback address; the origin header refuses a page of another site that posts here —
      // an agent sends no origin, and a request with none goes through.
      const allowedHost = localhostHostValidation()
      const allowedOrigin = localhostOriginValidation()
      const listener: Server = createServer((request, response) => {
        if (!allowedHost(request, response)) return
        if (!allowedOrigin(request, response)) return
        // A body said to be larger than any call is refused before a byte of it is read.
        if (Number(request.headers['content-length'] ?? 0) > BODY_LIMIT_BYTES) {
          response.writeHead(413, { 'content-type': 'application/json', connection: 'close' })
          response.end(JSON.stringify({ error: 'too large' }))
          request.destroy()
          return
        }
        void nodeHandler(asNodeRequest(request), asNodeResponse(response))
      })

      const origin = yield* Effect.acquireRelease(
        Effect.promise(
          () =>
            new Promise<string>((resolve, reject) => {
              listener.once('error', reject)
              listener.listen(0, '127.0.0.1', () => {
                // SAFETY: this callback runs when the listener is bound, so `address()` is the
                // address it is bound to — an object — and not the `null` it answers before
                // `listen`, nor the string it answers for a pipe, which this never asks for.
                const bound = listener.address() as AddressInfo
                resolve(`http://127.0.0.1:${bound.port}`)
              })
            }),
        ),
        () =>
          Effect.sync(() => {
            listener.close()
          }),
      )

      return {
        origin,
        forAgent: (granted: GrantedAccess) =>
          granted.tokenInQuery
            ? `${origin}${PATH}?t=${encodeURIComponent(granted.token)}`
            : `${origin}${PATH}`,
      }
    }),
  )

/**
 * The request as the adapter reads it.
 *
 * The adapter is deliberately free of `node:` imports and reads a duck instead, so what it is
 * handed is exactly what it needs: the method, the address, the headers, and the body as the
 * async iterable Node has already made of it. A cast would be shorter and would say less.
 */
function asNodeRequest(request: IncomingMessage): NodeIncomingMessageLike {
  return {
    method: request.method ?? 'GET',
    url: request.url ?? '/',
    headers: request.headers,
    [Symbol.asyncIterator]: () => bounded(request),
  }
}

/**
 * The body of a request, chunk by chunk, up to `BODY_LIMIT_BYTES`: a body sent without a length,
 * or longer than the one it announced, is cut there and its connection closed, so what is read
 * of it is never more than the bound.
 */
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

/** The response as the adapter writes it, `destroyed` read when it is asked for. */
function asNodeResponse(response: ServerResponse): NodeServerResponseLike {
  return {
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
  }
}

/**
 * Where an agent names its own identifier of a call in the request's `_meta`: Claude Code sends
 * the `tool_use` id it reports the call under.
 */
const CALL_ID = z.object({ 'claudecode/toolUseId': z.string().min(1) })

/** The agent's identifier of a call, when its request carries one. */
function callIdIn(meta: RequestMeta | undefined): string | null {
  const read = CALL_ID.safeParse(meta)
  return read.success ? read.data['claudecode/toolUseId'] : null
}

/**
 * One argument as a flat bag holds it: a string, a number, a boolean or null, and anything else
 * as its JSON text — what the thread shows of a call its schema refused.
 */
const FLAT_VALUE = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .or(z.unknown().transform((value) => JSON.stringify(value)))

/** What one call to a tool sends, as far as the server's own refusals go. */
const CALL_SENT = z.object({
  method: z.literal('tools/call'),
  params: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
    _meta: CALL_ID.optional().catch(undefined),
  }),
})

/**
 * The call a request makes that the MCP server will refuse before any tool is reached, and why:
 * a name no tool of Hemera's has, or arguments its schema does not read. Null for anything else,
 * which the server serves or answers itself.
 *
 * Read from a copy of the body, as the server reads the same body after it.
 */
async function refusalOf(
  request: Request,
  grant: AccessGrant,
): Promise<{ readonly asked: ToolCall; readonly reason: string } | null> {
  const body = await request
    .clone()
    .text()
    .catch(() => '')
  const parsed = (() => {
    try {
      return CALL_SENT.safeParse(JSON.parse(body))
    } catch {
      return null
    }
  })()
  if (parsed === null || !parsed.success) return null
  const { name, arguments: sent = {}, _meta: meta } = parsed.data.params
  const argumentsRead = flatArguments(
    Object.entries(sent).map(([label, value]) => [label, FLAT_VALUE.parse(value)]),
  )
  const asked: ToolCall = {
    sessionId: grant.sessionId,
    tool: name.slice(0, 64),
    arguments: argumentsRead,
    key: keyIn(argumentsRead),
    offered: grant.offered,
    caller: grant.id,
    callId: meta?.['claudecode/toolUseId'] ?? null,
  }
  const tool = TOOL_NAMES.find((one) => one === name)
  if (tool === undefined) return { asked, reason: `Hemera has no tool named ${asked.tool}` }
  const read = TOOL_ARGUMENTS[tool].safeParse(sent)
  if (read.success) return null
  const why = read.error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ')
  return { asked, reason: `the arguments of ${tool} do not read: ${why}` }
}

/** What an idempotency key is, read where it arrives: one non-empty string, or nothing. */
const KEY_SCHEMA = z.object({ key: z.string().min(1).optional() })

/** The idempotency key an agent sent, when it sent one. */
function keyIn(sent: ToolArguments): string | null {
  const read = KEY_SCHEMA.safeParse(sent)
  return read.success ? (read.data.key ?? null) : null
}
