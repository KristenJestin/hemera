import type {
  AgentAvailability,
  AgentProvider,
  AgentUpdate,
  ConfigOption,
  EngineEvent,
  ResumeState,
  SessionEntry,
  StopReason,
} from '@hemera/ipc'

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
}

/** What a Session nothing has happened in yet holds. */
const QUIET: AgentSessionState = { entries: [], running: false, stopReason: null }

export interface AgentState {
  /** What has been pushed, per Session, since it was last read. */
  sessions: ReadonlyMap<string, AgentSessionState>
  /** What each agent offers, per Session, as its own handshake answered. */
  options: ReadonlyMap<string, readonly ConfigOption[]>
  /**
   * What each agent offers a Project no Session holds yet, keyed `projectId:provider` (D5-17).
   *
   * The Home's composer picks an agent before there is a Session to ask, and the question — what
   * does this agent offer this folder — has the same answer either way: it is asked once per
   * agent and Project, and the Session made from that choice offers its own.
   */
  offerings: ReadonlyMap<string, readonly ConfigOption[]>
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

/** What the agent of a Session offers, which is nothing until its handshake has answered. */
export function optionsOf(sessionId: string | null): readonly ConfigOption[] {
  if (sessionId === null) return []
  return state.options.get(sessionId) ?? []
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
      changed(event.sessionId, { entries: withEntry(held.entries, event.entry) })
      return
    }
    // The three others carry no entry of their own, and none of them is dropped for that. A turn
    // that ended ended because the entry saying so was written just before it, a permission is
    // the request entry that arrived with it — both of those came in as entries — and an agent
    // that died or a Session that fell back to the thread is read in the thread itself. What is
    // left to keep is the one thing no entry says: that a turn is over.
    if (event.event === 'turn') changed(event.sessionId, { running: false })
  })
  return () => {
    listening = false
    stop()
  }
}

/**
 * Asks what the agent of a Session offers, and keeps the answer against it.
 *
 * Read when the Session is opened and after an option is changed: an agent announces its models
 * and its modes when it starts, and what it is on now is the agent's own answer and not a value
 * this window remembers.
 */
export async function readOptions(sessionId: string): Promise<void> {
  try {
    const answered = await window.hemera.invoke('agents.options', { sessionId })
    const options = new Map(state.options)
    options.set(sessionId, answered.options)
    replace({ ...state, options, refusal: null })
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
): readonly ConfigOption[] {
  if (projectId === null || provider === null) return []
  return state.offerings.get(`${projectId}:${provider}`) ?? []
}

/**
 * Asks an agent what it offers a Project, before any Session holds it (D5-17).
 *
 * Asked when an agent is picked in the Home's composer, and never again for that Project: the
 * engine starts the agent to be told, so the answer is kept rather than asked for on every
 * render. A refusal leaves the composer with nothing to choose and the reason on screen.
 */
export async function offerAgent(projectId: string, provider: AgentProvider): Promise<void> {
  const key = `${projectId}:${provider}`
  if (state.offerings.has(key)) return
  try {
    const answered = await window.hemera.invoke('agents.offer', { projectId, provider })
    const offerings = new Map(state.offerings)
    offerings.set(key, answered.options)
    replace({ ...state, offerings, refusal: null })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Says something to the agent of a Session, and waits for the turn to be over.
 *
 * The answer is why the turn ended and not that it was sent: everything it says in between
 * arrives on its own. `null` is what the composer reads as accepted, and anything else is the
 * sentence it shows — the engine refuses a prompt when the Session has no agent, or when the
 * agent is no longer there.
 */
export async function say(sessionId: string, text: string): Promise<string | null> {
  changed(sessionId, { running: true })
  try {
    const answered = await window.hemera.invoke('agents.prompt', { sessionId, text })
    changed(sessionId, { running: false, stopReason: answered.stopReason })
    return null
  } catch (cause) {
    changed(sessionId, { running: false })
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
 * Answers the permission the agent is waiting on, from the page.
 *
 * A null option is not a missing answer: it is the request closed without choosing anything,
 * and the agent is told either way (design D5-13).
 */
export async function decide(sessionId: string, optionId: string | null): Promise<void> {
  try {
    await window.hemera.invoke('agents.decide', { sessionId, optionId })
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
    await readOptions(sessionId)
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
