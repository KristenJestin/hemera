/**
 * The delivery's lines in a mission's Journal (R6): each the projection of the domain event
 * written with what it records. The preparation copied, a commit, a push, a pull request opened, a
 * step that failed with its message (masked when it was written).
 */

import { HemeraAuthor, type MemoryAuthor } from '@hemera/ipc'
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

/** A commit as a line names it: its first seven characters. */
const short = (payload: EventPayload) => stringOf(payload, 'commit').slice(0, 7)

/** The section of the rules a copy holds, as a sentence names it. */
const SECTIONS = new Map([
  ['tasks', 'After each task'],
  ['preparation', 'the preparation'],
  ['waves', 'the waves'],
  ['end', 'the End'],
])

const line =
  (text: (payload: EventPayload) => string): JournalMapper =>
  (event: DomainEvent) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'delivery',
      author: HEMERA,
      text: text(event.payload),
    })

export const DELIVERY_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map<string, JournalMapper>([
  [
    'delivery.rules_copied',
    (event) =>
      event.entityKind === 'mission'
        ? line(
            (payload) =>
              `Hemera copied ${SECTIONS.get(stringOf(payload, 'section')) ?? 'a section'} of the delivery rules, at version ${String(numberOf(payload, 'version') ?? 0)}.`,
          )(event)
        : Effect.succeed(null),
  ],
  [
    'delivery.committed',
    line((payload) => `Hemera committed ${stringOf(payload, 'repository')} as ${short(payload)}.`),
  ],
  [
    'delivery.pushed',
    line(
      (payload) =>
        `Hemera pushed ${stringOf(payload, 'repository')} at ${short(payload)} to ${stringOf(payload, 'remote')}/${stringOf(payload, 'branch')}.`,
    ),
  ],
  [
    'delivery.pull_request_opened',
    line(
      (payload) =>
        `Hemera opened the pull request of ${stringOf(payload, 'repository')}: ${stringOf(payload, 'url')}`,
    ),
  ],
  [
    'delivery.step_failed',
    line((payload) =>
      stringOf(payload, 'state') === 'indeterminate'
        ? `Hemera could not read how the ${stringOf(payload, 'step')} step of ${stringOf(payload, 'repository')} ended: ${stringOf(payload, 'message')}`
        : `The ${stringOf(payload, 'step')} step of ${stringOf(payload, 'repository')} failed: ${stringOf(payload, 'message')}`,
    ),
  ],
  // The user's answer is the need's own line.
  ['delivery.answered', () => Effect.succeed(null)],
])
