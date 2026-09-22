/**
 * The commands of a Project, and the processes they become (design D6-11, D6-12).
 *
 * One service answers both callers — the agent through `commands_run` and the user through the
 * Project's settings — because a command is one thing with one catalogue and one set of runs. A
 * run is started by the Session that asked for it, and the Commands panel of a Session shows what
 * that Session started; but a run is the Project's to share (D6-12): any Session of the Project
 * joins a running app, reads a run's output and stops it.
 *
 * Three rules live here rather than in the tool that asks:
 *
 * - an `app` command that is already running is handed back, never started twice, which is what
 *   `joinsRunningRun` decides and what makes a second `run` harmless;
 * - the output is kept bounded, because a process that prints for an hour must not become an
 *   hour of rows, and what was dropped is said rather than hidden;
 * - nothing outlives the engine: every process is started in the engine's own scope, so a quit
 *   takes every tree down whether or not anyone called `stop` (D5-04).
 *
 * The output is read as it arrives and never awaited: `run` answers with what there is when it
 * is asked, which is what lets a dev server that never exits still be usable. The row of a run
 * is written when it starts and rewritten when it ends, so a panel reopened after a restart
 * reads what was run and how it ended — and the Session's thread gets that same run as one
 * entry that changes state, because a run shows in the panel and in the thread (D6-12).
 */

import {
  type Command,
  type CommandKind,
  addressIn,
  commandKind,
  commandLine,
  commandName,
  DuplicateCommandNameError,
  joinsRunningRun,
} from '@hemera/core'
import { and, desc, eq } from 'drizzle-orm'
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from 'effect'

import { ProcessSupervisor } from '../agents/supervisor.ts'
import { Sessions } from '../sessions.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import { type RunState, commandRuns, projectCommands, sessions } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { hostLookup, invocationOf } from './line.ts'

/** How many runs `recent` hands back: what a panel draws, oldest ones out of sight. */
const RECENT_RUNS = 8

/** How much of what a run printed is kept: what is older than this is dropped, and said to be. */
export const OUTPUT_KEPT_BYTES = 64 * 1024

/**
 * How long the pipes of a run that ended are still read before its end is written: a process's
 * exit can be reported before the last of what it printed has been read.
 */
const DRAIN_MS = 100

/** How long a run has to die quietly before its tree is taken down. */
const GRACE_MS = 5_000

/** A run was asked for by an identifier nothing of this Session answers to. */
export class UnknownRunError extends Error {
  constructor(readonly id: string) {
    super(`no run of this Project has the identifier "${id}"`)
    this.name = 'UnknownRunError'
  }
}

/** A command was asked for by a name the catalogue does not hold. */
export class UnknownCommandError extends Error {
  constructor(override readonly name: string) {
    super(`this Project has no command named "${name}"`)
    this.name = 'UnknownCommandError'
  }
}

/** One run of a command, as a panel and as a tool read it. */
export interface Run {
  readonly id: string
  readonly projectId: string
  readonly sessionId: string
  /** The catalogue entry it is, and null for a one-off command line. */
  readonly commandId: string | null
  readonly name: string
  readonly line: string
  readonly kind: CommandKind
  readonly cwd: string
  readonly state: RunState
  readonly pid: number | null
  /** The address it published, and null while it has published none. */
  readonly url: string | null
  readonly exitCode: number | null
  /** The end of what it printed, bounded: what fits in `OUTPUT_KEPT_BYTES`. */
  readonly output: string
  /** How many bytes of the beginning were dropped, and 0 when nothing was. */
  readonly dropped: number
  readonly startedAt: string
  readonly endedAt: string | null
}

/** The same, and whether this is a run that was already going. */
export interface RunView extends Run {
  readonly joined: boolean
}

/** What the caller hands over to start or join a run. */
export interface RunRequest {
  readonly sessionId: string
  readonly projectId: string
  readonly commandId: string | null
  readonly name: string
  readonly line: string
  readonly kind: CommandKind
  /** Where it runs: the Workspace root, or one of the Project's repositories under it. */
  readonly cwd: string
  readonly startedBy: 'agent' | 'user'
}

/** What a catalogue entry is written from. */
export interface CommandEdit {
  readonly projectId: string
  readonly name: string
  readonly line: string
  readonly kind: string
  /** The repository it runs in, relative to the root, and null for the root itself. */
  readonly folder: string | null
}

