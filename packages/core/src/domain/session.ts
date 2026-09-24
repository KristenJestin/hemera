/**
 * A session: the visible, durable thread of work of a project.
 *
 * A `free` session needs no Spec and no workspace. Its title is proposed from its first
 * message and, once the user has chosen one, no proposal overwrites it. Archiving hides it
 * from the current list and is reversible; nothing deletes it.
 *
 * The words are the design's own (D4b-01): `title_source` says whether the title is still a
 * proposal or the user's, an entry is ordered by its `seq` inside its session, and the only
 * `role` this lot writes is the user's. That last one is a column and not speculation: a
 * session has an agent at the other end one day (HEM-48), and a check a value cannot satisfy
 * is a migration.
 */

/** What a Session is for. `free` is the absence of a mission, and the only value of this lot. */
export type Mission = 'free'

/** Where a title comes from: proposed from the first message, or chosen by the user. */
export type SessionTitleSource = 'derived' | 'user'

/** Who wrote an entry: the user, the agent working in the Session, or Hemera itself. */
export type SessionEntryRole = 'user' | 'agent' | 'hemera'

/**
 * The agents Hemera knows how to start, and the only values `sessions.provider` may hold.
 *
 * The list is here rather than in the engine because it is what a Session may name, and the
 * database constrains the column to it: the same list adding a provider in the engine alone
 * would be a value the check has never heard of, which is a migration (design D5-02).
 */
export const AGENT_PROVIDERS = ['claude', 'codex', 'opencode'] as const

export type AgentProvider = (typeof AGENT_PROVIDERS)[number]

/**
 * How far a Session is attached to the agent's own native session (design D5-06).
 *
 * `none` is a Session whose agent was never started, `attached` one whose native session is the
 * one the agent still holds, `lost` one whose native session the agent no longer knows, and
 * `fallback` one Hemera reopened with a context it rebuilt itself.
 */
export const NATIVE_STATES = ['none', 'attached', 'lost', 'fallback'] as const

export type NativeState = (typeof NATIVE_STATES)[number]

/**
 * How an entry came to be in the thread (design D5-08).
 *
 * `live` is an entry written while the turn that produced it was happening; `replay` is one
 * written from what an agent sent again when a Session came back to its own native session.
 * They are told apart because a resumed thread holds both, and only one of them is happening
 * now — a tool call that is running and a tool call that ran before the window was opened.
 */
export const SESSION_ENTRY_ORIGINS = ['live', 'replay'] as const

export type SessionEntryOrigin = (typeof SESSION_ENTRY_ORIGINS)[number]

/**
 * What an entry of a thread is (design D5-11): everything an agent does is one of these.
 *
 * `body` carries what a one-line reader shows — the markdown of a message, the title of a tool
 * call — and `payload` the shape its own reader parses, so a block that needs a diff, a plan or
 * a set of options finds them without a column per kind.
 */
export const SESSION_ENTRY_KINDS = [
  'message',
  'thought',
  'tool_call',
  'diff',
  'terminal',
  'plan',
  'permission_request',
  'permission_decision',
  'usage',
  'turn',
  'note',
  'hemera_tool_call',
  'command_run',
  'context_delivery',
  /** A command the agent proposed for the catalogue, waiting for a human's decision (D8-11). */
  'command_proposal',
] as const

export type SessionEntryKind = (typeof SESSION_ENTRY_KINDS)[number]

export interface Session {
  id: string
  projectId: string
  title: string
  /** `derived` until the user renames it, and `user` from then on. */
  titleSource: SessionTitleSource
  mission: Mission
  /**
   * The agent this Session talks to, and the model it was last asked for.
   *
   * Null on a Session nothing has talked to yet, and on every Session written before the agents
   * existed: a Session is created first and given an agent when the user picks one, and a column
   * carrying an agent nobody chose would be the database inventing what ran.
   */
  provider: AgentProvider | null
  model: string | null
  /**
   * How far this Session is still attached to that agent's own session (design D5-06).
   *
   * `none` is a Session nothing has run in, `attached` one the agent will be asked to continue,
   * and `lost` one whose handle the agent no longer recognises — which is what the banner over
   * a resumed thread is drawn from, rather than a claim that the thread was continued.
   */
  nativeState: NativeState
  /**
   * The Workspace this Session works in (D8-08), fixed once its agent has started.
   *
   * Null on a Session written before Workspaces were real, which is read as `main`.
   */
  workspaceId: string | null
  /**
   * Whether that Workspace can no longer be changed (D8-08): once its agent has started, its own
   * session was opened in that folder. The engine's rule, which a page reads rather than repeats.
   */
  workspaceFixed: boolean
  archivedAt: number | null
  createdAt: number
  /** When it was last written to — a message or a rename: what the list is sorted on. */
  lastWrittenAt: number
  version: number
}

