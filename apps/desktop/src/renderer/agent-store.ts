import type {
  AgentAvailability,
  AgentOffer,
  AgentProvider,
  AgentUpdate,
  ConfigOption,
  EngineEvent,
  ResumeState,
  SessionEntry,
  StopReason,
} from '@hemera/ipc'
import type { ActivityState } from '@hemera/ui'

import { modelDefaultsAfter, NO_DEFAULTS, type ModelDefaults } from './agent-options.ts'
import { commandRunOf } from './agent-tool-payloads.ts'

/**
 * What the agents of this window are doing (design D5-12, D5-13, D5-17).
 *
 * The engine pushes what happens while a turn is running — an entry was written, a turn ended,
 * a permission is being asked for, the agent itself changed — and this is where the page hears
 * it. Nothing here is read back from the database: the thread a page draws is what it read when
 * the Session was opened plus what has arrived since, and an entry the agent is still writing
 * comes again with more of it rather than as a second entry (D5-11).
 *
 * Everything is kept per Session, because a turn is not a fact about the window: two Sessions
 * can be working at once, one of them behind the page the user is looking at, and a Stop that
 * disappeared with the Session on screen would be a button that lied about what is running.
 *
 * Nothing is decided here either. An entry is stored exactly as the engine pushed it, a stop
 * reason is the engine's own word, and a refusal is what a use case answered with — the page
 * reads the payload of an entry to know which block draws it, and never invents one.
 */
export interface AgentSessionState {
  /** What the engine pushed for this Session, in the order it arrived, oldest first. */
  entries: readonly SessionEntry[]
  /** Whether a turn is running in it. */
  running: boolean
  /** Why its last turn ended, as the engine answered it, or null while none has. */
  stopReason: StopReason | null
  /**
   * The entry the engine pushed last, which is not always the last one of the thread.
   *
   * An entry being written is written again in the place it first took, and an agent that names
   * none of its messages has every word of a turn folded into the first one: the answer it writes
   * after a tool call lands above that call. What the turn is doing is what it wrote last, and
   * only the order of the pushes says which that is.
   */
  latest: string | null
}

/** What a Session nothing has happened in yet holds. */
const QUIET: AgentSessionState = { entries: [], running: false, stopReason: null, latest: null }

/**
 * The Sessions whose turn the engine said had begun and has not yet said had ended.
 *
 * Kept apart from `running`, which `say` also sets before the engine has said anything: the
 * answer to a prompt can fail while the turn goes on — the main process stops waiting for an
 * answer after a few seconds, and a turn lasts minutes — and a failure then is not the end of
 * the turn. Only the engine's own `turn` is.
 */
const announced = new Set<string>()

/**
 * What one agent offers one Project before a Session holds it (design D5-17, D5-21).
 *
 * The three cross together because the composer draws all three: the options the agent
 * announced, the sentence the engine refused with — this machine does not have the agent,
 * nobody signed it in, it would not speak — and whether the question is still in flight, which
 * is what the menu says while the agent is being started.
 */
export interface AgentOffering {
  options: readonly ConfigOption[]
  refusal: string | null
  loading: boolean
  /** What this composer learned of its models' own default efforts, from the answers. */
  modelDefaults: ModelDefaults
}

/** What an agent nobody has asked yet offers: nothing, for no reason, and not being asked. */
const UNASKED: AgentOffering = {
  options: [],
  refusal: null,
  loading: false,
  modelDefaults: NO_DEFAULTS,
}

