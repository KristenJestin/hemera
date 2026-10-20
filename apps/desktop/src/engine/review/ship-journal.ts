/**
 * Ship's lines in a mission's Journal (R9): a Ship refused or stopped with its reasons, the proofs
 * and final checks it ran again, and the mission shipped with the trees it froze. The move to
 * Shipping has its own line, `mission.moved`'s.
 */

import { type MemoryAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { DomainEvent, EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'

const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))
const readString = Schema.decodeUnknownOption(Schema.String)

const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

const USER: MemoryAuthor = UserAuthor.make({})

/** Names said one after the other: `a`, `a and b`, `a, b and c`. */
const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`

const line =
  (text: (payload: EventPayload) => string): JournalMapper =>
  (event: DomainEvent) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'ship',
      author: USER,
      text: text(event.payload),
    })

export const SHIP_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map<string, JournalMapper>([
  [
    'mission.ship_refused',
    line((payload) => `Ship refused: ${stringsOf(payload, 'reasons').join(' ')}`),
  ],
  [
    'mission.ship_rerun',
    line((payload) => {
      const ran = [
        ...stringsOf(payload, 'proofs').map((one) => `the proof ${one}`),
        ...stringsOf(payload, 'checks').map((one) => `the final check ${one}`),
      ]
      const red = stringsOf(payload, 'red')
      return `Ship ran again ${listed(ran)}: ${red.length === 0 ? 'green' : `${listed(red)} red`}.`
    }),
  ],
  [
    'mission.shipped',
    line((payload) => {
      const delivered = Option.getOrNull(readString(payload['deliveredAt']))
      return [
        `Shipped: the trees of ${listed(stringsOf(payload, 'repositories'))} are frozen.`,
        ...(delivered === null ? [] : [`Marked as delivered at ${delivered}.`]),
      ].join(' ')
    }),
  ],
])
