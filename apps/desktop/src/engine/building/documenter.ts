/**
 * The documenter (#146): a fixed phase at the end of every Building, run again at every round,
 * that brings the Project's documentation in line with what the code now does, in the same diff as
 * the code. #147 calls `run` in the end of a Building's sequence; R2 calls it at each round.
 *
 * - **A pass.** `run(buildingId, mode)` records a pass and its `end` attempt named "documentation",
 *   with the snapshots it starts from (#140) and the files its brief hands: the Building's changed
 *   files since its base snapshot that #142 attributed (`full`), or the files it is handed
 *   (`delta`). It waits for a slot of the Project's cap like any fixed phase (CT-13: never refused,
 *   nothing spent; Now says "Documentation waits for a free agent slot"), then opens a session of
 *   the role `documenter` in the Workspace, a child of the mission, launched by Hemera. It answers
 *   the pass's outcome once the pass ends: the files documented, the reason nothing changed, or
 *   why it failed, which the caller records.
 * - **The guard.** Its `fs_write` and `fs_edit` are refused outside the files the applicable
 *   recipes of the mission's copy name, wherever a file cannot be placed in the Workspace, and
 *   once its pass ended. Its writes are attributed to its attempt (the loop).
 * - **The report.** `docs_report` names the files changed in this pass (each checked against the
 *   pass's snapshots) with why, or a reason specific to the change; it is kept as evidence and
 *   journalled, the attempt ends with its files, and the session ends.
 * - **Health.** A turn that ends without the report is reminded once; a second one fails the pass
 *   with "the documenter gave no report". A session that stops for good fails it too.
 * - **The limit.** At most two passes per Building (CT-39), a failed one not counted; a third is
 *   refused. `deltaNeeded` says what changed since the last pass outside the recipes' files: #147
 *   runs the delta pass on it.
 * - **A stop.** A pass a stopped engine left waiting or running fails at the next start
 *   (`STOPPED_DURING_PASS`): its caller is gone with the engine, and decides again from the
 *   Building.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'

import {
  DOCUMENTATION,
  type DocFile,
  ROOT_REPOSITORY,
  type ToolArguments,
  noChangeReasonProblem,
  recipesCover,
} from '@hemera/core/domain'
import { AgentAuthor } from '@hemera/ipc'
import { and, eq, gt, isNull } from 'drizzle-orm'
import {
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { putEvidence } from '../memory/evidence.ts'
import { Memory } from '../memory/index.ts'
import type { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  attemptWrites,
  buildingAttempts,
  buildings,
  documenterPasses,
  missions,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { readOwnSync } from '../tools/judged.ts'
import type { GuardedCall } from '../tools/ports.ts'
import { mutate } from '../transaction.ts'
import { type Preparations, getWorkspace } from '../workspaces.ts'
import { attributedIn, writesIn } from './attempts.ts'
import { DocsDesk } from './docs-desk.ts'
import { fileOf, inRepository, realFolder } from './place.ts'
import {
  type PassFile,
  type PassRow,
  type ReportedFile,
  applicableRecipes,
  passFiles,
  passOfLineage,
  passesGoing,
  passesIn,
  passesSpent,
  reportedFiles,
} from './documenter-store.ts'
import { Snapshots } from './snapshots.ts'
import {
  type AttemptFile,
  type BuildingBase,
  type BuildingRow,
  attemptFiles,
  bases,
  buildingEvent,
  now,
  writeTrees,
} from './tasks.ts'

/** Why a pass a stopped engine left fails at the next start. */
export const STOPPED_DURING_PASS = 'Hemera stopped during the pass'

/** Why a pass fails when its caller stops waiting, as it does when Hemera stops. */
export const CALLER_STOPPED = 'its caller stopped waiting'

/** Whether a pass failed only because Hemera stopped: its caller runs it again. */
export const stoppedByHemera = (why: string | null): boolean =>
  why === STOPPED_DURING_PASS || why === CALLER_STOPPED

