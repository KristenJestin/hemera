/**
 * A peer that speaks ACP, in this process.
 *
 * The client's tests need an agent to talk to, and the point of them is the protocol rather than
 * a mock's opinion of it: so this is a real peer, built with the SDK's agent side, connected to
 * the client by a pair of in-memory streams. What it answers is scripted, and everything else —
 * the framing, the request ids, the handshake, the permission request — is the protocol's own.
 *
 * It is a test's file, not the application's: it is never started, never installed, and no part
 * of the engine knows it exists. What the fake proves is that Hemera's side of a conversation is
 * what the protocol says it should be, which is the half of phase 1 that can be proved without
 * an agent on the machine.
 */

import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent as AcpAgent,
  type ContentBlock,
  type PermissionOption,
  type PromptResponse,
  type RequestPermissionResponse,
  type SessionUpdate,
  type StopReason,
  type PlanEntryStatus,
  type ToolCall,
  type ToolCallStatus,
  type Usage,
} from '@agentclientprotocol/sdk'

/** One thing the agent does during a turn, in the order it does them. */
export type FakeStep =
  | { readonly does: 'says'; readonly text: string }
  | { readonly does: 'thinks'; readonly text: string }
  | {
      readonly does: 'calls'
      readonly call: {
        readonly id: string
        readonly title: string
        readonly kind?: NonNullable<ToolCall['kind']>
        readonly status?: NonNullable<ToolCall['status']>
        readonly path?: string
      }
    }
  | {
      readonly does: 'updates'
      readonly call: {
        readonly id: string
        readonly status: ToolCallStatus
        readonly title?: string
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

/** What the agent announces, and what it does when it is asked for a turn. */
export interface FakeBehaviour {
  /** The methods it publishes at `initialize`; none means no way in, as the adapters read it. */
  readonly authMethods?: readonly { readonly id: string; readonly name: string }[]
  /** Whether it says it can continue a session it handed back. */
  readonly continues?: boolean
  /** What it does, in order, when a prompt arrives. */
  readonly steps?: readonly FakeStep[]
  /**
   * Awaited before each step, so a test can hold a turn open.
   *
   * A cancelled turn can only be tested while the turn is really running, and a scripted agent
   * is done in microseconds: this is where a test stops happening and presses Stop.
   */
  readonly between?: () => Promise<void>
  /** What it answers the turn with. */
  readonly stopReason?: StopReason
  readonly usage?: Usage
  /** What it streams back when a session is continued, as the protocol asks it to. */
  readonly history?: readonly FakeStep[]
}

/** What the agent asked for permission, and what it was answered. */
export interface FakeAnswers {
  /** Grows as the agent is answered, so a test can read what the client told it. */
  optionIds: string[]
  cancelled: number
}

/** The two pipes of a fake agent, to be handed to `connect` in the order that file wants them. */
export interface FakeAgent {
  /** What the agent writes, which is what the client reads. */
  readonly output: ReadableStream<Uint8Array>
  /** What the client writes, which is what the agent reads. */
  readonly input: WritableStream<Uint8Array>
  /** What the agent asked for permission, as it happened. */
  readonly answers: FakeAnswers
}

/** The notification one step is, or null when the step is something else entirely. */
function updateOf(step: FakeStep): SessionUpdate | null {
  switch (step.does) {
    case 'says':
      return {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: step.text } satisfies ContentBlock,
      }
    case 'thinks':
      return {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: step.text } satisfies ContentBlock,
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
      return call
    }
    case 'updates': {
      const update: Extract<SessionUpdate, { sessionUpdate: 'tool_call_update' }> = {
        sessionUpdate: 'tool_call_update',
        toolCallId: step.call.id,
        status: step.call.status,
      }
      if (step.call.title !== undefined) update.title = step.call.title
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
      return null
    default:
      return null
  }
}

/**
 * Builds the peer and answers the pipe the agent reads, plus what it was answered.
 *
 * The stream the caller keeps is the one it writes into; the one the agent writes is the other
 * half of the pair, and the caller passes both to `connect` in the order that file wants them.
 */
export function fakeAgent(behaviour: FakeBehaviour = {}): FakeAgent {
  const fromClient = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  const answers: FakeAnswers = { optionIds: [], cancelled: 0 }

  let sessionId = 'native-session'
  let cancelled = false
  let connection: AgentSideConnection | null = null

  const notify = async (step: FakeStep): Promise<void> => {
    const update = updateOf(step)
    // Awaited, so that what the agent says reaches the client before the turn's own answer:
    // the protocol is a stream of messages, and an unawaited notification would let the
    // response overtake the text it answers.
    if (update !== null) await connection?.sessionUpdate({ sessionId, update })
  }

  const agent: AcpAgent = {
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: behaviour.continues === true },
      authMethods: [...(behaviour.authMethods ?? [])],
      agentInfo: { name: 'Fake agent', version: '1.0.0' },
    }),
    newSession: () => ({ sessionId }),
    loadSession: async () => {
      for (const step of behaviour.history ?? []) {
        // oxlint-disable-next-line no-await-in-loop -- a scripted agent replays its history in the order it was written, one message at a time
        await notify(step)
      }
    },
    authenticate: () => undefined,
    cancel: () => {
      cancelled = true
    },
    prompt: async (): Promise<PromptResponse> => {
      cancelled = false
      for (const step of behaviour.steps ?? []) {
        if (cancelled) break
        // oxlint-disable-next-line no-await-in-loop -- the script is a sequence, and a test holds a turn open here
        await behaviour.between?.()
        if (cancelled) break
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
      const answer: PromptResponse = { stopReason: behaviour.stopReason ?? 'end_turn' }
      if (behaviour.usage !== undefined) answer.usage = behaviour.usage
      return answer
    },
  }

  connection = new AgentSideConnection(
    () => agent,
    ndJsonStream(toClient.writable, fromClient.readable),
  )

  return { output: toClient.readable, input: fromClient.writable, answers }
}
