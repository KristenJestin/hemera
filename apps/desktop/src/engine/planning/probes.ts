/**
 * The Probes (#89): a sub-agent the Planner launches in the background to answer one question by
 * running things, in a worktree of its own taken from the up-to-date base.
 *
 * - **Launch.** `probe_launch` is refused outside Planning, above the Project's cap and past the
 *   mission's launch budget (#41), never queued. Otherwise the Probe is recorded and the Planner is
 *   answered at once with its number; in the background, each repository's up-to-date base is read
 *   (#5, CT-24), a Workspace of its own is made over every repository on a detached HEAD in
 *   `probes/<mission key>/<number>/` of the data folder and prepared with the Project's recipe
 *   (#6), then its session opens: a child of the Planner, role `probe`, its folder its place.
 * - **End.** `probe_report` is checked, what the worktree holds against its commit is captured,
 *   the report stored, the session stopped with its runs, its reservations released (#88), and
 *   `[hemera:probe]` delivered to the Planner (CT-28). An agent that ends a turn without it is told
 *   once; a second silent end fails the Probe. A failure is delivered the same way.
 * - **Health.** #40's rules hold: a session silent in a turn is stuck (its chip says so until its
 *   lineage speaks again, its parent is told), a dead one is replaced in the same folder.
 * - **Wipe.** In this order: the whole process tree, the Cleanup hook (S6, never the Closing),
 *   `git worktree remove --force` and `git worktree prune` per repository, then the folder gone
 *   and Git no longer listing it. Never before a done Probe's capture. A wipe that fails stays
 *   `wiping` with its error and is tried again at the next start. A mission leaving Planning
 *   wipes its Probes (a Freeze here, a Cancel through its stopper).
 * - **Start.** A Probe a stop left preparing or running is interrupted before the sessions are
 *   rebuilt; once automations may run, a Probe whose mission left Planning or is gone is wiped, a
 *   folder under `probes/` no Probe knows is wiped, one still `wiping` is wiped again, and an
 *   interrupted one is relaunched with the same brief in the same folder, counting nowhere.
 *
 * Every change of one Probe runs under its own lock: a report and a wipe, two reports or two
 * wipes at once are one after the other. Nothing here waits on a timer.
 */

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

import {
  type ProbeReport,
  STAGES,
  maskedJson,
  missionKey,
  probeLabel,
  probeNumberOf,
  probeReportRefusal,
  probeReportText,
  probeRunsSaid,
  sensitivePlace,
} from '@hemera/core/domain'
import { DetachedAt } from '@hemera/ipc'
import { and, eq, inArray, isNotNull, max } from 'drizzle-orm'
import {
  Cause,
  Effect,
  Fiber,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  Semaphore,
  Stream,
} from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { spendBudgetIn } from '../budget.ts'
import { DomainEvents } from '../domain-events.ts'
import { AutomationGate } from '../gate.ts'
import { Git } from '../git.ts'
import { Memory } from '../memory/index.ts'
import { writeNow } from '../memory/now.ts'
import { prepareWorkspace, resumeWorkspace } from '../preparation.ts'
import { ProfileHome } from '../profile-home.ts'
import { getProject } from '../projects.ts'
import { upToDateBase } from '../repositories.ts'
import { resourcesOf } from '../resources/declarations.ts'
import { ExclusiveResources } from '../resources/reservations.ts'
import { type RunServices, Runs, stopRun } from '../runs.ts'
import { Secrets } from '../secrets.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { type RoleSession, endSession, getSession, sessionsOfLineage } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import {
  commandRuns,
  missions,
  probeContents,
  probeFiles,
  probes,
  workspaces,
} from '../storage/schema.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { type Mutation, mutate } from '../transaction.ts'
import { type WorkspaceServices, createWorkspace, getWorkspace, worktreeOf } from '../workspaces.ts'
import { ProbeCleanup, ProbeDesk, ProbeWipeFailed, type ProbeWork } from './probe-desk.ts'
import {
  PROBES_FOLDER,
  type ProbeBaseKept,
  type ProbePreparedFile,
  type ProbeRow,
  allProbeRows,
  basesOf,
  probeEvent,
  probeOfLineage,
  probeRow,
  preparedOf,
  probeRowsOf,
  reportOf,
  writeBases,
  writePrepared,
} from './probe-store.ts'
import { PlannerWake } from './wake.ts'
import { ReconciliationFailed, type ReconciliationStep } from '../reconciliation.ts'

export interface ProbesSettings {
  readonly log: Log
  /**
   * Runs at a point a suite needs to reach: `checked`, once a launch found its mission in Planning
   * and before it takes a slot; `recorded`, between a Probe's record and the start of
   * its background work, where a Cancel or a Freeze may fall; `sweeping`, as the start begins to
   * wipe the folders no Probe knows, where a launch may fall.
   */
  readonly hold?: ((at: 'checked' | 'recorded' | 'sweeping') => Effect.Effect<void>) | undefined
}

/** What a Probe that ended a turn without its report is told, once. */
export const END_WITH_REPORT =
  'End with probe_report: your report is the only thing you return. If what you need is held for approval and nothing else can be done, report inconclusive with what is missing.'

/** Why a Probe that ended two turns without its report failed. */
export const NO_REPORT = 'ended without a report'

const LIVE_SESSION = ['starting', 'working', 'idle', 'stuck'] as const

const said = <E>(cause: E): string =>
  cause instanceof Error && cause.message !== '' ? cause.message : String(cause)

/** A mission as the Probes read it: its stage, its Project and its key. */
const missionFacts = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({
        stage: missions.stage,
        projectId: missions.projectId,
        keyPrefix: missions.keyPrefix,
        keyNumber: missions.keyNumber,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the mission')))
    if (row === undefined) return null
    return {
      stage: STAGES.find((one) => one === row.stage) ?? 'cancelled',
      projectId: row.projectId,
      key: missionKey(row.keyPrefix, row.keyNumber),
    }
  })