/** What a pass is asked to look at: the whole Building, or the files the special tasks changed. */
export type DocumenterMode =
  | { readonly kind: 'full' }
  | {
      readonly kind: 'delta'
      readonly files: ReadonlyArray<{ readonly repository: string; readonly path: string }>
    }

/** How a pass ended, as its caller records it. */
export type DocumenterOutcome =
  | { readonly outcome: 'documented'; readonly changed: ReadonlyArray<ReportedFile> }
  | { readonly outcome: 'no_change'; readonly reason: string }
  | { readonly outcome: 'failed'; readonly why: string }

/** A pass that cannot run, and why in words. */
export class DocumenterRefused extends Schema.TaggedError<DocumenterRefused>()(
  'DocumenterRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

export class Documenter extends Context.Service<
  Documenter,
  {
    /** One pass of the documenter in a Building, answered once it ends. */
    readonly run: (
      buildingId: string,
      mode: DocumenterMode,
    ) => Effect.Effect<DocumenterOutcome, DocumenterRefused>
    /**
     * The files changed in the Building since the documenter's last pass ended, outside the files
     * the applicable recipes name: the delta pass's, none before a first pass.
     */
    readonly deltaNeeded: (
      buildingId: string,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly repository: string; readonly path: string }>,
      DatabaseError
    >
  }
>()('Documenter') {}

export interface DocumenterSettings {
  readonly log: Log
}

/** What a documenter that ended a turn without its report is told, once. */
export const END_WITH_DOCS_REPORT =
  'End with docs_report: the files you changed and why, or why this change needs no documentation. Your report is the only thing you return.'

/** Why a documenter that ended its turns twice without a report fails its pass. */
export const NO_REPORT = 'the documenter gave no report'

/** How long a documenter's turn may go on after its report before its session is ended. */
const REPORT_TURN_BOUND = Duration.minutes(2)

/** What Now names the documenter while it waits for a slot. */
const PHASE = 'Documentation'

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const readString = Schema.decodeUnknownOption(Schema.String)

const fileSaid = (file: DocFile): string =>
  file.repository === ROOT_REPOSITORY ? file.path : `${file.repository}/${file.path}`

/** A cause in one line. */
const said = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause).split('\n')[0] ?? ''

/** The most of a file of the Workspace's root a digest reads. */
const DIGEST_CAP = 256 * 1024 * 1024

/**
 * A file's content as a digest, or null when it does not exist or is not read: a pipe, a link or
 * a file over the cap, refused without waiting (#434).
 */
const digestOf = (file: string): string | null => {
  try {
    return createHash('sha256').update(readOwnSync(file, DIGEST_CAP).bytes).digest('hex')
  } catch {
    return null
  }
}

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | SessionPost
  | Cap
  | Snapshots
  | ProfileHome
  | AutomationGate
  | Memory
  | DocsDesk
  | Preparations

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

const placeOf = (base: BuildingBase) => ({ name: base.repository, folder: base.folder })

const TreesJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ repository: Schema.String, tree: Schema.String })),
)
const readTrees = Schema.decodeUnknownOption(TreesJson)

