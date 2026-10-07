/**
 * The port the field searches remote tickets through: every ticket provider of a Project (GitHub
 * issues #95, Jira #96), merged. It only reads: nothing is ever applied on a remote ticket from
 * here. Until a provider lands, the Project has none and the port answers nothing.
 */

import type { TicketReference } from '@hemera/core/domain'
import type { TicketHit } from '@hemera/ipc'
import { Context, Effect, Layer, Schema, Stream } from 'effect'

/** A provider that could not be read (offline, signed out), said in words, shown once. */
export class TicketSearchError extends Schema.TaggedError<TicketSearchError>()(
  'TicketSearchError',
  { provider: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `${this.provider} could not be searched: ${this.reason}.`
  }
}

/** What is searched: the text as typed, and the ticket reference it is, when it is one. */
export interface TicketQuery {
  readonly text: string
  readonly reference: TicketReference | null
}

export class TicketSearch extends Context.Service<
  TicketSearch,
  {
    /** The kinds of ticket provider set for a Project (`github`, `jira`); none until #95 and #96. */
    readonly providers: (projectId: string) => Effect.Effect<ReadonlyArray<string>>
    /**
     * The hosts of the Project's GitHub providers that list a repository, the first one first: the
     * host a short form `owner/repo#n` resolves to. Empty when none lists it: it is github.com's.
     */
    readonly githubHosts: (
      projectId: string,
      owner: string,
      repo: string,
    ) => Effect.Effect<ReadonlyArray<string>>
    /** The tickets every provider of the Project finds, merged; empty when it has none. */
    readonly search: (
      projectId: string,
      query: TicketQuery,
    ) => Stream.Stream<TicketHit, TicketSearchError>
  }
>()('TicketSearch') {}

/** No provider for any Project: the field works on the Project's own missions. */
export const noTicketSearch = Layer.succeed(TicketSearch, {
  providers: () => Effect.succeed([]),
  githubHosts: () => Effect.succeed([]),
  search: () => Stream.empty,
})
