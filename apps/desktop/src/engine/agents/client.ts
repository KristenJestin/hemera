/**
 * The ACP client: the only code of Hemera that speaks the Agent Client Protocol.
 *
 * It speaks over a pair of line-oriented streams, the lines an agent writes and a way to write it
 * one, so it does not know how the agent was started: the agents' process link gives those in
 * production, the fake agent gives them in memory. The framing, the request ids and the
 * validation of what arrives are the SDK's; what is Hemera's is the reading of what comes back,
 * in Hemera's own typed events, options and errors.
 *
 * A permission request from the agent is answered here, by the `AgentPermissionAnswer` port, and
 * never shown to the user: in bare mode the agent has no tool but Hemera's, whose calls meet
 * Hemera's own gate, which asks the one human question there is.
 */

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AnyMessage,
  type Client as AcpClient,
  type ContentBlock,
  type McpServer,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionConfigSelectOptions,
  type SessionModeState,
  type SessionNotification,
  type ToolCallContent,
  type Usage,
} from '@agentclientprotocol/sdk'
import type { AgentsProcessGone } from '@hemera/ipc'
import {
  Context,
  Deferred,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Queue,
  Result,
  Schema,
  Stream,
} from 'effect'
import type { Cause, Scope } from 'effect'

import type { AgentsProcess } from '../agents.ts'

// ---------------------------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------------------------

/** The two line-oriented streams the protocol is spoken over: one JSON message per line. */
export interface LineTransport<E> {
  /** Every line the agent writes, until it ends. */
  readonly lines: Stream.Stream<string, E>
  /** Writes one line to the agent, without its line break. */
  readonly write: (line: string) => Effect.Effect<void, E>
}

/**
 * The transport of an agents' process: its output lines carry the protocol, and its error lines
 * go to `onDiagnostic`, read from the same stream so it is consumed once.
 */
export const processTransport = (
  process: AgentsProcess,
  onDiagnostic: (line: string) => void,
): LineTransport<AgentsProcessGone> => ({
  lines: process.output.pipe(
    Stream.filterMap((line) =>
      Match.value(line).pipe(
        Match.tagsExhaustive({
          Output: ({ line: said }) => Result.succeed(said),
          Diagnostic: ({ line: said }) => {
            onDiagnostic(said)
            return Result.fail(said)
          },
        }),
      ),
    ),
  ),
  write: process.write,
})

/** Which way a message went: `in` is the agent speaking to Hemera, `out` Hemera to the agent. */
export type Direction = 'in' | 'out'

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** The agent answered a request with an error, or with something the client could not read. */
export class AgentProtocolError extends Schema.TaggedError<AgentProtocolError>()(
  'AgentProtocolError',
  { method: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `The agent refused ${this.method}: ${this.reason}`
  }
}

/** The agent is gone: its process ended, or the connection was closed. */
export class AgentGone extends Schema.TaggedError<AgentGone>()('AgentGone', {}) {
  override get message(): string {
    return 'The agent stopped.'
  }
}

/**
 * The model chosen is not one the agent took. Named after the model asked for, and never after
 * the one the agent offered or stayed on instead: a model is never silently replaced.
 */
export class ModelUnavailable extends Schema.TaggedError<ModelUnavailable>()('ModelUnavailable', {
  model: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `The model ${this.model} is unavailable: ${this.reason}`
  }
}

/** A prompt holds an image and the agent said at the handshake that it takes none. */
export class ImageNotAccepted extends Schema.TaggedError<ImageNotAccepted>()(
  'ImageNotAccepted',
  {},
) {
  override get message(): string {
    return 'This agent does not accept images.'
  }
}

// ---------------------------------------------------------------------------------------------
// What the agent says, in Hemera's words
// ---------------------------------------------------------------------------------------------

/**
 * How many characters of one text an event carries. What a tool printed can be megabytes, and
 * the client keeps no more than this of it in memory; the agent still has the whole of it.
 */
export const TEXT_LIMIT = 64 * 1024

const bounded = (text: string): string =>
  text.length <= TEXT_LIMIT
    ? text
    : `${text.slice(0, TEXT_LIMIT)}‹+${String(text.length - TEXT_LIMIT)} chars›`

export const AgentOptionValue = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The agent's own sentence about the value. */
  description: Schema.NullOr(Schema.String),
  /** Whether the agent named this value as the one it recommends. */
  recommended: Schema.Boolean,
})
export type AgentOptionValue = typeof AgentOptionValue.Type

