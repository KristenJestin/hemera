/**
 * The engine's side of one ACP connection (design D5-03).
 *
 * Hemera is the client of this protocol: it starts one agent process, asks it to open a session
 * or to continue the one it handed back last time, sends one prompt per turn, and receives what
 * the agent reports while it works. This file is the only place in the application that speaks
 * ACP, and everything above it — the turn, the thread, the window — sees Hemera's own vocabulary:
 * an update as an `AgentEvent`, and a permission request as a question someone can answer.
 *
 * The protocol is spoken through `@agentclientprotocol/sdk`, by the design's decision and not by
 * hand: the framing, the request ids and the capability negotiation are the SDK's, and what is
 * Hemera's here is only the two handlers and the reading of what comes back. The connection is
 * built with `ClientSideConnection`'s constructor, which owns its own lifetime, rather than with
 * the successor `client().connectWith(stream, op)`: that one runs the whole conversation inside
 * a callback and closes the socket with it, and a Session's agent outlives a turn by design.
 *
 * Nothing here starts a process. The supervisor starts one and this connection is built over the
 * two pipes it owns, which is also what makes it testable: a peer that speaks the protocol over
 * an in-memory stream is a real agent to this file, not a stub of one.
 */

import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Client as AcpClient,
  type ContentBlock,
  type SessionNotification,
  type StopReason,
  type Usage,
  type SessionConfigOption,
  type SessionConfigSelectOptions,
} from '@agentclientprotocol/sdk'
import { Data, Effect } from 'effect'

import { type AgentAdapter } from './adapter.ts'

/** What went wrong while speaking the protocol, and at which step. */
export class AgentProtocolError extends Data.TaggedError('AgentProtocolError')<{
  readonly what: string
  readonly cause: string
}> {}

/** A tool call, as the thread draws it: one report, updated as the agent goes. */
export interface ToolCallReport {
  readonly id: string
  readonly title: string
  /** `read`, `edit`, `execute`, `think`, `fetch`, `other` — or null when the agent did not say. */
  readonly kind: string | null
  /** `pending`, `in_progress`, `completed` or `failed`. */
  readonly status: string | null
  /** The files this call is about, as the agent named them. */
  readonly locations: readonly string[]
  /**
   * What the agent attached to the call — its content blocks, the file change it proposes, the
   * terminal it opened — as the JSON it was written as.
   *
   * It is kept as JSON rather than as fields of Hemera's own because the shape is ACP's and it
   * is not one shape: a call carries text, or a diff, or a terminal, or none of them, and the
   * window reads what it draws out of this rather than the engine inventing a union it would
   * then have to keep in step with the protocol.
   */
  readonly detail: string
  /**
   * What kinds of content the call carries — `diff`, `terminal`, `text`, `image` — as it named
   * them.
   *
   * The runtime reads them to write the entries the side column draws on their own, and never
   * reads the detail to find out: a report says what it holds rather than making its reader
   * parse it.
   */
  readonly contents: readonly string[]
}

/** One line of the plan the agent is keeping, as it reports it. */
export interface PlanLine {
  readonly content: string
  readonly status: string
}

/** What a finished turn used, as the agent accounts for it. */
export interface UsageReport {
  readonly totalTokens: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly thoughtTokens: number | null
}

/**
 * What a turn reports while it runs, in Hemera's words.
 *
 * The kinds are the thread's own (design D5-11): a message, a thought, a tool call and a plan
 * are what a turn can be said to be doing at any moment, and everything else the protocol
 * publishes — the commands it offers, the mode it is in, a compaction — is an update this lot
 * does not draw and so does not carry.
 *
 * `replay` is true for what the agent sends back while a session is being continued: ACP asks it
 * to stream the whole history again, and those turns are already in Hemera's thread. A replay is
 * reported rather than dropped, so the banner over a resumed thread can say what arrived.
 */
export type AgentEvent =
  | {
      readonly type: 'message'
      readonly text: string
      readonly replay: boolean
      /** The message this chunk belongs to, when the agent named one (D5-08). */
      readonly messageId: string | null
    }
  | {
      readonly type: 'thought'
      readonly text: string
      readonly replay: boolean
      readonly messageId: string | null
    }
  | { readonly type: 'tool_call'; readonly call: ToolCallReport; readonly replay: boolean }
  | { readonly type: 'plan'; readonly entries: readonly PlanLine[]; readonly replay: boolean }

