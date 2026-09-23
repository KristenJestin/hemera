import type {
  Command,
  CommandRun,
  CommandScope,
  CommandType,
  ContextView,
  EngineEvent,
} from '@hemera/ipc'

/**
 * The runs and the Context view of the Sessions this window has open (design D6-10, D6-12).
 *
 * A run is one process Hemera owns, whoever started it: the agent through its tool, the user
 * through the Commands panel. The thread holds one entry per run, written when it starts and when
 * it ends; what happens between — the address it publishes, what it prints — reaches the window
 * as the run itself, pushed whole as it changes, and is kept here. The thread's block and the
 * panel both read a run from here, so they show the same state, address and output.
 *
 * The Context view is read rather than pushed: what a Session was provided changes with a turn —
 * the base goes with the first prompt — and when a change of `AGENTS.md` is delivered, and the
 * engine says both; a Session whose view the window holds is read again then (D6-10).
 *
 * Nothing is decided here: a run is stored as the engine pushed it or answered it, and a refusal
 * is the engine's sentence.
 */
export interface ToolsState {
  /** The runs of each Session, oldest first, as the engine last said them. */
  runs: ReadonlyMap<string, readonly CommandRun[]>
  /** The Context view of each Session the window has read one for. */
  contexts: ReadonlyMap<string, ContextView>
  /** The catalogue of each Project the settings have read, oldest first. */
  catalogues: ReadonlyMap<string, readonly Command[]>
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: ToolsState = {
  runs: new Map(),
  contexts: new Map(),
  catalogues: new Map(),
  refusal: null,
}

const listeners = new Set<() => void>()

let state: ToolsState = EMPTY

/** Whether the engine is being listened to, so two pages never subscribe twice. */
let listening = false

export function subscribeToTools(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toolsSnapshot(): ToolsState {
  return state
}

function replace(next: ToolsState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** The runs of one Session, oldest first; none until one was read or pushed. */
export function runsOf(sessionId: string | null): readonly CommandRun[] {
  if (sessionId === null) return []
  return state.runs.get(sessionId) ?? []
}

/** One run in its place: a run pushed again takes the place it had, a new one goes at the end. */
function withRun(held: readonly CommandRun[], run: CommandRun): readonly CommandRun[] {
  const at = held.findIndex((one) => one.id === run.id)
  if (at === -1) return [...held, run]
  const next = [...held]
  next[at] = run
  return next
}

function holding(sessionId: string, runs: readonly CommandRun[]): void {
  const next = new Map(state.runs)
  next.set(sessionId, runs)
  replace({ ...state, runs: next })
}

/**
 * Listens to the engine for as long as the window is open.
 *
 * Subscribed once, by the application, beside the agent store: a run is a fact about a Session
 * and not about the page on screen, so a run a Session started while another was shown is still
 * there when the reader comes back to it.
 */
export function listenToTools(): () => void {
  if (listening) return () => undefined
  listening = true
  const stop = window.hemera.on((event: EngineEvent) => {
    if (event.event === 'run') {
      holding(event.sessionId, withRun(runsOf(event.sessionId), event.run))
      return
    }
    // What a Session was provided may have changed: a turn carried the base with its first
    // prompt, or a change of the Workspace's instructions was delivered. A view held is read again.
    const provided = event.event === 'delivery' || event.event === 'turn'
    if (provided && state.contexts.has(event.sessionId)) void readContext(event.sessionId)
  })
  return () => {
    listening = false
    stop()
  }
}

/** Reads the runs of a Session, which is what a Session opened is drawn from before any push. */
export async function readRuns(sessionId: string): Promise<void> {
  try {
    const answered = await window.hemera.invoke('commands.runs', { sessionId })
    // A run pushed while the answer was on its way and not in it is kept: it started after the
    // engine read the list, and the next push of it would bring it back anyway.
    const known = new Set(answered.map((one) => one.id))
    const since = runsOf(sessionId).filter((one) => !known.has(one.id))
    holding(sessionId, [...answered, ...since])
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Runs a command of the catalogue by name, or a one-off line, from the Commands panel (D6-12).
 *
 * The user's own act: nothing is asked, the run is the same one the agent would have started,
 * and a one-off does not enter the catalogue. Answers the refusal's sentence, or null.
 */
export async function runCommand(
  sessionId: string,
  asked: { readonly name: string } | { readonly line: string },
): Promise<string | null> {
  try {
    const run = await window.hemera.invoke('commands.run', { sessionId, ...asked })
    holding(sessionId, withRun(runsOf(sessionId), run))
    return null
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return message(cause)
  }
}

/** The Context view of a Session, or null until it was read. */
export function contextOf(sessionId: string | null): ContextView | null {
  if (sessionId === null) return null
  return state.contexts.get(sessionId) ?? null
}

/** Reads the Context view of a Session: what it was provided, and what it may consult (D6-10). */
export async function readContext(sessionId: string): Promise<void> {
  try {
    const view = await window.hemera.invoke('context.read', { sessionId })
    const contexts = new Map(state.contexts)
    contexts.set(sessionId, view)
    replace({ ...state, contexts })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** Stops a run and everything it started: the reader's one act on a run (D6-12). */
export async function stopRun(sessionId: string, runId: string): Promise<void> {
  try {
    const stopped = await window.hemera.invoke('commands.stop', { sessionId, runId })
    holding(sessionId, withRun(runsOf(sessionId), stopped))
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** The catalogue of a Project, oldest first; empty until it was read. */
export function catalogueOf(projectId: string | null): readonly Command[] {
  if (projectId === null) return []
  return state.catalogues.get(projectId) ?? []
}

/** Reads the catalogue of a Project, which is what its settings list (D6-12). */
export async function readCatalogue(projectId: string): Promise<void> {
  try {
    const read = await window.hemera.invoke('commands.list', { projectId })
    const catalogues = new Map(state.catalogues)
    catalogues.set(projectId, read)
    replace({ ...state, catalogues })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** A command as the settings write it: `folder` null for the Workspace root. */
export interface CommandDraft {
  readonly projectId: string
  readonly name: string
  readonly line: string
  readonly lineWindows: string | null
  readonly lineLinux: string | null
  readonly type: CommandType
  readonly folder: string | null
  readonly scope: CommandScope
  readonly portless: boolean
}

/**
 * Adds a command to the catalogue, or rewrites the one of the same name.
 *
 * Answers the engine's sentence when it refuses — a name the catalogue already holds, a folder
 * that is not one of the Project's repositories — and null once the catalogue was read again.
 */
export async function saveCommand(draft: CommandDraft, existing: boolean): Promise<string | null> {
  try {
    await window.hemera.invoke(existing ? 'commands.update' : 'commands.create', draft)
    await readCatalogue(draft.projectId)
    return null
  } catch (cause) {
    return message(cause)
  }
}

/** Takes a command out of the catalogue, by its name. What it already ran is not touched. */
export async function removeCommand(projectId: string, name: string): Promise<void> {
  try {
    await window.hemera.invoke('commands.remove', { projectId, name })
    await readCatalogue(projectId)
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetToolsRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