/**
 * One option the agent offers a session (model, effort, mode…), in the agent's own words. `value`
 * is what the session is on now, and `defaultValue` what the agent put it on by itself, before
 * anything was chosen. A boolean's values are `true` and `false`, as text.
 */
export const AgentOption = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** `model`, `mode`, `thought_level`, or null when the agent did not say. */
  category: Schema.NullOr(Schema.String),
  kind: Schema.Literals(['select', 'boolean']),
  value: Schema.String,
  defaultValue: Schema.String,
  values: Schema.Array(AgentOptionValue),
})
export type AgentOption = typeof AgentOption.Type

/** The modes the agent reports, kept as data: nothing reads a mode to decide anything. */
export const AgentModes = Schema.Struct({
  currentModeId: Schema.String,
  available: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
})
export type AgentModes = typeof AgentModes.Type

/** What a call printed, as text; what is not text is named by its media type alone. */
export const CallContent = Schema.TaggedStruct('Content', {
  text: Schema.String,
  mime: Schema.NullOr(Schema.String),
})
export const CallDiff = Schema.TaggedStruct('Diff', {
  path: Schema.String,
  oldText: Schema.NullOr(Schema.String),
  newText: Schema.String,
})
export const CallTerminal = Schema.TaggedStruct('Terminal', { terminalId: Schema.String })
export const ToolCallContentBlock = Schema.Union([CallContent, CallDiff, CallTerminal])
export type ToolCallContentBlock = typeof ToolCallContentBlock.Type

/**
 * A tool call, as first reported or as updated. An update carries only what changed: a null
 * field, or an empty list, is one the update does not touch.
 */
export const ToolCallReport = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  kind: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
  locations: Schema.Array(
    Schema.Struct({ path: Schema.String, line: Schema.NullOr(Schema.Number) }),
  ),
  content: Schema.Array(ToolCallContentBlock),
  /** What the tool was called with and what it answered, as the JSON the agent sent. */
  rawInput: Schema.NullOr(Schema.String),
  rawOutput: Schema.NullOr(Schema.String),
})
export type ToolCallReport = typeof ToolCallReport.Type

/** True for what a session sends back while it is loaded: history Hemera already holds. */
const replay = Schema.Boolean

export const MessageChunk = Schema.TaggedStruct('MessageChunk', {
  text: Schema.String,
  messageId: Schema.NullOr(Schema.String),
  replay,
})
export const ThoughtChunk = Schema.TaggedStruct('ThoughtChunk', {
  text: Schema.String,
  messageId: Schema.NullOr(Schema.String),
  replay,
})
export const ToolCall = Schema.TaggedStruct('ToolCall', { call: ToolCallReport, replay })
export const Plan = Schema.TaggedStruct('Plan', {
  entries: Schema.Array(Schema.Struct({ content: Schema.String, status: Schema.String })),
  replay,
})
/** The context window, as the agent reports it: how much is used, out of how much. */
export const UsageReport = Schema.TaggedStruct('Usage', {
  used: Schema.Number,
  size: Schema.Number,
  cost: Schema.NullOr(Schema.Struct({ amount: Schema.Number, currency: Schema.String })),
  replay,
})
export const ModeChanged = Schema.TaggedStruct('ModeChanged', { modeId: Schema.String, replay })
export const OptionsChanged = Schema.TaggedStruct('OptionsChanged', {
  options: Schema.Array(AgentOption),
  replay,
})

/** The conversation compacted: what was said earlier is now a summary of it. */
export const Compacted = Schema.TaggedStruct('Compacted', { replay })
/**
 * The agent waits on its provider (a retry, a rate limit, a connection lost): a pause that is not
 * the session's own silence.
 */
export const ProviderWait = Schema.TaggedStruct('ProviderWait', { title: Schema.String, replay })

/** What an agent reports while it works. */
export const AgentEvent = Schema.Union([
  Compacted,
  ProviderWait,
  MessageChunk,
  ThoughtChunk,
  ToolCall,
  Plan,
  UsageReport,
  ModeChanged,
  OptionsChanged,
])
export type AgentEvent = typeof AgentEvent.Type

