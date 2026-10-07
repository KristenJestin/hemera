/**
 * The Project's field: search first, create last (#84).
 *
 * The search reads the missions of this Project (never another's): the one the text names, by its
 * key or by the ticket linked to it, first and to be opened; then those whose key, title and idea
 * hold every word of the text, the live ones by last update before the ended ones. With them comes
 * what "Create a mission" would create. The remote tickets follow, as the providers answer: local
 * results never wait on a remote one, and the window's interruption stops the remote searches.
 * Nothing here writes, but `createStart`, the user's explicit choice.
 */

import {
  LIVE_STAGES,
  type TicketReference,
  parseMissionKey,
  parseTicketReference,
  provisionalTitleOf,
  searchWordsOf,
  ticketKeyOf,
  ticketProviderOf,
} from '@hemera/core/domain'
import {
  CreateChoice,
  InvalidMissionIdea,
  MissionFound,
  SearchNotice,
  type StartCreate,
  type StartResult,
  TicketFound,
  type Project,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { Effect, Predicate, Stream } from 'effect'

import { createMission, getMission, linkedMission, linkedTo, missionsOf } from '../missions.ts'
import { getProject } from '../projects.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { memoryJournal, missions } from '../storage/schema.ts'
import { TicketSearch } from './tickets.ts'

/** How many missions a search lists besides the one it opens. */
export const LOCAL_RESULTS = 20

export const NO_PROVIDER = 'No ticket provider is set for this Project.'

/** The mission of this Project the text names by its key, or none. */
const byKey = (projectId: string, text: string) => {
  const key = parseMissionKey(text)
  if (key === null) return Effect.succeed([])
  return Database.use((database) =>
    database
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.projectId, projectId),
          eq(missions.keyPrefix, key.prefix),
          eq(missions.keyNumber, key.number),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('searching the missions'))),
  )
}

/** The mission of this Project the ticket reference is linked to, or none. */
const byTicket = (projectId: string, reference: TicketReference) =>
  Database.use((database) =>
    database
      .select()
      .from(missions)
      .where(linkedTo(projectId, reference))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('searching the missions'))),
  )

const ENDED = sql`${missions.stage} not in (${sql.join(
  LIVE_STAGES.map((stage) => sql`${stage}`),
  sql`, `,
)})`

/** The missions holding every word, the live ones first, each by last update. */
const byWords = (projectId: string, text: string, besides: string | null) =>
  Database.use((database) =>
    database
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.projectId, projectId),
          besides === null ? undefined : ne(missions.id, besides),
          ...searchWordsOf(text).map((word) => sql`instr(${missions.searchText}, ${word}) > 0`),
        ),
      )
      .orderBy(asc(ENDED), desc(missions.updatedAt), desc(sql`rowid`))
      .limit(LOCAL_RESULTS)
      .pipe(Effect.mapError(refusedWhile('searching the missions'))),
  )

/** The last Journal line of each of these missions, by mission. */
const lastLines = (ids: ReadonlyArray<string>) =>
  Database.use((database) =>
    ids.length === 0
      ? Effect.succeed(new Map<string, { at: string; text: string }>())
      : database
          .select({
            missionId: memoryJournal.missionId,
            at: memoryJournal.at,
            text: memoryJournal.text,
          })
          .from(memoryJournal)
          .where(
            inArray(
              memoryJournal.sequence,
              database
                .select({ sequence: sql<number>`max(${memoryJournal.sequence})` })
                .from(memoryJournal)
                .where(inArray(memoryJournal.missionId, [...ids]))
                .groupBy(memoryJournal.missionId),
            ),
          )
          .pipe(
            Effect.mapError(refusedWhile('reading the Journal')),
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.missionId, { at: row.at, text: row.text }])),
            ),
          ),
  )

/**
 * The ticket reference the text is for this Project: never a key with the Project's own prefix,
 * which names one of its missions, even one that does not exist.
 */
const referenceIn = (project: Project, text: string): TicketReference | null => {
  const reference = parseTicketReference(text)
  return reference !== null && ownKey(project, reference) ? null : reference
}

/** Whether a reference is a bare key with the Project's own prefix. */
const ownKey = (project: Project, reference: TicketReference) =>
  Predicate.isTagged(reference, 'JiraKey') &&
  reference.host === null &&
  parseMissionKey(reference.key)?.prefix === project.keyPrefix

