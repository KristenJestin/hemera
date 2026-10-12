/**
 * The detector of changes made outside Hemera (#148, CT-22), and the base read during a Building.
 *
 * - **The expected tree.** Per repository of a mission's Workspace, from its Building's start to
 *   the cleanup: the last tree Hemera can explain, kept in `outside_watches`, the Building's base
 *   snapshot at first. A compare takes a #140 snapshot of the working tree (the found tree) and
 *   lists the files that differ from the expected one.
 * - **Attribution, in CT-22's order.** A differing file is Hemera's when a gate write running or
 *   done since the last compare wrote the content found (its fingerprint matches); when a writing
 *   command running or ended since then wrote in that repository, within its globs; when a
 *   service of the Workspace running or ended since then declares globs that hold it. Every other
 *   file is a change outside Hemera: recorded with the contents of both sides, the repository
 *   marked "Changed outside Hemera", the Journal told, and the Builder and every runner working in
 *   that repository told not to overwrite it. Detection is never suspended, whatever runs.
 * - **Once.** The found tree becomes the expected tree, so a change is reported once. What the
 *   writers left is read after the snapshot and from the database, from the time the compare
 *   began, so a write that lands while a compare takes its snapshot, or a restart, never makes a
 *   writer's change look like the user's.
 * - **The bound.** While a writing command runs in a repository, a change the user makes there
 *   is the command's: the uncertainty lasts as long as the command.
 * - **Overwritten.** A command that rewrote a file whose last version was a change outside Hemera
 *   records "overwritten by" on it, and its runner is told; the user's version stays readable
 *   from the contents captured when it was found.
 * - **The base.** Every 15 minutes during Building and when the window regains the focus, the
 *   base of each repository is read by the up-to-date rule (#5, CT-24): a move is recorded and
 *   told, and changes nothing else.
 */

import { posix } from 'node:path'

import { ChangedOutsideMark, LIVE_RUN_STATES } from '@hemera/core/domain'
import { type OutsideContents, type OutsideRepository, UnknownOutsideChange } from '@hemera/ipc'
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { Context, Effect, Layer, Option, PubSub, Schema, Semaphore, Stream } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { getCommand } from '../catalogue.ts'
import type { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { markIn } from '../missions.ts'
import { getProject } from '../projects.ts'
import { type ProjectServices, upToDateBase } from '../repositories.ts'
import { Git } from '../git.ts'
import { Secrets } from '../secrets.ts'
import { Sessions } from '../sessions/service.ts'
import { sessionsIn } from '../sessions/store.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  baseMoves,
  buildingUnattributed,
  buildings,
  commandRuns,
  effectfulActions,
  missions,
  outsideChanges,
  outsideWatches,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type ChangedFile, type FileSide, Snapshots, keepCaptured } from './snapshots.ts'
import {
  type BuildingBase,
  type BuildingRow,
  activeBuildingIn,
  bases,
  buildingEvent,
  latestBuildingIn,
  now,
  tasksIn,
} from './tasks.ts'
import { fileOf } from './place.ts'

/** How often a Workspace is compared while its mission is in Building or Review. */
export const COMPARE_EVERY_MS = 30_000
/** How often the bases are read during a Building (open question 29). */
export const BASE_EVERY_MS = 15 * 60_000

export interface OutsideSettings {
  readonly compareEveryMillis: number
  readonly baseEveryMillis: number
  /** Where a suite holds a compare: once its time is taken, before its snapshot. */
  readonly hold?: (at: 'snapshot') => Effect.Effect<void>
}

/** The stages whose Workspace is watched. */
const WATCHED = ['building', 'review'] as const

/** What a command that ran tells the detector it changed, for "overwritten by". */
export interface CommandRewrote {
  readonly building: BuildingRow
  readonly repository: string
  /** The tree of the repository right before the command launched. */
  readonly before: string
  readonly files: ReadonlyArray<ChangedFile>
  readonly command: string
  readonly runId: string
  readonly sessionId: string
  readonly taskId: string | null
  /** Who is told: the runner of the command's task, or its session's lineage. */
  readonly lineage: string
}