/** What the agent said about itself at `initialize`. */
export const AgentHandshake = Schema.Struct({
  protocolVersion: Schema.Number,
  agentName: Schema.NullOr(Schema.String),
  agentVersion: Schema.NullOr(Schema.String),
  /** The ways in it announces: what each agent's adapter reads to tell whether it is signed in. */
  authMethods: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  /** Whether it takes `session/load`. */
  loads: Schema.Boolean,
  /** Whether it takes `session/resume`. */
  resumes: Schema.Boolean,
  /** Whether a prompt may hold images. */
  images: Schema.Boolean,
  /** Whether a prompt may hold embedded resources. */
  embeddedContext: Schema.Boolean,
})
export type AgentHandshake = typeof AgentHandshake.Type

export const TokenUsage = Schema.Struct({
  totalTokens: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  thoughtTokens: Schema.NullOr(Schema.Number),
})

/**
 * How a turn ended: the agent's stop reason, or `interrupted` when the agent died before it
 * answered.
 */
export const PromptOutcome = Schema.Struct({
  stopReason: Schema.Literals([
    'end_turn',
    'max_tokens',
    'max_turn_requests',
    'refusal',
    'cancelled',
    'interrupted',
  ]),
  usage: Schema.NullOr(TokenUsage),
})
export type PromptOutcome = typeof PromptOutcome.Type

// ---------------------------------------------------------------------------------------------
// What Hemera sends
// ---------------------------------------------------------------------------------------------

export const TextBlock = Schema.TaggedStruct('Text', { text: Schema.String })
/** A text handed over as an `embedded_resource`, such as a system prompt. */
export const ResourceBlock = Schema.TaggedStruct('Resource', {
  uri: Schema.String,
  mimeType: Schema.String,
  text: Schema.String,
})
/** An image, as base64; sent only to an agent whose handshake accepts images. */
export const ImageBlock = Schema.TaggedStruct('Image', {
  mimeType: Schema.String,
  data: Schema.String,
})
export const PromptBlock = Schema.Union([TextBlock, ResourceBlock, ImageBlock])
export type PromptBlock = typeof PromptBlock.Type

/**
 * What a session is opened, resumed or loaded with. The servers and `_meta` are built elsewhere
 * (the bare options of each agent) and handed over as they are.
 */
export interface SessionOpening {
  readonly cwd: string
  readonly mcpServers: ReadonlyArray<McpServer>
  readonly meta?: Schema.JsonObject | undefined
}

// ---------------------------------------------------------------------------------------------
// Permission requests
// ---------------------------------------------------------------------------------------------

/** A permission request from the agent, as the port reads it. */
export interface PermissionQuestion {
  readonly toolCallId: string
  readonly title: string
  /** The tool it is about: Claude Code names it in `_meta`; the other agents' title is it. */
  readonly tool: string
  readonly options: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly kind: string
  }>
}

/** What the port decides; the client picks the agent's option of that kind. */
export type PermissionVerdict = 'allow_once' | 'reject'

export class AgentPermissionAnswer extends Context.Service<
  AgentPermissionAnswer,
  { readonly answer: (question: PermissionQuestion) => Effect.Effect<PermissionVerdict> }
>()('AgentPermissionAnswer') {}

/** Whether a tool is Hemera's: `mcp__hemera__…` for Claude Code, `hemera_…` for the others. */
export const isHemeraTool = (tool: string): boolean =>
  tool.startsWith('mcp__hemera__') || tool.startsWith('hemera_')

/**
 * The default answer: `allow_once` for a Hemera tool, whose call then meets Hemera's own gate,
 * and `reject` for anything else, which bare mode should never let the agent reach.
 */
export const defaultPermissionAnswerLayer = Layer.succeed(AgentPermissionAnswer, {
  answer: (question) => Effect.succeed(isHemeraTool(question.tool) ? 'allow_once' : 'reject'),
})

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

/** Where Claude Code names the tool a permission is about. */
const readClaudeTool = Schema.decodeUnknownOption(
  Schema.Struct({ claudeCode: Schema.Struct({ toolName: Schema.String }) }),
)

const questionOf = (request: RequestPermissionRequest): PermissionQuestion => {
  const title = request.toolCall.title ?? ''
  return {
    toolCallId: request.toolCall.toolCallId,
    title,
    // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
    tool: Option.match(readClaudeTool(request.toolCall._meta), {
      onNone: () => title,
      onSome: (meta) => meta.claudeCode.toolName,
    }),
    options: request.options.map((option) => ({
      id: option.optionId,
      name: option.name,
      kind: option.kind,
    })),
  }
}

