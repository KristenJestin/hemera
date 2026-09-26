import type { AgentProvider, EngineEvent, Session, SessionEntry, Workspace } from '@hemera/ipc'

/**
 * The Sessions of the Project in front, and the thread of the one that is open (design D4b-02).
 *
 * The engine is the authority on everything here. Every act asks a use case and takes what came
 * back rather than editing what it had: the title a message just proposed, the order a rename
 * changes, and whether a write landed are all the engine's answers and not this store's guesses.
 *
 * The thread of a Session is read whole, from the end backwards. `sessions.read` answers one
 * page and the cursor to the one before it, which is the shape the Journal is read in too: a
 * thread is opened at what was written last, and what came before is asked for until there is
 * nothing older. That is what lets the page show a number of messages that is true.
 *
 * A refusal is not an exception: it is what the engine said, kept as it was said so the page can
 * show it. A write that failed leaves the thread exactly as it was — which is what "not kept"
 * means, and the whole reason the composer shows `Failed` rather than `Saved` (design D4b-05).
 */
export interface SessionsState {
  /** The Sessions of the active Project, most recently written first, archived ones left out. */
  sessions: Session[]
  /** The thread of the Session that is open, oldest first. */
  thread: SessionEntry[]
  /** Which Session the thread belongs to, or null when none is open. */
  open: string | null
  /** Whether the thread has been read back, so a page can tell empty from not yet asked. */
  loaded: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
  /**
   * The Workspaces of the active Project, as `workspaces.list` answered: what the composer's
   * pill offers a Session to work in (D8-08).
   */
  workspaces: readonly Workspace[]
}

const EMPTY: SessionsState = {
  sessions: [],
  thread: [],
  open: null,
  loaded: false,
  refusal: null,
  workspaces: [],
}

/**
 * How many pages of a thread are read before the page gives up.
 *
 * The engine answers fifty entries at a time, so this is a thousand messages in one Session: a
 * thread that long is a bug or an import, and neither of them is worth a window that holds a
 * cursor in its hand while the user waits.
 */
const PAGES = 20

const listeners = new Set<() => void>()

let state: SessionsState = EMPTY
/** Whose Sessions are on screen, so an answer about another Project is never put on this one. */
let shown: string | null = null

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

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** The Sessions of a Project, archived ones left out. */
async function listed(projectId: string): Promise<Session[]> {
  return await window.hemera.invoke('sessions.list', { projectId })
}

/** The whole thread of a Session, oldest first, read from the end backwards. */
async function threadOf(sessionId: string): Promise<SessionEntry[]> {
  const pages: SessionEntry[][] = []
  let before: number | undefined
  for (let page = 0; page < PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- a page of a thread is asked for with the cursor the page before it answered, so there is nothing to run in parallel
    const read = await window.hemera.invoke(
      'sessions.read',
      before === undefined ? { sessionId } : { sessionId, before },
    )
    pages.unshift(read.entries)
    if (read.nextBefore === null) break
    before = read.nextBefore
  }
  return pages.flat()
}

/**
 * Reads the Sessions of a Project, which is what opening the window and changing Project do.
 *
 * The thread is dropped with them: it belongs to a Session of the Project that was in front, and
 * a page showing it under the next Project's name would be showing one Project's writing under
 * another's.
 */
export async function openSessions(projectId: string): Promise<void> {
  shown = projectId
  replace({ ...state, thread: [], open: null, loaded: false, refusal: null, workspaces: [] })
  void readWorkspaces(projectId)
  try {
    const sessions = await listed(projectId)
    if (shown !== projectId) return
    replace({ ...state, sessions, refusal: null })
  } catch (cause) {
    if (shown !== projectId) return
    replace({ ...state, loaded: true, refusal: message(cause) })
    return
  }
  replace({ ...state, loaded: true })
}

/**
 * Reads the Sessions of a Project again, and keeps nothing but the list.
 *
 * A turn is the engine's own work: it writes the message the user sent, and the first message of
 * a Session is what proposes its title (design D4b-05, D5-11). Nothing of this store is what
 * changed the Session, so the list is read again rather than patched — and only the list: the
 * thread and the Session that is open belong to whoever is reading them, and a read that dropped
 * them would close a page nobody asked to close.
 */
