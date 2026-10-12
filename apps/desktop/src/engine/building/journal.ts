/**
 * The pre-launch check's and the launch's lines in a mission's Journal (#139), and the Building's
 * (#141) with its attempts and their verdicts (#142) and its checks (#143): each the projection of the domain event written in the same transaction as what it
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

/** What an attempt is on: a task, or a requirement's or the end's checks. */
const subjectOf = (payload: EventPayload): string => {
  const task = stringOf(payload, 'task')
  if (task !== '') return task
  const subject = stringOf(payload, 'subject')
  return stringOf(payload, 'scope') === 'end' ? 'The end checks' : `The checks of ${subject}`
}

const redSaid = (payload: EventPayload): string => {
  const check = stringOf(payload, 'check')
  const place = stringOf(payload, 'place')
  const where = place === '' ? 'the Workspace root' : place
  return `${subjectOf(payload)} is red${check === '' ? '' : `: ${check} failed in ${where}`}.`
}

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
  [
    'building.attempt_opened',
    lineOf(
      byHemera,
      (payload) =>
        `${subjectOf(payload)}: attempt ${String(numberOf(payload, 'attempt'))} opened after a red.`,
    ),
  ],
  ['building.attempt_red', lineOf(byHemera, redSaid)],
  ['building.attempt_green', lineOf(byHemera, (payload) => `${subjectOf(payload)} is green.`)],
  [
    'building.three_reds',
    lineOf(
      byHemera,
      (payload) => `${subjectOf(payload)} is red for the third time: Hemera asks the user.`,
    ),
  ],
  [
    'building.write_conflict',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'file')} was rewritten by \`${stringOf(payload, 'command')}\` of ${stringOf(payload, 'byTask')} while ${stringOf(payload, 'heldBy') || 'another task'} held it.`,
    ),
  ],
  [
    'building.write_waiting',
    lineOf(agentOrHemera, (payload) => {
      const task = stringOf(payload, 'task')
      return `A write waited ${String(numberOf(payload, 'seconds'))} s for \`${stringOf(payload, 'command')}\`${task === '' ? '' : ` (${task})`}, which writes in ${stringOf(payload, 'repository')}.`
    }),
  ],
  [
    'building.indeterminate',
    lineOf(byHemera, (payload) => {
      const task = stringOf(payload, 'task')
      const told =
        payload['asked'] === true
          ? 'the user is asked whether it ran'
          : 'its runner is told to check the real state'
      return `\`${stringOf(payload, 'command')}\`${task === '' ? '' : ` of ${task}`} was cut by a restart and may have run: ${told}.`
    }),
  ],
  [
    'building.commit',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'task')} committed in ${stringOf(payload, 'repository')}: ${stringOf(payload, 'commit').slice(0, 12)}.`,
    ),
  ],
  [
    'building.checks_ran',
    lineOf(
      byHemera,
      (payload) =>
        `Checks ${stringOf(payload, 'when')}: ${stringOf(payload, 'verdict').replace('_', ' ')}.`,
    ),
  ],
  [
    'building.check_red',
    lineOf(byHemera, (payload) => {
      const place = stringOf(payload, 'place')
      return `${stringOf(payload, 'check')} is red in ${place === '' ? 'the Workspace root' : place}.`
    }),
  ],
  [
    'building.check_waiting',
    lineOf(byHemera, (payload) => {
      const waiting = stringOf(payload, 'waiting')
      return `${stringOf(payload, 'check')} waits for ${waiting === 'permission' ? 'your permission' : waiting}.`
    }),
  ],
  [
    'building.final_checks',
    lineOf(byHemera, (payload) => `Final checks: ${stringsOf(payload, 'checks').join(', ')}.`),
  ],
  ['building.resumed', lineOf(byHemera, () => 'The Building resumed after a restart.')],
  ['building.tasks_done', lineOf(byHemera, () => 'Every task of the plan is done or skipped.')],
])
