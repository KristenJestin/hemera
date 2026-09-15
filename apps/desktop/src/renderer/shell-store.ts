import { JOURNAL_ENTRY, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '@hemera/ui'

import { PROJECT_FIXTURES, sessionsOf } from './fixtures.ts'

/**
 * What the window remembers about its own shell, for as long as the window lasts (D2-01).
 *
 * In memory and nowhere else: which Project is active, which entry of the sidebar is being
 * looked at, whether the sidebar is folded and how wide it is. Lot 3 brings the profile, and
 * what changes then is this file — the shell is handed these four values as props either way.
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
  change({ ...state, activeEntryId })
}

export function setCollapsed(collapsed: boolean): void {
  change({ ...state, collapsed })
}

export function toggleCollapsed(): void {
  change({ ...state, collapsed: !state.collapsed })
}

/** Sets the width the sidebar opens at, held inside the bounds the theme declares. */
export function setWidth(width: number): void {
  change({ ...state, width: Math.min(Math.max(width, SIDEBAR_MIN), SIDEBAR_MAX) })
}
