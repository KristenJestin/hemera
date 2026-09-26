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
  Clock,
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  type Fiber,
  FiberSet,
  Layer,
  Predicate,
  Queue,
  Result,
  Scope,
  Semaphore,
  Stream,
} from 'effect'
import { type FSWatcher, existsSync, watch } from 'node:fs'

import type { McpServer } from '@agentclientprotocol/sdk'

import {
  AGENTS_FILE,
  type AgentProvider,
  type BaseReach,
  contextUri,
  hemeraToolNamed,
  internalText,
  type Session,
  type SessionEntryOrigin,
} from '@hemera/core'
import { DEFAULT_DISPLAY_PREFERENCES, type ComposerChoice } from '@hemera/ipc'

import {
  type AgentConnection,
  type AgentEvent,
  type AgentHandshake,
  type AgentOption,
  type PermissionAnswer,
  type PermissionQuestion,
  type Provision,
  type SessionMeta,
  type ToolCallContentBlock,
  type ToolCallLocation,
  type UsageReport,
  type WindowReport,
  connect,
} from './client.ts'
import { AgentDirectories, bareModeOf, bareOptionsOf, writtenFiles } from './bare.ts'
import { Discovery, type ResolvedAgent, type UnusableAgentError } from './discovery.ts'
import { HeldWords } from './held.ts'
import { AgentNotices } from './notices.ts'
import { Pool, SWEEP_EVERY } from './pool.ts'
import { rebuiltContext } from './resume.ts'
import { ProcessSupervisor, StderrSink, type SupervisedProcess } from './supervisor.ts'
import { AcpTraces, type Heard, type RequestBook, requestBook, traceLine } from './trace.ts'
import { Commands } from '../commands/service.ts'
import { Context as AgentContext, fingerprintOf } from '../context/service.ts'
import { Preferences } from '../preferences.ts'
import { Projects } from '../projects.ts'
import { Sessions, type NativeRecord, type OptionChoice, type ThreadWrite } from '../sessions.ts'
import { type SpecDelivery, briefFor, briefed, definedBy } from '../specs/brief.ts'
import { Database } from '../storage/database.ts'
import { ToolAccess } from '../tools/access.ts'
import { ToolPermissions } from '../tools/permissions.ts'
import { ToolServer } from '../tools/server.ts'
import { Variables } from '../workspaces/variables.ts'

/** How long an agent is given to answer `session/cancel` before its process tree is stopped. */
export const CANCEL_GRACE = Duration.seconds(10)

/**
 * How long what an agent streamed waits before the thread is written (Decided 10 of #17).
 *
 * A chunk is a few words and an answer at length is a few hundred of them: writing each one where
 * it lands is a transaction, a Journal line and the whole body rewritten per chunk, for one entry
 * the reader watches grow either way. They are held in memory instead and written at most this
 * often — which is also as often as the window is told, and no more than a page needs to look
 * like it is streaming.
 */
export const CHUNK_FLUSH = Duration.millis(100)

/**
 * How long a turn waits for what the agent said to be in the thread before it goes on.
 *
 * The net under a write that never answers: the entries are written by another fiber, and a turn
 * that cannot end because one of them is stuck is worse than a turn whose last line arrives late.
 */
const DRAIN_LIMIT = Duration.seconds(5)

/**
 * How long the Workspace's instructions have to stay still before a change of them is handed over
 * (D6-08): an editor saves a file in several writes, and one change is one delivery.
 */
export const INSTRUCTIONS_SETTLE = Duration.millis(300)

/**
 * How long a request of the agent's may wait for Hemera before the thread says it is (#131).
 *
 * Hemera answers what it can draw — a permission is a block of the thread, and the rest the SDK
 * refuses at once — so a request still open after this is one the agent is waiting on and the
 * reader cannot see. A few seconds, because a permission being written is a request open for the
 * time of one write, and that one is drawn.
 */
export const UNANSWERED_AFTER = Duration.seconds(5)

/**
 * What the agent writes on its standard error while a turn runs, as the thread says it (#131).
 *
 * A line that names a failure is what an agent says when its provider refuses it — OpenCode writes
 * its 429 there and tells the protocol nothing — so it is shown as a quiet row under the turn. Not
 * every line: an agent writes its progress there too, and a row claiming an error for a line that
 * names none would be a row that lies.
 */
export const REPORTED_ERROR =
  /error|fail|fatal|exception|refus|denied|invalid|timed? ?out|rate.?limit|too many requests|\b[45]\d\d\b|ECONN|EPIPE/i

/** How far apart two of those rows are at least, so an agent retrying in a loop is one row. */
export const REPORT_GAP = Duration.seconds(10)

/** How many of those rows one turn shows at most. */
export const REPORTS_PER_TURN = 5

/** How much of a line of the agent's standard error a row keeps. */
const REPORTED_LIMIT = 500

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
  | 'failed'

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

/** Where an agent is started, what it is started with, and what kind of thing it is. */
interface AgentStartOptions {
  cwd: string
  env?: Record<string, string>
  /** A bundled adapter is a Node script and is forked as one; an agent's own command is spawned. */
  script?: boolean
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
  /** Answers the question a block was drawn for; null is the end of the question. */
  readonly decide: (
    sessionId: string,
    toolCallId: string,
    optionId: string | null,
  ) => Effect.Effect<void, AgentRuntimeError>
  /** Asks the agent to carry on the session it handed back, or rebuilds the context (D5-07). */
  readonly resume: (sessionId: string) => Effect.Effect<ResumeReport, AgentRuntimeError>
  /** Lets go of an agent nobody is talking to; the next prompt starts it again. */
  readonly release: (sessionId: string) => Effect.Effect<void>
  /**
   * Lets go of the agent at once when no turn runs, or once the running turn ends: its next turn
   * starts it again, its conversation resumed, with the tools of the Session's mission (D7-14).
   */
  readonly releaseWhenIdle: (sessionId: string) => Effect.Effect<void>
  /**
   * The agent's proposal accepted (issue #130): lets go of the agent as `releaseWhenIdle` does,
   * then starts it again at once, its conversation resumed with the tools of a `define` Session,
   * and hands it the mission brief in a turn of its own. The user has nothing to type for the
   * agent to go on. Returns at once, never waiting on a turn.
   */
  readonly briefWhenIdle: (sessionId: string) => Effect.Effect<void>
  /**
   * Hands the agent a word of Hemera's at its next safe point (issue #130): now, in a turn of its
   * own, when no turn runs — starting the agent if it is not running — once the running one ends
   * otherwise. `text` is what the agent is handed, as a resource and never as a message of the
   * user's; `said` is the line the thread shows once it went. Returns at once.
   */
  readonly tell: (sessionId: string, text: string, said: string) => Effect.Effect<void>
  /** The Sessions whose agent is running right now. */
  readonly alive: Effect.Effect<readonly string[]>
  /** Whether a turn is running in the Session, from the prompt until it closes. */
  readonly running: (sessionId: string) => boolean
  /**
   * Hands what a human change of a Spec made wait — an edit, an answer, a phase to brief again —
   * to the agent of every Session defining it, at its next safe point: now when no turn runs,
   * once the running one is over otherwise (D7-09). Returns at once, never waiting on a turn.
   */
  readonly specChanged: (specId: string) => Effect.Effect<void>
  /**
   * Queues a sub-agent's result for the Session's agent, handed over at its next safe point as
   * an `internal` delivery, never as a message of the user's (D7-14). Returns at once.
   */
  readonly deliverInternal: (sessionId: string, text: string) => Effect.Effect<void>
}

export { AgentNotices, NoNotices } from './notices.ts'
export type { AgentNoticesService, Notice } from './notices.ts'

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
  /**
   * The one MCP server this agent process was configured with: Hemera's own tools (D6-01).
   *
   * Held rather than rebuilt at each call, because the token in it is the one thing that says
   * which Session a tool call belongs to: `session/new`, `session/resume` and `session/load` all
   * hand over the same address, and the grant behind it dies with this process.
   */
  readonly mcp: readonly McpServer[]
  /**
   * What the three ways into a session carry on `_meta` for this agent: its bare options, for the
   * agent that reads them there, and nothing for the two that take them from the environment.
   */
  readonly meta: SessionMeta | undefined
  /** How the base reaches this agent, as its adapter declares (D6-07). */
  readonly base: BaseReach
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
  /**
   * What Hemera provides in front of the next prompt, as resources behind its marker: the base,
   * on an agent that takes it there (D6-07). Handed over once, then emptied.
   */
  provisions: readonly Provision[]
  /**
   * Whether the agent's own session holds no mission brief whatever was delivered before: a
   * session opened afresh or rebuilt from the thread, which leaves the brief out (D7-09).
   */
  unbriefed: boolean
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
  /**
   * What the agent said that the thread does not hold yet, by the key it is accumulated under.
   *
   * The chunks of one entry are held here rather than written one by one (Decided 10 of #17):
   * what is written when the flush comes is the whole text so far, under the same
   * `correlationId`, so the row is the row it would have been and there is still one row per
   * entry. The key is what a replay matches an entry by: the message the agent named and the kind
   * of it.
   */
  readonly chunks: Map<string, Coalesced>
  /**
   * What the timer wrote of an entry that has not settled yet, by the same key.
   *
   * The timer can write the whole of a message in the pause an agent takes before its next step,
   * and then nothing of it is held when that step settles it: kept here, the entry is written
   * once more as settled, and the Journal still has its line.
   */
  readonly open: Map<string, Coalesced>
  /**
   * The keys whose entry has already been written as settled.
   *
   * A key can come back after its entry settled — the chunks a Stop leaves behind, or the
   * `turn:<id>:<kind>` of an agent that names no message speaking again after a call — and it is
   * still the same row: the Journal says once that it settled, and the writes after that are the
   * row growing, not settling again.
   */
  readonly settledKeys: Set<string>
  /** The fiber of the flush that is due, or null when this Session holds nothing. */
  timer: Fiber.Fiber<void> | null
  /**
   * What a turn waits on for those writes to be done: completed when the last one is.
   *
   * A latch rather than a count looked at again and again: the fiber that writes is the one that
   * knows when it has caught up, and a waiter that polls is a waiter burning a core to find out.
   * It is replaced when the count goes from none to one, so each wait is about the writes that
   * were outstanding when it began.
   */
  settled: Deferred.Deferred<void>
}