/** What the agent published about itself at `initialize`. */
export interface AgentHandshake {
  readonly protocolVersion: number
  /** The methods the user still has to go through, as the agent named them. */
  readonly authMethods: readonly { readonly id: string; readonly name: string }[]
  /**
   * Whether what it announced leaves it usable, read by its own adapter (design D5-02).
   *
   * An agent that is not signed in is not started, and is not replaced by another one (D5-17).
   */
  readonly authenticated: boolean
  /** Whether this agent can be asked to continue a session it handed back (D5-06). */
  readonly continues: boolean
  /**
   * Whether it can carry that session on without streaming it back first (D5-07).
   *
   * `session/resume` hands the conversation over as it stands, where `session/load` sends the
   * whole history again. Which one was used is what tells the thread whether what arrives is a
   * replay to be matched against what it already holds, or new work.
   */
  readonly resumes: boolean
}

/**
 * One thing the agent lets this Session choose, as the composer offers it (design D5-13).
 *
 * The list is the agent's own: Hemera draws a selector per option the agent announced and
 * invents none, so an agent offering a model and an effort gets two and one offering nothing
 * gets none. A `select` carries the values it accepts; a `boolean` is a switch and carries
 * none, its `value` being `true` or `false` as text.
 */
export interface AgentOption {
  readonly id: string
  readonly name: string
  /** `model`, `mode`, `thought_level` — or null when the agent did not say. */
  readonly category: string | null
  readonly kind: 'select' | 'boolean'
  readonly value: string
  readonly values: readonly { readonly id: string; readonly name: string }[]
}

/** A permission the agent is waiting for, as a question with the answers it offers. */
export interface PermissionQuestion {
  readonly toolCallId: string
  readonly title: string
  readonly options: readonly {
    readonly id: string
    readonly name: string
    readonly kind: string
  }[]
}

/**
 * What the user answered.
 *
 * `cancelled` is not a refusal by the user of what was asked but the end of the question — the
 * turn was stopped while the question stood, and the protocol has an outcome for exactly that.
 */
export type PermissionAnswer = { readonly optionId: string } | { readonly cancelled: true }

/** How a turn ended, and what it cost. */
export interface PromptOutcome {
  readonly stopReason: StopReason
  readonly usage: UsageReport | null
}

/**
 * One connection to one agent, from Hemera's side.
 *
 * The native session id is the connection's own after `open` or `continue`, because every call
 * the client may make after that names it: a turn belongs to the session it was sent to, and the
 * caller that holds a connection is a caller that is talking to one agent about one Session.
 */
export interface AgentConnection {
  readonly handshake: AgentHandshake
  /** What the agent lets this Session choose, as it announced it when the session opened. */
  readonly options: () => readonly AgentOption[]
  /** Asks the agent for one of them, and answers what it says the options are now. */
  readonly setOption: (
    optionId: string,
    value: string,
  ) => Effect.Effect<readonly AgentOption[], AgentProtocolError>
  /** Opens a session in that directory and answers the handle the agent gave it. */
  readonly open: (workingDirectory: string) => Effect.Effect<string, AgentProtocolError>
  /** Asks the agent to carry on the session it handed back, streaming its history again. */
  readonly continueSession: (
    nativeSessionId: string,
    workingDirectory: string,
  ) => Effect.Effect<void, AgentProtocolError>
  /** Sends one turn and waits for the agent to be done with it. */
  readonly prompt: (text: string) => Effect.Effect<PromptOutcome, AgentProtocolError>
  /** Asks the agent to stop what it is doing; its answer to the turn is `cancelled`. */
  readonly cancel: () => Effect.Effect<void, AgentProtocolError>
}

/** What `connect` needs: the agent's two pipes, its adapter, and the two questions it may ask. */
export interface ConnectionOptions {
  /** What the agent writes: its standard output. */
  readonly input: ReadableStream<Uint8Array>
  /** What the agent reads: its standard input. */
  readonly output: WritableStream<Uint8Array>
  readonly adapter: AgentAdapter
  readonly onEvent: (event: AgentEvent) => void
  readonly onPermission: (question: PermissionQuestion) => Promise<PermissionAnswer>
}

/** The text of a content block, or null when it carries something other than text. */
function textOf(content: ContentBlock): string | null {
  return content.type === 'text' ? content.text : null
}

