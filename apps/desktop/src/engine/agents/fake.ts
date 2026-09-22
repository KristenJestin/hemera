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
  ndJsonStream,
  type Agent as AcpAgent,
  type ContentBlock,
  type LoadSessionRequest,
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
  type ToolCallStatus,
  type Usage,
} from '@agentclientprotocol/sdk'
import { Effect, Layer } from 'effect'

import {
  type ExitObservation,
  ProcessSupervisor,
  type ProcessSupervisorService,
  type SupervisedProcess,
} from './supervisor.ts'

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
  /** Called with the text of each prompt as it arrives, for a test that watches the pipe. */
  readonly onPrompt?: (text: string) => void
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
  /** How many times the agent was asked to load a session, whether or not it agreed. */
  readonly loads: number
  /** How many times the agent was asked to resume one, whether or not it agreed. */
  readonly resumes: number
  /** How many times the agent was told to cancel, whether or not it listened. */
  readonly cancels: number
  /** Every option it was put on, as , in the order it was told. */
  readonly choices: string[]
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
  loads: number
  resumes: number
  cancels: number
  choices: string[]
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
      return null
    default:
      return null
  }
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
    loads: 0,
    resumes: 0,
    cancels: 0,
    choices: [],
  }

  let sessionId = script.nativeSessionId ?? 'native-session'
  // What it announces now, which a choice replaces: the protocol answers a choice with the whole
  // set of options as they stand, and this is that set.
  let announced: SessionConfigOption[] = [...(script.configOptions ?? [])]
  let cancelled = false
  let dead = false
  let connection: AgentSideConnection | null = null

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

  const agent: AcpAgent = {
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: script.continues === true,
        // Advertised unless the script says otherwise, and whether the answer is an error is the
        // script's: the fallback a refused resume forces is a path Hemera has to walk, and a
        // capability it never sees is a path no test can reach. `advertisesResume: false` is that
        // last path — an agent that can only be loaded, which is what the load-with-dedup step of
        // D5-07 is for.
        sessionCapabilities: script.advertisesResume === false ? {} : { resume: {} },
      },
      authMethods: [...(script.authMethods ?? [])],
      agentInfo: { name: 'Fake agent', version: '1.0.0' },
    }),
    newSession: () => {
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
    loadSession: async (request: LoadSessionRequest): Promise<void> => {
      answers.loads += 1
      if (script.refusesLoad === true) throw new Error('this agent refuses to load a session')
      sessionId = request.sessionId
      for (const step of script.history ?? []) {
        // oxlint-disable-next-line no-await-in-loop -- a scripted agent replays its history in the order it was written, one message at a time
        await notify(step)
      }
    },
    resumeSession: (request: ResumeSessionRequest): ResumeSessionResponse => {
      answers.resumes += 1
      if (script.refusesResume === true) throw new Error('this agent refuses to resume a session')
      sessionId = request.sessionId
      return {}
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
      script.onPrompt?.(text)
      for (const step of script.steps ?? []) {
        if (cancelled) break
        // oxlint-disable-next-line no-await-in-loop -- the script is a sequence, and a test holds a turn open here
        await script.between?.()
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
 */
export function fakeSupervisorOf(next: () => FakeAgent): Layer.Layer<ProcessSupervisor> {
  return Layer.succeed(ProcessSupervisor, {
    start: (command) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const agent = next()
          // Recorded on the agent itself, so a suite can say what was started — and, which is
          // the point of D5-17, what was not.
          agent.starts.push(command)
          return supervisedOf(agent)
        }),
        (process) => process.stop,
      ),
  } satisfies ProcessSupervisorService)
}
