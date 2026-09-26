/**
 * The fake agent, and the process it pretends to be (design D5-16).
 *
 * The engine's tests need an agent to talk to, and the point of them is the protocol rather than
 * a mock's opinion of it: so this is a real peer, built with the SDK's agent side, connected to
 * the client by a pair of in-memory streams. What it answers is scripted, and everything else —
 * the framing, the request ids, the handshake, the permission request — is the protocol's own.
 *
 * It lives under `src/` rather than under `tests/` because it is more than a test's file now:
 * `fakeSupervisor` answers the `ProcessSupervisor` port, so the runtime can be built from a real
 * `start`, real lines and a real death without a child process anywhere on the machine. The lint
 * refuses `vi.mock`, and injection through a port is the way (D5-16).
 *
 * Nothing here is started, installed or reached by the application: the engine imports the port,
 * never this file, and what the fake proves is that Hemera's side of a conversation is what the
 * protocol says it should be — the half of phase 1 that can be proved with no agent installed.
 */

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent as AcpAgent,
  type ContentBlock,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PermissionOption,
  type PlanEntryStatus,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionUpdate,
  type StopReason,
  type ToolCall,
  type ToolCallContent,
  type ToolCallStatus,
  type Usage,
} from '@agentclientprotocol/sdk'
import { Effect, Layer } from 'effect'
import { z } from 'zod'

import { DELIVERY_MARKER } from '@hemera/core'

import {
  type ExitObservation,
  ProcessSupervisor,
  type ProcessSupervisorService,
  type SupervisedProcess,
} from './supervisor.ts'

/** What a script hands a tool: the flat arguments an MCP call carries. */
export type FakeArguments = Readonly<Record<string, string | number | boolean>>

/** One tool call the agent made over MCP, and what the server answered it. */
export interface FakeToolAnswer {
  readonly tool: string
  readonly arguments: FakeArguments
  /** The HTTP status the server answered with: 401 is a door that stayed shut. */
  readonly status: number
  /** The text of the answer, or the error the server gave instead of one. */
  readonly text: string
  readonly isError: boolean
}

/** One thing the agent does during a turn, in the order it does them. */
export type FakeStep =
  | { readonly does: 'says'; readonly text: string; readonly messageId?: string }
  | { readonly does: 'thinks'; readonly text: string; readonly messageId?: string }
  | {
      readonly does: 'calls'
      readonly call: {
        readonly id: string
        readonly title: string
        readonly kind?: NonNullable<ToolCall['kind']>
        readonly status?: NonNullable<ToolCall['status']>
        readonly path?: string
        /** The line in that file the agent points at, which a call may name and rarely does. */
        readonly line?: number
        /** What it attached to the call: what it printed, a change, a terminal it opened. */
        readonly content?: readonly ToolCallContent[]
        /** What the tool was called with, as the agent publishes it. */
        readonly rawInput?: Record<string, string>
        readonly rawOutput?: Record<string, string>
      }
    }
  | {
      readonly does: 'updates'
      readonly call: {
        readonly id: string
        readonly status: ToolCallStatus
        readonly title?: string
        readonly content?: readonly ToolCallContent[]
        readonly rawOutput?: Record<string, string>
      }
    }
  | {
      readonly does: 'asks'
      readonly call: {
        readonly id: string
        readonly title: string
        readonly options: readonly {
          readonly id: string
          readonly name: string
          readonly kind: PermissionOption['kind']
        }[]
      }
    }
  | {
      readonly does: 'plans'
      readonly lines: readonly { readonly content: string; readonly status: PlanEntryStatus }[]
    }
  | {
      /**
       * A call to one of the tools it was lent, made over MCP (design D6-11).
       *
       * The agent asks the server it was handed at `session/new`, with the header it was handed,
       * by the name the server listed, and streams what it asked and what came back as a
       * `tool_call` and its `tool_call_update` — which is what an agent does with a tool of an MCP
       * server, and what makes every scenario of the tools playable without a real agent.
       */
      readonly does: 'uses'
      /** The name the server lists the tool under. */
      readonly call: string
      readonly arguments?: FakeArguments
      /** The identifier of the call in the thread; one is made up when a script names none. */
      readonly id?: string
      /**
       * Stops waiting for the answer after this many milliseconds, as Claude Code's idle timeout
       * does: the call is reported failed and the turn goes on, while the request is left open and
       * nothing is sent to cancel it.
       */
      readonly givesUpAfter?: number
    }
  | {
      /**
       * Several calls to the tools it was lent, sent at once: what an agent that runs the calls of
       * one step in parallel does, and what leaves a Session waiting on more than one question.
       */
      readonly does: 'usesTogether'
      readonly calls: readonly Extract<FakeStep, { does: 'uses' }>[]
    }
  | {
      /**
       * What the agent says the window is filling to (design D5-20).
       *
       * `usage_update` is the only place a context window is ever named, so a script that wants
       * one announced announces it here — and a script that says nothing has the agent say
       * nothing, which is what every agent on this machine does.
       */
      readonly does: 'spends'
      readonly used: number
      readonly size: number
      readonly cost?: { readonly amount: number; readonly currency: string }
    }
  | {
      /**
       * A line written on its standard error rather than said over the protocol (#131): what
       * OpenCode does when its provider refuses it, and all it does about it.
       */
      readonly does: 'complains'
      readonly line: string
    }
  | {
      /**
       * A request of a method Hemera does not implement, sent and awaited (#131): what the SDK
       * answers it with is the agent's business, and the turn goes on either way.
       */
      readonly does: 'requests'
      readonly method: string
    }

