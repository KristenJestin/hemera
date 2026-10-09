/**
 * The ticket sync (#97): one grouped check per Project, at its interval (an hour by default, five
 * minutes at least), and a catch-up of every Project once automations may run: right after the
 * engine starts, or after a restore's reconciliation when there was one (CT-08). No webhooks.
 *
 * - **Watched.** The tickets of a Project's live missions (Planning, Ready, Building, Review,
 *   Shipping) while the Project is in linked or remote mode (#98). A Done, cancelled or archived mission is not.
 * - **Grouped.** Each provider of the Project asks once which of its tickets moved since their last
 *   known version (`changedSince`, one request per host or site, batched), on its own: one that
 *   fails is signalled once (#95's `observed`) and the others go on. Only the tickets that moved
 *   are read in full, then kept (`events.ts`), one transaction each. A ticket not read yet is read.
 * - **Never overlapping.** Two checks of one Project run one after the other.
 * - **The last check** is the date of the last one every provider answered; a Project in local
 *   mode watches nothing and keeps none.
 * - **Retries.** A check that fails is tried again at the next interval, never in a tight loop.
 *
 * What a check found is handed over once committed: the Planner's inputs to the Planner, the
 * analyses to the `ticket-event` runs, which follow their own events.
 */

import {
  DEFAULT_SYNC_MINUTES,
  LIVE_STAGES,
  type KnownTicket,
  TicketErrorSchema,
  parseTicketReference,
  syncIntervalRefusal,
} from '@hemera/core/domain'
import { InvalidSyncInterval, type UnknownMission, UnknownProject } from '@hemera/ipc'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Queue,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import type { EventPayload } from '../journal.ts'
import { AutomationGate } from '../gate.ts'
import { Memory } from '../memory/index.ts'
import { deliverInputs } from '../planning/calls.ts'
import { PlannerWake } from '../planning/wake.ts'
import type { Secrets } from '../secrets.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { missionTickets, missions, projects, ticketVersions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import {
  HANDED_KINDS,
  TICKET_DATA_LABEL,
  TICKET_EVENT_DELIVERY,
  keepVersion,
  quoted,
  ticketMissing,
} from './events.ts'
import { observed } from './link.ts'
import { isOutage } from './provider.ts'
import { type LiveProvider, TicketProviders } from './search.ts'
import { getProvider } from './store.ts'

const isTicketError = Schema.is(TicketErrorSchema)

/** A watched mission's ticket: the mission, its provider, its key and the last known date. */
interface Watched {
  readonly missionId: string
  readonly providerId: string
  readonly reference: string
  readonly key: string
  readonly url: string | null
  /** The remote update date of its last known version; null while it was never read. */
  readonly updatedAt: string | null
  /** Since when the provider has not found it; null while it is found. */
  readonly missingSince: string | null
}

/** What one check came to. */
export interface CheckOutcome {
  /** Every provider answered. */
  readonly complete: boolean
  /** The missions whose ticket moved. */
  readonly moved: ReadonlyArray<string>
}

const readText = Schema.decodeUnknownOption(Schema.String)

/**
 * A changed status as the Planner is told it in Planning: information, never an input; it blocks
 * nothing and has nothing to integrate. The wordings, written by people, are quoted as data.
 */
const statusSaid = (payload: EventPayload): string => {
  const text = (key: string) => Option.getOrElse(readText(payload[key]), () => '')
  return [
    `Ticket event ${text('event')} on ${text('key')}: the ticket’s status changed.`,
    TICKET_DATA_LABEL,
    quoted(text('difference')),
    'Information only: nothing to integrate. Mention it only if it changes the work (the ticket was closed as not planned, for example).',
  ].join('\n')
}

/** The interval of a Project, in minutes. */
export const syncIntervalOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ minutes: projects.ticketSyncMinutes })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    if (row === undefined) return yield* new UnknownProject({ id: projectId })
    return row.minutes
  })

/** When the last check of a Project's tickets succeeded with every provider; null before. */
export const lastCheckOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ at: projects.ticketsCheckedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    if (row === undefined) return yield* new UnknownProject({ id: projectId })
    return row.at
  })

