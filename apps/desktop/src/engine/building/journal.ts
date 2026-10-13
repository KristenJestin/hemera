/**
 * The pre-launch check's and the launch's lines in a mission's Journal (#139), and the Building's
 * (#141) with its attempts and their verdicts (#142), its checks (#143), its proofs (#144) and its
 * end with the automatic review (#147): each the projection of the domain event written in the same
 * transaction as what it records.
 */

import { REVIEWERS, REVIEWER_NAMES, REVIEW_SEVERITIES } from '@hemera/core/domain'
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

/** What the documenter changed, each file with why. */
const documentedSaid = (payload: EventPayload): string => {
  const whys = stringsOf(payload, 'whys')
  const files = stringsOf(payload, 'files').map((file, at) => `${file} (${whys[at] ?? ''})`)
  return `The documenter updated ${files.join(', ')}.`
}

/** The reviewer an event of the automatic review names. */
const reviewerSaid = (payload: EventPayload): string => {
  const reviewer = REVIEWERS.find((one) => one === payload['reviewer'])
  return reviewer === undefined ? 'a reviewer' : REVIEWER_NAMES[reviewer]
}

/** What a reviewer's pass ended on: its failure, or its findings counted by severity. */
const passEndedSaid = (payload: EventPayload): string => {
  const failed = stringOf(payload, 'failed')
  if (failed !== '') return `The ${reviewerSaid(payload)}'s pass failed: ${failed}.`
  const counts = REVIEW_SEVERITIES.flatMap((severity) => {
    const count = numberOf(payload, severity)
    if (count === 0) return []
    return [`${String(count)} ${severity}${severity === 'blocking' || count === 1 ? '' : 's'}`]
  })
  return `The ${reviewerSaid(payload)} reported ${counts.length === 0 ? 'no finding' : counts.join(', ')}.`
}

/** The verdict of the end's final checks, as the end sequence judged them. */
const finalChecksSaid = (payload: EventPayload): string => {
  const checks = stringsOf(payload, 'checks')
  if (checks.length > 0) return `Final checks: ${checks.join(', ')}.`
  const verdict = stringOf(payload, 'verdict')
  if (verdict === 'green') return 'The final checks are green.'
  if (verdict === 'red') return 'The final checks are red: the Builder fixes them.'
  return 'The final checks: none ran.'
}