/** The agent's option for a verdict; none offered is a refusal, said as `cancelled`. */
const responseOf = (
  verdict: PermissionVerdict,
  request: RequestPermissionRequest,
): RequestPermissionResponse => {
  const kinds = verdict === 'allow_once' ? ['allow_once'] : ['reject_once', 'reject_always']
  const chosen = kinds
    .map((kind) => request.options.find((option) => option.kind === kind))
    .find((option) => option !== undefined)
  return chosen === undefined
    ? CANCELLED
    : { outcome: { outcome: 'selected', optionId: chosen.optionId } }
}

// ---------------------------------------------------------------------------------------------
// Reading the options
// ---------------------------------------------------------------------------------------------

/**
 * What Hemera advertises at `initialize` beside the protocol: the AIR extension's recommended
 * value, which asks the Claude adapter to resolve its own `Default` entries and name, in each
 * option's `_meta`, the value it recommends. An agent that does not know it ignores it.
 */
const CLIENT_META = {
  jetbrains: { air: { version: 1, capabilities: ['recommendedValue', 'sessionFailure'] } },
}

const readRecommended = Schema.decodeUnknownOption(
  Schema.Struct({
    jetbrains: Schema.Struct({
      air: Schema.Struct({ version: Schema.Literal(1), recommendedValue: Schema.String }),
    }),
  }),
)

const DEFAULT_VALUE = 'default'

/**
 * The value a `Default` entry stands for, when the agent says which: the value it recommends,
 * or the one whose name `Default`'s description spells out (the longest such name, so that
 * `Opus 4.5` is not read as `Opus 4`). Nothing is guessed beyond that.
 */
const namedByDefault = (values: ReadonlyArray<AgentOptionValue>): AgentOptionValue | null => {
  const others = values.filter((value) => value.id !== DEFAULT_VALUE)
  const recommended = others.find((value) => value.recommended)
  if (recommended !== undefined) return recommended
  const said = (values.find((value) => value.id === DEFAULT_VALUE)?.description ?? '')
    .trim()
    .toLowerCase()
  if (said === '') return null
  return others
    .filter((value) => said.includes(value.name.toLowerCase()) || said === value.id.toLowerCase())
    .reduce<AgentOptionValue | null>(
      (longest, value) =>
        longest === null || value.name.length > longest.name.length ? value : longest,
      null,
    )
}

/**
 * The values of a select, with a `Default` entry the agent named replaced by the value it stands
 * for, marked recommended; a `Default` it does not name stays as it is. Never both.
 */
const selectOf = (
  options: SessionConfigSelectOptions,
  current: string,
  recommended: string | null,
) => {
  const choices = options.flatMap((choice) => ('value' in choice ? [choice] : choice.options))
  const valuesOf = (marked: string | null) =>
    choices.map((choice) => ({
      id: choice.value,
      name: choice.name,
      description: choice.description ?? null,
      recommended: choice.value === marked,
    }))
  const values = valuesOf(recommended)
  if (!values.some((value) => value.id === DEFAULT_VALUE)) return { values, value: current }
  const named = namedByDefault(values)
  if (named === null) return { values, value: current }
  return {
    values: valuesOf(named.id).filter((value) => value.id !== DEFAULT_VALUE),
    value: current === DEFAULT_VALUE ? named.id : current,
  }
}

/** The options as the agent announces them, each with the default first seen for it. */
const optionsOf = (
  announced: ReadonlyArray<SessionConfigOption> | null | undefined,
  defaults: Map<string, string>,
): ReadonlyArray<AgentOption> =>
  (announced ?? []).map((option) => {
    const read =
      option.type === 'boolean'
        ? { values: [], value: String(option.currentValue), kind: 'boolean' as const }
        : {
            kind: 'select' as const,
            ...selectOf(
              option.options,
              option.currentValue,
              // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
              Option.match(readRecommended(option._meta), {
                onNone: () => null,
                onSome: (meta) => meta.jetbrains.air.recommendedValue,
              }),
            ),
          }
    if (!defaults.has(option.id)) defaults.set(option.id, read.value)
    return {
      id: option.id,
      name: option.name,
      category: option.category ?? null,
      kind: read.kind,
      value: read.value,
      defaultValue: defaults.get(option.id) ?? read.value,
      values: read.values,
    }
  })