/** Sets a Probe's columns when it is in one of the states, with its events; answers whether it was. */
const moved = (
  row: ProbeRow,
  from: ReadonlyArray<string>,
  set: Partial<typeof probes.$inferInsert>,
  events: (fresh: ProbeRow) => ReadonlyArray<ReturnType<typeof probeEvent>> = () => [],
) =>
  mutate('writing a Probe', (transaction) =>
    Effect.gen(function* () {
      const written = yield* transaction
        .update(probes)
        .set(set)
        .where(and(eq(probes.id, row.id), inArray(probes.state, [...from])))
        .returning()
        .pipe(Effect.mapError(refusedWhile('writing a Probe')))
      const [fresh] = written
      return { result: fresh !== undefined, events: fresh === undefined ? [] : events(fresh) }
    }),
  )

/** Every Probe a stop left preparing or running, now interrupted, with its event. */
const markInterrupted = Effect.gen(function* () {
  const left = (yield* allProbeRows).filter(
    (row) => row.state === 'preparing' || row.state === 'running',
  )
  for (const row of left) {
    yield* moved(row, ['preparing', 'running'], { state: 'interrupted', stuck: false }, () => [
      probeEvent('probe.interrupted', row, { from: row.state }),
    ])
  }
  return left.length
})

/**
 * At the start, before the sessions are rebuilt: every Probe a stop left preparing or running is
 * interrupted, and the sessions of every interrupted one ended, so the rebuild does not take them
 * over: their relaunch is the Probes' own, once automations may run. Answers how many it
 * interrupted.
 */
export const interruptLeftProbes = Effect.gen(function* () {
  const interrupted = yield* markInterrupted
  for (const row of yield* allProbeRows) {
    if (row.state !== 'interrupted') continue
    const live = (yield* sessionsOfLineage(row.lineage)).filter((one) =>
      LIVE_SESSION.some((state) => state === one.state),
    )
    if (live.length === 0) continue
    yield* mutate('ending an interrupted Probe’s sessions', (transaction) =>
      Effect.gen(function* () {
        const ended = []
        for (const session of live) {
          ended.push(
            yield* endSession(transaction, session, 'ended', 'Hemera stopped while it ran'),
          )
        }
        return { result: undefined, events: ended }
      }),
    )
  }
  return interrupted
})

const failedStep = (failed: { readonly message: string }) =>
  new ReconciliationFailed({ reason: failed.message })

/**
 * The reconciliation step of a restored Profile (#4): a Probe the backup holds preparing or
 * running is interrupted. The start ends its sessions; once automations may run it is relaunched
 * or wiped as after any start.
 */
export const RESTORED_PROBES: ReconciliationStep = {
  name: 'probes',
  per: 'profile',
  states: ['live', 'interrupted'],
  recorded: () =>
    allProbeRows.pipe(
      Effect.map((rows) =>
        rows.some((row) => row.state === 'preparing' || row.state === 'running')
          ? 'live'
          : 'interrupted',
      ),
      Effect.mapError(failedStep),
    ),
  observed: () => Effect.succeed('interrupted'),
  advance: () => markInterrupted.pipe(Effect.asVoid, Effect.mapError(failedStep)),
}

/** Every folder under a folder whose `.git` is a file: the worktrees it holds. */
const worktreeFoldersIn = (folder: string): ReadonlyArray<string> => {
  const found: string[] = []
  const walk = (at: string, depth: number) => {
    const stat = lstatSync(join(at, '.git'), { throwIfNoEntry: false })
    if (stat?.isFile() === true) {
      found.push(at)
      return
    }
    if (depth === 0) return
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(join(at, entry.name), depth - 1)
    }
  }
  if (existsSync(folder)) walk(folder, 4)
  return found
}

/**
 * The worktrees under a folder, and the repository each belongs to, as Git reads it from their
 * `.git`: whatever its separators, absolute or relative. One whose repository Git no longer finds
 * is left to the removal of the folder.
 */
const worktreesIn = (folder: string) =>
  Effect.gen(function* () {
    const git = yield* Git
    const found: Array<{ worktree: string; source: string }> = []
    for (const worktree of worktreeFoldersIn(folder)) {
      const source = yield* git.repositoryOf(worktree).pipe(Effect.option)
      if (Option.isSome(source)) found.push({ worktree, source: source.value })
    }
    return found
  })

/** The capture's limits: past them a file is listed with its hash, its content withheld. */
export const CAPTURE_LIMITS = { files: 200, bytes: 5 * 1024 * 1024 } as const
const PAST_THE_LIMITS = 'content withheld: past the capture’s limit (200 files, 5 MiB)'

/** A file of a worktree as the capture finds it: its hash, its bytes, or why they are not kept. */
interface Found {
  readonly sha256: string
  readonly bytes: Buffer | null
  readonly withheld: string | null
}

const hashOf = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** The hash of a file read a chunk at a time, never held whole. */
const hashOfFile = (path: string): string => {
  const hash = createHash('sha256')
  const chunk = Buffer.alloc(1024 * 1024)
  const descriptor = openSync(path, 'r')
  try {
    for (let read = readSync(descriptor, chunk); read > 0; read = readSync(descriptor, chunk)) {
      hash.update(chunk.subarray(0, read))
    }
  } finally {
    closeSync(descriptor)
  }
  return hash.digest('hex')
}

const gone = (cause: Error): boolean =>
  Predicate.hasProperty(cause, 'code') && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')

/**
 * Reads one file a worktree changed, never failing: null when it is gone since Git listed it. A
 * link is kept as where it leads, never followed out of the worktree; a folder (Git lists a
 * repository inside the worktree as one entry), a file larger than `room` and a file that cannot
 * be read are withheld, a folder's and an unreadable file's hash that of nothing.
 */