export interface SessionEntry {
  id: string
  sessionId: string
  /** Its place in the session, counting from one: what the thread is ordered by. */
  seq: number
  role: SessionEntryRole
  /** What this entry is; `message` is the one the user writes. */
  kind: SessionEntryKind
  /** What a one-line reader shows: the text of a message, the title of a call. */
  body: string
  /** What this kind carries, as the JSON text it was written as. */
  payload: string
  /** Whether it was written as it happened, or from what the agent replayed (design D5-08). */
  origin: SessionEntryOrigin
  /** What this entry belongs to — a `messageId`, a `toolCallId` — when it belongs to something. */
  correlationId: string | null
  /** The turn it was written in, when the agent's own turn id is known. */
  turnId: string | null
  /** Where a life goes: `in_progress`, `completed`, `failed`, `cancelled`. */
  state: string | null
  createdAt: number
}

/** What a Session with no message is called, in the interface's own words (design D4b-03). */
export const NEW_SESSION_TITLE = 'New session'

/** Longest proposed title, so the sidebar stays readable. */
export const MAX_TITLE_LENGTH = 60

export class EmptyMessageError extends Error {
  constructor() {
    super('an empty message is not recorded')
    this.name = 'EmptyMessageError'
  }
}

export class EmptyTitleError extends Error {
  constructor() {
    super('a session keeps a name: an empty title is refused')
    this.name = 'EmptyTitleError'
  }
}

export class NoActiveProjectError extends Error {
  constructor() {
    super('a session belongs to a project: select one before creating a session')
    this.name = 'NoActiveProjectError'
  }
}

/**
 * A Session was asked for without the agent it would run.
 *
 * A Session is made with its agent and keeps it for every turn: an agentless Session is one
 * nothing can answer, and it used to be made quietly, which is what left a user with a thread
 * of their own words and no answer at all. Sessions written before the agents existed still
 * hold nothing there and are still read — this is about making one.
 */
export class NoAgentError extends Error {
  constructor() {
    super('Choose an agent first.')
    this.name = 'NoAgentError'
  }
}

/** The text of a message, refusing what carries nothing. */
export function messageBody(candidate: string): string {
  const body = candidate.trim()
  if (body.length === 0) throw new EmptyMessageError()
  return body
}

/**
 * The title a Session is given, refusing what carries nothing.
 *
 * A title the user typed is kept as it is: it is not a proposal, so it is neither derived nor
 * cut, and a name longer than the sidebar is wide is the sidebar's to shorten on screen.
 */
export function sessionTitle(candidate: string): string {
  const title = candidate.trim()
  if (title.length === 0) throw new EmptyTitleError()
  return title
}

/** A title proposed from the first message of a session. */
export function titleFromMessage(body: string): string {
  const firstLine = body.trim().split('\n')[0]!.trim()
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine

  // Cut on a word rather than mid-word, and say the title was cut.
  const cut = firstLine.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > MAX_TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * The title a session takes when a message is recorded.
 *
 * A title the user chose is never replaced by a proposal, and the proposal is made once: a
 * session that already has entries keeps the title it was given.
 */
export function titleAfterMessage(session: Session, body: string, isFirst: boolean): string {
  if (session.titleSource === 'user' || !isFirst) return session.title
  return titleFromMessage(body)
}

export function isArchived(session: Session): boolean {
  return session.archivedAt !== null
}

/** Sessions the current list of the sidebar shows. */
export function currentSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((session) => !isArchived(session))
}

/** Sessions the archived view shows. */
export function archivedSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter(isArchived)
}
