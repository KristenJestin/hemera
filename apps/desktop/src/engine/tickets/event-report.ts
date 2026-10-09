/**
 * `ticket_event_report` (#97), as the gate executes it: the analysis of one event of the session's
 * run, stored on the event; the run done once every event of it has one. Apart from the runs, so
 * the gate imports nothing that imports the sessions back.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { getSession } from '../sessions/store.ts'
import { refusedWhile } from '../storage/database.ts'
import { ticketEventRuns, ticketEvents } from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { type TicketEventRunRow, runOfLineage } from './event-role.ts'
import { projectOfIn } from './versions.ts'

const now = (): string => new Date().toISOString()

/** One of a run's events, about its mission, naming its Project for the window. */
export const runEvent = (
  type: string,
  row: Pick<TicketEventRunRow, 'id' | 'missionId'>,
  projectId: string,
  why?: string,
) =>
  ({
    type,
    entityKind: 'mission',
    entityId: row.missionId,
    source: 'system',
    author: 'hemera',
    payload:
      why === undefined ? { projectId, run: row.id } : { projectId, run: row.id, reason: why },
  }) satisfies NewEvent

/**
 * `ticket_event_report`: the analysis of one event of the session's run, stored on the event; the
 * run done, and its session ended, once every event of it has one.
 */
export const ticketEventReportTool = (grant: Grant, args: ToolArguments<'ticket_event_report'>) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const session = yield* getSession(grant.sessionId)
    const found = yield* runOfLineage(session.lineage)
    if (found === null) return refusal('refused: this session analyses no ticket event')
    return yield* mutate('keeping a ticket event’s analysis', (transaction) =>
      Effect.gen(function* () {
        const no = (sentence: string) => ({ result: refusal(sentence), events: [] })
        const [row] = yield* transaction
          .select()
          .from(ticketEventRuns)
          .where(eq(ticketEventRuns.id, found.id))
          .pipe(Effect.mapError(refusedWhile('reading a ticket-event run')))
        if (row?.state !== 'running') {
          return no(`refused: this analysis already ended (${row?.state ?? 'gone'})`)
        }
        const mine = yield* transaction
          .select()
          .from(ticketEvents)
          .where(eq(ticketEvents.runId, row.id))
          .orderBy(asc(ticketEvents.sequence))
          .pipe(Effect.mapError(refusedWhile('reading the ticket events')))
        const event = mine.find((one) => one.id === args.event.trim())
        if (event === undefined) {
          return no(
            `refused: ${args.event} is not an event of your brief: ${mine.map((one) => one.id).join(', ')}`,
          )
        }
        if (event.summary !== null) return no(`refused: ${event.id} has its report already`)
        const at = now()
        const projectId = yield* projectOfIn(transaction, row.missionId)
        yield* transaction
          .update(ticketEvents)
          .set({
            summary: secrets.mask(args.summary.trim()),
            matters: args.matters,
            why: secrets.mask(args.why.trim()),
            analysedAt: at,
            state: event.state === 'seen' ? 'seen' : 'analysed',
          })
          .where(eq(ticketEvents.id, event.id))
          .pipe(Effect.mapError(refusedWhile('keeping a ticket event’s analysis')))
        const analysed: NewEvent = {
          type: 'tickets.event_analysed',
          entityKind: 'mission',
          entityId: row.missionId,
          source: 'system',
          author: 'agent',
          payload: {
            projectId,
            event: event.id,
            kind: event.kind,
            key: event.key,
            matters: args.matters,
            summary: secrets.mask(args.summary.trim()),
            sessionId: grant.sessionId,
            role: grant.role,
          },
        }
        const left = mine.filter((one) => one.id !== event.id && one.summary === null)
        if (left.length > 0) {
          return {
            result: answered(
              `Kept for ${event.id}. Still to report: ${left.map((one) => one.id).join(', ')}.`,
            ),
            events: [analysed],
          }
        }
        yield* transaction
          .update(ticketEventRuns)
          .set({ state: 'done', endedAt: at })
          .where(eq(ticketEventRuns.id, row.id))
          .pipe(Effect.mapError(refusedWhile('ending a ticket-event run')))
        return {
          result: answered(`Kept for ${event.id}. Every event has its report: your session ends.`),
          events: [analysed, runEvent('tickets.analysis_ended', row, projectId)],
        }
      }),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
