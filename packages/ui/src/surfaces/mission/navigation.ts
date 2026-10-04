/**
 * Where a mission's frame stands: the views open over its base, and the one shown.
 *
 * The base is the page of the current stage, always there and never in this list. A view opened
 * over it — the frozen Spec, a task, a round, the delivery, the diff, the Memory — is named by
 * its id; `shown` is the one on top, or null for the base. The views are a stack: opening a view
 * puts it on top of the one shown, closing one takes everything above it away, and going down to
 * a view already open takes what was above it away too. The breadcrumb of the window says the
 * stack (open question 76, settled: a stack, not tabs).
 *
 * Pure functions, so a story and the renderer's hooks hold the state and this holds the rules.
 */
export interface MissionFrameState {
  readonly open: readonly string[]
  readonly shown: string | null
}

export const AT_BASE: MissionFrameState = { open: [], shown: null }

/** Opens a view on top of the one shown, or goes back down to it when it is already open. */
export function openView(state: MissionFrameState, id: string): MissionFrameState {
  const at = state.open.indexOf(id)
  if (at !== -1) return { open: state.open.slice(0, at + 1), shown: id }
  const under = state.shown === null ? [] : state.open.slice(0, state.open.indexOf(state.shown) + 1)
  return { open: [...under, id], shown: id }
}

/** Closes a view and whatever was opened over it; what was under it is shown again. */
export function closeView(state: MissionFrameState, id: string): MissionFrameState {
  const at = state.open.indexOf(id)
  if (at === -1) return state
  const open = state.open.slice(0, at)
  return { open, shown: open.at(-1) ?? null }
}

/** Shows the base, or goes back down to a view already open: a crumb pressed. */
export function showView(state: MissionFrameState, id: string | null): MissionFrameState {
  if (id === null) return AT_BASE
  return openView(state, id)
}