export interface CommandsService {
  /** The catalogue of a Project, oldest first. */
  readonly list: (projectId: string) => Effect.Effect<Command[], DatabaseError>
  /** Writes a catalogue entry: a new one, or the named one when `replace` is true. */
  readonly save: (
    edit: CommandEdit,
    replace: boolean,
  ) => Effect.Effect<Command, DatabaseError | DuplicateCommandNameError>
  /** Takes one out by name. What it already ran is not touched. */
  readonly remove: (
    projectId: string,
    name: string,
  ) => Effect.Effect<void, DatabaseError | UnknownCommandError>
  /** Starts a run, or hands back the one that is already going (D6-12). */
  readonly run: (asked: RunRequest) => Effect.Effect<RunView, DatabaseError>
  /**
   * What a run has printed, bounded, and the address it published.
   *
   * A run that is over is read from its row, where a `check` that exited kept its output and its
   * exit code: the question is about the run, not about the process.
   */
  readonly output: (
    sessionId: string,
    runId: string,
  ) => Effect.Effect<RunView, UnknownRunError | DatabaseError>
  /** Stops a run and everything it started. */
  readonly stop: (
    sessionId: string,
    runId: string,
  ) => Effect.Effect<RunView, UnknownRunError | DatabaseError>
  /** What this Session has running, oldest first: what the panel draws. */
  readonly running: (sessionId: string) => Effect.Effect<RunView[]>
  /**
   * The last runs of a Session, newest first, ended ones included.
   *
   * The panel draws them, and `commands_output` answers from them when the agent reads the run
   * it just started: a `check` or a `utility` ends on its own, and its exit code and its output
   * are what the agent came for.
   */
  readonly recent: (sessionId: string) => Effect.Effect<RunView[], DatabaseError>
  /**
   * Waits up to `milliseconds` for a run to end, and answers it as it then stands: ended, with
   * its exit code and all it printed, or still running.
   */
  readonly awaited: (
    sessionId: string,
    runId: string,
    milliseconds: number,
  ) => Effect.Effect<RunView, UnknownRunError | DatabaseError>
  /** Stops everything of a Session, or everything at all when no Session is named. */
  readonly stopped: (sessionId?: string | undefined) => Effect.Effect<void, DatabaseError>
}

export class Commands extends Context.Service<Commands, CommandsService>()('Commands') {}

/** One live run: what it is, what it has printed, and how to end it. */
interface Live {
  readonly sessionId: string
  readonly projectId: string
  readonly commandId: string | null
  readonly name: string
  readonly line: string
  readonly kind: CommandKind
  readonly cwd: string
  /** Who asked for it: the agent through its tool, or the user through the panel. */
  readonly startedBy: 'agent' | 'user'
  readonly startedAt: string
  state: RunState
  pid: number | null
  url: string | null
  exitCode: number | null
  kept: string
  dropped: number
  endedAt: string | null
  stop: Effect.Effect<void>
  /**
   * Whether Hemera asked it to stop. The watcher reads it when the process ends, so a run that
   * was stopped ends `stopped` however the platform reports the death — `taskkill` exits 1 —
   * and the end is written once, by the watcher, never by the stop racing it.
   */
  stopping: boolean
  /** Completed once the end of the run has been written: what a stop waits for. */
  readonly ended: Deferred.Deferred<void>
}

/**
 * The engine's commands, over the database and the process supervisor.
 *
 * The runs are in memory and their rows are in the database, and the two say different things:
 * the memory is what can still be asked to stop, and the row is what survives this process — a
 * run whose process is gone is a row, which is exactly what a panel reopened after a restart
 * should read.
 */
