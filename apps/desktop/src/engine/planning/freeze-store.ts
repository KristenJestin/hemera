/**
 * The Freezes as the missions' read model shows them (#92): the last Freeze of a frozen mission,
 * with its base commits and the dirty files of its main checkout; and the lines the Freeze, the
 * return to Planning, the dependencies and the outdated mark write in the Journal.
 */

import { DIRTY_STATUSES, OutdatedReason, outdatedReasonSaid } from '@hemera/core/domain'
import {
  AgentAuthor,
  FrozenBase,
  type FrozenFile,
  HemeraAuthor,
  type MemoryAuthor,
  type MissionFreeze,
  UserAuthor,
} from '@hemera/ipc'
import { desc, inArray } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import type { EventPayload } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { freezeFiles, freezes } from '../storage/schema.ts'

const BasesJson = Schema.fromJsonString(Schema.Array(FrozenBase))
const readBases = Schema.decodeUnknownOption(BasesJson)
/** The base commits of a Freeze, as its row keeps them. */
export const writeFrozenBases = Schema.encodeSync(BasesJson)

/** The last Freeze of each mission named, by mission; the caller keeps those still frozen. */
export const freezesOf = (missionIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const found = new Map<string, MissionFreeze>()
    if (missionIds.length === 0) return found
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(freezes)
      .where(inArray(freezes.missionId, [...missionIds]))
      .orderBy(desc(freezes.cycle))
      .pipe(Effect.mapError(refusedWhile('reading the Freezes')))
    const latest = rows.filter(
      (row, at) => rows.findIndex((one) => one.missionId === row.missionId) === at,
    )
    const files =
      latest.length === 0
        ? []
        : yield* database
            .select()
            .from(freezeFiles)
            .where(
              inArray(
                freezeFiles.freezeId,
                latest.map((row) => row.id),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the Freezes')))
    for (const row of latest) {
      found.set(row.missionId, {
        version: row.specVersion,
        frozenAt: row.frozenAt,
        bases: Option.getOrElse(readBases(row.bases), () => []),
        dirtyFiles: files
          .filter((file) => file.freezeId === row.id)
          .map((file): FrozenFile => ({
            repository: file.repository,
            path: file.path,
            status: DIRTY_STATUSES.find((one) => one === file.status) ?? 'modified',
            sha256: file.sha256,
            withheld: file.withheld,
          })),
      })
    }
    return found
  })

// --- the Journal ------------------------------------------------------------------------------

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const readBoolean = Schema.decodeUnknownOption(Schema.Boolean)
const readStrings = Schema.decodeUnknownOption(Schema.Array(Schema.String))
const readReason = Schema.decodeUnknownOption(OutdatedReason)

const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const numberOf = (payload: EventPayload, key: string): number =>
  Option.getOrElse(readNumber(payload[key]), () => 0)
const stringsOf = (payload: EventPayload, key: string): ReadonlyArray<string> =>
  Option.getOrElse(readStrings(payload[key]), () => [])

const HEMERA: MemoryAuthor = HemeraAuthor.make({})
const USER: MemoryAuthor = UserAuthor.make({})

/** The Planner's session, as its event names it. */
const planner = (payload: EventPayload): MemoryAuthor =>
  AgentAuthor.make({ role: stringOf(payload, 'role'), sessionId: stringOf(payload, 'sessionId') })

const lineOf =
  (
    author: (payload: EventPayload) => MemoryAuthor,
    text: (payload: EventPayload) => string,
  ): JournalMapper =>
  (event) =>
    Effect.succeed({
      missionId: event.entityId,
      kind: 'planning',
      author: author(event.payload),
      text: text(event.payload),
    })

const byHemera = (): MemoryAuthor => HEMERA
const byUser = (): MemoryAuthor => USER

const filesSaid = (count: number): string =>
  count === 0
    ? 'the main checkout was clean'
    : `${String(count)} dirty file${count === 1 ? '' : 's'} of the main checkout kept`

/** The Freeze's, the dependencies' and the outdated mark's lines in the Journal. */
export const FREEZE_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  [
    'planning.frozen',
    lineOf(
      byUser,
      (payload) =>
        `Spec frozen at version ${String(numberOf(payload, 'version'))}; base commits ${stringsOf(payload, 'bases').join(', ')}; ${filesSaid(numberOf(payload, 'dirtyFiles'))}`,
    ),
  ],
  [
    'planning.freeze_refused',
    lineOf(byHemera, (payload) => `Freeze refused: ${stringsOf(payload, 'reasons').join(' ')}`),
  ],
  [
    'planning.returned',
    lineOf(byUser, (payload) => {
      const reason = stringOf(payload, 'reason')
      return reason === ''
        ? 'Sent back to Planning to update the Spec'
        : `Sent back to Planning to update the Spec: ${reason}`
    }),
  ],
  [
    'dependency.proposed',
    lineOf(
      planner,
      (payload) =>
        `The Planner proposed a dependency on ${stringOf(payload, 'on')}: ${stringOf(payload, 'reason')}`,
    ),
  ],
  [
    'dependency.decided',
    lineOf(
      byUser,
      (payload) =>
        `The user ${Option.getOrElse(readBoolean(payload['accepted']), () => false) ? 'accepted' : 'rejected'} the dependency on ${stringOf(payload, 'on')}`,
    ),
  ],
  [
    'mission.unblocked',
    lineOf(
      byHemera,
      (payload) => `${stringOf(payload, 'on')} is delivered: this mission can be built`,
    ),
  ],
  [
    'mission.outdated',
    lineOf(byHemera, (payload) => {
      const reason = Option.getOrNull(readReason(payload['reason']))
      return `Outdated: ${reason === null ? 'something moved' : outdatedReasonSaid(reason)}: ${stringOf(payload, 'difference')}`
    }),
  ],
])