export const documenterLayer = (settings: DocumenterSettings) =>
  Layer.effect(
    Documenter,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const sessions = yield* Sessions
      const cap = yield* Cap
      const post = yield* SessionPost
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`documenter: ${line}`))
      /** One pass recorded at a time: two never share a number. */
      const lock = yield* Semaphore.make(1)
      /** What each pass's caller waits on, by pass. */
      const outcomes = new Map<string, Deferred.Deferred<DocumenterOutcome>>()
      /**
       * The files of the Workspace root outside every repository each pass wrote, with their
       * digest before its first write: no snapshot holds them, so the report reads them here.
       */
      const rootBefore = new Map<string, Map<string, string | null>>()

      const passEvent = (
        row: PassRow,
        type: string,
        payload: NewEvent['payload'] = {},
        agent: { readonly sessionId: string; readonly role: string } | null = null,
      ) => buildingEvent(row.missionId, type, { pass: row.number, ...payload }, agent)

      const buildingRow = (buildingId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(buildings)
            .where(eq(buildings.id, buildingId))
            .pipe(Effect.mapError(refusedWhile('reading the Building')))
          return row ?? null
        })

      const passRow = (passId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(documenterPasses)
            .where(eq(documenterPasses.id, passId))
            .pipe(Effect.mapError(refusedWhile('reading the documenter’s pass')))
          return row ?? null
        })

      /** The pass's caller is answered, once. */
      const answer = (passId: string, outcome: DocumenterOutcome) =>
        Effect.gen(function* () {
          const waiting = outcomes.get(passId)
          outcomes.delete(passId)
          rootBefore.delete(passId)
          if (waiting !== undefined) yield* Deferred.succeed(waiting, outcome)
        })

      /** Its session ended once its turn is over, and its slot freed. */
      const leave = (lineage: string, reason: string) =>
        Effect.gen(function* () {
          yield* sessions
            .end(lineage, reason)
            .pipe(Effect.ensuring(cap.release(lineage).pipe(Effect.ignore)))
        })

      /** A pass waiting or running fails: its attempt ends, the Journal and its caller are told. */
      const fail = (passId: string, why: string) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const failed = yield* mutate('failing the documenter’s pass', (transaction) =>
            Effect.gen(function* () {
              const [row] = yield* transaction
                .update(documenterPasses)
                .set({ state: 'failed', failure: secrets.mask(why), endedAt: now() })
                .where(eq(documenterPasses.id, passId))
                .returning()
                .pipe(Effect.mapError(refusedWhile('failing the documenter’s pass')))
              if (row === undefined) return { result: null, events: [] }
              yield* transaction
                .update(buildingAttempts)
                .set({ endedAt: now(), outcome: 'failed' })
                .where(
                  and(eq(buildingAttempts.id, row.attemptId), isNull(buildingAttempts.endedAt)),
                )
                .pipe(Effect.mapError(refusedWhile('ending the documentation attempt')))
              return {
                result: row,
                events: [passEvent(row, 'building.documenter_failed', { why: secrets.mask(why) })],
              }
            }),
          )
          if (failed === null) return
          yield* answer(passId, { outcome: 'failed', why })
          yield* leave(failed.lineage, why)
        })

      /** Fails a pass that still waits or runs; nothing for one that ended. */
      const failGoing = (passId: string, why: string) =>
        Effect.gen(function* () {
          const row = yield* passRow(passId)
          if (row?.state !== 'waiting_for_slot' && row?.state !== 'running') return
          yield* fail(passId, why)
        })

      // --- a pass -----------------------------------------------------------------------------

      /** The files a pass hands its documenter, and the trees it starts from. */
      const startOf = (building: BuildingRow, attemptId: string, mode: DocumenterMode) =>
        Effect.gen(function* () {
          const database = yield* Database
          const snapshots = yield* Snapshots
          const written = yield* writesIn(database, building.id)
          const starts: Array<{ repository: string; tree: string }> = []
          const files: PassFile[] = []
          for (const base of basesOf(building)) {
            const tree = yield* snapshots.take(placeOf(base), {
              kind: 'attempt',
              missionId: building.missionId,
              attemptId,
              side: 'start',
            })
            starts.push({ repository: base.repository, tree })
            const changed = yield* snapshots.changed(
              building.missionId,
              placeOf(base),
              base.tree,
              tree,
            )
            const statusOf = (path: string) =>
              changed.find((one) => one.path === path)?.status ?? 'M'
            if (mode.kind === 'delta') {
              for (const file of mode.files) {
                if (file.repository !== base.repository) continue
                files.push({ ...file, status: statusOf(file.path) })
              }
              continue
            }
            for (const file of changed) {
              const attributed = written.some(
                (one) =>
                  one.repository === base.repository &&
                  (one.path === file.path || one.path === file.oldPath),
              )
              if (attributed) {
                files.push({ repository: base.repository, path: file.path, status: file.status })
              }
            }
          }
          return { starts, files }
        })

      const run = (buildingId: string, mode: DocumenterMode) =>
        Effect.gen(function* () {
          const building = yield* buildingRow(buildingId)
          if (building === null || building.state !== 'active') {
            return yield* new DocumenterRefused({ reason: 'the Building is not under way' })
          }
          const folder =
            building.workspaceId === null
              ? null
              : yield* getWorkspace(building.workspaceId).pipe(
                  Effect.map((workspace) => workspace.folder),
                  Effect.catchTag('UnknownWorkspace', () => Effect.succeed(null)),
                )
          if (folder === null) {
            return yield* new DocumenterRefused({ reason: 'the Building has no Workspace' })
          }
          const recorded = yield* Semaphore.withPermits(
            lock,
            1,
          )(
            Effect.gen(function* () {
              const database = yield* Database
              const passes = yield* passesIn(database, building.id)
              const spent = passesSpent(passes)
              if (spent !== null) return yield* new DocumenterRefused({ reason: spent })
              const attemptId = crypto.randomUUID()
              const start = yield* startOf(building, attemptId, mode)
              const documentation = (yield* database
                .select({ id: buildingAttempts.id })
                .from(buildingAttempts)
                .where(
                  and(
                    eq(buildingAttempts.buildingId, building.id),
                    eq(buildingAttempts.scope, 'end'),
                    eq(buildingAttempts.subject, DOCUMENTATION),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the attempts')))).length
              const row: PassRow = {
                id: crypto.randomUUID(),
                buildingId: building.id,
                missionId: building.missionId,
                number: passes.length + 1,
                mode: mode.kind,
                files: passFiles.write(start.files),
                state: 'waiting_for_slot',
                lineage: crypto.randomUUID(),
                attemptId,
                reminded: false,
                changed: null,
                noChangeReason: null,
                evidenceId: null,
                failure: null,
                startedAt: now(),
                endedAt: null,
              }
              yield* mutate('recording the documenter’s pass', (transaction) =>
                Effect.gen(function* () {
                  yield* transaction
                    .insert(buildingAttempts)
                    .values({
                      id: attemptId,
                      buildingId: building.id,
                      taskId: null,
                      scope: 'end',
                      subject: DOCUMENTATION,
                      number: documentation + 1,
                      runner: row.lineage,
                      epoch: 0,
                      starts: writeTrees(start.starts),
                      startedAt: row.startedAt,
                      outside: '[]',
                    })
                    .pipe(Effect.mapError(refusedWhile('opening the documentation attempt')))
                  yield* transaction
                    .insert(documenterPasses)
                    .values(row)
                    .pipe(Effect.mapError(refusedWhile('recording the documenter’s pass')))
                  return { result: undefined, events: [] }
                }),
              )
              return row
            }),
          )
          const outcome = yield* Deferred.make<DocumenterOutcome>()
          outcomes.set(recorded.id, outcome)
          const starting = Effect.gen(function* () {
            const database = yield* Database
            const [mission] = yield* database
              .select({ projectId: missions.projectId })
              .from(missions)
              .where(eq(missions.id, building.missionId))
              .pipe(Effect.mapError(refusedWhile('reading the mission')))
            const projectId = mission?.projectId ?? ''
            yield* cap.acquire({
              projectId,
              lineage: recorded.lineage,
              missionId: building.missionId,
              requestedBy: 'hemera',
              phase: PHASE,
              queued: mutate('saying the documenter waits', () =>
                Effect.succeed({
                  result: undefined,
                  events: [passEvent(recorded, 'building.documenter_waiting', { mode: mode.kind })],
                }),
              ).pipe(provided, Effect.ignore),
            })
            const started = yield* mutate('starting the documenter’s pass', (transaction) =>
              Effect.gen(function* () {
                const [row] = yield* transaction
                  .update(documenterPasses)
                  .set({ state: 'running' })
                  .where(
                    and(
                      eq(documenterPasses.id, recorded.id),
                      eq(documenterPasses.state, 'waiting_for_slot'),
                    ),
                  )
                  .returning()
                  .pipe(Effect.mapError(refusedWhile('starting the documenter’s pass')))
                if (row === undefined) return { result: false, events: [] }
                return {
                  result: true,
                  events: [passEvent(row, 'building.documenter_started', { mode: mode.kind })],
                }
              }),
            )
            if (!started) return
            const opened = yield* sessions
              .open({
                id: recorded.lineage,
                owner: { kind: 'mission', missionId: building.missionId },
                role: 'documenter',
                folder,
                requestedBy: 'hemera',
              })
              .pipe(Effect.result)
            if (Result.isFailure(opened)) {
              const why = Predicate.isTagged(opened.failure, 'SessionRefused')
                ? opened.failure.reason
                : opened.failure.message
              yield* fail(recorded.id, `the documenter did not start: ${why}`)
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : fail(recorded.id, `the documenter did not start: ${said(cause)}`),
            ),
          )
          // A caller that stops, while the pass waits for a slot, opens its session or runs, fails
          // it: its slot and its session go with it.
          return yield* Effect.andThen(starting, Deferred.await(outcome)).pipe(
            Effect.onInterrupt(() => failGoing(recorded.id, CALLER_STOPPED).pipe(Effect.ignore)),
          )
        }).pipe(
          provided,
          Effect.catchTags({
            DatabaseError: (error) => Effect.fail(new DocumenterRefused({ reason: error.message })),
            SnapshotFailed: (error) =>
              Effect.fail(new DocumenterRefused({ reason: error.message })),
          }),
        )

      // --- what follows its sessions ------------------------------------------------------------

      /** A turn that ended without the report: told once, then the pass fails. */
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'documenter') return
          const database = yield* Database
          const found = yield* passOfLineage(database, session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const row = yield* passRow(found.id)
          if (row?.state !== 'running') return
          if (row.reminded) return yield* fail(row.id, NO_REPORT)
          yield* mutate('reminding the documenter', (transaction) =>
            transaction
              .update(documenterPasses)
              .set({ reminded: true })
              .where(eq(documenterPasses.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('reminding the documenter')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_DOCS_REPORT,
          })
        })

      /** A documenter's session stopped for good, with no live session left in its lineage. */
      const stoppedSession = (lineage: string, why: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const row = yield* passOfLineage(database, lineage)
          if (row?.state !== 'running') return
          const live = (yield* sessionsOfLineage(lineage)).some((one) =>
            LIVE.some((state) => state === one.state),
          )
          if (live) return
          yield* fail(row.id, `its session stopped: ${why}`)
        })

      // --- the report and the guard ------------------------------------------------------------

      /** The files changed in a pass so far, by repository, and the trees they were read at. */
      const changedInPass = (building: BuildingRow, row: PassRow) =>
        Effect.gen(function* () {
          const snapshots = yield* Snapshots
          const database = yield* Database
          const [attempt] = yield* database
            .select({ starts: buildingAttempts.starts })
            .from(buildingAttempts)
            .where(eq(buildingAttempts.id, row.attemptId))
            .pipe(Effect.mapError(refusedWhile('reading the documentation attempt')))
          const from = Option.getOrElse(readTrees(attempt?.starts ?? '[]'), () => [])
          const ends: Array<{ repository: string; tree: string }> = []
          const changed: Array<{
            readonly base: BuildingBase
            readonly from: string | null
            readonly to: string
            readonly files: Effect.Success<ReturnType<typeof snapshots.changed>>
          }> = []
          for (const base of basesOf(building)) {
            const to = yield* snapshots.take(placeOf(base), {
              kind: 'attempt',
              missionId: building.missionId,
              attemptId: row.attemptId,
              side: 'end',
            })
            ends.push({ repository: base.repository, tree: to })
            const start = from.find((one) => one.repository === base.repository)?.tree ?? null
            changed.push({
              base,
              from: start,
              to,
              files: yield* snapshots.changed(building.missionId, placeOf(base), start, to),
            })
          }
          return { ends, changed }
        })

      const report = (grant: Grant, args: ToolArguments<'docs_report'>) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const database = yield* Database
          const session = yield* getSession(grant.sessionId)
          const found = yield* passOfLineage(database, session.lineage)
          if (found === null) return refusal('refused: only the documenter reports its pass')
          if (found.state !== 'running') {
            return refusal(
              found.state === 'reported'
                ? 'refused: you reported already; end your turn'
                : 'refused: this pass of the documenter has ended',
            )
          }
          const building = yield* buildingRow(found.buildingId)
          if (building === null) return refusal('refused: the Building is gone')
          // A file listed twice is kept once, with its first why.
          const listed: ReportedFile[] = []
          for (const one of args.changed) {
            const file = {
              repository: one.repository.trim().replace(/^\.\/$/, '') || ROOT_REPOSITORY,
              path: one.path.trim().replaceAll('\\', '/'),
              why: one.why.trim(),
            }
            if (listed.some((kept) => fileSaid(kept) === fileSaid(file))) continue
            listed.push(file)
          }
          const reason = args.no_change_reason?.trim() ?? ''
          if (listed.length === 0) {
            const problem = noChangeReasonProblem(args.no_change_reason)
            if (problem !== null) return refusal(`refused: ${problem}`)
          }
          const pass = yield* changedInPass(building, found)
          // The Workspace root's own files, when it is no repository: their digests, then and now.
          const rootChanged = [...(rootBefore.get(found.id) ?? new Map<string, string | null>())]
            .filter(
              ([path, before]) => digestOf(join(realFolder(grant.place.root), path)) !== before,
            )
            .map(([path]) => ({ repository: ROOT_REPOSITORY, path }))
          for (const file of listed) {
            const changed =
              pass.changed.some(
                (one) =>
                  one.base.repository === file.repository &&
                  one.files.some((each) => each.path === file.path),
              ) || rootChanged.some((one) => fileSaid(one) === fileSaid(file))
            if (!changed) return refusal(`refused: ${fileSaid(file)} did not change in this pass`)
          }
          // The attempt's diff: the files written under its name that changed in the pass.
          const own = yield* attributedIn(database, found.attemptId)
          const owned = pass.changed.map((one) => ({
            ...one,
            mine: one.files.filter((file) =>
              own.some(
                (write) =>
                  write.repository === one.base.repository &&
                  (write.path === file.path || write.path === file.oldPath),
              ),
            ),
          }))
          const written = [
            ...owned.flatMap((one) =>
              one.mine.map((file) => ({ repository: one.base.repository, path: file.path })),
            ),
            ...rootChanged,
          ]
          if (listed.length === 0 && written.length > 0) {
            return refusal(
              `refused: ${written.map(fileSaid).join(', ')} changed in this pass: name each file you changed in changed, with why`,
            )
          }
          const files: AttemptFile[] = []
          for (const one of owned) {
            const mine = one.mine
            if (mine.length === 0) continue
            yield* Snapshots.use((snapshots) =>
              snapshots.capture(building.missionId, placeOf(one.base), one.from, one.to, mine),
            )
            for (const file of mine) {
              files.push({
                repository: one.base.repository,
                path: file.path,
                status: file.status,
                added: file.added,
                removed: file.removed,
                outside: false,
              })
            }
          }
          const changed: ReadonlyArray<ReportedFile> = listed.map((one) => ({
            ...one,
            why: secrets.mask(one.why),
          }))
          const kept = listed.length === 0 ? secrets.mask(reason) : null
          const evidence = yield* putEvidence({
            missionId: found.missionId,
            content: {
              text:
                kept === null
                  ? `The documenter changed:\n${changed.map((one) => `- ${fileSaid(one)}: ${one.why}`).join('\n')}\n`
                  : `The documenter changed nothing: ${kept}\n`,
            },
            name: `Documentation, pass ${String(found.number)}`,
            about: `documenter:${found.id}`,
            author: AgentAuthor.make({ role: session.role, sessionId: session.id }),
          })
          const agent = { sessionId: grant.sessionId, role: grant.role }
          const ended = yield* mutate('keeping the documenter’s report', (transaction) =>
            Effect.gen(function* () {
              const [row] = yield* transaction
                .update(documenterPasses)
                .set({
                  state: 'reported',
                  changed: kept === null ? secrets.mask(reportedFiles.write(changed)) : null,
                  noChangeReason: kept,
                  evidenceId: evidence.id,
                  endedAt: now(),
                })
                .where(
                  and(eq(documenterPasses.id, found.id), eq(documenterPasses.state, 'running')),
                )
                .returning()
                .pipe(Effect.mapError(refusedWhile('keeping the documenter’s report')))
              if (row === undefined) return { result: null, events: [] }
              yield* transaction
                .update(buildingAttempts)
                .set({
                  endedAt: now(),
                  ends: writeTrees(pass.ends),
                  files: attemptFiles.write(files),
                  outcome: kept === null ? 'documented' : 'no_change',
                })
                .where(eq(buildingAttempts.id, row.attemptId))
                .pipe(Effect.mapError(refusedWhile('ending the documentation attempt')))
              return {
                result: row,
                events: [
                  kept === null
                    ? passEvent(
                        row,
                        'building.documented',
                        { files: changed.map(fileSaid), whys: changed.map((one) => one.why) },
                        agent,
                      )
                    : passEvent(row, 'building.no_doc_change', { reason: kept }, agent),
                ],
              }
            }),
          )
          if (ended === null) return refusal('refused: this pass of the documenter has ended')
          yield* answer(
            ended.id,
            kept === null
              ? { outcome: 'documented', changed }
              : { outcome: 'no_change', reason: kept },
          )
          // Its turn is left to end, so the agent hears its report kept; then its session ends.
          yield* sessions.settled(session.id).pipe(
            Effect.timeoutOption(REPORT_TURN_BOUND),
            Effect.ignore,
            Effect.andThen(leave(ended.lineage, 'it reported')),
            Effect.catchCause((cause) => log(`a documenter was not ended: ${String(cause)}`)),
            provided,
            Effect.forkIn(scope),
          )
          return answered('Your report is kept. End your turn now.')
        }).pipe(
          provided,
          Effect.catchCause((cause) =>
            Effect.succeed(failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
          ),
        )

      /**
       * Where a resolved path is: a repository of the Building, or the Workspace root (both as
       * real folders); null outside the Workspace.
       */
      const docFileOf = (building: BuildingRow, root: string, resolved: string): DocFile | null =>
        fileOf(building, resolved) ??
        inRepository([{ repository: ROOT_REPOSITORY, folder: realFolder(root) }], resolved)

      // A write it cannot place, or a pass that is not running, is refused: never let through.
      const guard = (call: GuardedCall) =>
        Effect.gen(function* () {
          if (call.path === null) return null
          const database = yield* Database
          const session = yield* getSession(call.session.sessionId)
          const row = yield* passOfLineage(database, session.lineage)
          const building = row === null ? null : yield* buildingRow(row.buildingId)
          const file =
            building === null
              ? null
              : docFileOf(building, call.session.place.root, call.path.resolved)
          const refused = `refused: ${file === null ? call.path.named : fileSaid(file)} is not documentation named by this Project’s doc recipes.`
          if (row === null || building === null || file === null) return refused
          if (row.state !== 'running') return 'refused: your pass has ended; end your turn.'
          const recipes = yield* applicableRecipes(row.missionId)
          if (!recipesCover(recipes, file)) return refused
          if (
            file.repository === ROOT_REPOSITORY &&
            !basesOf(building).some((one) => one.repository === ROOT_REPOSITORY)
          ) {
            const before = rootBefore.get(row.id) ?? new Map<string, string | null>()
            if (!before.has(file.path)) before.set(file.path, digestOf(call.path.resolved))
            rootBefore.set(row.id, before)
          }
          return null
        }).pipe(
          provided,
          Effect.catchCause((cause) =>
            Effect.succeed(`refused: the documentation guard failed: ${said(cause)}`),
          ),
        )

      yield* DocsDesk.use((desk) => desk.serve({ report, guard }))

      const deltaNeeded = (buildingId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const passes = yield* passesIn(database, buildingId)
          const last = passes.findLast((one) => one.endedAt !== null)
          if (last?.endedAt == null) return []
          const since = last.endedAt
          const ours = new Set(passes.map((one) => one.attemptId))
          const writes = yield* database
            .select({
              repository: attemptWrites.repository,
              path: attemptWrites.path,
              attemptId: attemptWrites.attemptId,
            })
            .from(attemptWrites)
            .where(and(eq(attemptWrites.buildingId, buildingId), gt(attemptWrites.at, since)))
            .orderBy(attemptWrites.at)
            .pipe(Effect.mapError(refusedWhile('reading the writes')))
          const recipes = yield* applicableRecipes(last.missionId)
          const seen = new Set<string>()
          const needed: Array<{ repository: string; path: string }> = []
          for (const write of writes) {
            if (ours.has(write.attemptId)) continue
            if (recipesCover(recipes, write)) continue
            const key = fileSaid(write)
            if (seen.has(key)) continue
            seen.add(key)
            needed.push({ repository: write.repository, path: write.path })
          }
          return needed
        }).pipe(provided)

      // --- following what happens ----------------------------------------------------------------

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const payload = event.payload
            if (event.type === 'mission.cancelled') {
              const database = yield* Database
              for (const row of yield* passesGoing(database)) {
                if (row.missionId === event.entityId) {
                  yield* fail(row.id, 'the mission was cancelled')
                }
              }
              return
            }
            if (event.type !== 'session.stopped' || payload['role'] !== 'documenter') return
            if (payload['state'] === 'replaced' || payload['state'] === 'ended') return
            const lineage = Option.getOrNull(readString(payload['lineage']))
            const why = Option.getOrElse(readString(payload['reason']), () => 'no reason given')
            if (lineage !== null) yield* stoppedSession(lineage, why)
          }).pipe(
            provided,
            Effect.catchCause((cause) => log(`an event was not followed: ${String(cause)}`)),
          ),
        ),
      )

      // At every start, once automations may run: a pass a stop left waiting or running fails.
      const reconcile = Effect.gen(function* () {
        const database = yield* Database
        for (const row of yield* passesGoing(database)) {
          if (outcomes.has(row.id)) continue
          yield* fail(row.id, STOPPED_DURING_PASS)
        }
      })

      yield* AutomationGate.use((gate) => gate.pass).pipe(
        Effect.andThen(Memory.use((memory) => memory.ready)),
        Effect.andThen(
          Effect.all(
            [
              follow,
              post.turns.pipe(
                Stream.filter((turn) => !turn.on),
                Stream.runForEach((turn) =>
                  silentEnd(turn.sessionId).pipe(
                    provided,
                    Effect.catchCause((cause) =>
                      log(`a turn's end was not followed: ${String(cause)}`),
                    ),
                    Effect.forkIn(scope),
                  ),
                ),
              ),
              reconcile.pipe(
                provided,
                Effect.catchCause((cause) =>
                  log(`the passes were not reconciled: ${String(cause)}`),
                ),
              ),
            ],
            { concurrency: 'unbounded', discard: true },
          ),
        ),
        provided,
        Effect.catchCause((cause) => log(`the documenter stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )

      return { run, deltaNeeded }
    }),
  )