/** A tool call, as the thread accumulates it: an update carries only what changed. */
interface Call {
  title: string
  kind: string | null
  status: string | null
  locations: readonly ToolCallLocation[]
  content: readonly BoundedBlock[]
  rawInput: BoundedText | null
  rawOutput: BoundedText | null
}

/**
 * How much of one text the thread keeps of a call, in characters.
 *
 * A tool answers with whatever it answers with — a file, a build log, a directory listing — and
 * a row of the thread is not the place to hold all of it: what is kept is enough to read, and
 * what was cut is said rather than hidden, so the window never shows the beginning of a file as
 * if it were the file.
 */
export const TEXT_LIMIT = 64 * 1024

/** A text of a call, as the thread keeps it: cut when it was too long, and honest that it was. */
interface BoundedText {
  readonly text: string
  /** True when what is here is only the beginning of what the agent sent. */
  readonly truncated: boolean
  /** How long the whole text was, whether or not all of it is here. */
  readonly length: number
}

const bounded = (text: string): BoundedText =>
  text.length <= TEXT_LIMIT
    ? { text, truncated: false, length: text.length }
    : { text: text.slice(0, TEXT_LIMIT), truncated: true, length: text.length }

const boundedOr = (text: string | null): BoundedText | null =>
  text === null ? null : bounded(text)

/** One content block as the thread keeps it: the same block, with its texts bounded. */
const boundedBlock = (block: ToolCallContentBlock) => {
  if (block.type === 'diff') {
    return { ...block, oldText: boundedOr(block.oldText), newText: bounded(block.newText) }
  }
  if (block.type === 'terminal') return block
  return { ...block, text: bounded(block.text) }
}

/** One content block of a call, as the thread keeps it. */
type BoundedBlock = ReturnType<typeof boundedBlock>

/** A permission the turn is blocked on. */
interface Pending {
  readonly toolCallId: string
  readonly body: string
  readonly payload: string
  readonly options: readonly { readonly id: string; readonly name: string }[]
  readonly answer: Deferred.Deferred<PermissionAnswer>
}

/**
 * One entry of the thread the agent is still writing, as the coalescer holds it.
 *
 * The whole text so far rather than the last chunk of it: what is written when the flush comes is
 * the entry as the thread should read it, under the key a replayed history is matched by.
 */
interface Coalesced {
  readonly kind: 'message' | 'thought'
  readonly body: string
  readonly turnId: string | null
  readonly origin: SessionEntryOrigin
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
  failed: 'The agent could not answer.',
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
    const preferences = yield* Preferences
    const discovery = yield* Discovery
    const supervisor = yield* ProcessSupervisor
    const notices = yield* AgentNotices
    // The engine's diagnostic: how an agent was started is what a trial per agent and platform
    // reads back, and a package started from an icon has no console to print it to (D6-02).
    const diagnostic = yield* StderrSink
    // What a Session's agent is lent: a token of its own, the address the tools are served on,
    // what it was provided with, the commands it started and the book of who is live (D6-01,
    // D6-07, D6-12, D5-05).
    const access = yield* ToolAccess
    const server = yield* ToolServer
    const context = yield* AgentContext
    const commands = yield* Commands
    const permissions = yield* ToolPermissions
    const heldWords = yield* HeldWords
    const pool = yield* Pool
    // The variables of a Session's Workspace, which its agent is started with (D8-06).
    const variables = yield* Variables
    // Where each agent's bare means is written: a directory of Hemera's, never the user's (D6-09).
    const directories = yield* AgentDirectories
    const database = yield* Database
    // What a Session's agent and Hemera said to each other, written when the reader asked (#131).
    const traces = yield* AcpTraces

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

    /**
     * Runs, from a callback of Node's, an effect this layer owns: a timer that fired, a question
     * the agent's connection asked.
     *
     * `Effect.runPromise` there would start a fiber of nobody's, which the engine quitting neither
     * waits for nor stops: a delivery the agent let go of after the quit would then write the entry
     * that closes its turn into a database already closed. These fibers are this layer's, so its
     * scope interrupts them, and waits for them, before anything underneath it is let go of.
     */
    const runOwned = yield* FiberSet.makeRuntimePromise()

    const live = new Map<string, Live>()
    const turns = new Map<string, Turn>()
    /**
     * The turns asked for whose agent is still being started.
     *
     * A cold start is a spawn, a handshake and a `session/new`, and the window shows the Stop
     * from the moment the message is written: a Stop pressed then is kept here, and the turn it
     * was pressed on is closed as cancelled instead of being sent.
     */
    const starting = new Map<string, Turn>()
    /**
     * The Sessions whose agent is to be let go of once no turn runs: its tools are minted with it,
     * and the Session's mission changed under a turn (D7-14).
     */
    const releasing = new Set<string>()
    /**
     * The Sessions whose agent is started again as soon as it is let go of, and handed what waits
     * — the brief of the Spec just created — in a turn of its own (issue #130).
     */
    const waking = new Set<string>()
    /**
     * What a load replayed so far, per Session and per message it named.
     *
     * A replay arrives outside any turn, in chunks like a live answer: the chunks of one message
     * are accumulated here so that the entry they update ends up holding the whole message
     * rather than the last few words of it.
     */
    const replayed = new Map<string, Map<string, string>>()

    /** One entry written, with nothing held in front of it. */
    const writeNow = (sessionId: string, entry: ThreadWrite) =>
      Effect.gen(function* () {
        const written = yield* attempt('writing the entry', sessions.write(sessionId, entry))
        notices.wrote(sessionId, written.entry)
        return written.entry
      })

    /**
     * Writes what the agent said and the thread does not hold yet (Decided 10 of #17).
     *
     * `settled` is the caller's word on the entry: the chunks of a message that is over — the
     * agent moved on to another message or to another kind, the turn ended, the Stop came, the
     * agent died — are written as finished, and the Journal keeps one line for the entry rather
     * than one per flush. The timer's own flush says nothing of the sort: the entry it writes is
     * one the agent may still be speaking into. Nor does a chunk a replay streamed back, whose
     * entry the Journal already has a line for.
     *
     * What is held is taken out of the map before anything is written, and in the order it was
     * accumulated in: the thread reads in the order its `seq` was handed out, and two writes of
     * one entry have to be that entry growing rather than two rows.
     */
    const flush = (sessionId: string, held: Live, settled: boolean) =>
      Effect.gen(function* () {
        // What the timer wrote and nothing has settled comes first: its row is already there, so
        // writing it again moves nothing in the thread, and a settling flush has to reach it.
        const writing = [...(settled ? new Map([...held.open, ...held.chunks]) : held.chunks)]
        held.chunks.clear()
        if (settled) held.open.clear()
        for (const [key, chunk] of writing) {
          // A replayed entry is the history being read back rather than an entry settling now:
          // its row is one the Journal has already told its reader about, and a resume says
          // nothing about it that the first turn did not say. Nor does a row that settled once.
          const settles = settled && chunk.origin === 'live' && !held.settledKeys.has(key)
          const wrote = yield* Effect.result(
            writeNow(sessionId, {
              role: 'agent',
              kind: chunk.kind,
              body: chunk.body,
              correlationId: key,
              turnId: chunk.turnId,
              origin: chunk.origin,
              settled: settles,
            }),
          )
          // A write that failed loses the text of this flush, as it did when each chunk was
          // written where it landed: it goes to the diagnostic rather than failing whatever is
          // written after it, and the next chunk of the entry carries the whole text again. Held
          // for another attempt, it could land after the entry that follows it.
          if (Result.isFailure(wrote)) {
            yield* diagnostic.write(
              `session ${sessionId}: the text of ${key} was dropped: ${wrote.failure.message}`,
            )
            continue
          }
          if (settles) held.settledKeys.add(key)
          else if (!settled && chunk.origin === 'live' && !held.settledKeys.has(key)) {
            held.open.set(key, chunk)
          }
        }
      })

    /**
     * One entry written for an agent, and the window told about it.
     *
     * Whatever the agent is holding in memory goes first: whatever the caller is writing belongs
     * after what the agent said before it — a call, a question, the end of the turn — because the
     * thread reads in the order of its `seq`.
     */
    const write = (sessionId: string, entry: ThreadWrite) =>
      Effect.gen(function* () {
        const held = live.get(sessionId)
        if (held !== undefined) yield* flush(sessionId, held, true)
        return yield* writeNow(sessionId, entry)
      })

    // A tool call and a command run are written by services of their own, into the same thread
    // and in the middle of a turn (D6-04, D6-12): they go below what the agent holds, exactly as
    // an entry written here does.
    heldWords.heldBy((sessionId) =>
      Effect.gen(function* () {
        const held = live.get(sessionId)
        if (held !== undefined) yield* flush(sessionId, held, true).pipe(Effect.ignore)
      }),
    )