export interface OutsideChangesService {
  /** Compares one repository of the mission's Workspace, or every one for null; never fails. */
  readonly compare: (missionId: string, repository: string | null) => Effect.Effect<void>
  /** The changes outside Hemera of the mission, per repository, oldest first. */
  readonly list: (
    missionId: string,
  ) => Effect.Effect<ReadonlyArray<OutsideRepository>, DatabaseError>
  /** Both sides of a change as Hemera kept them, readable after the Workspace is gone. */
  readonly contents: (
    missionId: string,
    changeId: string,
  ) => Effect.Effect<OutsideContents, DatabaseError | UnknownOutsideChange>
  /** A command rewrote these files: those whose last version was the user's say so. */
  readonly rewrote: (asked: CommandRewrote) => Effect.Effect<void>
  /** Reads the base of each repository of the mission's Building again; never fails. */
  readonly readBases: (missionId: string) => Effect.Effect<void>
  /** The window regained the focus: every watched Workspace compared, the bases read. */
  readonly focused: Effect.Effect<void>
  /** Each mission whose changes outside Hemera or services changed. */
  readonly changes: Stream.Stream<string>
  /** Says a mission's services changed. */
  readonly touched: (missionId: string) => Effect.Effect<void>
}

export class OutsideChanges extends Context.Service<OutsideChanges, OutsideChangesService>()(
  'OutsideChanges',
) {}

const Details = Schema.Struct({
  path: Schema.optionalKey(Schema.String),
  after: Schema.optionalKey(Schema.NullOr(Schema.String)),
  trees: Schema.optionalKey(
    Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
  ),
  globs: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
})
const readDetails = Schema.decodeUnknownOption(Schema.fromJsonString(Details))

const matches = (globs: ReadonlyArray<string>, file: ChangedFile) =>
  globs.some(
    (glob) =>
      posix.matchesGlob(file.path, glob) ||
      (file.oldPath !== null && posix.matchesGlob(file.oldPath, glob)),
  )

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

const placeOf = (base: BuildingBase) => ({ name: base.repository, folder: base.folder })

/** A repository of a Building as the snapshots take it, its folder gone or not. */
const placeIn = (building: BuildingRow, repository: string) => ({
  name: repository,
  folder: basesOf(building).find((one) => one.repository === repository)?.folder ?? '',
})

const named = (repository: string, path: string) =>
  repository === '' || repository === '.' ? path : `${repository}/${path}`

/** The note the agents working in a repository get. */
export const outsideSaid = (files: ReadonlyArray<string>): string =>
  `Changed outside Hemera: ${files.join(', ')}. Do not overwrite these changes: read the file again, keep them, build on them, and say in the Journal what you did.`

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Snapshots
  | Sessions
  | AutomationGate
  | ProjectServices

