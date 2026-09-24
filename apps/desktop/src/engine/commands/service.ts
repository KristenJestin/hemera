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
 * - a `serve` command that is already running is handed back, never started twice, which is what
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
 *
 * A run no Session asked for — a preparation's `run` step (Decided 11) — is a run like any other,
 * with its row, its output and its Journal lines, and no thread entry, because there is no thread:
 * it is read by its identifier, and no Session's panel lists it.
 *
 * A run belongs to a Workspace (D8-08) and runs the machine's own line of its command (D8-07): a
 * `serve` joins the one running in its Workspace, or the Project's one when its scope says so; the
 * address it publishes is requested until it answers, and its port is compared with the Project's
 * other runs, whose holder is named (D8-09); a Portless command runs through `portless` (D8-10).
 */

import {
  type Command,
  type CommandScope,
  type CommandType,
  addressIn,
  commandLine,
  commandName,
  commandScope,
  commandType,
  DuplicateCommandNameError,
  joinsRunningRun,
  lineFor,
  MAIN_WORKSPACE,
  mergedEnvironment,
  portOf,
  slugOf,
} from '@hemera/core'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Context, Deferred, Duration, Effect, Exit, Layer, Scope } from 'effect'
import { request as httpsRequest } from 'node:https'
import { z } from 'zod'

import { HeldWords } from '../agents/held.ts'
import { AgentNotices } from '../agents/notices.ts'
import { ProcessSupervisor, StderrSink } from '../agents/supervisor.ts'
import { Sessions } from '../sessions.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import {
  type RunState,
  commandRuns,
  projectCommands,
  sessions,
  workspaces,
} from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type Lookup, findOnPath, hostLookup, invocationOf } from './line.ts'

/** How many runs `recent` hands back: what a panel draws, oldest ones out of sight. */
const RECENT_RUNS = 8

/** How much of what a run printed is kept: what is older than this is dropped, and said to be. */
export const OUTPUT_KEPT_BYTES = 64 * 1024

/**
 * How long the pipes of a run that ended are still read before its end is written: a process's
 * exit can be reported before the last of what it printed has been read.
 */
const DRAIN_MS = 100

/**
 * How often a run that is printing is pushed to the window (D6-12): often enough for a panel to
 * read as live, and not once per line of a build that prints thousands of them.
 */
const PUSH_EVERY_MS = 200

/** How long a run has to die quietly before its tree is taken down. */
const GRACE_MS = 5_000

/** How often a published address is requested until it answers (D8-09). */
export const READINESS_EVERY_MS = 500

/** How long a published address is requested before it is said not to answer (D8-09). */
export const READINESS_FOR_MS = 60_000

/** How long one request of an address is waited for: well under the interval between two. */
const PROBE_TIMEOUT_MS = 400

/**
 * How often and for how long a published address is requested (D8-09): the two constants by
 * default, and a shorter minute for a suite that has no minute to wait.
 */
export const ReadinessSettings = Context.Reference<{
  readonly everyMs: number
  readonly forMs: number
}>('ReadinessSettings', {
  defaultValue: () => ({ everyMs: READINESS_EVERY_MS, forMs: READINESS_FOR_MS }),
})

/**
 * Whether an address answers, whatever its status (D8-09): a refused connection, a name that does
 * not resolve and a request that outlasts `PROBE_TIMEOUT_MS` are no answer. A redirect is an
 * answer, not followed.
 *
 * The address is requested as printed. An `https` one — what Portless prints, its proxy serving
 * a certificate of its own authority (D8-10) — is requested without checking that certificate:
 * the question is whether this machine's own server answers, not whether it is to be trusted.
 */
