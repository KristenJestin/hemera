/**
 * The pre-launch check's and the launch's lines in a mission's Journal (#139), and the Building's
 * (#141): each the projection of the domain event written in the same transaction as what it
 * records.
 */

import { AgentAuthor, HemeraAuthor, type MemoryAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const numberOf = (payload: EventPayload, key: string): number =>
  Option.getOrElse(readNumber(payload[key]), () => 0)
const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

const agentOrHemera = (payload: EventPayload): MemoryAuthor => {
  const sessionId = stringOf(payload, 'sessionId')
  return sessionId === ''
    ? HEMERA
    : AgentAuthor.make({ role: stringOf(payload, 'role'), sessionId })
}

const lineOf =
  (
    author: (payload: EventPayload) => MemoryAuthor,
    text: (payload: EventPayload) => string,
  ): JournalMapper =>
  (event) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'building',
      author: author(event.payload),
      text: text(event.payload),
    })

const byHemera = (): MemoryAuthor => HEMERA
const byUser = (): MemoryAuthor => USER

const checkStartedSaid = (payload: EventPayload): string => {
  const blocked = stringsOf(payload, 'blockedBy')
  const moved = numberOf(payload, 'moved')
  const handed = numberOf(payload, 'handed')
  const kind = stringOf(payload, 'kind') === 'mechanical' ? 'A dependency reached Done: the' : 'The'
  return [
    `${kind} pre-launch check read the code of today: ${String(moved)} thing(s) moved since the Freeze`,
    handed > 0 ? `, ${String(handed)} other file(s) handed to the agent of the check` : '',
    blocked.length > 0 ? `; blocked by ${blocked.join(', ')}` : '',
    '.',
  ].join('')
}

const resultSaid = (payload: EventPayload): string => {
  const agent = stringOf(payload, 'agent')
  if (agent === 'unanswered') return 'The agent of the check did not answer.'
  if (agent === 'failed') return 'The agent of the check stopped.'
  const matters = stringsOf(payload, 'matters')
  return `The agent of the check reported: ${matters.length === 0 ? 'nothing else matters' : `${matters.join(', ')} matter`}. ${stringOf(payload, 'summary')}`.trim()
}

export const BUILDING_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  ['building.check_started', lineOf(byHemera, checkStartedSaid)],
  ['building.check_result', lineOf(agentOrHemera, resultSaid)],
  [
    'building.check_expired',
    lineOf(
      byHemera,
      (payload) =>
        `The launch was refused: something moved since the check. ${stringsOf(payload, 'reasons').join(' ')}`,
    ),
  ],
  [
    'building.model_chosen',
    lineOf(
      byUser,
      (payload) =>
        `The Builder's model: ${[stringOf(payload, 'agent'), stringOf(payload, 'model')].filter((one) => one !== '').join(' ')} (${stringOf(payload, 'level')} setting).`,
    ),
  ],
  [
    'building.workspace_preparing',
    lineOf(byHemera, (payload) =>
      payload['resumed'] === true
        ? 'Preparing the Workspace again, from the step that failed.'
        : `Preparing the Workspace on ${stringOf(payload, 'branch')} (${String(numberOf(payload, 'steps'))} steps).`,
    ),
  ],
  ['building.workspace_ready', lineOf(byHemera, () => 'The Workspace is ready.')],
  [
    'building.workspace_failed',
    lineOf(
      byHemera,
      (payload) =>
        `The preparation failed at step ${String(numberOf(payload, 'step'))} of ${String(numberOf(payload, 'of'))}: ${stringOf(payload, 'doing')}`,
    ),
  ],
  [
    'building.workspace_removed',
    lineOf(byHemera, (payload) => {
      const kept = stringsOf(payload, 'kept')
      return kept.length === 0
        ? 'The launch was cancelled: its Workspace and its branch were removed.'
        : `The launch was cancelled: its Workspace was removed; kept ${kept.join('; ')}.`
    }),
  ],
  [
    'building.launched',
    lineOf(
      byUser,
      (payload) =>
        `Launched: Building on ${stringsOf(payload, 'branches').join(', ')}, the validation settings copied (version ${String(numberOf(payload, 'validation'))}).`,
    ),
  ],
  [
    'building.started',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'label')} started with ${String(numberOf(payload, 'tasks'))} task(s).`,
    ),
  ],
  [
    'building.task_available',
    lineOf(byHemera, (payload) => `Available: ${stringsOf(payload, 'tasks').join(', ')}.`),
  ],
  [
    'building.task_started',
    lineOf(
      agentOrHemera,
      (payload) => `${stringOf(payload, 'task')} started: ${stringOf(payload, 'title')}.`,
    ),
  ],
  [
    'building.task_finished',
    lineOf(
      agentOrHemera,
      (payload) => `${stringOf(payload, 'task')} finished: ${stringOf(payload, 'summary')}`,
    ),
  ],
  [
    'building.task_done',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'task')} is done, ${payload['verified'] === true ? 'verified' : 'not verified'}.`,
    ),
  ],
  [
    'building.task_blocked',
    lineOf(byHemera, (payload) => `${stringOf(payload, 'task')} is blocked: a need waits.`),
  ],
  [
    'building.task_skipped',
    lineOf(
      byHemera,
      (payload) => `${stringOf(payload, 'task')} is skipped: ${stringOf(payload, 'reason')}.`,
    ),
  ],
  [
    'building.need_requested',
    lineOf(agentOrHemera, (payload) => {
      const tasks = stringsOf(payload, 'tasks')
      return `The Builder asked the user (${stringOf(payload, 'kind')})${tasks.length === 0 ? '' : `, holding ${tasks.join(', ')}`}.`
    }),
  ],
  [
    'building.decision',
    lineOf(byUser, (payload) => {
      const amendment = stringOf(payload, 'amendment')
      return `Decided: ${stringOf(payload, 'answer')}.${amendment === '' ? '' : ` The plan changed: ${amendment}`}`
    }),
  ],
  ['building.resumed', lineOf(byHemera, () => 'The Building resumed after a restart.')],
  ['building.tasks_done', lineOf(byHemera, () => 'Every task of the plan is done or skipped.')],
])