/**
 * What the agent is scripted to be: what it announces, and what it does when it is asked.
 *
 * Every field is a choice a test makes, and none of them is a behaviour the protocol allows an
 * agent to lack: an agent that never refuses anything is an agent whose refusals are untested.
 */
export interface FakeScript {
  /** The methods it publishes at `initialize`; none means no way in, as the adapters read it. */
  readonly authMethods?: readonly { readonly id: string; readonly name: string }[]
  /** Whether it says it can continue a session it handed back. */
  readonly continues?: boolean
  /**
   * Whether it publishes `sessionCapabilities.resume` at `initialize`.
   *
   * True unless a test says otherwise: the agents that do not are the ones whose Session has to
   * be loaded and matched rather than simply resumed.
   */
  readonly advertisesResume?: boolean
  /** What it does, in order, on each prompt. */
  readonly steps?: readonly FakeStep[]
  /**
   * What it does on its first prompts, one list per prompt, before `steps` takes over.
   *
   * A scenario that spans turns — an app started in one and read in the next — scripts each of
   * them; a delivery of context is not a turn of the agent's and does not count as one.
   */
  readonly turns?: readonly (readonly FakeStep[])[]
  /** What it announces in `session/new`, in the SDK's own shape for a configuration option. */
  readonly configOptions?: readonly SessionConfigOption[]
  /**
   * What it announces once one of its options has been chosen (design D5-13).
   *
   * The protocol answers a choice with the whole set of options as they stand, which is the only
   * place an option that exists because of that choice ever appears — the effort of a reasoning
   * model, published once the model is picked. A script that says nothing here announces the
   * same list it opened with.
   */
  readonly onChoice?: (choice: {
    readonly id: string
    readonly value: string
  }) => readonly SessionConfigOption[]
  /**
   * What `session/load` streams back, as the protocol asks it to.
   *
   * A resumed session is not replayed by `session/resume`, so this is the load's alone.
   */
  readonly history?: readonly FakeStep[]
  /** The session it opens, and the one its updates are sent for. */
  readonly nativeSessionId?: string
  /** Whether `session/resume` answers an error rather than a session. */
  readonly refusesResume?: boolean
  /** Whether `session/load` answers an error rather than a history. */
  readonly refusesLoad?: boolean
  /**
   * Whether a `session/cancel` is ignored.
   *
   * An agent that stops when it is asked to is the easy case; this is the one Hemera has to
   * survive, because a Stop that waits for an agent that never answers is a Stop that hangs.
   */
  readonly ignoresCancel?: boolean
  /** What it answers a turn with. */
  readonly stopReason?: StopReason
  /**
   * The sentence an error response to `session/prompt` carries, once the steps are said: an
   * agent whose provider refused the request, as OpenCode answers a model it will not serve.
   */
  readonly failsPrompt?: string
  /**
   * What the turn is accounted as using, in the SDK's shape.
   *
   * The SDK calls it `Usage`; Hemera's own `UsageReport` is the same shape and is assignable to
   * it, so a test may script either.
   */
  readonly usage?: Usage
  /**
   * Awaited before each step, so a test can hold a turn open.
   *
   * A cancelled turn can only be tested while the turn is really running, and a scripted agent
   * is done in microseconds: this is where a test stops happening and presses Stop.
   */
  readonly between?: () => Promise<void>
  /** Awaited before a delivery is answered: how a suite catches a turn inside its delivery. */
  readonly holdsDelivery?: () => Promise<void>
  /**
   * Awaited before `initialize` is answered: an agent whose cold start takes its time, or never
   * ends, which is how a suite holds a build `starting` (#132).
   */
  readonly holdsStart?: () => Promise<void>
  /** Called with the text of each prompt as it arrives, for a test that watches the pipe. */
  readonly onPrompt?: (text: string) => void
  /**
   * Whether it connects to the MCP server it is handed and lists its tools, as an agent does at
   * the start of a session (D6-11).
   *
   * True whenever a step of the script uses a tool, and a suite about what the agent can see
   * says so for a script that uses none. An agent that connects to nothing is the default,
   * because most suites hand it an address nothing listens on.
   */
  readonly listsTools?: boolean
  /**
   * What it says in answer to a delivery (D6-08): nothing, by default, as an agent that takes the
   * change in; a real agent may answer it, and that answer belongs to a turn of its own.
   */
  readonly answersDelivery?: readonly FakeStep[]
}

/**
 * The name the client's suite already asks the script by.
 *
 * One type under two names: `client.test.ts` was written against `FakeBehaviour`, and what that
 * name always meant is the script.
 */