const readFound = (path: string, room: number): Effect.Effect<Found | null> =>
  Effect.try({
    try: (): Found | null => {
      const stat = lstatSync(path, { throwIfNoEntry: false })
      if (stat === undefined) return null
      if (stat.isSymbolicLink()) {
        const target = Buffer.from(readlinkSync(path))
        return { sha256: hashOf(target), bytes: null, withheld: 'content withheld: a link' }
      }
      if (stat.isDirectory()) {
        const withheld = 'content withheld: a nested repository'
        return { sha256: hashOf(Buffer.alloc(0)), bytes: null, withheld }
      }
      if (stat.size > room)
        return { sha256: hashOfFile(path), bytes: null, withheld: PAST_THE_LIMITS }
      const bytes = readFileSync(path)
      return { sha256: hashOf(bytes), bytes, withheld: null }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.catch((cause) =>
      Effect.succeed(
        gone(cause)
          ? null
          : {
              sha256: hashOf(Buffer.alloc(0)),
              bytes: null,
              withheld: 'content withheld: unreadable',
            },
      ),
    ),
  )

/**
 * What a Probe's worktrees hold against their commits once prepared, by hash: what its
 * preparation left, which its capture leaves out unless the Probe changed it.
 */
const preparedIn = (row: ProbeRow) =>
  Effect.gen(function* () {
    const git = yield* Git
    const prepared: ProbePreparedFile[] = []
    for (const base of basesOf(row)) {
      const worktree = worktreeOf(row.folder, base.repository)
      for (const change of yield* git.worktreeChanges(worktree, base.commit)) {
        const found = yield* readFound(join(worktree, change.path), 0)
        if (found !== null) {
          prepared.push({ repository: base.repository, path: change.path, sha256: found.sha256 })
        }
      }
    }
    return prepared
  })

const comparable = (path: string): string => {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const under = (folder: string, path: string): boolean => {
  const root = comparable(folder)
  const one = comparable(path)
  return one === root || one.startsWith(`${root}${sep}`)
}

/**
 * Steps 3 and 4 of a wipe, for a folder: each worktree in it removed by Git with `--force`, the
 * folder removed, each repository pruned, then checked gone from the disk and from Git's list.
 * `sources` are the repositories a Probe's worktrees belong to, beside those their `.git` files name.
 */
const removeFolder = (folder: string, sources: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const git = yield* Git
    const found = yield* worktreesIn(folder)
    const repositories = [...new Set([...sources, ...found.map((one) => one.source)])]
    const refused = (reason: string) => new ProbeWipeFailed({ reason })
    const byGit = <A>(asked: Effect.Effect<A, { readonly message: string }>) =>
      asked.pipe(Effect.mapError((failed) => refused(failed.message)))
    // The deepest first: a worktree of the root holds the others' folders.
    for (const one of found.toSorted((a, b) => b.worktree.length - a.worktree.length)) {
      // An earlier attempt may have taken Git's record of it and left its files: those go below.
      const listed = yield* byGit(git.worktrees(one.source))
      if (!listed.some((path) => comparable(path) === comparable(one.worktree))) continue
      yield* byGit(git.worktreeRemoveForced(one.source, one.worktree))
    }
    yield* Effect.try({
      try: () => rmSync(folder, { recursive: true, force: true }),
      catch: (cause) => refused(said(cause)),
    })
    if (existsSync(folder)) return yield* refused(`${folder} is still on the disk`)
    // Pruned once the folder is gone, so what Git did not remove above is forgotten too.
    for (const source of repositories) {
      if (existsSync(source)) yield* byGit(git.worktreePrune(source))
    }
    for (const source of repositories) {
      if (!existsSync(source)) continue
      const listed = yield* byGit(git.worktrees(source))
      const still = listed.find((path) => under(folder, path))
      if (still !== undefined) return yield* refused(`Git still lists the worktree ${still}`)
    }
  })

/** What a launch's transaction decided. */
type Launched =
  | { readonly kind: 'left' }
  | { readonly kind: 'refused'; readonly sentence: string }
  | { readonly kind: 'recorded'; readonly row: ProbeRow }

type Needs =
  | WorkspaceServices
  | RunServices
  | Sessions
  | Cap
  | PlannerWake
  | ExclusiveResources
  | ProbeCleanup
  | ProbeDesk
  | AgentRuntime
  | SessionPost
  | AutomationGate
  | Memory

export const probesLayer = (settings: ProbesSettings) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const context = yield* Effect.context<Needs>()
      const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
      const scope = yield* Effect.scope
      const log = (line: string) => Effect.sync(() => settings.log(`probes: ${line}`))
      const { dataFolder } = yield* ProfileHome
      const desk = yield* ProbeDesk
      const sessions = yield* Sessions
      const cap = yield* Cap
      const wake = yield* PlannerWake
      const reservations = yield* ExclusiveResources
      const cleanup = yield* ProbeCleanup
      const runs = yield* Runs
      const secrets = yield* Secrets

      const locks = new Map<string, Semaphore.Semaphore>()
      /** One Probe's changes, one after the other. */
      const locked = <A, E, R>(probeId: string, effect: Effect.Effect<A, E, R>) => {
        const found = locks.get(probeId)
        const lock = found ?? Semaphore.makeUnsafe(1)
        if (found === undefined) locks.set(probeId, lock)
        return Semaphore.withPermits(lock, 1)(effect)
      }
      /** The background work of each Probe: its preparation, then its session's opening. */
      const preparing = new Map<string, Fiber.Fiber<void>>()
      /** The lineages whose Probe is stuck, until a session of theirs speaks again. */
      const stuck = new Set<string>()

      const refusedOf = (missionId: string, reason: string, by: string) => ({
        type: 'probe.refused',
        entityKind: 'mission',
        entityId: missionId,
        source: 'system' as const,
        author: 'hemera' as const,
        payload: { reason, by },
      })
      const refusedEvent = (missionId: string, reason: string, by: string) =>
        mutate('refusing a Probe', () =>
          Effect.succeed({ result: undefined, events: [refusedOf(missionId, reason, by)] }),
        )
      /** A launch whose budget could not be read: refused, said in the journal. */
      const unspent = (missionId: string, sentence: string) =>
        Effect.as(refusedEvent(missionId, sentence, 'budget'), {
          kind: 'refused',
          sentence,
        } satisfies Launched)

      /** What runs for a Probe stops: its sessions, and every run in its Workspace. */
      const stopProcesses = (row: ProbeRow, reason: string) =>
        Effect.gen(function* () {
          yield* sessions.end(row.lineage, reason)
          yield* cap.release(row.lineage)
          const going = [...runs.live.values()].filter(
            (live) => row.workspaceId !== null && live.run.workspaceId === row.workspaceId,
          )
          yield* Effect.forEach(going, (live) => Effect.ignore(stopRun(live.run.id)), {
            concurrency: 'unbounded',
            discard: true,
          })
        }).pipe(run)

      /** The reservations its declared commands took for its mission, released (#88). */
      const releaseReservations = (row: ProbeRow) =>
        Effect.gen(function* () {
          if (row.workspaceId === null) return
          const facts = yield* missionFacts(row.missionId)
          if (facts === null) return
          const database = yield* Database
          const ran = yield* database
            .selectDistinct({ commandId: commandRuns.commandId })
            .from(commandRuns)
            .where(
              and(eq(commandRuns.workspaceId, row.workspaceId), isNotNull(commandRuns.commandId)),
            )
            .pipe(Effect.mapError(refusedWhile('reading the Probe’s runs')))
          for (const { commandId } of ran) {
            if (commandId === null) continue
            for (const resource of yield* resourcesOf(facts.projectId, commandId)) {
              yield* reservations.release(
                resource.name,
                row.missionId,
                `Probe ${probeLabel(row.number)} ended`,
              )
            }
          }
        }).pipe(run)

      /** Hands the Planner what became of a Probe, as `[hemera:probe]`. */
      const tellPlanner = (row: ProbeRow, body: string) =>
        wake
          .deliver(row.missionId, 'probe', body)
          .pipe(Effect.catchCause((cause) => log(`Probe ${row.id} was not told: ${String(cause)}`)))

      /** After a Probe ended: its processes stopped, its reservations released, its Planner told. */
      const afterEnd = (row: ProbeRow, reason: string, body: string) =>
        Effect.gen(function* () {
          yield* stopProcesses(row, reason)
          yield* releaseReservations(row)
          yield* tellPlanner(row, body)
        }).pipe(
          Effect.catchCause((cause) =>
            log(`the end of Probe ${row.id} was not finished: ${String(cause)}`),
          ),
        )

      /** Fails a Probe still under way, under its lock; answers whether it did. */
      const failIn = (row: ProbeRow, why: string) =>
        moved(
          row,
          ['preparing', 'running', 'interrupted'],
          {
            state: 'failed',
            failure: secrets.mask(why),
            stuck: false,
            endedAt: new Date().toISOString(),
          },
          (fresh) => [probeEvent('probe.failed', fresh, { why: fresh.failure ?? why })],
        ).pipe(run)

      const failedBody = (row: ProbeRow, why: string) =>
        `Probe ${probeLabel(row.number)} failed: ${why}\nIts question: ${row.question}`

      /** Fails a Probe, then stops what it ran and tells its Planner. */
      const fail = (probeId: string, why: string) =>
        Effect.gen(function* () {
          const failed = yield* locked(
            probeId,
            Effect.gen(function* () {
              const row = yield* probeRow(probeId)
              if (row === null) return null
              return (yield* failIn(row, why)) ? row : null
            }),
          )
          if (failed !== null) yield* afterEnd(failed, `it failed: ${why}`, failedBody(failed, why))
        }).pipe(run)

      // --- the background: base, Workspace, preparation, session ---------------------------

      /** Each repository's up-to-date base, read once and kept: a relaunch takes the same. */
      const basesFor = (row: ProbeRow, projectId: string) =>
        Effect.gen(function* () {
          const kept = basesOf(row)
          if (kept.length > 0) return kept
          const project = yield* getProject(projectId)
          const bases: ProbeBaseKept[] = []
          for (const repository of project.repositories) {
            const base = yield* upToDateBase(repository.id)
            bases.push({
              repositoryId: repository.id,
              repository: repository.path,
              commit: base.commit,
              ref: base.ref,
              freshness: base.freshness,
            })
          }
          yield* moved(row, ['preparing', 'interrupted'], { bases: writeBases(bases) })
          return bases
        })

      /** The Probe's Workspace prepared: made and prepared, or its preparation resumed (#6). */
      const workspaceFor = (row: ProbeRow, projectId: string, key: string) =>
        Effect.gen(function* () {
          const bases = yield* basesFor(row, projectId)
          if (bases.length === 0) return yield* Effect.fail('the Project has no repository')
          const made = yield* workspaceAt(row.folder)
          if (made !== null) {
            yield* moved(row, ['preparing', 'interrupted'], { workspaceId: made })
            const workspace = yield* getWorkspace(made)
            return workspace.preparation === 'ready' ? workspace : yield* resumeWorkspace(made)
          }
          const workspace = yield* createWorkspace({
            projectId,
            name: `probe-${key}-${String(row.number)}`,
            repositories: bases.map((base) => base.repositoryId),
            mode: DetachedAt.make({
              folder: row.folder,
              commits: Object.fromEntries(bases.map((base) => [base.repositoryId, base.commit])),
            }),
          })
          yield* moved(row, ['preparing', 'interrupted'], { workspaceId: workspace.id })
          return yield* prepareWorkspace(workspace.id)
        })

      /** The Planner session the Probe is a child of: its lineage's latest. */
      const parentOf = (row: ProbeRow) =>
        Effect.map(sessionsOfLineage(row.parentLineage), (rows) =>
          rows.toSorted((a, b) => b.epoch - a.epoch).at(0),
        )

      /**
       * Why a Probe is no longer to be prepared or started, or null when it is: a Cancel or a Freeze
       * may have wiped it, or moved its mission, since it was recorded.
       */
      const notToStart = (probeId: string) =>
        Effect.gen(function* () {
          const row = yield* probeRow(probeId)
          if (row === null) return 'it no longer exists'
          if (row.state !== 'preparing' && row.state !== 'interrupted') return `it is ${row.state}`
          const facts = yield* missionFacts(row.missionId)
          if (facts === null) return 'its mission no longer exists'
          if (facts.stage !== 'planning') return `its mission is in ${facts.stage}`
          return null
        })

      const prepareAndStart = (probeId: string) =>
        Effect.gen(function* () {
          const row = yield* probeRow(probeId)
          if (row === null) return
          const facts = yield* missionFacts(row.missionId)
          if (facts === null) return
          // Checked again before its Workspace is made: from here on, a wipe interrupts this work.
          const declined = yield* locked(probeId, notToStart(probeId))
          if (declined !== null) return yield* log(`Probe ${probeId} is not prepared: ${declined}`)
          const prepared = yield* workspaceFor(row, facts.projectId, facts.key).pipe(
            Effect.map(Option.some),
            Effect.catch((refused) => Effect.as(fail(probeId, said(refused)), Option.none())),
          )
          if (Option.isNone(prepared)) return
          const workspace = prepared.value
          if (workspace.preparation !== 'ready') {
            const step = workspace.steps.find((one) => one.state === 'failed')
            const why =
              step?.failure === null || step?.failure === undefined
                ? 'its preparation did not end'
                : `${step.failure.doing}: ${step.failure.output}`
            return yield* fail(probeId, why)
          }
          const parent = yield* parentOf(row)
          // What the preparation left, taken once before the Probe first runs: a relaunch keeps it.
          const now = (yield* probeRow(probeId)) ?? row
          const left = now.prepared ?? writePrepared(yield* preparedIn(now))
          // Running from now on, so its first report is taken; then its session opens.
          const running = yield* locked(
            probeId,
            moved(
              row,
              ['preparing', 'interrupted'],
              { state: 'running', stuck: false, prepared: left },
              (fresh) => [probeEvent('probe.running', fresh)],
            ),
          )
          if (!running) return
          const session = yield* sessions
            .reopen(
              row.lineage,
              {
                owner: { kind: 'mission', missionId: row.missionId },
                role: 'probe',
                folder: row.folder,
                parent,
                requestedBy: 'hemera',
              },
              'the Probe starts again',
            )
            .pipe(
              Effect.map(Option.some),
              Effect.catchTag('SessionRefused', (refused) =>
                Effect.as(fail(probeId, refused.reason), Option.none<RoleSession>()),
              ),
            )
          if (Option.isNone(session)) return
          yield* mutate('saying what a Probe does', (transaction) =>
            Effect.map(
              writeNow(transaction, {
                missionId: row.missionId,
                sessionId: session.value.id,
                role: 'probe',
                epoch: session.value.epoch,
                doing: secrets.mask(probeRunsSaid(row.number, row.question)),
                next: null,
              }),
              (event) => ({ result: undefined, events: [event] }),
            ),
          )
        }).pipe(
          run,
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(cause)) return
              yield* log(`Probe ${probeId} did not start: ${String(cause)}`)
            }),
          ),
        )

      /** Starts a Probe's background work, under its lock, so a wipe finds it to interrupt. */
      const begin = (probeId: string) =>
        locked(
          probeId,
          Effect.gen(function* () {
            const why = yield* notToStart(probeId)
            if (why !== null) return yield* log(`Probe ${probeId} is not started: ${why}`)
            const fiber = yield* prepareAndStart(probeId).pipe(
              Effect.ensuring(Effect.sync(() => preparing.delete(probeId))),
              Effect.forkIn(scope),
            )
            preparing.set(probeId, fiber)
          }),
        )

      // --- the tools --------------------------------------------------------------------------

      const launch: ProbeWork['launch'] = (grant, args) =>
        Effect.gen(function* () {
          const missionId = grant.missionId
          if (missionId === null) return refusal('refused: this session works for no mission')
          const facts = yield* missionFacts(missionId)
          if (facts === null) return refusal('refused: this mission no longer exists')
          if (facts.stage !== 'planning') {
            const reason = `a Probe is launched only in Planning, and ${facts.key} is in ${facts.stage}`
            yield* refusedEvent(missionId, reason, 'stage')
            return refusal(`refused: ${reason}`)
          }
          if (settings.hold !== undefined) yield* settings.hold('checked')
          const lineage = crypto.randomUUID()
          const slot = yield* cap.acquire({
            projectId: facts.projectId,
            lineage,
            missionId,
            requestedBy: 'agent',
          })
          if (!slot.held) {
            yield* refusedEvent(missionId, slot.sentence, 'cap')
            return refusal(`refused: ${slot.sentence}`)
          }
          // The slot is the Probe's once it is recorded; until then, whatever ends the launch gives
          // it back.
          const owned = { recorded: false }
          const given = Effect.suspend(() =>
            owned.recorded ? Effect.void : Effect.ignore(cap.release(lineage)),
          )
          const parent = yield* getSession(grant.sessionId).pipe(Effect.onError(() => given))
          const at = new Date().toISOString()
          // The stage, the budget and the record in one transaction: a launch refused because its
          // mission left Planning spends nothing.
          const recorded = yield* mutate('launching a Probe', (transaction) =>
            Effect.gen(function* () {
              const [mission] = yield* transaction
                .select({ stage: missions.stage })
                .from(missions)
                .where(eq(missions.id, missionId))
                .pipe(Effect.mapError(refusedWhile('reading the mission')))
              if (mission?.stage !== 'planning') {
                const left: Mutation<Launched> = { result: { kind: 'left' }, events: [] }
                return left
              }
              const spent = yield* spendBudgetIn(transaction, missionId, 'launches')
              if (!spent.result.spent) {
                const sentence = spent.result.sentence
                const refused: Mutation<Launched> = {
                  result: { kind: 'refused', sentence },
                  events: [...spent.events, refusedOf(missionId, sentence, 'budget')],
                }
                return refused
              }
              const [top] = yield* transaction
                .select({ number: max(probes.number) })
                .from(probes)
                .where(eq(probes.missionId, missionId))
                .pipe(Effect.mapError(refusedWhile('numbering the Probe')))
              const number = (top?.number ?? 0) + 1
              const row: ProbeRow = {
                id: crypto.randomUUID(),
                missionId,
                number,
                scenario: args.scenario ?? null,
                question: secrets.mask(args.question),
                brief: secrets.mask(args.brief),
                state: 'preparing',
                stuck: false,
                folder: join(dataFolder, PROBES_FOLDER, facts.key, String(number)),
                workspaceId: null,
                bases: null,
                prepared: null,
                lineage,
                parentLineage: parent.lineage,
                reminded: false,
                outcome: null,
                answer: null,
                report: null,
                failure: null,
                startedAt: at,
                endedAt: null,
                wipeAttempts: 0,
                wipeError: null,
              }
              yield* transaction
                .insert(probes)
                .values(row)
                .pipe(Effect.mapError(refusedWhile('recording the Probe')))
              const launched: Mutation<Launched> = {
                result: { kind: 'recorded', row },
                events: [
                  ...spent.events,
                  probeEvent('probe.launched', row, {
                    question: row.question,
                    scenario: row.scenario,
                  }),
                ],
              }
              return launched
            }),
          ).pipe(
            Effect.tap((outcome) =>
              Effect.sync(() => {
                owned.recorded = outcome.kind === 'recorded'
              }),
            ),
            Effect.onExit(() => given),
            Effect.catchTags({
              NeedRefused: (refused) => unspent(missionId, refused.reason),
              UnknownMission: () => unspent(missionId, 'no such mission'),
              UnknownProject: () => unspent(missionId, 'no such Project'),
            }),
          )
          if (recorded.kind === 'left') {
            return refusal(`refused: ${facts.key} left Planning meanwhile`)
          }
          if (recorded.kind === 'refused') return refusal(`refused: ${recorded.sentence}`)
          if (settings.hold !== undefined) yield* settings.hold('recorded')
          yield* begin(recorded.row.id)
          return answered(
            `Probe ${probeLabel(recorded.row.number)} launched: it is prepared, then runs in the background. Its report arrives as [hemera:probe]; probe_read says where it stands. Keep working.`,
          )
        }).pipe(
          run,
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${said(failed)}`))),
        )

      const read: ProbeWork['read'] = (grant, args) =>
        Effect.gen(function* () {
          if (grant.missionId === null) return refusal('refused: this session works for no mission')
          const number = probeNumberOf(args.probe)
          const row =
            number === null
              ? undefined
              : (yield* probeRowsOf(grant.missionId)).find((one) => one.number === number)
          if (row === undefined) return refusal(`refused: this mission has no Probe ${args.probe}`)
          const report = reportOf(row)
          const label = probeLabel(row.number)
          if (report !== null) return answered(probeReportText(row.number, row.question, report))
          const state = row.state === 'running' && row.stuck ? 'running, stuck' : row.state
          return answered(
            [
              `Probe ${label} is ${state}: ${row.question}`,
              row.failure === null ? null : `It failed: ${row.failure}`,
            ]
              .filter((line) => line !== null)
              .join('\n'),
          )
        }).pipe(
          run,
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${said(failed)}`))),
        )

      /** What the worktrees hold against their commits, read file by file. */
      const capture = (row: ProbeRow) =>
        Effect.gen(function* () {
          const git = yield* Git
          const place = { home: homedir(), platform: process.platform }
          const files: Array<{
            repository: string
            path: string
            status: 'new' | 'modified'
            sha256: string
            content: string | null
            patch: string | null
            withheld: string | null
          }> = []
          const prepared = new Map(
            preparedOf(row).map((one) => [`${one.repository}\0${one.path}`, one.sha256]),
          )
          const kept = { files: 0, bytes: 0 }
          for (const base of basesOf(row)) {
            const worktree = worktreeOf(row.folder, base.repository)
            for (const change of yield* git.worktreeChanges(worktree, base.commit)) {
              const room =
                kept.files < CAPTURE_LIMITS.files ? CAPTURE_LIMITS.bytes - kept.bytes : -1
              const found = yield* readFound(join(worktree, change.path), room)
              // Gone since Git listed it: nothing left to keep.
              if (found === null) continue
              // Left by the preparation, and unchanged since.
              if (prepared.get(`${base.repository}\0${change.path}`) === found.sha256) continue
              const { bytes, sha256 } = found
              const withheld =
                found.withheld ??
                (sensitivePlace(change.path, place, { reading: true }) !== null
                  ? 'content withheld: a sensitive place'
                  : bytes?.includes(0) === true
                    ? 'content withheld: a binary file'
                    : null)
              const content = withheld === null && bytes !== null ? bytes.toString('utf8') : null
              if (content !== null && bytes !== null) {
                kept.files += 1
                kept.bytes += bytes.length
              }
              const patch =
                change.status === 'modified' && content !== null
                  ? yield* git.fileDiff(worktree, base.commit, change.path)
                  : null
              files.push({
                repository: base.repository,
                path: change.path,
                status: change.status,
                sha256,
                content,
                patch,
                withheld,
              })
            }
          }
          return files
        }).pipe(run)

      /** The test a report names, inside the Probe's worktree of its repository, or why not. */
      const testRefusal = (row: ProbeRow, report: ProbeReport): string | null => {
        const test = report.test
        if (test === undefined) return null
        const base = basesOf(row).find((one) => one.repository === test.repository)
        if (base === undefined) {
          return `refused: the test must be inside your worktree, and ${test.repository} is not one of its repositories`
        }
        const worktree = worktreeOf(row.folder, base.repository)
        const path = resolve(worktree, test.path)
        return under(worktree, path) && path !== resolve(worktree)
          ? null
          : `refused: the test must be inside your worktree, and ${test.path} is not`
      }

      const report: ProbeWork['report'] = (grant, args) =>
        Effect.gen(function* () {
          const session = yield* getSession(grant.sessionId)
          const found = yield* probeOfLineage(session.lineage)
          if (found === null) return { answer: refusal('refused: this session is no Probe') }
          return yield* locked(
            found.id,
            Effect.gen(function* () {
              const row = yield* probeRow(found.id)
              if (row === null) return { answer: refusal('refused: this Probe no longer exists') }
              const label = probeLabel(row.number)
              if (row.state !== 'running') {
                return { answer: refusal(`refused: Probe ${label} already ended (${row.state})`) }
              }
              const refused = probeReportRefusal(args) ?? testRefusal(row, args)
              if (refused !== null) return { answer: refusal(refused) }
              const files = yield* capture(row)
              const masked = maskedJson(secrets.maskRecord(args))
              const kept = yield* mutate('keeping a Probe’s report', (transaction) =>
                Effect.gen(function* () {
                  for (const file of files) {
                    if (file.content !== null) {
                      yield* transaction
                        .insert(probeContents)
                        .values({ sha256: file.sha256, content: secrets.mask(file.content) })
                        .onConflictDoNothing()
                        .pipe(Effect.mapError(refusedWhile('keeping what a Probe left')))
                    }
                    yield* transaction
                      .insert(probeFiles)
                      .values({
                        probeId: row.id,
                        repository: file.repository,
                        path: file.path,
                        status: file.status,
                        sha256: file.sha256,
                        patch: file.patch === null ? null : secrets.mask(file.patch),
                        withheld: file.withheld,
                      })
                      .onConflictDoNothing()
                      .pipe(Effect.mapError(refusedWhile('keeping what a Probe left')))
                  }
                  const written = yield* transaction
                    .update(probes)
                    .set({
                      state: 'done',
                      outcome: args.outcome,
                      answer: secrets.mask(args.answer),
                      report: masked,
                      stuck: false,
                      endedAt: new Date().toISOString(),
                    })
                    .where(and(eq(probes.id, row.id), eq(probes.state, 'running')))
                    .returning()
                    .pipe(Effect.mapError(refusedWhile('keeping a Probe’s report')))
                  const [fresh] = written
                  return {
                    result: fresh ?? null,
                    events:
                      fresh === undefined
                        ? []
                        : [
                            probeEvent('probe.ended', fresh, {
                              outcome: args.outcome,
                              answer: fresh.answer,
                            }),
                          ],
                  }
                }),
              )
              if (kept === null) {
                return { answer: refusal(`refused: Probe ${label} already ended`) }
              }
              return {
                answer: answered(
                  `Kept: Probe ${label} ended; the Planner has your report, with ${String(files.length)} file(s) your worktree holds. Your work ends here.`,
                ),
                ended: kept,
              }
            }),
          )
        }).pipe(
          Effect.tap((outcome) =>
            'ended' in outcome && outcome.ended !== undefined
              ? afterEnd(
                  outcome.ended,
                  'it reported',
                  probeReportText(
                    outcome.ended.number,
                    outcome.ended.question,
                    reportOf(outcome.ended) ?? args,
                  ),
                ).pipe(Effect.forkIn(scope))
              : Effect.void,
          ),
          Effect.map((outcome) => outcome.answer),
          run,
          Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${said(failed)}`))),
        )

      // --- the wipe ---------------------------------------------------------------------------

      /** The repositories of the Probe's Project, as its worktrees' sources. */
      const sourcesOf = (row: ProbeRow) =>
        Effect.gen(function* () {
          const facts = yield* missionFacts(row.missionId)
          if (facts === null) return []
          const project = yield* getProject(facts.projectId).pipe(
            Effect.catchTag('UnknownProject', () => Effect.succeed(null)),
          )
          if (project === null) return []
          return project.repositories.map((one) => join(project.mainCheckout, one.path))
        })

      /** The Workspace made in a folder, if one was. */
      const workspaceAt = (folder: string) =>
        Effect.gen(function* () {
          const database = yield* Database
          const [made] = yield* database
            .select({ id: workspaces.id })
            .from(workspaces)
            .where(eq(workspaces.folder, folder))
            .pipe(Effect.mapError(refusedWhile('reading the Workspaces')))
          return made?.id ?? null
        })

      const wipe: ProbeWork['wipe'] = (probeId) =>
        locked(
          probeId,
          Effect.gen(function* () {
            const background = preparing.get(probeId)
            if (background !== undefined) yield* Fiber.interrupt(background)
            const kept = yield* probeRow(probeId)
            if (kept === null || kept.state === 'wiped') return
            // A Workspace made just before its preparation was cut short may not be linked yet.
            const row = {
              ...kept,
              workspaceId: kept.workspaceId ?? (yield* workspaceAt(kept.folder)),
            }
            yield* mutate('wiping a Probe', (transaction) =>
              transaction
                .update(probes)
                .set({
                  state: 'wiping',
                  stuck: false,
                  wipeAttempts: row.wipeAttempts + 1,
                  endedAt: row.endedAt ?? new Date().toISOString(),
                })
                .where(eq(probes.id, row.id))
                .pipe(
                  Effect.mapError(refusedWhile('wiping a Probe')),
                  Effect.as({ result: undefined, events: [] }),
                ),
            )
            // 1. Its whole process tree: its sessions and every run of its Workspace.
            yield* stopProcesses(row, 'its Probe is wiped')
            const done = yield* Effect.gen(function* () {
              // 2. The Project's Cleanup steps for its folder, never the Closing.
              yield* cleanup.run({ probeId: row.id, missionId: row.missionId, folder: row.folder })
              // 3 and 4. Removed by force, pruned, then checked gone.
              yield* removeFolder(row.folder, yield* sourcesOf(row))
            }).pipe(Effect.result)
            if (Result.isFailure(done)) {
              const error = secrets.mask(said(done.failure))
              yield* mutate('saying a wipe failed', (transaction) =>
                transaction
                  .update(probes)
                  .set({ wipeError: error })
                  .where(eq(probes.id, row.id))
                  .pipe(
                    Effect.mapError(refusedWhile('saying a wipe failed')),
                    Effect.as({
                      result: undefined,
                      events: [probeEvent('probe.wipe_failed', row, { error })],
                    }),
                  ),
              )
              return yield* new ProbeWipeFailed({ reason: error })
            }
            yield* mutate('ending a wipe', (transaction) =>
              Effect.gen(function* () {
                if (row.workspaceId !== null) {
                  yield* transaction
                    .delete(workspaces)
                    .where(eq(workspaces.id, row.workspaceId))
                    .pipe(Effect.mapError(refusedWhile('forgetting the Probe’s Workspace')))
                }
                yield* transaction
                  .update(probes)
                  .set({ state: 'wiped', wipeError: null })
                  .where(eq(probes.id, row.id))
                  .pipe(Effect.mapError(refusedWhile('ending a wipe')))
                return { result: undefined, events: [probeEvent('probe.wiped', row)] }
              }),
            )
            yield* releaseReservations(row)
          }),
        ).pipe(run)

      const wipeAll: ProbeWork['wipeAll'] = (missionId) =>
        Effect.gen(function* () {
          const failures: string[] = []
          for (const row of yield* probeRowsOf(missionId)) {
            if (row.state === 'wiped') continue
            yield* wipe(row.id).pipe(
              Effect.catchTag('ProbeWipeFailed', (failed) =>
                Effect.sync(
                  () => void failures.push(`${probeLabel(row.number)}: ${failed.reason}`),
                ),
              ),
            )
          }
          if (failures.length > 0) {
            return yield* new ProbeWipeFailed({ reason: failures.join('; ') })
          }
        }).pipe(run)

      yield* desk.serve({ launch, read, report, wipe, wipeAll })

      // --- what follows the Probes ------------------------------------------------------------

      // A turn that ended without the report: told once, then failed.
      const post = yield* SessionPost
      const silentEnd = (sessionId: string) =>
        Effect.gen(function* () {
          const session = yield* getSession(sessionId)
          if (session.role !== 'probe') return
          const found = yield* probeOfLineage(session.lineage)
          if (found?.state !== 'running') return
          yield* sessions.settled(sessionId)
          if ((yield* getSession(sessionId)).state !== 'idle') return
          const failed = yield* locked(
            found.id,
            Effect.gen(function* () {
              const row = yield* probeRow(found.id)
              if (row?.state !== 'running') return null
              if (!row.reminded) {
                yield* moved(row, ['running'], { reminded: true })
                yield* sessions.deliver({
                  owner: session.owner,
                  target: { lineage: row.lineage },
                  kind: 'reminder',
                  body: END_WITH_REPORT,
                })
                return null
              }
              return (yield* failIn(row, NO_REPORT)) ? row : null
            }),
          )
          if (failed !== null) yield* afterEnd(failed, NO_REPORT, failedBody(failed, NO_REPORT))
        }).pipe(
          run,
          Effect.catchCause((cause) => log(`a turn's end was not followed: ${String(cause)}`)),
        )
      yield* post.turns.pipe(
        Stream.filter((turn) => !turn.on),
        Stream.runForEach((turn) => Effect.forkIn(silentEnd(turn.sessionId), scope)),
        Effect.forkScoped,
      )

      // A session of a Probe stuck (#40): its chip says so until its lineage speaks again.
      const events = yield* DomainEvents.use((domain) => domain.subscribe)
      const stuckSession = (lineage: string) =>
        Effect.gen(function* () {
          const row = yield* probeOfLineage(lineage)
          if (row?.state !== 'running') return
          stuck.add(lineage)
          yield* moved(row, ['running'], { stuck: true }, (fresh) => [
            probeEvent('probe.stuck', fresh),
          ])
        })
      const lineages = new Map<string, string>()
      const spoke = (sessionId: string) =>
        Effect.gen(function* () {
          if (stuck.size === 0) return
          const known = lineages.get(sessionId)
          const lineage = known ?? (yield* getSession(sessionId)).lineage
          lineages.set(sessionId, lineage)
          if (!stuck.has(lineage)) return
          stuck.delete(lineage)
          const row = yield* probeOfLineage(lineage)
          if (row === null) return
          yield* moved(row, ['running'], { stuck: false }, (fresh) => [
            probeEvent('probe.unstuck', fresh),
          ])
        })
      const readLineage = Schema.decodeUnknownOption(Schema.String)
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === 'session.stuck' && event.payload['role'] === 'probe') {
              const lineage = readLineage(event.payload['lineage'])
              if (Option.isSome(lineage)) yield* stuckSession(lineage.value)
            }
            // A mission that left Planning keeps no Probe (#92 wipes them at Freeze too).
            if (event.type === 'mission.moved' && event.payload['from'] === 'planning') {
              yield* wipeAll(event.entityId).pipe(
                Effect.catchTag('ProbeWipeFailed', (failed) =>
                  log(`the Probes of ${event.entityId} were not all wiped: ${failed.reason}`),
                ),
              )
            }
          }).pipe(
            run,
            Effect.catchCause((cause) => log(`an event was not followed: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )
      const runtime = yield* AgentRuntime
      yield* runtime.activity.pipe(
        Stream.filter(({ event }) => !event.replay),
        Stream.runForEach(({ sessionId }) =>
          spoke(sessionId).pipe(
            run,
            Effect.catchCause((cause) => log(`a sign of life was not read: ${String(cause)}`)),
          ),
        ),
        Effect.forkScoped,
      )

      // At every start, once automations may run: the reconciliation, both ways.
      const reconcile = Effect.gen(function* () {
        const rows = yield* allProbeRows
        for (const row of rows) {
          if (row.state === 'wiped') continue
          const facts = yield* missionFacts(row.missionId)
          if (facts === null || facts.stage !== 'planning' || row.state === 'wiping') {
            yield* wipe(row.id).pipe(
              Effect.catchTag('ProbeWipeFailed', (failed) =>
                log(`Probe ${row.id} was not wiped: ${failed.reason}`),
              ),
            )
          }
        }
        // A folder no Probe knows: its worktrees removed by force and pruned, then checked gone.
        // Known is read again just before each removal: a Probe may be launched meanwhile. What is
        // not a folder is no Probe's, and left where it is.
        const known = (folder: string) =>
          Effect.map(allProbeRows, (every) =>
            every.some(
              (row) => row.state !== 'wiped' && comparable(row.folder) === comparable(folder),
            ),
          )
        const foldersIn = (folder: string) =>
          readdirSync(folder, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(folder, entry.name))
        const root = join(dataFolder, PROBES_FOLDER)
        if (settings.hold !== undefined) yield* settings.hold('sweeping')
        for (const keyFolder of existsSync(root) ? foldersIn(root) : []) {
          for (const folder of foldersIn(keyFolder)) {
            if (yield* known(folder)) continue
            yield* removeFolder(folder, []).pipe(
              Effect.andThen(forgetWorkspaceAt(folder)),
              Effect.catch((failed) => log(`${folder} was not wiped: ${said(failed)}`)),
            )
          }
          if (readdirSync(keyFolder).length === 0)
            rmSync(keyFolder, { recursive: true, force: true })
        }
        for (const row of yield* allProbeRows) {
          if (row.state !== 'interrupted') continue
          const facts = yield* missionFacts(row.missionId)
          if (facts?.stage === 'planning') yield* begin(row.id)
        }
        yield* log('reconciled')
      })
      const forgetWorkspaceAt = (folder: string) =>
        mutate('forgetting a Workspace no Probe knows', (transaction) =>
          transaction
            .delete(workspaces)
            .where(eq(workspaces.folder, folder))
            .pipe(
              Effect.mapError(refusedWhile('forgetting a Workspace')),
              Effect.as({ result: undefined, events: [] }),
            ),
        )
      const gate = yield* AutomationGate
      const memory = yield* Memory
      yield* gate.pass.pipe(
        Effect.andThen(memory.ready),
        Effect.andThen(reconcile.pipe(run)),
        Effect.catchCause((cause) => log(`the Probes were not reconciled: ${String(cause)}`)),
        Effect.forkScoped,
      )
    }),
  )