const isModel = (option: AgentOption | undefined): boolean =>
  option !== undefined && (option.category === 'model' || option.id === 'model')

const isMode = (option: AgentOption): boolean => option.category === 'mode' || option.id === 'mode'

const modesOf = (modes: SessionModeState | null | undefined): AgentModes | null =>
  modes == null
    ? null
    : {
        currentModeId: modes.currentModeId,
        available: modes.availableModes.map((mode) => ({ id: mode.id, name: mode.name })),
      }

// ---------------------------------------------------------------------------------------------
// Reading the updates
// ---------------------------------------------------------------------------------------------

const textOf = (content: ContentBlock): string | null =>
  content.type === 'text' ? bounded(content.text) : null

/** One block of a call: its words, and what is not words named by its media type. */
const contentOf = (blocks: ReadonlyArray<ToolCallContent>): ReadonlyArray<ToolCallContentBlock> =>
  blocks.map((block) => {
    if (block.type === 'diff') {
      return CallDiff.make({
        path: block.path,
        oldText: block.oldText == null ? null : bounded(block.oldText),
        newText: bounded(block.newText),
      })
    }
    if (block.type === 'terminal') return CallTerminal.make({ terminalId: block.terminalId })
    const said = block.content
    if (said.type === 'text') return CallContent.make({ text: bounded(said.text), mime: null })
    if (said.type === 'resource') {
      const text = 'text' in said.resource ? bounded(said.resource.text) : ''
      return CallContent.make({ text, mime: said.resource.mimeType ?? null })
    }
    if (said.type === 'resource_link') {
      return CallContent.make({ text: said.uri, mime: said.mimeType ?? null })
    }
    return CallContent.make({ text: '', mime: said.mimeType })
  })

const readJson = Schema.decodeUnknownOption(Schema.Json)

/** What a tool was called with or answered, as the JSON the agent sent; null when it said none. */
const rawOf = (raw: Option.Option<Schema.Json>): string | null =>
  Option.match(raw, {
    onNone: () => null,
    onSome: (json) => (json === null ? null : bounded(JSON.stringify(json))),
  })

/**
 * Claude Code's adapter reports a compaction as a synthetic tool call marked
 * `_meta.contextCompaction`; it is a compaction once it completed.
 */
const readCompaction = Schema.decodeUnknownOption(
  Schema.Struct({ contextCompaction: Schema.Struct({}) }),
)

/**
 * A notice of a failing provider, as the adapter sends it to a client that announced the
 * `sessionFailure` extension: a warning is a wait (a retry in progress); an error is not.
 */
const readProviderNotice = Schema.decodeUnknownOption(
  Schema.Struct({
    jetbrains: Schema.Struct({
      air: Schema.Struct({
        sessionFailure: Schema.Struct({ severity: Schema.String, title: Schema.String }),
      }),
    }),
  }),
)

/** A notification, as an event, or null for what Hemera does not read. */
const eventOf = (notification: SessionNotification, replaying: boolean): AgentEvent | null => {
  const update = notification.update
  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
  const meta = '_meta' in update ? update._meta : undefined
  if (
    (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
    update.status === 'completed' &&
    Option.isSome(readCompaction(meta))
  ) {
    return Compacted.make({ replay: replaying })
  }
  switch (update.sessionUpdate) {
    case 'session_info_update':
      return Option.match(readProviderNotice(meta), {
        onNone: () => null,
        onSome: ({ jetbrains }) =>
          jetbrains.air.sessionFailure.severity === 'warning'
            ? ProviderWait.make({ title: jetbrains.air.sessionFailure.title, replay: replaying })
            : null,
      })
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      if (text === null) return null
      const fields = { text, messageId: update.messageId ?? null, replay: replaying }
      return update.sessionUpdate === 'agent_message_chunk'
        ? MessageChunk.make(fields)
        : ThoughtChunk.make(fields)
    }
    case 'tool_call':
    case 'tool_call_update':
      return ToolCall.make({
        replay: replaying,
        call: {
          id: update.toolCallId,
          title: update.title ?? null,
          kind: update.kind ?? null,
          status: update.status ?? null,
          locations: (update.locations ?? []).map((location) => ({
            path: location.path,
            line: location.line ?? null,
          })),
          content: contentOf(update.content ?? []),
          rawInput: rawOf(readJson(update.rawInput)),
          rawOutput: rawOf(readJson(update.rawOutput)),
        },
      })
    case 'plan':
      return Plan.make({
        replay: replaying,
        entries: update.entries.map((entry) => ({
          content: bounded(entry.content),
          status: entry.status,
        })),
      })
    case 'usage_update':
      return UsageReport.make({
        replay: replaying,
        used: update.used,
        size: update.size,
        cost:
          update.cost == null
            ? null
            : { amount: update.cost.amount, currency: update.cost.currency },
      })
    default:
      return null
  }
}

