/**
 * The Probes as they are kept (#89): their rows, what they captured, their events and their lines
 * in the Journal, and what the Planning page reads of them (each one's LiveChip, one Probe whole,
 * and the chips again at each change).
 *
 * Every event of a Probe is about its mission (`entityKind` mission), so the mission's Journal and
 * whoever follows the mission hear it.
 */

import {
  PROBE_OUTCOMES,
  PROBE_STATES,
  ProbeReport,
  type ProbeState,
  probeLabel,
} from '@hemera/core/domain'
import {
  BaseFreshness,
  HemeraAuthor,
  type ProbeChip,
  type ProbeDetail,
  type ProbeFile,
  UnknownMission,
  UnknownProbe,
} from '@hemera/ipc'
import { asc, eq } from 'drizzle-orm'
import { Effect, Option, Schema, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { EventPayload, NewEvent } from '../journal.ts'
import type { JournalMapper } from '../memory/index.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { missions, probeContents, probeFiles, probes } from '../storage/schema.ts'

export type ProbeRow = typeof probes.$inferSelect

/** The folder of Hemera's data folder the Probes' worktrees live in. */
export const PROBES_FOLDER = 'probes'

/** The commit a repository's worktree of a Probe was made from, as it is kept. */
export const ProbeBaseKept = Schema.Struct({
  repositoryId: Schema.String,
  repository: Schema.String,
  commit: Schema.String,
  ref: Schema.String,
  freshness: BaseFreshness,
})
export type ProbeBaseKept = typeof ProbeBaseKept.Type

const BasesJson = Schema.fromJsonString(Schema.Array(ProbeBaseKept))
const readBases = Schema.decodeUnknownOption(BasesJson)
export const writeBases = Schema.encodeSync(BasesJson)

/** The bases a Probe was made from; none before they were read. */
export const basesOf = (row: ProbeRow): ReadonlyArray<ProbeBaseKept> =>
  row.bases === null ? [] : Option.getOrElse(readBases(row.bases), () => [])

/** A file the preparation of a Probe left in its worktree, by its hash. */
export const ProbePreparedFile = Schema.Struct({
  repository: Schema.String,
  path: Schema.String,
  sha256: Schema.String,
})
export type ProbePreparedFile = typeof ProbePreparedFile.Type

const PreparedJson = Schema.fromJsonString(Schema.Array(ProbePreparedFile))
const readPrepared = Schema.decodeUnknownOption(PreparedJson)
export const writePrepared = Schema.encodeSync(PreparedJson)

/** What the preparation left in a Probe's worktree; nothing before it was taken. */
export const preparedOf = (row: ProbeRow): ReadonlyArray<ProbePreparedFile> =>
  row.prepared === null ? [] : Option.getOrElse(readPrepared(row.prepared), () => [])

const readReport = Schema.decodeUnknownOption(Schema.fromJsonString(ProbeReport))

/** A Probe's report, once it reported. */
export const reportOf = (row: ProbeRow): ProbeReport | null =>
  row.report === null ? null : Option.getOrNull(readReport(row.report))

const stateOf = (state: string): ProbeState => PROBE_STATES.find((one) => one === state) ?? 'failed'
const outcomeOf = (outcome: string | null) => PROBE_OUTCOMES.find((one) => one === outcome) ?? null

/** One of a Probe's events, about its mission. */
export const probeEvent = (
  type: string,
  row: Pick<ProbeRow, 'id' | 'missionId' | 'number'>,
  payload: EventPayload = {},
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: row.missionId,
  source: 'system',
  author: 'hemera',
  payload: { probeId: row.id, number: row.number, ...payload },
})

export const probeRow = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(probes)
      .where(eq(probes.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a Probe')))
    return row ?? null
  })

/** A mission's Probes, the first launched first. */
export const probeRowsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select()
      .from(probes)
      .where(eq(probes.missionId, missionId))
      .orderBy(asc(probes.number))
      .pipe(Effect.mapError(refusedWhile('reading the Probes')))
  })

/** Every Probe of the Profile. */
export const allProbeRows = Effect.gen(function* () {
  const database = yield* Database
  return yield* database
    .select()
    .from(probes)
    .pipe(Effect.mapError(refusedWhile('reading the Probes')))
})

/** The Probe a session's lineage works for, or null. */
export const probeOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(probes)
      .where(eq(probes.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a Probe')))
    return row ?? null
  })

export const chipOf = (row: ProbeRow): ProbeChip => ({
  id: row.id,
  missionId: row.missionId,
  number: row.number,
  label: probeLabel(row.number),
  question: row.question,
  scenario: row.scenario,
  state: stateOf(row.state),
  stuck: row.stuck,
  startedAt: row.startedAt,
  endedAt: row.endedAt,
  outcome: outcomeOf(row.outcome),
})

const missionThere = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [mission] = yield* database
      .select({ id: missions.id })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (mission === undefined) return yield* new UnknownMission({ id: missionId })
  })

