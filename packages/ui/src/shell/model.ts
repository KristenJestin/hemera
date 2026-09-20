import stylesheet from '../theme.css?raw'

/**
 * What the shell is given and what it is bounded by (design D2-01, D2-03).
 *
 * The shell holds no data of its own: a Project and a Session are described here by the least
 * a bar and a list need to draw them, and the application hands over whatever it has — five
 * fixtures in this lot, a database in lot 4. Nothing here knows either.
 *
 * The bounds are read out of the theme rather than written twice. A width is a size, sizes
 * live in the theme, and the one number the shell needs in JavaScript is the same number the
 * stylesheet is drawn from — the way the main process already reads its window colours.
 */

/**
 * The colour a Project is told apart by: a tone of the theme, never a colour.
 *
 * The design system is a leaf — it imports nothing of Hemera — so the list is written here and
 * in the domain both, and an application test is what holds the two to the same five names.
 */
export const PROJECT_TONES = ['primary', 'info', 'success', 'warning', 'neutral'] as const

export type ProjectTone = (typeof PROJECT_TONES)[number]

export interface ShellProject {
  id: string
  name: string
  tone: ProjectTone
  /** How many things in this Project want the user. Nothing is drawn at zero. */
  pending: number
}

/**
 * One Session of the active Project, as the sidebar lists it and the Home frame shows it.
 *
 * The title is the Session's own and is empty for as long as no message has named it: what is
 * drawn in its place is `shownTitle`'s business and not the caller's (design D4b-03). The three
 * that follow are already in words — a relative time is read off a clock and a locale, neither
 * of which the design system has any business holding.
 */
export interface ShellSession {
  id: string
  title: string
  /** When it was last written in, already in words. */
  writtenAt?: string | undefined
  /** The first line of what it holds, for the frame that shows more than a title. */
  preview?: string | undefined
  /** How many messages it holds, when the caller counted them. */
  messages?: number | undefined
}

/** The entries of the sidebar that are not Sessions, named so a caller can select them. */
export const HOME_ENTRY = 'home'
export const JOURNAL_ENTRY = 'journal'
export const PROJECT_SETTINGS_ENTRY = 'project-settings'

/** The page's own root size, which nothing in the application changes. */
const ROOT_FONT_SIZE = 16

function spacing(name: string): number {
  const found = new RegExp(String.raw`--spacing-${name}\s*:\s*([\d.]+)rem;`).exec(stylesheet)
  if (found === null) throw new Error(`the theme declares no --spacing-${name}`)
  return Number(found[1]) * ROOT_FONT_SIZE
}

/** The narrowest the sidebar opens at. */
export const SIDEBAR_MIN = spacing('sidebar-min')
/** The widest it opens at. */
export const SIDEBAR_MAX = spacing('sidebar-max')
/** What it opens at when nobody has said otherwise. */
export const SIDEBAR_DEFAULT = spacing('sidebar')
/** What it folds down to, which is the width of an icon and the room around it. */
export const SIDEBAR_RAIL = spacing('sidebar-rail')
/** How narrow a drag has to go before folding is what it means. */
export const SIDEBAR_COLLAPSE = spacing('sidebar-collapse')

/** How far one press of an arrow moves the separator: one line of text. */
export const SIDEBAR_STEP = ROOT_FONT_SIZE

/** A width the shell was handed, and what was wrong with it when something was. */
export interface CheckedWidth {
  width: number
  /** What the shell says out loud about the correction, or nothing when there was none. */
  correction: string | null
}

/**
 * The width to open at, given the one asked for.
 *
 * Out of bounds goes back to the default rather than to the nearest bound: a width nobody
 * could have chosen is a mistake in whatever produced it, and landing on the default says so,
 * where clamping would hide it behind something that looks deliberate.
 */
export function checkedWidth(asked: number): CheckedWidth {
  if (asked >= SIDEBAR_MIN && asked <= SIDEBAR_MAX) return { width: asked, correction: null }
  return {
    width: SIDEBAR_DEFAULT,
    correction: `a sidebar width of ${asked}px is outside ${SIDEBAR_MIN}–${SIDEBAR_MAX}; the shell opened at ${SIDEBAR_DEFAULT}px`,
  }
}

/** The width a drag lands on: here the bounds hold it in place, they do not send it home. */
export function clampedWidth(asked: number): number {
  return Math.min(Math.max(asked, SIDEBAR_MIN), SIDEBAR_MAX)
}
