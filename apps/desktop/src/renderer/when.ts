/**
 * When something happened, in the language and the locale of this window.
 *
 * The one place in the application where a date becomes words. The engine writes an ISO string
 * or a number of milliseconds and the design system draws whatever it is handed — neither of
 * them has a locale, and neither should: a component that formatted a date would carry one
 * into every application that used it, and a database that did would carry one into a file
 * that outlives the machine.
 *
 * Two surfaces read it now: the Journal, where a day heads a section, and the thread of a
 * Session, where the same words separate two days of messages. Written twice they would drift
 * apart, and a Journal saying `Today` beside a thread saying `20 September` is one window with
 * two clocks.
 */

const TODAY = 'Today'
const YESTERDAY = 'Yesterday'

/** The day a moment falls on, with the hours taken off it. */
function startOf(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/**
 * How a day is named: the two everyone reads as themselves, then a date.
 *
 * The year is said as soon as it is not this one. It is what tells `12 September` of this year
 * from `12 September` of the last, and both the Journal and a thread group what they show by
 * the words written here: two days a year apart carrying the same name are one day to whatever
 * reads them.
 */
export function dayOf(at: Date, now: Date): string {
  const days = Math.round((startOf(now).getTime() - startOf(at).getTime()) / 86_400_000)
  if (days <= 0) return TODAY
  if (days === 1) return YESTERDAY
  return at.toLocaleDateString(
    undefined,
    at.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' },
  )
}

/** The time of day, written the way the platform writes one. */
export function timeOf(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
