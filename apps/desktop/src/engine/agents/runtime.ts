/**
 * One turn, from the prompt to its stop reason (design D5-05, D5-09, D5-12).
 *
 * The runtime is what stands between the window and an agent. It finds the agent, starts it,
 * opens the native session, writes every entry the thread keeps, asks the user when the agent
 * needs a decision, and closes the turn however it ends: a stop reason, a Stop, or a death.
 *
 * Everything it writes goes through `Sessions`, so the thread is the same whether it is read
 * while the turn runs or after the window was closed — and everything it writes is also handed
 * to `AgentNotices`, so a window watching that Session sees it as it happens rather than by
 * asking again.
 *
 * Nothing here is a step of its own: the runtime holds the connection of each Session, the turn
 * each of them is running, and it is the only writer of the entries an agent produced. A
 * permission is a `Deferred` the agent's own question blocks on, which is what makes Stop able
 * to answer a question nobody answered.
 */
import {
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Layer,
  Predicate,
  Queue,
  Result,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import { existsSync } from 'node:fs'

import type { AgentProvider, Session, SessionEntry } from '@hemera/core'

import {
  type AgentConnection,
  type AgentEvent,
  type AgentHandshake,
  type AgentOption,
  type PermissionAnswer,
  type PermissionQuestion,
  type UsageReport,
  type WindowReport,
  connect,
} from './client.ts'
import { Discovery, type ResolvedAgent, type UnusableAgentError } from './discovery.ts'
import { Pool, SWEEP_EVERY } from './pool.ts'
import { rebuiltContext } from './resume.ts'
import { ProcessSupervisor, type SupervisedProcess } from './supervisor.ts'
import { Projects } from '../projects.ts'
import { Sessions, type NativeRecord, type ThreadWrite } from '../sessions.ts'

/** How long an agent is given to answer `session/cancel` before its process tree is stopped. */
export const CANCEL_GRACE = Duration.seconds(10)

/** Everything that can stop the engine from talking to an agent, as one thing to report. */
export class AgentRuntimeError extends Data.TaggedError('AgentRuntimeError')<{
  readonly what: string
  readonly cause: string
}> {
  /**
   * What the window shows: the step and what refused it.
   *
   * A tagged error has no message, and a refusal that crosses the port without one crosses as
   * its own fields — which is a shape and not an answer. This is the sentence.
   */
  override get message(): string {
    return `${this.what}: ${this.cause}`
  }
}

/** How a turn ended: the protocol's own reasons, and the one Hemera adds for a dead agent. */
export type TurnStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'
  | 'interrupted'

/** What a turn ended with, and what it cost. */
export interface TurnReport {
  /**
   * An ACP stop reason — `end_turn`, `max_tokens`, `refusal`, `cancelled` — or `interrupted`, the
   * one Hemera adds for a turn whose agent stopped running under it.
   */
  readonly stopReason: TurnStopReason
  readonly usage: UsageReport | null
}

/** What came of asking an agent to carry its own session on (design D5-07). */
export interface ResumeReport {
  /**
   * `attached` when the agent took its session back, `fallback` when Hemera rebuilt the context.
   *
   * Never `lost`: a resume always leaves the Session with an agent that holds something — its own
   * session, or the thread it was just given. `lost` is what a Session's own record says of an
   * agent that died, and it is read from there rather than answered by a resume.
   */
  readonly state: 'attached' | 'fallback'
  /** Why the fallback was needed, in a sentence the interface shows; null when it was not. */
  readonly reason: string | null
}

/**
 * Why an agent has nothing to offer, in the words the composer shows (design D5-17, D5-21).
 *
 * Three refusals and not one, because they are three different things to be told: the agent is
 * not on this machine, it is there and nobody signed it in, or it was started and would not
 * speak. Each carries the sentence the page shows; none of them is an empty list, which is what
 * an agent that offers no options at all answers.
 */
export interface AgentOfferRefusal {
  readonly kind: 'not_installed' | 'not_signed_in' | 'failed'
  readonly message: string
}

/**
 * Which of the three a resolve refused with, read off the refusal itself.
 *
 * The refusal is what looked at the machine — the command on the `PATH`, the login file the
 * agent wrote — so it is what says which of the three this is. An adapter missing from Hemera's
 * own installation is not one of the reader's two: it is a broken install, and the composer
 * shows it as the agent having failed.
 */
function refusalKind(refusal: UnusableAgentError): AgentOfferRefusal['kind'] {
  if (Predicate.isTagged(refusal, 'AgentNotInstalledError')) return 'not_installed'
  if (Predicate.isTagged(refusal, 'AgentNotSignedInError')) return 'not_signed_in'
  return 'failed'
}

/** Where an agent is started, and what it is started with: the supervisor's own two options. */
interface AgentStartOptions {
  cwd: string
  env?: Record<string, string>
}

/** What an agent offers a Home, or why it offers nothing. */
export interface AgentOfferReport {
  readonly options: readonly AgentOption[]
  readonly refusal: AgentOfferRefusal | null
}

/** What the engine can ask of an agent, on behalf of a window. */
export interface AgentRuntimeService {
  /** Starts the Session's agent if it is not running, and answers what it announced. */
  readonly start: (sessionId: string) => Effect.Effect<AgentHandshake, AgentRuntimeError>
  /** What the agent lets this Session choose, as it announced it (design D5-13). */
  readonly options: (sessionId: string) => Effect.Effect<readonly AgentOption[], AgentRuntimeError>
  /**
   * What an agent offers a Project, before any Session holds it (design D5-17).
   *
   * The composer of a Project's Home has an agent and its own controls to choose before there is
   * a Session to ask: what an agent offers is said by the agent itself, and asking it is what
   * this does. Nothing is written and no Session is made — what it answers is what the Session
   * made from that choice will offer.
   *
   * An agent that cannot be asked answers a refusal rather than an empty list: a machine without
   * that agent, a machine nobody signed it in on, and an agent that would not speak are three
   * different things and the composer says which one it is showing (D5-17, D5-21).
   */
  readonly offer: (
    projectId: string,
    provider: AgentProvider,
  ) => Effect.Effect<AgentOfferReport, AgentRuntimeError>
  /**
   * Puts the agent of a Home's composer on one of its own options, before a Session exists.
   *
   * The probe session `offer` opened is where the choice is made, and what comes back is what
   * the agent announces now: an option it only publishes once another one has been chosen — the
   * effort a model unlocks — is announced by that answer and by nothing else (D5-13, D5-17).
   */
  readonly offerSet: (
    projectId: string,
    provider: AgentProvider,
    optionId: string,
    value: string,
  ) => Effect.Effect<AgentOfferReport, AgentRuntimeError>
  readonly setOption: (
    sessionId: string,
    optionId: string,
    value: string,
  ) => Effect.Effect<void, AgentRuntimeError>
  /** Sends one turn and answers when the agent is done with it. */
  readonly prompt: (sessionId: string, text: string) => Effect.Effect<TurnReport, AgentRuntimeError>
  /** Stops the turn running in this Session, if one is: the user's Stop. */
  readonly stop: (sessionId: string) => Effect.Effect<void>
  /** Answers the permission a Session is waiting on; null is the end of the question. */
  readonly decide: (
    sessionId: string,
    optionId: string | null,
  ) => Effect.Effect<void, AgentRuntimeError>
  /** Asks the agent to carry on the session it handed back, or rebuilds the context (D5-07). */
  readonly resume: (sessionId: string) => Effect.Effect<ResumeReport, AgentRuntimeError>
  /** Lets go of an agent nobody is talking to; the next prompt starts it again. */
  readonly release: (sessionId: string) => Effect.Effect<void>
  /** The Sessions whose agent is running right now. */
  readonly alive: Effect.Effect<readonly string[]>
}

/** What a Session did that the window is told about, and that has no entry of its own. */
export type Notice = 'permission_requested' | 'turn_ended' | 'agent_died' | 'session_fallback'

/** Where a written entry goes besides the database: the window watching this Session. */
export interface AgentNoticesService {
  readonly wrote: (sessionId: string, entry: SessionEntry) => void
  /** Something about a Session changed without an entry: a question arrived, a turn ended. */
  readonly changed: (sessionId: string, what: Notice) => void
}

export class AgentNotices extends Context.Service<AgentNotices, AgentNoticesService>()(
  'AgentNotices',
) {}

/**
 * A runtime with nobody watching.
 *
 * The engine's own layer puts the window there; a test that only reads the thread does not need
 * one, and a port with a default is what keeps a notice from being something a caller can
 * forget to provide.
 */
export const NoNotices = Layer.succeed(AgentNotices, {
  wrote: () => undefined,
  changed: () => undefined,
})

/** One running agent, as the runtime keeps it. */
interface Live {
  readonly connection: AgentConnection
  readonly process: SupervisedProcess
  /**
   * The agent's events, waiting to be written.
   *
   * The ACP client calls back from its own reader, outside any fiber this file owns, so an event
   * is handed over rather than written where it lands: one fiber per Session drains this in the
   * order the agent said it, and stopping the queue is what ends that fiber when it is let go.
   */
  readonly queue: Queue.Queue<AgentEvent>
  readonly cwd: string
  /** The handle the agent gave this Session, which a resume asks it to take back. */
  nativeSessionId: string
  /** What the supervisor observed when the process died, or null while it is alive. */
  death: { readonly code: number | null; readonly signal: string | null } | null
  /**
   * A context Hemera rebuilt because the agent lost its own session.
   *
   * Held until the next prompt rather than sent on its own: an agent has nothing to do with a
   * conversation it cannot answer, and a turn is what a prompt is.
   */
  context: string | null
  /** Why that context had to be rebuilt, in the agent's own terms; null when it did not. */
  why: string | null
  /**
   * The context window the agent announced, and how much of it it says is in use (D5-20).
   *
   * Held for the life of the connection rather than for the turn that heard it: an agent says
   * how big its window is once, and every turn after that is measured against the same one.
   */
  window: WindowReport | null
  /**
   * What the agent has said that the thread does not hold yet.
   *
   * The events of a Session are written by the fiber that drains them rather than by the turn that
   * asked for them, so the entry that ends a turn would otherwise be written before the message it
   * ended with — and the thread would show the end of a turn above the words that ended it. It is
   * counted per Session rather than per turn because a replayed history arrives with no turn at
   * all: the entries a load updates have to be in the thread before the window is told the Session
   * is back. Counted when an event is offered, given back when it is written.
   */
  pending: number
}

/** A tool call, as the thread accumulates it: an update carries only what changed. */
interface Call {
  title: string
  kind: string | null
  status: string | null
  locations: readonly string[]
  detail: string
}

/** A permission the turn is blocked on. */
interface Pending {
  readonly toolCallId: string
  readonly body: string
  readonly payload: string
  readonly options: readonly { readonly id: string; readonly name: string }[]
  readonly answer: Deferred.Deferred<PermissionAnswer>
}

/** One turn of one Session. */
interface Turn {
  readonly id: string
  /** What has been said so far in each message and each thought, by what they are matched on. */
  readonly said: Map<string, string>
  readonly calls: Map<string, Call>
  permission: Pending | null
  /** Set when Hemera closed the turn itself, which is what its report says it ended with. */
  closed: 'cancelled' | null
}

/**
 * What any of the ports refuses with, as Effect names it.
 *
 * The ports say no in their own words — a tagged refusal, a domain error the engine wraps, a spawn
 * that failed — and a report has one place for all of them. `_tag` is how every Effect error names
 * itself: the ports are five services with five error types, and what this file needs of all of
 * them is the fields any of them can carry.
 */
interface Refused {
  // oxlint-disable-next-line no-underscore-dangle -- Effect's own name for the tag of an error
  readonly _tag?: string
  readonly message?: string
  readonly name?: string
}

/**
 * What a refusal is called in a report.
 *
 * What is shown is what the port said, because the tag alone ("AgentProtocolError") is the name of
 * a kind of refusal and not an answer to anything; the tag is what is left when there is no
 * message, and never a stack.
 */
function describe(refusal: Refused): string {
  // oxlint-disable-next-line no-underscore-dangle -- Effect's own name for the tag of an error
  return refusal.message ?? refusal._tag ?? refusal.name ?? 'the port refused'
}

/** A refusal from any of the ports, as the one error this service declares. */
const attempt = <A, E extends Refused, R>(
  what: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, AgentRuntimeError, R> =>
  Effect.mapError(effect, (refusal) => new AgentRuntimeError({ what, cause: describe(refusal) }))

/** A line of the turn entry, as the thread shows it. */
const STOP_TEXT: Record<TurnStopReason, string> = {
  end_turn: 'The agent finished its turn.',
  max_tokens: 'The agent reached its token limit.',
  max_turn_requests: 'The agent reached its request limit.',
  refusal: 'The agent refused to continue.',
  cancelled: 'The turn was stopped.',
  interrupted: 'The agent stopped running.',
}

/** What the composer calls an option's value, for the decision line. */
function chosenName(pending: Pending, optionId: string): string {
  return pending.options.find((option) => option.id === optionId)?.name ?? optionId
}

export class AgentRuntime extends Context.Service<AgentRuntime, AgentRuntimeService>()(
  'AgentRuntime',
) {}

/**
 * The runtime of the engine, over the ports it needs.
 *
 * Scoped rather than plain: each running agent is watched for its death and each Session is
 * drained by a fiber of its own, and those fibers belong to the engine's lifetime — an engine
 * that shuts down interrupts them, and nothing keeps reading a process that is gone.
 */
export const runtimeLayer = Layer.effect(
  AgentRuntime,
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const projects = yield* Projects
    const discovery = yield* Discovery
    const supervisor = yield* ProcessSupervisor
    const notices = yield* AgentNotices
    const pool = yield* Pool

    /**
     * The scope the engine gave this layer: the lifetime every fiber and process here lives in.
     *
     * An effect that starts a process or a fiber needs one, and the public methods must not ask
     * their caller for it — a window asking for a turn does not own the engine's lifetime — so
     * what needs a scope is given this layer's own, which lasts as long as the engine does.
     */
    const scope = yield* Effect.scope

    const owned = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Effect.Effect<A, E> =>
      effect.pipe(Scope.provide(scope))

    const live = new Map<string, Live>()
    const turns = new Map<string, Turn>()

    /** One entry written for an agent, and the window told about it. */
    const write = (sessionId: string, entry: ThreadWrite) =>
      Effect.gen(function* () {
        const written = yield* attempt('writing the entry', sessions.write(sessionId, entry))
        notices.wrote(sessionId, written.entry)
        return written.entry
      })

    /** One line, written as a `note`: what Hemera did that the agent did not say. */
    const note = (sessionId: string, turn: Turn | undefined, body: string, reason: string) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'note',
        body,
        payload: JSON.stringify({ reason }),
        turnId: turn?.id ?? null,
      })

    /**
     * What one thing an agent said becomes in the thread.
     *
     * Chunks are accumulated rather than appended: an agent streams a message a few words at a
     * time, and a thread with one entry per chunk is a thread nobody can read. What they are
     * accumulated under is what the protocol gives — the message the agent named, or the tool
     * call — which is also what a replayed history is matched against, so a resumed Session
     * updates the entries it already has instead of writing them a second time (D5-08).
     */
    const writeEvent = (sessionId: string, event: AgentEvent) =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        const origin = event.replay ? ('replay' as const) : ('live' as const)

        if (event.type === 'message' || event.type === 'thought') {
          const kind = event.type === 'message' ? ('message' as const) : ('thought' as const)
          // The kind is part of the key whether or not the agent named the message: OpenCode
          // sends a thought and the answer that follows it under one `messageId`, and a key that
          // ignored the kind would accumulate both into the entry the first chunk created — an
          // answer folded into a thought, under one `correlationId`, as one row of the thread.
          const key =
            event.messageId === null
              ? `turn:${turn?.id ?? 'none'}:${kind}`
              : `${event.messageId}:${kind}`
          const said = `${turn?.said.get(key) ?? ''}${event.text}`
          turn?.said.set(key, said)
          yield* write(sessionId, {
            role: 'agent',
            kind,
            body: said,
            correlationId: key,
            turnId: turn?.id ?? null,
            origin,
          })
          return
        }

        if (event.type === 'plan') {
          const started = event.entries.find((entry) => entry.status === 'in_progress')
          yield* write(sessionId, {
            role: 'agent',
            kind: 'plan',
            // What a one-line reader shows of a plan is the step it is on.
            body: started?.content ?? event.entries[0]?.content ?? '',
            payload: JSON.stringify({ entries: event.entries }),
            correlationId: `turn:${turn?.id ?? 'none'}:plan`,
            turnId: turn?.id ?? null,
            origin,
          })
          return
        }

        if (event.type === 'usage') {
          // The window is not a thing the agent said, it is the measure the turn is read against:
          // it changes no entry and is kept for the next turn to be measured by. A replay is
          // history, and an older reading written over a newer one is a meter that goes backwards.
          const running = live.get(sessionId)
          if (!event.replay && running !== undefined) running.window = event.window
          return
        }

        const said = event.call
        const held = turn?.calls.get(said.id)
        // An update carries only what changed: a title or a detail it does not repeat is one the
        // thread already has, and writing the empty one over it would erase what is on screen.
        const call: Call = {
          title: said.title === '' ? (held?.title ?? '') : said.title,
          kind: said.kind ?? held?.kind ?? null,
          status: said.status ?? held?.status ?? null,
          locations: said.locations.length === 0 ? (held?.locations ?? []) : said.locations,
          detail: said.detail === '[]' ? (held?.detail ?? '[]') : said.detail,
        }
        if (turn !== undefined) turn.calls.set(said.id, call)

        yield* write(sessionId, {
          role: 'agent',
          kind: 'tool_call',
          body: call.title,
          payload: JSON.stringify({ call }),
          correlationId: `call:${said.id}`,
          turnId: turn?.id ?? null,
          state: call.status,
          origin,
        })

        // What a call carries that the thread draws on its own: a change it proposes, a terminal
        // it opened. They are written beside the call rather than inside it, because the side
        // column reads the files a turn touched without reading the calls one by one.
        for (const kind of ['diff', 'terminal'] as const) {
          if (!said.contents.includes(kind)) continue
          yield* write(sessionId, {
            role: 'agent',
            kind,
            body: call.title,
            payload: call.detail,
            correlationId: `call:${said.id}:${kind}`,
            turnId: turn?.id ?? null,
            origin,
          })
        }
      }).pipe(
        // Given back whatever came of the write: what the Session waits for is the thread to be as
        // long as what the agent said, not for every write to have succeeded.
        Effect.ensuring(
          Effect.sync(() => {
            const held = live.get(sessionId)
            if (held !== undefined) held.pending -= 1
          }),
        ),
      )

    /**
     * Waits for what the agent said to be in the thread.
     *
     * Called before a turn entry is written, and before a Session is reported back: the entries of
     * a Session are written by the fiber that drains them, and the entry that ends a turn is not
     * the first thing that turn says.
     */
    const drained = (held: Live) =>
      Effect.gen(function* () {
        for (let look = 0; look < 10_000 && held.pending > 0; look++) {
          yield* Effect.yieldNow
        }
      })

    /** The two pipes of a child, as the ACP client takes them. */
    const pipes = (process: SupervisedProcess) => {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      let carry = ''

      return {
        input: new ReadableStream<Uint8Array>({
          start: (controller) => {
            // The reader attaches before anything is written: a line a child printed before a
            // reader was there is gone, and an agent answering `initialize` into the void would
            // leave the handshake waiting forever.
            process.onStdout((line) => {
              controller.enqueue(encoder.encode(`${line}\n`))
            })
            // The death of the agent ends what it has to say. A pipe left open for ever is a
            // turn waiting on a line that will never come, and the turn has to end.
            void Effect.runPromise(process.exited).then(() => {
              try {
                controller.close()
              } catch {
                // Already closed, or cancelled with the scope that held it.
              }
            })
          },
        }),
        output: new WritableStream<Uint8Array>({
          write: async (chunk) => {
            carry += decoder.decode(chunk, { stream: true })
            const lines = carry.split('\n')
            carry = lines.pop() ?? ''
            for (const line of lines) {
              if (line === '') continue
              // oxlint-disable-next-line no-await-in-loop -- the lines of one write go down the child's input in the order they were written
              await Effect.runPromise(process.write(line))
            }
          },
        }),
      }
    }

    /** The path of a Project, which is where an agent runs for it. */
    const mainPathOf = (projectId: string): Effect.Effect<string, AgentRuntimeError> =>
      Effect.gen(function* () {
        const held = yield* attempt('reading the Project', projects.list())
        const project = held.find((candidate) => candidate.id === projectId)
        if (project === undefined) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'reading the Project',
              cause: `no Project has the identifier "${projectId}"`,
            }),
          )
        }
        return project.mainPath
      })

    /** The path of the Project a Session belongs to, which is where its agent is run. */
    const projectPath = (session: Session): Effect.Effect<string, AgentRuntimeError> =>
      mainPathOf(session.projectId)

    /** Where an agent runs for this Session: where it ran before, or the Project's own path. */
    const workingDirectory = (
      session: Session,
      native: NativeRecord,
    ): Effect.Effect<string, AgentRuntimeError> =>
      Effect.gen(function* () {
        const project = yield* projectPath(session)
        // A directory that is gone is not a place to run an agent in, and a Session does not
        // stop being one because its folder was moved: the Project's own path takes it in.
        if (native.cwd !== null && existsSync(native.cwd)) return native.cwd
        return project
      })

    /** What the supervisor is told to start, with only what the resolve named. */
    const startOptions = (resolved: ResolvedAgent, cwd: string) => {
      // Built in statements rather than by spreading a conditional empty object, the way the
      // supervisor builds what it hands the host: an env that is not there is not a property.
      const options: AgentStartOptions = { cwd }
      if (resolved.env !== undefined) options.env = resolved.env
      return options
    }

    /**
     * What each agent announced for a Project, until a choice in the composer changes it.
     *
     * Nothing about the answer depends on a Session — the same agent in the same Project offers
     * the same models — so it is kept rather than asked for again on every render. A choice
     * replaces it with what the agent announced in answer to that choice, because an option an
     * agent only publishes once another one is set is not in the list it opened with (D5-13).
     */
    const offered = new Map<string, readonly AgentOption[]>()

    /**
     * The session a Home's composer is being drawn from: the agent, and the session it opened.
     *
     * Kept rather than stopped (D5-05): an option the agent publishes only after another one is
     * chosen is announced by the session where the choice was made, and a probe stopped the
     * moment it answered would have to be started again to be asked — which is a second process
     * and a second `session/new` for every selector the reader touches. The pool's idle timer is
     * what closes it, exactly as it closes the agent of a Session nobody is talking to.
     */
    interface Probe {
      readonly process: SupervisedProcess
      readonly connection: AgentConnection
    }

    const probes = new Map<string, Probe>()

    /**
     * What was chosen in a Home's composer, per Project and agent.
     *
     * It outlives the probe that recorded it: the Session that choice starts is opened with the
     * model and the mode the reader picked before it existed (D5-17), and the probe is only how
     * the agent was asked.
     */
    const chosen = new Map<string, Map<string, string>>()

    /** How the pool names a probe, so a Session and a Home's agent are never the same entry. */
    const probeKey = (key: string) => `probe:${key}`

    /** Lets a probe go: the process stops and what it announced is asked again next time. */
    const letProbeGo = (key: string) =>
      Effect.gen(function* () {
        const held = probes.get(key)
        if (held === undefined) return
        probes.delete(key)
        offered.delete(key)
        yield* attempt('stopping the agent', held.process.stop).pipe(Effect.ignore)
      })

    /** A refusal of an offer, in the sentence the refusal itself carries. */
    const offerRefused = (kind: AgentOfferRefusal['kind'], message: string): AgentOfferReport => ({
      options: [],
      refusal: { kind, message },
    })

    /**
     * One start at a time, per Project and agent.
     *
     * Starting a probe is a spawn and a handshake, and two questions asked of the same composer
     * while that is in flight — the model chosen, then the effort, both after the pool let the
     * first probe go — would each find no probe and each start one. The second would take the
     * first's place in the book and the first would be a process nobody can reach, holding the
     * Project's folder open until the engine stops. The gate is per composer, so an agent being
     * started does not hold up the question asked of another one.
     */
    const probing = new Map<string, Semaphore.Semaphore>()

    const gateOf = (key: string): Semaphore.Semaphore => {
      const held = probing.get(key)
      if (held !== undefined) return held
      const made = Semaphore.makeUnsafe(1)
      probing.set(key, made)
      return made
    }

    /**
     * The probe of one Project and one agent, started if there is none.
     *
     * The agent is resolved first and refused first: an agent this machine does not have and an
     * agent nobody signed in are answered before a process exists (D5-17, D5-21).
     */
    const probeStarted = (
      projectId: string,
      provider: AgentProvider,
    ): Effect.Effect<Probe | AgentOfferReport, AgentRuntimeError, Scope.Scope> =>
      Effect.gen(function* () {
        const key = `${projectId}:${provider}`
        const held = probes.get(key)
        if (held !== undefined) return held

        const cwd = yield* mainPathOf(projectId)
        const resolved = yield* Effect.result(discovery.resolve(provider))
        if (Result.isFailure(resolved)) {
          // The refusal itself says which of the three it is — it is the one that read the
          // machine — and its sentence goes with it. Asking the machine a second time to name
          // the kind was a second look at a `PATH` that can have changed between the two, and a
          // kind that disagreed with the sentence beside it.
          return offerRefused(refusalKind(resolved.failure), resolved.failure.message)
        }

        const started = yield* Effect.result(
          attempt(
            'starting the agent',
            supervisor.start(
              resolved.success.command,
              resolved.success.args,
              startOptions(resolved.success, cwd),
            ),
          ),
        )
        if (Result.isFailure(started)) return offerRefused('failed', started.failure.message)
        const process = started.success

        const opened = yield* Effect.result(
          Effect.gen(function* () {
            const connection = yield* attempt(
              'speaking to the agent',
              connect({
                ...pipes(process),
                adapter: resolved.success.adapter,
                // Nobody is in the session this probe opens: what it reports has nowhere to go,
                // and a question asked there is cancelled rather than put to a window.
                onEvent: () => undefined,
                onPermission: () => Promise.resolve({ cancelled: true } satisfies PermissionAnswer),
              }),
            )
            yield* attempt('opening a session', connection.open(cwd))
            return connection
          }),
        )
        if (Result.isFailure(opened)) {
          // An agent that would not speak is not left running: it holds a folder open for a
          // composer that has just been told it has nothing to offer.
          yield* attempt('stopping the agent', process.stop).pipe(Effect.ignore)
          return offerRefused('failed', opened.failure.message)
        }

        const probe: Probe = { process, connection: opened.success }
        probes.set(key, probe)
        yield* pool.held(probeKey(key), letProbeGo(key))

        // What was already chosen in this composer, put back on the session that has just
        // opened. The pool lets a probe go once nobody has touched that composer for five
        // minutes, and the next choice made in it opens a second one: a probe that knew nothing
        // of the model picked before it would announce the options of an agent on its defaults,
        // and the effort that model publishes would not be among them (D5-13, D5-17).
        for (const [optionId, value] of chosen.get(key) ?? []) {
          yield* attempt('choosing an option', probe.connection.setOption(optionId, value)).pipe(
            // A choice this agent will not take again is not an offer that failed: the composer
            // is drawn from what the agent announces, which is what it is on.
            Effect.ignore,
          )
        }
        return probe
      })

    /** The same, asked one at a time: a composer asked twice at once starts one agent. */
    const probeOf = (
      projectId: string,
      provider: AgentProvider,
    ): Effect.Effect<Probe | AgentOfferReport, AgentRuntimeError, Scope.Scope> =>
      gateOf(`${projectId}:${provider}`).withPermits(1)(probeStarted(projectId, provider))

    /** A probe, or the refusal to make one: what `probeOf` answered, told apart. */
    const isProbe = (answered: Probe | AgentOfferReport): answered is Probe =>
      'connection' in answered

    /**
     * What an agent offers a Project, before any Session holds it (D5-17).
     *
     * It starts the agent, opens a session on the Project and keeps it: what an agent offers is
     * said by the agent, and the composer goes on asking the same session as choices are made in
     * it. Nothing is written and no Session is made — what it answers is what the Session made
     * from that choice will offer.
     */
    const offer = (
      projectId: string,
      provider: AgentProvider,
    ): Effect.Effect<AgentOfferReport, AgentRuntimeError, Scope.Scope> =>
      Effect.gen(function* () {
        const key = `${projectId}:${provider}`
        const known = offered.get(key)
        if (known !== undefined) {
          // A composer being read is a probe in use, whatever the clock says.
          yield* pool.used(probeKey(key))
          return { options: known, refusal: null }
        }

        const answered = yield* probeOf(projectId, provider)
        if (!isProbe(answered)) return answered
        const announced = answered.connection.options()
        offered.set(key, announced)
        return { options: announced, refusal: null }
      })

    /**
     * Puts the agent of a Home's composer on one of its own options (D5-13, D5-17).
     *
     * The choice is made on the probe session and the answer is what the agent announces now:
     * an option that only exists once a model has been picked — the effort of a reasoning model
     * — is published by that answer, which is why the list is replaced rather than merged into.
     */
    const offerSet = (
      projectId: string,
      provider: AgentProvider,
      optionId: string,
      value: string,
    ): Effect.Effect<AgentOfferReport, AgentRuntimeError, Scope.Scope> =>
      Effect.gen(function* () {
        const key = `${projectId}:${provider}`
        const answered = yield* probeOf(projectId, provider)
        if (!isProbe(answered)) return answered

        const set = yield* Effect.result(
          attempt('choosing an option', answered.connection.setOption(optionId, value)),
        )
        if (Result.isFailure(set)) return offerRefused('failed', set.failure.message)

        // What the reader chose, kept for the Session this composer will start, and what the
        // agent announced in answer to it, kept for the composer that is still being drawn.
        const held = chosen.get(key) ?? new Map<string, string>()
        held.set(optionId, value)
        chosen.set(key, held)
        offered.set(key, set.success)
        yield* pool.used(probeKey(key))
        return { options: set.success, refusal: null }
      })

    /**
     * Watches one agent for its death.
     *
     * A process that dies under a turn is the one end of a turn nothing in the protocol
     * announces: the turn is closed as interrupted, the thread keeps everything it has, and the
     * Session says its native handle is no longer worth anything — which is what makes the next
     * prompt offer a resumption rather than continue a conversation the agent has forgotten.
     */
    const watchDeath = (sessionId: string, held: Live) =>
      Effect.forkScoped(
        Effect.gen(function* () {
          const observation = yield* held.process.exited
          held.death = { code: observation.code, signal: observation.signal }
          if (live.get(sessionId) === held) live.delete(sessionId)

          const turn = turns.get(sessionId)
          const reason = `the agent exited with ${observation.code === null ? `signal ${observation.signal}` : `code ${observation.code}`}`
          // A turn the runtime closed itself — the grace of a Stop, say — is not told twice: the
          // death is what the stop asked for, and the turn keeps the reason it was closed with.
          if (turn !== undefined && turn.closed === null) {
            // What the agent said before it died is in the thread before the entry that says it
            // died: the death does not jump the queue of its own words.
            yield* drained(held)
            yield* note(sessionId, turn, 'The agent stopped running.', reason)
            yield* write(sessionId, {
              role: 'hemera',
              kind: 'turn',
              body: STOP_TEXT.interrupted ?? 'The agent stopped running.',
              payload: JSON.stringify({ stopReason: 'interrupted' }),
              correlationId: `turn:${turn.id}`,
              turnId: turn.id,
              state: 'interrupted',
            })
          }
          yield* attempt(
            'recording the agent',
            sessions.recordNative(sessionId, {
              nativeSessionId: held.nativeSessionId,
              nativeState: 'lost',
              cwd: held.cwd,
            }),
          ).pipe(Effect.ignore)
          notices.changed(sessionId, 'agent_died')
        }),
      )

    /**
     * The agent of a Session, started if it was not running.
     *
     * A Session is made with the agent it will run, and it keeps it: the Sessions written before
     * the agents existed have none, and asking one of those to speak is a refusal the interface
     * shows, as is one whose agent this machine does not have (D5-17). Neither is replaced by
     * another agent.
     */
    const opened = (sessionId: string): Effect.Effect<Live, AgentRuntimeError, Scope.Scope> =>
      Effect.gen(function* () {
        const held = live.get(sessionId)
        if (held !== undefined && held.death === null) return held
        if (held !== undefined) live.delete(sessionId)

        const { session, native } = yield* attempt('reading the Session', sessions.one(sessionId))
        const provider: AgentProvider | null = session.provider
        if (provider === null) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'starting the agent',
              cause: 'this Session has no agent: the user has not chosen one',
            }),
          )
        }

        const resolved = yield* attempt('finding the agent', discovery.resolve(provider))
        const cwd = yield* workingDirectory(session, native)
        const process = yield* attempt(
          'starting the agent',
          supervisor.start(resolved.command, resolved.args, startOptions(resolved, cwd)),
        )

        const queue = yield* Queue.unbounded<AgentEvent>()
        const connection = yield* attempt(
          'speaking to the agent',
          connect({
            ...pipes(process),
            adapter: resolved.adapter,
            onEvent: (event) => {
              // Counted before it is offered: the thread is not told the Session is back while one
              // of its own events is still on its way to it.
              const current = live.get(sessionId)
              if (current !== undefined) current.pending += 1
              Queue.offerUnsafe(queue, event)
            },
            onPermission: (question) => Effect.runPromise(ask(sessionId, question)),
          }),
        )

        const started: Live = {
          connection,
          process,
          queue,
          cwd,
          nativeSessionId: '',
          death: null,
          context: null,
          why: null,
          window: null,
          pending: 0,
        }
        live.set(sessionId, started)
        // The entries of a turn are written in the order the agent said them, which is why one
        // fiber drains one Session's queue rather than each event being written where it lands.
        yield* Effect.forkScoped(
          Stream.fromQueue(queue).pipe(
            Stream.runForEach((event) => writeEvent(sessionId, event).pipe(Effect.ignore)),
          ),
        )
        yield* watchDeath(sessionId, started)

        const fresh = native.nativeSessionId === null || native.nativeState === 'none'
        const resumed = yield* takeBack(sessionId, started, native)
        if (resumed !== null) return yield* Effect.fail(resumed)

        // A Session opened for the first time starts on the choices its composer made before it
        // existed: the model and the mode were picked on the Home's probe, and the session the
        // agent has just opened knows nothing of them until it is told (D5-17).
        if (fresh) {
          for (const [optionId, value] of chosen.get(`${session.projectId}:${provider}`) ?? []) {
            yield* attempt('choosing an option', connection.setOption(optionId, value)).pipe(
              // A choice the agent will not take is not a Session that cannot start: it opens on
              // what the agent is on, and the composer shows what that is.
              Effect.ignore,
            )
          }
        }
        return started
      })

    /** Says the Session goes on with the agent it already had, and remembers where it runs. */
    const attached = (sessionId: string, held: Live, handle: string): Effect.Effect<null, never> =>
      Effect.gen(function* () {
        held.nativeSessionId = handle
        yield* attempt(
          'recording the agent',
          sessions.recordNative(sessionId, {
            nativeSessionId: handle,
            nativeState: 'attached',
            cwd: held.cwd,
          }),
        ).pipe(Effect.ignore)
        return null
      })

    /**
     * Hands the agent back its own session, or opens a new one.
     *
     * A Session that was never run in has no handle to give back and is opened; one whose handle
     * the agent no longer recognises, or whose directory is gone, is opened again and told what
     * was said before (D5-07). A directory that no longer exists is not asked about at all: an
     * agent started in a directory that is gone would fail for a reason the user cannot see.
     *
     * The order is the design's: resume native, then load, then the fallback. An agent that
     * advertises neither capability is not asked twice.
     */
    const takeBack = (
      sessionId: string,
      held: Live,
      native: NativeRecord,
    ): Effect.Effect<AgentRuntimeError | null, never> =>
      Effect.gen(function* () {
        const handle = native.nativeSessionId
        if (handle === null || native.nativeState === 'none') {
          const openedSession = yield* Effect.result(
            attempt('opening a session', held.connection.open(held.cwd)),
          )
          if (Result.isFailure(openedSession)) return openedSession.failure
          return yield* attached(sessionId, held, openedSession.success)
        }
        // A Session that ran in a directory that is gone cannot be taken back there: the agent is
        // asked to carry nothing, and the thread is rebuilt where the Project lives (D5-07).
        if (native.cwd !== null && !existsSync(native.cwd)) {
          return yield* fallback(
            sessionId,
            held,
            `the directory this Session ran in is gone: ${native.cwd}`,
          )
        }

        // Native first, then load, then the fallback (D5-07): the agent is asked to carry the
        // conversation on as it stands, and asked to send it back only if it cannot.
        if (held.connection.handshake.resumes) {
          const resumed = yield* Effect.result(
            attempt('resuming the session', held.connection.resume(handle, held.cwd)),
          )
          if (Result.isSuccess(resumed)) return yield* attached(sessionId, held, handle)
        }

        if (held.connection.handshake.continues) {
          const loaded = yield* Effect.result(
            attempt('loading the session', held.connection.load(handle, held.cwd)),
          )
          if (Result.isSuccess(loaded)) return yield* attached(sessionId, held, handle)
          return yield* fallback(sessionId, held, loaded.failure.cause)
        }

        return yield* fallback(sessionId, held, 'the agent cannot carry its own session')
      })

    /**
     * Rebuilds what the thread holds for an agent that lost its own session (D5-07).
     *
     * The context is written into the thread as a `hemera` entry and held for the next prompt:
     * the Session goes on in the same place, with the same agent, and `native_state` says
     * `fallback` so the banner over the thread can say what happened rather than claim the
     * conversation was continued.
     */
    const fallback = (
      sessionId: string,
      held: Live,
      reason: string,
    ): Effect.Effect<AgentRuntimeError | null, never> =>
      Effect.gen(function* () {
        const page = yield* Effect.result(attempt('reading the thread', sessions.read(sessionId)))
        if (Result.isFailure(page)) return page.failure

        const rebuilt = rebuiltContext(page.success.entries)
        // The Session is opened again where the Project lives: the agent is given the rebuilt
        // context rather than a session it cannot take back, and the handle of that new session
        // is what the next run of the application takes back.
        const openedSession = yield* Effect.result(
          attempt('opening a session', held.connection.open(held.cwd)),
        )
        if (Result.isFailure(openedSession)) return openedSession.failure
        held.nativeSessionId = openedSession.success
        held.context = rebuilt
        held.why = reason
        yield* attempt(
          'recording the agent',
          sessions.recordNative(sessionId, {
            nativeSessionId: openedSession.success,
            nativeState: 'fallback',
            cwd: held.cwd,
          }),
        ).pipe(Effect.ignore)
        yield* write(sessionId, {
          role: 'hemera',
          kind: 'note',
          body: 'The agent lost this Session, so what was said before was rebuilt for it.',
          payload: JSON.stringify({ reason, context: rebuilt }),
          turnId: null,
        }).pipe(Effect.ignore)
        notices.changed(sessionId, 'session_fallback')
        return null
      })

    /**
     * The agent's question, as the thread's last entry and a turn held still.
     *
     * Nothing is remembered between two questions: the same tool asking again blocks the turn
     * again, because an answer is about the call it was given for and not about the tool.
     */
    const ask = (
      sessionId: string,
      question: PermissionQuestion,
    ): Effect.Effect<PermissionAnswer, AgentRuntimeError> =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        if (turn === undefined) {
          // A question outside a turn is a question with nothing to block: the protocol has an
          // outcome for a question that ended, and it is the honest answer to this one.
          return { cancelled: true } satisfies PermissionAnswer
        }

        const answer = yield* Deferred.make<PermissionAnswer>()
        const payload = JSON.stringify({
          toolCallId: question.toolCallId,
          options: question.options,
        })
        const pending: Pending = {
          toolCallId: question.toolCallId,
          body: question.title,
          payload,
          options: question.options,
          answer,
        }
        turn.permission = pending

        yield* write(sessionId, {
          role: 'agent',
          kind: 'permission_request',
          body: question.title,
          payload,
          correlationId: `perm:${question.toolCallId}`,
          turnId: turn.id,
          state: 'pending',
        })
        notices.changed(sessionId, 'permission_requested')
        return yield* Deferred.await(answer)
      })

    /** The turn entry, written once per turn: what it ended with, in the thread's words. */
    const closeTurn = (sessionId: string, turn: Turn, stopReason: TurnStopReason) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'turn',
        body: STOP_TEXT[stopReason] ?? `The turn ended: ${stopReason}.`,
        payload: JSON.stringify({ stopReason }),
        correlationId: `turn:${turn.id}`,
        turnId: turn.id,
        state: stopReason,
      })

    const start = (sessionId: string) =>
      Effect.gen(function* () {
        const held = yield* opened(sessionId)
        return held.connection.handshake
      })

    const options = (sessionId: string) =>
      Effect.gen(function* () {
        const held = yield* opened(sessionId)
        return held.connection.options()
      })

    const setOption = (sessionId: string, optionId: string, value: string) =>
      Effect.gen(function* () {
        const held = yield* opened(sessionId)
        yield* attempt('choosing an option', held.connection.setOption(optionId, value))
      })

    const prompt = (sessionId: string, text: string) =>
      Effect.gen(function* () {
        if (turns.has(sessionId)) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'prompting',
              cause: 'a turn is already running in this Session',
            }),
          )
        }

        const held = yield* opened(sessionId)
        const turn: Turn = {
          id: `${sessionId}:${Date.now()}`,
          said: new Map(),
          calls: new Map(),
          permission: null,
          closed: null,
        }
        turns.set(sessionId, turn)

        // The user's own message is written first, and by `append`: the thread shows what was
        // asked before what was answered, and it is what proposes the Session's title. It is
        // handed to the window like every other entry, because the page draws the thread from
        // what arrives: a message written and never announced is one only a second read shows.
        const asked = yield* attempt('writing the message', sessions.append(sessionId, text))
        notices.wrote(sessionId, asked.entry)

        const sent = held.context === null ? text : `${held.context}\n\n${text}`
        held.context = null

        const report = yield* Effect.gen(function* () {
          const outcome = yield* Effect.result(attempt('prompting', held.connection.prompt(sent)))
          if (Result.isSuccess(outcome)) {
            const answered = outcome.success
            // What is in the thread is read before the window is: the announcement travels as a
            // notification of its own, and the entry is written from it once everything the agent
            // said is held rather than racing it.
            yield* drained(held)
            const window = held.window
            // What a turn used and what the window holds are two readings, and either can be
            // missing: an agent that accounts for a turn but never announces a window leaves the
            // meter with nothing to divide by, and one that announces a window and answers
            // nothing leaves it with what it is filling (D5-20). The entry is written when the
            // agent had anything to say at all, and the payload says which halves it said.
            if (answered.usage !== null || window !== null) {
              yield* write(sessionId, {
                role: 'hemera',
                kind: 'usage',
                body: `${answered.usage?.totalTokens ?? window?.used ?? 0} tokens`,
                payload: JSON.stringify({
                  totalTokens: answered.usage?.totalTokens ?? null,
                  inputTokens: answered.usage?.inputTokens ?? null,
                  outputTokens: answered.usage?.outputTokens ?? null,
                  thoughtTokens: answered.usage?.thoughtTokens ?? null,
                  used: window?.used ?? null,
                  size: window?.size ?? null,
                  cost: window?.cost ?? null,
                }),
                correlationId: `turn:${turn.id}:usage`,
                turnId: turn.id,
              })
            }
            yield* closeTurn(sessionId, turn, turn.closed ?? answered.stopReason)
            return {
              stopReason: turn.closed ?? answered.stopReason,
              usage: answered.usage,
            } satisfies TurnReport
          }

          // The agent never answered: either the process died under the turn, or Hemera stopped
          // an agent that would not stop. The thread keeps everything it received either way.
          const stopReason = turn.closed ?? (held.death === null ? 'cancelled' : 'interrupted')
          yield* drained(held)
          yield* closeTurn(sessionId, turn, stopReason)
          return { stopReason, usage: null } satisfies TurnReport
        }).pipe(Effect.ensuring(Effect.sync(() => turns.delete(sessionId))))

        notices.changed(sessionId, 'turn_ended')
        return report
      })

    /**
     * The user's Stop.
     *
     * A permission that is waiting is answered rather than cancelled — the agent is not working,
     * it is asking, and the protocol has an outcome for a question that ended — and the turn is
     * then asked to cancel like any other. An agent that does not answer within the grace is
     * stopped: its process tree goes, the turn is closed by Hemera, and a `note` says so, because
     * a turn that ends with no word from the agent is a turn the user has to be told about.
     */
    const stop = (sessionId: string) =>
      Effect.gen(function* () {
        const held = live.get(sessionId)
        const turn = turns.get(sessionId)
        if (turn === undefined) return

        const pending = turn.permission
        if (pending !== null) {
          turn.permission = null
          yield* write(sessionId, {
            role: 'user',
            kind: 'permission_decision',
            body: 'Stopped',
            payload: JSON.stringify({ toolCallId: pending.toolCallId, optionId: null }),
            correlationId: `decision:${pending.toolCallId}`,
            turnId: turn.id,
            state: 'cancelled',
          }).pipe(Effect.ignore)
          yield* write(sessionId, {
            role: 'agent',
            kind: 'permission_request',
            body: pending.body,
            payload: pending.payload,
            correlationId: `perm:${pending.toolCallId}`,
            turnId: turn.id,
            state: 'cancelled',
          }).pipe(Effect.ignore)
          yield* Deferred.succeed(pending.answer, { cancelled: true })
        }

        // The user stopped the turn, so the turn is closed as cancelled whatever the agent says
        // next: an agent that answers `end_turn` after being cancelled has still been stopped.
        turn.closed = 'cancelled'

        if (held === undefined) return
        yield* attempt('cancelling the turn', held.connection.cancel()).pipe(Effect.ignore)

        yield* Effect.forkScoped(
          Effect.gen(function* () {
            yield* Effect.sleep(CANCEL_GRACE)
            if (turns.get(sessionId) !== turn) return
            turn.closed = 'cancelled'
            yield* note(
              sessionId,
              turn,
              'The agent did not answer the stop, so its process was stopped.',
              'stop_timeout',
            ).pipe(Effect.ignore)
            yield* attempt('stopping the agent', held.process.kill).pipe(Effect.ignore)
          }),
        )
      })

    const decide = (sessionId: string, optionId: string | null) =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        const pending = turn?.permission ?? null
        if (turn === undefined || pending === null) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'deciding',
              cause: 'no permission is waiting in this Session',
            }),
          )
        }

        turn.permission = null
        // The decision is written before the agent is told, and the request folds into the one
        // line the thread keeps: what the user chose is what happened, whether or not the agent
        // goes on to use it.
        yield* write(sessionId, {
          role: 'user',
          kind: 'permission_decision',
          body: optionId === null ? 'Stopped' : chosenName(pending, optionId),
          payload: JSON.stringify({ toolCallId: pending.toolCallId, optionId }),
          correlationId: `decision:${pending.toolCallId}`,
          turnId: turn.id,
          state: optionId === null ? 'cancelled' : 'decided',
        })
        yield* write(sessionId, {
          role: 'agent',
          kind: 'permission_request',
          body: pending.body,
          payload: pending.payload,
          correlationId: `perm:${pending.toolCallId}`,
          turnId: turn.id,
          state: optionId === null ? 'cancelled' : 'decided',
        })
        const stopped: PermissionAnswer = { cancelled: true }
        yield* Deferred.succeed(pending.answer, optionId === null ? stopped : { optionId })
      })
    const resume = (sessionId: string) =>
      Effect.gen(function* () {
        const held = yield* opened(sessionId)
        // What a load streams back is written by the drain fiber like anything else, so the window
        // is not told the Session is back before its own history is in the thread.
        yield* drained(held)
        // The reason the fallback recorded, not a second guess at it: the sentence the interface
        // shows over the thread is the one the agent's refusal was read as.
        if (held.why !== null) return { state: 'fallback', reason: held.why } satisfies ResumeReport
        return { state: 'attached', reason: null } satisfies ResumeReport
      })

    const release = (sessionId: string) =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        // A turn is work in progress and a permission is a question the user is answering: an
        // agent that is doing either is not idle, whatever the clock says.
        if (turn !== undefined) return
        const held = live.get(sessionId)
        if (held === undefined) return
        live.delete(sessionId)
        // The queue ending is what ends the fiber draining it: nothing keeps reading a Session
        // nobody is talking to.
        yield* Queue.shutdown(held.queue).pipe(Effect.ignore)
        yield* attempt('stopping the agent', held.process.stop).pipe(Effect.ignore)
      })

    /**
     * The pool's own timer, for as long as the engine runs (D5-05).
     *
     * The pool says which agents have been idle long enough; something has to ask it. One fiber
     * of this layer does, on the clock the engine was given, which is what closes the probe a
     * Home's composer opened once nobody is looking at that composer any more.
     */
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (;;) {
          yield* Effect.sleep(SWEEP_EVERY)
          yield* pool.sweep
        }
      }),
    )

    /**
     * What the engine sees.
     *
     * Each method is handed this layer's scope and each says what it returns: what starts a
     * process or a fiber needs a scope, and a window asking for a turn does not have one to give.
     */
    const service: AgentRuntimeService = {
      start: (sessionId) => owned(start(sessionId)),
      options: (sessionId) => owned(options(sessionId)),
      offer: (projectId, provider) => owned(offer(projectId, provider)),
      offerSet: (projectId, provider, optionId, value) =>
        owned(offerSet(projectId, provider, optionId, value)),
      setOption: (sessionId, optionId, value) => owned(setOption(sessionId, optionId, value)),
      prompt: (sessionId, text) => owned(prompt(sessionId, text)),
      stop: (sessionId) => owned(stop(sessionId)),
      decide: (sessionId, optionId) => owned(decide(sessionId, optionId)),
      resume: (sessionId) => owned(resume(sessionId)),
      release: (sessionId) => owned(release(sessionId)),
      alive: Effect.sync(() => [...live.keys()]),
    }
    return service
  }),
)