export type FakeBehaviour = FakeScript

/**
 * What the agent was asked, as it was asked.
 *
 * Read from outside the runtime, like a `Ref` is: a suite asserts on what the agent was told
 * without having to instrument the client, which is the half of a conversation the protocol
 * leaves to the two ends.
 */
export interface FakeAnswers {
  /** Grows as the agent is answered, so a test can read what the client told it. */
  readonly optionIds: string[]
  /** How many questions were answered by the turn ending rather than by the user. */
  readonly cancelled: number
  /** The text of every prompt the agent was sent, in the order it was sent them. */
  readonly prompts: string[]
  /**
   * What `session/new`, `session/load` and `session/resume` were configured with, one entry per
   * session opened, loaded or resumed.
   *
   * What Hemera lends an agent travels here and nowhere else (D6-01), so a suite reads the
   * address and the token the agent was handed rather than trusting that it was.
   */
  readonly mcpServers: McpServer[][]
  /** How many times the agent was asked to load a session, whether or not it agreed. */
  readonly loads: number
  /** How many times the agent was asked to resume one, whether or not it agreed. */
  readonly resumes: number
  /** How many times the agent was told to cancel, whether or not it listened. */
  readonly cancels: number
  /** Every option it was put on, as , in the order it was told. */
  readonly choices: string[]
  /**
   * What the client advertised of itself at `initialize`, as the JSON it sent.
   *
   * Kept whole rather than read into fields: an extension a client advertises is a namespace
   * this peer knows nothing about, and a fake that parsed it would be a second reader of it.
   */
  readonly advertised: string[]
  /**
   * What each session it opened, loaded or resumed was configured with on `_meta`, as the JSON it
   * arrived as, and `null` for one that carried none: where Claude Code reads its options (D6-02).
   */
  readonly metas: (string | null)[]
  /** The blocks of every prompt, as they arrived: a resource is a block, not a text (D6-07). */
  readonly blocks: ContentBlock[][]
  /**
   * The tools the MCP server listed, once per session it was handed a server for (D6-11).
   *
   * What the agent can call is what this says: a list holding Hemera's tools and nothing else is
   * the capability a bare Session is meant to have.
   */
  readonly tools: string[][]
  /** Every tool call it made over MCP, in order, with what the server answered. */
  readonly used: FakeToolAnswer[]
}

/**
 * The counters as the agent itself writes them.
 *
 * `FakeAnswers` is the same object seen from outside, read-only: the fake increments what a test
 * only reads, and one object means the two can never disagree.
 */
interface FakeTally {
  optionIds: string[]
  cancelled: number
  prompts: string[]
  mcpServers: McpServer[][]
  loads: number
  resumes: number
  cancels: number
  choices: string[]
  advertised: string[]
  metas: (string | null)[]
  blocks: ContentBlock[][]
  tools: string[][]
  used: FakeToolAnswer[]
}

/** The peer, the script it follows, and the two pipes a client talks to it through. */
export interface FakeAgent {
  /** What the agent was scripted with, as it was read. */
  readonly script: FakeScript
  /** What the agent asked for permission, as it happened. */
  readonly answers: FakeAnswers
  /**
   * The two pipes of the fake, named the way `connect` names its options: what the agent writes
   * is `input` — the stream the client reads — and what it reads is `output`.
   */
  readonly streams: {
    readonly input: ReadableStream<Uint8Array>
    readonly output: WritableStream<Uint8Array>
  }
  /**
   * The same two pipes under the names the client's own suite asks for them by.
   *
   * One pair of streams, two vocabularies: `streams` speaks `connect`'s, and these speak the
   * one `client.test.ts` was written against. Neither is a second pipe.
   */
  readonly input: WritableStream<Uint8Array>
  readonly output: ReadableStream<Uint8Array>
  /**
   * Every command the supervisor was asked to start for this agent, in the order it was asked.
   *
   * Read by a suite about what is *not* started: an agent this machine does not have and an
   * agent nobody signed in are refused before a process exists (D5-17, D5-21), and an empty
   * list is what says so.
   */
  readonly starts: string[]
  /**
   * The environment each of those starts was given, beyond the machine's own: what an agent that
   * takes its bare mode from variables is handed (D6-02, D6-09).
   */
  readonly environments: Record<string, string>[]
  /** Hands a reader every line the agent writes on its standard error from now on. */
  readonly onStderr: (read: (line: string) => void) => void
  /** Ends the agent now, as a process that died on the spot does. */
  readonly die: () => void
  /** The death of the agent, which resolves once and only once. */
  readonly exited: Promise<void>
}

