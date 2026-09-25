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

/**
 * When something happened, in the lowercase words a Session says it in.
 *
 * The same one answer in the three places it is read — the last Sessions of the Home, the list
 * of what was put away, and the separators of a thread — because a Home saying `today` of what
 * the thread above it calls `yesterday` is two clocks in one window. The count is in days and
 * not in hours, for the same reason the Journal's is: midnight is when a day becomes the day
 * before, whatever hour the writing happened at.
 */
export function whenOf(when: number, now: number = Date.now()): string {
  const days = Math.round(
    (startOf(new Date(now)).getTime() - startOf(new Date(when)).getTime()) / 86_400_000,
  )
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${String(days)} days ago`
  return new Date(when).toLocaleDateString()
}

/** A build's phase, in the words the build view says it in (D10-01). */
const PHASE_WORDS = new Map([
  ['prepare', 'Build getting ready'],
  ['execute', 'Building'],
  ['verify', 'Final checks'],
])

/** Where a check ran: the Workspace root, or the repository's path (D10-06). */
function placeWords(place: string): string {
  return place === '' ? 'at the Workspace root' : `in ${place}`
}

/** What each type of event says, with what its payload adds to it. */
function labelOf(entry: JournalEntry): string {
  const payload = entry.payload
  const said = (key: string): string => String(payload[key] ?? '')
  /** A build task by the label the build names it with. */
  const task = (): string => said('label')
  /** What a sentence adds after a colon when the payload has it, and nothing otherwise. */
  const because = (key: string): string => ((payload[key] ?? null) === null ? '' : `: ${said(key)}`)
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
    case 'session.created':
      return 'Session created'
    case 'session.renamed':
      return `Renamed “${said('from')}” → “${said('to')}”`
    case 'session.message_recorded':
      return 'Message added'
    case 'session.archived':
      return 'Session archived'
    case 'session.restored':
      return 'Session restored'
    case 'session.mission_set':
      return `Mission set to ${said('mission')}`
    // A Spec's steps (D7-13). The phase a step belongs to is a correlation of the event rather
    // than a word of its payload, and it is read from there.
    case 'spec.created':
      return `Spec ${said('key')} “${said('title')}” created`
    case 'spec.joined':
      return payload.writer === true
        ? 'Session opened on the Spec, as its writer'
        : 'Session opened on the Spec, as a reader'
    case 'spec.section_written':
      return `${said('name')} written by ${said('author')} · v${said('version')}`
    case 'spec.stories_written':
      return `Stories written · ${said('stories')}`
    case 'spec.tasks_written':
      return `Tasks written · ${said('tasks')}`
    case 'spec.question_raised':
      return `Question asked: ${said('body')}`
    case 'spec.question_answered':
      return 'Question answered'
    case 'spec.phase_opened':
      return `Phase ${entry.phaseId ?? said('phase')} opened`
    case 'spec.phase_declared':
      return `Phase ${entry.phaseId ?? said('phase')} declared finished`
    case 'spec.phase_finished':
      return `Phase ${entry.phaseId ?? said('phase')} finished`
    case 'spec.phase_stale':
      return `Phase ${entry.phaseId ?? said('phase')} stale`
    case 'spec.attested':
      return 'Contract attested by the agent'
    case 'spec.write_right_transferred':
      return 'Write right taken over'
    case 'spec.ready':
      return `Spec ${said('key')} marked ready`
    case 'spec.reopened':
      return (payload.reason ?? null) === null
        ? `Reworked into revision ${said('number')}`
        : `Reworked into revision ${said('number')}: ${said('reason')}`
    // A build (D10-14), in the plain words of its view: a phase begun, a task moving, a check
    // run and what it said, and the user's pause, resume, accept and stop.
    case 'build.phase_started':
      return PHASE_WORDS.get(said('phase')) ?? `Build ${said('phase')}`
    case 'build.paused':
      return 'Build paused'
    case 'build.resumed':
      return 'Build resumed'
    case 'build.accepted':
      return 'Build accepted'
    case 'build.stopped':
      return `Build stopped${because('reason')}`
    case 'spec.in_progress':
      return 'Spec in progress: its first task started'
    case 'task.ready':
      return `${task()} ready`
    case 'task.started':
      return Number(payload.attempt ?? 1) > 1
        ? `${task()} started again, try ${said('attempt')} of 3`
        : `${task()} started`
    case 'task.finished':
      return `${task()} finished by the agent`
    case 'task.checked':
      if (payload.result !== 'red') return `${task()} checked`
      return (payload.attempt ?? null) === null
        ? `${task()} checked: red`
        : `${task()} checked: red, try ${said('attempt')} of 3`
    case 'task.done':
      return payload.result === 'unverified' ? `${task()} done, not verified` : `${task()} done`
    case 'task.yours':
      // The user's own task, or one whose three tries were red (D10-07).
      return (payload.reason ?? 'human') === 'human'
        ? `${task()} is yours`
        : `${task()} is yours after three red tries`
    case 'task.blocked':
      // The task the agent said contradicts the Spec, with its reason; a dependant, with it.
      return (payload.because ?? null) === null
        ? `${task()} blocked${because('reason')}`
        : `${task()} blocked with ${said('because')}`
    case 'task.skipped':
      return `${task()} skipped${because('reason')}`
    case 'check.ran': {
      // What it judged — a task by its label, a story, or the end — then what it said, and where.
      const about =
        payload.scope === 'story'
          ? 'Story · '
          : payload.scope === 'build'
            ? 'Final checks · '
            : (payload.label ?? null) === null
              ? ''
              : `${said('label')} · `
      const check = `${about}Check “${said('name')}”`
      const where = placeWords(said('place'))
      if (payload.verdict === 'green') return `${check} green ${where}`
      if (payload.verdict === 'skipped') return `${check} skipped ${where}`
      return `${check} red ${where}${because('detail')}`
    }
    case 'check.created':
      return `Check “${said('name')}” added`
    case 'check.updated':
      return `Check “${said('name')}” changed`
    case 'check.removed':
      return `Check “${said('name')}” removed`
    default:
      // An event written by a version that knew more still has a type, and a type read out is
      // more use than a line that says nothing at all.
      return entry.type
  }
}

/**
 * The entity a line is drawn under. The Journal tells a Project, a Session, a Spec and the Profile
 * apart; a Workspace, a command and a launch (D8-16) belong to their Project, and are drawn under
 * it; a build task belongs to the build Session it is built in (D10-14).
 */
function drawnKind(kind: JournalEntry['entityKind']): JournalLine['kind'] {
  if (kind === 'task') return 'session'
  return kind === 'session' || kind === 'profile' || kind === 'spec' ? kind : 'project'
}

/** One entry, as the Journal and the Activity frame draw one. */
export function lineOf(entry: JournalEntry, now = new Date()): JournalLine {
  const at = new Date(entry.occurredAt)
  return {
    sequence: entry.sequence,
    kind: drawnKind(entry.entityKind),
    label: labelOf(entry),
    day: dayOf(at, now),
    time: at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    author: entry.author,
  }
}

export function linesOf(entries: readonly JournalEntry[], now = new Date()): JournalLine[] {
  return entries.map((entry) => lineOf(entry, now))
}
