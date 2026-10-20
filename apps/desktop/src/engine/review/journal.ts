/**
 * Review's lines in a mission's Journal (#341): each the projection of the domain event written
 * with what it records. An image's line is the evidence store's own (`memory.evidence_added`).
 */

import { HemeraAuthor, type MemoryAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { DomainEvent, EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)

const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const numberOf = (payload: EventPayload, key: string): number | null =>
  Option.getOrNull(readNumber(payload[key]))

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

/** The user, or Hemera bringing a comment of the team from the forge (R8), whose line names it. */
const authorOf = (payload: EventPayload): MemoryAuthor =>
  stringOf(payload, 'authorKind') === 'forge' ? HEMERA : USER

const whoOf = (payload: EventPayload) =>
  stringOf(payload, 'authorKind') === 'forge' ? stringOf(payload, 'authorLogin') : 'The user'

/** Where a comment on the code stands: `api/notes.ts, lines 10–12`. */
const placeSaid = (payload: EventPayload) => {
  const repository = stringOf(payload, 'repository')
  const path = stringOf(payload, 'path')
  const file = repository === '' || repository === '.' ? path : `${repository}/${path}`
  const start = numberOf(payload, 'start')
  const end = numberOf(payload, 'end')
  if (start === null || end === null) return file
  return start === end
    ? `${file}, line ${String(start)}`
    : `${file}, lines ${String(start)}–${String(end)}`
}

/** What a feedback is, as a sentence names it. */
const KIND_WORDS = new Map([
  ['remark', 'a remark'],
  ['code', 'a comment'],
  ['question', 'a question'],
])

const kindSaid = (payload: EventPayload) =>
  KIND_WORDS.get(stringOf(payload, 'kind')) ?? 'a feedback'

const round = (payload: EventPayload) => `round ${String(numberOf(payload, 'round') ?? 0)}`

/** The sentence of a feedback added: what kind, where, in which round, and its body. */
const addedSaid = (payload: EventPayload) => {
  const body = stringOf(payload, 'body')
  const who = whoOf(payload)
  switch (stringOf(payload, 'kind')) {
    case 'code':
      return `${who} commented on ${placeSaid(payload)}, in ${round(payload)}: ${body}`
    case 'question':
      return `${who} asked a question in ${round(payload)}: ${body}`
    default:
      return `${who} wrote a remark in ${round(payload)}: ${body}`
  }
}

const line =
  (
    text: (payload: EventPayload) => string,
    author: (payload: EventPayload) => MemoryAuthor = authorOf,
  ): JournalMapper =>
  (event: DomainEvent) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'review',
      author: author(event.payload),
      text: text(event.payload),
    })

const byHemera = (): MemoryAuthor => HEMERA

export const REVIEW_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map<string, JournalMapper>([
  [
    'review.round_created',
    line(
      (payload) => `Round ${String(numberOf(payload, 'round') ?? 0)} of Review takes feedback.`,
      byHemera,
    ),
  ],
  [
    'review.round_moved',
    line(
      (payload) =>
        `Round ${String(numberOf(payload, 'round') ?? 0)} is ${stringOf(payload, 'to')}.`,
      byHemera,
    ),
  ],
  ['review.feedback_added', line(addedSaid)],
  [
    'review.feedback_edited',
    line(
      (payload) =>
        `${whoOf(payload)} edited ${kindSaid(payload)} of ${round(payload)}: ${stringOf(payload, 'body')}`,
    ),
  ],
  [
    'review.feedback_withdrawn',
    line((payload) => `${whoOf(payload)} withdrew ${kindSaid(payload)} of ${round(payload)}.`),
  ],
  [
    'review.feedback_resolved',
    line((payload) => `${whoOf(payload)} resolved ${kindSaid(payload)} of ${round(payload)}.`),
  ],
  [
    'review.feedback_followed_up',
    line(
      (payload) =>
        `${whoOf(payload)} followed up ${kindSaid(payload)} in ${round(payload)}: ${stringOf(payload, 'body')}`,
    ),
  ],
  [
    'review.feedback_answered',
    line(
      (payload) =>
        `The agent addressed ${kindSaid(payload)} of ${round(payload)}: ${stringOf(payload, 'answer')}`,
      byHemera,
    ),
  ],
  [
    'review.checkpoint_recorded',
    line(
      (payload) =>
        numberOf(payload, 'round') === 0
          ? 'Hemera kept what the user reviews on entering Review.'
          : `Hemera kept what ${round(payload)} left for Review.`,
      byHemera,
    ),
  ],
  // The image's line is the evidence store's.
  ['review.image_added', () => Effect.succeed(null)],
])