export interface AgentState {
  /** What has been pushed, per Session, since it was last read. */
  sessions: ReadonlyMap<string, AgentSessionState>
  /** What each agent offers, per Session, as its own handshake answered. */
  options: ReadonlyMap<string, readonly ConfigOption[]>
  /** What each Session learned of its models' own default efforts (`ModelDefaults`). */
  modelDefaults: ReadonlyMap<string, ModelDefaults>
  /**
   * What each agent offers a Project no Session holds yet, keyed `projectId:provider` (D5-17).
   *
   * The Home's composer picks an agent before there is a Session to ask, and the question — what
   * does this agent offer this folder — has the same answer either way: it is asked once per
   * agent and Project, and the Session made from that choice offers its own.
   */
  offerings: ReadonlyMap<string, AgentOffering>
  /** What this machine has, as `agents.list` and `agents.check` answered. */
  agents: readonly AgentAvailability[]
  /** Whether that list is the one a registry answered, which is the settings' own question. */
  checked: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: AgentState = {
  sessions: new Map(),
  options: new Map(),
  modelDefaults: new Map(),
  offerings: new Map(),
  agents: [],
  checked: false,
  refusal: null,
}

const listeners = new Set<() => void>()

let state: AgentState = EMPTY
/** Whether the engine is being listened to, so two pages never subscribe twice. */
let listening = false

export function subscribeToAgent(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function agentSnapshot(): AgentState {
  return state
}

function replace(next: AgentState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What one Session holds, which is its own quiet until something happened in it. */
export function agentOf(sessionId: string | null): AgentSessionState {
  if (sessionId === null) return QUIET
  return state.sessions.get(sessionId) ?? QUIET
}

/**
 * What a running turn is doing, as the row at the end of the thread says it (design D17-04).
 *
 * Read off the thread rather than pushed: the engine says what happened, and what is happening
 * is the last thing it said. An entry is written again with more of it while the agent writes,
 * so the end of the thread is where the turn is — and a rule read here is a rule that holds for
 * a Session reopened mid-turn as well as for one watched from the first word.
 */
export interface Activity {
  state: ActivityState
  /** What is being run, when a tool call is: its title, as the agent wrote it. */
  detail?: string | undefined
  /** The thought arriving now, which is the last one of the turn that is running. */
  thought?: string | undefined
  /** How long the last turn took, from the user's message to its `turn` entry, once it is over. */
  elapsedMs?: number | undefined
}

/** How far a call got, in the two words that mean it has not finished (ipc, `ToolCallStatus`). */
const UNFINISHED = ['pending', 'in_progress']

/** The three states a turn is in once it is over, which the row keeps until the next message. */
const ENDED: readonly ActivityState[] = ['done', 'stopped', 'failed']

/** Whether an activity is the end of a turn rather than something a turn is doing. */
export function hasEnded(activity: Activity): boolean {
  return ENDED.includes(activity.state)
}

/**
 * How a turn ended, from the stop reason its `turn` entry carries.
 *
 * `cancelled` is the user's Stop, `interrupted` is the agent gone from under the turn, and
 * `failed` is an agent that answered with an error — the two endings Hemera wrote rather than the
 * agent. Every other reason is an agent that answered and
 * stopped where it chose to, which is a turn that is done.
 */
function endOf(stopReason: string | null): ActivityState {
  if (stopReason === 'cancelled') return 'stopped'
  if (stopReason === 'interrupted' || stopReason === 'failed') return 'failed'
  return 'done'
}

/**
 * Where the last turn began: the last message the user wrote, or a change of the instructions
 * Hemera handed over while no turn ran, which is a turn of its own (D6-08) — or -1 in a thread
 * where neither happened. A delivery made inside a turn the user started belongs to that turn,
 * and carries no turn of its own.
 */
function lastSaid(entries: readonly SessionEntry[]): number {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry?.role === 'user' && entry.kind === 'message') return at
    if (entry?.kind === 'context_delivery' && entry.turnId !== null) return at
  }
  return -1
}

/** Where the last `turn` entry is, or -1 in a thread no turn has ended in. */
function lastEnd(entries: readonly SessionEntry[]): number {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    if (entries[at]?.kind === 'turn') return at
  }
  return -1
}

/**
 * What the last turn of this thread is doing, or how it ended (trial of 22 September 2026).
 *
 * Read over what came after the user's last message and no further back. A turn whose agent
 * died under it leaves its calls `in_progress` and its question undecided — nothing closed them,
 * because nothing was left to — and a rule read over the whole thread would answer with that dead
 * turn's call, or with its question, for every turn after it and for as long as the Session
 * lasts.
 *
 * A `turn` entry after that message is the turn over: done, stopped or failed, and how long it
 * took from the message to that entry. Otherwise the states answer in this order: a permission
 * first, because a turn waiting on the reader is not working whatever else the thread holds;
 * then the call it is running, because that is the one thing worth naming; then the answer being
 * written, when the entry the engine wrote last is one; and thinking for everything else, which
 * is what an agent between two blocks is doing.
 *
 * `latest` is the entry the engine pushed last. Absent — a Session opened on a thread read back
 * rather than watched — the last entry of the thread stands in for it.
 */