/**
 * The local part of a search: the missions found, then what creating would create. A bare key is
 * a mission key of this Project first, and a ticket only when no mission has that key. Creating
 * links the ticket only when a provider of the Project reads its kind: otherwise a text shaped like
 * a key (`UTF-8`) would leave a link to a ticket nobody can read.
 */
const localResults = (project: Project, text: string, providers: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const projectId = project.id
    const keyed = yield* byKey(projectId, text)
    const reference = keyed.length === 0 ? referenceIn(project, text) : null
    const linked = reference === null ? [] : yield* byTicket(projectId, reference)
    const [opened] = [...keyed, ...linked]
    const listed = yield* byWords(projectId, text, opened?.id ?? null)
    const rows = opened === undefined ? listed : [opened, ...listed]
    const found = yield* missionsOf(rows)
    const last = yield* lastLines(found.map((mission) => mission.id))
    const results: StartResult[] = found.map((mission) =>
      MissionFound.make({
        mission,
        open: mission.id === opened?.id,
        last: last.get(mission.id) ?? null,
      }),
    )
    if (text.trim() !== '' && linked.length === 0) {
      results.push(
        CreateChoice.make(
          reference === null || !providers.includes(ticketProviderOf(reference))
            ? { title: provisionalTitleOf(text), ticket: null }
            : { title: ticketKeyOf(reference), ticket: reference },
        ),
      )
    }
    return { results, reference }
  })

/** The remote tickets, each with the mission of this Project linked to it; a failure said once. */
const remoteResults = (projectId: string, text: string, reference: TicketReference | null) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const tickets = yield* TicketSearch
      const database = yield* Database
      return tickets.search(projectId, { text, reference }).pipe(
        Stream.mapEffect((hit) =>
          Effect.map(linkedMission(database, projectId, hit.reference), (linked) =>
            TicketFound.make({ hit: { ...hit, linkedMission: linked } }),
          ),
        ),
        Stream.catchTag('TicketSearchError', (failed) =>
          Stream.make(SearchNotice.make({ sentence: failed.message })),
        ),
      )
    }),
  )

/** What the field finds for a text: never creates anything. */
export const searchStart = (projectId: string, text: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const project = yield* getProject(projectId)
      const providers = yield* TicketSearch.use((tickets) => tickets.providers(projectId))
      const local = yield* localResults(project, text, providers)
      if (providers.length === 0) {
        const notice =
          local.reference === null ? [] : [SearchNotice.make({ sentence: NO_PROVIDER })]
        return Stream.fromIterable([...local.results, ...notice])
      }
      return Stream.concat(
        Stream.fromIterable(local.results),
        remoteResults(projectId, text, local.reference),
      )
    }),
  )

/**
 * The host a GitHub short form resolves to: the first GitHub provider of the Project that lists its
 * repository; none for any other reference, or when no provider lists it (it is github.com's).
 */
const hostOf = (projectId: string, reference: TicketReference | undefined) =>
  reference === undefined ||
  !Predicate.isTagged(reference, 'GithubIssue') ||
  reference.host !== null
    ? Effect.succeed(undefined)
    : TicketSearch.use((tickets) =>
        Effect.map(
          tickets.githubHosts(projectId, reference.owner, reference.repo),
          (hosts) => hosts[0],
        ),
      )

/**
 * The user's explicit choice: a mission from the text, the ticket, or both, through the missions'
 * own creation, started from a mission of this Project when it names one.
 */
export const createStart = (asked: StartCreate) =>
  Effect.gen(function* () {
    if (asked.origin !== undefined) {
      const origin = yield* getMission(asked.origin)
      if (origin.projectId !== asked.projectId) {
        return yield* new InvalidMissionIdea({
          reason: 'it can start only from a mission of this Project',
        })
      }
    }
    const ticket = asked.ticket
    if (ticket !== undefined) {
      const project = yield* getProject(asked.projectId)
      if (ownKey(project, ticket.reference)) {
        return yield* new InvalidMissionIdea({
          reason: `${ticketKeyOf(ticket.reference)} is a mission key of this Project, not a ticket`,
        })
      }
    }
    const githubHost = yield* hostOf(asked.projectId, ticket?.reference)
    return yield* createMission(
      {
        projectId: asked.projectId,
        idea: {
          sentence: asked.text ?? null,
          ticket: ticket === undefined ? null : ticketKeyOf(ticket.reference),
        },
      },
      {
        reference: ticket?.reference,
        githubHost,
        ticketTitle: ticket?.title,
        origin: asked.origin,
        idempotencyKey: asked.idempotencyKey,
      },
    )
  })
