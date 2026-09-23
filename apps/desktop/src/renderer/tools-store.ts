import type { CommandRun, EngineEvent } from '@hemera/ipc'

/**
 * The runs of the Sessions this window has open (design D6-12).
 *
 * A run is one process Hemera owns, whoever started it: the agent through its tool, the user
 * through the Commands panel. The thread holds one entry per run, written when it starts and when
 * it ends; what happens between — the address it publishes, what it prints — reaches the window
 * as the run itself, pushed whole as it changes, and is kept here. The thread's block and the
 * panel both read a run from here, so they show the same state, address and output.
 *
 * Nothing is decided here: a run is stored as the engine pushed it or answered it, and a refusal
 * is the engine's sentence.
 */
export interface ToolsState {
  /** The runs of each Session, oldest first, as the engine last said them. */
  runs: ReadonlyMap<string, readonly CommandRun[]>
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const EMPTY: ToolsState = { runs: new Map(), refusal: null }

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
    if (event.event !== 'run') return
    holding(event.sessionId, withRun(runsOf(event.sessionId), event.run))
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

/** Stops a run and everything it started: the reader's one act on a run (D6-12). */
export async function stopRun(sessionId: string, runId: string): Promise<void> {
  try {
    const stopped = await window.hemera.invoke('commands.stop', { sessionId, runId })
    holding(sessionId, withRun(runsOf(sessionId), stopped))
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetToolsRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
