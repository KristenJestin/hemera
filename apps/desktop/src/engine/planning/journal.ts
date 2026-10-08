/**
 * Planning's lines in the Journal (#85, #86): the Planner started, the user's vision, the triage
 * answer and the user keeping the mission, one line per Planner turn that wrote the Spec, each
 * declaration of completeness, refused or recorded; each wave, answer and waiting mark, each
 * question retired or replaced, each draft, and each input delivered and integrated; #90 adds a
 * proof written, the task graph written with what changed, and the model recommended for Building.
 * Each is the projection of the domain event
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
const readBoolean = Schema.decodeUnknownOption(Schema.Boolean)
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

const numberOf = (payload: EventPayload, key: string): number | null =>
  Option.getOrNull(readNumber(payload[key]))

const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

/** A wave as its line says it: each question's id and text. */
const waveSaid = (payload: EventPayload): string => {
  const texts = stringsOf(payload, 'texts')
  return stringsOf(payload, 'questions')
    .map((id, at) => `${id} ${texts[at] ?? ''}`.trim())
    .join('; ')
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
      // "Already delivered" resting on a proposed requirement is never said as a fact (#93).
      const proposed = Option.getOrElse(readBoolean(event.payload['basedOnProposed']), () => false)
      const named =
        ref === null ? '' : ` (${ref}${proposed ? ', a proposed requirement, not validated' : ''})`
      return {
        kind: 'planning',
        author: planner(event),
        text: `The Planner answered that ${triageSaid(kind)}${named}: ${stringOf(event.payload, 'text') ?? ''}`,
        fields: { triage: kind, ref, basedOnProposed: proposed },
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
    'planning.proof_written',
    line((event) => {
      const scenario = stringOf(event.payload, 'scenario') ?? ''
      const probe = stringOf(event.payload, 'fromProbe')
      return {
        kind: 'spec',
        author: planner(event),
        text: `The Planner wrote the proof of ${scenario}${probe === null ? '' : `, from Probe ${probe}`}`,
        fields: { scenario, probe },
      }
    }),
  ],
  [
    'planning.tasks_written',
    line((event) => {
      const count = Option.getOrElse(readNumber(event.payload['count']), () => 0)
      const listed = (key: string) => Option.getOrElse(readStrings(event.payload[key]), () => [])
      const changes = [
        ['added', listed('added')],
        ['changed', listed('changed')],
        ['removed', listed('removed')],
      ] as const
      const said = changes
        .filter(([, ids]) => ids.length > 0)
        .map(([what, ids]) => `${what} ${ids.join(', ')}`)
        .join('; ')
      return {
        kind: 'spec',
        author: planner(event),
        text: `The Planner wrote the task graph: ${String(count)} task${count === 1 ? '' : 's'}${said === '' ? '' : ` (${said})`}`,
        fields: { count },
      }
    }),
  ],
  [
    'planning.model_recommended',
    line((event) => {
      const agent = stringOf(event.payload, 'agent') ?? ''
      const model = stringOf(event.payload, 'model') ?? ''
      const effort = stringOf(event.payload, 'effort')
      return {
        kind: 'spec',
        author: planner(event),
        text: `The Planner recommends ${[agent, model, ...(effort === null ? [] : [`effort ${effort}`])].join(' · ')} for Building: ${stringOf(event.payload, 'reason') ?? ''}`,
        fields: { agent, model, effort },
      }
    }),
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
    'planning.wave_asked',
    line((event) => {
      const questions = stringsOf(event.payload, 'questions')
      return {
        kind: 'planning',
        author: planner(event),
        text: `The Planner asked wave ${String(numberOf(event.payload, 'number') ?? '?')}: ${waveSaid(event.payload)}`,
        fields: { wave: numberOf(event.payload, 'number'), questions: questions.length },
      }
    }),
  ],
  [
    'planning.answered',
    line((event) => {
      const question = stringOf(event.payload, 'question') ?? '?'
      const version = numberOf(event.payload, 'version')
      return {
        kind: 'planning',
        author: UserAuthor.make({}),
        text: `The user answered ${question}${version === null || version === 1 ? '' : ` again (version ${String(version)})`}: ${stringOf(event.payload, 'answer') ?? ''}`,
        fields: { question, version },
      }
    }),
  ],
  [
    'planning.waiting_on_someone',
    line((event) => {
      const question = stringOf(event.payload, 'question') ?? '?'
      const note = stringOf(event.payload, 'note')
      return {
        kind: 'planning',
        author: UserAuthor.make({}),
        text: `${question} waits on someone${note === null ? '' : `: ${note}`}`,
        fields: { question },
      }
    }),
  ],
  [
    'planning.question_withdrawn',
    line((event) => ({
      kind: 'planning',
      author: planner(event),
      text: `The Planner withdrew ${stringOf(event.payload, 'question') ?? '?'}: ${stringOf(event.payload, 'reason') ?? ''}`,
    })),
  ],
  [
    'planning.question_moot',
    line((event) => ({
      kind: 'planning',
      author: planner(event),
      text: `The Planner said ${stringOf(event.payload, 'question') ?? '?'} is moot (${stringOf(event.payload, 'decision') ?? ''}): ${stringOf(event.payload, 'reason') ?? ''}`,
    })),
  ],
  [
    'planning.question_replaced',
    line((event) => ({
      kind: 'planning',
      author: planner(event),
      text: `The Planner replaced ${stringOf(event.payload, 'question') ?? '?'} by ${stringOf(event.payload, 'by') ?? '?'}`,
    })),
  ],
  [
    'planning.draft_message',
    line((event) => ({
      kind: 'planning',
      author: planner(event),
      text: `The Planner drafted a message for ${stringOf(event.payload, 'question') ?? '?'}, for the user to send`,
    })),
  ],
  [
    'planning.inputs_delivered',
    line((event) => ({
      kind: 'planning',
      author: HemeraAuthor.make({}),
      text: `Delivered to the Planner: ${stringsOf(event.payload, 'ids').join(', ')}`,
    })),
  ],
  [
    'planning.input_integrated',
    line((event) => ({
      kind: 'spec',
      author: planner(event),
      text: `The Planner integrated ${stringOf(event.payload, 'id') ?? '?'}: ${stringOf(event.payload, 'where') ?? ''}`,
    })),
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
