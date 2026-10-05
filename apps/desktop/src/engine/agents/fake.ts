/**
 * The fake agent: a real ACP peer, scripted, behind the same link a real agent's process gives.
 *
 * The tests of the agents need an agent to talk to, and what they prove is the protocol rather
 * than a stub's idea of it: this is the SDK's own agent side, joined to the client by in-memory
 * streams. What it answers is scripted; the framing, the request ids, the handshake and the
 * permission requests are the protocol's.
 *
 * It is handed over as an `AgentsProcess`, the shape the agents' process link gives in
 * production, so whatever starts agents through a port can be given this one instead. The lint
 * refuses module mocking, and the application never imports this file (a test checks it).
 */

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  RequestError,
  ndJsonStream,
  type Agent as AcpAgent,
  type ContentBlock,
  type LoadSessionRequest,
  type McpServer,
  type NewSessionRequest,
  type NewSessionResponse,
  type PermissionOption,
  type PlanEntryStatus,
  type PromptResponse,
  type ResumeSessionRequest,
  type SessionConfigOption,
  type SessionModeState,
  type SessionUpdate,
  type StopReason,
  type ToolCall,
  type ToolCallContent,
  type ToolCallStatus,
  type Usage,
} from '@agentclientprotocol/sdk'
import { AgentsProcessGone, Output } from '@hemera/ipc'
import { Effect, Stream } from 'effect'

import type { AgentsProcess } from '../agents.ts'

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
        readonly status?: ToolCallStatus
        readonly path?: string
        readonly content?: ReadonlyArray<ToolCallContent>
        readonly rawInput?: Readonly<Record<string, string>>
      }
    }
  | {
      readonly does: 'updates'
      readonly call: {
        readonly id: string
        readonly status: ToolCallStatus
        readonly content?: ReadonlyArray<ToolCallContent>
        readonly rawOutput?: Readonly<Record<string, string>>
      }
    }
  | {
      /** A permission request, as `session/request_permission`. */
      readonly does: 'asks'
      readonly call: {
        readonly id: string
        readonly title: string
        /** Where Claude Code names the tool, `_meta.claudeCode.toolName`; the title otherwise. */
        readonly toolName?: string
        readonly options: ReadonlyArray<{
          readonly id: string
          readonly name: string
          readonly kind: PermissionOption['kind']
        }>
      }
    }
  | {
      readonly does: 'plans'
      readonly lines: ReadonlyArray<{ readonly content: string; readonly status: PlanEntryStatus }>
    }
  | {
      /** The context window, as `usage_update` reports it. */
      readonly does: 'spends'
      readonly used: number
      readonly size: number
      readonly cost?: { readonly amount: number; readonly currency: string }
    }
  | {
      /**
       * One of its options moved by the agent itself: a `current_mode_update` when `as` is
       * `mode`, the whole set in a `config_option_update` otherwise.
       */
      readonly does: 'switches'
      readonly option: string
      readonly value: string
      readonly as?: 'mode' | 'config'
    }
  /** The process ends on the spot, in the middle of the turn, which is never answered. */
  | { readonly does: 'dies' }

/** What the agent is scripted to be: what it announces, and what it does when it is asked. */
export interface FakeScript {
  readonly authMethods?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** Whether it announces `loadSession`. */
  readonly loads?: boolean
  /** Whether it announces `sessionCapabilities.resume`; true unless said otherwise. */
  readonly resumes?: boolean
  /** Whether its prompts accept image blocks. */
  readonly images?: boolean
  /** The options it announces when a session opens, in the SDK's shape. */
  readonly configOptions?: ReadonlyArray<SessionConfigOption>
  /** The modes it announces when a session opens. */
  readonly modes?: SessionModeState
  /** The models it refuses with an error when one is chosen. */
  readonly refusesModels?: ReadonlyArray<string>
  /** A model it puts the session on instead of the one chosen, without saying so. */
  readonly substitutesModel?: string
  /** What it does on each prompt, unless `turns` scripts that prompt. */
  readonly steps?: ReadonlyArray<FakeStep>
  /** What it does on its first prompts, one list per prompt, before `steps` takes over. */
  readonly turns?: ReadonlyArray<ReadonlyArray<FakeStep>>
  /** What `session/load` streams back. */
  readonly history?: ReadonlyArray<FakeStep>
  readonly nativeSessionId?: string
  readonly refusesResume?: boolean
  readonly refusesLoad?: boolean
  readonly stopReason?: StopReason
  /** What a turn is accounted as using, in the SDK's shape. */
  readonly usage?: Usage
  /** Awaited before each step, so a test can hold a turn open. */
  readonly between?: () => Promise<void>
}