const usageOf = (usage: Usage | null | undefined) =>
  usage == null
    ? null
    : {
        totalTokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtTokens: usage.thoughtTokens ?? null,
      }

const blockOf = (block: PromptBlock, embeds: boolean): ContentBlock =>
  Match.value(block).pipe(
    Match.tagsExhaustive({
      Text: ({ text }): ContentBlock => ({ type: 'text', text }),
      // An agent that takes no embedded resource gets the same text under its address.
      Resource: ({ uri, mimeType, text }): ContentBlock =>
        embeds
          ? { type: 'resource', resource: { uri, mimeType, text } }
          : { type: 'text', text: `${uri}\n${text}` },
      Image: ({ mimeType, data }): ContentBlock => ({ type: 'image', mimeType, data }),
    }),
  )

// ---------------------------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------------------------

/** One session of an agent, opened, resumed or loaded on a connection. */
export interface AgentSession {
  /** The agent's own id for the session: what a later resume or load names. */
  readonly nativeSessionId: string
  /** The modes the agent reported when the session opened, as data, or null for none. */
  readonly modes: AgentModes | null
  /** The options the session offers, as the agent last said them. */
  readonly options: () => ReadonlyArray<AgentOption>
  /**
   * Puts the session on a value of one option, through `session/set_config_option`, and answers
   * the options as the agent says they now are. A model the agent refuses, does not offer, or
   * does not take is `ModelUnavailable`, naming the model asked for.
   */
  readonly setOption: (
    optionId: string,
    value: string,
  ) => Effect.Effect<ReadonlyArray<AgentOption>, AgentProtocolError | ModelUnavailable | AgentGone>
  /** One turn, answered once the agent is done with it, or `interrupted` if it died first. */
  readonly prompt: (
    blocks: ReadonlyArray<PromptBlock>,
  ) => Effect.Effect<PromptOutcome, AgentProtocolError | ImageNotAccepted | AgentGone>
  /** Asks the agent to stop the turn; any permission request still standing is cancelled. */
  readonly cancel: Effect.Effect<void, AgentGone>
}

export interface AgentConnection {
  readonly handshake: AgentHandshake
  /** What the agent reports, in order; the stream ends when the agent does. One reader. */
  readonly events: Stream.Stream<AgentEvent>
  /** Whether a request of the agent is waiting on Hemera's answer. */
  readonly waiting: () => boolean
  /** Completes once the agent is gone. */
  readonly gone: Effect.Effect<void>
  readonly newSession: (
    opening: SessionOpening,
  ) => Effect.Effect<AgentSession, AgentProtocolError | AgentGone>
  readonly resumeSession: (
    nativeSessionId: string,
    opening: SessionOpening,
  ) => Effect.Effect<AgentSession, AgentProtocolError | AgentGone>
  /** Loads a session: what the agent replays while it does is marked `replay`. */
  readonly loadSession: (
    nativeSessionId: string,
    opening: SessionOpening,
  ) => Effect.Effect<AgentSession, AgentProtocolError | AgentGone>
}

export interface ConnectOptions<E> {
  readonly transport: LineTransport<E>
  /** Hears every message, both ways, as it crosses: the ACP trace. */
  readonly trace?: ((direction: Direction, message: AnyMessage) => void) | undefined
}

/** One line read as a JSON object; the SDK checks its shape before any handler sees it. */
const readMessage = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject))

/**
 * Connects to an agent over a transport and shakes hands with it. The connection lives as long
 * as the scope: closing the scope stops reading the agent, which closes the connection.
 */
export const connect = <E>(
  options: ConnectOptions<E>,
): Effect.Effect<
  AgentConnection,
  AgentProtocolError | AgentGone,
  Scope.Scope | AgentPermissionAnswer