    /** One line, written as a `note`: what Hemera did that the agent did not say. */
    const note = (sessionId: string, turn: Turn | undefined, body: string, reason: string) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'note',
        body,
        payload: JSON.stringify({ reason }),
        turnId: turn?.id ?? null,
      })

    /** Reads the preference, and writes the traces or stops writing them as it says (#131). */
    const traceAsAsked = Effect.gen(function* () {
      const read = yield* Effect.result(preferences.read)
      traces.writing(Result.isSuccess(read) && read.success.acpTrace)
    })

    /** One line of a Session's trace that is not a message: a death, a line of standard error. */
    const traced = (sessionId: string, said: string) => {
      if (traces.on()) traces.write(sessionId, `${new Date().toISOString()} ${said}`)
    }

    /**
     * What each turn has shown of the agent's standard error: the lines already shown, when the
     * last one was, and how many. Kept beside the turn rather than in it, and gone with it.
     */
    const reported = new WeakMap<Turn, { lines: Set<string>; at: number | null; count: number }>()

    /**
     * A line the agent wrote on its standard error, shown under the running turn when it names a
     * failure (#131): once per line, one row per `REPORT_GAP` at most, `REPORTS_PER_TURN` in all.
     * Outside a turn it goes to the diagnostic alone, as it always did.
     */
    const reportedError = (sessionId: string, line: string) =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        if (turn === undefined || turn.closed !== null) return
        if (!REPORTED_ERROR.test(line)) return
        const said = line.trim().slice(0, REPORTED_LIMIT)
        // Two lines that differ only by a time or a count are the same complaint said again.
        const known = said.replaceAll(/\d+/g, '#')
        const now = yield* Clock.currentTimeMillis
        const held = reported.get(turn) ?? { lines: new Set<string>(), at: null, count: 0 }
        reported.set(turn, held)
        if (held.lines.has(known) || held.count >= REPORTS_PER_TURN) return
        if (held.at !== null && now - held.at < Duration.toMillis(REPORT_GAP)) return
        held.lines.add(known)
        held.at = now
        held.count += 1
        yield* write(sessionId, {
          role: 'hemera',
          kind: 'note',
          body: 'The agent reported an error',
          payload: JSON.stringify({ reason: 'agent_stderr', line: said }),
          turnId: turn.id,
        })
      })

    /**
     * A request of the agent's that Hemera has not answered after `UNANSWERED_AFTER`, said in the
     * thread with its method (#131). A permission the thread is drawing is not one: its block is
     * already what says the agent is waiting.
     */
    const watchedRequest = (sessionId: string, book: RequestBook, heard: Heard) =>
      Effect.gen(function* () {
        yield* Effect.sleep(UNANSWERED_AFTER)
        if (heard.id === null || !book.waiting(heard.id)) return
        const turn = turns.get(sessionId)
        if (heard.method === 'session/request_permission' && (turn?.permission ?? null) !== null) {
          return
        }
        yield* write(sessionId, {
          role: 'hemera',
          kind: 'note',
          body: 'The agent is waiting for an answer Hemera cannot show',
          payload: JSON.stringify({ reason: 'unanswered_request', method: heard.method }),
          correlationId: `request:${heard.id}`,
          turnId: turn?.id ?? null,
        })
      })

    /**
     * A request of the agent's that Hemera refused, said once per method and agent (#131): the SDK
     * answers a method Hemera does not implement with an error, and an agent that then waits on
     * something else is an agent whose reader was never told what it asked for.
     */
    const refusedRequest = (sessionId: string, heard: Heard) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'note',
        body: 'The agent asked for something Hemera cannot answer',
        payload: JSON.stringify({
          reason: 'refused_request',
          method: heard.method,
          line: heard.error ?? '',
        }),
        turnId: turns.get(sessionId)?.id ?? null,
      })

    /**
     * What a Session's connection hears, both ways (#131): the trace when it is being written, and
     * the agent's requests watched until Hemera has answered them.
     */
    const listening = (sessionId: string) => {
      const book = requestBook()
      const refused = new Set<string>()
      return (direction: 'in' | 'out', message: Parameters<RequestBook['heard']>[1]) => {
        const heard = book.heard(direction, message)
        if (traces.on()) traces.write(sessionId, traceLine(direction, heard, message, new Date()))
        if (heard.askedBy !== 'agent') return
        if (heard.kind === 'request') {
          runOwned(watchedRequest(sessionId, book, heard).pipe(Effect.ignore)).catch(
            () => undefined,
          )
          return
        }
        if (heard.error === null || refused.has(heard.method)) return
        refused.add(heard.method)
        runOwned(refusedRequest(sessionId, heard).pipe(Effect.ignore)).catch(() => undefined)
      }
    }

    /** What a load has replayed of this Session so far, made the first time it is asked. */
    const replayedOf = (sessionId: string): Map<string, string> => {
      const held = replayed.get(sessionId)
      if (held !== undefined) return held
      const made = new Map<string, string>()
      replayed.set(sessionId, made)
      return made
    }

    /**
     * Closes every call of a turn that never finished.
     *
     * A turn that was stopped or whose agent died sends no more updates, and a call left
     * `in_progress` is a spinner the thread would turn for ever.
     */
    const closeCalls = (sessionId: string, turn: Turn) =>
      Effect.gen(function* () {
        for (const [id, call] of turn.calls) {
          if (call.status === 'completed' || call.status === 'failed') continue
          call.status = 'cancelled'
          yield* write(sessionId, {
            role: 'agent',
            kind: 'tool_call',
            body: call.title,
            payload: JSON.stringify({ call }),
            correlationId: `call:${id}`,
            turnId: turn.id,
            state: 'cancelled',
          }).pipe(Effect.ignore)
        }
      })

    /**
     * Holds one chunk of a message or of a thought, and makes sure a flush is due (Decided 10 of
     * #17).
     *
     * A chunk of another key is the agent moving on: what was held is written and settled before
     * this one takes its place, which is what keeps the thread in the agent's own order — an
     * answer is never written after the words a later message begins with.
     */
    const hold = (sessionId: string, key: string, chunk: Coalesced) =>
      Effect.gen(function* () {
        const held = live.get(sessionId)
        // An agent that is gone holds nothing: what it said while it was alive was written when it
        // died, and a chunk arriving now is written where it stands rather than waiting for a
        // timer nobody is coming back to.
        if (held === undefined) {
          yield* writeNow(sessionId, {
            role: 'agent',
            kind: chunk.kind,
            body: chunk.body,
            correlationId: key,
            turnId: chunk.turnId,
            origin: chunk.origin,
          })
          return
        }
        const other = (heldKey: string) => heldKey !== key
        if ([...held.chunks.keys(), ...held.open.keys()].some(other)) {
          yield* flush(sessionId, held, true)
        }
        held.chunks.set(key, chunk)
        yield* armFlush(sessionId, held)
      })

    /**
     * The flush that is due for what a Session holds: the timer of Decided 10 of #17.
     *
     * One fiber per Session rather than one per key, because the chunks that arrive are the chunks
     * of one entry: a message is streamed before the next one begins, and a turn with a timer per
     * message in it would be a fiber per message. It starts when something is held, writes it, and
     * ends when nothing is left — a chunk that arrives while it is writing is written by the next
     * turn of its own loop, which is what `hold` counts on when it finds a timer already running.
     */
    const armFlush = (sessionId: string, held: Live) =>
      Effect.gen(function* () {
        if (held.timer !== null) return
        held.timer = yield* Effect.forkScoped(
          Effect.gen(function* () {
            while (live.get(sessionId) === held && held.chunks.size > 0) {
              yield* Effect.sleep(CHUNK_FLUSH)
              yield* flush(sessionId, held, false)
            }
          }).pipe(
            // However the loop ends, the next chunk held has to find no timer and arm one.
            Effect.ensuring(
              Effect.sync(() => {
                held.timer = null
              }),
            ),
          ),
        )
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
          // A replayed message the agent named is accumulated like a live one: without it every
          // chunk would overwrite the entry it matches with nothing but itself.
          const heard =
            turn?.said ??
            (event.replay && event.messageId !== null ? replayedOf(sessionId) : undefined)
          const said = `${heard?.get(key) ?? ''}${event.text}`
          heard?.set(key, said)
          // Held rather than written: a chunk is a few words, and the entry it belongs to is not
          // one the thread has finished reading (Decided 10 of #17).
          yield* hold(sessionId, key, {
            kind,
            body: said,
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
        // Every text of it is bounded here, where it lands, rather than where the entry is
        // written: between two updates the turn would otherwise hold a file, a build log or a
        // listing of the size the agent sent, and the row it is read in is not that size.
        // An update carries only what changed: a title, a content or a raw answer it does not
        // repeat is one the thread already has, and writing the empty one over it would erase
        // what is on screen.
        const call: Call = {
          title: said.title === '' ? (held?.title ?? '') : said.title,
          kind: said.kind ?? held?.kind ?? null,
          status: said.status ?? held?.status ?? null,
          locations: said.locations.length === 0 ? (held?.locations ?? []) : said.locations,
          content:
            said.content.length === 0 ? (held?.content ?? []) : said.content.map(boundedBlock),
          rawInput: said.rawInput === null ? (held?.rawInput ?? null) : bounded(said.rawInput),
          rawOutput: said.rawOutput === null ? (held?.rawOutput ?? null) : bounded(said.rawOutput),
        }
        if (turn !== undefined) turn.calls.set(said.id, call)
        // A call the agent says has ended is one it no longer waits for: if it is one of Hemera's
        // still in flight — the agent timed out on it — what it was doing stops, a question to
        // the user included, rather than waiting on an answer nobody will read (D6-05).
        if (call.status === 'completed' || call.status === 'failed') {
          yield* server.gaveUp(sessionId, said.id)
        }

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
          const blocks = call.content.filter((block) => block.type === kind)
          if (blocks.length === 0) continue
          yield* write(sessionId, {
            role: 'agent',
            kind,
            body: call.title,
            payload: JSON.stringify(blocks),
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
            if (held === undefined) return
            held.pending -= 1
            // The last write of a batch opens the latch: what waits on it is a turn that must not
            // end above the words it ended with.
            if (held.pending <= 0) Deferred.doneUnsafe(held.settled, Effect.void)
          }),
        ),
      )

    /**
     * Waits for what the agent said to be in the thread.
     *
     * Called before a turn entry is written, and before a Session is reported back: the entries of
     * a Session are written by the fiber that drains them, and the entry that ends a turn is not
     * the first thing that turn says.
     *
     * What the coalescer holds is written here too, and settled: whatever the caller writes after
     * this — the entry that ends the turn, the window being told the Session is back — says the
     * agent's last words are the last of them.
     */
    const drained = (sessionId: string, held: Live) =>
      Effect.gen(function* () {
        // Read and awaited in the same step: the latch caught here is the one the writes that are
        // outstanding right now will open, and a batch that starts after this is not this wait.
        if (held.pending > 0) {
          yield* Deferred.await(held.settled).pipe(Effect.timeoutOption(DRAIN_LIMIT))
        }
        yield* flush(sessionId, held, true)
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

    /**
     * The path of the Session's Workspace, which is where its agent is run (D8-08): the Workspace
     * it chose, or `main` when it chose none.
     */
    const workspacePathOf = (session: Session): Effect.Effect<string, AgentRuntimeError> =>
      attempt('reading the Workspace', sessions.workspace(session.id)).pipe(
        Effect.map((workspace) => workspace.path),
      )

    /** Where an agent runs for this Session: where it ran before, or its Workspace's path. */
    const workingDirectory = (
      session: Session,
      native: NativeRecord,
    ): Effect.Effect<string, AgentRuntimeError> =>
      Effect.gen(function* () {
        const workspace = yield* workspacePathOf(session)
        // A directory that is gone is not a place to run an agent in, and a Session does not
        // stop being one because its folder was moved: the Workspace's path takes it in.
        if (native.cwd !== null && existsSync(native.cwd)) return native.cwd
        return workspace
      })

    /** What the supervisor is told to start, with only what the resolve named. */
    const startOptions = (
      resolved: ResolvedAgent,
      cwd: string,
      bare: Readonly<Record<string, string>> = {},
      given: Readonly<Record<string, string>> = {},
    ) => {
      // Built in statements rather than by spreading a conditional empty object, the way the
      // supervisor builds what it hands the host: an env that is not there is not a property.
      const options: AgentStartOptions = { cwd }
      // The machine's environment as the resolve named it, then the variables of the Session's
      // Workspace — the Project's overridden by the Workspace's (D8-06) — and what the bare means
      // sets on top of all of it: the agent's own configuration directory is Hemera's, whatever
      // the machine or a variable says it is, or the agent would leave its bare mode (D6-09).
      if (
        resolved.env !== undefined ||
        Object.keys(given).length > 0 ||
        Object.keys(bare).length > 0
      ) {
        options.env = { ...resolved.env, ...given, ...bare }
      }
      if (resolved.source === 'bundled') options.script = true
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

    /**
     * What each Project's composer was left on, as the data folder holds it between two starts.
     *
     * A choice made in a Home lived in `chosen` alone and died with the engine: the application
     * came back on the agent's own defaults, and the reader chose the model again every morning
     * (D5-17). This is the same thing, written down — one entry per Project, the agent last
     * asked about and the choices made on it — and it is what `chosen` is seeded from.
     */
    const composers = new Map<string, ComposerChoice>()

    /**
     * What the data folder remembers, put back into the two maps, once.
     *
     * Read when a composer is first asked about rather than when this layer is built: the engine
     * builds its services over a data folder that has not been migrated yet, and a preference
     * read before the table exists is a read that fails. A folder that cannot be read is not a
     * reason to refuse anything either — the composer then opens on what the agent announces,
     * which is what it opened on before any of this was written down.
     */
    let seeded = false
    const seeding = Semaphore.makeUnsafe(1)
    const seed = seeding.withPermits(1)(
      Effect.gen(function* () {
        if (seeded) return
        seeded = true
        const read = yield* Effect.result(preferences.read)
        const remembered = Result.isSuccess(read) ? read.success : DEFAULT_DISPLAY_PREFERENCES
        for (const [projectId, composer] of Object.entries(remembered.composers)) {
          composers.set(projectId, composer)
          const key = `${projectId}:${composer.provider}`
          if (!chosen.has(key)) chosen.set(key, new Map(Object.entries(composer.options)))
        }
      }),
    )

    /**
     * Drops what a Project that is no longer there left in the composers.
     *
     * Archiving is how a Project ends (design D4-03) and it takes no composer with it: the
     * preference is one row holding every Project's, and one that kept a closed Project would
     * grow a line per Project ever opened — a line read back at every start and written again at
     * every choice. A Project that is restored is asked about again when its Home is opened,
     * which is where a composer comes from anyway.
     *
     * Projects that cannot be read are not a reason to drop what the folder remembers: the read
     * fails, and nothing goes.
     */
    const forgetClosed = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const read = yield* Effect.result(projects.list())
        if (Result.isFailure(read)) return
        const standing = new Set(read.success.map((project) => project.id))
        for (const projectId of composers.keys()) {
          if (!standing.has(projectId)) composers.delete(projectId)
        }
      })

    /**
     * What this Project's composer is on now, written down for the next start.
     *
     * The whole record is written rather than the one entry, because the preference is one row:
     * what it holds is every Project's composer, and this is the one place it is changed — a
     * Project that is gone goes with it.
     */
    const remember = (projectId: string, provider: AgentProvider) =>
      Effect.suspend(() =>
        Effect.gen(function* () {
          composers.set(projectId, {
            provider,
            options: Object.fromEntries(chosen.get(`${projectId}:${provider}`) ?? []),
          })
          yield* forgetClosed()
          yield* preferences.write({ composers: Object.fromEntries(composers) }).pipe(Effect.ignore)
        }),
      )

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
            yield* attempt('opening a session', connection.open(cwd, []))
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
        yield* seed
        const key = `${projectId}:${provider}`
        const known = offered.get(key)
        if (known !== undefined) {
          // A composer being read is a probe in use, whatever the clock says.
          yield* pool.used(probeKey(key))
          yield* remember(projectId, provider)
          return { options: known, refusal: null }
        }

        const answered = yield* probeOf(projectId, provider)
        if (!isProbe(answered)) return answered
        const announced = answered.connection.options()
        offered.set(key, announced)
        // The agent this Project's composer is on, kept for the next start: a Home opens on the
        // agent it was left on rather than on the first of a list (D5-17).
        yield* remember(projectId, provider)
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
        yield* seed
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
        yield* remember(projectId, provider)
        yield* pool.used(probeKey(key))
        return { options: set.success, refusal: null }
      })

    /**
     * What goes with a Session's agent when it goes (D6-01, D6-12, D5-05).
     *
     * The same three things whether the process died under a turn or was let go of on purpose: the
     * token it was handed stops being one this engine knows, what it started is stopped because
     * nothing is left to read it, and the pool is told to forget an agent it can no longer sweep.
     */
    const letGo = (sessionId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        // A question a tool of Hemera's was asking has nobody left to act on its answer: it is
        // cancelled, and the block it drew in the thread closes with it (D6-05).
        yield* permissions.withdrawn(sessionId)
        unwatched(sessionId)
        yield* access.revoked(sessionId)
        yield* commands.stopped(sessionId).pipe(Effect.ignore)
        yield* pool.forgotten(sessionId)
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
          traced(sessionId, `agent exited with ${String(observation.code ?? observation.signal)}`)
          if (live.get(sessionId) === held) live.delete(sessionId)

          const turn = turns.get(sessionId)
          const reason = `the agent exited with ${observation.code === null ? `signal ${observation.signal}` : `code ${observation.code}`}`
          // A turn the runtime closed itself — the grace of a Stop, say — is not told twice: the
          // death is what the stop asked for, and the turn keeps the reason it was closed with.
          if (turn !== undefined && turn.closed === null) {
            // What the agent said before it died is in the thread before the entry that says it
            // died: the death does not jump the queue of its own words.
            yield* drained(sessionId, held)
            // A question the agent was asking when it died will never be answered, and a call it
            // was running will never finish: both are closed here, or the thread would go on
            // asking and spinning for as long as the Session lasts.
            const pending = turn.permission
            if (pending !== null) {
              turn.permission = null
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
            yield* closeCalls(sessionId, turn)
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
          // An agent that died before it held a session of its own has no handle to lose, and
          // writing its empty one would erase the handle the Session had before it was started.
          if (held.nativeSessionId !== '') {
            yield* attempt(
              'recording the agent',
              sessions.recordNative(sessionId, {
                nativeSessionId: held.nativeSessionId,
                nativeState: 'lost',
                cwd: held.cwd,
              }),
            ).pipe(Effect.ignore)
          }
          yield* letGo(sessionId)
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
    const openAgent = (sessionId: string): Effect.Effect<Live, AgentRuntimeError, Scope.Scope> =>
      Effect.gen(function* () {
        // The Session that a composer's choices start is opened on them, whether or not that
        // composer was drawn in this run of the application (D5-17).
        yield* seed
        const held = live.get(sessionId)
        if (held !== undefined && held.death === null) return held
        if (held !== undefined) live.delete(sessionId)

        const { session, native, choices } = yield* attempt(
          'reading the Session',
          sessions.one(sessionId),
        )
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
        // Whether this agent's conversation is written down is asked now, before its first word.
        yield* traceAsAsked

        // Bare, or not at all (D6-02): an agent whose means leaves a tool of its own behind opens
        // no Session, and nothing is written or started for it. The reason shown is the adapter's.
        const directory = directories.of(provider)
        const mode = bareModeOf(resolved.adapter, globalThis.process.platform)
        const bare = yield* bareOptionsOf(resolved.adapter, globalThis.process.platform, {
          ownerDirectory: directory,
          // The base as the Context composes it for this Session: it names its Workspace (D8-08).
          base: yield* attempt('composing the context', context.base(sessionId)),
          own: resolved.own,
        }).pipe(
          Effect.mapError(
            (refused) =>
              new AgentRuntimeError({
                what: 'starting the agent',
                cause: refused.message,
              }),
          ),
        )
        yield* attempt('preparing the agent', writtenFiles(directory, bare.files))
        // What Hemera gives the agent of this Workspace, as it gives a run of it (D8-06).
        const workspace = yield* attempt('reading the Workspace', sessions.workspace(sessionId))
        const given = yield* attempt(
          'reading the variables',
          variables.givenFor(session.projectId, workspace.id),
        )
        const process = yield* attempt(
          'starting the agent',
          supervisor.start(
            resolved.command,
            resolved.args,
            startOptions(resolved, cwd, bare.env, given),
          ),
        )

        // The token is minted for this process and for this Session, and it is the whole of what
        // says whose call a tool call is (D6-01). It travels as a bearer header, which the three
        // agents take, and not in the address, which is what a log or a proxy would keep. What it
        // may ask for is the set of the Session's mission (D7-14).
        const granted = yield* access.granted(
          sessionId,
          String(process.pid ?? 'unknown'),
          session.mission,
        )
        const mcp: readonly McpServer[] = [
          {
            type: 'http',
            name: 'hemera',
            url: server.forAgent(granted),
            headers: [{ name: 'Authorization', value: `Bearer ${granted.token}` }],
          },
        ]
        // How this agent was started, said once: bare by its own means, and handed Hemera's tools
        // at the loopback address under the token's digest — never the token itself (D6-01).
        yield* diagnostic.write(
          `agents: ${resolved.adapter.label} started bare for Session ${sessionId} (${mode.means}); Hemera's MCP server handed at ${server.origin} as ${granted.id}`,
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
              if (current !== undefined) {
                // The first of a batch closes the latch a turn waits on; the last one opens it.
                if (current.pending <= 0) current.settled = Deferred.makeUnsafe<void>()
                current.pending += 1
              }
              Queue.offerUnsafe(queue, event)
            },
            onPermission: (question) => runOwned(ask(sessionId, question)),
            onMessage: listening(sessionId),
          }),
        )
        // What the agent says on its standard error while a turn runs is said under the turn
        // when it names a failure, and its size is written in the trace (#131): an agent whose
        // provider refused it says so there, and nowhere the protocol carries.
        process.onStderr((line) => {
          traced(sessionId, `agent stderr ‹${String(line.length)} chars›`)
          runOwned(reportedError(sessionId, line).pipe(Effect.ignore)).catch(() => undefined)
        })

        const started: Live = {
          connection,
          process,
          queue,
          cwd,
          mcp,
          meta: bare.meta,
          base: mode.base,
          nativeSessionId: '',
          death: null,
          context: null,
          provisions: [],
          unbriefed: false,
          why: null,
          window: null,
          pending: 0,
          chunks: new Map(),
          open: new Map(),
          settledKeys: new Set(),
          timer: null,
          settled: Deferred.makeUnsafe<void>(),
        }
        live.set(sessionId, started)
        replayed.delete(sessionId)
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
        if (resumed !== null) {
          // An agent that holds no session is not one to hand the next call: it would be
          // answered as running and refuse every prompt. It is let go, and the next call
          // starts it again.
          if (live.get(sessionId) === started) live.delete(sessionId)
          yield* Queue.shutdown(queue).pipe(Effect.ignore)
          yield* attempt('stopping the agent', process.stop).pipe(Effect.ignore)
          return yield* Effect.fail(resumed)
        }

        // The Workspace's instructions are watched for as long as this agent holds the Session:
        // a change is handed over at the next safe point rather than at the next prompt (D6-08).
        const root = yield* workspacePathOf(session)
        watched(sessionId, root)

        // The agent is put back on what the Session chose, whatever started it this time: an
        // agent keeps its model, its effort and its mode for as long as its process lives, and a
        // session it resumes, loads or opens again after an idle release, a define brief, a death
        // or a restart of the application is on the agent's own defaults (issue #133).
        //
        // A Session opened for the first time has chosen nothing yet, and starts on the choices
        // its composer made before it existed: the model and the mode were picked on the Home's
        // probe, and the session the agent has just opened knows nothing of them until it is told
        // (D5-17). Those become the Session's own, so the next start puts them back too.
        const inherited = fresh && choices.length === 0
        const put: readonly OptionChoice[] = inherited
          ? [...(chosen.get(`${session.projectId}:${provider}`) ?? [])].map(
              ([optionId, value]) => ({ optionId, value }),
            )
          : choices
        for (const choice of put) {
          const set = yield* Effect.result(
            attempt('choosing an option', connection.setOption(choice.optionId, choice.value)),
          )
          // A choice the agent will not take is not a Session that cannot start: it opens on
          // what the agent is on, and the composer shows what that is.
          if (Result.isSuccess(set) && inherited) {
            yield* attempt('recording a choice', sessions.recordChoice(sessionId, choice)).pipe(
              Effect.ignore,
            )
          }
        }
        return started
      })

    /**
     * The agent of a Session kept in the pool's book, and noted as used just now (D5-05).
     *
     * A Session's agent is let go once nobody has talked to it for the pool's idle time, exactly
     * as a Home's probe is; `release` itself refuses while a turn is running. It is written into
     * the book again on every use, because a sweep that found it busy has already struck it out.
     */
    const kept = (sessionId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* pool.held(sessionId, release(sessionId))
        yield* pool.used(sessionId)
      })

    /**
     * The agent of a Session, started once however many ask at the same time.
     *
     * Opening a Session reads what its agent offers while its first message is being sent: both
     * ask for the agent before either has started it, and without the gate each would start one —
     * the second taking the first's place, and the first left running with nobody to stop it.
     */
    const opened = (sessionId: string): Effect.Effect<Live, AgentRuntimeError, Scope.Scope> =>
      gateOf(`session:${sessionId}`)
        .withPermits(1)(openAgent(sessionId))
        .pipe(Effect.tap(() => kept(sessionId)))

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
     * What a session that has just been opened is provided with (design D6-07).
     *
     * `Context.start` records the two: the base, word for word, and the fingerprint of the
     * Workspace's `AGENTS.md`. The base reaches the agent by its adapter's means: the system
     * prompt Claude Code was handed at `session/new`, or an embedded resource on the first prompt
     * of the others. The file is sent only to an agent whose bare mode keeps it from reading it,
     * as a resource of the first prompt; one that reads it itself is never sent it, because
     * sending a text the agent already has is saying it twice. Neither is a turn of its own: it
     * is a provision, not something to answer. Nor does a session just opened hold a mission
     * brief: a `define` Session's is handed over again at the next safe point (D7-09).
     */
    const provide = (sessionId: string, held: Live): Effect.Effect<AgentRuntimeError | null> =>
      Effect.gen(function* () {
        const started = yield* Effect.result(
          attempt('providing the context', context.start(sessionId)),
        )
        if (Result.isFailure(started)) return started.failure
        const { base, instructions } = started.success
        const provisions: Provision[] = []
        if (held.base === 'embedded_resource') {
          provisions.push({ uri: contextUri(''), text: base, mimeType: 'text/plain' })
        }
        if (instructions !== null && instructions.given !== null) {
          provisions.push({
            uri: contextUri(instructions.path),
            text: instructions.given,
            mimeType: 'text/markdown',
          })
        }
        held.provisions = provisions
        held.unbriefed = true
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
            attempt('opening a session', held.connection.open(held.cwd, held.mcp, held.meta)),
          )
          if (Result.isFailure(openedSession)) return openedSession.failure
          const provided = yield* provide(sessionId, held)
          if (provided !== null) return provided
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
            attempt(
              'resuming the session',
              held.connection.resume(handle, held.cwd, held.mcp, held.meta),
            ),
          )
          if (Result.isSuccess(resumed)) return yield* attached(sessionId, held, handle)
        }

        if (held.connection.handshake.continues) {
          const loaded = yield* Effect.result(
            attempt(
              'loading the session',
              held.connection.load(handle, held.cwd, held.mcp, held.meta),
            ),
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
        // Whatever the load holds is written before the thread is read: the context is rebuilt
        // from what the thread holds, and a history missing its last hundred milliseconds is a
        // history the agent is told it never said. Not settled — a load is still streaming into
        // the same entries as this is read.
        yield* flush(sessionId, held, false).pipe(Effect.ignore)
        const page = yield* Effect.result(attempt('reading the thread', sessions.read(sessionId)))
        if (Result.isFailure(page)) return page.failure

        const rebuilt = rebuiltContext(page.success.entries)
        // The Session is opened again where the Project lives: the agent is given the rebuilt
        // context rather than a session it cannot take back, and the handle of that new session
        // is what the next run of the application takes back.
        const openedSession = yield* Effect.result(
          attempt('opening a session', held.connection.open(held.cwd, held.mcp, held.meta)),
        )
        if (Result.isFailure(openedSession)) return openedSession.failure
        held.nativeSessionId = openedSession.success
        held.context = rebuilt
        held.why = reason
        // A session opened here is as new as any other, so it is provided like one: the base goes
        // in front of what was rebuilt, because it says who the agent is talking to (D6-07).
        const provided = yield* provide(sessionId, held)
        if (provided !== null) return provided
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
        // A question about one of Hemera's own tools is not the agent's to ask: Hemera gates its
        // tools itself, inside the root on its own and outside it with its own block (D6-05), and
        // an agent's "always allow" would be a rule remembered on the agent's side. It is allowed
        // once, under the agent's prefix only, and the call then meets Hemera's own gate.
        const hemera = hemeraToolNamed(question.tool)
        const once = question.options.find((option) => option.kind === 'allow_once')
        if (hemera !== null && question.tool.toLowerCase() !== hemera && once !== undefined) {
          return { optionId: once.id } satisfies PermissionAnswer
        }

        const turn = turns.get(sessionId)
        if (turn === undefined) {
          // A question outside a turn is a question with nothing to block: the protocol has an
          // outcome for a question that ended, and it is the honest answer to this one.
          return { cancelled: true } satisfies PermissionAnswer
        }

        // A turn holds one question at a time, and an agent that asks a second one before the
        // first was answered has stopped waiting on it: the one being replaced is ended rather
        // than dropped, because a question nobody ever answers is a call blocked for ever.
        const standing = turn.permission
        if (standing !== null) {
          turn.permission = null
          yield* Deferred.succeed(standing.answer, { cancelled: true })
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
        // A question waiting for the user is not an idle agent, whatever the clock says: the pool
        // is told so for exactly as long as the question stands (D5-05).
        yield* pool.busy(sessionId, true).pipe(Effect.ignore)
        return yield* Deferred.await(answer).pipe(
          Effect.ensuring(pool.busy(sessionId, false).pipe(Effect.ignore)),
        )
      })

    /**
     * The turn entry, written once per turn: what it ended with, in the thread's words.
     *
     * A turn Hemera opened to hand a change over says so (D6-08): `kind: 'delivery'`, a turn
     * with no message of the user's in it.
     */
    const closeTurn = (
      sessionId: string,
      turn: Turn,
      stopReason: TurnStopReason,
      kind: 'prompt' | 'delivery' = 'prompt',
    ) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'turn',
        body: STOP_TEXT[stopReason] ?? `The turn ended: ${stopReason}.`,
        payload: JSON.stringify(kind === 'delivery' ? { stopReason, kind } : { stopReason }),
        correlationId: `turn:${turn.id}`,
        turnId: turn.id,
        state: stopReason,
      })

    /**
     * The gate a turn of a Session holds from its prompt to its end, and a delivery waits on.
     *
     * The next safe point of D6-08 is the end of the turn running now, or now when none is: a
     * change of the Workspace's instructions is handed over under this gate, so it never goes out
     * in the middle of a turn and never races the prompt of the next one.
     */
    const turnGate = (sessionId: string) => gateOf(`turn:${sessionId}`)

    /**
     * One thing waiting for the next safe point (D6-08, D7-09): what the agent is handed, as
     * resources behind the marker; the lines the thread shows as it goes out, in the delivery's
     * own turn, or in none when it goes out inside a turn the user started; what makes it count as
     * given once the agent took it; and what the thread says when it did not.
     */
    interface Parcel {
      readonly provisions: readonly Provision[]
      readonly announce: (turnId: string | null) => Effect.Effect<void, AgentRuntimeError>
      readonly taken: Effect.Effect<void, AgentRuntimeError>
      readonly missed: (turnId: string | null) => Effect.Effect<void, AgentRuntimeError>
    }

    /**
     * A `context_delivery` line: Hemera's, never a message of anyone's (D6-08). Written as the
     * delivery goes out, and again under the same correlation when it was not taken.
     */
    const deliveryLine = (
      sessionId: string,
      correlationId: string,
      turnId: string | null,
      body: string,
      state: string | null,
      payload: Record<string, string | null>,
    ) =>
      write(sessionId, {
        role: 'hemera',
        kind: 'context_delivery',
        body,
        payload: JSON.stringify(payload),
        correlationId,
        turnId,
        state,
      }).pipe(Effect.asVoid)

    /** A change of the instructions, as the context says it waits. */
    type Instructions = NonNullable<Effect.Success<ReturnType<typeof context.pending>>>

    /**
     * A change of the Workspace's instructions (D6-08): the new text as a resource, and a line
     * naming what the agent held and what it is handed. Each change is a line of its own, whatever
     * its text: a file edited A, B, A, B is four.
     */
    const instructionsParcel = (sessionId: string, waiting: Instructions): Parcel => {
      const correlationId = `delivery:${crypto.randomUUID()}`
      const line = (
        turnId: string | null,
        body: string,
        state: string | null,
        deliveredAt: string | null,
      ) =>
        deliveryLine(sessionId, correlationId, turnId, body, state, {
          kind: 'instructions',
          path: waiting.path,
          // What the agent held and what it is handed, both named (D6-08).
          before: waiting.before,
          after: waiting.fingerprint,
          fingerprint: waiting.fingerprint,
          deliveredAt,
          reached: 'delivery_prompt',
        })
      return {
        provisions: [
          { uri: contextUri(waiting.path), text: waiting.content, mimeType: 'text/markdown' },
        ],
        announce: (turnId) =>
          line(
            turnId,
            'The instructions of the Workspace changed and were handed to the agent.',
            null,
            new Date().toISOString(),
          ),
        taken: attempt('recording the delivery', context.delivered(sessionId, waiting)).pipe(
          Effect.asVoid,
        ),
        missed: (turnId) =>
          line(
            turnId,
            'The instructions of the Workspace changed, and were not handed over: they wait for the next safe point.',
            'failed',
            null,
          ),
      }
    }

    /**
     * What a `define` Session's Spec has for its agent (D7-09): the mission brief, folded in the
     * thread as the `mission_brief` entry the MissionBrief block reads; or, between two briefs,
     * the human edits and the answers since the agent was last told, each a line of Hemera's.
     * None of it is a message of the user's. It counts as given, and `briefed_at` moves, only once
     * the agent took it (Decided 17).
     */
    const specParcel = (sessionId: string, held: Live, waiting: SpecDelivery): Parcel => {
      const correlation = crypto.randomUUID()
      const { brief, edits, answers } = waiting
      const provisions: Provision[] = []
      if (brief !== null) {
        provisions.push({ uri: contextUri('brief'), text: brief.block, mimeType: 'text/markdown' })
      }
      // `said` is the line the thread shows once the agent took it, in the user's words.
      const told: { kind: 'edit' | 'answer'; text: string; what: string; said: string }[] = []
      if (edits !== null) {
        const named = edits.sections.map((section) => section.replaceAll('_', ' ')).join(', ')
        told.push({
          kind: 'edit',
          text: edits.text,
          what: `your edits to ${named}`,
          said: `Your edits to ${named} went to the agent.`,
        })
      }
      if (answers !== null) {
        const [only] = answers.questions
        const what =
          answers.questions.length === 1
            ? `the answer to “${only ?? ''}”`
            : `the answers to ${answers.questions.length} questions`
        told.push({
          kind: 'answer',
          text: answers.text,
          what,
          said: `Hemera handed the agent ${what}.`,
        })
      }
      for (const one of told) {
        provisions.push({ uri: contextUri(one.kind), text: one.text, mimeType: 'text/markdown' })
      }
      const lines = (turnId: string | null, handed: boolean) =>
        Effect.forEach(
          told,
          (one) =>
            deliveryLine(
              sessionId,
              `delivery:${correlation}:${one.kind}`,
              turnId,
              handed ? one.said : `Not handed over, waiting for the next safe point: ${one.what}.`,
              handed ? null : 'failed',
              {
                kind: one.kind,
                fingerprint: fingerprintOf(one.text),
                deliveredAt: handed ? new Date().toISOString() : null,
                reached: 'delivery_prompt',
              },
            ),
          { discard: true },
        )
      return {
        provisions,
        announce: (turnId) =>
          Effect.gen(function* () {
            if (brief !== null) {
              yield* write(sessionId, {
                role: 'hemera',
                kind: 'mission_brief',
                body: brief.block,
                payload: JSON.stringify({ phase: brief.phase }),
                correlationId: `brief:${correlation}`,
                turnId,
              })
            }
            yield* lines(turnId, true)
          }),
        taken: attempt(
          'marking the brief',
          briefed(sessionId, waiting).pipe(Effect.provideService(Database, database)),
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              if (brief !== null) held.unbriefed = false
            }),
          ),
        ),
        // A brief that was not taken is composed again at the next safe point, from the Spec as
        // it then reads.
        missed: (turnId) => lines(turnId, false),
      }
    }

    /**
     * The results of sub-agents waiting for a Session's next safe point, oldest first (D7-14).
     *
     * Held in memory, as the sub-agent that produced one is: a result the quit catches before its
     * safe point goes with it.
     */
    const results = new Map<string, readonly string[]>()

    /** Hemera's words waiting for a Session's next safe point, oldest first (issue #130). */
    const words = new Map<string, readonly { readonly text: string; readonly said: string }[]>()

    /**
     * Hemera's own words to the agent — a proposal the user declined — each a resource and a line
     * of Hemera's, never a message of the user's. Taken off the queue once the agent took them.
     */
    const wordsParcel = (
      sessionId: string,
      waiting: readonly { readonly text: string; readonly said: string }[],
    ): Parcel => {
      const correlation = crypto.randomUUID()
      const lines = (turnId: string | null, handed: boolean) =>
        Effect.forEach(
          waiting,
          (one, index) =>
            deliveryLine(
              sessionId,
              `delivery:${correlation}:${index}`,
              turnId,
              handed ? one.said : `Not handed over, waiting for the next safe point: ${one.said}`,
              handed ? null : 'failed',
              {
                kind: 'notice',
                fingerprint: fingerprintOf(one.text),
                deliveredAt: handed ? new Date().toISOString() : null,
                reached: 'delivery_prompt',
              },
            ),
          { discard: true },
        )
      return {
        provisions: waiting.map((one) => ({
          uri: contextUri('notice'),
          text: one.text,
          mimeType: 'text/markdown',
        })),
        announce: (turnId) => lines(turnId, true),
        taken: Effect.sync(() => {
          // Said meanwhile, a later word stays for the next safe point.
          words.set(sessionId, (words.get(sessionId) ?? []).slice(waiting.length))
        }),
        missed: (turnId) => lines(turnId, false),
      }
    }

    /**
     * A sub-agent's results (D7-14): each a resource said to be internal and a line of Hemera's,
     * never a message of the user's. Taken off the queue only once the agent took them.
     */
    const internalParcel = (sessionId: string, waiting: readonly string[]): Parcel => {
      const correlation = crypto.randomUUID()
      const lines = (turnId: string | null, handed: boolean) =>
        Effect.forEach(
          waiting,
          (text, index) =>
            deliveryLine(
              sessionId,
              `delivery:${correlation}:${index}`,
              turnId,
              handed
                ? 'Hemera handed the agent the result of a sub-agent.'
                : 'Not handed over, waiting for the next safe point: the result of a sub-agent.',
              handed ? null : 'failed',
              {
                kind: 'internal',
                fingerprint: fingerprintOf(text),
                deliveredAt: handed ? new Date().toISOString() : null,
                reached: 'delivery_prompt',
              },
            ),
          { discard: true },
        )
      return {
        provisions: waiting.map((text) => ({
          uri: contextUri('internal'),
          text: internalText(text),
          mimeType: 'text/markdown',
        })),
        announce: (turnId) => lines(turnId, true),
        taken: Effect.gen(function* () {
          // Queued meanwhile, a later result stays for the next safe point.
          results.set(sessionId, (results.get(sessionId) ?? []).slice(waiting.length))
          for (const text of waiting) {
            yield* attempt('recording the delivery', context.handedInternal(sessionId, text))
          }
        }),
        missed: (turnId) => lines(turnId, false),
      }
    }

    /**
     * What waits for a Session's next safe point, in the order it is handed over.
     *
     * The Workspace's instructions are read only when asked for: a change of the file waits for
     * it to settle, which is the watcher's to know, and a safe point the Spec asked for does not
     * hand over a file an editor is still writing.
     */
    const waitingOf = (sessionId: string, held: Live, instructions: boolean) =>
      Effect.gen(function* () {
        const parcels: Parcel[] = []
        const changed = instructions
          ? yield* attempt('delivering the context', context.pending(sessionId))
          : null
        if (changed !== null) parcels.push(instructionsParcel(sessionId, changed))
        const spec = yield* attempt(
          'composing the mission brief',
          briefFor(sessionId, held.unbriefed).pipe(Effect.provideService(Database, database)),
        )
        const said = words.get(sessionId) ?? []
        if (said.length > 0) parcels.push(wordsParcel(sessionId, said))
        if (spec !== null) parcels.push(specParcel(sessionId, held, spec))
        const queued = results.get(sessionId) ?? []
        if (queued.length > 0) parcels.push(internalParcel(sessionId, queued))
        return parcels
      })

    /**
     * Sends what waits, as one delivery (D6-08).
     *
     * A prompt of its own, made of the marker and the texts as resources and of nothing the user
     * said: the agent is handed a change, not a message. The thread gets each parcel's lines —
     * never a message of anyone — in the turn it went out in, and the window is told. What the
     * agent answered the prompt with is handed back. What a session just opened is provided goes
     * in front of the first thing it is handed (D6-07).
     *
     * It counts as given only once the agent took it: a prompt that failed or was stopped leaves
     * it pending, so the next safe point hands it over again, and the thread says it was not.
     */
    const sendDelivery = (
      sessionId: string,
      held: Live,
      parcels: readonly Parcel[],
      turnId: string | null,
    ) =>
      Effect.gen(function* () {
        for (const parcel of parcels) yield* parcel.announce(turnId)
        notices.changed(sessionId, 'context_delivered')
        const provided = held.provisions
        held.provisions = []
        const sent = yield* Effect.result(
          held.connection.prompt('', [
            ...provided,
            ...parcels.flatMap((parcel) => parcel.provisions),
          ]),
        )
        const taken = Result.isSuccess(sent) && sent.success.stopReason !== 'cancelled'
        if (taken) {
          for (const parcel of parcels) yield* parcel.taken.pipe(Effect.ignore)
        } else {
          held.provisions = provided
          for (const parcel of parcels) yield* parcel.missed(turnId).pipe(Effect.ignore)
        }
        return sent
      })

    /**
     * Hands over what waits, if anything does, right before the prompt of a turn the user
     * started: it goes out inside that turn, and whatever the agent answers it lands there.
     */
    const handOver = (sessionId: string, held: Live) =>
      Effect.gen(function* () {
        const parcels = yield* waitingOf(sessionId, held, true)
        if (parcels.length === 0) return
        const sent = yield* sendDelivery(sessionId, held, parcels, null)
        if (Result.isFailure(sent)) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'delivering the context',
              cause: describe(sent.failure),
            }),
          )
        }
      })

    /**
     * Hands over what waits at the next safe point: when the turn running now ends, or now.
     *
     * Nothing is sent to an agent that is not running any more — the next one is handed it when
     * it starts — nor while a prompt is being started, which hands it over itself.
     *
     * Sent while no turn runs, the delivery is a prompt the agent may answer, so it is a turn of
     * its own (D6-08): opened as the user's turns are — announced, registered, so a Stop reaches
     * it — with no message of anyone's, and closed by a `turn` entry of kind `delivery`. What the
     * agent says in answer lands inside it, and the activity row shows it.
     */
    const deliverWhenSafe = (sessionId: string, instructions: boolean) =>
      turnGate(sessionId).withPermits(1)(
        Effect.gen(function* () {
          const held = live.get(sessionId)
          if (held === undefined || held.death !== null) return
          if (turns.has(sessionId) || starting.has(sessionId)) return
          const parcels = yield* waitingOf(sessionId, held, instructions).pipe(
            Effect.orElseSucceed(() => []),
          )
          if (parcels.length === 0) return

          const turn: Turn = {
            id: `${sessionId}:${Date.now()}`,
            said: new Map(),
            calls: new Map(),
            permission: null,
            closed: null,
          }
          turns.set(sessionId, turn)
          notices.changed(sessionId, 'turn_started')
          yield* pool.busy(sessionId, true).pipe(Effect.ignore)
          yield* Effect.gen(function* () {
            const sent = yield* sendDelivery(sessionId, held, parcels, turn.id)
            yield* drained(sessionId, held)
            // The same endings as a turn the user started: its stop reason, a Stop, a death, or
            // an error the agent answered with, which is a turn that failed.
            const stopReason: TurnStopReason =
              turn.closed ??
              (Result.isSuccess(sent)
                ? sent.success.stopReason
                : held.death === null
                  ? 'failed'
                  : 'interrupted')
            if (Result.isFailure(sent) && stopReason === 'failed') {
              yield* note(sessionId, turn, sent.failure.cause, 'delivery_failed')
            }
            yield* closeTurn(sessionId, turn, stopReason, 'delivery')
            // Its end is a safe point like the end of a turn the user started: what was made
            // while it ran — an edit, a phase the agent finished in answer to it — goes once it is
            // over. A delivery that was stopped or not taken is left for the next prompt.
            if (turn.closed === null && Result.isSuccess(sent) && stopReason !== 'cancelled') {
              deliverSoon(sessionId, false)
            }
          }).pipe(
            Effect.ignore,
            Effect.ensuring(
              Effect.gen(function* () {
                turns.delete(sessionId)
                yield* pool.busy(sessionId, false).pipe(Effect.ignore)
                yield* releasedIfDue(sessionId)
                notices.changed(sessionId, 'turn_ended')
              }),
            ),
          )
        }),
      )

    /**
     * Asks for a delivery at the next safe point without waiting for it: from a callback of
     * Node's, or from a turn that is ending and holds the gate the delivery waits on. A delivery
     * the quit interrupted is one the next start hands over, reading what waits again: the
     * promise that says so has nobody to tell. One that died says why.
     */
    const deliverSoon = (sessionId: string, instructions: boolean) => {
      runOwned(
        owned(deliverWhenSafe(sessionId, instructions)).pipe(
          Effect.tapDefect((defect) =>
            diagnostic.write(`agents: a delivery for Session ${sessionId} died: ${String(defect)}`),
          ),
        ),
      ).catch(() => undefined)
    }

    /**
     * Starts the Session's agent if it is not running, then hands over what waits in a turn of
     * its own (issue #130): the user decided something the agent asked about, and the agent goes
     * on from that decision without a message. A prompt the user sends meanwhile hands it over
     * itself, before its own text. A start that failed says why in the diagnostic log; the next
     * prompt hands it over all the same.
     */
    const wakeSoon = (sessionId: string) => {
      runOwned(
        owned(
          Effect.gen(function* () {
            yield* opened(sessionId)
            yield* deliverWhenSafe(sessionId, false)
          }),
        ).pipe(
          Effect.tapError((error) =>
            diagnostic.write(
              `agents: the agent of Session ${sessionId} could not be started to go on: ${error.cause}`,
            ),
          ),
          Effect.tapDefect((defect) =>
            diagnostic.write(`agents: a delivery for Session ${sessionId} died: ${String(defect)}`),
          ),
        ),
      ).catch(() => undefined)
    }

    const specChanged = (specId: string) =>
      definedBy(specId).pipe(
        Effect.provideService(Database, database),
        Effect.map((defining) => {
          // A Session whose agent is not running is handed it when its next prompt starts one.
          for (const sessionId of defining) if (live.has(sessionId)) deliverSoon(sessionId, false)
        }),
        // Unread, it waits for that next prompt all the same.
        Effect.ignore,
      )

    /** What watches the Workspace's instructions of each Session whose agent is running. */
    const watchers = new Map<
      string,
      { readonly watcher: FSWatcher; settle: NodeJS.Timeout | null }
    >()

    /** Stops watching a Session's instructions: its agent went. */
    const unwatched = (sessionId: string) => {
      const held = watchers.get(sessionId)
      if (held === undefined) return
      watchers.delete(sessionId)
      if (held.settle !== null) clearTimeout(held.settle)
      held.watcher.close()
    }

    /**
     * Watches the `AGENTS.md` at the Workspace root for as long as the Session's agent runs.
     *
     * The folder is watched rather than the file: an editor saves by writing a new file and
     * renaming it over the old one, and a watch on the file itself follows the one that is gone.
     * A change waits for the file to settle, then waits for the safe point; a folder that cannot
     * be watched leaves the delivery to the next prompt, which reads the file anyway.
     */
    const watched = (sessionId: string, root: string) => {
      unwatched(sessionId)
      try {
        const watcher = watch(root, { persistent: false }, (_event, name) => {
          const said = name === null ? '' : String(name)
          if (said.toLowerCase() !== AGENTS_FILE.toLowerCase()) return
          const held = watchers.get(sessionId)
          if (held === undefined) return
          if (held.settle !== null) clearTimeout(held.settle)
          held.settle = setTimeout(() => {
            held.settle = null
            deliverSoon(sessionId, true)
          }, Duration.toMillis(INSTRUCTIONS_SETTLE))
        })
        watcher.on('error', () => unwatched(sessionId))
        watchers.set(sessionId, { watcher, settle: null })
      } catch {
        // Nothing to watch: the next prompt reads the file and hands a change over itself.
      }
    }

    // Nothing is watched once the engine is gone.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const sessionId of [...watchers.keys()]) unwatched(sessionId)
      }),
    )

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
        // Written down once the agent took it: the next start of this Session's agent is put back
        // on it, which no agent does by itself (issue #133).
        yield* attempt(
          'recording a choice',
          sessions.recordChoice(sessionId, { optionId, value }),
        ).pipe(Effect.ignore)
      })

    const prompt = (sessionId: string, text: string) =>
      Effect.gen(function* () {
        // The trace follows the preference from the next message on, not from the next start of
        // an agent the pool may keep for minutes (#131). Read before the turn is held, so nothing
        // waits between the check below and the turn it registers.
        yield* traceAsAsked
        if (turns.has(sessionId) || starting.has(sessionId)) {
          return yield* Effect.fail(
            new AgentRuntimeError({
              what: 'prompting',
              cause: 'a turn is already running in this Session',
            }),
          )
        }

        // Held from here, before anything is awaited: a second prompt is refused rather than
        // raced, and a Stop pressed while the agent is still being started has a turn to close.
        const turn: Turn = {
          id: `${sessionId}:${Date.now()}`,
          said: new Map(),
          calls: new Map(),
          permission: null,
          closed: null,
        }
        starting.set(sessionId, turn)

        return yield* announcedTurn(sessionId, text, turn).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (starting.get(sessionId) === turn) starting.delete(sessionId)
            }),
          ),
        )
      })

    /** The turn itself, once it is the one this Session is running. */
    const announcedTurn = (sessionId: string, text: string, turn: Turn) =>
      Effect.gen(function* () {
        // The user's own message is written first, and by `append`: the thread shows what was
        // asked before what was answered, and it is what proposes the Session's title. It is
        // handed to the window like every other entry, because the page draws the thread from
        // what arrives: a message written and never announced is one only a second read shows.
        //
        // It is written before the agent is started rather than after: a cold start is a process
        // to spawn, a handshake and a `session/new`, and a window that waited for all three would
        // show an empty Session for as long as they take. A start that then fails leaves the
        // message where it was written, and the refusal is what follows it.
        const asked = yield* attempt('writing the message', sessions.append(sessionId, text))
        notices.wrote(sessionId, asked.entry)

        // The turn has begun, and the window is told so before the agent has said anything: the
        // first chunk of an answer is seconds away at best, and a page with nothing between the
        // message and it has no way to show that something is happening. Its end is announced
        // however the turn ends — a stop reason, a Stop, a death, a start that failed — which is
        // why it is announced by what runs the turn rather than after it.
        notices.changed(sessionId, 'turn_started')

        return yield* Effect.gen(function* () {
          const held = yield* opened(sessionId)
          // Stopped while the agent was being started: nothing is sent, and the turn ends the way
          // a Stop ends one.
          if (turn.closed !== null) {
            yield* closeTurn(sessionId, turn, turn.closed)
            return { stopReason: turn.closed, usage: null } satisfies TurnReport
          }
          // Everything from here to the end of the turn runs under the one `ensuring` below: a
          // delivery that failed must not leave a turn registered that never ran — every later
          // prompt would be refused as "already running". And all of it holds the Session's turn
          // gate, which is what a delivery waits on: the end of this turn is the next safe point.
          const report = yield* turnGate(sessionId).withPermits(1)(
            Effect.suspend(() => {
              // Still `starting` while it waits on the gate — a delivery can be holding it — so a
              // Stop pressed meanwhile marks this turn, and it closes as soon as it gets the gate.
              turns.set(sessionId, turn)
              starting.delete(sessionId)
              return turnBodyOf(sessionId, text, turn, held)
            }),
          )

          return report
        }).pipe(Effect.ensuring(Effect.sync(() => notices.changed(sessionId, 'turn_ended'))))
      })

    /**
     * The body of a turn, from the safe point before its prompt to the entry that closes it.
     *
     * Run under the Session's turn gate by `announcedTurn`, once the turn is registered.
     */
    const turnBodyOf = (sessionId: string, text: string, turn: Turn, held: Live) =>
      Effect.gen(function* () {
        yield* pool.used(sessionId)
        yield* pool.busy(sessionId, true).pipe(Effect.ignore)

        /** A Stop that came before the prompt went out: the turn ends there, and says so. */
        const stoppedBefore = (closed: TurnStopReason) =>
          Effect.gen(function* () {
            yield* drained(sessionId, held)
            yield* closeTurn(sessionId, turn, closed)
            return { stopReason: closed, usage: null } satisfies TurnReport
          })
        if (turn.closed !== null) return yield* stoppedBefore(turn.closed)

        // Right before the prompt is a safe point of D6-08: the previous turn is over and
        // this one has not started. What the watcher or the Spec has not handed over yet — it
        // was made while the agent was not running — goes now, the mission brief of a `define`
        // Session's first turn with it (D7-09), and never as a message of the user's.
        yield* handOver(sessionId, held)
        // One Stop covers the whole turn: pressed while the delivery was out, it cancelled the
        // delivery, and the user's prompt is not sent after it.
        if (turn.closed !== null) return yield* stoppedBefore(turn.closed)

        // What the agent is provided goes in front of what the user asked: the base, as a
        // resource, on the first prompt of an agent with no system prompt to take it (D6-07),
        // unless a delivery took it first, and the conversation rebuilt for an agent that lost
        // its own (D5-07).
        const sent = [held.context, text].filter((one) => one !== null).join('\n\n')
        const provisions = held.provisions
        held.context = null
        held.provisions = []

        const outcome = yield* Effect.result(held.connection.prompt(sent, provisions))
        if (Result.isSuccess(outcome)) {
          const answered = outcome.success
          // What is in the thread is read before the window is: the announcement travels as a
          // notification of its own, and the entry is written from it once everything the agent
          // said is held rather than racing it.
          yield* drained(sessionId, held)
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
          // The end of this turn is the next safe point: what it made wait — the brief of a
          // phase its agent finished, a human edit made while it ran — goes once it is over. A
          // turn the user stopped is left stopped.
          if (turn.closed === null) deliverSoon(sessionId, false)
          return {
            stopReason: turn.closed ?? answered.stopReason,
            usage: answered.usage,
          } satisfies TurnReport
        }

        // The agent did not answer with a stop reason: the user's Stop ended an agent that would
        // not stop, the process died under the turn, or the agent answered with an error — its
        // provider refused the request. The last is a turn that failed, never one that was
        // stopped, and the agent's own sentence is written beside it. The thread keeps
        // everything it received either way.
        const stopReason = turn.closed ?? (held.death === null ? 'failed' : 'interrupted')
        yield* drained(sessionId, held)
        if (stopReason === 'failed') {
          yield* note(sessionId, turn, outcome.failure.cause, 'prompt_failed')
        }
        yield* closeTurn(sessionId, turn, stopReason)
        return { stopReason, usage: null } satisfies TurnReport
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            turns.delete(sessionId)
            yield* pool.busy(sessionId, false).pipe(Effect.ignore)
            yield* releasedIfDue(sessionId)
            // The idle time is counted from the end of the turn, not from its start: a sweep
            // that ran during a long turn found it busy and struck it out of the book.
            if (live.has(sessionId)) yield* kept(sessionId)
          }),
        ),
      )

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
        // A question one of Hemera's own tools is waiting on holds the turn just as still as the
        // agent's own, and the Stop ends it the way it ends that one: cancelled, so the call it
        // blocks answers rather than waiting for ever, and nothing acts (D6-05). Every one of
        // them: an agent that ran two calls at once is waiting on two.
        yield* permissions.withdrawn(sessionId)

        // A turn whose agent is still being started, or that waits on the gate behind a
        // delivery, has sent nothing to cancel: it is marked, and the prompt closes it as
        // cancelled instead of sending it.
        const early = starting.get(sessionId)
        if (early !== undefined) early.closed = 'cancelled'

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

        // A call that was still running when the turn was stopped never finished, and the
        // protocol has no word for it: an agent that is cancelled stops sending updates.
        yield* closeCalls(sessionId, turn)

        if (held === undefined) return
        // What the agent said before the Stop is in the thread before the cancel goes out: the
        // turn is over, and the entry it was still writing settles with it.
        yield* flush(sessionId, held, true).pipe(Effect.ignore)
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

    const decide = (sessionId: string, toolCallId: string, optionId: string | null) =>
      Effect.gen(function* () {
        const turn = turns.get(sessionId)
        const pending = turn?.permission ?? null
        if (turn === undefined || pending === null || pending.toolCallId !== toolCallId) {
          // Two kinds of question reach the same block of the same thread: the agent's own
          // permission, and the ones Hemera's tools ask before acting outside the Workspace
          // (D6-05). The block names the question it was drawn for, and that one is answered:
          // its options are the two the catalogue wrote, and anything but `allowed` is a refusal.
          const answered = yield* permissions.answer(
            sessionId,
            toolCallId,
            optionId === 'allowed' ? 'allowed' : 'refused',
          )
          if (answered) return
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
        yield* drained(sessionId, held)
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
        if (turn !== undefined || starting.has(sessionId)) return
        const held = live.get(sessionId)
        if (held === undefined) return
        // The last words of a turn are written before the connection is let go: the queue ending
        // is what ends the fiber that would have written them.
        yield* flush(sessionId, held, true).pipe(Effect.ignore)
        live.delete(sessionId)
        replayed.delete(sessionId)
        // The queue ending is what ends the fiber draining it: nothing keeps reading a Session
        // nobody is talking to.
        yield* Queue.shutdown(held.queue).pipe(Effect.ignore)
        yield* attempt('stopping the agent', held.process.stop).pipe(Effect.ignore)
        yield* letGo(sessionId)
      })

    /**
     * Lets go of an agent marked to be, once no turn runs: called as a turn ends. A turn the user
     * started meanwhile holds the agent it opened, so the mark waits for that one's end.
     */
    const releasedIfDue = (sessionId: string) =>
      Effect.gen(function* () {
        if (!releasing.has(sessionId)) return
        if (turns.has(sessionId) || starting.has(sessionId)) return
        releasing.delete(sessionId)
        yield* release(sessionId)
        if (waking.delete(sessionId)) wakeSoon(sessionId)
      })

    const releaseWhenIdle = (sessionId: string) =>
      Effect.gen(function* () {
        releasing.add(sessionId)
        yield* releasedIfDue(sessionId)
      })

    const briefWhenIdle = (sessionId: string) =>
      Effect.gen(function* () {
        waking.add(sessionId)
        yield* releaseWhenIdle(sessionId)
      })

    const tell = (sessionId: string, text: string, said: string) =>
      Effect.sync(() => {
        words.set(sessionId, [...(words.get(sessionId) ?? []), { text, said }])
        // A turn running now hands it over once it ends; otherwise it goes now.
        if (!turns.has(sessionId) && !starting.has(sessionId)) wakeSoon(sessionId)
      })

    /**
     * The pool's own timer, for as long as the engine runs (D5-05).
     *
     * The pool says which agents have been idle long enough; something has to ask it. One fiber
     * of this layer does, on the clock the engine was given, which is what closes a Session's
     * agent nobody has talked to for five minutes, and the probe a Home's composer opened once
     * nobody is looking at that composer any more.
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
      decide: (sessionId, toolCallId, optionId) => owned(decide(sessionId, toolCallId, optionId)),
      resume: (sessionId) => owned(resume(sessionId)),
      release: (sessionId) => owned(release(sessionId)),
      releaseWhenIdle: (sessionId) => owned(releaseWhenIdle(sessionId)),
      briefWhenIdle: (sessionId) => owned(briefWhenIdle(sessionId)),
      tell,
      alive: Effect.sync(() => [...live.keys()]),
      running: (sessionId) => turns.has(sessionId) || starting.has(sessionId),
      specChanged,
      deliverInternal: (sessionId, text) =>
        Effect.sync(() => {
          results.set(sessionId, [...(results.get(sessionId) ?? []), text])
          // An agent that is not running is handed it when its next prompt starts one.
          if (live.has(sessionId)) deliverSoon(sessionId, false)
        }),
    }
    return service
  }),
)