/** Sets a Project's interval: five minutes at least, for the trackers' rate limits. */
export const setSyncIntervalIn = (projectId: string, minutes: number) =>
  Effect.gen(function* () {
    const refused = syncIntervalRefusal(minutes)
    if (refused !== null) return yield* new InvalidSyncInterval({ reason: refused })
    return yield* mutate('setting the sync interval', (transaction) =>
      Effect.gen(function* () {
        const [row] = yield* transaction
          .update(projects)
          .set({ ticketSyncMinutes: minutes })
          .where(eq(projects.id, projectId))
          .returning({ id: projects.id })
          .pipe(Effect.mapError(refusedWhile('writing the sync interval')))
        if (row === undefined) return yield* new UnknownProject({ id: projectId })
        return {
          result: minutes,
          events: [
            {
              type: 'tickets.sync_interval_set',
              entityKind: 'project',
              entityId: projectId,
              source: 'ui' as const,
              author: 'human' as const,
              payload: { minutes },
            },
          ],
        }
      }),
    )
  })

/**
 * The tickets of a Project's live missions, when the Project watches them (linked and remote
 * mode); null when it watches none (local mode).
 */
const watchedOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [project] = yield* database
      .select({ mode: projects.specMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    if (project?.mode !== 'linked' && project?.mode !== 'remote') return null
    const rows = yield* database
      .select({
        missionId: missions.id,
        providerId: missionTickets.providerId,
        reference: missions.ticketReference,
        key: missions.ticketKey,
        url: missions.ticketUrl,
        updatedAt: ticketVersions.updatedAt,
        missingSince: missionTickets.missingSince,
      })
      .from(missionTickets)
      .innerJoin(missions, eq(missions.id, missionTickets.missionId))
      .leftJoin(ticketVersions, eq(ticketVersions.id, missionTickets.lastVersionId))
      .where(
        and(
          eq(missions.projectId, projectId),
          inArray(missions.stage, [...LIVE_STAGES]),
          isNotNull(missionTickets.providerId),
          isNotNull(missions.ticketReference),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('reading the watched tickets')))
    return rows.flatMap((row): ReadonlyArray<Watched> =>
      row.providerId === null || row.reference === null
        ? []
        : [
            {
              missionId: row.missionId,
              providerId: row.providerId,
              reference: row.reference,
              key: row.key ?? row.reference,
              url: row.url,
              updatedAt: row.updatedAt,
              missingSince: row.missingSince,
            },
          ],
    )
  })

/** The reference a watched ticket is read by: its URL when it has one, its key otherwise. */
const referenceOf = (one: Watched) => parseTicketReference(one.url ?? one.key)

/** What a check found moved. */
interface Followed {
  readonly moved: string[]
}

/**
 * One provider's part of a check: the grouped question, then each ticket that moved read and kept.
 * Answers whether the provider answered; a failure of the data folder ends the check.
 */
const checkProvider = (live: LiveProvider, watched: ReadonlyArray<Watched>, followed: Followed) =>
  Effect.gen(function* () {
    const known: KnownTicket[] = []
    const byReference = new Map<string, Watched>()
    // Read in full at every check: a ticket never read yet, and one said missing, which may come
    // back unchanged (its update date the same), so it is said again if it goes missing again.
    const unread: Watched[] = []
    for (const one of watched) {
      const reference = referenceOf(one)
      if (reference === null) continue
      byReference.set(one.reference, one)
      if (one.updatedAt === null || one.missingSince !== null) unread.push(one)
      else known.push({ reference, updatedAt: one.updatedAt })
    }
    /**
     * Reads a ticket in full and keeps it; false when the provider is out of reach. A ticket the
     * provider answers but cannot give (not found, forbidden, unreadable) is said once on its
     * mission, as a missing one, and read again at the next check.
     */
    const readAndKeep = (one: Watched) =>
      Effect.gen(function* () {
        const reference = referenceOf(one)
        if (reference === null) return true
        const read = yield* Effect.result(observed(live, live.provider.read(reference)))
        if (Result.isFailure(read)) {
          if (!isTicketError(read.failure)) return yield* Effect.fail(read.failure)
          if (isOutage(read.failure)) return false
          yield* ticketMissing(one.missionId, one.key, read.failure.message)
          return true
        }
        const kept = yield* keepVersion(one.missionId, live.info.id, read.success)
        if (kept.events.length > 0) followed.moved.push(one.missionId)
        return true
      })
    if (known.length > 0) {
      const asked = yield* Effect.result(observed(live, live.provider.changedSince(known)))
      if (Result.isFailure(asked)) {
        if (!isTicketError(asked.failure)) return yield* Effect.fail(asked.failure)
        return false
      }
      for (const change of asked.success) {
        const one = byReference.get(change.reference)
        if (one === undefined) continue
        if (Predicate.isTagged(change, 'Missing')) {
          yield* ticketMissing(one.missionId, one.key, change.error.message)
          continue
        }
        if (!(yield* readAndKeep(one))) return false
      }
    }
    for (const one of unread) {
      if (!(yield* readAndKeep(one))) return false
    }
    return true
  })