/** The notification one step is, or null when the step is something else entirely. */
function updateOf(step: FakeStep): SessionUpdate | null {
  switch (step.does) {
    case 'says': {
      const update: Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }> = {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: step.text } satisfies ContentBlock,
      }
      // A chunk that names the message it belongs to is one a thread can match a replay against.
      if (step.messageId !== undefined) update.messageId = step.messageId
      return update
    }
    case 'thinks': {
      const update: Extract<SessionUpdate, { sessionUpdate: 'agent_thought_chunk' }> = {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: step.text } satisfies ContentBlock,
      }
      if (step.messageId !== undefined) update.messageId = step.messageId
      return update
    }
    case 'calls': {
      // What the agent does not say is left out rather than sent as nothing: an update carries
      // what changed, and a field set to null would be an update that clears it.
      const call: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }> = {
        sessionUpdate: 'tool_call',
        toolCallId: step.call.id,
        title: step.call.title,
        locations: step.call.path === undefined ? [] : [{ path: step.call.path }],
        content: [],
      }
      if (step.call.kind !== undefined) call.kind = step.call.kind
      if (step.call.status !== undefined) call.status = step.call.status
      if (step.call.line !== undefined && step.call.path !== undefined) {
        call.locations = [{ path: step.call.path, line: step.call.line }]
      }
      if (step.call.content !== undefined) call.content = [...step.call.content]
      if (step.call.rawInput !== undefined) call.rawInput = step.call.rawInput
      if (step.call.rawOutput !== undefined) call.rawOutput = step.call.rawOutput
      return call
    }
    case 'updates': {
      const update: Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }> = {
        sessionUpdate: 'tool_call_update',
        toolCallId: step.call.id,
        status: step.call.status,
      }
      if (step.call.title !== undefined) update.title = step.call.title
      if (step.call.content !== undefined) update.content = [...step.call.content]
      if (step.call.rawOutput !== undefined) update.rawOutput = step.call.rawOutput
      return update
    }
    case 'spends': {
      const update: Extract<SessionUpdate, { sessionUpdate: 'usage_update' }> = {
        sessionUpdate: 'usage_update',
        used: step.used,
        size: step.size,
      }
      if (step.cost !== undefined) update.cost = step.cost
      return update
    }
    case 'plans':
      return {
        sessionUpdate: 'plan',
        entries: step.lines.map((line) => ({
          content: line.content,
          status: line.status,
          priority: 'medium',
        })),
      }
    case 'asks':
    case 'uses':
    case 'usesTogether':
    case 'complains':
    case 'requests':
      return null
    default:
      return null
  }
}

/**
 * The one MCP server an agent was handed over HTTP, as the fake reaches it (D6-01, D6-11).
 *
 * A client of the protocol's streamable HTTP transport and nothing more: a JSON-RPC request per
 * POST, the headers the agent was handed on every one of them, and an answer that comes back as
 * JSON or as one event of a stream. It stays here, in the fake, because no part of Hemera is an
 * MCP client — the agents are, and this is the agent.
 */
interface McpLink {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  /** What the server negotiated at `initialize`, sent back on every request after it. */
  protocol: string | null
  /** The session the server opened, when it opened one. */
  session: string | null
  next: number
}

/** What travels in a request of the protocol: JSON, and nothing a JSON text cannot hold. */
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** The protocol version the fake asks for: the server answers with the one it speaks. */
const MCP_PROTOCOL = '2025-06-18'

/** One JSON-RPC answer, whatever it answers. */
const RPC_ANSWER = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  result: z.json().optional(),
  error: z.object({ message: z.string() }).optional(),
})

const INITIALIZED = z.object({ protocolVersion: z.string() })

const TOOLS_LISTED = z.object({ tools: z.array(z.object({ name: z.string() })) })

const TOOL_ANSWERED = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
})

/** A text read as JSON, then as the schema, or null when it is neither. */
const readAs = <T>(schema: z.ZodType<T>, text: string): T | null => {
  const read = z
    .string()
    .transform((sent, context) => {
      try {
        return JSON.parse(sent)
      } catch {
        context.addIssue({ code: 'custom', message: 'not JSON' })
        return z.NEVER
      }
    })
    .pipe(schema)
    .safeParse(text)
  return read.success ? read.data : null
}

/** The link to the HTTP server among those an agent was handed, and null without one. */
function linkOf(servers: readonly McpServer[]): McpLink | null {
  for (const server of servers) {
    if (!('type' in server) || server.type !== 'http') continue
    return {
      url: server.url,
      headers: Object.fromEntries(server.headers.map((header) => [header.name, header.value])),
      protocol: null,
      session: null,
      next: 1,
    }
  }
  return null
}

/** What one request answered: the status, and the result or the error it carried. */
interface Answered {
  readonly status: number
  readonly result: z.infer<typeof RPC_ANSWER>['result'] | null
  readonly error: string | null
}

/**
 * One request of the protocol, and its answer.
 *
 * A notification is sent the same way and answered with nothing, which is what `id: null` says.
 * An answer sent as a stream is read to its event that carries the request's identifier.
 */
