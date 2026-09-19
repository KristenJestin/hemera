import type { JournalEntry } from '@hemera/ipc'
import type { JournalLine } from '@hemera/ui'

/**
 * What an event of the Journal reads as, in the language and the locale of this window.
 *
 * The one place in the application where a date becomes words. The engine writes an ISO string
 * and the design system draws whatever it is handed — neither of them has a locale, and neither
 * should: a component that formatted a date would carry one into every application that used
 * it, and a database that did would carry one into a file that outlives the machine.
 *
 * What an event says is written here too, from its type and its payload. The type is what the
 * engine will always have; the sentence is what a reader wants, and it changes with the
 * language while the type never does.
 */
const TODAY = 'Today'
const YESTERDAY = 'Yesterday'

/**
 * How a day is named: the two everyone reads as themselves, then a date.
 *
 * The year is said as soon as it is not this one. It is what tells `12 September` of this year
 * from `12 September` of the last, and the Journal groups its entries by the words written
 * here: two days a year apart carrying the same name are one day to whatever reads them.
 */
function dayOf(at: Date, now: Date): string {
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

function startOf(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/** What each type of event says, with what its payload adds to it. */
function labelOf(entry: JournalEntry): string {
  const payload = entry.payload
  const said = (key: string): string => String(payload[key] ?? '')
  switch (entry.type) {
    case 'project.created':
      return `Project “${said('name')}” created`
    case 'project.updated':
      return `Renamed to “${said('name')}”`
    case 'project.main_moved':
      return `Main Workspace moved to ${said('path')}`
    case 'project.archived':
      return 'Project archived'
    case 'project.restored':
      return 'Project restored'
    case 'project.repository_added':
      return `Repository ${said('relativePath')} added`
    case 'project.repository_removed':
      return `Repository ${said('relativePath')} removed`
    case 'profile.opened':
      return `Profile opened by ${said('version')}`
    case 'profile.backed_up':
      return `Profile backed up before ${said('before')}`
    case 'profile.migrated':
      return `Profile migrated to ${said('migration')}`
    default:
      // An event written by a version that knew more still has a type, and a type read out is
      // more use than a line that says nothing at all.
      return entry.type
  }
}

/** One entry, as the Journal and the Activity frame draw one. */
export function lineOf(entry: JournalEntry, now = new Date()): JournalLine {
  const at = new Date(entry.occurredAt)
  return {
    sequence: entry.sequence,
    kind: entry.entityKind,
    label: labelOf(entry),
    day: dayOf(at, now),
    time: at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    author: entry.author,
  }
}

export function linesOf(entries: readonly JournalEntry[], now = new Date()): JournalLine[] {
  return entries.map((entry) => lineOf(entry, now))
}
