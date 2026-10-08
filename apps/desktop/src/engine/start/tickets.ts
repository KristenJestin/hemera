/**
 * The port the field searches remote tickets through: every ticket provider of a Project (GitHub
 * issues #95, Jira #96), merged. It only reads: nothing is ever applied on a remote ticket from
 * here.
 *
 * A provider's failure is an element of the merged stream, never its end (#94, section 2): every
 * provider runs at once, its hits come as soon as it answers, and its failure comes as one
 * `ProviderFailed` while the others go on.
 */

import type { ProviderFailed, ProviderHit, TicketReference } from '@hemera/core/domain'
import { Context, type Effect, type Stream } from 'effect'

import type { DatabaseError } from '../storage/database.ts'

/** What is searched: the text as typed, and the ticket reference it is, when it is one. */
export interface TicketQuery {
  readonly text: string
  readonly reference: TicketReference | null
}

export class TicketSearch extends Context.Service<
  TicketSearch,
  {
    /** Whether a provider of the Project reads this reference (a short form resolved first). */
    readonly reads: (
      projectId: string,
      reference: TicketReference,
    ) => Effect.Effect<boolean, DatabaseError>
    /**
     * The hosts of the Project's GitHub providers that list a repository, the first one first: the
     * host a short form `owner/repo#n` resolves to. Empty when none lists it: it is github.com's.
     */
    readonly githubHosts: (
      projectId: string,
      owner: string,
      repo: string,
    ) => Effect.Effect<ReadonlyArray<string>, DatabaseError>
    /**
     * The tickets every provider of the Project finds, merged as they answer; a reference is read
     * by the providers it can belong to rather than searched. Empty when the Project has none.
     */
    readonly search: (
      projectId: string,
      query: TicketQuery,
    ) => Stream.Stream<ProviderHit | ProviderFailed, DatabaseError>
  }
>()('TicketSearch') {}
