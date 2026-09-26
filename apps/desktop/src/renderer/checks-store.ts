import type { CheckDraft, ProjectCheck } from '@hemera/ipc'

/**
 * The checks of a Project's build, as the Build section of its settings shows them (D10-06).
 *
 * Like every store of this window it holds what the engine answered: the checks the Project
 * saved, and the checks the engine proposes from the catalogue while none is saved — proposed
 * only, since nothing is saved until the user accepts them (scenario "Defaults come from the
 * catalogue"). Every write reads the list again rather than patching it here.
 *
 * "Discard" has no channel: the engine keeps nothing about a proposal put away. It empties the
 * proposals this store holds, so the section says there is no check, and the next reading — the
 * settings opened again — proposes them anew.
 */
export interface ChecksState {
  /** The checks each Project saved, in their order, once read. */
  checks: ReadonlyMap<string, readonly ProjectCheck[]>
  /** What the engine proposes to each Project that has no check, once read. */
  proposed: ReadonlyMap<string, readonly CheckDraft[]>
  /** What the last reading or removal was refused with, in the engine's words, or null. */
  refusal: string | null
}

const EMPTY: ChecksState = { checks: new Map(), proposed: new Map(), refusal: null }

/** No proposal: one array for every Project that has none, so a render sees nothing change. */
const NONE: readonly CheckDraft[] = []

const listeners = new Set<() => void>()

let state: ChecksState = EMPTY

export function subscribeToChecks(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function checksSnapshot(): ChecksState {
  return state
}

function replace(next: ChecksState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function withKey<V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  return new Map([...map, [key, value]])
}

/** The checks a Project saved; empty until they were read. */
export function checksOf(projectId: string): readonly ProjectCheck[] {
  return state.checks.get(projectId) ?? []
}

/** What the engine proposes to a Project; empty until read, and once discarded. */
export function proposedOf(projectId: string): readonly CheckDraft[] {
  return state.proposed.get(projectId) ?? NONE
}

/** Reads a Project's checks and what is proposed to it, keeping a refusal as it was said. */
export async function readChecks(projectId: string): Promise<void> {
  try {
    const read = await window.hemera.invoke('checks.list', { projectId })
    replace({
      checks: withKey(state.checks, projectId, read.checks),
      proposed: withKey(
        state.proposed,
        projectId,
        read.proposed.length === 0 ? NONE : read.proposed,
      ),
      refusal: null,
    })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Writes a check — a new one when `id` is null, the one it names otherwise — and reads the list
 * again. Answers the engine's refusal for the dialog to say, or null.
 */
export async function saveCheck(
  projectId: string,
  id: string | null,
  draft: CheckDraft,
): Promise<string | null> {
  try {
    await window.hemera.invoke('checks.save', { projectId, id, draft })
  } catch (cause) {
    return message(cause)
  }
  await readChecks(projectId)
  return null
}

export async function removeCheck(projectId: string, id: string): Promise<void> {
  try {
    await window.hemera.invoke('checks.remove', { id })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return
  }
  await readChecks(projectId)
}

/** Saves the proposals as the user left them, all at once; answers the refusal, or null. */
export async function acceptProposed(
  projectId: string,
  drafts: readonly CheckDraft[],
): Promise<string | null> {
  try {
    await window.hemera.invoke('checks.acceptProposed', { projectId, drafts: [...drafts] })
  } catch (cause) {
    return message(cause)
  }
  await readChecks(projectId)
  return null
}

/** Puts the proposals away until the Project's checks are read again; nothing is written. */
export function discardProposed(projectId: string): void {
  replace({ ...state, proposed: withKey(state.proposed, projectId, NONE) })
}
