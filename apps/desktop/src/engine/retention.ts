/**
 * The retention classes, declared in one place, and the rotation of the diagnostic class.
 *
 * - **permanent**: the history of a mission (its records, its marks, its needs and their answers,
 *   the journal), kept as long as the mission exists and never purged;
 * - **heavy**: the large pieces tied to a mission (`missions/<key>/evidence/` and the rows that
 *   reference it, the contents of the snapshots), kept as long as the mission;
 * - **diagnostic**: what helps understand a run and nothing more (`diagnostic.log`, the ACP traces
 *   under `traces/`, the outputs of commands), rotated by age and by total size, never while its
 *   mission is live;
 * - **state**: what the Profile is made of rather than a history (Projects, Workspaces,
 *   preferences), kept as long as what it describes.
 *
 * Every table of the schema and every file of the data folder that holds history or diagnostics
 * is declared here; a test fails on one that is not. Only the diagnostic class is ever rotated.
 */

import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LIVE_RUN_STATES, LIVE_SESSION_STATES } from '@hemera/core/domain'
import { type Table, eq, getTableName, inArray, notInArray, sql } from 'drizzle-orm'
import { Effect } from 'effect'

import { DIAGNOSTIC_FILE, DIAGNOSTIC_GENERATION, TRACES_FOLDER } from '../main/diagnostic.ts'
import { MISSIONS_FOLDER } from './memory/files.ts'
import { Database, refusedWhile } from './storage/database.ts'
import { agentSessions, commandRuns, missions, sessionThreads } from './storage/schema.ts'
import { mutate } from './transaction.ts'

/** How old a diagnostic file or row may get, and how much the diagnostic class may weigh. */
export const MAX_AGE_DAYS = 30
export const MAX_TOTAL_MEGABYTES = 500

/** How often the diagnostic class is swept once the engine has started. */
export const SWEEP_EVERY = '1 hour'

export type RetentionClass = 'permanent' | 'heavy' | 'diagnostic' | 'state'

/** The class of every table of the schema, by its name in the database. */
export const TABLE_CLASSES = {
  profile: 'state',
  app_preferences: 'state',
  domain_events: 'permanent',
  projects: 'state',
  project_repositories: 'state',
  workspaces: 'state',
  workspace_repositories: 'state',
  project_preparation_steps: 'state',
  workspace_steps: 'state',
  environment_variables: 'state',
  project_commands: 'state',
  project_never_entries: 'state',
  command_runs: 'diagnostic',
  supervised_processes: 'state',
  missions: 'permanent',
  mission_marks: 'permanent',
  needs: 'permanent',
  need_deliveries: 'permanent',
  mission_stops: 'permanent',
  agent_sessions: 'permanent',
  session_deliveries: 'state',
  runner_leases: 'state',
  session_threads: 'diagnostic',
  role_models: 'state',
  model_marks: 'state',
  mission_spent: 'permanent',
  task_attempts: 'permanent',
  session_usage: 'permanent',
  session_needs: 'state',
  chats: 'permanent',
  chat_entries: 'permanent',
  effectful_actions: 'permanent',
  tool_calls: 'permanent',
  session_files: 'state',
  permission_requests: 'permanent',
  mission_grants: 'permanent',
  queued_deliveries: 'state',
  projection_cursors: 'state',
  memory_journal: 'permanent',
  memory_now_lines: 'permanent',
  memory_next: 'permanent',
  memory_notes: 'permanent',
  memory_evidence: 'heavy',
} as const satisfies Record<string, RetentionClass>

/**
 * The class of every file and folder of the data folder that holds history or diagnostics. The
 * diagnostic log stands for its earlier generations too; the traces folder for every file in it.
 */
export const FILE_CLASSES = {
  [DIAGNOSTIC_FILE]: 'diagnostic',
  [TRACES_FOLDER]: 'diagnostic',
  // The Memory's evidence, and the markdown files regenerated from the database beside it.
  [MISSIONS_FOLDER]: 'heavy',
} as const satisfies Record<string, RetentionClass>

/** The tables among these that have no class: what a later ticket forgot to declare. */
export const undeclaredTables = (tables: ReadonlyArray<Table>): ReadonlyArray<string> =>
  tables.map(getTableName).filter((name) => !Object.hasOwn(TABLE_CLASSES, name))

const DAY_MILLIS = 24 * 60 * 60 * 1000
const MEGABYTE = 1024 * 1024

export interface SweepLimits {
  readonly now: number
  readonly maxTotalBytes: number
}

/** What a sweep removed. */
export interface Swept {
  readonly files: ReadonlyArray<string>
  readonly runs: ReadonlyArray<string>
  /** The sessions whose hidden thread went. */
  readonly threads: ReadonlyArray<string>
}

/**
 * Sweeps the diagnostic class: what is older than 30 days goes, then the oldest go while the
 * whole class weighs more than 500 MB. Nothing a live mission holds goes, whatever its age; files
 * tied to no mission rotate freely. The permanent, heavy and state classes are never read here.
 */
