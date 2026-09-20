import type { Session, SessionEntry } from '@hemera/ipc'

/**
 * The Sessions of the active Project and the thread of the one that is open (design D4b-02).
 *
 * The same shape as the store of Projects beside it: a snapshot, a subscription and a few
 * acts, every one of them asking a use case and keeping what came back rather than editing
 * what it had. The engine owns the order, the titles and the versions; nothing here decides
 * any of it.
 *
 * What is this store's own is the moment between a message being written and it being kept.
 * A message goes into the thread as `saving` and stays there until `sessions.append` returns:
 * only then does it become an entry, with the place the Session gave it. If the write is
 * refused it stays in the thread as `failed`, in the words the engine refused it in, carrying
 * its text and a way to write it again — nothing is ever shown as kept before the commit says
 * it is, which is what the scenario « Échec d'enregistrement » asks for.
 *
 * A burst keeps the order it was typed in. The writes of one Session are chained one after the
 * other rather than sent together: the place a message takes is read inside the transaction
 * that writes it, and ten calls in flight at once would be ten readers of the same number.
 */

/** Where a message that is not yet an entry of the thread stands (design D4b-02). */
export type PendingState = 'saving' | 'failed'

/** A message the user sent, for as long as the engine has not answered about it. */
export interface PendingMessage {
  /** What tells this one from the next, and what the thread draws it under. */
  key: string
  /** Which Session it was written in, so another thread never shows it. */
  sessionId: string
  body: string
  /** When it was sent, which is what the thread heads its group with until it is an entry. */
  writtenAt: number
  state: PendingState
  /** Why it was not kept, in the engine's own words, or null while it is on its way. */
  reason: string | null
}