/** A mission's Probes as their LiveChips show them. */
export const listProbes = (missionId: string) =>
  Effect.gen(function* () {
    yield* missionThere(missionId)
    return (yield* probeRowsOf(missionId)).map(chipOf)
  })

/** What a Probe captured, its contents with it. */
const filesOf = (probeId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({
        repository: probeFiles.repository,
        path: probeFiles.path,
        status: probeFiles.status,
        sha256: probeFiles.sha256,
        patch: probeFiles.patch,
        withheld: probeFiles.withheld,
        content: probeContents.content,
      })
      .from(probeFiles)
      .leftJoin(probeContents, eq(probeContents.sha256, probeFiles.sha256))
      .where(eq(probeFiles.probeId, probeId))
      .orderBy(asc(probeFiles.repository), asc(probeFiles.path))
      .pipe(Effect.mapError(refusedWhile('reading what a Probe captured')))
    return rows.map((row): ProbeFile => ({
      repository: row.repository,
      path: row.path,
      status: row.status === 'new' || row.status === 'deleted' ? row.status : 'modified',
      sha256: row.sha256,
      content: row.withheld === null ? row.content : null,
      patch: row.patch,
      withheld: row.withheld,
    }))
  })

/** One Probe whole: its report, what it captured, its evidence. */
export const readProbe = (probeId: string) =>
  Effect.gen(function* () {
    const row = yield* probeRow(probeId)
    if (row === null) return yield* new UnknownProbe({ id: probeId })
    const report = reportOf(row)
    const detail: ProbeDetail = {
      ...chipOf(row),
      brief: row.brief,
      folder: row.folder,
      bases: basesOf(row).map(({ repository, commit, ref, freshness }) => ({
        repository,
        commit,
        ref,
        freshness,
      })),
      answer: row.answer,
      report,
      files: yield* filesOf(row.id),
      evidence: report?.evidence ?? [],
      failure: row.failure,
      wipeError: row.wipeError,
    }
    return detail
  })

/** A mission's chips now, then again after each change of the mission, its Probes included. */
export const probeChanges = (missionId: string) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const committed = yield* DomainEvents.use((events) => events.subscribe)
      return Stream.concat(
        Stream.fromEffect(listProbes(missionId)),
        committed.pipe(
          Stream.filter(
            (event) =>
              event.entityKind === 'mission' &&
              event.entityId === missionId &&
              event.type.startsWith('probe.'),
          ),
          Stream.mapEffect(() => listProbes(missionId)),
        ),
      )
    }),
  )

const readString = Schema.decodeUnknownOption(Schema.String)
const readNumber = Schema.decodeUnknownOption(Schema.Number)
const stringOf = (payload: EventPayload, key: string): string =>
  Option.getOrElse(readString(payload[key]), () => '')
const labelOf = (payload: EventPayload): string =>
  probeLabel(Option.getOrElse(readNumber(payload['number']), () => 0))

const line =
  (text: (payload: EventPayload) => string | null): JournalMapper =>
  (event) =>
    Effect.succeed(
      Option.match(Option.fromNullishOr(text(event.payload)), {
        onNone: () => null,
        onSome: (said) => ({
          missionId: event.entityId,
          kind: 'probe',
          author: HemeraAuthor.make({}),
          text: said,
          refs: {},
        }),
      }),
    )

/**
 * The Probes' lines in the Journal. A launch the budget refused already has its line
 * (`budget.refused`); a stuck session already has the parent's delivery, and its own line once it
 * is replaced (#40).
 */
export const PROBE_MAPPERS: ReadonlyMap<string, JournalMapper> = new Map([
  [
    'probe.launched',
    line((payload) => {
      const scenario = stringOf(payload, 'scenario')
      return `Probe ${labelOf(payload)} launched${scenario === '' ? '' : ` for ${scenario}`}: ${stringOf(payload, 'question')}`
    }),
  ],
  [
    'probe.refused',
    line((payload) =>
      stringOf(payload, 'by') === 'budget'
        ? null
        : `A launch of a Probe was refused: ${stringOf(payload, 'reason')}`,
    ),
  ],
  [
    'probe.ended',
    line(
      (payload) =>
        `Probe ${labelOf(payload)} ended, ${stringOf(payload, 'outcome').replace('_', ' ')}: ${stringOf(payload, 'answer')}`,
    ),
  ],
  [
    'probe.failed',
    line((payload) => `Probe ${labelOf(payload)} failed: ${stringOf(payload, 'why')}`),
  ],
  [
    'probe.interrupted',
    line((payload) => `Probe ${labelOf(payload)} was interrupted by a restart; it is relaunched`),
  ],
  ['probe.wiped', line((payload) => `Probe ${labelOf(payload)}'s worktree was wiped`)],
  [
    'probe.wipe_failed',
    line(
      (payload) =>
        `Probe ${labelOf(payload)}'s worktree could not be wiped: ${stringOf(payload, 'error')}; it is tried again at the next start`,
    ),
  ],
])
