/**
 * What a Session is to the design system, and the two rules about its title (design D4b-03).
 *
 * A Session is listed here by the least a row, a frame and a page need to draw it; the engine
 * owns everything else. The title is the one thing the surfaces decide anything about, and
 * only because a title is missing for as long as the first message is: an untitled Session is
 * drawn as `New session` and is renamed like any other.
 *
 * Both rules are functions rather than lines in a component: the sidebar row, the header and
 * the palette all show the same title, and a fallback written three times is three fallbacks.
 */

/** What an untitled Session is called, until its first message names it. */
export const NEW_SESSION_TITLE = 'New session'

/** One archived Session, as the archives page lists it. */
export interface ArchivedSession {
  id: string
  /** Empty while the Session was archived before it was ever written in. */
  title: string
  /** When it was archived, already in words. */
  archivedAt: string
  /** How many messages it kept, when the caller counted them. */
  messages?: number | undefined
}

/** The title to draw, which is the Session's own unless it has none yet. */
export function shownTitle(title: string): string {
  const named = title.trim()
  return named === '' ? NEW_SESSION_TITLE : named
}

/**
 * The title a rename lands on: what was typed, or what was there when nothing was.
 *
 * An empty box is somebody who changed their mind with the keyboard, not somebody asking for a
 * Session with no name — and a Session renamed to nothing would be one the sidebar could no
 * longer tell from the next.
 */
export function committedTitle(typed: string, previous: string): string {
  const wanted = typed.trim()
  return wanted === '' ? previous : wanted
}
