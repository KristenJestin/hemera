import type { JournalEntry } from '@hemera/ipc'

/**
 * What nobody has been shown yet, every Project at once (design D4-05, D4-11).
 *
 * The bell is a view on the Journal and not a second list: the same entries, filtered by the
 * one column of an event that is ever written twice. So there is nothing to keep in step — what
 * empties the bell is a write to those rows, and the next read sees it.
 *
 * The counts arrive as pairs and are turned into a map here, because a Map does not survive
 * being sent and a page asking "how many for this Project" should not be walking a list.
 */
export interface NotificationsState {
  entries: JournalEntry[]
  /** How many each Project has, for the dot on its tab. */
  byProject: Map<string, number>
  /** Whether anything at all is left to see, which is the whole of what the bell says. */
  unseen: boolean
}

const EMPTY: NotificationsState = { entries: [], byProject: new Map(), unseen: false }

const listeners = new Set<() => void>()

let state: NotificationsState = EMPTY

export function subscribeToNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notificationsSnapshot(): NotificationsState {
  return state
}

function replace(next: NotificationsState): void {
  state = next
  for (const listener of listeners) listener()
}

/** Asks what is unseen, which is what the bell and every tab's dot are drawn from. */
export async function loadUnseen(): Promise<void> {
  try {
    const answered = await window.hemera.invoke('journal.unseen', {})
    replace({
      entries: answered.entries,
      byProject: new Map(answered.byProject),
      unseen: answered.entries.length > 0,
    })
  } catch {
    // A bell that could not be read is a bell with nothing to show, which is what it already
    // shows: there is no state to correct and nothing a user can do about it.
  }
}

/**
 * Marks everything currently unseen as seen, and asks again.
 *
 * Up to the newest entry there is rather than "everything": an entry written between the press
 * and the write is one the user has not seen, and marking it read would be the bell losing
 * something nobody was shown.
 */
export async function markAllSeen(): Promise<void> {
  const newest = state.entries[0]?.sequence
  if (newest === undefined) return
  try {
    await window.hemera.invoke('journal.markSeen', { upTo: newest })
    await loadUnseen()
  } catch {
    // The same: what the bell shows is what the engine last said, and it will say it again.
  }
}