export interface SessionsState {
  /** Whose Sessions these are, and null when there is no Project in front. */
  projectId: string | null
  /** The Sessions of that Project, last written first, archived ones left out. */
  sessions: Session[]
  /** The archived ones, which the archives page and the palette read. */
  archived: Session[]
  /** The Session the thread below belongs to, and null when no thread is open. */
  activeSessionId: string | null
  /** The thread of that Session, in the order the Session numbered it. */
  entries: SessionEntry[]
  /** What has been written and not yet kept, in the order it was sent. */
  pending: PendingMessage[]
  /** Whether the first read has come back, so a page can tell empty from not yet asked. */
  loaded: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

/** What creating a Session without one is refused with, before anything is written. */
export const NO_ACTIVE_PROJECT =
  'A Session belongs to a Project, and none is active: nothing was created.'

/** What renaming, archiving or restoring something the window no longer holds is refused with. */
const UNKNOWN_SESSION = 'That Session is not in this Project any more.'

const EMPTY: SessionsState = {
  projectId: null,
  sessions: [],
  archived: [],
  activeSessionId: null,
  entries: [],
  pending: [],
  loaded: false,
  refusal: null,
}

const listeners = new Set<() => void>()

let state: SessionsState = EMPTY

export function subscribeToSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function sessionsSnapshot(): SessionsState {
  return state
}

function replace(next: SessionsState): void {
  state = next
  for (const listener of listeners) listener()
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** The order of the sidebar: last written first (design D4b-04). */
function sorted(sessions: Session[]): Session[] {
  return sessions.toSorted((one, other) => other.lastWrittenAt - one.lastWrittenAt)
}

/** The Session a change is about, open or archived, and undefined when there is none. */
function heldSession(id: string): Session | undefined {
  return state.sessions.find((one) => one.id === id) ?? state.archived.find((one) => one.id === id)
}

/**
 * The Sessions of a Project, open and archived, read in one go.
 *
 * Both lists every time rather than the archives only when the page that shows them is open:
 * the sidebar draws how many there are at the bottom of the list, and the palette offers to
 * restore one from anywhere.
 */
export async function loadSessions(projectId: string): Promise<boolean> {
  try {
    const [open, archived] = await Promise.all([
      window.hemera.invoke('sessions.list', { projectId }),
      window.hemera.invoke('sessions.list', { projectId, archived: true }),
    ])
    replace({ ...state, projectId, sessions: open, archived, loaded: true, refusal: null })
    return true
  } catch (cause) {
    replace({ ...state, projectId, loaded: true, refusal: message(cause) })
    return false
  }
}

/** Forgets everything, for a window that no longer has a Project to show Sessions of. */
export function closeSessions(): void {
  replace(EMPTY)
}

/**
 * Opens a thread, or closes the one that is open when asked for nothing.
 *
 * The whole thread is read, one page after another from the first message: the cursor of
 * `sessions.read` goes forwards, and following it to the end is how the reader lands on the
 * last message rather than on the oldest one. A page is what the engine decides it is, so a
 * long thread costs several questions and never one that asks for all of it at once.
 */
export async function openSession(sessionId: string | null): Promise<void> {
  if (sessionId === null) {
    replace({ ...state, activeSessionId: null, entries: [] })
    return
  }
  replace({ ...state, activeSessionId: sessionId, entries: [], refusal: null })
  try {
    const entries: SessionEntry[] = []
    let after: number | undefined
    for (;;) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- a cursor is a chain: where the next page starts is what this page answered
      const page = await window.hemera.invoke('sessions.read', { sessionId, after })
      entries.push(...page.entries)
      if (page.nextAfter === null) break
      after = page.nextAfter
    }
    // The window can have been taken somewhere else while the disk answered, and a thread
    // dropped into a page about another Session is the one thing a cursor must not do.
    if (state.activeSessionId !== sessionId) return
    replace({ ...state, entries })
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Makes a Session in the Project in front, with the first message when there is one.
 *
 * Refused outright without a Project, and refused here rather than by the engine: there is no
 * identifier to send it, and the scenario « Aucun Projet actif » asks for the refusal to be
 * said in words and for nothing at all to be created.
 */
export async function createSession(
  projectId: string | null,
  firstMessage?: string,
): Promise<Session | null> {
  if (projectId === null) {
    replace({ ...state, refusal: NO_ACTIVE_PROJECT })
    return null
  }
  try {
    const session = await window.hemera.invoke('sessions.create', { projectId, firstMessage })
    await loadSessions(projectId)
    return session
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return null
  }
}

/** The title the user chose, which nothing proposes over afterwards (design D4b-03). */
export async function renameSession(id: string, title: string): Promise<boolean> {
  return await changing(id, async (session) => {
    await window.hemera.invoke('sessions.rename', { id, version: session.version, title })
  })
}

export async function archiveSession(id: string): Promise<boolean> {
  return await changing(id, async (session) => {
    await window.hemera.invoke('sessions.archive', { id, version: session.version })
  })
}

export async function restoreSession(id: string): Promise<boolean> {
  return await changing(id, async (session) => {
    await window.hemera.invoke('sessions.restore', { id, version: session.version })
  })
}

/**
 * One change to a Session, carrying the version it was read at, and both lists read again.
 *
 * Read again rather than patched: which Session is archived and where each one sits in the
 * order are the engine's answer, and a list edited here would be a sidebar disagreeing with
 * the database the moment the two counted a write differently.
 */
async function changing(id: string, act: (session: Session) => Promise<void>): Promise<boolean> {
  const session = heldSession(id)
  const projectId = state.projectId
  if (session === undefined || projectId === null) {
    replace({ ...state, refusal: UNKNOWN_SESSION })
    return false
  }
  try {
    await act(session)
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return false
  }
  return await loadSessions(projectId)
}

/** What tells one message being written from the next, for as long as the window is open. */
let written = 0

/**
 * The writes of a Session, one after another.
 *
 * A `sessions.append` reads the place the message takes inside the transaction that writes it,
 * so two in flight at once are two readers of one number. Chaining them per Session is what
 * makes a burst arrive in the order it was typed — and per Session and not per window, because
 * two threads being written in are two threads, not a queue (scenario « Ordre des messages »).
 */
const queues = new Map<string, Promise<void>>()

function serialize(sessionId: string, write: () => Promise<void>): void {
  const queue = queues.get(sessionId) ?? Promise.resolve()
  // `write` answers a refusal by writing it into the message it was about and never rejects,
  // so the chain of a Session cannot be broken by one message the engine would not take.
  queues.set(sessionId, queue.then(write))
}

/**
 * Sends a message in the Session that is open, and shows it as being written.
 *
 * Nothing of it is in the thread yet: what is shown is a message on its way, and it becomes an
 * entry of the Session only when the engine answers with the one it wrote (design D4b-02).
 */
export function sendMessage(body: string): void {
  const sessionId = state.activeSessionId
  if (sessionId === null || body.trim() === '') return
  written += 1
  const key = `written-${String(written)}`
  replace({
    ...state,
    pending: [
      ...state.pending,
      { key, sessionId, body, writtenAt: Date.now(), state: 'saving', reason: null },
    ],
  })
  serialize(sessionId, async () => await writing(key, sessionId, body))
}

/** Writes a refused message again, from the text it still carries. */
export function retryMessage(key: string): void {
  const refused = state.pending.find((one) => one.key === key)
  if (refused === undefined || refused.state === 'saving') return
  replace({
    ...state,
    pending: state.pending.map((one) =>
      one.key === key ? { ...one, state: 'saving', reason: null } : one,
    ),
  })
  serialize(refused.sessionId, async () => await writing(key, refused.sessionId, refused.body))
}

/** One message written down, and what the answer does to the thread and to the sidebar. */
async function writing(key: string, sessionId: string, body: string): Promise<void> {
  try {
    const kept = await window.hemera.invoke('sessions.append', { id: sessionId, body })
    replace({
      ...state,
      // The Session the engine answered with, in the place its last write puts it: a list read
      // again per message would be a round trip per keystroke of a burst.
      sessions: sorted(state.sessions.map((one) => (one.id === sessionId ? kept.session : one))),
      entries: state.activeSessionId === sessionId ? [...state.entries, kept.entry] : state.entries,
      pending: state.pending.filter((one) => one.key !== key),
    })
  } catch (cause) {
    replace({
      ...state,
      pending: state.pending.map((one) =>
        one.key === key ? { ...one, state: 'failed', reason: message(cause) } : one,
      ),
    })
  }
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetSessionRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
