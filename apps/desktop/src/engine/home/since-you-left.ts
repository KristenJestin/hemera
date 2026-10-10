/**
 * "Since you left" on Home: the events worth telling since the user last looked, grouped by
 * mission, and the cursor that moves when they look.
 *
 * An event is worth telling when it is something the user did not do themselves and may want to
 * know on coming back: a mission delivered, something that failed, a mission restored from a
 * backup, a dependency delivered, the Planner's answer, a change on a ticket, a living spec
 * ready. Each is said in words, never in the engine's vocabulary, and never quotes what a need or
 * a ticket says: those may hold a secret.
 *
 * The cursor is the sequence of the last domain event the user has seen, kept in the Profile so a
 * second window and a restart read the same Home. The page cursor is the same number, going back.
 */

import type { SinceEvent, SincePage, SinceTone } from '@hemera/ipc'
import { and, desc, eq, gt, inArray, lt, max, or, sql } from 'drizzle-orm'
import { Effect, Option, Predicate, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { EventPayload } from '../journal.ts'
import { type MissionActivity, missionsOf } from '../missions.ts'
import { getNeed } from '../needs.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import { appPreferences, domainEvents, missions, needs, projects } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

/** How many events a page holds. */
export const SINCE_PAGE = 30

/** The events read from the data folder at once, while a page is filled. */
const BATCH = 200

const LOOKED_KEY = 'home.lookedAt'

/** Told when the cursor moves, so that every window reads Home again. */
const LOOKED_EVENT = 'home.looked'

/** The sequence of the last event the user saw; zero before they ever looked. */
const lookedAt = (reader: Pick<Database['Service'], 'select'>) =>
  reader
    .select()
    .from(appPreferences)
    .where(eq(appPreferences.key, LOOKED_KEY))
    .pipe(
      Effect.mapError(refusedWhile('reading what the user last saw')),
      Effect.map(([row]) => {
        const seen = Number(row?.value)
        return Number.isInteger(seen) && seen > 0 ? seen : 0
      }),
    )

const readText = Schema.decodeUnknownOption(Schema.String)
const textOf = (payload: EventPayload, key: string) => Option.getOrNull(readText(payload[key]))

/** Whom an event is about: a mission, or a Project itself. */
type Subject = { readonly kind: 'mission' | 'project'; readonly id: string }

interface Told {
  readonly subject: Subject
  readonly tone: SinceTone
  readonly text: string
}

type EventRow = typeof domainEvents.$inferSelect

const readPayload = Schema.decodeUnknownOption(Schema.fromJsonString(EventPayload))

const payloadOf = (row: EventRow): EventPayload =>
  Option.getOrElse(readPayload(row.payload), () => ({}))

/** The kinds of change on a ticket that are told, and how each is said of the ticket `key`. */
const ticketSaid = (kind: string | null, key: string): string | null => {
  if (kind === 'comment_added') return `A comment on ${key}`
  if (kind === 'comment_edited') return `A comment on ${key} was edited`
  if (kind === 'description_changed') return `${key} changed: the mission is outdated`
  if (kind === 'status_changed') return `The status of ${key} changed`
  return null
}

const asMission = (row: EventRow): Subject => ({ kind: 'mission', id: row.entityId })
const asProject = (id: string): Subject => ({ kind: 'project', id })

/** A need that failed, said without quoting what failed. */
const failedNeed = (row: EventRow) =>
  Effect.gen(function* () {
    const found = yield* Effect.option(getNeed(row.entityId))
    if (Option.isNone(found) || !Predicate.isTagged(found.value.fields, 'Error')) {
      return Option.none<Told>()
    }
    const { owner } = found.value
    if (Predicate.isTagged(owner, 'Mission')) {
      return Option.some<Told>({
        subject: { kind: 'mission', id: owner.missionId },
        tone: 'failed',
        text: 'Something failed on this mission',
      })
    }
    if (!Predicate.isTagged(owner, 'Project')) return Option.none<Told>()
    return Option.some<Told>({
      subject: asProject(owner.projectId),
      tone: 'failed',
      text: 'Something failed',
    })
  })

/** What one event tells, or nothing when it is not worth telling. */
const tellOf = (row: EventRow): Effect.Effect<Option.Option<Told>, DatabaseError, Database> => {
  const payload = payloadOf(row)
  switch (row.type) {
    case 'mission.moved':
      return Effect.succeed(
        textOf(payload, 'to') === 'done'
          ? Option.some<Told>({
              subject: asMission(row),
              tone: 'done',
              text: 'The mission is done',
            })
          : Option.none(),
      )
    case 'mission.restored':
      return Effect.succeed(
        Option.some<Told>({
          subject: asMission(row),
          tone: 'info',
          text: 'Restored from a backup',
        }),
      )
    case 'mission.unblocked':
      return Effect.succeed(
        Option.some<Told>({
          subject: asMission(row),
          tone: 'lifted',
          text: `${textOf(payload, 'on') ?? 'What it depended on'} is delivered: this mission can be built`,
        }),
      )
    case 'planning.triaged':
      return Effect.succeed(
        Option.some<Told>({
          subject: asMission(row),
          tone: 'answer',
          text: 'The Planner answered the triage',
        }),
      )
    case 'planning.wave_asked':
      return Effect.succeed(
        Option.some<Told>({
          subject: asMission(row),
          tone: 'answer',
          text: 'The Planner asks questions',
        }),
      )
    case 'tickets.changed': {
      const text = ticketSaid(textOf(payload, 'kind'), textOf(payload, 'key') ?? 'the ticket')
      return Effect.succeed(
        text === null
          ? Option.none()
          : Option.some<Told>({ subject: asMission(row), tone: 'ticket', text }),
      )
    }
    case 'tickets.provider_unreachable': {
      const projectId = textOf(payload, 'projectId')
      return Effect.succeed(
        projectId === null
          ? Option.none()
          : Option.some<Told>({
              subject: asProject(projectId),
              tone: 'failed',
              text: `${textOf(payload, 'provider') ?? 'A tracker'} cannot be read; its tickets keep the version last read`,
            }),
      )
    }
    case 'livingSpec.bootstrap_finished': {
      const state = textOf(payload, 'state')
      if (state === 'done') {
        return Effect.succeed(
          Option.some<Told>({
            subject: asProject(row.entityId),
            tone: 'done',
            text: 'The living spec is ready to review',
          }),
        )
      }
      return Effect.succeed(
        state === 'failed'
          ? Option.some<Told>({
              subject: asProject(row.entityId),
              tone: 'failed',
              text: 'The living spec could not be written',
            })
          : Option.none(),
      )
    }
    case 'need.created':
      return failedNeed(row)
    default:
      return Effect.succeed(Option.none())
  }
}

/** The types of event that are told whenever they happen. */
const ALWAYS_TOLD = [
  'mission.restored',
  'mission.unblocked',
  'planning.triaged',
  'planning.wave_asked',
] as const

/** The types of event that can be told at all: the rest is never read. */
const TOLD_TYPES = [
  ...ALWAYS_TOLD,
  'mission.moved',
  'tickets.changed',
  'tickets.provider_unreachable',
  'livingSpec.bootstrap_finished',
  'need.created',
] as const

const isTold = (type: string): boolean => TOLD_TYPES.some((one) => one === type)

const field = (name: string) => sql<string | null>`json_extract(${domainEvents.payload}, ${name})`

/**
 * The events that `tellOf` would tell, decided where they are stored: a move is told only when it
 * ends in done, a ticket change only of the kinds said, a failed need only when its fields are an
 * error. What is not told is never read.
 */
const toldInStorage = or(
  inArray(domainEvents.type, [...ALWAYS_TOLD]),
  and(eq(domainEvents.type, 'mission.moved'), sql`${field('$.to')} = 'done'`),
  and(
    eq(domainEvents.type, 'tickets.changed'),
    sql`${field('$.kind')} in ('comment_added', 'comment_edited', 'description_changed', 'status_changed')`,
  ),
  and(
    eq(domainEvents.type, 'tickets.provider_unreachable'),
    sql`${field('$.projectId')} is not null`,
  ),
  and(
    eq(domainEvents.type, 'livingSpec.bootstrap_finished'),
    sql`${field('$.state')} in ('done', 'failed')`,
  ),
  and(
    eq(domainEvents.type, 'need.created'),
    sql`exists (select 1 from ${needs} where ${needs.id} = ${domainEvents.entityId} and ${needs.kind} = 'Error')`,
  ),
)

interface Found {
  readonly row: EventRow
  readonly told: Told
}

/** The most rows one read goes through, whatever lies after the cursor. */
export const SCAN_CEILING = 1000

/** What a read found, how many rows it went through, and where to go on if it stopped early. */
interface Scan {
  readonly found: ReadonlyArray<Found>
  readonly scanned: number
  /** The cursor to go on from when the ceiling stopped the read; null when nothing is left. */
  readonly resume: number | null
}

/**
 * The events worth telling after `seen` and before `before`, the newest first: one more than a
 * page, so that a page knows whether an older one exists. At most `ceiling` rows are read.
 */
export const scanSince = (seen: number, before: number | null, ceiling = SCAN_CEILING) =>
  Effect.gen(function* () {
    const database = yield* Database
    const found: Found[] = []
    let from = before
    let scanned = 0
    while (found.length <= SINCE_PAGE) {
      const rows = yield* database
        .select()
        .from(domainEvents)
        .where(
          and(
            toldInStorage,
            gt(domainEvents.sequence, seen),
            from === null ? undefined : lt(domainEvents.sequence, from),
          ),
        )
        .orderBy(desc(domainEvents.sequence))
        .limit(Math.min(BATCH, ceiling - scanned))
        .pipe(Effect.mapError(refusedWhile('reading what happened')))
      for (const row of rows) {
        scanned += 1
        const told = yield* tellOf(row)
        if (Option.isSome(told)) found.push({ row, told: told.value })
        if (found.length > SINCE_PAGE) break
      }
      const last = rows.at(-1)
      if (found.length > SINCE_PAGE || last === undefined) break
      if (scanned >= ceiling) return { found, scanned, resume: last.sequence } satisfies Scan
      if (rows.length < BATCH) break
      from = last.sequence
    }
    return { found, scanned, resume: null } satisfies Scan
  })

const eventOf = ({ row, told }: Found): SinceEvent => ({
  sequence: row.sequence,
  tone: told.tone,
  text: told.text,
  at: row.occurredAt,
})

/** The events as groups: a group per mission or Project, ordered by its newest event. */
const groupsOf = (found: ReadonlyArray<Found>) =>
  Effect.gen(function* () {
    if (found.length === 0) return []
    const database = yield* Database
    const missionIds = [
      ...new Set(
        found
          .filter((one) => one.told.subject.kind === 'mission')
          .map((one) => one.told.subject.id),
      ),
    ]
    const rows =
      missionIds.length === 0
        ? []
        : yield* database
            .select()
            .from(missions)
            .where(inArray(missions.id, missionIds))
            .pipe(Effect.mapError(refusedWhile('reading the missions')))
    const wholes = new Map((yield* missionsOf(rows)).map((mission) => [mission.id, mission]))
    const projectIds = [
      ...new Set(
        found.flatMap((one) => (one.told.subject.kind === 'project' ? [one.told.subject.id] : [])),
      ),
    ]
    const named = new Map(
      projectIds.length === 0
        ? []
        : (yield* database
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .pipe(Effect.mapError(refusedWhile('reading the Projects')))).map((project) => [
            project.id,
            project.name,
          ]),
    )
    // The events come newest first, so a group is created at its newest event.
    const groups = new Map<string, { group: SincePage['groups'][number]; events: SinceEvent[] }>()
    for (const one of found) {
      const { subject } = one.told
      const id = `${subject.kind}:${subject.id}`
      const kept = groups.get(id)
      if (kept !== undefined) {
        kept.events.push(eventOf(one))
        continue
      }
      if (subject.kind === 'mission') {
        const mission = wholes.get(subject.id)
        if (mission === undefined) continue
        groups.set(id, {
          group: {
            projectId: mission.projectId,
            missionId: mission.id,
            missionKey: mission.key,
            title: mission.title,
            ball: mission.ball,
            events: [],
          },
          events: [eventOf(one)],
        })
      } else {
        const name = named.get(subject.id)
        if (name === undefined) continue
        groups.set(id, {
          group: {
            projectId: subject.id,
            missionId: null,
            missionKey: null,
            title: name,
            ball: null,
            events: [],
          },
          events: [eventOf(one)],
        })
      }
    }
    return [...groups.values()].map(({ group, events }) => Object.assign(group, { events }))
  })

/** One page of what happened, the newest first; `before` is the cursor of an older page. */
export const sinceYouLeft = (
  before: number | null,
): Effect.Effect<SincePage, DatabaseError, Database | MissionActivity> =>
  Effect.gen(function* () {
    const database = yield* Database
    const seen = yield* lookedAt(database)
    const { found, resume } = yield* scanSince(seen, before)
    const page = found.slice(0, SINCE_PAGE)
    return {
      groups: yield* groupsOf(page),
      before: found.length > SINCE_PAGE ? (page.at(-1)?.row.sequence ?? null) : resume,
    }
  })

/**
 * The first page, then again after each event worth telling. The subscription is taken before the
 * first read, so an event committed in between is read by the next page rather than lost.
 */
export const sinceYouLeftChanges: Stream.Stream<
  SincePage,
  DatabaseError,
  Database | DomainEvents | MissionActivity
> = Stream.unwrap(
  Effect.map(
    DomainEvents.use((events) => events.subscribe),
    (committed) =>
      Stream.concat(
        Stream.make(null),
        committed.pipe(Stream.filter((event) => isTold(event.type) || event.type === LOOKED_EVENT)),
      ).pipe(
        // A read still going when another event comes is dropped: only the latest page is told.
        Stream.switchMap(() => Stream.fromEffect(sinceYouLeft(null))),
      ),
  ),
)

/**
 * The user looked at what was drawn, up to the sequence `upTo` (the highest one actually shown):
 * the cursor moves there, never past the latest event and never back, and the first page is told
 * again so that another window stops showing what this one has seen. Without `upTo`, the user
 * looked at everything there is.
 */
export const lookedAtHome = (
  upTo?: number,
): Effect.Effect<void, DatabaseError, Database | DomainEvents> =>
  mutate('keeping what the user saw', (transaction) =>
    Effect.gen(function* () {
      const [latest] = yield* transaction
        .select({ sequence: max(domainEvents.sequence) })
        .from(domainEvents)
        .pipe(Effect.mapError(refusedWhile('reading the latest event')))
      const seen = yield* lookedAt(transaction)
      const newest = latest?.sequence ?? 0
      const wanted = upTo === undefined || !Number.isFinite(upTo) ? newest : Math.floor(upTo)
      const sequence = Math.min(wanted, newest)
      if (sequence <= seen) return { result: undefined, events: [] }
      yield* transaction
        .insert(appPreferences)
        .values({ key: LOOKED_KEY, value: String(sequence) })
        .onConflictDoUpdate({ target: appPreferences.key, set: { value: String(sequence) } })
        .pipe(Effect.mapError(refusedWhile('keeping what the user saw')))
      return {
        result: undefined,
        events: [
          {
            type: LOOKED_EVENT,
            entityKind: 'home',
            entityId: 'home',
            source: 'ui' as const,
            author: 'human' as const,
            payload: { upTo: sequence },
          },
        ],
      }
    }),
  )