/** A notification, as an event of the thread — or null for what this lot does not draw. */
function eventOf(notification: SessionNotification, replay: boolean): AgentEvent | null {
  const update = notification.update
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(update.content)
      return text === null
        ? null
        : { type: 'message', text, replay, messageId: update.messageId ?? null }
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      return text === null
        ? null
        : { type: 'thought', text, replay, messageId: update.messageId ?? null }
    }
    case 'tool_call':
    case 'tool_call_update': {
      return {
        type: 'tool_call',
        replay,
        call: {
          id: update.toolCallId,
          // An update carries only what changed, so a title it does not repeat is one the
          // thread already has: the empty string here is read as "unchanged" by the runtime,
          // which is the only reader of these reports.
          title: 'title' in update ? (update.title ?? '') : '',
          kind: 'kind' in update ? (update.kind ?? null) : null,
          status: 'status' in update ? (update.status ?? null) : null,
          locations: ('locations' in update ? (update.locations ?? []) : []).map(
            (location) => location.path,
          ),
          detail: JSON.stringify('content' in update ? (update.content ?? []) : []),
          contents: ('content' in update ? (update.content ?? []) : []).map(
            (block) => block.type,
          ),
        },
      }
    }
    case 'plan':
      return {
        type: 'plan',
        replay,
        entries: update.entries.map((entry) => ({
          content: entry.content,
          status: entry.status,
        })),
      }
    default:
      return null
  }
}

/**
 * The values one announced option accepts, flattened.
 *
 * ACP lets an agent group its values; the composer draws one flat list per option, so a group
 * is a heading the window does not need and its values are what it has.
 */
function choicesOf(options: SessionConfigSelectOptions): readonly {
  readonly id: string
  readonly name: string
}[] {
  return options.flatMap((choice) =>
    'value' in choice
      ? [{ id: choice.value, name: choice.name }]
      : choice.options.map((nested) => ({ id: nested.value, name: nested.name })),
  )
}

/** What an agent lets a Session choose, in Hemera's words. */
function optionsOf(
  announced: readonly SessionConfigOption[] | null | undefined,
): readonly AgentOption[] {
  return (announced ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    category: option.category ?? null,
    kind: option.type === 'boolean' ? ('boolean' as const) : ('select' as const),
    value: option.type === 'boolean' ? String(option.currentValue) : option.currentValue,
    values: option.type === 'boolean' ? [] : choicesOf(option.options),
  }))
}

/** What a finished turn used, or null when the agent accounted for nothing. */
function usageOf(usage: Usage | null | undefined): UsageReport | null {
  return usage == null
    ? null
    : {
        totalTokens: usage.totalTokens,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtTokens: usage.thoughtTokens ?? null,
      }
}

/**
 * Builds the connection and shakes hands with the agent.
 *
 * The handshake is done here rather than left to the caller because nothing can be asked of an
 * agent before it: what comes back is what says whether this agent can be talked to at all, and
 * what the Agents page shows about it.
 */
