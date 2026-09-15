/**
 * A session: the visible, durable thread of work of a project.
 *
 * A `free` session needs no Spec and no workspace. Its title is proposed from its first
 * message and, once the user has chosen one, no proposal overwrites it. Archiving hides it
 * from the current list and is reversible; nothing deletes it.
 */

export type Mission = 'free'

export interface Session {
  id: string
  projectId: string
  title: string
  /** True once the user renamed it, so no proposal takes the choice back. */
  titleChosen: boolean
  mission: Mission
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  version: number
}

export interface SessionEntry {
  id: string
  sessionId: string
  author: 'human'
  body: string
  rank: string
  createdAt: number
}

/** Title a session without a message carries, recognisable as such. */
export const UNTITLED_SESSION = 'Untitled session'

/** Longest proposed title, so the sidebar stays readable. */
export const MAX_TITLE_LENGTH = 60

export class EmptyMessageError extends Error {
  constructor() {
    super('an empty message is not recorded')
    this.name = 'EmptyMessageError'
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
 * A title the user chose is never replaced by a proposal.
 */
export function titleAfterMessage(session: Session, body: string, isFirst: boolean): string {
  if (session.titleChosen || !isFirst) return session.title
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