export function activityOf(
  entries: readonly SessionEntry[],
  latest: string | null = null,
): Activity {
  const said = lastSaid(entries)
  const end = lastEnd(entries)

  if (end > said) {
    const closing = entries[end]
    const ending = endOf(closing?.state ?? null)
    const asked = entries[said]
    if (ending !== 'done' || closing === undefined || asked === undefined) return { state: ending }
    return { state: ending, elapsedMs: closing.createdAt - asked.createdAt }
  }

  const running = entries.slice(Math.max(said, end) + 1)
  const newest =
    (latest === null ? undefined : running.find((entry) => entry.id === latest)) ?? running.at(-1)
  const thought = thoughtOf(running, newest?.turnId ?? null)

  if (waiting(running)) return { state: 'waiting', thought }

  // A command Hemera is running for the turn — a check, a utility — is what the turn waits on,
  // and its name says more than the tool call that asked for it (D6-12). An app is left running
  // on purpose and is not what the turn is doing once it has started.
  const command = [...running].reverse().find((entry) => entry.kind === 'command_run')
  const run = command === undefined ? null : commandRunOf(command)
  if (run !== null && run.state === 'running' && run.kind !== 'app') {
    return { state: 'running', detail: `Running ${run.name}`, thought }
  }

  const call = [...running].reverse().find((entry) => entry.kind === 'tool_call')
  if (call !== undefined && UNFINISHED.includes(call.state ?? '')) {
    return { state: 'running', detail: call.body, thought }
  }

  // A message has no state while it is being written — the engine writes the same entry again
  // with more in it, and never gives a message one (`state` is null on every message) — so the
  // entry the engine wrote last being a message of the agent is the answer being written.
  if (newest !== undefined && newest.kind === 'message' && newest.role === 'agent') {
    return { state: 'streaming', thought }
  }

  return { state: 'thinking', thought }
}

/** Whether the agent is waiting on an answer: a request with no decision written after it. */
function waiting(entries: readonly SessionEntry[]): boolean {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry === undefined) continue
    if (entry.kind === 'permission_decision') return false
    if (entry.kind === 'permission_request') return true
  }
  return false
}

/** The last thought of the turn that is running, which is the one the row opens onto. */
function thoughtOf(entries: readonly SessionEntry[], turnId: string | null): string | undefined {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry === undefined || entry.kind !== 'thought') continue
    // The thoughts of the turn before this one are blocks of the thread and stay there: a row
    // that opened onto one of them would be showing the last turn's reasoning as this one's.
    return entry.turnId === turnId ? entry.body : undefined
  }
  return undefined
}

/** What the agent of a Session offers, which is nothing until its handshake has answered. */
export function optionsOf(sessionId: string | null): readonly ConfigOption[] {
  if (sessionId === null) return []
  return state.options.get(sessionId) ?? []
}

/** What a Session learned of its models' own default efforts, which is nothing at first. */
export function modelDefaultsOf(sessionId: string | null): ModelDefaults {
  if (sessionId === null) return NO_DEFAULTS
  return state.modelDefaults.get(sessionId) ?? NO_DEFAULTS
}

/**
 * Hands what a Home's composer learned over to the Session it has just made (D5-17).
 *
 * The engine starts that Session on the choices made in the Home, an effort pinned there
 * included, so the Session's first announcement is not the model's own landing: read on its
 * own, it would teach the pin as the model's default. The Session starts from what the Home knew.
 */