/**
 * One check of a Project: every provider on its own, at once; then, when every one answered, the
 * date of this check kept as its last.
 */
export const checkProject = (projectId: string) =>
  Effect.gen(function* () {
    const watched = yield* watchedOf(projectId)
    // A Project in local mode watches nothing: there is no check to keep.
    if (watched === null) {
      const nothing: CheckOutcome = { complete: true, moved: [] }
      return nothing
    }
    const providers = yield* TicketProviders
    const followed: Followed = { moved: [] }
    const ids = [...new Set(watched.map((one) => one.providerId))]
    const answered = yield* Effect.forEach(
      ids,
      (providerId) =>
        Effect.gen(function* () {
          const info = yield* getProvider(providerId).pipe(
            Effect.catchTag('UnknownTicketProvider', () => Effect.succeed(null)),
          )
          if (info === null) return true
          const live: LiveProvider = { info, provider: yield* providers.of(info) }
          return yield* checkProvider(
            live,
            watched.filter((one) => one.providerId === providerId),
            followed,
          )
        }),
      { concurrency: 'unbounded' },
    )
    const complete = answered.every((one) => one)
    if (complete) {
      const at = yield* Clock.currentTimeMillis
      yield* mutate('keeping the last check', (transaction) =>
        Effect.gen(function* () {
          yield* transaction
            .update(projects)
            .set({ ticketsCheckedAt: new Date(at).toISOString() })
            .where(eq(projects.id, projectId))
            .pipe(Effect.mapError(refusedWhile('keeping the last check')))
          return {
            result: undefined,
            events: [
              {
                type: 'tickets.checked',
                entityKind: 'project',
                entityId: projectId,
                source: 'system' as const,
                author: 'hemera' as const,
                payload: { projectId, moved: followed.moved.length },
              },
            ],
          }
        }),
      )
    }
    const outcome: CheckOutcome = { complete, moved: [...new Set(followed.moved)] }
    return outcome
  })

/** One Project as the schedule reads it: its interval. */
export interface Scheduled {
  readonly projectId: string
  readonly minutes: number
}

/**
 * The schedule: every Project checked at once (the catch-up), then each again once its interval
 * has passed since its last attempt, a failed one included, so nothing retries in a tight loop.
 * Between two checks it sleeps until the next one is due, or until an interval changes. A round
 * that fails (the Projects could not be read) is said, and the schedule sleeps the default
 * interval before the next: it never stops until the engine does.
 */
export const syncSchedule = <E, R, E2, R2>(asked: {
  readonly projects: Effect.Effect<ReadonlyArray<Scheduled>, E, R>
  readonly check: (projectId: string) => Effect.Effect<void, E2, R2>
  readonly changed: Effect.Effect<void>
  readonly failed?: (cause: Cause.Cause<E | E2>) => Effect.Effect<void>
}) =>
  Effect.gen(function* () {
    const attempted = new Map<string, number>()
    const longest = Duration.toMillis(Duration.minutes(DEFAULT_SYNC_MINUTES))
    const round = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const scheduled = yield* asked.projects
      const due = scheduled.filter((one) => {
        const last = attempted.get(one.projectId)
        return last === undefined || now - last >= Duration.toMillis(Duration.minutes(one.minutes))
      })
      for (const one of due) attempted.set(one.projectId, now)
      yield* Effect.forEach(due, (one) => asked.check(one.projectId), {
        concurrency: 'unbounded',
        discard: true,
      })
      const after = yield* Clock.currentTimeMillis
      const waits = scheduled.map((one) => {
        const last = attempted.get(one.projectId) ?? after
        return last + Duration.toMillis(Duration.minutes(one.minutes)) - after
      })
      return Math.max(0, Math.min(longest, ...waits))
    })
    for (;;) {
      const wait = yield* round.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.as(asked.failed?.(cause) ?? Effect.void, longest),
        ),
      )
      yield* Effect.raceFirst(Effect.sleep(Duration.millis(wait)), asked.changed)
    }
  })

