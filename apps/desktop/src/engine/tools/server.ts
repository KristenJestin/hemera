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
 * The token travels in the query of the address an agent is configured with, and as a bearer
 * header when the client can send one, because the two happen in the wild: an MCP configuration
 * is a URL on most agents, and a header on the few that take one. Both are read, and neither is
 * logged — what the diagnostics call a caller is the digest, never the secret.
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
import { type AccessGrant, ToolAccess } from './access.ts'
import { ToolCatalogue } from './catalogue.ts'
import { TOOL_NAMES } from '@hemera/core'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import {
  type FetchLikeMcpHandler,
  type NodeIncomingMessageLike,
  type NodeServerResponseLike,
  localhostHostValidation,
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

export interface ToolServerService {
  /** Where this engine's tools are served: `http://127.0.0.1:<port>`. */
  readonly origin: string
  /** The address an agent's configuration carries, with the token it needs. */
  readonly forAgent: (token: string) => string
}

export class ToolServer extends Context.Service<ToolServer, ToolServerService>()('ToolServer') {}

/** The token a request carries, from the query it was configured with or from its header. */
function tokenOf(request: Request): string | null {
  const fromQuery = new URL(request.url).searchParams.get('t')
  if (fromQuery !== null && fromQuery !== '') return fromQuery
  const header = request.headers.get('authorization')
  if (header === null) return null
  const [scheme, value] = header.split(' ')
  return scheme !== undefined && scheme.toLowerCase() === 'bearer' && value !== undefined
    ? value
    : null
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
            async (argumentsSent: Record<string, string | number | boolean | null>) => {
              const argumentsRead = flatArguments(Object.entries(argumentsSent ?? {}))
              const outcome = await Effect.runPromise(
                catalogue.call({
                  sessionId: grant.sessionId,
                  tool,
                  arguments: argumentsRead,
                  key: keyIn(argumentsRead),
                  offered: grant.offered,
                  caller: grant.id,
                }),
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
       * The fetch door: the token is read, the grant behind it is looked up, and only then does
       * anything reach the tools. A token this engine never minted, or one it has revoked, ends
       * here — with a 401 that names nothing.
       */
      const door: FetchLikeMcpHandler = {
        fetch: async (request) => {
          const token = tokenOf(request)
          const grant = await Effect.runPromise(access.byToken(token))
          if (grant === null) {
            await Effect.runPromise(
              access.refusedAccess(
                `refused a call from ${new URL(request.url).origin} with no token this engine knows`,
              ),
            )
            return new Response(JSON.stringify(REFUSED), {
              status: 401,
              headers: { 'content-type': 'application/json' },
            })
          }
          // The digest stands where the token would: the agent's own name for itself is not the
          // secret it was handed, and the tools are told the caller, not the credential.
          return mcp.fetch(request, {
            authInfo: { token: grant.id, clientId: grant.id, scopes: [] },
          })
        },
      }

      const nodeHandler = toNodeHandler(door)
      // A browser on this machine is not an agent, and the loopback interface is not private
      // from everything else that runs here: the host header is what says who is asking.
      const allowedHost = localhostHostValidation()
      const listener: Server = createServer((request, response) => {
        if (!allowedHost(request, response)) return
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
        forAgent: (token: string) => `${origin}${PATH}?t=${encodeURIComponent(token)}`,
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
    [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
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

/** What an idempotency key is, read where it arrives: one non-empty string, or nothing. */
const KEY_SCHEMA = z.object({ key: z.string().min(1).optional() })

/** The idempotency key an agent sent, when it sent one. */
function keyIn(sent: ToolArguments): string | null {
  const read = KEY_SCHEMA.safeParse(sent)
  return read.success ? (read.data.key ?? null) : null
}