async function rpc(
  link: McpLink,
  method: string,
  params: Readonly<Record<string, Json>>,
  notification = false,
): Promise<Answered> {
  const id = notification ? null : link.next++
  const headers = new Headers({
    ...link.headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  })
  if (link.protocol !== null) headers.set('mcp-protocol-version', link.protocol)
  if (link.session !== null) headers.set('mcp-session-id', link.session)
  const response = await fetch(link.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      id === null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params },
    ),
  })
  const opened = response.headers.get('mcp-session-id')
  if (opened !== null) link.session = opened
  const body = await response.text()
  if (!response.ok) return { status: response.status, result: null, error: body }
  if (id === null) return { status: response.status, result: null, error: null }
  // A stream holds its messages on `data:` lines; a plain answer is the message itself.
  const messages = (response.headers.get('content-type') ?? '').includes('text/event-stream')
    ? body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
    : [body]
  for (const message of messages) {
    const read = readAs(RPC_ANSWER, message)
    if (read === null || read.id !== id) continue
    return {
      status: response.status,
      result: read.result ?? null,
      error: read.error?.message ?? null,
    }
  }
  return { status: response.status, result: null, error: 'the server answered nothing' }
}

/** The handshake and the list of tools, which is what an agent does with a server it is handed. */
async function listedOver(link: McpLink): Promise<string[]> {
  const initialized = await rpc(link, 'initialize', {
    protocolVersion: MCP_PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'fake-agent', version: '1.0.0' },
  })
  const version = INITIALIZED.safeParse(initialized.result)
  link.protocol = version.success ? version.data.protocolVersion : MCP_PROTOCOL
  await rpc(link, 'notifications/initialized', {}, true)
  const listed = await rpc(link, 'tools/list', {})
  const tools = TOOLS_LISTED.safeParse(listed.result)
  return tools.success ? tools.data.tools.map((tool) => tool.name) : []
}

/** One tool call over the link, as the answer the fake records and streams back. */
async function calledOver(
  link: McpLink,
  tool: string,
  sent: FakeArguments,
  id: string,
): Promise<FakeToolAnswer> {
  // The call's own identifier rides on `_meta`, under the key Claude Code sends it with: it is
  // the `toolCallId` the agent reports the call under.
  const answered = await rpc(link, 'tools/call', {
    name: tool,
    arguments: { ...sent },
    _meta: { 'claudecode/toolUseId': id },
  })
  const result = TOOL_ANSWERED.safeParse(answered.result)
  if (!result.success) {
    return {
      tool,
      arguments: sent,
      status: answered.status,
      text: answered.error ?? 'the server answered no result',
      isError: true,
    }
  }
  return {
    tool,
    arguments: sent,
    status: answered.status,
    text: result.data.content.map((block) => block.text ?? '').join('\n'),
    isError: result.data.isError === true,
  }
}

/** The kind ACP gives a call of one of Hemera's tools, by what the tool does. */
function kindOfTool(tool: string): NonNullable<ToolCall['kind']> {
  if (tool === 'fs_read' || tool === 'fs_list' || tool.endsWith('_get')) return 'read'
  if (tool === 'fs_write' || tool === 'fs_edit') return 'edit'
  if (tool === 'search') return 'search'
  if (tool.startsWith('commands_')) return 'execute'
  return 'other'
}

/** The path a tool call names, which is the location its `tool_call` points at. */
const PATH_SENT = z.object({ path: z.string() })

/**
 * Whether a prompt is only what Hemera provides: its marker and resources, and no word of anyone's.
 *
 * That is the shape of a delivery (D6-08), and an agent that is handed one has nothing to answer.
 */
function provisionOnly(request: PromptRequest): boolean {
  return (
    request.prompt.some((block) => block.type === 'resource') &&
    request.prompt.every(
      (block) =>
        block.type === 'resource' || (block.type === 'text' && block.text === DELIVERY_MARKER),
    )
  )
}

