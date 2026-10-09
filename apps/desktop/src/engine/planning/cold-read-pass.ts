/**
 * A cold read's pass as it is recorded (#91, CT-29), inside the transaction of what asks for it:
 * the declaration of completeness that is the first of its Planning cycle, or the user's another
 * pass. It reads the Spec as that transaction reads it, so it is bound to the version declared,
 * and a stop right after the commit leaves it recorded, waiting for its slot.
 */

import {
  type ColdReadAsker,
  SPEC_SECTIONS,
  type SpecText,
  renderSpecMarkdown,
  specPartMarkdown,
  specRepositories,
} from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import type { EventPayload, NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { coldReads, projectRepositories } from '../storage/schema.ts'
import { type ColdReadRow, writeSnapshot } from './cold-read-rows.ts'

/** What Now's next step says while a pass waits for its slot, and once it runs. */
export const COLD_READ_WAITS = 'Cold read waits for a free slot'
export const COLD_READ_RUNS = 'Cold read running'

/** One of a pass's events, about its mission. */
export const coldReadEvent = (
  type: string,
  row: Pick<ColdReadRow, 'id' | 'missionId' | 'number'>,
  payload: EventPayload = {},
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: 'system',
  author: 'hemera',
  payload: { coldReadId: row.id, number: row.number, ...payload },
})

/** A mission's passes, the first first. */
export const passesIn = (transaction: EngineTransaction, missionId: string) =>
  transaction
    .select()
    .from(coldReads)
    .where(eq(coldReads.missionId, missionId))
    .orderBy(asc(coldReads.number))
    .pipe(Effect.mapError(refusedWhile('reading the cold reads')))

const PARTS = [...SPEC_SECTIONS, 'requirements', 'tasks'] as const

/**
 * The Spec as a pass reads it: the whole and each part, and the repositories whose code it reads
 * (those its tasks and proofs name, every one of the Project's when it names none).
 */
const snapshotIn = (transaction: EngineTransaction, spec: SpecText, projectId: string) =>
  Effect.gen(function* () {
    const named = specRepositories(spec)
    const all = yield* transaction
      .select({ path: projectRepositories.path })
      .from(projectRepositories)
      .where(eq(projectRepositories.projectId, projectId))
      .orderBy(asc(projectRepositories.position))
      .pipe(Effect.mapError(refusedWhile('reading the repositories')))
    return writeSnapshot({
      key: spec.key,
      whole: renderSpecMarkdown(spec, { versions: true }),
      parts: Object.fromEntries(PARTS.map((part) => [part, specPartMarkdown(spec, part)])),
      repositories: named.length > 0 ? named : all.map((one) => one.path),
    })
  })

/**
 * Records a pass of a mission, waiting for its slot, bound to the Spec given (read in the same
 * transaction); answers it with its event. The caller has checked that it may be recorded.
 */
export const insertPassIn = (
  transaction: EngineTransaction,
  asked: {
    readonly mission: {
      readonly id: string
      readonly projectId: string
      readonly planningCycle: number
    }
    readonly spec: SpecText
    readonly asker: ColdReadAsker
    readonly passes: ReadonlyArray<ColdReadRow>
  },
) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const { mission, spec, asker, passes } = asked
    const row: ColdReadRow = {
      id: crypto.randomUUID(),
      missionId: mission.id,
      number: Math.max(0, ...passes.map((one) => one.number)) + 1,
      cycle: mission.planningCycle,
      specVersion: spec.version,
      snapshot: secrets.mask(yield* snapshotIn(transaction, spec, mission.projectId)),
      requestedBy: asker,
      state: 'waiting_for_slot',
      stuck: false,
      lineage: crypto.randomUUID(),
      reminded: false,
      failure: null,
      deliveryId: null,
      askedAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    }
    yield* transaction
      .insert(coldReads)
      .values(row)
      .pipe(Effect.mapError(refusedWhile('recording a cold read')))
    const event = coldReadEvent('planning.cold_read_started', row, {
      requestedBy: asker,
      version: row.specVersion,
    })
    return { row, event }
  })