/** What the agent was told, as it was told it: read by a test, written by the agent. */
export interface FakeAnswers {
  /** The option chosen for each permission request it made. */
  readonly optionIds: string[]
  /** How many permission requests were answered `cancelled`. */
  cancelled: number
  /** Every prompt, block by block. */
  readonly prompts: ContentBlock[][]
  /** The servers each session it opened, loaded or resumed was handed. */
  readonly mcpServers: McpServer[][]
  /** The `_meta` of each of those sessions, as JSON, or null when it carried none. */
  readonly metas: (string | null)[]
  /** What the client advertised of itself at `initialize`, as JSON. */
  readonly advertised: string[]
  /** Every option it was put on, as `id=value`. */
  readonly choices: string[]
  loads: number
  resumes: number
  cancels: number
}

export interface FakeAgent {
  /** The agent, as the agents' process link hands one over. */
  readonly process: AgentsProcess
  readonly answers: FakeAnswers
  /** Ends the agent now, as a process that died on the spot. */
  readonly die: () => void
}

/** The notification one step is, or null for a step that is something else. */
function updateOf(step: FakeStep): SessionUpdate | null {
  switch (step.does) {
    case 'says':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: step.text },
        messageId: step.messageId ?? null,
      }
    case 'thinks':
      return {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: step.text },
        messageId: step.messageId ?? null,
      }
    case 'calls':
      return {
        sessionUpdate: 'tool_call',
        toolCallId: step.call.id,
        title: step.call.title,
        kind: step.call.kind ?? 'other',
        status: step.call.status ?? 'pending',
        locations: step.call.path === undefined ? [] : [{ path: step.call.path }],
        content: [...(step.call.content ?? [])],
        rawInput: step.call.rawInput,
      }
    case 'updates':
      return {
        sessionUpdate: 'tool_call_update',
        toolCallId: step.call.id,
        status: step.call.status,
        content: step.call.content === undefined ? null : [...step.call.content],
        rawOutput: step.call.rawOutput,
      }
    case 'plans':
      return {
        sessionUpdate: 'plan',
        entries: step.lines.map((line) => ({ ...line, priority: 'medium' })),
      }
    case 'spends':
      return {
        sessionUpdate: 'usage_update',
        used: step.used,
        size: step.size,
        cost: step.cost ?? null,
      }
    case 'asks':
    case 'switches':
    case 'dies':
      return null
  }
}

/** The `_meta` a session was opened with, as JSON, or null when it carried none. */
const metaOf = (request: NewSessionRequest | LoadSessionRequest | ResumeSessionRequest) =>
  // oxlint-disable-next-line eslint/no-underscore-dangle -- `_meta` is the protocol's own name for its extension slot
  request._meta == null ? null : JSON.stringify(request._meta)

/** Whether an option is the agent's model. */
const isModel = (option: SessionConfigOption): boolean =>
  option.category === 'model' || option.id === 'model'