/** The text of a prompt as it was sent: a scripted agent reads text and ignores the rest. */
function promptTextOf(request: PromptRequest): string {
  return request.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/**
 * Builds the peer and answers the two pipes a client talks to it through, plus what it was asked.
 *
 * The agent is handed to a connection over the SDK's own framing, so a line written into
 * `streams.output` is read as NDJSON and answered on `streams.input` — which is what makes this
 * a peer rather than a stub, and what `fakeSupervisor` hands a runtime as a process.
 */
export function fakeAgent(script: Partial<FakeScript> = {}): FakeAgent {
  const fromClient = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  const answers: FakeTally = {
    optionIds: [],
    cancelled: 0,
    prompts: [],
    mcpServers: [],
    loads: 0,
    resumes: 0,
    cancels: 0,
    choices: [],
    advertised: [],
    metas: [],
    blocks: [],
    tools: [],
    used: [],
  }

  let sessionId = script.nativeSessionId ?? 'native-session'
  // What it announces now, which a choice replaces: the protocol answers a choice with the whole
  // set of options as they stand, and this is that set.
  let announced: SessionConfigOption[] = [...(script.configOptions ?? [])]
  // What a session taken back answers: the options as this process stands, as Claude Code's
  // adapter answers `session/resume` and `session/load` — on its defaults, whatever the session
  // was put on before the process that held it ended. Left out when the script named none.
  const takenBack = (): ResumeSessionResponse =>
    script.configOptions === undefined ? {} : { configOptions: [...announced] }
  let cancelled = false
  let dead = false
  let connection: AgentSideConnection | null = null
  // Who reads its standard error: the supervisor's port hands it every reader it was given.
  const complaints: ((line: string) => void)[] = []

  // The death is announced to whoever is waiting on it, and the promise is the one thing about
  // the agent that outlives the turn that was running: a test reads it whether the script died
  // by itself, by `stop` or by `kill`.
  let announceDeath: () => void = () => undefined
  const exited = new Promise<void>((resolve) => {
    announceDeath = resolve
  })

  const notify = async (step: FakeStep): Promise<void> => {
    const update = updateOf(step)
    // Awaited, so that what the agent says reaches the client before the turn's own answer:
    // the protocol is a stream of messages, and an unawaited notification would let the
    // response overtake the text it answers.
    if (update !== null && !dead) await connection?.sessionUpdate({ sessionId, update })
  }

  const die = (): void => {
    if (dead) return
    dead = true
    cancelled = true
    // What a client sees of a process that died is the stream it reads ending: the protocol has
    // no stop reason for "the agent is gone". Closing it is best effort — a write in flight
    // holds the lock — and the death is what `exited` reports either way.
    void toClient.writable.close().catch(() => undefined)
    announceDeath()
  }

  // The server the agent was handed, once it was handed one and the script reaches for tools.
  const reachesTools =
    script.listsTools === true ||
    [...(script.steps ?? []), ...(script.history ?? []), ...(script.turns ?? []).flat()].some(
      (step) => step.does === 'uses' || step.does === 'usesTogether',
    )
  let link: McpLink | null = null
  let turnsTaken = 0
  let callsMade = 0

  /**
   * What a session was configured with, kept, and the server it names reached (D6-01, D6-11).
   *
   * The three ways into a session carry the same servers, and an agent connects to them on each:
   * a session resumed after a restart is a session whose tools have a new token.
   */
  const handed = async (
    request: NewSessionRequest | LoadSessionRequest | ResumeSessionRequest,
  ): Promise<void> => {
    const { mcpServers: servers = [], _meta: meta } = request
    answers.mcpServers.push([...servers])
    answers.metas.push(meta == null ? null : JSON.stringify(meta))
    if (!reachesTools) return
    link = linkOf(servers)
    if (link === null) return
    // A server that cannot be reached is a session with no tools, which is what the agents do
    // with one: they say nothing and go on, and the list says what the agent could see.
    answers.tools.push(await listedOver(link).catch(() => []))
  }

  /** One tool call over the server, streamed to the client as the agent's own call. */
  const use = async (step: Extract<FakeStep, { does: 'uses' }>): Promise<void> => {
    callsMade += 1
    const id = step.id ?? `hemera-call-${String(callsMade)}`
    const sent = step.arguments ?? {}
    const named = PATH_SENT.safeParse(sent)
    const path = named.success ? named.data.path : null
    if (!dead) {
      await connection?.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: id,
          title: step.call,
          kind: kindOfTool(step.call),
          status: 'in_progress',
          locations: path === null ? [] : [{ path }],
          content: [],
          rawInput: { ...sent },
        },
      })
    }
    const calling: Promise<FakeToolAnswer> =
      link === null
        ? Promise.resolve({
            tool: step.call,
            arguments: sent,
            status: 0,
            text: 'no MCP server',
            isError: true,
          })
        : calledOver(link, step.call, sent, id).catch((cause: Error) => ({
            tool: step.call,
            arguments: sent,
            status: 0,
            text: cause.message,
            isError: true,
          }))
    const patience = step.givesUpAfter
    const answer =
      patience === undefined
        ? await calling
        : await Promise.race([
            calling,
            new Promise<FakeToolAnswer>((resolve) => {
              setTimeout(() => {
                resolve({
                  tool: step.call,
                  arguments: sent,
                  status: 0,
                  text: `no answer after ${String(patience)} ms: the agent stopped waiting`,
                  isError: true,
                })
              }, patience)
            }),
          ])
    answers.used.push(answer)
    if (dead) return
    await connection?.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: id,
        status: answer.isError ? 'failed' : 'completed',
        content: [{ type: 'content', content: { type: 'text', text: answer.text } }],
        rawOutput: { text: answer.text },
      },
    })
  }

  const agent: AcpAgent = {
    initialize: async (request) => {
      // What the client said about itself, kept as it arrived: this is how a suite proves that
      // an extension Hemera advertises really reached the agent that reads it.
      answers.advertised.push(JSON.stringify(request.clientCapabilities))
      await script.holdsStart?.()
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: script.continues === true,
          // What the three agents advertise, and what a provision of Hemera's is carried by (D6-07).
          promptCapabilities: { embeddedContext: true },
          // Advertised unless the script says otherwise, and whether the answer is an error is the
          // script's: the fallback a refused resume forces is a path Hemera has to walk, and a
          // capability it never sees is a path no test can reach. `advertisesResume: false` is that
          // last path — an agent that can only be loaded, which is what the load-with-dedup step of
          // D5-07 is for.
          sessionCapabilities: script.advertisesResume === false ? {} : { resume: {} },
        },
        authMethods: [...(script.authMethods ?? [])],
        agentInfo: { name: 'Fake agent', version: '1.0.0' },
      }
    },
    newSession: async (request: NewSessionRequest) => {
      await handed(request)
      const opened: NewSessionResponse = { sessionId }
      // Left out when the script named none, for the reason a tool call leaves out what it does
      // not say: an agent that announces no options is not an agent that announces zero.
      if (script.configOptions !== undefined) opened.configOptions = [...announced]
      return opened
    },
    setSessionConfigOption: (request) => {
      answers.choices.push(`${request.configId}=${String(request.value)}`)
      // The whole set as it stands, which is what the protocol answers with: a script that says
      // what a choice reveals says it here, and one that says nothing announces the same list.
      if (script.onChoice !== undefined) {
        announced = [...script.onChoice({ id: request.configId, value: String(request.value) })]
      }
      return { configOptions: [...announced] }
    },
    loadSession: async (request: LoadSessionRequest): Promise<LoadSessionResponse> => {
      answers.loads += 1
      if (script.refusesLoad === true) throw new Error('this agent refuses to load a session')
      await handed(request)
      sessionId = request.sessionId
      for (const step of script.history ?? []) {
        // oxlint-disable-next-line no-await-in-loop -- a scripted agent replays its history in the order it was written, one message at a time
        await notify(step)
      }
      return takenBack()
    },
    resumeSession: async (request: ResumeSessionRequest): Promise<ResumeSessionResponse> => {
      answers.resumes += 1
      if (script.refusesResume === true) throw new Error('this agent refuses to resume a session')
      await handed(request)
      sessionId = request.sessionId
      return takenBack()
    },
    authenticate: () => undefined,
    cancel: () => {
      answers.cancels += 1
      // An agent that ignores the cancel is not an agent the protocol allows; it is the one
      // Hemera meets in the wild, and the turn it holds open is what a Stop has to survive.
      if (script.ignoresCancel !== true) cancelled = true
    },
    prompt: async (request: PromptRequest): Promise<PromptResponse> => {
      cancelled = false
      const text = promptTextOf(request)
      answers.prompts.push(text)
      answers.blocks.push([...request.prompt])
      script.onPrompt?.(text)
      // A prompt that is only what Hemera provides — the marker and its resources, no word of the
      // user's — is a delivery (D6-08): the agent takes it in and has nothing to do about it.
      if (provisionOnly(request)) {
        await script.holdsDelivery?.()
        if (cancelled) return { stopReason: 'cancelled' }
        for (const step of script.answersDelivery ?? []) {
          // oxlint-disable-next-line no-await-in-loop -- what it says is sent in order
          await notify(step)
        }
        return { stopReason: 'end_turn' }
      }
      const scripted = script.turns?.[turnsTaken] ?? script.steps ?? []
      turnsTaken += 1
      for (const step of scripted) {
        if (cancelled) break
        // oxlint-disable-next-line no-await-in-loop -- the script is a sequence, and a test holds a turn open here
        await script.between?.()
        if (cancelled) break
        if (step.does === 'uses') {
          // oxlint-disable-next-line no-await-in-loop -- a tool is answered before the agent does anything with the answer
          await use(step)
          continue
        }
        if (step.does === 'complains') {
          for (const read of complaints) read(step.line)
          continue
        }
        if (step.does === 'requests') {
          // oxlint-disable-next-line no-await-in-loop -- a request is answered before the agent goes on, as it would wait on it
          await connection?.extMethod(step.method, {}).catch(() => undefined)
          continue
        }
        if (step.does === 'usesTogether') {
          // oxlint-disable-next-line no-await-in-loop -- the calls of one step run together, and the next step waits for all of them
          await Promise.all(step.calls.map(use))
          continue
        }
        if (step.does !== 'asks') {
          // oxlint-disable-next-line no-await-in-loop -- what it says is sent before what it says next, and there is nothing to run in parallel
          await notify(step)
          continue
        }
        const held = connection
        if (held === null) return { stopReason: 'end_turn' }
        // oxlint-disable-next-line no-await-in-loop -- a question is answered before the next step happens: the protocol has no second question in flight
        const answered: RequestPermissionResponse = await held.requestPermission({
          sessionId,
          toolCall: { toolCallId: step.call.id, title: step.call.title },
          options: step.call.options.map((option) => ({
            optionId: option.id,
            name: option.name,
            kind: option.kind,
          })),
        })
        if (answered.outcome.outcome === 'cancelled') answers.cancelled += 1
        else answers.optionIds.push(answered.outcome.optionId)
      }
      if (cancelled) return { stopReason: 'cancelled' }
      if (script.failsPrompt !== undefined) throw new RequestError(-32_603, script.failsPrompt)
      const answer: PromptResponse = { stopReason: script.stopReason ?? 'end_turn' }
      if (script.usage !== undefined) answer.usage = script.usage
      return answer
    },
  }

  connection = new AgentSideConnection(
    () => agent,
    ndJsonStream(toClient.writable, fromClient.readable),
  )

  return {
    script,
    answers,
    streams: { input: toClient.readable, output: fromClient.writable },
    input: fromClient.writable,
    output: toClient.readable,
    starts: [],
    environments: [],
    onStderr: (read) => {
      complaints.push(read)
    },
    die,
    exited,
  }
}

