/**
 * The `ticket_read` tool (#95), as the gate executes it once it let a call through.
 *
 * Within a mission (the Planner), it answers the version of the mission's own ticket Hemera
 * stored, with the date it was read and its comments: it never calls the network from inside a
 * turn. Without a mission (the Chat), it reads a ticket of the Project's providers by its key, now.
 * Either way the text is labelled as data written by people.
 */

import { type ToolArguments, parseTicketReference, ticketKeyOf } from '@hemera/core/domain'
import { Effect } from 'effect'

import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { missionTicket, readTicket } from './link.ts'
import { ticketText, unreadTicketText } from './text.ts'

export const ticketRead = (grant: Grant, args: ToolArguments<'ticket_read'>) =>
  Effect.gen(function* () {
    const since = args.comments_since ?? null
    if (since !== null && Number.isNaN(Date.parse(since))) {
      return refusal('refused: comments_since is not a date (ISO 8601)')
    }
    const asked = args.key === undefined ? null : parseTicketReference(args.key)
    if (args.key !== undefined && asked === null) {
      return refusal(`refused: ${args.key} is not a ticket key or URL`)
    }
    if (grant.missionId !== null) {
      const linked = yield* missionTicket(grant.missionId)
      if (linked === null) return refusal('refused: this mission comes from no ticket')
      if (asked !== null && ticketKeyOf(asked).toLowerCase() !== linked.key.toLowerCase()) {
        return refusal(`refused: within a mission you read its own ticket, ${linked.key}`)
      }
      const version = linked.last
      if (version === null) return answered(unreadTicketText(linked.key, linked.url))
      return answered(ticketText(version, { since }))
    }
    if (asked === null) return refusal('refused: name the ticket to read with key')
    const version = yield* readTicket(grant.projectId, asked)
    return answered(ticketText(version, { since }))
  }).pipe(
    Effect.catch((failed) =>
      Effect.succeed(failure(`the ticket could not be read: ${failed.message}`)),
    ),
  )
