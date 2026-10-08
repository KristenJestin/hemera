/**
 * A ticket read after its mission was created (it could not be read then, #95) is delivered to the
 * mission's Planner as `[hemera:ticket]`, which wakes it: the Planner waited for it rather than
 * planning from the ticket's key. It follows the committed `tickets.ticket_read` events.
 */

import { Cause, Effect, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'

import type { DomainEvent } from '../journal.ts'
import { PlannerWake } from '../planning/wake.ts'
import { missionTicket } from './link.ts'
import { ticketText } from './text.ts'

export const TICKET_DELIVERY = 'ticket'

/** Delivers each ticket read for the first time to its mission's Planner. */
export const deliverReadTickets = (committed: Stream.Stream<DomainEvent>, log: Log) =>
  committed.pipe(
    Stream.filter((event) => event.type === 'tickets.ticket_read'),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const linked = yield* missionTicket(event.entityId)
        const version = linked?.base ?? null
        if (version === null) return
        yield* PlannerWake.use((wake) =>
          wake.deliver(event.entityId, TICKET_DELIVERY, ticketText(version, { since: null })),
        )
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            log(`a ticket read was not delivered: ${Cause.pretty(cause).split('\n')[0] ?? ''}`),
          ),
        ),
      ),
    ),
  )
