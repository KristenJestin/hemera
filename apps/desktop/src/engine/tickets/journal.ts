/**
 * The ticket sync's lines in a mission's Journal (#97): each change found on the ticket, its
 * analysis after the Freeze, the user seeing it, a ticket gone missing; the answers proposed from
 * the ticket's comments, accepted, dismissed or expired; and the writes of a remote Spec into the
 * ticket (#98). Each is the projection of the domain event written in the same transaction as what
 * it records.
 */

import { TICKET_EVENT_KINDS, TICKET_EVENT_SAID } from '@hemera/core/domain'
import { AgentAuthor, HemeraAuthor, type MemoryAuthor, UserAuthor } from '@hemera/ipc'
import { Effect, Option, Schema } from 'effect'

import type { EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'

const readString = Schema.decodeUnknownOption(Schema.String)

const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

const agent = (payload: EventPayload): MemoryAuthor =>
  AgentAuthor.make({ role: stringOf(payload, 'role'), sessionId: stringOf(payload, 'sessionId') })

const lineOf =
  (
    kind: string,
    author: (payload: EventPayload) => MemoryAuthor,
    text: (payload: EventPayload) => string,
  ): JournalMapper =>
  (event) =>
    Effect.succeed({
      missionId: event.entityId,
      kind,
      author: author(event.payload),
      text: text(event.payload),
      fields: { event: stringOf(event.payload, 'event') || null },
    })

/** A change as its line says it: "The ticket's description changed (acme/shop#41)". */
const changeSaid = (payload: EventPayload): string => {
  const kind = TICKET_EVENT_KINDS.find((one) => one === stringOf(payload, 'kind'))
  const said = kind === undefined ? 'The ticket changed' : TICKET_EVENT_SAID[kind]
  const author = stringOf(payload, 'author')
  const status = kind === 'status_changed' ? `: ${stringOf(payload, 'difference')}` : ''
  return `${said}${author === '' ? '' : ` by ${author}`} (${stringOf(payload, 'key')})${status}`
}

export const TICKET_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  ['tickets.changed', lineOf('ticket', () => HEMERA, changeSaid)],
  [
    'tickets.event_analysed',
    lineOf(
      'ticket',
      agent,
      (payload) =>
        `Ticket change analysed: matters to the frozen Spec: ${stringOf(payload, 'matters')}. ${stringOf(payload, 'summary')}`,
    ),
  ],
  [
    'tickets.event_seen',
    lineOf(
      'ticket',
      () => USER,
      (payload) => `Seen by you: ${changeSaid(payload)}`,
    ),
  ],
  [
    'tickets.analysis_failed',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) => `The analysis of the ticket's changes failed: ${stringOf(payload, 'reason')}`,
    ),
  ],
  [
    'tickets.ticket_missing',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) =>
        `${stringOf(payload, 'key')} can no longer be read: ${stringOf(payload, 'message')} Its last known version is kept.`,
    ),
  ],
  [
    'tickets.write_done',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) => `The frozen Spec was written to ${stringOf(payload, 'key')}`,
    ),
  ],
  [
    'tickets.write_waiting',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) =>
        `The Spec waits to be written to ${stringOf(payload, 'key')}: its tracker cannot be reached`,
    ),
  ],
  [
    'tickets.write_failed',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) => stringOf(payload, 'error'),
    ),
  ],
  [
    'tickets.write_dropped',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) => stringOf(payload, 'error'),
    ),
  ],
  [
    'tickets.write_conflict',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) =>
        `${stringOf(payload, 'key')} changed since Hemera last read it: the Spec was not written, and your decision is asked`,
    ),
  ],
  [
    'tickets.write_kept',
    lineOf(
      'ticket',
      () => USER,
      (payload) => `You kept the change of ${stringOf(payload, 'key')}: the Spec was not written`,
    ),
  ],
  [
    'tickets.write_indeterminate',
    lineOf(
      'ticket',
      () => HEMERA,
      (payload) =>
        `Hemera stopped while writing the Spec to ${stringOf(payload, 'key')}: what the ticket holds decides`,
    ),
  ],
  [
    'planning.answer_proposed',
    lineOf(
      'planning',
      agent,
      (payload) =>
        `The Planner proposed an answer to ${stringOf(payload, 'question')} from the ticket's comment ${stringOf(payload, 'comment')}: ${stringOf(payload, 'text')}`,
    ),
  ],
  [
    'planning.proposal_accepted',
    lineOf(
      'planning',
      () => USER,
      (payload) =>
        `The user accepted the proposed answer to ${stringOf(payload, 'question')}${
          stringOf(payload, 'edited') === 'yes' ? ', in their own words' : ''
        }`,
    ),
  ],
  [
    'planning.proposal_dismissed',
    lineOf(
      'planning',
      () => USER,
      (payload) => `The user dismissed the proposed answer to ${stringOf(payload, 'question')}`,
    ),
  ],
  [
    'planning.proposal_expired',
    lineOf(
      'planning',
      () => HEMERA,
      (payload) =>
        `The proposed answer to ${stringOf(payload, 'question')} expired: ${stringOf(payload, 'reason')}`,
    ),
  ],
])
