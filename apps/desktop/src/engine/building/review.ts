/**
 * The reviewers of the automatic review (#147): two fresh, read-only sessions, `spec-reviewer` and
 * `code-reviewer`, one pass each on the checkpoint of a Building's result. The end sequence starts
 * them; this service runs them.
 *
 * - **A pass.** `start` records both passes of a Building once, each with its lineage. Each waits
 *   for a slot of the Project's cap like any fixed phase (CT-13: Now says "Automatic review waits
 *   for a free agent slot"), then opens its session, a child of the mission launched by Hemera, in
 *   the copy of the checkpoint's trees: its `fs_read` and `search` read the checkpoint, never the
 *   live Workspace.
 * - **The report.** `review_report` is validated (a blocking finding carries its evidence; a path
 *   names a file of the checkpoint), its findings are kept, masked, and the pass is done. An empty
 *   report is valid. What becomes of the findings is the end sequence's.
 * - **The reads.** `checkpoint_read` answers the checkpoint's files, or one file's diff from the
 *   merge base and its content at the checkpoint, through #140; a sensitive file answers "content
 *   withheld". `evidence_read` answers the Building's evidence.
 * - **Health.** A turn that ends without the report is reminded once per session; a second one
 *   from the same session replaces it, which #41's counter of replacements watches (three within 30
 *   minutes make an error need). A lineage that stops for good fails its pass.
 * - **A stop.** A running pass's session is rebuilt at the next start with the restart sentence
 *   (#40); a pass still waiting for its slot waits again.
 */

import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

import {
  REVIEW_SEVERITIES,
  REVIEWERS,
  REVIEWER_NAMES,
  ROOT_REPOSITORY,
  type ToolArguments,
  findingProblem,
  sensitivePlace,
} from '@hemera/core/domain'
import { and, eq, inArray } from 'drizzle-orm'
import {
  Cause,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import type { NewEvent } from '../journal.ts'
import { Memory } from '../memory/index.ts'
import { ProfileHome } from '../profile-home.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, type DatabaseError, refusedWhile } from '../storage/database.ts'
import {
  buildings,
  checkpointRepositories,
  missions,
  reviewFindings,
  reviewPasses,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { Checkpoints } from './checkpoints.ts'
import { evidenceIn, evidenceSaid } from './review-evidence.ts'
import { ReviewDesk } from './review-desk.ts'
import {
  type ReviewPassRow,
  checkpointFilesIn,
  reviewFindingsIn,
  reviewPassOfLineage,
  reviewPassesIn,
  reviewerOf,
} from './review-store.ts'
import { Snapshots } from './snapshots.ts'
import { type BuildingBase, type BuildingRow, bases, buildingEvent, now } from './tasks.ts'

export class AutoReview extends Context.Service<
  AutoReview,
  {
    /**
     * Both passes of a Building's review on its checkpoint, recorded once and started, the
     * reviewers working in `folder`, the copy of its trees. Nothing when they are recorded already.
     */
    readonly start: (
      building: BuildingRow,
      checkpointId: string,
      folder: string,
    ) => Effect.Effect<void, DatabaseError>
  }
>()('AutoReview') {}

export interface AutoReviewSettings {
  readonly log: Log
}

/** The folder of the data folder that holds the copies of the review checkpoints' trees. */
export const REVIEWS_FOLDER = 'reviews'

/** Where the reviewers of a Building read its checkpoint: one folder per repository inside. */
export const reviewFolderOf = (dataFolder: string, buildingId: string): string =>
  join(dataFolder, REVIEWS_FOLDER, buildingId)

/** Where a repository of the Workspace is in a copy. */
export const repositoryFolderOf = (folder: string, repository: string): string =>
  repository === ROOT_REPOSITORY ? folder : join(folder, repository)

/** What a reviewer that ended a turn without its report is told, once per session. */
export const END_WITH_REVIEW_REPORT =
  'End with review_report: every finding of your pass, each with its severity and evidence, or an empty list. Your report is the only thing you return.'

/** Why a reviewer's session is replaced after a second turn without its report. */
export const NO_REVIEW_REPORT = 'it ended its turn twice without review_report'

/** How long a reviewer's turn may go on after its report before its session is ended. */
const REPORT_TURN_BOUND = Duration.minutes(2)

/** What Now names the reviewers while they wait for a slot. */
const PHASE = 'Automatic review'

const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

/** How many lines both sides of a file may have together for its diff to be computed. */
const DIFF_CELLS = 4_000_000

const readString = Schema.decodeUnknownOption(Schema.String)

const said = (cause: Cause.Cause<unknown>): string => Cause.pretty(cause).split('\n')[0] ?? ''

const placeSaid = (repository: string): string =>
  repository === ROOT_REPOSITORY ? 'the Workspace root' : repository

const fileSaid = (repository: string, path: string): string =>
  repository === ROOT_REPOSITORY ? path : `${repository}/${path}`

const basesOf = (building: BuildingRow): ReadonlyArray<BuildingBase> =>
  Option.getOrElse(bases.read(building.bases), () => [])

/** The lines of a text with their numbers, as a reviewer cites them. */
const numbered = (text: string): string =>
  text
    .split('\n')
    .map((line, at) => `${String(at + 1).padStart(5)}| ${line}`)
    .join('\n')

/**
 * The lines removed (`-`, numbered before) and added (`+`, numbered after) from one text to the
 * other, by their longest common subsequence; null when the files are too long to compare.
 */
export function linesChanged(before: string, after: string): string | null {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > DIFF_CELLS) return null
  const width = b.length + 1
  const common = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        a[i] === b[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
    }
  }
  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1
      j += 1
    } else if (
      j < b.length &&
      (i === a.length || (common[i * width + j + 1] ?? 0) >= (common[(i + 1) * width + j] ?? 0))
    ) {
      lines.push(`+${String(j + 1).padStart(5)}| ${b[j] ?? ''}`)
      j += 1
    } else {
      lines.push(`-${String(i + 1).padStart(5)}| ${a[i] ?? ''}`)
      i += 1
    }
  }
  return lines.join('\n')
}

