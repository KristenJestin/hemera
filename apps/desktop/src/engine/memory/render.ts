/**
 * The Memory as text: the same words for the brief an agent starts with, the answers of
 * `memory_read`, and the markdown files people and tools read. Hemera's own words are in English;
 * what an agent wrote is shown as it wrote it.
 */

import { type Ball, ROLE_NAMES, ROLES } from '@hemera/core/domain'
import type { JournalLine, MemoryAuthor, MemoryNote, Now } from '@hemera/ipc'
import { Match } from 'effect'

import { capitalised } from './now.ts'

const roleSaid = (role: string): string => {
  const known = ROLES.find((one) => one === role)
  return known === undefined ? role : capitalised(ROLE_NAMES[known])
}

const ballSaid = Match.type<Ball>().pipe(
  Match.tagsExhaustive({
    AgentWorking: () => 'an agent is working',
    WaitingOnYou: () => 'waiting on the user',
    WaitingOnSomeone: () => 'waiting on someone else',
    Blocked: () => 'blocked',
    Idle: () => 'nobody is working on it',
  }),
)

export const authorSaid = (author: MemoryAuthor): string =>
  Match.value(author).pipe(
    Match.tagsExhaustive({
      Hemera: () => 'Hemera',
      User: () => 'the user',
      Agent: (agent) => roleSaid(agent.role),
    }),
  )

const list = (items: ReadonlyArray<string>): string => items.map((item) => `- ${item}`).join('\n')

/** Now, a heading per part that has something in it. */
export function nowText(now: Now): string {
  const parts = [
    `${now.key}: ${capitalised(now.stage)}${now.round > 0 ? `, round ${String(now.round)}` : ''}${
      now.ball === null ? '' : `; ${ballSaid(now.ball)}`
    }`,
  ]
  if (now.marks.length > 0) parts.push(`Marks:\n${list(now.marks)}`)
  if (now.waiting.length > 0) {
    parts.push(
      `Waiting on the user:\n${list(now.waiting.map((need) => `${need.kind}: ${need.sentence}`))}`,
    )
  }
  if (now.running.length > 0) {
    parts.push(`Running:\n${list(now.running.map((session) => roleSaid(session.role)))}`)
  }
  if (now.next !== null) parts.push(`Next: ${now.next.text}`)
  if (now.doing.length > 0) {
    parts.push(`Doing:\n${list(now.doing.map((line) => `${roleSaid(line.role)}: ${line.text}`))}`)
  }
  return parts.join('\n\n')
}

/** A note as one line: its number, its topic, its text, and what replaced it. */
export const noteText = (note: MemoryNote): string =>
  `${String(note.number)}. ${note.topic === null ? '' : `[${note.topic}] `}${note.text}${
    note.replacedBy === null ? '' : ` (replaced by note ${String(note.replacedBy)})`
  }`

export const notesText = (notes: ReadonlyArray<MemoryNote>): string =>
  notes.map(noteText).join('\n')

/** A Journal line as one line: its number, when, who, and what. */
export const lineText = (line: JournalLine): string =>
  `${String(line.sequence)} · ${line.at.slice(0, 16).replace('T', ' ')} · ${authorSaid(line.author)}: ${line.text}`

/** Lines in the order given, one per line. */
export const linesText = (lines: ReadonlyArray<JournalLine>): string =>
  lines.map(lineText).join('\n')

/** Sections under their headings, an empty one left out. */
export const sections = (parts: ReadonlyArray<readonly [string, string]>): string =>
  parts
    .filter(([, body]) => body.trim() !== '')
    .map(([heading, body]) => `## ${heading}\n\n${body}`)
    .join('\n\n')