export async function readSessions(projectId: string): Promise<void> {
  try {
    const sessions = await listed(projectId)
    if (shown !== projectId) return
    replace({ ...state, sessions, refusal: null })
  } catch (cause) {
    if (shown !== projectId) return
    replace({ ...state, refusal: message(cause) })
  }
}

/** Reads the thread of a Session and keeps it as what the page is showing. */
export async function openSession(sessionId: string): Promise<void> {
  replace({ ...state, open: sessionId, thread: [], loaded: false, refusal: null })
  try {
    const thread = await threadOf(sessionId)
    if (state.open !== sessionId) return
    replace({ ...state, thread, loaded: true })
  } catch (cause) {
    if (state.open !== sessionId) return
    replace({ ...state, loaded: true, refusal: message(cause) })
  }
}

/**
 * Makes a Session with the agent it will run, and answers it so whoever asked can open it.
 *
 * A Session exists from the moment it is made, before anything is written in it, and what is
 * chosen when it is made is the agent: a Session keeps the one it was made with, so the composer
 * that starts it is where that is decided, and `null` is not a choice — it is the Sessions
 * written before the agents existed (D5-06, D5-17). The Workspace it works in is chosen there too,
 * null for `main` (D8-08). Nothing else is created with it — no Spec (design D4b-01) — and the
 * engine is where that is true rather than here.
 */
export async function startSession(
  projectId: string,
  provider: AgentProvider | null,
  workspaceId: string | null,
): Promise<Session | null> {
  try {
    const session = await window.hemera.invoke('sessions.create', {
      projectId,
      provider,
      workspaceId,
    })
    const sessions = await listed(projectId)
    if (shown !== projectId) return session
    replace({ ...state, sessions, refusal: null })
    return session
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return null
  }
}

/**
 * Writes a message into a Session, and answers what the composer shows.
 *
 * `null` is what the composer reads as saved; anything else is the sentence it shows. The state
 * between the two — `saving` — is the page's and not this store's, because it is a fact about the
 * composer and not about the data.
 */
export async function writeMessage(sessionId: string, body: string): Promise<string | null> {
  const before = state
  try {
    const written = await window.hemera.invoke('sessions.append', { sessionId, body })
    const sessions = await listed(written.session.projectId)
    replace({
      ...state,
      sessions,
      thread: state.open === sessionId ? [...state.thread, written.entry] : state.thread,
      refusal: null,
    })
    return null
  } catch (cause) {
    // Nothing on screen moves: what was not written was not written, and a thread that showed
    // the message anyway would be showing a message the data folder does not have.
    replace({ ...before, loaded: true, refusal: message(cause) })
    return message(cause)
  }
}

/** Renames a Session, which is the last time its title is ever proposed by anything but a user. */
export async function renameSession(session: Session, title: string): Promise<boolean> {
  return await acting(session.projectId, async () => {
    await window.hemera.invoke('sessions.rename', {
      id: session.id,
      version: session.version,
      title,
    })
    return await listed(session.projectId)
  })
}

/** Puts a Session away. Nothing is deleted, and it can be brought back (design D4b-06). */
export async function archiveSession(session: Session): Promise<boolean> {
  return await acting(session.projectId, async () => {
    await window.hemera.invoke('sessions.archive', { id: session.id, version: session.version })
    return await listed(session.projectId)
  })
}

export async function restoreSession(session: Session): Promise<boolean> {
  return await acting(session.projectId, async () => {
    await window.hemera.invoke('sessions.restore', { id: session.id, version: session.version })
    return await listed(session.projectId)
  })
}

/**
 * Moves a Session to another of the Project's Workspaces, null for `main` (D8-08).
 *
 * Only before its agent has started: the engine refuses it afterwards, and the refusal is kept
 * like any other, for the page to show where it shows refusals.
 */
export async function chooseWorkspace(
  session: Session,
  workspaceId: string | null,
): Promise<boolean> {
  return await acting(session.projectId, async () => {
    await window.hemera.invoke('sessions.chooseWorkspace', {
      id: session.id,
      version: session.version,
      workspaceId,
    })
    return await listed(session.projectId)
  })
}