type Needs =
  | Database
  | DomainEvents
  | Secrets
  | Sessions
  | SessionPost
  | Cap
  | Checkpoints
  | Snapshots
  | ProfileHome
  | AutomationGate
  | Memory
  | ReviewDesk

export const autoReviewLayer = (settings: AutoReviewSettings) =>
  Layer.effect(
    AutoReview,
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const provided = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const sessions = yield* Sessions
      const cap = yield* Cap
      const post = yield* SessionPost
      const scope = yield* Effect.scope
      const { dataFolder } = yield* ProfileHome
      const log = (line: string) => Effect.sync(() => settings.log(`automatic review: ${line}`))
      /** The passes whose start this engine runs: one fiber each. */
      const starting = new Set<string>()

      const passEvent = (
        row: ReviewPassRow,
        type: string,
        payload: NewEvent['payload'] = {},
        agent: { readonly sessionId: string; readonly role: string } | null = null,
      ) => buildingEvent(row.missionId, type, { reviewer: row.reviewer, ...payload }, agent)

      const passRow = (passId: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [row] = yield* database
            .select()
            .from(reviewPasses)
            .where(eq(reviewPasses.id, passId))
            .pipe(Effect.mapError(refusedWhile('reading the review’s pass')))
          return row ?? null
        })

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

      /** Its session ended once its turn is over, and its slot freed. */
      const leave = (lineage: string, reason: string) =>
        sessions
          .end(lineage, reason)
          .pipe(Effect.ensuring(cap.release(lineage).pipe(Effect.ignore)))

      /** A pass waiting or running fails: the Journal is told, its session ends. */
      const fail = (passId: string, why: string) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const failed = yield* mutate('failing a reviewer’s pass', (transaction) =>
            Effect.gen(function* () {
              const [row] = yield* transaction
                .update(reviewPasses)
                .set({ state: 'failed', failure: secrets.mask(why), endedAt: now() })
                .where(
                  and(
                    eq(reviewPasses.id, passId),
                    inArray(reviewPasses.state, ['waiting', 'running']),
                  ),
                )
                .returning()
                .pipe(Effect.mapError(refusedWhile('failing a reviewer’s pass')))
              if (row === undefined) return { result: null, events: [] }
              return {
                result: row,
                events: [passEvent(row, 'review.pass_ended', { failed: secrets.mask(why) })],
              }
            }),
          )
          if (failed !== null) yield* leave(failed.lineage, why)
        })

      // --- a pass -------------------------------------------------------------------------------

      /** A pass waits for its slot, then its session opens in the copy of the checkpoint. */
      const run = (row: ReviewPassRow, folder: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [mission] = yield* database
            .select({ projectId: missions.projectId })
            .from(missions)
            .where(eq(missions.id, row.missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          yield* cap.acquire({
            projectId: mission?.projectId ?? '',
            lineage: row.lineage,
            missionId: row.missionId,
            requestedBy: 'hemera',
            phase: PHASE,
            queued: mutate('saying a reviewer waits', () =>
              Effect.succeed({
                result: undefined,
                events: [passEvent(row, 'review.pass_waiting')],
              }),
            ).pipe(provided, Effect.ignore),
          })
          const started = yield* mutate('starting a reviewer’s pass', (transaction) =>
            Effect.gen(function* () {
              const [current] = yield* transaction
                .update(reviewPasses)
                .set({ state: 'running' })
                .where(and(eq(reviewPasses.id, row.id), eq(reviewPasses.state, 'waiting')))
                .returning()
                .pipe(Effect.mapError(refusedWhile('starting a reviewer’s pass')))
              if (current === undefined) return { result: false, events: [] }
              return { result: true, events: [passEvent(current, 'review.pass_started')] }
            }),
          )
          if (!started) {
            yield* cap.release(row.lineage)
            return
          }
          const opened = yield* sessions
            .open({
              id: row.lineage,
              owner: { kind: 'mission', missionId: row.missionId },
              role: row.reviewer,
              folder,
              requestedBy: 'hemera',
            })
            .pipe(Effect.result)
          if (Result.isFailure(opened)) {
            const why = Predicate.isTagged(opened.failure, 'SessionRefused')
              ? opened.failure.reason
              : opened.failure.message
            yield* fail(row.id, `the ${REVIEWER_NAMES[reviewerOf(row)]} did not start: ${why}`)
          }
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.interrupt
              : fail(row.id, `the reviewer did not start: ${said(cause)}`),
          ),
          Effect.ensuring(Effect.sync(() => starting.delete(row.id))),
        )

      /** A pass started by this engine, once. */
      const launch = (row: ReviewPassRow, folder: string) =>
        Effect.suspend(() => {
          if (starting.has(row.id)) return Effect.void
          starting.add(row.id)
          return run(row, folder).pipe(
            provided,
            Effect.catchCause((cause) => log(`a pass did not start: ${String(cause)}`)),
            Effect.forkIn(scope),
            Effect.asVoid,
          )
        })

      const start = (building: BuildingRow, checkpointId: string, folder: string) =>
        Effect.gen(function* () {
          const recorded = yield* mutate('recording the review’s passes', (transaction) =>
            Effect.gen(function* () {
              const existing = yield* reviewPassesIn(transaction, building.id)
              if (existing.length > 0) return { result: existing, events: [] }
              const rows: ReviewPassRow[] = REVIEWERS.map((reviewer) => ({
                id: crypto.randomUUID(),
                missionId: building.missionId,
                buildingId: building.id,
                checkpointId,
                reviewer,
                lineage: crypto.randomUUID(),
                state: 'waiting',
                remindedSession: null,
                failure: null,
                startedAt: now(),
                endedAt: null,
              }))
              yield* transaction
                .insert(reviewPasses)
                .values(rows)
                .pipe(Effect.mapError(refusedWhile('recording the review’s passes')))
              return { result: rows, events: [] }
            }),
          )
          for (const row of recorded) {
            if (row.state === 'waiting') yield* launch(row, folder)
          }
        }).pipe(provided)

      // --- what follows its sessions --------------------------------------------------------------

      /** A turn that ended without the report: told once per session, then replaced. */
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (!REVIEWERS.some((one) => one === session.role)) return
          const database = yield* Database
          const found = yield* reviewPassOfLineage(database, session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const row = yield* passRow(found.id)
          if (row?.state !== 'running') return
          if (row.remindedSession === sessionId) {
            yield* sessions.replace(sessionId, NO_REVIEW_REPORT)
            return
          }
          yield* mutate('reminding a reviewer', (transaction) =>
            transaction
              .update(reviewPasses)
              .set({ remindedSession: sessionId })
              .where(eq(reviewPasses.id, row.id))
              .pipe(
                Effect.mapError(refusedWhile('reminding a reviewer')),
                Effect.as({ result: undefined, events: [] }),
              ),
          )
          yield* sessions.deliver({
            owner: session.owner,
            target: { lineage: row.lineage },
            kind: 'reminder',
            body: END_WITH_REVIEW_REPORT,
          })
        })

      /** A reviewer's session stopped for good, with no live session left in its lineage. */
      const stoppedSession = (lineage: string, why: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const row = yield* reviewPassOfLineage(database, lineage)
          if (row?.state !== 'running') return
          const live = (yield* sessionsOfLineage(lineage)).some((one) =>
            LIVE.some((state) => state === one.state),
          )
          if (live) return
          yield* fail(row.id, `its session stopped: ${why}`)
        })

      // --- the calls ------------------------------------------------------------------------------

      /** The pass a reviewer's call belongs to, and its Building; a refusal otherwise. */
      const passOf = (grant: Grant) =>
        Effect.gen(function* () {
          const database = yield* Database
          const session = yield* getSession(grant.sessionId)
          const pass = yield* reviewPassOfLineage(database, session.lineage)
          if (pass === null)
            return Result.fail(refusal('refused: only a reviewer reads its review'))
          const building = yield* buildingRow(pass.buildingId)
          if (building === null) return Result.fail(refusal('refused: the Building is gone'))
          return Result.succeed({ session, pass, building })
        })

      const report = (grant: Grant, args: ToolArguments<'review_report'>) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const database = yield* Database
          const found = yield* passOf(grant)
          if (Result.isFailure(found)) return found.failure
          const { session, pass, building } = found.success
          if (pass.state !== 'running') {
            return refusal(
              pass.state === 'done'
                ? 'refused: you reported already; end your turn'
                : 'refused: this pass of the review has ended',
            )
          }
          const files = yield* checkpointFilesIn(database, pass.checkpointId)
          const folder = reviewFolderOf(dataFolder, building.id)
          const repositories = basesOf(building).map((one) => one.repository)
          /** Whether a file is in the checkpoint: changed there, or in the copy of its trees. */
          const inCopy = (repository: string, path: string) => {
            const root = repositoryFolderOf(folder, repository)
            const file = resolve(root, path)
            const inside = relative(root, file)
            return (
              inside !== '' && !inside.startsWith(`..${sep}`) && inside !== '..' && existsSync(file)
            )
          }
          const listed = (repository: string | null, path: string) => {
            const named = repository?.replace(/^\.\//, '').replace(/[\\/]+$/, '')
            const where =
              named === undefined ? repositories : repositories.filter((one) => one === named)
            return where.some(
              (one) =>
                files.some((file) => file.repository === one && file.path === path) ||
                inCopy(one, path),
            )
          }
          for (const [at, finding] of args.findings.entries()) {
            const problem = findingProblem(finding, listed)
            if (problem !== null) {
              return refusal(`refused: finding ${String(at + 1)}: ${problem}. Nothing was kept.`)
            }
          }
          const agent = { sessionId: grant.sessionId, role: grant.role }
          const ended = yield* mutate('keeping a reviewer’s report', (transaction) =>
            Effect.gen(function* () {
              const [row] = yield* transaction
                .update(reviewPasses)
                .set({ state: 'done', endedAt: now() })
                .where(and(eq(reviewPasses.id, pass.id), eq(reviewPasses.state, 'running')))
                .returning()
                .pipe(Effect.mapError(refusedWhile('keeping a reviewer’s report')))
              if (row === undefined) return { result: null, events: [] }
              const before = (yield* reviewFindingsIn(transaction, building.id)).length
              const masked = (text: string | undefined) =>
                text === undefined || text.trim() === '' ? null : secrets.mask(text.trim())
              if (args.findings.length > 0) {
                yield* transaction
                  .insert(reviewFindings)
                  .values(
                    args.findings.map((finding, at) => ({
                      id: crypto.randomUUID(),
                      passId: row.id,
                      buildingId: building.id,
                      missionId: building.missionId,
                      number: before + at + 1,
                      reviewer: row.reviewer,
                      severity: finding.severity,
                      requirement: finding.requirement ?? null,
                      scenario: finding.scenario ?? null,
                      repository:
                        finding.repository?.replace(/^\.\//, '').replace(/[\\/]+$/, '') ?? null,
                      path: finding.path?.replaceAll('\\', '/') ?? null,
                      line: finding.line ?? null,
                      text: secrets.mask(finding.text.trim()),
                      contradictsSpec: finding.contradicts_spec,
                      evidence: masked(finding.evidence),
                      fate: null,
                      needId: null,
                      answer: null,
                      taskId: null,
                    })),
                  )
                  .pipe(Effect.mapError(refusedWhile('keeping the findings')))
              }
              const counts = Object.fromEntries(
                REVIEW_SEVERITIES.map((severity) => [
                  severity,
                  args.findings.filter((one) => one.severity === severity).length,
                ]),
              )
              return {
                result: row,
                events: [passEvent(row, 'review.pass_ended', counts, agent)],
              }
            }),
          )
          if (ended === null) return refusal('refused: this pass of the review has ended')
          // Its turn is left to end, so the agent hears its report kept; then its session ends.
          yield* sessions.settled(session.id).pipe(
            Effect.timeoutOption(REPORT_TURN_BOUND),
            Effect.ignore,
            Effect.andThen(leave(ended.lineage, 'it reported')),
            Effect.catchCause((cause) => log(`a reviewer was not ended: ${String(cause)}`)),
            provided,
            Effect.forkIn(scope),
          )
          return answered('Your report is kept. End your turn now.')
        }).pipe(
          provided,
          Effect.catchCause((cause) => Effect.succeed(failure(`the call failed: ${said(cause)}`))),
        )

      const checkpoint = (grant: Grant, args: ToolArguments<'checkpoint_read'>) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const database = yield* Database
          const checkpoints = yield* Checkpoints
          const found = yield* passOf(grant)
          if (Result.isFailure(found)) return found.failure
          const { pass, building } = found.success
          const taken = yield* database
            .select()
            .from(checkpointRepositories)
            .where(eq(checkpointRepositories.checkpointId, pass.checkpointId))
            .orderBy(checkpointRepositories.position)
            .pipe(Effect.mapError(refusedWhile('reading the checkpoint')))
          const named = args.repository?.replace(/^\.\//, '').replace(/[\\/]+$/, '')
          const repositories =
            named === undefined ? taken : taken.filter((one) => one.repository === named)
          if (named !== undefined && repositories.length === 0) {
            return refusal(
              `refused: the checkpoint has no repository ${named}: it has ${taken.map((one) => placeSaid(one.repository)).join(', ')}`,
            )
          }
          const files = yield* checkpointFilesIn(database, pass.checkpointId)
          if (args.path === undefined) {
            return answered(
              secrets.mask(
                repositories
                  .map((one) => {
                    const own = files.filter((file) => file.repository === one.repository)
                    const lines = own.map(
                      (file) =>
                        `- ${file.status} ${file.oldPath === null ? '' : `${file.oldPath} → `}${file.path}${file.added === null ? '' : ` (+${String(file.added)} -${String(file.removed ?? 0)})`}`,
                    )
                    return [
                      `## ${placeSaid(one.repository)} · base ${one.base ?? 'none'} · merge base ${one.mergeBase ?? 'none'}`,
                      '',
                      lines.length === 0 ? 'No file changed.' : lines.join('\n'),
                    ].join('\n')
                  })
                  .join('\n\n'),
              ),
            )
          }
          const path = args.path.replaceAll('\\', '/').replace(/^\.\//, '')
          const place =
            repositories.find((one) =>
              files.some((file) => file.repository === one.repository && file.path === path),
            ) ?? repositories[0]
          if (place === undefined) return refusal('refused: the checkpoint has no repository')
          const where = fileSaid(place.repository, path)
          const machine = { home: homedir(), platform: process.platform }
          if (sensitivePlace(path, machine) !== null) return answered(`content withheld: ${path}`)
          const diff = yield* checkpoints.diff(pass.checkpointId, place.repository, path)
          const text = (side: { readonly content: Uint8Array | null } | null) =>
            side?.content == null ? null : Buffer.from(side.content).toString('utf8')
          if (diff !== null) {
            const withheld = diff.after?.withheld ?? diff.before?.withheld ?? null
            if (withheld !== null) return answered(`${where} (${diff.status}): ${withheld}`)
            const after = text(diff.after)
            const before = text(diff.before)
            const changes = linesChanged(before ?? '', after ?? '')
            return answered(
              secrets.mask(
                [
                  `## ${where} (${diff.status}${diff.oldPath === null ? '' : ` from ${diff.oldPath}`}), from the merge base`,
                  '',
                  changes === null
                    ? 'Too long to compare line by line.'
                    : changes || 'No line changed.',
                  '',
                  '## At the checkpoint',
                  '',
                  after === null ? 'The file does not exist at the checkpoint.' : numbered(after),
                ].join('\n'),
              ),
            )
          }
          const base = basesOf(building).find((one) => one.repository === place.repository)
          const side =
            base === undefined
              ? null
              : yield* Snapshots.use((snapshots) =>
                  snapshots.read(
                    building.missionId,
                    { name: base.repository, folder: base.folder },
                    place.tree,
                    path,
                  ),
                ).pipe(Effect.catchTag('SnapshotUnavailable', () => Effect.succeed(null)))
          if (side === null) {
            return refusal(`refused: ${where} is not in the checkpoint`)
          }
          if (side.withheld !== null) return answered(`${where}: ${side.withheld}`)
          const content = text(side)
          return answered(
            secrets.mask(
              [
                `## ${where}, unchanged since the merge base`,
                '',
                content === null ? 'No content.' : numbered(content),
              ].join('\n'),
            ),
          )
        }).pipe(
          provided,
          Effect.catchCause((cause) => Effect.succeed(failure(`the call failed: ${said(cause)}`))),
        )

      const evidence = (grant: Grant, args: ToolArguments<'evidence_read'>) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const database = yield* Database
          const found = yield* passOf(grant)
          if (Result.isFailure(found)) return found.failure
          const read = yield* evidenceIn(database, found.success.building)
          return answered(secrets.mask(evidenceSaid(read, args)))
        }).pipe(
          provided,
          Effect.catchCause((cause) => Effect.succeed(failure(`the call failed: ${said(cause)}`))),
        )

      yield* ReviewDesk.use((desk) => desk.serve({ report, checkpoint, evidence }))

      // --- following what happens -----------------------------------------------------------------

      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const follow = events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const payload = event.payload
            if (event.type === 'mission.cancelled') {
              const database = yield* Database
              const going = yield* database
                .select()
                .from(reviewPasses)
                .where(
                  and(
                    eq(reviewPasses.missionId, event.entityId),
                    inArray(reviewPasses.state, ['waiting', 'running']),
                  ),
                )
                .pipe(Effect.mapError(refusedWhile('reading the review’s passes')))
              for (const row of going) yield* fail(row.id, 'the mission was cancelled')
              return
            }
            if (event.type !== 'session.stopped') return
            if (!REVIEWERS.some((one) => one === payload['role'])) return
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

      // At every start: a pass a stop left waiting waits for its slot again. A running one's
      // session is rebuilt by the sessions, with the restart sentence.
      const reconcile = Effect.gen(function* () {
        const database = yield* Database
        const waiting = yield* database
          .select()
          .from(reviewPasses)
          .where(eq(reviewPasses.state, 'waiting'))
          .pipe(Effect.mapError(refusedWhile('reading the review’s passes')))
        for (const row of waiting) {
          const building = yield* buildingRow(row.buildingId)
          if (building?.state !== 'active') continue
          yield* launch(row, reviewFolderOf(dataFolder, building.id))
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
        Effect.catchCause((cause) => log(`the reviewers stopped: ${String(cause)}`)),
        Effect.forkScoped,
      )

      return { start }
    }),
  )