/** Builds the peer, and the process a client talks to it through. */
export function fakeAgent(script: FakeScript = {}): FakeAgent {
  const fromClient = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  const writer = fromClient.writable.getWriter()
  const encoder = new TextEncoder()
  const answers: FakeAnswers = {
    optionIds: [],
    cancelled: 0,
    prompts: [],
    mcpServers: [],
    metas: [],
    advertised: [],
    choices: [],
    loads: 0,
    resumes: 0,
    cancels: 0,
  }

  let sessionId = script.nativeSessionId ?? 'native-session'
  let announced: SessionConfigOption[] = [...(script.configOptions ?? [])]
  let cancelled = false
  let dead = false
  let turnsTaken = 0
  let announceDeath: () => void = () => undefined
  const died = new Promise<void>((resolve) => {
    announceDeath = resolve
  })

  const die = (): void => {
    if (dead) return
    dead = true
    cancelled = true
    announceDeath()
    void writer.abort().catch(() => undefined)
  }

  let connection: AgentSideConnection | null = null
  const send = async (update: SessionUpdate): Promise<void> => {
    if (!dead) await connection?.sessionUpdate({ sessionId, update })
  }

  /** What a session taken back answers: the options as this process announces them. */
  const takenBack = () => ({
    configOptions: script.configOptions === undefined ? null : [...announced],
    modes: script.modes ?? null,
  })

  const perform = async (steps: ReadonlyArray<FakeStep>): Promise<PromptResponse> => {
    for (const step of steps) {
      if (cancelled) break
      // oxlint-disable-next-line no-await-in-loop -- the script is a sequence, and a test holds a turn open here
      await script.between?.()
      if (cancelled) break
      if (step.does === 'dies') {
        die()
        // A dead process answers nothing: the turn stays open on its side for ever.
        return new Promise<never>(() => undefined)
      }
      if (step.does === 'switches') {
        announced = announced.map((option) =>
          option.id === step.option && option.type !== 'boolean'
            ? { ...option, currentValue: step.value }
            : option,
        )
        // oxlint-disable-next-line no-await-in-loop -- what it says is sent before what it says next
        await send(
          step.as === 'mode'
            ? { sessionUpdate: 'current_mode_update', currentModeId: step.value }
            : { sessionUpdate: 'config_option_update', configOptions: [...announced] },
        )
        continue
      }
      if (step.does === 'asks') {
        const held = connection
        if (held === null) break
        // oxlint-disable-next-line no-await-in-loop -- a question is answered before the next step happens
        const answered = await held.requestPermission({
          sessionId,
          toolCall: {
            toolCallId: step.call.id,
            title: step.call.title,
            _meta:
              step.call.toolName === undefined
                ? null
                : { claudeCode: { toolName: step.call.toolName } },
          },
          options: step.call.options.map((option) => ({
            optionId: option.id,
            name: option.name,
            kind: option.kind,
          })),
        })
        if (answered.outcome.outcome === 'cancelled') answers.cancelled += 1
        else answers.optionIds.push(answered.outcome.optionId)
        continue
      }
      const update = updateOf(step)
      // oxlint-disable-next-line no-await-in-loop -- what it says reaches the client before the turn's answer
      if (update !== null) await send(update)
    }
    if (cancelled) return { stopReason: 'cancelled' }
    return { stopReason: script.stopReason ?? 'end_turn', usage: script.usage ?? null }
  }

  const agent: AcpAgent = {
    initialize: (request) => {
      answers.advertised.push(JSON.stringify(request.clientCapabilities))
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: script.loads === true,
          promptCapabilities: { embeddedContext: true, image: script.images === true },
          sessionCapabilities: script.resumes === false ? {} : { resume: {} },
        },
        authMethods: [...(script.authMethods ?? [])],
        agentInfo: { name: 'Fake agent', version: '1.0.0' },
      }
    },
    newSession: (request) => {
      answers.mcpServers.push([...request.mcpServers])
      answers.metas.push(metaOf(request))
      const opened: NewSessionResponse = { sessionId, ...takenBack() }
      return opened
    },
    loadSession: async (request) => {
      answers.loads += 1
      if (script.refusesLoad === true) throw new Error('this agent refuses to load a session')
      answers.mcpServers.push([...request.mcpServers])
      answers.metas.push(metaOf(request))
      sessionId = request.sessionId
      for (const step of script.history ?? []) {
        const update = updateOf(step)
        // oxlint-disable-next-line no-await-in-loop -- the history is replayed in its order
        if (update !== null) await send(update)
      }
      return takenBack()
    },
    resumeSession: (request) => {
      answers.resumes += 1
      if (script.refusesResume === true) throw new Error('this agent refuses to resume a session')
      answers.mcpServers.push([...(request.mcpServers ?? [])])
      answers.metas.push(metaOf(request))
      sessionId = request.sessionId
      return takenBack()
    },
    setSessionConfigOption: (request) => {
      const value = String(request.value)
      answers.choices.push(`${request.configId}=${value}`)
      const chosen = announced.find((option) => option.id === request.configId)
      const model = chosen !== undefined && isModel(chosen)
      if (model && (script.refusesModels ?? []).includes(value)) {
        throw RequestError.invalidParams(undefined, `model ${value} is not available`)
      }
      const taken = model ? (script.substitutesModel ?? value) : value
      announced = announced.map((option) => {
        if (option.id !== request.configId) return option
        return option.type === 'boolean'
          ? { ...option, currentValue: taken === 'true' }
          : { ...option, currentValue: taken }
      })
      return { configOptions: [...announced] }
    },
    authenticate: () => undefined,
    cancel: () => {
      answers.cancels += 1
      cancelled = true
    },
    prompt: (request) => {
      cancelled = false
      answers.prompts.push([...request.prompt])
      const steps = script.turns?.[turnsTaken] ?? script.steps ?? []
      turnsTaken += 1
      return perform(steps)
    },
  }

  connection = new AgentSideConnection(
    () => agent,
    ndJsonStream(toClient.writable, fromClient.readable),
  )

  const gone = new AgentsProcessGone()
  const process: AgentsProcess = {
    pid: 4_242,
    // What the agent writes, line by line, until it dies: then the link ends as a real one does.
    output: Stream.fromReadableStream({
      evaluate: () => toClient.readable,
      onError: () => gone,
    }).pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.map((line) => Output.make({ line })),
      Stream.interruptWhen(Effect.promise(() => died)),
      Stream.concat(Stream.fail(gone)),
    ),
    write: (line) =>
      dead
        ? Effect.fail(gone)
        : Effect.tryPromise({
            try: () => writer.write(encoder.encode(`${line}\n`)),
            catch: () => gone,
          }),
    end: Effect.tryPromise({ try: () => writer.close(), catch: () => gone }),
    exited: Effect.promise(() => died.then(() => 1)),
  }

  return { process, answers, die }
}