export class TicketSync extends Context.Service<
  TicketSync,
  {
    /** One check of a Project now, after the one running, if any. */
    readonly check: (
      projectId: string,
    ) => Effect.Effect<CheckOutcome, DatabaseError | UnknownMission>
    /** Sets a Project's interval; the schedule follows it at once. */
    readonly setInterval: (
      projectId: string,
      minutes: number,
    ) => Effect.Effect<number, DatabaseError | UnknownProject | InvalidSyncInterval>
  }
>()('TicketSync') {}

export interface TicketSyncSettings {
  readonly log: Log
  /** Whether the schedule runs: the catch-up, then every interval. On unless a suite says. */
  readonly schedules?: boolean | undefined
}

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | TicketProviders
  | PlannerWake
  | AutomationGate
  | Memory

export const ticketSyncLayer = (settings: TicketSyncSettings) =>
  Layer.effect(
    TicketSync,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => settings.log(`ticket sync: ${line}`))
      const locks = new Map<string, Semaphore.Semaphore>()
      const lockOf = (projectId: string) => {
        const found = locks.get(projectId)
        if (found !== undefined) return found
        const made = Semaphore.makeUnsafe(1)
        locks.set(projectId, made)
        return made
      }
      const check = (projectId: string) =>
        Semaphore.withPermits(lockOf(projectId), 1)(run(checkProject(projectId)))
      const changes = yield* Queue.sliding<void>(1)
      const setInterval = (projectId: string, minutes: number) =>
        Effect.tap(run(setSyncIntervalIn(projectId, minutes)), () =>
          Queue.offer(changes, undefined),
        )

      const gate = yield* AutomationGate
      const memory = yield* Memory
      // A change handed to a Planner in Planning, from a check or any read (#95's ticket_read):
      // its inputs go to the Planner once committed, which wakes it (CT-28). Followed from now,
      // handed over once automations may run.
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      yield* gate.pass.pipe(
        Effect.andThen(
          committed.pipe(
            Stream.filter(
              (event) => event.type === 'tickets.changed' && event.payload['stage'] === 'planning',
            ),
            Stream.runForEach((event) =>
              run(
                event.payload['kind'] === 'status_changed'
                  ? PlannerWake.use((wake) =>
                      wake.deliver(
                        event.entityId,
                        TICKET_EVENT_DELIVERY,
                        statusSaid(event.payload),
                      ),
                    )
                  : HANDED_KINDS.some((kind) => kind === event.payload['kind'])
                    ? deliverInputs(event.entityId)
                    : Effect.void,
              ).pipe(
                Effect.catchCause((cause) =>
                  said(`a ticket event was not handed to the Planner: ${String(cause)}`),
                ),
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      )
      if (settings.schedules !== false) {
        const scheduled = Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database
            .select({ projectId: projects.id, minutes: projects.ticketSyncMinutes })
            .from(projects)
            .pipe(Effect.mapError(refusedWhile('reading the Projects')))
          return rows
        })
        yield* gate.pass.pipe(
          Effect.andThen(memory.ready),
          Effect.andThen(
            syncSchedule({
              projects: run(scheduled),
              check: (projectId) =>
                check(projectId).pipe(
                  Effect.catchCause((cause) =>
                    said(`the check of ${projectId} failed: ${String(cause)}`),
                  ),
                ),
              changed: Effect.asVoid(Queue.take(changes)),
              failed: (cause) => said(`a round of the schedule failed: ${String(cause)}`),
            }),
          ),
          Effect.catchCause((cause) => said(`the schedule stopped: ${String(cause)}`)),
          Effect.forkScoped,
        )
      }
      return { check, setInterval }
    }),
  )