export const commandsLayer = Layer.effect(
  Commands,
  Effect.gen(function* () {
    const database = yield* Database
    const supervisor = yield* ProcessSupervisor
    // Named for what it is used for here, because `sessions` is already the table of rows this
    // service joins on: what a run writes is one entry of the Session's thread.
    const thread = yield* Sessions
    /** The engine's own scope: everything started here dies when the engine does. */
    const scope = yield* Effect.scope
    const live = new Map<string, Live>()

    /** An effect that needs a scope, run in the engine's: everything it starts dies with it. */
    const owned = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Effect.Effect<A, E> =>
      effect.pipe(Scope.provide(scope))

    /** A watcher that lives as long as the engine does, and no longer. */
    const watching = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<void> =>
      Effect.forkIn(scope)(effect).pipe(Effect.asVoid)

    const failed = (doing: string) => (cause: unknown) => new DatabaseError({ doing, cause })

    const withDatabase = <A, E>(effect: Effect.Effect<A, E, Database>): Effect.Effect<A, E> =>
      effect.pipe(Effect.provideService(Database, database))

    /** The state of a run read from its row, which the table's check constraint already closed. */
    const runStateOf = (state: string): RunState => {
      switch (state) {
        case 'running':
        case 'exited':
        case 'failed':
        case 'stopped':
          return state
        default:
          return 'failed'
      }
    }

    const viewOf = (id: string, one: Live, joined = false): RunView => ({
      id,
      projectId: one.projectId,
      sessionId: one.sessionId,
      commandId: one.commandId,
      name: one.name,
      line: one.line,
      kind: one.kind,
      cwd: one.cwd,
      state: one.state,
      pid: one.pid,
      url: one.url,
      exitCode: one.exitCode,
      output: one.kept,
      dropped: one.dropped,
      startedAt: one.startedAt,
      endedAt: one.endedAt,
      joined,
    })

    /**
     * A run read from its row rather than from memory: what a process that is gone left behind.
     *
     * `outputBytes` is what the run printed altogether and `output` is what was kept of it, so
     * what was dropped is what the two differ by — the number the panel says out loud.
     */
    const rowOf = (row: typeof commandRuns.$inferSelect, projectId: string): RunView => ({
      id: row.id,
      projectId,
      sessionId: row.sessionId,
      commandId: row.commandId,
      name: row.name,
      line: row.line,
      kind: commandKind(row.kind),
      cwd: row.cwd,
      state: runStateOf(row.state),
      pid: row.pid,
      url: row.url,
      exitCode: row.exitCode,
      output: row.output,
      dropped: row.truncated === 1 ? row.outputBytes - row.output.length : 0,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      joined: false,
    })

    /**
     * The entry a run is in the thread: a run shows in the panel and in the thread (D6-12).
     *
     * One entry per run and not one per transition — the `correlationId` is the run itself, so
     * the write that says it ended updates the row that said it had started, and the thread
     * keeps one block that changes state rather than a log of the same command four times.
     *
     * A write that fails is a Session that went away while its command was running: the run is
     * unaffected, because what it printed and how it ended are its row's, not the thread's.
     */
    const writeEntry = (id: string, one: Live) =>
      thread
        .write(one.sessionId, {
          role: 'hemera',
          kind: 'command_run',
          body: one.name,
          payload: JSON.stringify({
            runId: id,
            name: one.name,
            line: one.line,
            kind: one.kind,
            state: one.state,
            cwd: one.cwd,
            url: one.url,
            exitCode: one.exitCode,
            startedBy: one.startedBy,
            // A one-off is a line the agent wrote rather than a command of the catalogue, and
            // the block says so: what is not in the catalogue cannot be run again by name.
            oneOff: one.commandId === null,
          }),
          correlationId: `run:${id}`,
          turnId: null,
          state: one.state,
        })
        .pipe(Effect.catch(() => Effect.void))

    /** The row of a run and its entry in the thread, written as it starts and when it ends. */
    const writeRow = (id: string, one: Live, type: string) =>
      withDatabase(
        mutate('recording a run', (transaction) =>
          Effect.gen(function* () {
            const row = {
              id,
              sessionId: one.sessionId,
              commandId: one.commandId,
              name: one.name,
              line: one.line,
              kind: one.kind,
              cwd: one.cwd,
              state: one.state,
              pid: one.pid,
              url: one.url,
              exitCode: one.exitCode,
              output: one.kept,
              outputBytes: one.kept.length + one.dropped,
              truncated: one.dropped > 0 ? 1 : 0,
              startedBy: one.startedBy,
              startedAt: one.startedAt,
              endedAt: one.endedAt,
            }
            const existing = yield* transaction
              .select({ id: commandRuns.id })
              .from(commandRuns)
              .where(eq(commandRuns.id, id))
              .pipe(Effect.mapError(failed('reading the run')))
            if (existing.length === 0) {
              yield* transaction
                .insert(commandRuns)
                .values(row)
                .pipe(Effect.mapError(failed('writing the run')))
            } else {
              yield* transaction
                .update(commandRuns)
                .set(row)
                .where(eq(commandRuns.id, id))
                .pipe(Effect.mapError(failed('writing the run')))
            }
            return {
              result: undefined,
              events: [
                {
                  type,
                  entityKind: 'session' as const,
                  entityId: one.sessionId,
                  // Who asked is who the Journal names: a run the user started from the panel is
                  // the user's, and one the agent asked for through its tool is the tool's.
                  source: one.startedBy === 'user' ? ('ui' as const) : ('system' as const),
                  author: one.startedBy === 'user' ? ('human' as const) : ('mcp' as const),
                  projectId: one.projectId,
                  sessionId: one.sessionId,
                  payload: { name: one.name, state: one.state, url: one.url },
                },
              ],
            }
          }),
        ),
      ).pipe(Effect.tap(() => writeEntry(id, one)))

    /** The Project a Session belongs to, and null for a Session this database does not hold. */
    const projectOf = (sessionId: string) =>
      database
        .select({ projectId: sessions.projectId })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .pipe(
          Effect.mapError(failed('reading the Session of a run')),
          Effect.map((rows) => rows[0]?.projectId ?? null),
        )

    /**
     * Stops a run and waits for its end to be written.
     *
     * The stop does not write the end itself: it says it asked, and the watcher that sees the
     * process die writes `stopped` once. A run that has already ended is left as it ended.
     */
    const stopRun = (record: Live) =>
      Effect.gen(function* () {
        if (record.state === 'running') {
          record.stopping = true
          yield* record.stop
        }
        yield* Deferred.await(record.ended)
      })

    const service: CommandsService = {
      list: (projectId) =>
        database
          .select()
          .from(projectCommands)
          .where(eq(projectCommands.projectId, projectId))
          .orderBy(projectCommands.createdAt)
          .pipe(
            Effect.mapError(failed('reading the commands')),
            Effect.flatMap((rows) =>
              Effect.try({
                try: () =>
                  rows.map((row): Command => ({
                    id: row.id,
                    projectId: row.projectId,
                    name: row.name,
                    line: row.line,
                    kind: commandKind(row.kind),
                    folder: row.folder === '' ? null : row.folder,
                    createdAt: Date.parse(row.createdAt),
                  })),
                catch: (cause) => new DatabaseError({ doing: 'reading the commands', cause }),
              }),
            ),
          ),

      save: (edit, replace) =>
        withDatabase(
          mutate('saving a command', (transaction) =>
            Effect.gen(function* () {
              const name = commandName(edit.name)
              const line = commandLine(edit.line)
              const kind = commandKind(edit.kind)
              const at = new Date().toISOString()
              const existing = yield* transaction
                .select()
                .from(projectCommands)
                .where(
                  and(
                    eq(projectCommands.projectId, edit.projectId),
                    eq(projectCommands.name, name),
                  ),
                )
                .pipe(Effect.mapError(failed('reading the commands')))
              if (existing.length > 0 && !replace) {
                return yield* Effect.fail(new DuplicateCommandNameError(name))
              }
              const id = existing[0]?.id ?? crypto.randomUUID()
              const folder = edit.folder ?? ''
              const createdAt = existing[0]?.createdAt ?? at
              if (existing.length === 0) {
                yield* transaction
                  .insert(projectCommands)
                  .values({
                    id,
                    projectId: edit.projectId,
                    name,
                    line,
                    kind,
                    folder,
                    createdAt,
                    updatedAt: at,
                  })
                  .pipe(Effect.mapError(failed('writing the commands')))
              } else {
                yield* transaction
                  .update(projectCommands)
                  .set({ line, kind, folder, updatedAt: at })
                  .where(eq(projectCommands.id, id))
                  .pipe(Effect.mapError(failed('writing the commands')))
              }
              return {
                result: {
                  id,
                  projectId: edit.projectId,
                  name,
                  line,
                  kind,
                  folder: edit.folder,
                  createdAt: Date.parse(createdAt),
                } satisfies Command,
                events: [
                  {
                    type: existing.length === 0 ? 'command.created' : 'command.updated',
                    entityKind: 'project' as const,
                    entityId: edit.projectId,
                    source: 'ui' as const,
                    author: 'human' as const,
                    projectId: edit.projectId,
                    payload: { name, kind },
                  },
                ],
              }
            }),
          ),
        ),

      remove: (projectId, name) =>
        withDatabase(
          mutate('removing a command', (transaction) =>
            Effect.gen(function* () {
              const removed = yield* transaction
                .delete(projectCommands)
                .where(
                  and(eq(projectCommands.projectId, projectId), eq(projectCommands.name, name)),
                )
                .returning({ id: projectCommands.id })
                .pipe(Effect.mapError(failed('writing the commands')))
              if (removed.length === 0) return yield* Effect.fail(new UnknownCommandError(name))
              return {
                result: undefined,
                events: [
                  {
                    type: 'command.removed',
                    entityKind: 'project' as const,
                    entityId: projectId,
                    source: 'ui' as const,
                    author: 'human' as const,
                    projectId,
                    payload: { name },
                  },
                ],
              }
            }),
          ),
        ),

      run: (asked) =>
        Effect.gen(function* () {
          // An app is the Project's, not the Session's (D6-12): a second Session that asks for
          // the one already running is handed that one, and can read and stop it like its own.
          const already = [...live.entries()].find(
            ([, one]) =>
              one.projectId === asked.projectId &&
              one.name === asked.name &&
              one.state === 'running',
          )
          if (
            already !== undefined &&
            joinsRunningRun(asked.kind, already[1].state === 'running')
          ) {
            return viewOf(already[0], already[1], true)
          }

          const id = crypto.randomUUID()
          const startedAt = new Date().toISOString()
          const record: Live = {
            sessionId: asked.sessionId,
            projectId: asked.projectId,
            commandId: asked.commandId,
            name: asked.name,
            line: asked.line,
            kind: asked.kind,
            cwd: asked.cwd,
            startedBy: asked.startedBy,
            startedAt,
            state: 'running',
            pid: null,
            url: null,
            exitCode: null,
            kept: '',
            dropped: 0,
            endedAt: null,
            stop: Effect.void,
            stopping: false,
            ended: Deferred.makeUnsafe<void>(),
          }
          live.set(id, record)

          // A line is run and not interpreted: what it names is the program, and the rest are
          // its arguments, a quoted one staying one. A line that needs a shell — a pipeline, a
          // variable — is a line the user writes in a script and names here.
          const invocation = invocationOf(
            asked.line,
            globalThis.process.platform,
            hostLookup(asked.cwd),
          )
          if (invocation === null) {
            record.state = 'failed'
            record.kept = `Hemera has nothing to run: the line of ${asked.name} is empty`
            record.endedAt = startedAt
            yield* writeRow(id, record, 'command.failed')
            yield* Deferred.succeed(record.ended, undefined)
            live.delete(id)
            return viewOf(id, record)
          }

          const spawned = yield* owned(
            supervisor.start(invocation.command, invocation.args, {
              cwd: asked.cwd,
              graceMilliseconds: GRACE_MS,
              verbatim: invocation.verbatim,
            }),
          ).pipe(Effect.exit)

          if (Exit.isFailure(spawned)) {
            record.state = 'failed'
            record.kept = `the command could not be started: ${asked.line}`
            record.endedAt = new Date().toISOString()
            yield* writeRow(id, record, 'command.failed')
            yield* Deferred.succeed(record.ended, undefined)
            live.delete(id)
            return viewOf(id, record)
          }

          const process = spawned.value
          record.pid = process.pid ?? null
          record.stop = process.stop
          // One buffer for both streams, in the order the lines arrived: a tool that fails says
          // why on its standard error — `tsc`, `vitest`, `cargo` — and an output that kept only
          // the standard one would be an exit code with no reason under it (D6-12).
          const keep = (one: string) => {
            const text = one.endsWith('\n') ? one : `${one}\n`
            record.kept += text
            if (record.kept.length > OUTPUT_KEPT_BYTES) {
              const dropped = record.kept.length - OUTPUT_KEPT_BYTES
              record.dropped += dropped
              record.kept = record.kept.slice(dropped)
            }
            // The first address the run names is its address: a later one — a second server, a
            // proxy, a link in a log line — does not move the one the user already opened.
            if (record.url === null) record.url = addressIn(text)
          }
          process.onStdout(keep)
          process.onStderr(keep)

          // The death is watched in the engine's scope: a run is stopped by a quit as much as by
          // a `stop`, and either way the row is rewritten with how it ended — here and only here,
          // so a stop and an exit that race each other still make one end and one event.
          yield* watching(
            process.exited.pipe(
              Effect.flatMap((observation) =>
                Effect.gen(function* () {
                  record.state = record.stopping
                    ? 'stopped'
                    : observation.code === 0
                      ? 'exited'
                      : observation.signal === null
                        ? 'failed'
                        : 'stopped'
                  record.exitCode = observation.code
                  record.endedAt = observation.when
                  yield* Effect.sleep(DRAIN_MS)
                  yield* writeRow(
                    id,
                    record,
                    record.stopping ? 'command.stopped' : 'command.exited',
                  )
                  yield* Deferred.succeed(record.ended, undefined)
                  // What is left of a run that ended is its row: the memory, and the output it
                  // holds, is let go of rather than kept for as long as the engine runs.
                  live.delete(id)
                }),
              ),
            ),
          )

          // Asked to stop while it was starting: the stop found nothing to end, so it ends now.
          if (record.stopping) yield* process.stop
          yield* writeRow(id, record, 'command.started')
          return viewOf(id, record)
        }),

      output: (sessionId, runId) =>
        Effect.gen(function* () {
          const projectId = yield* projectOf(sessionId)
          const record = live.get(runId)
          if (record !== undefined && record.projectId === projectId) return viewOf(runId, record)
          // The process is gone: the row is what is left of the run, and a `check` that exited
          // an hour ago is read from it exactly as a run of this process is read from memory.
          const rows = yield* database
            .select({ run: commandRuns, projectId: sessions.projectId })
            .from(commandRuns)
            .innerJoin(sessions, eq(sessions.id, commandRuns.sessionId))
            .where(and(eq(commandRuns.id, runId), eq(sessions.projectId, projectId ?? '')))
            .pipe(Effect.mapError(failed('reading a run')))
          const row = rows[0]
          if (row === undefined) return yield* Effect.fail(new UnknownRunError(runId))
          return rowOf(row.run, row.projectId)
        }),

      stop: (sessionId, runId) =>
        Effect.gen(function* () {
          const projectId = yield* projectOf(sessionId)
          const record = live.get(runId)
          if (record === undefined || record.projectId !== projectId) {
            return yield* Effect.fail(new UnknownRunError(runId))
          }
          yield* stopRun(record)
          return viewOf(runId, record)
        }),

      running: (sessionId) =>
        Effect.sync(() =>
          [...live.entries()]
            .filter(([, one]) => one.sessionId === sessionId && one.state === 'running')
            .sort((left, right) => (left[1].startedAt < right[1].startedAt ? -1 : 1))
            .map(([id, one]) => viewOf(id, one)),
        ),

      recent: (sessionId) =>
        database
          .select({ run: commandRuns, projectId: sessions.projectId })
          .from(commandRuns)
          .innerJoin(sessions, eq(sessions.id, commandRuns.sessionId))
          .where(eq(commandRuns.sessionId, sessionId))
          .orderBy(desc(commandRuns.startedAt))
          .limit(RECENT_RUNS)
          .pipe(
            Effect.mapError(failed('reading the runs')),
            Effect.map((rows) => rows.map((row) => rowOf(row.run, row.projectId))),
          ),

      stopped: (sessionId) =>
        Effect.gen(function* () {
          for (const [id, record] of [...live.entries()]) {
            if (sessionId !== undefined && record.sessionId !== sessionId) continue
            yield* stopRun(record)
            live.delete(id)
          }
        }),

      awaited: (sessionId, runId, milliseconds) =>
        Effect.gen(function* () {
          const record = live.get(runId)
          // A run of this engine is waited on until its end is written, or until the time is up;
          // one that is not in memory has already ended, and its row is the answer.
          if (record !== undefined) {
            yield* Deferred.await(record.ended).pipe(
              Effect.timeoutOption(Duration.millis(milliseconds)),
            )
          }
          return yield* service.output(sessionId, runId)
        }),
    }
    return service
  }),
)
