/**
 * The delivery's lines in a mission's Journal (S1): the delivery planned with its repositories and
 * waves, one line per step when it ends (done, already true, failed, stopped, cut off midway),
 * never one per poll, the delivery stopped or retried by the user, and the delivery delivered. The
 * texts are masked where they were written.
 */

import { HemeraAuthor, type MemoryAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { DomainEvent, EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'

const readString = Schema.decodeUnknownOption(Schema.String)
const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const readBoolean = Schema.decodeUnknownOption(Schema.Boolean)

const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

/** Names said one after the other: `a`, `a and b`, `a, b and c`. */
const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const line =
  (text: (payload: EventPayload) => string, author: MemoryAuthor = HEMERA): JournalMapper =>
  (event: DomainEvent) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'delivery',
      author,
      text: text(event.payload),
    })

/** One step as its line names it: `the merge step of api`. */
const stepOf = (payload: EventPayload) =>
  `the ${stringOf(payload, 'step')} step of ${stringOf(payload, 'repository')}`

const endedSaid = (payload: EventPayload): string => {
  const step = stepOf(payload)
  switch (stringOf(payload, 'state')) {
    case 'done':
      return Option.getOrElse(readBoolean(payload['found']), () => false)
        ? `${step} was already done: ${stringOf(payload, 'outcome')}.`
        : `${step} is done: ${stringOf(payload, 'outcome')}.`
    case 'failed':
      return `${step} failed: ${stringOf(payload, 'message')}`
    case 'stopped':
      return `${step} was stopped.`
    default:
      return `${step} was cut off midway: its result is unknown.`
  }
}

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

export const DELIVERY_RUN_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map<
  string,
  JournalMapper
>([
  [
    'delivery.run.started',
    line((payload) => {
      const repositories = Option.getOrElse(readStrings(payload['repositories']), () => [])
      const waves = Option.getOrElse(readNumber(payload['waves']), () => 0)
      const version = Option.getOrElse(readNumber(payload['wavesVersion']), () => 0)
      return repositories.length === 0
        ? `The delivery started, from version ${String(version)} of the waves, with nothing to deliver.`
        : `The delivery started, from version ${String(version)} of the waves: ${listed(repositories)}, in ${waves === 1 ? '1 wave' : `${String(waves)} waves`}.`
    }),
  ],
  ['delivery.run.step_ended', line((payload) => capitalised(endedSaid(payload)))],
  [
    'delivery.run.stopped',
    (event) =>
      line(
        (payload) =>
          event.author === 'human'
            ? 'The user stopped the delivery: what is done stays done.'
            : `The delivery stopped: ${stringOf(payload, 'why')}.`,
        event.author === 'human' ? USER : HEMERA,
      )(event),
  ],
  [
    'delivery.run.retried',
    line((payload) => `The user retried ${stringOf(payload, 'repository')}.`, USER),
  ],
  ['delivery.run.delivered', line(() => 'The delivery is done: every repository is delivered.')],
  // The user's answer is the need's own line.
  ['delivery.run.answered', () => Effect.succeed(null)],
  ['delivery.run.retry_asked', () => Effect.succeed(null)],
  ['delivery.run.stop_asked', () => Effect.succeed(null)],
])