/** What an attempt is on: a task, or a requirement's or the end's checks. */
const subjectOf = (payload: EventPayload): string => {
  const task = stringOf(payload, 'task')
  if (task !== '') return task
  const subject = stringOf(payload, 'subject')
  const scope = stringOf(payload, 'scope')
  if (scope === 'proof') return `The proof of ${subject}`
  return scope === 'end' ? 'The end checks' : `The checks of ${subject}`
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
  ['building.final_checks', lineOf(byHemera, finalChecksSaid)],
  [
    'building.end_started',
    lineOf(
      byHemera,
      (payload) =>
        `The end of ${stringOf(payload, 'label')} started: documentation, final checks, then the automatic review.`,
    ),
  ],
  [
    'review.checkpoint_taken',
    lineOf(byHemera, () => 'The checkpoint of the automatic review is taken.'),
  ],
  [
    'review.pass_waiting',
    lineOf(byHemera, (payload) => `The ${reviewerSaid(payload)} waits for a free agent slot.`),
  ],
  [
    'review.pass_started',
    lineOf(byHemera, (payload) => `The ${reviewerSaid(payload)} started its pass.`),
  ],
  ['review.pass_ended', lineOf(agentOrHemera, passEndedSaid)],
  [
    'review.finding_need',
    lineOf(
      byHemera,
      (payload) =>
        `Finding ${String(numberOf(payload, 'finding'))} of the ${reviewerSaid(payload)} contradicts the Spec: the user decides.`,
    ),
  ],
  [
    'review.finding_answered',
    lineOf(
      byUser,
      (payload) =>
        `The user answered finding ${String(numberOf(payload, 'finding'))}: ${stringOf(payload, 'answer')}.`,
    ),
  ],
  [
    'review.special_task',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'task')}, a special task from finding ${String(numberOf(payload, 'finding'))} of the ${reviewerSaid(payload)}: ${stringOf(payload, 'title')}.`,
    ),
  ],
  [
    'building.end_retried',
    lineOf(byUser, () => 'The user asked the end of the Building to try its step again.'),
  ],
  [
    'building.documenter_delta',
    lineOf(
      byHemera,
      (payload) =>
        `The special tasks changed ${stringsOf(payload, 'files').join(', ')} outside the doc recipes: the documenter runs again on them.`,
    ),
  ],
  [
    'building.ended',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'label')} ended: the mission moves to Review; ${String(numberOf(payload, 'changedAfter'))} file(s) changed after the automatic review.`,
    ),
  ],
  [
    'mission.changed_outside',
    lineOf(
      byHemera,
      (payload) => `Changed outside Hemera: ${stringsOf(payload, 'files').join(', ')}`,
    ),
  ],
  [
    'mission.overwritten_by_command',
    lineOf(byHemera, (payload) => {
      const task = stringOf(payload, 'task')
      return `\`${stringOf(payload, 'command')}\`${task === '' ? '' : ` of ${task}`} overwrote a change made outside Hemera to ${stringOf(payload, 'file')}; the user’s version is kept.`
    }),
  ],
  [
    'building.base_moved',
    lineOf(byHemera, (payload) => {
      const targeted = stringsOf(payload, 'targeted')
      return `The base of ${stringOf(payload, 'repository')} moved: ${String(numberOf(payload, 'files'))} file(s) changed, ${targeted.length === 0 ? 'none of them a target' : `${targeted.join(', ')} among the targets`}.`
    }),
  ],
  [
    'service.started',
    lineOf(
      byUser,
      (payload) => `The user started the service \`${stringOf(payload, 'command')}\`.`,
    ),
  ],
  [
    'service.stopped',
    lineOf(
      byUser,
      (payload) => `The user stopped the service \`${stringOf(payload, 'command')}\`.`,
    ),
  ],
  [
    'service.restarted',
    lineOf(
      byUser,
      (payload) => `The user restarted the service \`${stringOf(payload, 'command')}\`.`,
    ),
  ],
  [
    'building.proofs_written',
    lineOf(byHemera, (payload) => {
      const conflicts = stringsOf(payload, 'conflicts')
      return `Hemera wrote the proof tests of ${stringsOf(payload, 'scenarios').join(', ') || 'no scenario'}${conflicts.length === 0 ? '' : `; ${conflicts.join(', ')} conflicted and went to the Builder`}.`
    }),
  ],
  [
    'building.red_recorded',
    lineOf(byHemera, (payload) => `The red of ${stringOf(payload, 'scenario')} is recorded.`),
  ],
  [
    'building.red_mismatch',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'scenario')} fails differently from what Planning saw: the user is asked.`,
    ),
  ],
  [
    'building.already_passes',
    lineOf(
      byHemera,
      (payload) =>
        `${stringOf(payload, 'scenario')} already passes before any task: the user is asked.`,
    ),
  ],
  [
    'building.red_invalid',
    lineOf(
      byHemera,
      (payload) =>
        `The red of ${stringOf(payload, 'scenario')} is not one (${stringOf(payload, 'classification').replaceAll('_', ' ')}): back to the Builder.`,
    ),
  ],
  [
    'building.not_reproducible',
    lineOf(
      byUser,
      (payload) =>
        `The user judged ${stringOf(payload, 'scenario')} not reproducible: its tasks go on.`,
    ),
  ],
  [
    'building.proofs_unproven',
    lineOf(
      byHemera,
      (payload) =>
        `The end waits on ${stringsOf(payload, 'scenarios').join(', ')}, which nothing moves any more: the user is asked.`,
    ),
  ],
  [
    'building.not_proven',
    lineOf(
      byUser,
      (payload) =>
        `The user ended the Building without proving ${stringsOf(payload, 'scenarios').join(', ')}.`,
    ),
  ],
  [
    'building.scenario_green',
    lineOf(byHemera, (payload) => `${stringOf(payload, 'scenario')} is proven: its test passed.`),
  ],
  [
    'building.proof_test_changed',
    lineOf(
      byHemera,
      (payload) =>
        `The proof test of ${stringOf(payload, 'scenario')} changed since its red: ${stringOf(payload, 'path')}.`,
    ),
  ],
  [
    'building.requirement_proven',
    lineOf(byHemera, (payload) => `${stringOf(payload, 'requirement')} is proven.`),
  ],
  [
    'building.proof_stale',
    lineOf(byHemera, (payload) => {
      const stale = [...stringsOf(payload, 'scenarios'), ...stringsOf(payload, 'manual')]
      return `${stringOf(payload, 'repository')} changed: ${stale.join(', ')} to run or verify again.`
    }),
  ],
  [
    'building.proofs_refreshed',
    lineOf(byHemera, (payload) => {
      const proofs = stringsOf(payload, 'proofs')
      const checks = stringsOf(payload, 'checks')
      return `The proofs were refreshed: ${proofs.length === 0 ? 'no proof' : proofs.join(', ')} ran again${checks.length === 0 ? '' : `, and the final checks ${checks.join(', ')}`}.`
    }),
  ],
  [
    'proof.manual_validated',
    lineOf(byUser, (payload) => {
      const note = stringOf(payload, 'note')
      return `The user validated ${stringOf(payload, 'scenario')} by hand${note === '' ? '' : `: ${note}`}.`
    }),
  ],
  [
    'proof.manual_refused',
    lineOf(
      byUser,
      (payload) =>
        `The user refused ${stringOf(payload, 'scenario')} by hand: ${stringOf(payload, 'note')}.`,
    ),
  ],
  ['building.resumed', lineOf(byHemera, () => 'The Building resumed after a restart.')],
  ['building.tasks_done', lineOf(byHemera, () => 'Every task of the plan is done or skipped.')],
  [
    'building.documenter_waiting',
    lineOf(
      byHemera,
      (payload) =>
        `Documentation, pass ${String(numberOf(payload, 'pass'))}, waits for a free agent slot.`,
    ),
  ],
  [
    'building.documenter_started',
    lineOf(
      byHemera,
      (payload) =>
        `The documenter started its ${stringOf(payload, 'mode')} pass ${String(numberOf(payload, 'pass'))}.`,
    ),
  ],
  ['building.documented', lineOf(agentOrHemera, documentedSaid)],
  [
    'building.no_doc_change',
    lineOf(
      agentOrHemera,
      (payload) => `The documentation needs no change: ${stringOf(payload, 'reason')}`,
    ),
  ],
  [
    'building.documenter_failed',
    lineOf(
      byHemera,
      (payload) =>
        `Documentation, pass ${String(numberOf(payload, 'pass'))}, failed: ${stringOf(payload, 'why')}.`,
    ),
  ],
])