export function connect(
  options: ConnectionOptions,
): Effect.Effect<AgentConnection, AgentProtocolError> {
  return Effect.gen(function* () {
    const adapter = options.adapter
    /**
     * Whether what arrives now is the agent replaying history rather than working.
     *
     * ACP asks the agent to stream the whole conversation back when a session is continued, and
     * those turns are already in Hemera's thread: what is replayed is reported as such so that
     * nothing writes a second copy of what the user already has.
     */
    let replaying = false
    let sessionId: string | null = null
    /**
     * What the agent said it lets this Session choose, as it last said it.
     *
     * Held here rather than in the caller because every answer that changes an option carries
     * the whole set back: the composer is drawn from the agent's own words, and this is the one
     * place that keeps them.
     */
    let announced: readonly AgentOption[] = []

    const client: AcpClient = {
      // ACP's own contract: whatever the user answered, in the shape the protocol takes it in.
      requestPermission: async (request) => {
        const answer = await options.onPermission({
          toolCallId: request.toolCall.toolCallId,
          title: request.toolCall.title ?? '',
          options: request.options.map((option) => ({
            id: option.optionId,
            name: option.name,
            kind: option.kind,
          })),
        })
        return 'cancelled' in answer
          ? { outcome: { outcome: 'cancelled' as const } }
          : { outcome: { outcome: 'selected' as const, optionId: answer.optionId } }
      },
      sessionUpdate: (notification) => {
        const event = eventOf(notification, replaying)
        if (event !== null) options.onEvent(event)
      },
    }

    const connection = new ClientSideConnection(
      () => client,
      ndJsonStream(options.output, options.input),
    )

    const handshake = yield* Effect.tryPromise({
      try: () =>
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          // Hemera advertises no capability of its own in this lot: the agent does its own
          // reading, writing and running, and none of it is routed back through this window.
          clientCapabilities: {},
          clientInfo: { name: 'Hemera', version: '0.0.0' },
        }),
      catch: (cause) => new AgentProtocolError({ what: 'initialize', cause: String(cause) }),
    })

    const methods = (handshake.authMethods ?? []).map((method) => ({
      id: method.id,
      name: method.name,
    }))

    const named = (value: string, what: string): Effect.Effect<string, AgentProtocolError> =>
      sessionId === null
        ? Effect.fail(new AgentProtocolError({ what, cause: 'no session has been opened' }))
        : Effect.succeed(value)

    return {
      handshake: {
        protocolVersion: handshake.protocolVersion,
        authMethods: methods,
        authenticated: adapter.isAuthenticated(methods),
        continues: handshake.agentCapabilities?.loadSession === true,
        resumes: handshake.agentCapabilities?.sessionCapabilities?.resume != null,
      },

      options: () => announced,

      setOption: (optionId, value) =>
        Effect.gen(function* () {
          const open = yield* named(sessionId ?? '', 'setSessionConfigOption')
          const chosen = announced.find((option) => option.id === optionId)
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.setSessionConfigOption(
                chosen?.kind === 'boolean'
                  ? { sessionId: open, configId: optionId, type: 'boolean', value: value === 'true' }
                  : { sessionId: open, configId: optionId, value },
              ),
            catch: (cause) =>
              new AgentProtocolError({ what: 'setSessionConfigOption', cause: String(cause) }),
          })
          announced = optionsOf(answered.configOptions)
          return announced
        }),

      open: (workingDirectory) =>
        Effect.gen(function* () {
          const opened = yield* Effect.tryPromise({
            try: () => connection.newSession({ cwd: workingDirectory, mcpServers: [] }),
            catch: (cause) => new AgentProtocolError({ what: 'newSession', cause: String(cause) }),
          })
          sessionId = opened.sessionId
          announced = optionsOf(opened.configOptions)
          return opened.sessionId
        }),

      continueSession: (nativeSessionId, workingDirectory) =>
        Effect.gen(function* () {
          // `resume` hands the conversation over as it stands; `load` sends it back and every
          // chunk of it arrives as a replay, which is why only one of the two sets the flag.
          const resumes = handshake.agentCapabilities?.sessionCapabilities?.resume != null
          replaying = !resumes
          const answered = yield* Effect.tryPromise({
            try: () =>
              resumes
                ? connection.resumeSession({
                    sessionId: nativeSessionId,
                    cwd: workingDirectory,
                    mcpServers: [],
                  })
                : connection.loadSession({
                    sessionId: nativeSessionId,
                    cwd: workingDirectory,
                    mcpServers: [],
                  }),
            catch: (cause) =>
              new AgentProtocolError({
                what: resumes ? 'resumeSession' : 'loadSession',
                cause: String(cause),
              }),
          }).pipe(Effect.ensuring(Effect.sync(() => (replaying = false))))
          sessionId = nativeSessionId
          announced = optionsOf(answered.configOptions)
        }),

      prompt: (text) =>
        Effect.gen(function* () {
          const open = sessionId
          if (open === null) {
            return yield* Effect.fail(
              new AgentProtocolError({ what: 'prompt', cause: 'no session has been opened' }),
            )
          }
          const answered = yield* Effect.tryPromise({
            try: () =>
              connection.prompt({
                sessionId: open,
                prompt: [{ type: 'text', text }],
              }),
            catch: (cause) => new AgentProtocolError({ what: 'prompt', cause: String(cause) }),
          })
          return { stopReason: answered.stopReason, usage: usageOf(answered.usage) }
        }),

      cancel: () =>
        Effect.gen(function* () {
          const open = yield* named(sessionId ?? '', 'cancel')
          yield* Effect.tryPromise({
            try: () => connection.cancel({ sessionId: open }),
            catch: (cause) => new AgentProtocolError({ what: 'cancel', cause: String(cause) }),
          })
        }),
    } satisfies AgentConnection
  })
}
