/**
 * Planning's lines in the Journal (#85): the Planner started, the user's vision, the triage answer
 * and the user keeping the mission, one line per Planner turn that wrote the Spec, and each
 * declaration of completeness, refused or recorded. Each is the projection of the domain event
 * written in the same transaction as what it records.
 */

import { TRIAGE_KINDS, type TriageKind } from '@hemera/core/domain'
import { AgentAuthor, HemeraAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { DomainEvent, EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'
import type { JournalDraft } from '../memory/journal.ts'

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const stringOf = (payload: EventPayload, key: string): string | null =>
  Option.getOrNull(readString(payload[key]))

const planner = (event: DomainEvent) =>
  AgentAuthor.make({ role: 'planner', sessionId: stringOf(event.payload, 'sessionId') ?? '' })

const line =
  (draft: (event: DomainEvent) => Omit<JournalDraft, 'missionId'>): JournalMapper =>
  (event) =>
    Effect.succeed({ missionId: event.entityId, ...draft(event) })

const TRIAGE_SAID = {
  existing_mission: 'another mission holds it',
  delivered: 'it is already delivered',
  too_small: 'it is too small for a mission: do it in the Chat',
} satisfies Record<TriageKind, string>

/** A triage kind as a sentence says it. */
const triageSaid = (kind: string): string => {
  const known = TRIAGE_KINDS.find((one) => one === kind)
  return known === undefined ? kind : TRIAGE_SAID[known]
}

export const PLANNING_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  [
    'planning.started',
    line((event) => {
      const agent = stringOf(event.payload, 'agent') ?? 'an agent'
      const model = stringOf(event.payload, 'model')
      return {
        kind: 'planning',
        author: HemeraAuthor.make({}),
        text: `Planning started: the Planner runs on ${agent}${model === null ? '' : ` (${model})`}`,
        fields: { agent, model },
        refs: { session: stringOf(event.payload, 'sessionId') },
      }
    }),
  ],
  [
    'planning.vision',
    line((event) => ({
      kind: 'planning',
      author: UserAuthor.make({}),
      text: `The user gave their vision: ${stringOf(event.payload, 'text') ?? ''}`,
    })),
  ],
  [
    'planning.triaged',
    line((event) => {
      const kind = stringOf(event.payload, 'kind') ?? ''
      const ref = stringOf(event.payload, 'ref')
      return {
        kind: 'planning',
        author: planner(event),
        text: `The Planner answered that ${triageSaid(kind)}${ref === null ? '' : ` (${ref})`}: ${stringOf(event.payload, 'text') ?? ''}`,
        fields: { triage: kind, ref },
      }
    }),
  ],
  [
    'planning.triage_kept',
    line(() => ({
      kind: 'planning',
      author: UserAuthor.make({}),
      text: 'The user kept planning the mission after the triage answer',
    })),
  ],
  [
    'spec.drafted',
    line((event) => ({
      kind: 'spec',
      author: planner(event),
      text: `Spec: ${stringOf(event.payload, 'what') ?? 'written'}`,
    })),
  ],
  [
    'planning.declared_complete',
    line((event) => {
      const version = Option.getOrNull(readNumber(event.payload['version']))
      return {
        kind: 'spec',
        author: planner(event),
        text: `The Planner declared the Spec complete at version ${String(version ?? '?')}: ${stringOf(event.payload, 'why') ?? ''}`,
        fields: { version },
      }
    }),
  ],
  [
    'planning.completeness_refused',
    line((event) => {
      const failures = Option.getOrElse(readStrings(event.payload['failures']), () => [])
      return {
        kind: 'spec',
        author: HemeraAuthor.make({}),
        text: `Hemera refused the Spec as complete: ${failures.join(' ')}`,
        fields: { failures: failures.length },
      }
    }),
  ],
])