export const sweepDiagnostics = (dataFolder: string, limits: Partial<SweepLimits> = {}) =>
  Effect.gen(function* () {
    const now = limits.now ?? Date.now()
    const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_MEGABYTES * MEGABYTE
    const cutoff = now - MAX_AGE_DAYS * DAY_MILLIS
    const database = yield* Database

    const live = yield* database
      .select({ id: missions.id })
      .from(missions)
      .where(notInArray(missions.stage, ['done', 'cancelled']))
      .pipe(Effect.mapError(refusedWhile('reading the live missions')))
    const liveMissions = new Set(live.map((row) => row.id))
    const runs = yield* database
      .select({
        id: commandRuns.id,
        missionId: commandRuns.missionId,
        state: commandRuns.state,
        startedAt: commandRuns.startedAt,
        endedAt: commandRuns.endedAt,
        // Bytes, not characters: a mask is three characters and nine bytes.
        bytes: sql<number>`length(cast(${commandRuns.output} as blob))`,
      })
      .from(commandRuns)
      .pipe(Effect.mapError(refusedWhile('reading the runs')))

    // A session's hidden thread is one piece: its weight and its last line's date.
    const threads = yield* database
      .select({
        id: sessionThreads.sessionId,
        at: sql<string>`max(${sessionThreads.at})`,
        bytes: sql<number>`sum(length(cast(${sessionThreads.text} as blob)))`,
        ownerKind: agentSessions.ownerKind,
        ownerId: agentSessions.ownerId,
        state: agentSessions.state,
      })
      .from(sessionThreads)
      .leftJoin(agentSessions, eq(agentSessions.id, sessionThreads.sessionId))
      .groupBy(sessionThreads.sessionId)
      .pipe(Effect.mapError(refusedWhile('reading the sessions’ threads')))

    const listed = (folder: string) => {
      try {
        return readdirSync(folder).map((name) => ({ name, path: join(folder, name) }))
      } catch {
        return []
      }
    }
    // The traces are tied to no mission this sweep can see: they rotate freely.
    const files = [
      ...listed(dataFolder).filter(
        ({ name }) =>
          DIAGNOSTIC_GENERATION.test(name) && FILE_CLASSES[DIAGNOSTIC_FILE] === 'diagnostic',
      ),
      ...listed(join(dataFolder, TRACES_FOLDER)).filter(
        ({ name }) => name.endsWith('.log') && FILE_CLASSES[TRACES_FOLDER] === 'diagnostic',
      ),
    ].flatMap(({ path }) => {
      try {
        const stat = statSync(path)
        return [{ path, bytes: stat.size, at: stat.mtimeMs }]
      } catch {
        return []
      }
    })

    // Each piece of the diagnostic class: its weight, its date, and whether a live mission holds it.
    const pieces = [
      ...files.map((file) => ({
        kind: 'file' as const,
        key: file.path,
        bytes: file.bytes,
        at: file.at,
        held: false,
      })),
      ...threads.map((thread) => ({
        kind: 'thread' as const,
        key: thread.id,
        bytes: thread.bytes,
        at: Date.parse(thread.at),
        held:
          LIVE_SESSION_STATES.some((state) => state === thread.state) ||
          (thread.ownerKind === 'mission' &&
            thread.ownerId !== null &&
            liveMissions.has(thread.ownerId)),
      })),
      ...runs.map((run) => ({
        kind: 'run' as const,
        key: run.id,
        bytes: run.bytes,
        at: Date.parse(run.endedAt ?? run.startedAt),
        held:
          LIVE_RUN_STATES.some((state) => state === run.state) ||
          (run.missionId !== null && liveMissions.has(run.missionId)),
      })),
    ]
    const gone = new Set(pieces.filter((piece) => !piece.held && piece.at < cutoff))
    let total = pieces.filter((piece) => !gone.has(piece)).reduce((sum, p) => sum + p.bytes, 0)
    for (const piece of pieces
      .filter((one) => !one.held && !gone.has(one))
      .toSorted((a, b) => a.at - b.at)) {
      if (total <= maxTotalBytes) break
      gone.add(piece)
      total -= piece.bytes
    }

    const removedFiles = [...gone]
      .filter((piece) => piece.kind === 'file')
      .map((piece) => piece.key)
    for (const path of removedFiles) rmSync(path, { force: true })
    const removedRuns = [...gone].filter((piece) => piece.kind === 'run').map((piece) => piece.key)
    if (removedRuns.length > 0) {
      yield* mutate('rotating the outputs of runs', (transaction) =>
        transaction
          .delete(commandRuns)
          .where(inArray(commandRuns.id, removedRuns))
          .pipe(
            Effect.mapError(refusedWhile('rotating the outputs of runs')),
            Effect.as({ result: undefined, events: [] }),
          ),
      )
    }
    const removedThreads = [...gone]
      .filter((piece) => piece.kind === 'thread')
      .map((piece) => piece.key)
    if (removedThreads.length > 0) {
      yield* mutate('rotating the sessions’ threads', (transaction) =>
        transaction
          .delete(sessionThreads)
          .where(inArray(sessionThreads.sessionId, removedThreads))
          .pipe(
            Effect.mapError(refusedWhile('rotating the sessions’ threads')),
            Effect.as({ result: undefined, events: [] }),
          ),
      )
    }
    return { files: removedFiles, runs: removedRuns, threads: removedThreads } satisfies Swept
  })
