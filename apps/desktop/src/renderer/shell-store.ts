import type { SidebarPreference } from '@hemera/ipc'
import { JOURNAL_ENTRY, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '@hemera/ui'

import { PROJECT_FIXTURES, sessionsOf } from './fixtures.ts'

/**
 * What the window remembers about its own shell (design D2-01, D3-08).
 *
 * Two of the four live only as long as the window does — which Project is active and which
 * entry is being looked at, until lot 4 gives them somewhere to go. The other two come from
 * the profile: the page is handed them before it mounts, and writes them back as they change,
 * so the sidebar never appears at a default and then jumps to what the user chose.
 *
 * A width is the exception to writing back as it changes: a drag asks for one on every pointer
 * event, and a profile written to sixty times a second is a profile being used as a mouse.
 * What is written is the width the hand left behind.
 *
 * The same shape as the theme store beside it: a snapshot, a subscription and a few acts.
 * `useSyncExternalStore` wants a snapshot that only changes when something did, so the state
 * is replaced rather than mutated and nothing returns a fresh object for an unchanged read.
 */
export interface ShellState {
  activeProjectId: string
  activeEntryId: string
  collapsed: boolean
  /** The width the sidebar opens at, in pixels, always inside the theme's bounds. */
  width: number
}

const listeners = new Set<() => void>()

function firstEntryOf(projectId: string): string {
  return sessionsOf(projectId)[0]?.id ?? JOURNAL_ENTRY
}

let state: ShellState = {
  activeProjectId: PROJECT_FIXTURES[0]!.id,
  activeEntryId: firstEntryOf(PROJECT_FIXTURES[0]!.id),
  collapsed: false,
  width: SIDEBAR_DEFAULT,
}

/**
 * The width the user set, and null for as long as they never have.
 *
 * Apart from the one the shell is drawn at, which always has a number in it: folding the
 * sidebar would otherwise write the design system's own default into the profile as though it
 * had been chosen, and a later theme would find a width it never gave and cannot change.
 */
let chosen: number | null = null

/**
 * Starts the shell on what the profile holds, before the first render.
 *
 * A width the user has never set is not in the profile at all: what answers it is the design
 * system's own, which is the one place that number is allowed to come from.
 */
export function startShell(held: SidebarPreference): void {
  chosen = held.width
  state = { ...state, collapsed: held.collapsed, width: widthIn(held.width ?? SIDEBAR_DEFAULT) }
}

/**
 * Hands a change to the profile. What comes back is nothing: the page already has it.
 *
 * Nothing but the answer, that is: a channel that refused, timed out or found nobody there
 * rejects, and a rejection nobody is holding is an unhandled one.
 */
function persist(): void {
  window.hemera
    .invoke('preferences.write', { sidebar: { collapsed: state.collapsed, width: chosen } })
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected channel carries whatever the main process threw, and this is where it stops
    .catch((failed: unknown) => {
      console.error('preferences.write: the sidebar was not written to the profile', failed)
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

/** Makes a Project active, and lands on its first Session, or on its Journal if it has none. */
export function selectProject(activeProjectId: string): void {
  if (activeProjectId === state.activeProjectId) return
  change({ ...state, activeProjectId, activeEntryId: firstEntryOf(activeProjectId) })
}

/** Makes the Project of a given rank active, if there is one: Ctrl+7 of five Projects is not. */
export function selectProjectByRank(rank: number): void {
  const project = PROJECT_FIXTURES[rank - 1]
  if (project !== undefined) selectProject(project.id)
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

/** Whether a width has been dragged to somewhere the profile has not been told about yet. */
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
