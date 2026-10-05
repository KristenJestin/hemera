/**
 * The evidence store: the heavy proofs of a mission (full logs, test outputs, images), kept in
 * `missions/<key>/evidence/` under the data folder, never in a Workspace, as long as the mission
 * exists.
 *
 * A file is named by the sha256 of what it holds and an extension from its media type: the same
 * content added twice is one file and two references, each a row saying what it is, who added it
 * and what it is evidence of. An image is a png, a jpeg or a webp, recognised by its first bytes
 * and never by its name, and at most `EVIDENCE_IMAGE_MAX_BYTES`; images are not read for secrets.
 * A text is masked before it is written.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  EVIDENCE_IMAGE_MAX_BYTES,
  type EvidenceImageType,
  evidenceExtension,
  sizeSaid,
  sniffImage,
} from '@hemera/core/domain'
import { type EvidenceItem, type MemoryAuthor, UnknownEvidence } from '@hemera/ipc'
import { and, asc, eq } from 'drizzle-orm'
import { Effect, Match, Schema } from 'effect'

import type { NewEvent } from '../journal.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { memoryEvidence } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { authorColumnsOf, authorOf } from './journal.ts'
import { missionFolder, missionKeyOf, writeWhole } from './files.ts'

export { UnknownEvidence }

/** A piece of evidence the store refuses, and why, in words. */
export class EvidenceRefused extends Schema.TaggedError<EvidenceRefused>()('EvidenceRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

/** What is kept: bytes as they are, or a text. */
export type EvidenceContent = { readonly bytes: Uint8Array } | { readonly text: string }

export interface EvidencePut {
  readonly missionId: string
  readonly content: EvidenceContent
  /** The name given by whoever added it. */
  readonly name: string
  /** What it is evidence of: an opaque reference the ticket that adds it fills. */
  readonly about: string | null
  readonly author: MemoryAuthor
}

const EVIDENCE_FOLDER = 'evidence'

const strictText = new TextDecoder('utf-8', { fatal: true })

/** The bytes as text, when they are text: UTF-8 without a NUL byte. */
const asText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null
  try {
    return strictText.decode(bytes)
  } catch {
    return null
  }
}

/** What will be written for a content: its bytes and media type, or the reason it is refused. */
const prepared = (content: EvidenceContent, mask: (text: string) => string) => {
  if ('text' in content) {
    return { bytes: new TextEncoder().encode(mask(content.text)), mediaType: 'text/plain' }
  }
  const image = sniffImage(content.bytes)
  if (image === 'image/gif')
    return new EvidenceRefused({ reason: 'a gif is not accepted: png, jpeg or webp' })
  if (image !== null) {
    if (content.bytes.length > EVIDENCE_IMAGE_MAX_BYTES) {
      return new EvidenceRefused({
        reason: `the image is ${sizeSaid(content.bytes.length)}; the limit is ${sizeSaid(EVIDENCE_IMAGE_MAX_BYTES)}`,
      })
    }
    const mediaType: EvidenceImageType = image
    return { bytes: content.bytes, mediaType }
  }
  const text = asText(content.bytes)
  if (text === null) {
    return new EvidenceRefused({
      reason: 'this file is neither a text nor a png, jpeg or webp image',
    })
  }
  return { bytes: new TextEncoder().encode(mask(text)), mediaType: 'text/plain' }
}

/** Who added a piece of evidence, as its event says it. */
const eventAuthor = Match.type<MemoryAuthor>().pipe(
  Match.tagsExhaustive({
    Hemera: () => ({ source: 'system' as const, author: 'hemera' as const }),
    User: () => ({ source: 'ui' as const, author: 'human' as const }),
    Agent: () => ({ source: 'system' as const, author: 'agent' as const }),
  }),
)

/** The same, in the event's payload, for its Journal line. */
const payloadAuthor = Match.type<MemoryAuthor>().pipe(
  Match.tagsExhaustive({
    Hemera: () => ({ by: 'hemera', role: null, sessionId: null }),
    User: () => ({ by: 'user', role: null, sessionId: null }),
    Agent: (agent) => ({ by: 'agent', role: agent.role, sessionId: agent.sessionId }),
  }),
)

