/**
 * The ticket provider port (#95): one interface for every source of tickets, GitHub issues here and
 * Jira in #96. A provider is configured for one Project (a GitHub host and its repositories). It
 * reads; its one write is a remote Spec's (#98), the whole description, nothing else.
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
  TicketMoved,
  TicketNotFound,
  type TicketReference,
  TicketUnreadable,
  type TicketVersion,
  type TicketWriteError,
  commentFingerprintInput,
  fingerprintInput,
  normalisedText,
} from '@hemera/core/domain'
import { Effect, Predicate, Schema } from 'effect'

/**
 * A provider's call that cannot die: a defect in it (an answer Hemera failed to read) is the
 * provider's failure, said in a sentence that holds nothing of the answer, so one bad ticket never
 * ends a search or a creation.
 */
export const undying = <A, E extends TicketWriteError, R>(
  label: string,
  call: Effect.Effect<A, E, R>,
) =>
  Effect.catchDefect(call, () =>
    Effect.fail(
      new TicketUnreadable({
        key: label,
        detail: `${label} answered something Hemera failed to read.`,
      }),
    ),
  )

/** The failures that mean the provider cannot be reached at all, as opposed to one ticket. */
export const isOutage = (failure: TicketWriteError): boolean =>
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
  /**
   * Writes a remote Spec as the ticket's whole description (#98): the ticket read again first and
   * refused as `TicketMoved` when its description's fingerprint (`descriptionFingerprint`) is not
   * `expected` (nothing is sent then), a text
   * longer than the tracker takes refused as `TicketTooLong`; then the text sent, and the ticket
   * read back, which it answers. `text` is in the provider's own markup: Markdown for GitHub, ADF
   * as JSON for Jira Cloud, wiki markup for Data Center. The title, status, labels and comments are
   * never touched.
   */
  readonly write: (
    reference: TicketReference,
    text: string,
    expected: { readonly fingerprint: string },
  ) => Effect.Effect<TicketVersion, TicketWriteError>
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** A ticket's fingerprint: its title and description as the provider returned them, normalised. */
export const ticketFingerprint = (title: string, description: string): string =>
  sha256(fingerprintInput(title, description))

/**
 * The fingerprint of a description a write expects to find before it sends (#98): the text
 * normalised and trimmed, so that a tracker that adds a line ending or a carriage return reads as
 * the same.
 */
export const descriptionFingerprint = (description: string): string =>
  sha256(normalisedText(description).trim())

/**
 * The ticket read again before a write: its version, or `TicketMoved` when its description is not
 * the one expected (`descriptionFingerprint`). The description is all a write replaces: a title
 * changed meanwhile is no reason to refuse it.
 */
export const unmoved = (version: TicketVersion, expected: { readonly fingerprint: string }) =>
  descriptionFingerprint(version.description) === expected.fingerprint
    ? Effect.succeed(version)
    : Effect.fail(new TicketMoved({ key: version.key, version }))

/**
 * The fingerprint a remote Spec is recognised by in a description (#98), Hemera's own text whatever
 * the tracker made of it: the text normalised, its emphasis and code marks and its escapes left out
 * and its spacing collapsed, as a tracker that stores a document its own way (Jira merging text
 * runs, ids added) rewrites them without changing a word.
 */
export const specFingerprint = (description: string): string =>
  sha256(
    normalisedText(description)
      .replace(/[*_`\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )

/** A comment's fingerprint: its body, normalised. */
export const commentFingerprint = (body: string): string => sha256(commentFingerprintInput(body))
