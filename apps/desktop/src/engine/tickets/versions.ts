/**
 * What Hemera read of a ticket, as the data folder keeps it (#95): each version's text masked
 * before it is written, and the link a mission created from a ticket gets in the creation's own
 * transaction.
 */

import {
  CanonicalTicket,
  type Masked,
  type SpecMode,
  TicketComment,
  type TicketVersion,
  readSections,
} from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { Secrets } from '../secrets.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missionTickets, missions, ticketProviders, ticketVersions } from '../storage/schema.ts'

const readComments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(TicketComment)))
const readLabels = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
const readState = Schema.decodeUnknownOption(Schema.Literals(['open', 'closed']))
const readKind = Schema.decodeUnknownOption(Schema.Literals(['github', 'jira']))

type VersionRow = typeof ticketVersions.$inferSelect

/** The Project of a mission, in the transaction given; empty when the mission is gone. */
export const projectOfIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.map(
    transaction
      .select({ projectId: missions.projectId })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission'))),
    ([row]) => row?.projectId ?? '',
  )

/** A version as it was kept: its sections read again from the masked description. */
export const versionOf = (row: VersionRow): TicketVersion => {
  const sections = readSections(row.description)
  return {
    provider: Option.getOrElse(readKind(row.provider), () => 'github' as const),
    reference: CanonicalTicket.make(row.reference),
    key: row.key,
    url: row.url,
    title: row.title,
    description: row.description,
    sections: sections.sections,
    unrecognised: sections.unrecognised,
    status: {
      state: Option.getOrElse(readState(row.state), () => 'open' as const),
      wording: row.wording,
    },
    author: row.author,
    labels: Option.getOrElse(readLabels(row.labels), () => []),
    comments: Option.getOrElse(readComments(row.comments), () => []),
    updatedAt: row.updatedAt,
    readAt: row.readAt,
    fingerprint: row.fingerprint,
  }
}

/** A version as it may be shown: its title, description and comments masked, its sections too. */
export const maskedVersion = (
  version: TicketVersion,
  mask: (text: string) => Masked<string>,
): TicketVersion => {
  const description = mask(version.description)
  const sections = readSections(description)
  return {
    ...version,
    title: mask(version.title),
    description,
    sections: sections.sections,
    unrecognised: sections.unrecognised,
    comments: version.comments.map((comment) => ({ ...comment, body: mask(comment.body) })),
  }
}

/** Writes a version read for a mission, its text masked; answers its id. */
export const insertVersion = (
  transaction: EngineTransaction,
  missionId: string,
  providerId: string | null,
  version: TicketVersion,
  mask: (text: string) => Masked<string>,
) => {
  const id = crypto.randomUUID()
  return transaction
    .insert(ticketVersions)
    .values({
      id,
      missionId,
      providerId,
      provider: version.provider,
      reference: version.reference,
      key: version.key,
      url: version.url,
      title: mask(version.title),
      description: mask(version.description),
      state: version.status.state,
      wording: version.status.wording,
      author: version.author,
      labels: JSON.stringify(version.labels),
      comments: JSON.stringify(
        version.comments.map((comment) => ({ ...comment, body: mask(comment.body) })),
      ),
      updatedAt: version.updatedAt,
      readAt: version.readAt,
      fingerprint: version.fingerprint,
    })
    .pipe(Effect.mapError(refusedWhile('writing the ticket version')), Effect.as(id))
}

/** What a mission created from a ticket is linked with: its provider, the mode, what was read. */
export interface TicketLinkAtCreation {
  readonly providerId: string
  readonly mode: SpecMode
  /** None when the ticket could not be read at creation. */
  readonly version: TicketVersion | null
}

/** Inside the creation's transaction: the mission's ticket, its version base and last known. */
export const linkMissionTicket = (
  transaction: EngineTransaction,
  missionId: string,
  link: TicketLinkAtCreation,
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    // A provider removed while the ticket was being read leaves the mission linked to none.
    const [provider] = yield* transaction
      .select({ id: ticketProviders.id })
      .from(ticketProviders)
      .where(eq(ticketProviders.id, link.providerId))
      .pipe(Effect.mapError(refusedWhile('reading the ticket providers')))
    const providerId = provider?.id ?? null
    const versionId =
      link.version === null
        ? null
        : yield* insertVersion(transaction, missionId, providerId, link.version, secrets.mask)
    yield* transaction
      .insert(missionTickets)
      .values({
        missionId,
        providerId,
        mode: link.mode,
        baseVersionId: versionId,
        lastVersionId: versionId,
        linkedAt: new Date().toISOString(),
      })
      .pipe(Effect.mapError(refusedWhile('linking the ticket')))
  })
