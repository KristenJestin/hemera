import type { ActiveSessions, DisplayPreferences, DisplayPreferencesChange } from '@hemera/ipc'
import { HOME_ENTRY, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '@hemera/ui'

/**
 * What the window remembers about its own shell (design D2-01, D3-08).
 *
 * Which Project is active and which entry is being looked at live here; the fold and the width
 * come from the data folder, handed to the page before it mounts and written back as they
 * change, so the sidebar never appears at a default and then jumps to what the user chose.
 *
 * A width is the exception to writing back as it changes: a drag asks for one on every pointer
 * event, and a database written to sixty times a second is a database being used as a mouse.
 * What is written is the width the hand left behind.
 *
 * The store knows nothing of what a Project is: which ones exist is the application's, and it
 * hands the identifiers in when a rank has to be resolved. That is what lets the same store
 * carry fixtures in phase 0 and the engine's own answer in phase 2.
 *
 * The same shape as the theme store beside it: a snapshot, a subscription and a few acts.
 * `useSyncExternalStore` wants a snapshot that only changes when something did, so the state
 * is replaced rather than mutated and nothing returns a fresh object for an unchanged read.
 */
export interface ShellState {
  /** The Project everything else is about, and null when there is not one yet. */
  activeProjectId: string | null
  activeEntryId: string
  collapsed: boolean
  /** The width the sidebar opens at, in pixels, always inside the theme's bounds. */
  width: number
}

const listeners = new Set<() => void>()

let state: ShellState = {
  activeProjectId: null,
  activeEntryId: HOME_ENTRY,
  collapsed: false,
  width: SIDEBAR_DEFAULT,
}

/**
 * The width the user set, and null for as long as they never have.
 *
 * Apart from the one the shell is drawn at, which always has a number in it: folding the
 * sidebar would otherwise write the design system's own default into the data folder as though
 * it had been chosen, and a later theme would find a width it never gave and cannot change.
 */
let chosen: number | null = null

/**
 * Starts the shell on what the data folder holds, before the first render.
 *
 * A width the user has never set is not held at all: what answers it is the design system's
 * own, which is the one place that number is allowed to come from.
 *
 * The Project that was being looked at comes back with it, because that is what remembering
 * one is for: a window that reopened on the oldest Project of the bar would be a window that
 * wrote the preference down and never read it. Whether it still exists is not settled here —
 * `keepActiveProject` answers that the moment the list arrives.
 */
export function startShell(held: DisplayPreferences): void {
  chosen = held.sidebar.width
  openSessions = held.activeSessionIds
  state = {
    ...state,
    activeProjectId: held.activeProjectId,
    collapsed: held.sidebar.collapsed,
    width: widthIn(held.sidebar.width ?? SIDEBAR_DEFAULT),
  }
}

/**
 * Which Session was open in each Project, as the data folder holds it (design D4b-07).
 *
 * Beside the state rather than in it: nothing on screen is drawn from it. It is read once, when
 * the Sessions of a Project arrive and the window decides which one to open, and written every
 * time the user goes into another one.
 */
let openSessions: ActiveSessions = {}

/** The Session this Project was left on, and null when it was never left on one. */
export function rememberedSession(projectId: string): string | null {
  return openSessions[projectId] ?? null
}

/**
 * Writes down the Session the window is in, for the next start.
 *
 * The whole map goes, because that is what the preference is: one Session per Project, and a
 * window that sent only the one it is in would be asking the engine to merge what it holds
 * with what it is told — which is a second place deciding what the preference is made of.
 */
export function rememberSession(projectId: string, sessionId: string): void {
  if (openSessions[projectId] === sessionId) return
  openSessions = { ...openSessions, [projectId]: sessionId }
  write({ activeSessionIds: openSessions })
}

/**
 * Hands a change to the engine. What comes back is nothing: the page already has it.
 *
 * Nothing but the answer, that is: a channel that refused, timed out or found nobody there
 * rejects, and a rejection nobody is holding is an unhandled one.
 */
function persist(): void {
  write({ sidebar: { collapsed: state.collapsed, width: chosen } })
}

function write(wanted: DisplayPreferencesChange): void {
  window.hemera
    .invoke('preferences.write', wanted)
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected channel carries whatever the main process threw, and this is where it stops
    .catch((failed: unknown) => {
      console.error('preferences.write: the shell was not written to the data folder', failed)
    })
}

/** A width held inside the bounds the theme declares. */
function widthIn(width: number): number {
  return Math.min(Math.max(width, SIDEBAR_MIN), SIDEBAR_MAX)
}

export function shellState(): ShellState {
  return state
}

export function subscribeToShell(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function change(next: ShellState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Makes a Project active, and lands on its Home: this lot has no Session to land on. */
export function selectProject(activeProjectId: string): void {
  if (activeProjectId === state.activeProjectId) return
  change({ ...state, activeProjectId, activeEntryId: HOME_ENTRY })
}

/**
 * Makes the Project of a given rank active, if there is one.
 *
 * The ranks are the order the Projects were created in, which is the order the bar draws them:
 * `Mod+7` of three Projects is nothing at all, and says so by doing nothing.
 */
export function selectProjectByRank(rank: number, projectIds: readonly string[]): void {
  const id = projectIds[rank - 1]
  if (id !== undefined) selectProject(id)
}

/** Which Project is active when the list changes under it: the one that still exists. */
export function keepActiveProject(projectIds: readonly string[]): void {
  const active = state.activeProjectId
  if (active !== null && projectIds.includes(active)) return
  change({ ...state, activeProjectId: projectIds[0] ?? null, activeEntryId: HOME_ENTRY })
}

export function selectEntry(activeEntryId: string): void {
  if (activeEntryId === state.activeEntryId) return
  change({ ...state, activeEntryId })
}

/**
 * Folds or unfolds, and says nothing when it is already that way.
 *
 * A drag held under the fold threshold asks for this on every pointer event, and a fresh
 * snapshot for an answer that has not changed is the whole window rendered again per frame.
 */
export function setCollapsed(collapsed: boolean): void {
  if (collapsed === state.collapsed) return
  change({ ...state, collapsed })
  persist()
}

export function toggleCollapsed(): void {
  change({ ...state, collapsed: !state.collapsed })
  persist()
}

/** Sets the width the sidebar opens at, held inside the bounds the theme declares. */
export function setWidth(width: number): void {
  const held = widthIn(width)
  if (held === state.width) return
  change({ ...state, width: held })
  chosen = held
  pending = true
}

/** Whether a width has been dragged to somewhere nothing has been told about yet. */
let pending = false

/**
 * Writes down the width the hand left behind, once it has let go.
 *
 * The pointer is listened to on the window rather than on the separator: a drag ends wherever
 * the hand happens to be, and that is very often not over the one pixel it started on.
 */
export function persistWidthOnRelease(): () => void {
  const release = (): void => {
    if (!pending) return
    pending = false
    persist()
  }
  globalThis.addEventListener('pointerup', release)
  return () => {
    globalThis.removeEventListener('pointerup', release)
  }
}