/** A pid that is a number and belongs to no process: what reads it has something to read. */
const FAKE_PID = 4_242

/**
 * One fake agent, as the supervisor's port describes a process.
 *
 * The two pipes are the whole of it: `write` puts a line into the agent's standard input,
 * `onStdout` hands over the lines it writes, and the death is the one `die` announces. Nothing
 * is spawned and no signal is sent, so a test that injects this layer drives the runtime end to
 * end with no program on the machine.
 */
function supervisedOf(agent: FakeAgent): SupervisedProcess {
  const encoder = new TextEncoder()
  // One writer for the life of the process: a stream lends its lock to one writer, and the lines
  // of a turn have to reach the agent in the order they were written.
  const writer = agent.streams.output.getWriter()
  // Every reader is handed every line, which is what the real port does: a second `onStdout`
  // there adds a second listener, and a fake that refused one would refuse a wiring the
  // supervisor allows.
  const readers: ((line: string) => void)[] = []
  let pumping = false

  const pump = (): void => {
    if (pumping) return
    pumping = true
    const reader = agent.streams.input.getReader()
    const decoder = new TextDecoder()
    let carried = ''
    const loop = async (): Promise<void> => {
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- a reader is read one chunk at a time: the next chunk is what the loop is waiting for, and there is nothing to run beside it
        const { value, done } = await reader.read()
        if (done) return
        carried += decoder.decode(value, { stream: true })
        // A chunk is not a line: what is carried over is the half of a message that has not
        // arrived yet, and handing it over early would be an agent reading half a request.
        const lines = carried.split('\n')
        carried = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') continue
          for (const read of readers) read(line)
        }
      }
    }
    // A pipe that ends or breaks is the death of the agent, which `exited` reports: a rejection
    // here would be the same news told twice, and there is nothing left to tell it to.
    void loop().catch(() => undefined)
  }

  // The two stops are one here: there is no tree to signal and no grace to spend, so both are
  // the same death. A test tells them apart by what the engine does with them, not by the fake.
  const end = (): Effect.Effect<void> =>
    Effect.promise(async () => {
      agent.die()
      await agent.exited
    })

  return {
    pid: FAKE_PID,
    exited: Effect.promise(async () => {
      await agent.exited
      // The fake ends the way a program that made up its mind does: what the engine acts on is
      // that the death was seen, and a signal would be a claim about a process that never ran.
      return { code: 0, signal: null, when: new Date().toISOString() } satisfies ExitObservation
    }),
    write: (line) =>
      Effect.promise(() => writer.write(encoder.encode(line.endsWith('\n') ? line : `${line}\n`))),
    closeInput: Effect.promise(() => writer.close()),
    stop: end(),
    kill: end(),
    onStdout: (read) => {
      readers.push(read)
      pump()
    },
    // What a script writes there with a `complains` step, handed to every reader as the real
    // port does.
    onStderr: (read) => {
      agent.onStderr(read)
    },
  }
}