/** Runs an act that changes a Session, and puts the list the engine answered back on screen. */
async function acting(projectId: string, act: () => Promise<Session[]>): Promise<boolean> {
  try {
    const sessions = await act()
    if (shown !== projectId) return true
    replace({ ...state, sessions, refusal: null })
    return true
  } catch (cause) {
    replace({ ...state, refusal: message(cause) })
    return false
  }
}

/** Reads the Workspaces of the Project on screen, which the composer's pill offers (D8-08). */
export async function readWorkspaces(projectId: string): Promise<void> {
  try {
    const workspaces = await window.hemera.invoke('workspaces.list', { projectId })
    if (shown !== projectId) return
    replace({ ...state, workspaces })
  } catch (cause) {
    if (shown !== projectId) return
    replace({ ...state, refusal: message(cause) })
  }
}

/**
 * Reads them again whenever the engine says one of them changed: a Workspace being prepared
 * becomes one the pill offers the moment it is `ready`, and one cleaned up leaves it (D8-01).
 */
export function listenToWorkspaces(): () => void {
  return window.hemera.on((event: EngineEvent) => {
    if (event.event === 'workspace' && event.projectId === shown) {
      void readWorkspaces(event.projectId)
    }
  })
}

/** A Workspace the pill offers: its name, where it is, and what the engine is given for it. */
export interface OfferedWorkspace {
  /** What `sessions.create` and `sessions.chooseWorkspace` are given: null for `main`. */
  readonly id: string | null
  readonly name: string
  readonly path: string
}

/**
 * What the pill lists (D8-08): the Project's Workspaces in state `ready`, `main` first.
 *
 * `kept` is the Workspace a Session already works in, listed whatever its state: a Session keeps
 * its Workspace, and a pill that could not name it would say the Session works nowhere.
 */
export function offeredWorkspacesOf(
  workspaces: readonly Workspace[],
  kept: string | null = null,
): OfferedWorkspace[] {
  return workspaces
    .filter((one) => one.state === 'ready' || one.id === kept)
    .toSorted((a, b) => Number(b.main) - Number(a.main))
    .map((one) => ({ id: one.main ? null : one.id, name: one.name, path: one.path }))
}

/**
 * The folder a Workspace of the Project is, which a composer searches and picks files in and a
 * Session's runs are said relative to (D8-08): `main`'s own for null, and another's once the list
 * has named it. Null while it has not: a root that is not known is not offered as `main`'s.
 */
export function workspaceRootOf(
  workspaceId: string | null,
  workspaces: readonly Workspace[],
  mainPath: string,
): string | null {
  if (workspaceId === null) return mainPath
  return workspaces.find((one) => one.id === workspaceId)?.path ?? null
}

/**
 * Whether a Session's Workspace can no longer change (D8-08): the engine's own answer, computed
 * with the rule `sessions.chooseWorkspace` refuses on — or a turn running.
 *
 * The engine fixes it from the first message written, before the agent is even started; the turn
 * is kept because the Session the page holds was read before that message, and says so only once
 * the list is read again. The page is not to offer a change in between.
 */
export function workspaceFixedOf(session: Session, running: boolean): boolean {
  return session.workspaceFixed || running
}

/**
 * The turns that ended in a Session the list still says is free to change Workspace (D8-08).
 *
 * The engine records the agent's folder during the first turn, after the first message sent the
 * list to be read again: the row read then still says free. Each turn that ends in such a Session
 * is a reason to read the list again, so the pill says fixed without a reload once it is.
 */
export function endedTurnsOf(
  sessions: readonly Session[],
  pushed: ReadonlyMap<string, { readonly entries: readonly SessionEntry[] }>,
): string[] {
  return sessions
    .filter((one) => !one.workspaceFixed)
    .flatMap((one) => pushed.get(one.id)?.entries ?? [])
    .filter((entry) => entry.kind === 'turn')
    .map((entry) => entry.id)
}

/** What was archived, which only the archived page asks for. */
export async function archivedSessions(projectId: string): Promise<Session[]> {
  return await window.hemera.invoke('sessions.list', { projectId, archived: true })
}

/** Forgets the thread and the list, for a window that has no Project to show them for. */
export function closeSessions(): void {
  shown = null
  replace(EMPTY)
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
