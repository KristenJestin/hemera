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

/** Who wrote an entry. This lot writes the user's alone; an agent answering is HEM-48. */
export type SessionEntryRole = 'user'

export interface Session {
  id: string
  projectId: string
  title: string
  /** `derived` until the user renames it, and `user` from then on. */
  titleSource: SessionTitleSource
  mission: Mission
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
  body: string
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