/**
 * The `ProcessSupervisor` a test injects, over one fake agent (D5-16).
 *
 * `start` answers a process and registers it with the scope it was started in, exactly as the
 * real one does: a suite that closes its scope takes the agent with it, so no fake outlives the
 * test that made it. What this layer never does is start a child.
 */
export function fakeSupervisor(agent: FakeAgent): Layer.Layer<ProcessSupervisor> {
  return fakeSupervisorOf(() => agent)
}

/**
 * The same supervisor, asked which fake to hand over at every start.
 *
 * A fake dies when it is stopped and a dead one cannot speak again, so a suite about what
 * happens *after* an agent was let go — the probe of a Home the pool closed, and the next
 * choice made in that composer — needs a second one. It is a suite's own business which,
 * hence a question rather than a list here.
 *
 * `before` is awaited at every start, so a suite can hold one open: a start is a spawn, a
 * handshake and a `session/new`, and what the window shows while those are happening can only be
 * read while they still are.
 */
export function fakeSupervisorOf(
  next: () => FakeAgent,
  before: () => Promise<void> = () => Promise.resolve(),
): Layer.Layer<ProcessSupervisor> {
  return Layer.succeed(ProcessSupervisor, fakeSupervisorService(next, before))
}

/**
 * The same supervisor as a service rather than a layer, for a suite that composes it.
 *
 * A suite that runs real commands beside a fake agent needs one supervisor that answers both —
 * a command is a process of the machine, the agent is this peer — and it builds that supervisor
 * out of the real one and this.
 */
export function fakeSupervisorService(
  next: () => FakeAgent,
  before: () => Promise<void> = () => Promise.resolve(),
): ProcessSupervisorService {
  return {
    start: (command, _args, options) =>
      Effect.acquireRelease(
        Effect.map(Effect.promise(before), () => {
          const agent = next()
          // Recorded on the agent itself, so a suite can say what was started — and, which is
          // the point of D5-17, what was not.
          agent.starts.push(command)
          agent.environments.push({ ...options.env })
          return supervisedOf(agent)
        }),
        (process) => process.stop,
      ),
  }
}
