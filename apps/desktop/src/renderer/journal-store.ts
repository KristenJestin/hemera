import type { JournalEntry } from '@hemera/ipc'

/**
 * The Journal of the Project being looked at, one page at a time (design D4-05, D4-11).
 *
 * The page grows downwards and never sideways: asking for what is older appends, and every
 * other act — a filter, another Project — starts again from the most recent. That is what the
 * cursor is for, and it is why this store keeps one rather than a page number.
 *
 * It holds what is on screen and nothing else. Which entries match a filter is the engine's
 * answer, not a list narrowed here: a page that hid rows it had been given would be showing a
 * filter that does not agree with the one the engine applied.
 */
export interface JournalState {
  entries: JournalEntry[]
  /** Where the next page starts, and null when there is nothing older. */
  nextBefore: number | null
  /** Whether a page is on its way, which is what the button at the foot says. */
  loading: boolean
  /** Which entity is wanted, and whether only what the user did themselves is. */
  kind: JournalEntry['entityKind'] | 'all'
  byYou: boolean
  refusal: string | null
}

const EMPTY: JournalState = {
  entries: [],
  nextBefore: null,
  loading: false,
  kind: 'all',
  byYou: false,
  refusal: null,
}

const listeners = new Set<() => void>()

let state: JournalState = EMPTY
/** Whose Journal is on screen, so a page of another Project is never appended to this one. */
let shown: string | null = null

export function subscribeToJournal(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function journalSnapshot(): JournalState {
  return state
}

function replace(next: JournalState): void {
  state = next
  for (const listener of listeners) listener()
}

/** What the filters on screen come to, as the use case takes them. */
interface Filters {
  kinds?: JournalEntry['entityKind'][]
  authors?: JournalEntry['author'][]
}

function asked(): Filters {
  const filters: Filters = {}
  if (state.kind !== 'all') filters.kinds = [state.kind]
  if (state.byYou) filters.authors = ['human']
  return filters
}

/**
 * Reads the most recent page of a Project's Journal, replacing whatever was there.
 *
 * Called on opening the Journal, on changing a filter and on changing Project — all three are
 * the same thing: a question whose answer starts again from the top.
 */
export async function openJournal(projectId: string): Promise<void> {
  shown = projectId
  replace({ ...state, loading: true, refusal: null })
  try {
    const page = await window.hemera.invoke('journal.read', { projectId, ...asked() })
    if (shown !== projectId) return
    replace({ ...state, ...page, loading: false })
  } catch (cause) {
    replace({ ...state, loading: false, refusal: message(cause) })
  }
}

/**
 * Appends the page before the one on screen.
 *
 * The cursor is what the last answer said, never a count of what is being shown: entries
 * written while the page was open would make a count both repeat and skip.
 */
export async function loadEarlier(projectId: string): Promise<void> {
  if (state.nextBefore === null || state.loading) return
  const before = state.nextBefore
  replace({ ...state, loading: true })
  try {
    const page = await window.hemera.invoke('journal.read', { projectId, before, ...asked() })
    if (shown !== projectId) return
    replace({
      ...state,
      entries: [...state.entries, ...page.entries],
      nextBefore: page.nextBefore,
      loading: false,
    })
  } catch (cause) {
    replace({ ...state, loading: false, refusal: message(cause) })
  }
}

/** Changes a filter, which is a new question and so a new first page. */
export async function filterJournal(
  projectId: string,
  change: { kind?: JournalState['kind']; byYou?: boolean },
): Promise<void> {
  replace({ ...state, ...change })
  await openJournal(projectId)
}

/** Forgets everything, for a window that no longer has a Project to show one of. */
export function closeJournal(): void {
  shown = null
  replace(EMPTY)
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