type EvidenceRow = typeof memoryEvidence.$inferSelect

const itemOf = (row: EvidenceRow): EvidenceItem => ({
  id: row.id,
  missionId: row.missionId,
  sha256: row.sha256,
  size: row.size,
  mediaType: row.mediaType,
  name: row.name,
  about: row.about,
  author: authorOf(row),
  at: row.addedAt,
})

const fileOf = (folder: string, row: { sha256: string; mediaType: string }) =>
  join(folder, EVIDENCE_FOLDER, `${row.sha256}.${evidenceExtension(row.mediaType)}`)

/** Keeps a piece of evidence with its mission; answers its reference. */
export const putEvidence = (asked: EvidencePut) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const home = yield* ProfileHome
    const key = yield* missionKeyOf(asked.missionId)
    const ready = prepared(asked.content, secrets.mask)
    if (ready instanceof EvidenceRefused) return yield* ready
    const sha256 = createHash('sha256').update(ready.bytes).digest('hex')
    const folder = missionFolder(home.dataFolder, key)
    const path = fileOf(folder, { sha256, mediaType: ready.mediaType })
    // The file first, outside any transaction: a reference never names a file that is not there.
    yield* Effect.try({
      try: () => {
        if (existsSync(path)) return
        mkdirSync(join(folder, EVIDENCE_FOLDER), { recursive: true })
        writeWhole(path, ready.bytes)
      },
      catch: (cause) =>
        new EvidenceRefused({
          reason: `the evidence could not be written: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    })
    const id = crypto.randomUUID()
    const name = secrets.mask(asked.name)
    const about = asked.about === null ? null : secrets.mask(asked.about)
    const author = asked.author
    const row = {
      id,
      missionId: asked.missionId,
      sha256,
      size: ready.bytes.length,
      mediaType: ready.mediaType,
      name,
      about,
      ...authorColumnsOf(author),
      addedAt: new Date().toISOString(),
    }
    const event: NewEvent = {
      type: 'memory.evidence_added',
      entityKind: 'mission',
      entityId: asked.missionId,
      ...eventAuthor(author),
      payload: {
        evidenceId: id,
        name,
        about,
        mediaType: ready.mediaType,
        size: ready.bytes.length,
        sha256,
        ...payloadAuthor(author),
      },
    }
    yield* mutate('keeping evidence', (transaction) =>
      transaction
        .insert(memoryEvidence)
        .values(row)
        .pipe(
          Effect.mapError(refusedWhile('keeping evidence')),
          Effect.as({ result: undefined, events: [event] }),
        ),
    )
    return itemOf(row)
  })

/** The references of a mission's evidence, in the order they were added; of one subject with `about`. */
export const listEvidence = (missionId: string, about: string | null) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(memoryEvidence)
      .where(
        and(
          eq(memoryEvidence.missionId, missionId),
          about === null ? undefined : eq(memoryEvidence.about, about),
        ),
      )
      .orderBy(asc(memoryEvidence.addedAt))
      .pipe(Effect.mapError(refusedWhile('reading the evidence')))
    return rows.map(itemOf)
  })

/** A piece of evidence and its bytes. */
export const readEvidence = (missionId: string, id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const home = yield* ProfileHome
    const [row] = yield* database
      .select()
      .from(memoryEvidence)
      .where(and(eq(memoryEvidence.missionId, missionId), eq(memoryEvidence.id, id)))
      .pipe(Effect.mapError(refusedWhile('reading the evidence')))
    if (row === undefined) return yield* new UnknownEvidence({ id })
    const key = yield* missionKeyOf(missionId)
    const bytes = yield* Effect.try({
      try: () => new Uint8Array(readFileSync(fileOf(missionFolder(home.dataFolder, key), row))),
      catch: () => new UnknownEvidence({ id }),
    })
    return { item: itemOf(row), bytes }
  })