> =>
  Effect.gen(function* () {
    const port = yield* AgentPermissionAnswer
    const events = yield* Queue.unbounded<AgentEvent, Cause.Done>()
    const ended = yield* Deferred.make<void>()
    const trace = options.trace ?? (() => undefined)
    /** The permission requests standing, each ended `cancelled` by a cancel or the agent's end. */
    const standing = new Set<Deferred.Deferred<void>>()
    const cancelStanding = Effect.suspend(() =>
      Effect.forEach([...standing], (stop) => Deferred.succeed(stop, undefined), { discard: true }),
    )

    let replaying = false
    /** The session's options as the agent last said them, and its modes. */
    let announced: ReadonlyArray<AgentOption> = []
    const defaults = new Map<string, string>()

    const emit = (event: AgentEvent | null): void => {
      if (event !== null) Queue.offerUnsafe(events, event)
    }

    const client: AcpClient = {
      requestPermission: (request) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const stop = yield* Deferred.make<void>()
            standing.add(stop)
            return yield* port.answer(questionOf(request)).pipe(
              Effect.map((verdict) => responseOf(verdict, request)),
              Effect.raceFirst(Effect.as(Deferred.await(stop), CANCELLED)),
              Effect.ensuring(Effect.sync(() => standing.delete(stop))),
            )
          }),
        ),
      sessionUpdate: (notification) => {
        const update = notification.update
        if (update.sessionUpdate === 'config_option_update') {
          announced = optionsOf(update.configOptions, defaults)
          return emit(OptionsChanged.make({ options: announced, replay: replaying }))
        }
        if (update.sessionUpdate === 'current_mode_update') {
          announced = announced.map((option) =>
            isMode(option) ? { ...option, value: update.currentModeId } : option,
          )
          return emit(ModeChanged.make({ modeId: update.currentModeId, replay: replaying }))
        }
        return emit(eventOf(notification, replaying))
      },
    }

    // The protocol's messages over the transport's lines, each heard by the trace on its way.
    let deliver: (message: AnyMessage) => void = () => undefined
    let finish: () => void = () => undefined
    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => {
        let open = true
        deliver = (message) => {
          if (open) controller.enqueue(message)
        }
        finish = () => {
          if (open) controller.close()
          open = false
        }
      },
    })
    const writable = new WritableStream<AnyMessage>({
      write: (message) => {
        trace('out', message)
        return Effect.runPromise(
          Effect.catch(options.transport.write(JSON.stringify(message)), () => Effect.sync(finish)),
        )
      },
    })

    yield* options.transport.lines.pipe(
      Stream.runForEach((line) =>
        Effect.sync(() =>
          Option.map(readMessage(line), (message) => {
            // SAFETY: a JSON object off the wire is what the SDK's own `ndJsonStream` hands its
            // connection unchecked; the connection checks it is a request, a response or a
            // notification, and validates its parameters, before any handler sees it.
            const wire = message as AnyMessage
            trace('in', wire)
            deliver(wire)
          }),
        ),
      ),
      Effect.ignore,
      // However the agent's side ended, the connection ends with it.
      Effect.ensuring(
        Effect.gen(function* () {
          finish()
          yield* Queue.end(events)
          yield* cancelStanding
          yield* Deferred.succeed(ended, undefined)
        }),
      ),
      Effect.forkScoped,
    )

    const connection = new ClientSideConnection(() => client, { readable, writable })
    yield* Effect.addFinalizer(() => Effect.sync(finish))

    /** One request, its failure typed: a closed connection is the agent gone. */
    const request = <A>(method: string, call: () => Promise<A>) =>
      Effect.tryPromise({
        try: call,
        // The agent's own sentence, without the name of the error class in front of it.
        catch: (cause) =>
          connection.signal.aborted
            ? new AgentGone()
            : new AgentProtocolError({
                method,
                reason: cause instanceof Error ? cause.message : String(cause),
              }),
      })

    const initialized = yield* request('initialize', () =>
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { _meta: CLIENT_META },
        clientInfo: { name: 'Hemera', version: '1.0.0' },
      }),
    )
    const capabilities = initialized.agentCapabilities
    const handshake: AgentHandshake = {
      protocolVersion: initialized.protocolVersion,
      agentName: initialized.agentInfo?.name ?? null,
      agentVersion: initialized.agentInfo?.version ?? null,
      authMethods: (initialized.authMethods ?? []).map((method) => ({
        id: method.id,
        name: method.name,
      })),
      loads: capabilities?.loadSession === true,
      resumes: capabilities?.sessionCapabilities?.resume != null,
      images: capabilities?.promptCapabilities?.image === true,
      embeddedContext: capabilities?.promptCapabilities?.embeddedContext === true,
    }

    const sessionOf = (
      nativeSessionId: string,
      configOptions: ReadonlyArray<SessionConfigOption> | null | undefined,
      modes: SessionModeState | null | undefined,
    ): AgentSession => {
      defaults.clear()
      announced = optionsOf(configOptions, defaults)
      return {
        nativeSessionId,
        modes: modesOf(modes),
        options: () => announced,

        setOption: (optionId, value) =>
          Effect.gen(function* () {
            const chosen = announced.find((option) => option.id === optionId)
            const model = isModel(chosen)
            if (model && !(chosen?.values ?? []).some((offered) => offered.id === value)) {
              return yield* new ModelUnavailable({
                model: value,
                reason: 'the agent does not offer it',
              })
            }
            const answered = yield* request('session/set_config_option', () =>
              connection.setSessionConfigOption(
                chosen?.kind === 'boolean'
                  ? {
                      sessionId: nativeSessionId,
                      configId: optionId,
                      type: 'boolean',
                      value: value === 'true',
                    }
                  : { sessionId: nativeSessionId, configId: optionId, value },
              ),
            ).pipe(
              Effect.mapError((failed) =>
                model && Predicate.isTagged(failed, 'AgentProtocolError')
                  ? new ModelUnavailable({ model: value, reason: failed.reason })
                  : failed,
              ),
            )
            announced = optionsOf(answered.configOptions, defaults)
            const taken = announced.find((option) => option.id === optionId)
            if (model && taken?.value !== value) {
              return yield* new ModelUnavailable({
                model: value,
                reason: 'the agent did not take it',
              })
            }
            return announced
          }),

        prompt: (blocks) =>
          Effect.gen(function* () {
            if (!handshake.images && blocks.some(Predicate.isTagged('Image'))) {
              return yield* new ImageNotAccepted()
            }
            if (connection.signal.aborted) return yield* new AgentGone()
            const answered = yield* request('session/prompt', () =>
              connection.prompt({
                sessionId: nativeSessionId,
                prompt: blocks.map((block) => blockOf(block, handshake.embeddedContext)),
              }),
            ).pipe(Effect.catchTag('AgentGone', () => Effect.succeed(null)))
            // The agent died with the turn open: the turn ends, interrupted.
            if (answered === null) return { stopReason: 'interrupted' as const, usage: null }
            return { stopReason: answered.stopReason, usage: usageOf(answered.usage) }
          }),

        cancel: Effect.gen(function* () {
          yield* cancelStanding
          yield* request('session/cancel', () =>
            connection.cancel({ sessionId: nativeSessionId }),
          ).pipe(Effect.catchTag('AgentProtocolError', () => Effect.void))
        }),
      }
    }

    /** A way into a session, with `_meta` only when there is one to carry. */
    const withMeta = (opening: SessionOpening) =>
      opening.meta === undefined
        ? { cwd: opening.cwd, mcpServers: [...opening.mcpServers] }
        : // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
          { cwd: opening.cwd, mcpServers: [...opening.mcpServers], _meta: opening.meta }

    return {
      handshake,
      events: Stream.fromQueue(events),
      waiting: () => standing.size > 0,
      gone: Deferred.await(ended),

      newSession: (opening) =>
        Effect.map(
          request('session/new', () => connection.newSession(withMeta(opening))),
          (opened) => sessionOf(opened.sessionId, opened.configOptions, opened.modes),
        ),

      resumeSession: (nativeSessionId, opening) =>
        Effect.map(
          request('session/resume', () =>
            connection.resumeSession({ sessionId: nativeSessionId, ...withMeta(opening) }),
          ),
          (resumed) => sessionOf(nativeSessionId, resumed.configOptions, resumed.modes),
        ),

      loadSession: (nativeSessionId, opening) =>
        Effect.gen(function* () {
          replaying = true
          const loaded = yield* request('session/load', () =>
            connection.loadSession({ sessionId: nativeSessionId, ...withMeta(opening) }),
          ).pipe(Effect.ensuring(Effect.sync(() => (replaying = false))))
          return sessionOf(nativeSessionId, loaded.configOptions, loaded.modes)
        }),
    } satisfies AgentConnection
  })
