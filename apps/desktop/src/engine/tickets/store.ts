/**
 * A Project's ticket providers and its Spec mode, as the data folder keeps them (#95).
 *
 * A provider is recorded only from the user's choice: what is proposed (the repositories whose
 * remote points to the host) is never written by itself. A provider a live mission's ticket comes
 * from cannot be removed. Every change writes its domain event in the same transaction.
 */

import { join } from 'node:path'

import { LIVE_STAGES, type SpecMode, missionKey } from '@hemera/core/domain'
import {
  type GithubProviderConfig,
  InvalidProviderConfig,
  ProviderInUse,
  type TicketProviderInfo,
  type TicketsSettings,
  UnknownProject,
  UnknownTicketProvider,
} from '@hemera/ipc'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { Effect, Option, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import { Git } from '../git.ts'
import type { DomainEvent } from '../journal.ts'
import { getProject } from '../projects.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missionTickets, missions, projects, ticketProviders } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { GithubConfig } from './github.ts'

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/

const readConfig = Schema.decodeUnknownOption(Schema.fromJsonString(GithubConfig))

type ProviderRow = typeof ticketProviders.$inferSelect

const infoOf = (row: ProviderRow): TicketProviderInfo => {
  const config = Option.getOrElse(readConfig(row.configuration), () => ({
    host: '',
    repositories: [],
  }))
  return {
    id: row.id,
    projectId: row.projectId,
    kind: 'github',
    host: config.host,
    repositories: config.repositories,
    unreachableSince: row.unreachableSince,
    createdAt: row.createdAt,
  }
}

/** A GitHub configuration as it is kept: the host and repositories in lower case, once each. */
const checkedGithub = (config: GithubProviderConfig) =>
  Effect.gen(function* () {
    const host = config.host.trim().toLowerCase()
    if (!HOST.test(host)) {
      return yield* new InvalidProviderConfig({ reason: `${config.host} is not a host name` })
    }
    const repositories = [
      ...new Set(config.repositories.map((repository) => repository.trim().toLowerCase())),
    ]
    const wrong = repositories.find((repository) => !REPOSITORY.test(repository))
    if (wrong !== undefined) {
      return yield* new InvalidProviderConfig({ reason: `${wrong} is not an owner/repo name` })
    }
    return { host, repositories }
  })

const providerEvent = (
  type: string,
  row: { readonly id: string; readonly projectId: string },
  payload: Record<string, string | ReadonlyArray<string>>,
) => ({
  type,
  entityKind: 'ticket_provider',
  entityId: row.id,
  source: 'ui' as const,
  author: 'human' as const,
  payload: { projectId: row.projectId, ...payload },
})

/** The providers of a Project, in the order they were added. */
export const providersOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(ticketProviders)
      .where(eq(ticketProviders.projectId, projectId))
      .orderBy(asc(ticketProviders.createdAt), asc(sql`rowid`))
      .pipe(Effect.mapError(refusedWhile('reading the ticket providers')))
    return rows.map(infoOf)
  })

/** One provider, or its absence said. */
export const getProvider = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(ticketProviders)
      .where(eq(ticketProviders.id, id))
      .pipe(Effect.mapError(refusedWhile('reading the ticket providers')))
    if (row === undefined) return yield* new UnknownTicketProvider({ id })
    return infoOf(row)
  })

/** Refused when another provider of the Project already reads this host: one per host. */
const hostFree = (
  transaction: EngineTransaction,
  projectId: string,
  host: string,
  besides: string | null,
) =>
  Effect.gen(function* () {
    const rows = yield* transaction
      .select()
      .from(ticketProviders)
      .where(eq(ticketProviders.projectId, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the ticket providers')))
    if (rows.some((row) => row.id !== besides && infoOf(row).host === host)) {
      return yield* new InvalidProviderConfig({
        reason: `${host} already has a provider in this Project`,
      })
    }
  })

/** Adds a GitHub provider to a Project, with the repositories the user kept. */
export const addGithub = (projectId: string, config: GithubProviderConfig) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const checked = yield* checkedGithub(config)
    const row: ProviderRow = {
      id: crypto.randomUUID(),
      projectId: project.id,
      kind: 'github',
      configuration: JSON.stringify(checked),
      unreachableSince: null,
      limitedUntil: null,
      createdAt: new Date().toISOString(),
    }
    return yield* mutate('adding a ticket provider', (transaction) =>
      Effect.gen(function* () {
        yield* hostFree(transaction, project.id, checked.host, null)
        yield* transaction
          .insert(ticketProviders)
          .values(row)
          .pipe(Effect.mapError(refusedWhile('writing the ticket provider')))
        return {
          result: infoOf(row),
          events: [
            providerEvent('tickets.provider_added', row, {
              kind: 'github',
              host: checked.host,
              repositories: checked.repositories,
            }),
          ],
        }
      }),
    )
  })

/** Changes a GitHub provider's host or repositories. */
export const updateProvider = (id: string, config: GithubProviderConfig) =>
  Effect.gen(function* () {
    const checked = yield* checkedGithub(config)
    return yield* mutate('changing a ticket provider', (transaction) =>
      Effect.gen(function* () {
        const [before] = yield* transaction
          .select({ projectId: ticketProviders.projectId })
          .from(ticketProviders)
          .where(eq(ticketProviders.id, id))
          .pipe(Effect.mapError(refusedWhile('reading the ticket providers')))
        if (before === undefined) return yield* new UnknownTicketProvider({ id })
        yield* hostFree(transaction, before.projectId, checked.host, id)
        const [row] = yield* transaction
          .update(ticketProviders)
          .set({ configuration: JSON.stringify(checked) })
          .where(eq(ticketProviders.id, id))
          .returning()
          .pipe(Effect.mapError(refusedWhile('writing the ticket provider')))
        if (row === undefined) return yield* new UnknownTicketProvider({ id })
        return {
          result: infoOf(row),
          events: [
            providerEvent('tickets.provider_updated', row, {
              host: checked.host,
              repositories: checked.repositories,
            }),
          ],
        }
      }),
    )
  })

