/**
 * The ticket provider port (#95): one interface for every source of tickets, GitHub issues here and
 * Jira in #96. A provider is configured for one Project (a GitHub host and its repositories); it
 * only reads. Remote writes are #98's.
 */

import { createHash } from 'node:crypto'

import {
  CanonicalTicket,
  type KnownTicket,
  type ProviderHit,
  type ProviderKind,
  type ProviderStatus,
  type TicketError,
  TicketForbidden,
  TicketNotFound,
  type TicketReference,
  type TicketVersion,
  commentFingerprintInput,
  fingerprintInput,
} from '@hemera/core/domain'
import { type Effect, Predicate, Schema } from 'effect'

/** The failures that mean the provider cannot be reached at all, as opposed to one ticket. */
export const isOutage = (failure: TicketError): boolean =>
  Predicate.isTagged(failure, 'ProviderUnreachable') ||
  Predicate.isTagged(failure, 'ProviderLimited') ||
  Predicate.isTagged(failure, 'ProviderNotAuthenticated') ||
  Predicate.isTagged(failure, 'ProviderCliMissing')

/** A watched ticket whose remote update date moved since its last known version. */
export const MovedTicket = Schema.TaggedStruct('Moved', {
  reference: CanonicalTicket,
  updatedAt: Schema.String,
})

/** A watched ticket the provider no longer finds (deleted, moved, access lost). */
export const MissingTicket = Schema.TaggedStruct('Missing', {
  reference: CanonicalTicket,
  error: Schema.Union([TicketNotFound, TicketForbidden]),
})

export type TicketChange = typeof MovedTicket.Type | typeof MissingTicket.Type

export interface TicketProvider {
  readonly kind: ProviderKind
  /** How its errors and notices name it: `GitHub`, `GitHub (git.acme.test)`. */
  readonly label: string
  /** Never fails: a provider that cannot be reached says so in its status. */
  readonly status: Effect.Effect<ProviderStatus>
  /** Whether a reference is one of its tickets (its host for GitHub). */
  readonly reads: (reference: TicketReference) => boolean
  readonly read: (reference: TicketReference) => Effect.Effect<TicketVersion, TicketError>
  /** At most 20 hits for the text, each provider's sorted by update date. */
  readonly search: (text: string) => Effect.Effect<ReadonlyArray<ProviderHit>, TicketError>
  /**
   * The tickets whose remote update date differs from their last known one, in one grouped request
   * per host (in batches); a ticket it no longer finds is `Missing`.
   */
  readonly changedSince: (
    known: ReadonlyArray<KnownTicket>,
  ) => Effect.Effect<ReadonlyArray<TicketChange>, TicketError>
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** A ticket's fingerprint: its title and description as the provider returned them, normalised. */
export const ticketFingerprint = (title: string, description: string): string =>
  sha256(fingerprintInput(title, description))

/** A comment's fingerprint: its body, normalised. */
export const commentFingerprint = (body: string): string => sha256(commentFingerprintInput(body))