export const outsideChangesLayer = (log: Log, settings: Partial<OutsideSettings> = {}) =>
  Layer.effect(
    OutsideChanges,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const provided = <A, E, R extends Needs>(effect: Effect.Effect<A, E, R>) =>
        Effect.provide(effect, context)
      const said = (line: string) => Effect.sync(() => log(`outside changes: ${line}`))
      const every = settings.compareEveryMillis ?? COMPARE_EVERY_MS
      const baseEvery = settings.baseEveryMillis ?? BASE_EVERY_MS
      const hold = settings.hold ?? (() => Effect.void)
      const changed = yield* PubSub.unbounded<string>()
      const touched = (missionId: string) => Effect.asVoid(PubSub.publish(changed, missionId))

      /** One compare at a time per repository of a Building; one base read per mission. */
      const turns = new Map<string, Semaphore.Semaphore>()
      const turnOf = (key: string) => {
        const found = turns.get(key)
        if (found !== undefined) return found
        const made = Semaphore.makeUnsafe(1)
        turns.set(key, made)
        return made
      }

      /** The Building whose Workspace is watched: the mission's latest, in Building or Review. */
      const watchedOf = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [mission] = yield* database
            .select({ stage: missions.stage })
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          if (mission === undefined || !WATCHED.some((stage) => stage === mission.stage)) {
            return null
          }
          return yield* latestBuildingIn(database, missionId)
        })

      /** What the writers of the mission left since `since`, read after the snapshot. */
      const writersSince = (building: BuildingRow, since: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database
            .select({ kind: effectfulActions.kind, details: effectfulActions.details })
            .from(effectfulActions)
            .where(
              and(
                eq(effectfulActions.ownerKind, 'mission'),
                eq(effectfulActions.ownerId, building.missionId),
                inArray(effectfulActions.kind, ['file.write', 'command.run']),
                or(isNull(effectfulActions.endedAt), gte(effectfulActions.endedAt, since)),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading what Hemera wrote')))
          const writes: Array<{ repository: string; path: string; after: string }> = []
          const commands: Array<{
            repositories: ReadonlyArray<string>
            globs: ReadonlyArray<string> | null
          }> = []
          for (const row of rows) {
            const details = readDetails(row.details)
            if (Option.isNone(details)) continue
            const { path, after, trees, globs } = details.value
            if (row.kind === 'file.write') {
              const located = path === undefined ? null : fileOf(building, path)
              if (located !== null && after != null) writes.push({ ...located, after })
            } else if (trees !== undefined) {
              // A command declared to write nothing, and a service, keep no trees: they explain
              // nothing as commands.
              commands.push({
                repositories: trees.map((one) => one.repository),
                globs: globs ?? null,
              })
            }
          }
          return { writes, commands }
        })

      /** The declared write globs of the Workspace's services running or ended since `since`. */
      const servicesSince = (building: BuildingRow, repository: string, since: string) =>
        Effect.gen(function* () {
          if (building.workspaceId === null) return []
          const database = yield* Database
          const rows = yield* database
            .select({ projectId: commandRuns.projectId, commandId: commandRuns.commandId })
            .from(commandRuns)
            .where(
              and(
                eq(commandRuns.workspaceId, building.workspaceId),
                eq(commandRuns.type, 'serve'),
                or(
                  inArray(commandRuns.state, [...LIVE_RUN_STATES]),
                  gte(commandRuns.endedAt, since),
                ),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading the services')))
          const globs: string[] = []
          for (const row of rows) {
            if (row.commandId === null) continue
            const command = yield* getCommand(row.projectId, row.commandId).pipe(Effect.option)
            if (Option.isNone(command) || command.value.writeGlobs.length === 0) continue
            const project = yield* getProject(row.projectId)
            const path =
              project.repositories.find((one) => one.id === command.value.repositoryId)?.path ??
              null
            if ((path ?? '') !== repository && !(path === null && repository === '.')) continue
            const prefix = command.value.folder == null ? '' : `${command.value.folder}/`
            globs.push(
              ...command.value.writeGlobs.map((glob) => posix.normalize(`${prefix}${glob}`)),
            )
          }
          return globs
        })

      /** The lineages working in a repository: the runners of its tasks, and the Builder. */
      const workingIn = (building: BuildingRow, repository: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const tasks = yield* tasksIn(database, building.id)
          const runners = tasks
            .filter(
              (task) =>
                task.state === 'in_progress' &&
                task.runner !== null &&
                task.targets.some((one) => one.repository === repository),
            )
            .flatMap((task) => (task.runner === null ? [] : [task.runner]))
          const live = yield* sessionsIn(['starting', 'working', 'idle', 'stuck'], {
            kind: 'mission',
            missionId: building.missionId,
          })
          const builder = live.find((one) => one.role === 'builder')?.lineage ?? null
          return {
            lineages: [...new Set([...(builder === null ? [] : [builder]), ...runners])],
            builder,
          }
        })

      const tell = (
        building: BuildingRow,
        target: { readonly lineage: string } | { readonly role: string },
        kind: string,
        body: string,
      ) =>
        Sessions.use((sessions) =>
          sessions.deliver({
            owner: { kind: 'mission', missionId: building.missionId },
            target,
            kind,
            body,
            urgency: 'urgent',
          }),
        ).pipe(
          Effect.asVoid,
          Effect.catch((refused) => said(`a delivery was not stored: ${refused.message}`)),
        )

      /** One compare of one repository: what changed since the expected tree, attributed. */
      const compareOne = (building: BuildingRow, base: BuildingBase) =>
        Effect.gen(function* () {
          const database = yield* Database
          const snapshots = yield* Snapshots
          const secrets = yield* Secrets
          const place = placeOf(base)
          const [watch] = yield* database
            .select()
            .from(outsideWatches)
            .where(
              and(
                eq(outsideWatches.buildingId, building.id),
                eq(outsideWatches.repository, base.repository),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading what is expected')))
          const expected = watch?.expectedTree ?? base.tree
          const since = watch?.comparedAt ?? building.startedAt
          // Taken before the snapshot: a writer that ends while it is taken is read next time too.
          const startedAt = now()
          yield* hold('snapshot')
          const found = yield* snapshots.take(place, {
            kind: 'outside',
            missionId: building.missionId,
            buildingId: building.id,
          })
          const differing =
            found === expected
              ? []
              : yield* snapshots.changed(building.missionId, place, expected, found)
          // What the writers left is read once the snapshot is taken, never before.
          const writers = differing.length === 0 ? null : yield* writersSince(building, since)
          const serving =
            differing.length === 0 ? [] : yield* servicesSince(building, base.repository, since)
          const outside: ChangedFile[] = []
          for (const file of differing) {
            if (writers === null) break
            // 1. A gate write whose fingerprint matches what was found.
            const written = writers.writes.filter(
              (one) => one.repository === base.repository && one.path === file.path,
            )
            if (written.length > 0 && file.status !== 'D') {
              const side = yield* snapshots
                .read(building.missionId, place, found, file.path)
                .pipe(Effect.orElseSucceed(() => null))
              if (side !== null && written.some((one) => one.after === side.sha256)) continue
            }
            // 2. A writing command of that repository, within its globs.
            if (
              writers.commands.some(
                (one) =>
                  one.repositories.includes(base.repository) &&
                  (one.globs === null || matches(one.globs, file)),
              )
            ) {
              continue
            }
            // 3. A service's declared globs.
            if (serving.length > 0 && matches(serving, file)) continue
            outside.push(file)
          }
          const captured =
            outside.length === 0
              ? null
              : yield* snapshots.collect(building.missionId, place, expected, found, outside)
          const project = yield* getProject(
            (yield* database
              .select({ projectId: missions.projectId })
              .from(missions)
              .where(eq(missions.id, building.missionId))
              .pipe(Effect.mapError(refusedWhile('reading the mission'))))[0]?.projectId ?? '',
          ).pipe(Effect.option)
          const repositoryId = Option.match(project, {
            onNone: () => null,
            onSome: (one) =>
              one.repositories.find((repo) => repo.path === base.repository)?.id ?? null,
          })
          const files = outside.map((file) => named(base.repository, file.path))
          yield* mutate('recording the changes outside Hemera', (transaction) =>
            Effect.gen(function* () {
              const events = []
              const ids = new Map<string, string>()
              if (captured !== null) {
                yield* keepCaptured(transaction, captured).pipe(
                  Effect.mapError(refusedWhile('keeping the contents')),
                )
                for (const file of captured.files) {
                  const id = crypto.randomUUID()
                  ids.set(file.path, id)
                  yield* transaction
                    .insert(outsideChanges)
                    .values({
                      id,
                      missionId: building.missionId,
                      buildingId: building.id,
                      repository: base.repository,
                      path: file.path,
                      oldPath: file.oldPath,
                      status: file.status,
                      detectedAt: startedAt,
                      expectedTree: expected,
                      foundTree: found,
                      beforeSha: file.before?.sha256 ?? null,
                      afterSha: file.after?.sha256 ?? null,
                      withheld: file.after?.withheld ?? file.before?.withheld ?? null,
                    })
                    .pipe(Effect.mapError(refusedWhile('recording a change outside Hemera')))
                }
                if (repositoryId !== null) {
                  events.push(
                    ...(yield* markIn(
                      transaction,
                      building.missionId,
                      ChangedOutsideMark.make({ repositoryId }),
                    )),
                  )
                }
                events.push(
                  buildingEvent(building.missionId, 'mission.changed_outside', {
                    repository: base.repository,
                    files: files.map((one) => secrets.mask(one)),
                  }),
                )
              }
              yield* transaction
                .insert(outsideWatches)
                .values({
                  buildingId: building.id,
                  repository: base.repository,
                  expectedTree: found,
                  comparedAt: startedAt,
                })
                .onConflictDoUpdate({
                  target: [outsideWatches.buildingId, outsideWatches.repository],
                  set: { expectedTree: found, comparedAt: startedAt },
                })
                .pipe(Effect.mapError(refusedWhile('moving the expected tree')))
              // The files #142 left on the Building with no author, seen before this compare.
              const left = yield* transaction
                .select({ path: buildingUnattributed.path })
                .from(buildingUnattributed)
                .where(
                  and(
                    eq(buildingUnattributed.buildingId, building.id),
                    eq(buildingUnattributed.repository, base.repository),
                    isNull(buildingUnattributed.reconciled),
                    lt(buildingUnattributed.seenAt, startedAt),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the files no task wrote')))
              for (const { path } of left) {
                const [change] = yield* transaction
                  .select({ id: outsideChanges.id })
                  .from(outsideChanges)
                  .where(
                    and(
                      eq(outsideChanges.buildingId, building.id),
                      eq(outsideChanges.repository, base.repository),
                      eq(outsideChanges.path, path),
                    ),
                  )
                  .orderBy(desc(outsideChanges.detectedAt))
                  .limit(1)
                  .pipe(Effect.mapError(refusedWhile('reading a change outside Hemera')))
                yield* transaction
                  .update(buildingUnattributed)
                  .set({ reconciled: change === undefined ? 'hemera' : `outside:${change.id}` })
                  .where(
                    and(
                      eq(buildingUnattributed.buildingId, building.id),
                      eq(buildingUnattributed.repository, base.repository),
                      eq(buildingUnattributed.path, path),
                    ),
                  )
                  .pipe(Effect.mapError(refusedWhile('reconciling a file no task wrote')))
              }
              return { result: undefined, events }
            }),
          )
          if (outside.length === 0) return
          const { lineages, builder } = yield* workingIn(building, base.repository)
          const body = outsideSaid(files.map((one) => secrets.mask(one)).toSorted())
          if (builder === null) yield* tell(building, { role: 'builder' }, 'outside', body)
          for (const lineage of lineages) yield* tell(building, { lineage }, 'outside', body)
          yield* touched(building.missionId)
        })

      const compare = (missionId: string, repository: string | null) =>
        Effect.gen(function* () {
          const building = yield* watchedOf(missionId)
          if (building === null) return
          for (const base of basesOf(building)) {
            if (repository !== null && base.repository !== repository) continue
            yield* Semaphore.withPermits(
              turnOf(`${building.id}\u0000${base.repository}`),
              1,
            )(compareOne(building, base)).pipe(
              Effect.catchCause((cause) =>
                said(`${missionId}/${base.repository} was not compared: ${String(cause)}`),
              ),
            )
          }
        }).pipe(
          provided,
          Effect.catchCause((cause) => said(`${missionId} was not compared: ${String(cause)}`)),
        )

      const list = (missionId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database
            .select()
            .from(outsideChanges)
            .where(eq(outsideChanges.missionId, missionId))
            .orderBy(asc(outsideChanges.detectedAt), asc(outsideChanges.path))
            .pipe(Effect.mapError(refusedWhile('reading the changes outside Hemera')))
          const [mission] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          const project =
            mission === undefined
              ? null
              : yield* getProject(mission.projectId).pipe(Effect.orElseSucceed(() => null))
          const repositories = [...new Set(rows.map((row) => row.repository))]
          return repositories.map((repository): OutsideRepository => ({
            repository,
            repositoryId: project?.repositories.find((one) => one.path === repository)?.id ?? null,
            changes: rows
              .filter((row) => row.repository === repository)
              .map((row) => {
                const side = (sha: string | null) =>
                  sha === null ? null : { sha256: sha, size: 0, withheld: row.withheld }
                return {
                  id: row.id,
                  path: row.path,
                  oldPath: row.oldPath,
                  status: row.status,
                  detectedAt: row.detectedAt,
                  before: side(row.beforeSha),
                  after: side(row.afterSha),
                  overwrittenBy:
                    row.overwrittenBy === null ||
                    row.overwrittenRun === null ||
                    row.overwrittenAt === null
                      ? null
                      : {
                          command: row.overwrittenBy,
                          runId: row.overwrittenRun,
                          sessionId: row.overwrittenSession,
                          task: row.overwrittenTask,
                          at: row.overwrittenAt,
                        },
                }
              }),
          }))
        }).pipe(provided)

      const contents = (missionId: string, changeId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(outsideChanges)
            .where(and(eq(outsideChanges.id, changeId), eq(outsideChanges.missionId, missionId)))
            .pipe(Effect.mapError(refusedWhile('reading a change outside Hemera')))
          if (row === undefined) return yield* new UnknownOutsideChange({ id: changeId })
          const [building] = yield* database
            .select()
            .from(buildings)
            .where(eq(buildings.id, row.buildingId))
            .pipe(Effect.mapError(refusedWhile('reading the Building')))
          if (building === undefined) return yield* new UnknownOutsideChange({ id: changeId })
          const [diff] = yield* Snapshots.use((snapshots) =>
            snapshots.diff(
              missionId,
              placeIn(building, row.repository),
              row.expectedTree,
              row.foundTree,
              row.path,
            ),
          ).pipe(
            Effect.catchTag('SnapshotUnavailable', () =>
              Effect.fail(new UnknownOutsideChange({ id: changeId })),
            ),
          )
          const text = (side: FileSide | null | undefined) =>
            side == null
              ? null
              : {
                  content:
                    side.content === null ? null : Buffer.from(side.content).toString('utf8'),
                  withheld: side.withheld,
                }
          return { path: row.path, before: text(diff?.before), after: text(diff?.after) }
        }).pipe(provided)

      const rewrote = (asked: CommandRewrote) =>
        Effect.gen(function* () {
          const database = yield* Database
          const snapshots = yield* Snapshots
          const secrets = yield* Secrets
          const place = placeIn(asked.building, asked.repository)
          for (const file of asked.files) {
            const [last] = yield* database
              .select()
              .from(outsideChanges)
              .where(
                and(
                  eq(outsideChanges.buildingId, asked.building.id),
                  eq(outsideChanges.repository, asked.repository),
                  eq(outsideChanges.path, file.oldPath ?? file.path),
                ),
              )
              .orderBy(desc(outsideChanges.detectedAt))
              .limit(1)
              .pipe(Effect.mapError(refusedWhile('reading a change outside Hemera')))
            if (last === undefined || last.overwrittenBy !== null) continue
            // The user's version was the file's last one when the command launched.
            const before = yield* snapshots
              .read(asked.building.missionId, place, asked.before, last.path)
              .pipe(Effect.orElseSucceed(() => null))
            if ((before?.sha256 ?? null) !== last.afterSha) continue
            const label = named(asked.repository, last.path)
            const command = secrets.mask(asked.command)
            yield* mutate('recording an overwritten change', (transaction) =>
              transaction
                .update(outsideChanges)
                .set({
                  overwrittenBy: command,
                  overwrittenRun: asked.runId,
                  overwrittenSession: asked.sessionId,
                  overwrittenTask: asked.taskId,
                  overwrittenAt: now(),
                })
                .where(eq(outsideChanges.id, last.id))
                .pipe(
                  Effect.mapError(refusedWhile('recording an overwritten change')),
                  Effect.as({
                    result: undefined,
                    events: [
                      buildingEvent(asked.building.missionId, 'mission.overwritten_by_command', {
                        file: secrets.mask(label),
                        command,
                        task: asked.taskId,
                        runId: asked.runId,
                      }),
                    ],
                  }),
                ),
            )
            yield* tell(
              asked.building,
              { lineage: asked.lineage },
              'overwritten',
              `\`${asked.command}\` overwrote your user’s change to ${label}; their version is kept: read both and restore what they meant.`,
            )
            yield* touched(asked.building.missionId)
          }
        }).pipe(
          provided,
          Effect.catchCause((cause) =>
            said(`what a command overwrote was not recorded: ${String(cause)}`),
          ),
        )

      const readBases = (missionId: string) =>
        Semaphore.withPermits(
          turnOf(`bases\u0000${missionId}`),
          1,
        )(
          Effect.gen(function* () {
            const database = yield* Database
            const building = yield* activeBuildingIn(database, missionId)
            if (building === null) return
            const [mission] = yield* database
              .select({ projectId: missions.projectId })
              .from(missions)
              .where(eq(missions.id, missionId))
              .pipe(Effect.mapError(refusedWhile('reading the mission')))
            if (mission === undefined) return
            const project = yield* getProject(mission.projectId)
            const tasks = yield* tasksIn(database, building.id)
            for (const base of basesOf(building)) {
              const repository = project.repositories.find((one) => one.path === base.repository)
              if (repository === undefined) continue
              const read = yield* upToDateBase(repository.id).pipe(Effect.option)
              if (Option.isNone(read)) continue
              const [last] = yield* database
                .select({ to: baseMoves.toCommit })
                .from(baseMoves)
                .where(
                  and(
                    eq(baseMoves.buildingId, building.id),
                    eq(baseMoves.repository, base.repository),
                  ),
                )
                .orderBy(desc(baseMoves.at))
                .limit(1)
                .pipe(Effect.mapError(refusedWhile('reading the moves of the base')))
              const from = last?.to ?? base.commit
              const to = read.value.commit
              if (to === from) continue
              const folder =
                base.repository === '.' || base.repository === ''
                  ? project.mainCheckout
                  : posix.join(project.mainCheckout.replaceAll('\\', '/'), base.repository)
              const changes = yield* Git.use((git) => git.changesBetween(folder, from, to)).pipe(
                Effect.orElseSucceed(() => []),
              )
              const files = [...new Set(changes.map((one) => one.path))].toSorted()
              const targeted = files.filter((path) =>
                tasks.some((task) =>
                  task.targets.some(
                    (one) => one.repository === base.repository && one.path === path,
                  ),
                ),
              )
              yield* mutate('recording a move of the base', (transaction) =>
                transaction
                  .insert(baseMoves)
                  .values({
                    id: crypto.randomUUID(),
                    missionId,
                    buildingId: building.id,
                    repository: base.repository,
                    fromCommit: from,
                    toCommit: to,
                    files: JSON.stringify(files),
                    targeted: JSON.stringify(targeted),
                    at: now(),
                  })
                  .pipe(
                    Effect.mapError(refusedWhile('recording a move of the base')),
                    Effect.as({
                      result: undefined,
                      events: [
                        buildingEvent(missionId, 'building.base_moved', {
                          repository: base.repository,
                          from,
                          to,
                          files: files.length,
                          targeted,
                        }),
                      ],
                    }),
                  ),
              )
            }
          }),
        ).pipe(
          provided,
          Effect.catchCause((cause) =>
            said(`the bases of ${missionId} were not read: ${String(cause)}`),
          ),
        )

      /** The missions in a stage, by id. */
      const missionsIn = (stages: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database
            .select({ id: missions.id })
            .from(missions)
            .where(inArray(missions.stage, [...stages]))
            .pipe(Effect.mapError(refusedWhile('reading the missions')))
          return rows.map((row) => row.id)
        }).pipe(
          provided,
          Effect.orElseSucceed((): ReadonlyArray<string> => []),
        )

      const compareAll = Effect.flatMap(missionsIn(WATCHED), (ids) =>
        Effect.forEach(ids, (id) => compare(id, null), { discard: true }),
      )
      const readAll = Effect.flatMap(missionsIn(['building']), (ids) =>
        Effect.forEach(ids, readBases, { discard: true }),
      )
      const focused = Effect.andThen(compareAll, readAll)

      // The timers, once the automations may act: never suspended, whatever runs.
      const gate = yield* AutomationGate
      yield* Effect.forkScoped(
        Effect.andThen(gate.pass, Effect.forever(Effect.andThen(Effect.sleep(every), compareAll))),
      )
      yield* Effect.forkScoped(
        Effect.andThen(gate.pass, Effect.forever(Effect.andThen(Effect.sleep(baseEvery), readAll))),
      )

      return {
        compare,
        list,
        contents,
        rewrote,
        readBases,
        focused,
        changes: Stream.fromPubSub(changed),
        touched,
      }
    }),
  )

/** No detector: a Profile started without the Builder's engine. */
export const noOutsideChanges = Layer.succeed(OutsideChanges, {
  compare: () => Effect.void,
  list: () => Effect.succeed([]),
  contents: (_missionId, changeId) => Effect.fail(new UnknownOutsideChange({ id: changeId })),
  rewrote: () => Effect.void,
  readBases: () => Effect.void,
  focused: Effect.void,
  changes: Stream.empty,
  touched: () => Effect.void,
})