export function carryModelDefaults(
  projectId: string,
  provider: AgentProvider,
  sessionId: string,
): void {
  const held = state.offerings.get(`${projectId}:${provider}`)
  if (held === undefined) return
  const modelDefaults = new Map(state.modelDefaults)
  modelDefaults.set(sessionId, held.modelDefaults)
  replace({ ...state, modelDefaults })
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * One entry, put in its place.
 *
 * An entry the agent is still writing is the same entry written again with more in it — that is
 * what the protocol gives, and what keeps a message that streams for a minute from being forty
 * entries. So a pushed entry replaces the one with its identifier and only ever adds itself
 * when that identifier is new.
 */
function withEntry(held: readonly SessionEntry[], entry: SessionEntry): readonly SessionEntry[] {
  const at = held.findIndex((one) => one.id === entry.id)
  if (at === -1) return [...held, entry]
  const next = [...held]
  next[at] = entry
  return next
}

/** The Session state that holds these entries, in a map that is always a new one. */
function holding(
  sessions: ReadonlyMap<string, AgentSessionState>,
  sessionId: string,
  next: AgentSessionState,
): Map<string, AgentSessionState> {
  const held = new Map(sessions)
  held.set(sessionId, next)
  return held
}

function changed(sessionId: string, patch: Partial<AgentSessionState>): void {
  const held = state.sessions.get(sessionId) ?? QUIET
  replace({ ...state, sessions: holding(state.sessions, sessionId, { ...held, ...patch }) })
}

/**
 * Listens to the engine for as long as the window is open.
 *
 * Subscribed once, by the application: what arrives is a fact about a Session and not about the
 * page that happens to be on screen, so one subscription holds them all and a page reads the
 * one it is drawing. The four names are exhaustive — the wire declares them — and each is
 * reduced to what it says here, so the pages never see a message.
 */
export function listenToAgents(): () => void {
  if (listening) return () => undefined
  listening = true
  const stop = window.hemera.on((event: EngineEvent) => {
    if (event.event === 'entry' && event.entry !== null) {
      const held = state.sessions.get(event.sessionId) ?? QUIET
      changed(event.sessionId, {
        entries: withEntry(held.entries, event.entry),
        latest: event.entry.id,
      })
      return
    }
    // The others carry no entry of their own, and none of them is dropped for that. A permission
    // is the request entry that arrived with it, and an agent that died or a Session that fell
    // back to the thread is read in the thread itself. What is left to keep is the one thing no
    // entry says: whether a turn is running.
    //
    // Both ends of a turn are heard, because they are two facts. `turn_start` arrives the moment
    // the user's message is written, before the agent has been given anything to do: the row at
    // the end of the thread and the stop in the composer stand from then, and not from the first
    // word that comes back (design D5-12).
    if (event.event === 'turn_start') {
      announced.add(event.sessionId)
      changed(event.sessionId, { running: true })
    }
    if (event.event === 'turn') {
      announced.delete(event.sessionId)
      changed(event.sessionId, { running: false })
    }
  })
  return () => {
    listening = false
    announced.clear()
    stop()
  }
}

/**
 * Asks what the agent of a Session offers, and keeps the answer against it.
 *
 * Read when the Session is opened and after an option is changed: an agent announces its models
 * and its modes when it starts, and what it is on now is the agent's own answer and not a value
 * this window remembers.
 *
 * `setOptionId` is the option whose change this read answers, and null for a plain read: what
 * each model defaults to is read off the answers until an effort is pinned (`modelDefaultsAfter`).
 */
export async function readOptions(
  sessionId: string,
  setOptionId: string | null = null,
): Promise<void> {
  try {
    const answered = await window.hemera.invoke('agents.options', { sessionId })
    const options = new Map(state.options)
    options.set(sessionId, answered.options)
    const modelDefaults = new Map(state.modelDefaults)
    modelDefaults.set(
      sessionId,
      modelDefaultsAfter(modelDefaultsOf(sessionId), answered.options, setOptionId),
    )
    replace({ ...state, options, modelDefaults, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * What an agent offers a Project that no Session holds yet, or nothing while it is being asked.
 *
 * An agent that this machine does not have offers nothing here, and the refusal `offerAgent` kept
 * is what the composer shows instead of a choice.
 */
export function offeringOf(
  projectId: string | null,
  provider: AgentProvider | null,
): AgentOffering {
  if (projectId === null || provider === null) return UNASKED
  return state.offerings.get(`${projectId}:${provider}`) ?? UNASKED
}

/** What one agent offers one Project, kept against the two of them and nothing else. */
function offering(key: string, next: AgentOffering): void {
  const offerings = new Map(state.offerings)
  offerings.set(key, next)
  replace({ ...state, offerings })
}

/**
 * The offer an answer carries: what the agent announced, or the sentence it was refused with,
 * and what the composer has learned of its models' defaults with that answer — from what it knew
 * before and the option the answer is to, null for the first offer (`modelDefaultsAfter`).
 */
function offered(
  answer: AgentOffer,
  held: ModelDefaults,
  setOptionId: string | null,
): AgentOffering {
  return {
    options: answer.options,
    refusal: answer.refusal === null ? null : answer.refusal.message,
    loading: false,
    modelDefaults: modelDefaultsAfter(held, answer.options, setOptionId),
  }
}

/**
 * Asks an agent what it offers a Project, before any Session holds it (D5-17).
 *
 * Asked when an agent is picked in the Home's composer, and never again for that Project: the
 * engine starts the agent to be told, so the answer is kept rather than asked for on every
 * render. A refusal leaves the composer with nothing to choose and the reason on screen, in the
 * engine's own sentence — this machine does not have the agent, or nobody has signed it in.
 */
export async function offerAgent(projectId: string, provider: AgentProvider): Promise<void> {
  const key = `${projectId}:${provider}`
  if (state.offerings.has(key)) return
  offering(key, { ...UNASKED, loading: true })
  try {
    const answer = await window.hemera.invoke('agents.offer', { projectId, provider })
    offering(key, offered(answer, NO_DEFAULTS, null))
  } catch (cause) {
    offering(key, { ...UNASKED, refusal: message(cause) })
  }
}

/**
 * Puts that agent on one of its own options, while the composer is still being written in.
 *
 * The list is replaced by what comes back rather than patched: an option the agent only
 * publishes once another one has been chosen — the effort of a reasoning model — is announced in
 * the answer to that choice and nowhere else (D5-13). The engine keeps the choice for the
 * Session this composer will start, so nothing here has to hand it over again.
 */
export async function setOffered(
  projectId: string,
  provider: AgentProvider,
  optionId: string,
  value: string,
): Promise<void> {
  const key = `${projectId}:${provider}`
  const held = state.offerings.get(key) ?? UNASKED
  offering(key, { ...held, loading: true })
  try {
    const answer = await window.hemera.invoke('agents.offerSet', {
      projectId,
      provider,
      optionId,
      value,
    })
    offering(key, offered(answer, held.modelDefaults, optionId))
  } catch (cause) {
    offering(key, { ...held, refusal: message(cause), loading: false })
  }
}

/**
 * Says something to the agent of a Session, and waits for the turn to be over.
 *
 * The answer is why the turn ended and not that it was sent: everything it says in between
 * arrives on its own. `null` is what the composer reads as accepted, and anything else is the
 * sentence it shows — the engine refuses a prompt when the Session has no agent, or when the
 * agent is no longer there.
 *
 * A failure does not end a turn the engine said had begun. The main process gives up waiting
 * for an answer after a few seconds, a turn takes minutes, and taking the running flag down
 * then is what emptied the row and put the Stop away five seconds into every turn (trial of
 * 22 September 2026): once the turn is announced, the engine's own `turn` is what ends it.
 */
export async function say(sessionId: string, text: string): Promise<string | null> {
  changed(sessionId, { running: true })
  try {
    const answered = await window.hemera.invoke('agents.prompt', { sessionId, text })
    changed(sessionId, { running: false, stopReason: answered.stopReason })
    return null
  } catch (cause) {
    if (!announced.has(sessionId)) changed(sessionId, { running: false })
    replace({ ...state, refusal: message(cause) })
    return message(cause)
  }
}

/** Stops the turn running in a Session, which is what the composer's square does (D17-13). */
export async function stopTurn(sessionId: string): Promise<void> {
  try {
    await window.hemera.invoke('agents.stop', { sessionId })
    replace({ ...state, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Answers the question one block was drawn for, from the page.
 *
 * A null option is not a missing answer: it is the request closed without choosing anything,
 * and the agent is told either way (design D5-13).
 */
export async function decide(
  sessionId: string,
  toolCallId: string,
  optionId: string | null,
): Promise<void> {
  try {
    await window.hemera.invoke('agents.decide', { sessionId, toolCallId, optionId })
    replace({ ...state, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** Puts the agent of a Session on another of its own options, and reads back what it is on. */
export async function chooseOption(
  sessionId: string,
  optionId: string,
  value: string,
): Promise<void> {
  try {
    await window.hemera.invoke('agents.setOption', { sessionId, optionId, value })
    await readOptions(sessionId, optionId)
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** Asks a Session to come back to its agent's own native session (design D5-06). */
export async function resume(sessionId: string): Promise<ResumeState | null> {
  try {
    const answered = await window.hemera.invoke('agents.resume', { sessionId })
    replace({ ...state, refusal: null })
    return answered.state
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return null
  }
}

/** What this machine has, read without leaving it: which command exists, and which version. */
export async function loadAgents(): Promise<void> {
  try {
    const answered = await window.hemera.invoke('agents.list', {})
    replace({ ...state, agents: answered.agents, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Asks each agent's registry what it published, which is the one question that leaves the
 * machine: asked when the Agents section is opened, and never on a schedule (design D5-18).
 */
export async function checkAgents(): Promise<void> {
  try {
    const answered = await window.hemera.invoke('agents.check', {})
    replace({ ...state, agents: answered.agents, checked: true, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Runs the update command of one agent's own tool, and answers what it said.
 *
 * Only ever because a button was pressed: Hemera never updates an agent on its own, and the
 * output is the tool's rather than a sentence written here — an update that refused says why in
 * its own words (design D5-18). The list is read again afterwards, so the versions on screen are
 * the ones that are there now.
 */
export async function updateAgent(id: AgentProvider): Promise<AgentUpdate | null> {
  try {
    const answered = await window.hemera.invoke('agents.update', { id })
    await checkAgents()
    return answered
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return null
  }
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetAgentRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
