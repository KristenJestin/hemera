import type { JournalEntry } from '@hemera/ipc'
import type { JournalLine } from '@hemera/ui'

import { dayOf, timeOf } from './when.ts'

/**
 * What an event of the Journal reads as, in the language of this window.
 *
 * What an event says is written here, from its type and its payload. The type is what the
 * engine will always have; the sentence is what a reader wants, and it changes with the
 * language while the type never does. When it happened becomes words in `when.ts`, which the
 * thread of a Session reads as well.
 *
 * An event about a Session carries somewhere to go: the line opens the Session it is about,
 * archived or not — an archived one arrives with its whole thread and the `Restore` of its
 * header, which is the way back the Journal offers (design D4b-06).
 */
const SESSION_TARGET = 'Open the Session'

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
    case 'session.created':
      return `Session created · ${said('title')}`
    case 'session.renamed':
      return `Session renamed to “${said('title')}”`
    case 'session.message_recorded':
      return 'Message recorded'
    case 'session.archived':
      return 'Session archived'
    case 'session.restored':
      return 'Session restored'
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

/** What the window can do about an entry, which for a Session is to open it. */
export interface LineActions {
  onOpenSession?: ((sessionId: string) => void) | undefined
}

/** One entry, as the Journal and the Activity frame draw one. */
export function lineOf(
  entry: JournalEntry,
  now = new Date(),
  actions: LineActions = {},
): JournalLine {
  const at = new Date(entry.occurredAt)
  const line: JournalLine = {
    sequence: entry.sequence,
    kind: entry.entityKind,
    label: labelOf(entry),
    day: dayOf(at, now),
    time: timeOf(at),
    author: entry.author,
  }
  const open = actions.onOpenSession
  if (entry.entityKind !== 'session' || open === undefined) return line
  return { ...line, target: { label: SESSION_TARGET, onOpen: () => open(entry.entityId) } }
}

export function linesOf(
  entries: readonly JournalEntry[],
  now = new Date(),
  actions: LineActions = {},
): JournalLine[] {
  return entries.map((entry) => lineOf(entry, now, actions))
}