export const addressAnswers = (address: string) =>
  Effect.tryPromise(async () => {
    if (!address.startsWith('https:')) {
      const response = await fetch(address, {
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await response.body?.cancel()
      return
    }
    await new Promise<void>((resolve, reject) => {
      const asked = httpsRequest(
        address,
        { method: 'GET', rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
        (response) => {
          response.resume()
          resolve()
        },
      )
      asked.on('timeout', () => asked.destroy(new Error('no answer in time')))
      asked.on('error', reject)
      asked.end()
    })
  }).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

/** What a process says when the port it listens on is taken (D8-09): Node's code, and the text. */
const IN_USE = /EADDRINUSE|address already in use/i

/** The port the line saying so names, as `:3000` or `:::3000`, and null when it names none. */
function portInUse(output: string): number | null {
  const found = IN_USE.exec(output)
  if (found === null) return null
  const start = output.lastIndexOf('\n', found.index) + 1
  const end = output.indexOf('\n', found.index)
  const port = /:(\d{2,5})\b/.exec(output.slice(start, end === -1 ? undefined : end))
  return port === null ? null : Number(port[1])
}

/**
 * The system this machine is, in Node's own word — `win32`, `linux`, `darwin` — which decides the
 * line a command runs (D8-07). The engine's own by default; a suite hands another one to see the
 * variant a Windows machine would run without being one.
 */
export const Platform = Context.Reference<string>('CommandsPlatform', {
  defaultValue: () => globalThis.process.platform,
})

/**
 * Where a program is looked for, for a line run in a folder: this process's `PATH` by default,
 * and another one for a suite that needs a machine without `portless` (D8-10).
 */
export const ProgramLookup = Context.Reference<(cwd: string) => Lookup>('CommandsProgramLookup', {
  defaultValue: () => hostLookup,
})

/** A run was asked for by an identifier nothing of this Project answers to. */
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

/**
 * The run holding the port another run published (D8-09): which run, in which Workspace, under
 * which name — what a conflict is shown with, on both runs.
 */
export interface PortConflict {
  port: number
  runId: string
  workspaceId: string | null
  workspaceName: string
  name: string
}

/** One run of a command, as a panel and as a tool read it. */
export interface Run {
  readonly id: string
  readonly projectId: string
  /** The Session that asked for it, and null for a preparation's step (Decided 11). */
  readonly sessionId: string | null
  /** The catalogue entry it is, and null for a one-off command line. */
  readonly commandId: string | null
  readonly name: string
  /** The line it ran: the machine's own variant when the command has one (D8-07). */
  readonly line: string
  readonly type: CommandType
  /** Once per Workspace or once for the Project: what a second `serve` run joins (D8-07). */
  readonly scope: CommandScope
  readonly cwd: string
  /** The command's folder relative to the Workspace root, and null for the root itself. */
  readonly folder: string | null
  /** The Workspace it runs in; null on a run written before Workspaces, read as `main` (D8-08). */
  readonly workspaceId: string | null
  /** What that Workspace is called: what a conflict names (D8-09). */
  readonly workspaceName: string
  /** The variables it was given over the process's environment (D8-06). */
  readonly environment: Record<string, string>
  readonly state: RunState
  readonly pid: number | null
  /** The address it published, and null while it has published none. */
  readonly url: string | null
  /** When its address first answered, and null until it has (D8-09). */
  readonly readyAt: string | null
  /** Where its address stands, derived from the above (D8-09). */
  readonly readiness: Readiness
  /** The run holding the port it published, and null when none does (D8-09). */
  readonly portConflict: PortConflict | null
  /**
   * The runs that published the port this one holds, each named as a conflict is: the holder's
   * side, derived when the Workspace's services are read and stored nowhere (D8-09, Decided 12);
   * empty on any other read.
   */
  readonly heldAgainst: PortConflict[]
  readonly exitCode: number | null
  /**
   * Who asked for it: the agent through its tool, or the user through a panel or a preparation.
   * A Workspace's services list runs whoever started them, and say which (D8-08).
   */
  readonly startedBy: 'agent' | 'user'
  /** The end of what it printed, bounded: what fits in `OUTPUT_KEPT_BYTES`. */
  readonly output: string
  /** How many bytes of the beginning were dropped, and 0 when nothing was. */
  readonly dropped: number
  readonly startedAt: string
  readonly endedAt: string | null
}

/**
 * Where the address of a `serve` run stands (D8-09): `starting` until it answers, `ready` once
 * it has, `unanswered` after a minute without an answer or when the run ended without one; null
 * for a run with no address, and for any run that is not a `serve`, which is never requested.
 */
export type Readiness = 'starting' | 'ready' | 'unanswered' | null

/** The readiness of a run, derived from what it holds. */
function readinessOf(
  run: Pick<Run, 'type' | 'url' | 'readyAt' | 'state'>,
  unanswered: boolean,
): Readiness {
  if (run.type !== 'serve' || run.url === null) return null
  if (run.readyAt !== null) return 'ready'
  return unanswered || run.state !== 'running' ? 'unanswered' : 'starting'
}

/** The same, and whether this is a run that was already going. */
export interface RunView extends Run {
  readonly joined: boolean
}

/**
 * What the caller hands over to start or join a run.
 *
 * The caller resolves where it runs: `cwd` is the command's folder under the Workspace the run
 * is in — under `main` for a Project-scoped command, whichever Workspace asked (D8-07). The
 * service checks nothing about that path; it runs there.
 */
export interface RunRequest {
  /** The Session asking, and null for a preparation's step, which has none (Decided 11). */
  readonly sessionId: string | null
  readonly projectId: string
  readonly commandId: string | null
  readonly name: string
  /** The default line: what runs on a machine the command has no line of its own for (D8-07). */
  readonly line: string
  readonly lineWindows: string | null
  readonly lineLinux: string | null
  readonly type: CommandType
  /** What a second `serve` run joins; `workspace` for a one-off (D8-07). */
  readonly scope: CommandScope
  readonly portless: boolean
  /** The command's folder relative to the Workspace root, and null for the root itself. */
  readonly folder: string | null
  /** Where it runs: the Workspace root, or one of the Project's repositories under it. */
  readonly cwd: string
  /** The Workspace it runs in, and null for `main` (D8-08). */
  readonly workspaceId: string | null
  /** What that Workspace is called, `main` when the caller does not know (D8-09). */
  readonly workspaceName: string
  /** The variables it is given over the process's environment, the Workspace's last (D8-06). */
  readonly environment: Record<string, string>
  readonly startedBy: 'agent' | 'user'
}

/** What a catalogue entry is written from. */
export interface CommandEdit {
  readonly projectId: string
  readonly name: string
  readonly line: string
  readonly lineWindows: string | null
  readonly lineLinux: string | null
  readonly type: string
  /** The repository it runs in, relative to the root, and null for the root itself. */
  readonly folder: string | null
  readonly scope: string
  readonly portless: boolean
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
   * A run that is over is read from its row, where a `test` that exited kept its output and its
   * exit code: the question is about the run, not about the process. A Session reads any run of
   * its Project; null is Hemera's own preparation asking, by the run's identifier alone
   * (Decided 11).
   */
  readonly output: (
    sessionId: string | null,
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
   * What a Workspace has running, oldest first, whoever started it (D8-08): its services, and
   * what keeps it from being cleaned up. Null is `main`.
   */
  readonly runningIn: (workspaceId: string | null, projectId: string) => Effect.Effect<RunView[]>
  /** What the Project has running, in every Workspace, oldest first. */
  readonly runningOf: (projectId: string) => Effect.Effect<RunView[]>
  /**
   * The services of a Workspace, oldest first: its running `serve` runs, whoever started them
   * (D8-08), each with the runs of the Project whose conflict names it as the holder
   * (D8-09, Decided 12). Null is `main`, matched as `runningIn` matches it.
   */
  readonly services: (projectId: string, workspaceId: string | null) => Effect.Effect<RunView[]>
  /**
   * The last runs of a Session, newest first, ended ones included.
   *
   * The panel draws them, and `commands_output` answers from them when the agent reads the run
   * it just started: a `test` or a `script` ends on its own, and its exit code and its output
   * are what the agent came for.
   */
  readonly recent: (sessionId: string) => Effect.Effect<RunView[], DatabaseError>
  /**
   * Waits up to `milliseconds` for a run to end, and answers it as it then stands: ended, with
   * its exit code and all it printed, or still running.
   */
  readonly awaited: (
    sessionId: string | null,
    runId: string,
    milliseconds: number,
  ) => Effect.Effect<RunView, UnknownRunError | DatabaseError>
  /** Stops everything of a Session, or everything at all when no Session is named. */
  readonly stopped: (sessionId?: string | undefined) => Effect.Effect<void, DatabaseError>
}

export class Commands extends Context.Service<Commands, CommandsService>()('Commands') {}

/** The variables a run was given, read back from the JSON its row keeps them as (D8-06). */
const variablesSchema = z.record(z.string(), z.string())

/** The conflict a run's row keeps as JSON (D8-09). */
const conflictSchema = z.object({
  port: z.number(),
  runId: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string(),
  name: z.string(),
})

/** The variables of a row: what this service wrote, and nothing when it no longer reads. */
function variablesOf(text: string): Record<string, string> {
  const read = variablesSchema.safeParse(JSON.parse(text))
  return read.success ? read.data : {}
}

/** The conflict of a row: what this service wrote, and none when it no longer reads. */
function conflictOf(text: string): PortConflict | null {
  const read = conflictSchema.safeParse(JSON.parse(text))
  return read.success ? read.data : null
}

/**
 * Whether a run is in `main`: the Workspace a run written before Workspaces is read as (D8-08),
 * whether the caller named `main` by its row or by null.
 */
const inMain = (one: { workspaceId: string | null; workspaceName: string }) =>
  one.workspaceId === null || one.workspaceName === MAIN_WORKSPACE

/**
 * Whether a run is in the Workspace named: `main` by null, whose runs are read as `inMain`
 * reads them, and any other by its row.
 */
const inWorkspace =
  (workspaceId: string | null) => (one: { workspaceId: string | null; workspaceName: string }) =>
    workspaceId === null ? inMain(one) : one.workspaceId === workspaceId

/** Whether two runs are in the same Workspace. */
const sameWorkspace = (
  left: { workspaceId: string | null; workspaceName: string },
  right: { workspaceId: string | null; workspaceName: string },
) => (inMain(left) && inMain(right)) || left.workspaceId === right.workspaceId

/** One live run: what it is, what it has printed, and how to end it. */
interface Live {
  readonly sessionId: string | null
  readonly projectId: string
  readonly commandId: string | null
  readonly name: string
  readonly line: string
  readonly type: CommandType
  readonly scope: CommandScope
  readonly cwd: string
  readonly folder: string | null
  readonly workspaceId: string | null
  readonly workspaceName: string
  readonly environment: Record<string, string>
  /** Whether it runs through Portless, whose address holds no port of its own (D8-10). */
  readonly portless: boolean
  /** Who asked for it: the agent through its tool, or the user through the panel. */
  readonly startedBy: 'agent' | 'user'
  readonly startedAt: string
  state: RunState
  pid: number | null
  url: string | null
  readyAt: string | null
  portConflict: PortConflict | null
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
  /** Whether a push of what it printed is already due, so a burst of lines is one push. */
  pushing: boolean
  /** Whether its address was requested for a minute without an answer (D8-09). */
  unanswered: boolean
  /**
   * Completed with the address it publishes, or with null once it has ended without one: what
   * the conflict and the readiness of a `serve` run wait for (D8-09).
   */
  readonly published: Deferred.Deferred<string | null>
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
    const held = yield* HeldWords
    // The window watching the Session: the entry a run writes and the run itself are pushed to
    // it as they change, so the thread and the Commands panel are drawn from what arrives.
    const notices = yield* AgentNotices
    /** The engine's diagnostic log: where a run whose end could not be recorded is told. */
    const diagnostic = yield* StderrSink
    /** The engine's own scope: everything started here dies when the engine does. */
    const scope = yield* Effect.scope
    const platform = yield* Platform
    const readiness = yield* ReadinessSettings
    const lookupIn = yield* ProgramLookup
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
      type: one.type,
      scope: one.scope,
      cwd: one.cwd,
      folder: one.folder,
      workspaceId: one.workspaceId,
      workspaceName: one.workspaceName,
      environment: one.environment,
      state: one.state,
      pid: one.pid,
      url: one.url,
      readyAt: one.readyAt,
      readiness: readinessOf(one, one.unanswered),
      portConflict: one.portConflict,
      heldAgainst: [],
      exitCode: one.exitCode,
      startedBy: one.startedBy,
      output: one.kept,
      dropped: one.dropped,
      startedAt: one.startedAt,
      endedAt: one.endedAt,
      joined,
    })

    /**
     * The Project of a run's row, which the row does not hold itself: its Session's, or for a run
     * with none — a preparation's step, always in a dedicated Workspace — its Workspace's
     * (Decided 11). Neither a Project, a Session nor a Workspace row is ever deleted under a run.
     */
    const runProject = sql<string>`coalesce(${sessions.projectId}, ${workspaces.projectId})`

    /**
     * The rows of runs, with what a row does not hold itself: the Project; and the Workspace's
     * name, `main` for a row without one (D8-08).
     */
    const runRows = () =>
      database
        .select({
          run: commandRuns,
          projectId: runProject,
          workspaceName: workspaces.name,
        })
        .from(commandRuns)
        .leftJoin(sessions, eq(sessions.id, commandRuns.sessionId))
        .leftJoin(workspaces, eq(workspaces.id, commandRuns.workspaceId))

    /**
     * A run read from its row rather than from memory: what a process that is gone left behind.
     *
     * `outputBytes` is what the run printed altogether and `output` is what was kept of it, so
     * what was dropped is what the two differ by — the number the panel says out loud.
     */
    const rowOf = ({
      run: row,
      projectId,
      workspaceName,
    }: {
      run: typeof commandRuns.$inferSelect
      projectId: string
      workspaceName: string | null
    }): RunView => ({
      id: row.id,
      projectId,
      sessionId: row.sessionId,
      commandId: row.commandId,
      name: row.name,
      line: row.line,
      type: commandType(row.type),
      // The folder and the scope the run was started with, from its own row: the catalogue entry
      // may have changed or gone since, and a one-off has none (D8-07).
      scope: commandScope(row.scope),
      cwd: row.cwd,
      folder: row.folder,
      workspaceId: row.workspaceId,
      workspaceName: workspaceName ?? MAIN_WORKSPACE,
      environment: variablesOf(row.environment),
      state: runStateOf(row.state),
      pid: row.pid,
      url: row.url,
      readyAt: row.readyAt,
      readiness: readinessOf(
        {
          type: commandType(row.type),
          url: row.url,
          readyAt: row.readyAt,
          state: runStateOf(row.state),
        },
        false,
      ),
      portConflict: row.portConflict === null ? null : conflictOf(row.portConflict),
      heldAgainst: [],
      exitCode: row.exitCode,
      // The table's check closed it to these two.
      startedBy: row.startedBy === 'agent' ? 'agent' : 'user',
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
     *
     * What the agent said before the run started is written first: the runtime holds a message's
     * words until its timer writes them (Decided 10 of #17), and a run is below them in the thread.
     *
     * A run with no Session has no thread, and writes nothing here (Decided 11).
     */
    const writeEntry = (id: string, one: Live, sessionId: string) =>
      held
        .flushed(sessionId)
        .pipe(
          Effect.andThen(() =>
            thread.write(sessionId, {
              role: 'hemera',
              kind: 'command_run',
              body: one.name,
              payload: JSON.stringify({
                runId: id,
                name: one.name,
                line: one.line,
                type: one.type,
                state: one.state,
                cwd: one.cwd,
                folder: one.folder,
                workspaceId: one.workspaceId,
                workspaceName: one.workspaceName,
                // What `RunDetails` shows: the variables given, readiness and a conflict (D8-06,
                // D8-09).
                environment: one.environment,
                url: one.url,
                readyAt: one.readyAt,
                portConflict: one.portConflict,
                exitCode: one.exitCode,
                startedBy: one.startedBy,
                // A one-off is a line the agent wrote rather than a command of the catalogue, and
                // the block says so: what is not in the catalogue cannot be run again by name.
                oneOff: one.commandId === null,
              }),
              correlationId: `run:${id}`,
              turnId: null,
              state: one.state,
            }),
          ),
          Effect.tap((written) => Effect.sync(() => notices.wrote(sessionId, written.entry))),
        )
        .pipe(Effect.catch(() => Effect.void))

    /**
     * The row of a run and its entry in the thread, written as it starts, as it changes and when
     * it ends, with the Journal line `type` names — none for a change D8-16 does not name.
     */
    const writeRow = (id: string, one: Live, type: string | null) =>
      withDatabase(
        mutate('recording a run', (transaction) =>
          Effect.gen(function* () {
            const row = {
              id,
              sessionId: one.sessionId,
              commandId: one.commandId,
              name: one.name,
              line: one.line,
              type: one.type,
              cwd: one.cwd,
              folder: one.folder,
              scope: one.scope,
              workspaceId: one.workspaceId,
              environment: JSON.stringify(one.environment),
              state: one.state,
              pid: one.pid,
              url: one.url,
              readyAt: one.readyAt,
              portConflict: one.portConflict === null ? null : JSON.stringify(one.portConflict),
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
              // The run is the entity of its lines (D8-16): started, ready, ended.
              events:
                type === null
                  ? []
                  : [
                      {
                        type,
                        entityKind: 'command' as const,
                        entityId: id,
                        // Who asked is who the Journal names: a run the user started from the
                        // panel is the user's, and one the agent asked for is the tool's.
                        source: one.startedBy === 'user' ? ('ui' as const) : ('system' as const),
                        author: one.startedBy === 'user' ? ('human' as const) : ('mcp' as const),
                        projectId: one.projectId,
                        sessionId: one.sessionId,
                        payload: {
                          name: one.name,
                          state: one.state,
                          exitCode: one.exitCode,
                          url: one.url,
                          workspaceName: one.workspaceName,
                        },
                      },
                    ],
            }
          }),
        ),
      ).pipe(
        Effect.tap(() =>
          one.sessionId === null ? Effect.void : writeEntry(id, one, one.sessionId),
        ),
        Effect.tap(() => Effect.sync(() => notices.ran(one.sessionId, viewOf(id, one)))),
      )

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

    /**
     * The run of the Project, other than `id`, that holds `port` (D8-09): one still running that
     * published an address on it, the first to have been started; null when none does.
     */
    const holderOf = (id: string, projectId: string, port: number): PortConflict | null => {
      const found = [...live.entries()].find(
        ([other, one]) =>
          other !== id &&
          one.projectId === projectId &&
          one.state === 'running' &&
          !one.portless &&
          one.url !== null &&
          portOf(one.url) === port,
      )
      if (found === undefined) return null
      const [runId, holder] = found
      return {
        port,
        runId,
        workspaceId: holder.workspaceId,
        workspaceName: holder.workspaceName,
        name: holder.name,
      }
    }

    /**
     * What a `serve` run's published address sets going (D8-09): the conflict with the run of the
     * Project holding its port, written on the run at once; then the address requested every
     * interval until it answers — `ready_at` written, and `command.run_ready` — or until the
     * minute is up, which leaves it `unanswered`. Hemera assigns no port; it names who holds one.
     * The requests stop when the run ends.
     */
    const checkAddress = (id: string, record: Live, url: string) =>
      Effect.gen(function* () {
        // A Portless address is the proxy's: no port of the run's own to conflict (D8-10).
        const port = record.portless ? null : portOf(url)
        const conflict = port === null ? null : holderOf(id, record.projectId, port)
        if (conflict !== null) {
          record.portConflict = conflict
          yield* writeRow(id, record, null)
        }
        const deadline = Date.now() + readiness.forMs
        while (record.state === 'running') {
          const answered = yield* addressAnswers(url)
          if (record.state !== 'running') return
          if (answered) {
            record.readyAt = new Date().toISOString()
            return yield* writeRow(id, record, 'command.run_ready')
          }
          if (Date.now() >= deadline) {
            record.unanswered = true
            notices.ran(record.sessionId, viewOf(id, record))
            return
          }
          yield* Effect.sleep(readiness.everyMs)
        }
      })

    /** The runs of this engine still going that `kept` keeps, oldest first. */
    const runningWhere = (kept: (one: Live) => boolean) =>
      Effect.sync(() =>
        [...live.entries()]
          .filter(([, one]) => one.state === 'running' && kept(one))
          .sort((left, right) => (left[1].startedAt < right[1].startedAt ? -1 : 1))
          .map(([id, one]) => viewOf(id, one)),
      )

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
                    lineWindows: row.lineWindows,
                    lineLinux: row.lineLinux,
                    type: commandType(row.type),
                    folder: row.folder === '' ? null : row.folder,
                    scope: commandScope(row.scope),
                    portless: row.portless === 1,
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
              const type = commandType(edit.type)
              const runsIn = commandScope(edit.scope)
              const lines = { lineWindows: edit.lineWindows, lineLinux: edit.lineLinux }
              const portless = edit.portless ? 1 : 0
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
                    ...lines,
                    type,
                    folder,
                    scope: runsIn,
                    portless,
                    createdAt,
                    updatedAt: at,
                  })
                  .pipe(Effect.mapError(failed('writing the commands')))
              } else {
                yield* transaction
                  .update(projectCommands)
                  .set({ line, ...lines, type, folder, scope: runsIn, portless, updatedAt: at })
                  .where(eq(projectCommands.id, id))
                  .pipe(Effect.mapError(failed('writing the commands')))
              }
              return {
                result: {
                  id,
                  projectId: edit.projectId,
                  name,
                  line,
                  ...lines,
                  type,
                  folder: edit.folder,
                  scope: runsIn,
                  portless: edit.portless,
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
                    payload: { name, type },
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
          // A server is shared, not the Session's (D6-12): a second Session that asks for the
          // one already running is handed that one, and can read and stop it like its own. Which
          // one is the scope's (D8-07): the one of the same Workspace, or the Project's one.
          const already = [...live.entries()].find(
            ([, one]) =>
              one.projectId === asked.projectId &&
              one.name === asked.name &&
              one.state === 'running' &&
              (asked.scope === 'project' || sameWorkspace(one, asked)),
          )
          if (
            already !== undefined &&
            joinsRunningRun(asked.type, already[1].state === 'running')
          ) {
            return viewOf(already[0], already[1], true)
          }

          const id = crypto.randomUUID()
          const startedAt = new Date().toISOString()
          // The machine's own line when the command has one, and the run keeps the line it ran.
          const own = lineFor(asked, platform)
          const lookup = lookupIn(asked.cwd)
          // A Portless command runs as `portless <name> <line>`, the name being its Workspace's
          // and its own, and `portless` is looked for before anything starts (D8-10).
          const named = slugOf(`${asked.workspaceName}-${asked.name}`)
          const portless = asked.portless ? findOnPath('portless', lookup, platform) : null
          const line = asked.portless ? `portless ${named} ${own}` : own
          const record: Live = {
            sessionId: asked.sessionId,
            projectId: asked.projectId,
            commandId: asked.commandId,
            name: asked.name,
            line,
            type: asked.type,
            scope: asked.scope,
            cwd: asked.cwd,
            folder: asked.folder,
            workspaceId: asked.workspaceId,
            workspaceName: asked.workspaceName,
            environment: asked.environment,
            portless: asked.portless,
            startedBy: asked.startedBy,
            startedAt,
            state: 'running',
            pid: null,
            url: null,
            readyAt: null,
            portConflict: null,
            exitCode: null,
            kept: '',
            dropped: 0,
            endedAt: null,
            stop: Effect.void,
            stopping: false,
            ended: Deferred.makeUnsafe<void>(),
            pushing: false,
            unanswered: false,
            published: Deferred.makeUnsafe<string | null>(),
          }
          live.set(id, record)

          // Refused by name, and nothing started: the box says Portless, and there is none.
          if (asked.portless && portless === null) {
            record.state = 'failed'
            record.kept = 'portless was not found on the PATH: nothing was started'
            record.endedAt = startedAt
            yield* writeRow(id, record, 'command.run_ended')
            yield* Deferred.succeed(record.ended, undefined)
            live.delete(id)
            return viewOf(id, record)
          }

          // A line is run and not interpreted: what it names is the program, and the rest are
          // its arguments, a quoted one staying one. A line that needs a shell — a pipeline, a
          // variable — is a line the user writes in a script and names here. Portless is started
          // where it was found, so what runs is what was checked.
          const invocation = invocationOf(
            portless === null ? own : `"${portless}" ${named} ${own}`,
            platform,
            lookup,
          )
          if (invocation === null) {
            record.state = 'failed'
            record.kept = `Hemera has nothing to run: the line of ${asked.name} is empty`
            record.endedAt = startedAt
            yield* writeRow(id, record, 'command.run_ended')
            yield* Deferred.succeed(record.ended, undefined)
            live.delete(id)
            return viewOf(id, record)
          }

          const options: Parameters<typeof supervisor.start>[2] = {
            cwd: asked.cwd,
            graceMilliseconds: GRACE_MS,
            verbatim: invocation.verbatim,
            // What a run prints on its standard error is its output, kept with it (D6-12).
            logsStderr: false,
          }
          const spawned = yield* owned(
            supervisor.start(
              invocation.command,
              invocation.args,
              // The supervisor's `env` replaces the whole environment, so the variables a run is
              // given go over the process's own (D8-06) — and a run given none gets no `env`,
              // inheriting the engine's as it always did.
              Object.keys(asked.environment).length === 0
                ? options
                : {
                    ...options,
                    env: mergedEnvironment(globalThis.process.env, asked.environment, {}),
                  },
            ),
          ).pipe(Effect.exit)

          if (Exit.isFailure(spawned)) {
            record.state = 'failed'
            record.kept = `the command could not be started: ${line}`
            record.endedAt = new Date().toISOString()
            yield* writeRow(id, record, 'command.run_ended')
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
            if (record.url === null) {
              record.url = addressIn(text)
              if (record.url !== null) {
                Deferred.doneUnsafe(record.published, Effect.succeed(record.url))
              }
            }
            // What it printed reaches the panel as it prints, a burst of lines at a time: the
            // same run the thread and the agent read, pushed whole (D6-12).
            if (record.pushing) return
            record.pushing = true
            setTimeout(() => {
              record.pushing = false
              notices.ran(record.sessionId, viewOf(id, record))
            }, PUSH_EVERY_MS)
          }
          process.onStdout(keep)
          process.onStderr(keep)

          // A `serve` run's address is checked once it is published, in the engine's scope; a run
          // of another type is never requested (D8-09).
          if (asked.type === 'serve') {
            yield* watching(
              Deferred.await(record.published).pipe(
                Effect.flatMap((url) =>
                  url === null ? Effect.void : checkAddress(id, record, url),
                ),
                Effect.catch((cause) =>
                  diagnostic.write(
                    `commands: the address of run ${id} (${record.name}) was not recorded: ${cause.message}`,
                  ),
                ),
              ),
            )
          }

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
                  // A server whose port was taken failed whatever its exit code, and names the
                  // holder when the output names the port (D8-09). Only a `serve` is read so: a
                  // test may well print the words and pass.
                  if (record.type === 'serve' && !record.stopping && IN_USE.test(record.kept)) {
                    record.state = 'failed'
                    const port = record.portless ? null : portInUse(record.kept)
                    const conflict = port === null ? null : holderOf(id, record.projectId, port)
                    if (conflict !== null) record.portConflict = conflict
                  }
                  yield* writeRow(id, record, 'command.run_ended').pipe(
                    // A row that cannot be written — the database locked, the disk full — is a
                    // run whose end is not recorded, and said so; it has ended all the same.
                    Effect.catch((cause) =>
                      diagnostic.write(
                        `commands: the end of run ${id} (${record.name}) was not recorded: ${cause.message}`,
                      ),
                    ),
                    // Whatever happened to the row, the run has ended: what waits on its end — a
                    // stop, a Session let go of — is released, or it would wait for ever.
                    Effect.ensuring(
                      Effect.gen(function* () {
                        // An address it never published is no longer awaited.
                        yield* Deferred.succeed(record.published, null)
                        yield* Deferred.succeed(record.ended, undefined)
                        // What is left of a run that ended is its row: the memory, and the output
                        // it holds, is let go of rather than kept for as long as the engine runs.
                        live.delete(id)
                      }),
                    ),
                  )
                }),
              ),
            ),
          )

          // Asked to stop while it was starting: the stop found nothing to end, so it ends now.
          if (record.stopping) yield* process.stop
          yield* writeRow(id, record, 'command.run_started')
          return viewOf(id, record)
        }),

      output: (sessionId, runId) =>
        Effect.gen(function* () {
          const projectId = sessionId === null ? null : yield* projectOf(sessionId)
          const record = live.get(runId)
          if (record !== undefined && (sessionId === null || record.projectId === projectId)) {
            return viewOf(runId, record)
          }
          // The process is gone: the row is what is left of the run, and a `test` that exited
          // an hour ago is read from it exactly as a run of this process is read from memory.
          const rows = yield* runRows()
            .where(
              sessionId === null
                ? eq(commandRuns.id, runId)
                : and(eq(commandRuns.id, runId), eq(runProject, projectId ?? '')),
            )
            .pipe(Effect.mapError(failed('reading a run')))
          const row = rows[0]
          if (row === undefined) return yield* Effect.fail(new UnknownRunError(runId))
          return rowOf(row)
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

      running: (sessionId) => runningWhere((one) => one.sessionId === sessionId),

      runningIn: (workspaceId, projectId) =>
        runningWhere((one) => one.projectId === projectId && inWorkspace(workspaceId)(one)),

      runningOf: (projectId) => runningWhere((one) => one.projectId === projectId),

      services: (projectId, workspaceId) =>
        runningWhere((one) => one.projectId === projectId).pipe(
          Effect.map((running) =>
            running
              .filter((run) => run.type === 'serve' && inWorkspace(workspaceId)(run))
              // The conflict is written on the run that published second; the holder's side is
              // read off those runs, never stored (Decided 12). Each view was made for this read.
              .map((run) =>
                Object.assign(run, {
                  heldAgainst: running.flatMap((other) =>
                    other.portConflict?.runId === run.id
                      ? [
                          {
                            port: other.portConflict.port,
                            runId: other.id,
                            workspaceId: other.workspaceId,
                            workspaceName: other.workspaceName,
                            name: other.name,
                          },
                        ]
                      : [],
                  ),
                }),
              ),
          ),
        ),

      recent: (sessionId) =>
        runRows()
          .where(eq(commandRuns.sessionId, sessionId))
          .orderBy(desc(commandRuns.startedAt))
          .limit(RECENT_RUNS)
          .pipe(
            Effect.mapError(failed('reading the runs')),
            Effect.map((rows) => rows.map(rowOf)),
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

    // A quit takes every run down with the engine's scope — the supervisor stops each tree as
    // it closes — and the watchers that write how a run ended go with that scope too. Added
    // before any run was started, this runs after all of them, once the processes are gone, and
    // writes each run still going as stopped: the panel of the next start must not show a
    // process that died with the last one as running (D6-12).
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const endedAt = new Date().toISOString()
        for (const [id, record] of [...live.entries()]) {
          if (record.state !== 'running') continue
          record.state = 'stopped'
          record.endedAt = endedAt
          yield* writeRow(id, record, 'command.run_ended').pipe(Effect.ignore)
        }
        live.clear()
      }),
    )
    return service
  }),
)