/** The keys of the live missions whose ticket a provider reads. */
const liveMissionsOf = (transaction: EngineTransaction, providerId: string) =>
  transaction
    .select({ prefix: missions.keyPrefix, number: missions.keyNumber })
    .from(missionTickets)
    .innerJoin(missions, eq(missions.id, missionTickets.missionId))
    .where(
      and(eq(missionTickets.providerId, providerId), inArray(missions.stage, [...LIVE_STAGES])),
    )
    .orderBy(asc(missions.keyNumber))
    .pipe(
      Effect.mapError(refusedWhile('reading the missions')),
      Effect.map((rows) => rows.map((row) => missionKey(row.prefix, row.number))),
    )

/** Removes a provider; refused, the missions named, while a live mission's ticket comes from it. */
export const removeProvider = (id: string) =>
  mutate('removing a ticket provider', (transaction) =>
    Effect.gen(function* () {
      const live = yield* liveMissionsOf(transaction, id)
      if (live.length > 0) return yield* new ProviderInUse({ missionKeys: live })
      const [row] = yield* transaction
        .delete(ticketProviders)
        .where(eq(ticketProviders.id, id))
        .returning()
        .pipe(Effect.mapError(refusedWhile('removing the ticket provider')))
      if (row === undefined) return yield* new UnknownTicketProvider({ id })
      return { result: undefined, events: [providerEvent('tickets.provider_removed', row, {})] }
    }),
  )

const readMode = Schema.decodeUnknownOption(
  Schema.Literals(['local', 'linked'] satisfies ReadonlyArray<SpecMode>),
)

/** The Project's Spec mode: `local` unless the user chose `linked`. */
export const specModeOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ mode: projects.specMode })
      .from(projects)
      .where(eq(projects.id, projectId))
      .pipe(Effect.mapError(refusedWhile('reading the Project')))
    if (row === undefined) return yield* new UnknownProject({ id: projectId })
    return Option.getOrElse(readMode(row.mode), (): SpecMode => 'local')
  })

/** Sets the Project's Spec mode: it applies to the missions created afterwards. */
export const setSpecMode = (projectId: string, mode: SpecMode) =>
  mutate('setting the Spec mode', (transaction) =>
    Effect.gen(function* () {
      const [row] = yield* transaction
        .update(projects)
        .set({ specMode: mode })
        .where(eq(projects.id, projectId))
        .returning({ id: projects.id })
        .pipe(Effect.mapError(refusedWhile('writing the Spec mode')))
      if (row === undefined) return yield* new UnknownProject({ id: projectId })
      return {
        result: mode,
        events: [
          {
            type: 'tickets.spec_mode_set',
            entityKind: 'project',
            entityId: projectId,
            source: 'ui' as const,
            author: 'human' as const,
            payload: { mode },
          },
        ],
      }
    }),
  )

/** The `owner/repo` a remote URL names on a host: `https://host/o/r(.git)`, `git@host:o/r(.git)`. */
const repositoryOn = (url: string, host: string): string | null => {
  const match =
    /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    )
  if (match === null) return null
  const [, found = '', owner = '', repo = ''] = match
  return found.toLowerCase() === host ? `${owner}/${repo}`.toLowerCase() : null
}

/**
 * The repositories of the Project whose remote points to a host: what is proposed when a GitHub
 * provider is added, for the user to keep or not. Nothing is recorded here.
 */
export const proposeGithub = (projectId: string, host: string) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const wanted = host.trim().toLowerCase()
    const found = yield* Effect.forEach(project.repositories, (repository) =>
      Git.use((git) => git.remotes(join(project.mainCheckout, repository.path))).pipe(
        Effect.map((remotes) =>
          remotes
            .filter((remote) => repository.remote === null || remote.name === repository.remote)
            .flatMap((remote) => {
              const named = repositoryOn(remote.fetchUrl, wanted)
              return named === null ? [] : [named]
            }),
        ),
        // A repository Git cannot read proposes nothing; the others still do.
        Effect.catch(() => Effect.succeed([])),
      ),
    )
    return [...new Set(found.flat())]
  })

/** The Project's ticket settings now. */
const settingsOf = (projectId: string) =>
  Effect.gen(function* () {
    const specMode = yield* specModeOf(projectId)
    const providers = yield* providersOf(projectId)
    return { projectId, specMode, providers } satisfies TicketsSettings
  })

const readProjectId = Schema.decodeUnknownOption(Schema.String)

/** Whether a committed event changes a Project's ticket settings. */
const changes = (projectId: string) => (event: DomainEvent) =>
  event.type.startsWith('tickets.') &&
  (event.entityId === projectId ||
    Option.getOrNull(readProjectId(event.payload['projectId'])) === projectId)

/** The Project's ticket settings now, then again after each change, while the caller listens. */
export const ticketsChanges = (projectId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      const now = yield* settingsOf(projectId)
      return Stream.concat(
        Stream.make(now),
        committed.pipe(
          Stream.filter(changes(projectId)),
          Stream.mapEffect(() => settingsOf(projectId)),
        ),
      )
    }),
  )
