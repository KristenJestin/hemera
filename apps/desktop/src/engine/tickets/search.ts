/**
 * A Project's providers, live, and the field's `TicketSearch` over them (#95).
 *
 * Every provider runs at once (`Stream.mergeAll`, unbounded): its hits come as soon as it answers,
 * and its failure comes as one `ProviderFailed` while the others go on. A reference is read, not
 * searched, and only by the providers it can belong to: a GitHub URL by the providers of its host,
 * a short form by the host of the first provider that lists its repository, else github.com's.
 * Interrupting the stream interrupts every call, and the supervisor ends each `gh` it started.
 * The search writes nothing.
 */

import {
  GITHUB_HOST,
  GithubIssue,
  type ProviderHit,
  ProviderFailed,
  type TicketReference,
  type TicketVersion,
} from '@hemera/core/domain'
import type { TicketProviderInfo } from '@hemera/ipc'
import { Effect, Layer, Predicate, Stream } from 'effect'

import type { Database } from '../storage/database.ts'
import { TicketSearch } from '../start/tickets.ts'
import type { GhCli } from './gh.ts'
import { githubProvider } from './github.ts'
import { type TicketProvider, isOutage } from './provider.ts'
import { providersOf } from './store.ts'

export interface LiveProvider {
  readonly info: TicketProviderInfo
  readonly provider: TicketProvider
}

/** The providers of a Project, ready to be asked, in the Project's order. */
export const liveProviders = (projectId: string) =>
  Effect.gen(function* () {
    const infos = yield* providersOf(projectId)
    return yield* Effect.forEach(infos, (info) =>
      Effect.map(
        githubProvider({ host: info.host, repositories: info.repositories }),
        (provider): LiveProvider => ({ info, provider }),
      ),
    )
  })

/** The hosts of the GitHub providers that list `owner/repo`, the Project's first first. */
const hostsListing = (providers: ReadonlyArray<LiveProvider>, owner: string, repo: string) =>
  providers
    .filter((one) => one.info.repositories.includes(`${owner}/${repo}`.toLowerCase()))
    .map((one) => one.info.host)

/** A reference with the host a short form resolves to among these providers. */
export const resolvedAmong = (
  providers: ReadonlyArray<LiveProvider>,
  reference: TicketReference,
): TicketReference =>
  Predicate.isTagged(reference, 'GithubIssue') && reference.host === null
    ? GithubIssue.make({
        ...reference,
        host: hostsListing(providers, reference.owner, reference.repo)[0] ?? GITHUB_HOST,
      })
    : reference

/** A version read for a reference, as the hit a search answers. */
const hitOf = (reference: TicketReference, version: TicketVersion): ProviderHit => ({
  provider: version.provider,
  reference,
  canonical: version.reference,
  key: version.key,
  title: version.title,
  url: version.url,
  status: version.status,
  updatedAt: version.updatedAt,
})

/** One provider's part of a search: its hits, or the one notice it failed with. */
const askedOf = (provider: TicketProvider, text: string, reference: TicketReference | null) =>
  Stream.fromIterableEffect(
    (reference === null
      ? provider.search(text)
      : Effect.map(provider.read(reference), (version) => [hitOf(reference, version)])
    ).pipe(
      Effect.map((hits): ReadonlyArray<ProviderHit | ProviderFailed> => hits),
      Effect.catch((failed) =>
        Effect.succeed([
          ProviderFailed.make({
            provider: provider.label,
            message: failed.message,
            ticketUnreadable: reference !== null && !isOutage(failed),
          }),
        ]),
      ),
    ),
  )

/** The field's search over the Project's providers, as the data folder lists them. */
export const ticketSearchLayer = Layer.effect(
  TicketSearch,
  Effect.gen(function* () {
    const context = yield* Effect.context<Database | GhCli>()
    const providers = (projectId: string) =>
      Effect.provideContext(liveProviders(projectId), context)
    return {
      reads: (projectId, reference) =>
        Effect.map(providers(projectId), (live) => {
          const resolved = resolvedAmong(live, reference)
          return live.some((one) => one.provider.reads(resolved))
        }),
      githubHosts: (projectId, owner, repo) =>
        Effect.map(providers(projectId), (live) => hostsListing(live, owner, repo)),
      search: (projectId, query) =>
        Stream.unwrap(
          Effect.map(providers(projectId), (live) => {
            const reference = query.reference === null ? null : resolvedAmong(live, query.reference)
            const asked = live.filter((one) => reference === null || one.provider.reads(reference))
            return Stream.mergeAll(
              asked.map((one) => askedOf(one.provider, query.text, reference)),
              { concurrency: 'unbounded' },
            )
          }),
        ),
    }
  }),
)
