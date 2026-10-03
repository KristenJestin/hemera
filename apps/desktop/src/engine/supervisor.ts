/**
 * The processes Hemera starts, and how it makes sure none of them outlives the engine.
 *
 * A program Hemera runs starts others: a dev server forks workers, a test runner starts a browser,
 * `pnpm` starts `node`. Stopping the one Hemera knows about and leaving the rest would be a Stop
 * that lies, so the supervisor ends trees, never names: it never looks for a process by its name.
 *
 * On POSIX every child is started in a process group of its own and every signal goes to the
 * group: `SIGTERM`, then `SIGKILL` once the grace has passed. Windows has no group to signal: the
 * child's standard input is closed, the grace is given, then `taskkill /PID <pid> /T /F` ends the
 * tree. Every child is tied to the scope it was started in, the engine's at the widest, so a quit
 * or a restart of the engine ends every child it started.
 *
 * A crash ends nothing, so the roots are also written to a durable registry while they run (their
 * pid, their program and arguments, what owns them, and the engine that started them). At the next
 * start, a root a previous engine left is ended as a tree if it is still alive and still the same
 * program; a pid now held by another program is not ours and is never touched.
 *
 * A child can also be started elsewhere and handed over by its pid (main forks the agents'
 * processes for the engine): the same policy applies to it. What a child writes on its standard
 * error goes to the diagnostic log and to whoever listens, and is never swallowed.
 */

import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Readable } from 'node:stream'

import { and, eq, ne } from 'drizzle-orm'
import { Context, Deferred, Duration, Effect, Layer, Option, Ref, Schema } from 'effect'
import type { Scope } from 'effect'

import { Database, refusedWhile } from './storage/database.ts'
import { supervisedProcesses } from './storage/schema.ts'

/** A program that could not be started at all, and why. */
export class SpawnFailed extends Schema.TaggedError<SpawnFailed>()('SpawnFailed', {
  program: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `${this.program} could not be started: ${this.reason}`
  }
}

/** How a supervised process ended. */
export interface ExitObservation {
  /** The exit code, or null when a signal ended it. */
  readonly code: number | null
  /** The signal that ended it, or null when it exited by itself. */
  readonly signal: string | null
  /** When the end was seen, as an ISO date. */
  readonly when: string
}

/** What owns a supervised root: a run of a command, or (later) an agent's session. */
export interface ProcessOwner {
  readonly kind: 'run' | 'session'
  readonly id: string
}

/** One running process, as its owner needs it. */
export interface Supervised {
  readonly pid: number
  /** Its end, seen once and answered the same to every reader. */
  readonly exited: Effect.Effect<ExitObservation>
  /** Writes one line to its standard input; a child already gone is not a failure. */
  readonly write: (line: string) => Effect.Effect<void>
  readonly closeInput: Effect.Effect<void>
  /** Ends it and its tree: the input closed, the grace given, then the tree taken down. */
  readonly stop: Effect.Effect<void>
  /** Ends the tree now, with no grace. */
  readonly kill: Effect.Effect<void>
  /** Each line it writes on its standard output, as it arrives. */
  readonly onStdout: (read: (line: string) => void) => void
  /** Each line it writes on its standard error, as it arrives (the diagnostic has them too). */
  readonly onStderr: (read: (line: string) => void) => void
}

/** What a process can be told. */
export type Signal = 'SIGTERM' | 'SIGKILL'

/** How the host is asked to start a child. */
export interface HostProcessOptions {
  /** Its own process group, on POSIX. */
  readonly detached: boolean
  readonly cwd: string | undefined
  readonly env: Readonly<Record<string, string>> | undefined
  /** The arguments reach Windows as they are: a `cmd.exe /s /c` line is quoted already. */
  readonly verbatim: boolean
}

/**
 * A started child, in the few words the supervisor says to it. The listeners are attached in the
 * same synchronous step as the start: a program that cannot run says so on the next tick.
 */
export interface HostProcess {
  readonly pid: number | undefined
  readonly write: (text: string) => boolean
  readonly end: () => void
  /** Signals the process, or its group when it was started in one. */
  readonly signal: (signal: Signal) => void
  readonly onSpawn: (spawned: () => void) => void
  readonly onExit: (ended: (code: number | null, signal: string | null) => void) => void
  readonly onFailure: (failed: (reason: string) => void) => void
  readonly onStdout: (read: (line: string) => void) => void
  readonly onStderr: (read: (line: string) => void) => void
}

/** The machine: starting a child, ending a tree, and asking about a pid. */
export interface HostProcessesService {
  readonly platform: NodeJS.Platform
  readonly start: (
    program: string,
    args: ReadonlyArray<string>,
    options: HostProcessOptions,
  ) => HostProcess
  /**
   * Ends a whole tree by its root's pid: its group on POSIX when it leads one, `taskkill /T /F` on
   * Windows. A tree already gone is not a failure.
   */
  readonly killTree: (pid: number, grouped: boolean) => Effect.Effect<void>
  /** Whether a pid names a living process. */
  readonly alive: (pid: number) => boolean
  /** The command line a living pid runs, as the system says it, or null when it cannot say. */
  readonly commandLineOf: (pid: number) => Effect.Effect<string | null>
}

export class HostProcesses extends Context.Service<HostProcesses, HostProcessesService>()(
  'HostProcesses',
) {}

/** Where what the children write on their standard error goes: the diagnostic log. */
export class StderrSink extends Context.Service<
  StderrSink,
  { readonly write: (line: string) => Effect.Effect<void> }
>()('StderrSink') {}

/** A root process as the registry keeps it. */
export interface RegisteredRoot {
  readonly id: string
  readonly pid: number
  readonly program: string
  readonly args: ReadonlyArray<string>
  readonly owner: ProcessOwner
  readonly engine: string
}

/** The durable registry of the roots the supervisor started. */
export class ProcessRegistry extends Context.Service<
  ProcessRegistry,
  {
    readonly add: (root: RegisteredRoot) => Effect.Effect<void>
    readonly remove: (id: string) => Effect.Effect<void>
    /** The roots of `kind` that an engine other than `engine` registered. */
    readonly leftBy: (
      kind: ProcessOwner['kind'],
      engine: string,
    ) => Effect.Effect<ReadonlyArray<RegisteredRoot>>
  }
>()('ProcessRegistry') {}

/** The lines a pipe carries, each whole and without its newline. */
function linesOf(stream: Readable, read: (line: string) => void): void {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    const parts = `${rest}${chunk}`.split('\n')
    rest = parts.pop() ?? ''
    for (const line of parts) read(line.endsWith('\r') ? line.slice(0, -1) : line)
  })
  stream.on('end', () => {
    if (rest !== '') read(rest)
    rest = ''
  })
}

/** `taskkill` on the tree of a pid; it answers once the kill was asked. */
const taskkill = (pid: number) =>
  Effect.callback<void>((resume) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
      resume(Effect.void)
    })
  })

/** What Windows says a pid runs: PowerShell is the one program every Windows has that tells it. */
const windowsCommandLine = (pid: number) =>
  Effect.callback<string | null>((resume) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${String(pid)}').CommandLine`,
      ],
      { windowsHide: true, timeout: 20_000 },
      (error, stdout) => {
        const line = String(stdout).trim()
        resume(Effect.succeed(error !== null || line === '' ? null : line))
      },
    )
  })

/** What macOS and the other POSIX systems say a pid runs. */
const psCommandLine = (pid: number) =>
  Effect.callback<string | null>((resume) => {
    execFile('ps', ['-o', 'command=', '-p', String(pid)], (error, stdout) => {
      const line = String(stdout).trim()
      resume(Effect.succeed(error !== null || line === '' ? null : line))
    })
  })

/** The machine this engine runs on. */
export const hostProcessesLayer = Layer.succeed(HostProcesses, {
  platform: process.platform,
  start: (program, args, options) => {
    const child: ChildProcess = spawn(program, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: options.detached,
      windowsVerbatimArguments: options.verbatim,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return {
      get pid() {
        return child.pid
      },
      write: (text) => (child.stdin?.writable ?? false) && child.stdin!.write(text),
      end: () => child.stdin?.end(),
      signal: (signal) => {
        const pid = child.pid
        if (pid === undefined) return
        if (process.platform === 'win32') {
          if (signal === 'SIGKILL') child.kill('SIGKILL')
          return
        }
        process.kill(options.detached ? -pid : pid, signal)
      },
      onSpawn: (spawned) => child.on('spawn', spawned),
      onExit: (ended) => child.on('exit', ended),
      onFailure: (failed) => {
        child.on('error', (cause: Error) => failed(cause.message))
        // A pipe that breaks under a child that is ending is not news worth a crash.
        child.stdin?.on('error', () => {})
      },
      onStdout: (read) => {
        if (child.stdout !== null) linesOf(child.stdout, read)
      },
      onStderr: (read) => {
        if (child.stderr !== null) linesOf(child.stderr, read)
      },
    }
  },
  killTree: (pid, grouped) =>
    process.platform === 'win32'
      ? taskkill(pid)
      : Effect.sync(() => {
          try {
            process.kill(grouped ? -pid : pid, 'SIGKILL')
          } catch {
            // Gone already: what was asked is that nothing be alive, and nothing is.
          }
        }),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (cause) {
      // SAFETY: `process.kill` throws a Node system error, whose `code` says whether the pid
      // named a process; EPERM is a process that is there and not ours to signal.
      return (cause as NodeJS.ErrnoException).code === 'EPERM'
    }
  },
  commandLineOf: (pid) => {
    if (process.platform === 'win32') return windowsCommandLine(pid)
    if (process.platform === 'linux') {
      return Effect.sync(() => {
        try {
          const read = readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8')
          return read === '' ? null : read.replace(/\0$/, '').split('\0').join(' ')
        } catch {
          return null
        }
      })
    }
    return psCommandLine(pid)
  },
})

const readArgs = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))

/** The registry, in the data folder's database. A refusal of the database is logged, not thrown. */
export const databaseRegistryLayer = Layer.effect(
  ProcessRegistry,
  Effect.gen(function* () {
    const database = yield* Database
    const sink = yield* StderrSink
    const logged = (doing: string) => (failure: { readonly message: string }) =>
      sink.write(`the supervisor's registry refused while ${doing}: ${failure.message}`)
    return {
      add: (root) =>
        database
          .insert(supervisedProcesses)
          .values({
            id: root.id,
            pid: root.pid,
            program: root.program,
            args: JSON.stringify(root.args),
            ownerKind: root.owner.kind,
            ownerId: root.owner.id,
            engine: root.engine,
            startedAt: new Date().toISOString(),
          })
          .pipe(
            Effect.mapError(refusedWhile('registering a process')),
            Effect.asVoid,
            Effect.catch(logged('registering a process')),
          ),
      remove: (id) =>
        database
          .delete(supervisedProcesses)
          .where(eq(supervisedProcesses.id, id))
          .pipe(
            Effect.mapError(refusedWhile('forgetting a process')),
            Effect.asVoid,
            Effect.catch(logged('forgetting a process')),
          ),
      leftBy: (kind, engine) =>
        database
          .select()
          .from(supervisedProcesses)
          .where(and(eq(supervisedProcesses.ownerKind, kind), ne(supervisedProcesses.engine, engine)))
          .pipe(
            Effect.mapError(refusedWhile('reading the registry')),
            Effect.map((rows) =>
              rows.map(
                (row): RegisteredRoot => ({
                  id: row.id,
                  pid: row.pid,
                  program: row.program,
                  args: Option.getOrElse(readArgs(row.args), () => []),
                  owner: { kind, id: row.ownerId },
                  engine: row.engine,
                }),
              ),
            ),
            Effect.catch((failure) =>
              Effect.as(logged('reading the registry')(failure), []),
            ),
          ),
    }
  }),
)

/** A command line in one spelling, to compare what was started with what runs now. */
const comparable = (line: string, platform: NodeJS.Platform): string => {
  const plain = line.replace(/["^]/g, '').replace(/\s+/g, ' ').trim()
  return platform === 'win32' ? plain.toLowerCase() : plain
}

/**
 * Whether a living pid still runs what was registered. On Linux the system hands back the very
 * words that were started, compared whole. Elsewhere it hands back one line, quoted its own way
 * (and the program by its full path): the arguments must end it and the program's name be in it.
 */
export function stillRuns(
  root: Pick<RegisteredRoot, 'program' | 'args'>,
  live: string,
  platform: NodeJS.Platform,
): boolean {
  const now = comparable(live, platform)
  if (platform === 'linux') return now === comparable([root.program, ...root.args].join(' '), platform)
  const program = comparable(basename(root.program, extname(root.program)), platform)
  return now.endsWith(comparable(root.args.join(' '), platform)) && now.includes(program)
}

/** A root left by a previous engine, and whether it was ended. */
export interface Orphan {
  readonly root: RegisteredRoot
  /** True when it was alive and still ours, and its tree was ended. */
  readonly ended: boolean
}

/** How long a child is given to end itself before its tree is taken down, unless told. */
export const DEFAULT_GRACE_MS = 5_000

export interface StartOptions {
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly verbatim?: boolean
  readonly graceMillis?: number
  readonly owner: ProcessOwner
}

/** A child started elsewhere and handed over: its pid, what it runs, and how to reach it. */
export interface HandedOver {
  readonly pid: number
  readonly program: string
  readonly args: ReadonlyArray<string>
  readonly closeInput: Effect.Effect<void>
  /** Its end, as whoever started it sees it. */
  readonly exited: Effect.Effect<ExitObservation>
}

export class ProcessSupervisor extends Context.Service<
  ProcessSupervisor,
  {
    /** This engine's own name in the registry. */
    readonly engine: string
    /**
     * Starts a program with its arguments, environment and folder, hidden on Windows, in its own
     * group on POSIX, registered while it runs and stopped when the scope closes.
     */
    readonly start: (
      program: string,
      args: ReadonlyArray<string>,
      options: StartOptions,
    ) => Effect.Effect<Supervised, SpawnFailed, Scope.Scope>
    /** A child started elsewhere, under the same policy, stopped when the scope closes. */
    readonly adopt: (
      child: HandedOver,
      options: Pick<StartOptions, 'graceMillis' | 'owner'>,
    ) => Effect.Effect<Supervised, never, Scope.Scope>
    /**
     * The roots of `kind` a previous engine left: each still alive and still the same program is
     * ended as a tree; every one is forgotten.
     */
    readonly endOrphans: (kind: ProcessOwner['kind']) => Effect.Effect<ReadonlyArray<Orphan>>
  }
>()('ProcessSupervisor') {}

type Lifecycle = 'running' | 'exiting' | 'exited'

/** One child and everything the supervisor knows of it. */
interface Child {
  readonly pid: () => number | undefined
  readonly label: string
  readonly grouped: boolean
  readonly grace: Duration.Duration
  readonly lifecycle: Ref.Ref<Lifecycle>
  readonly observation: Deferred.Deferred<ExitObservation>
  readonly spawned: Ref.Ref<boolean>
  readonly closeInput: Effect.Effect<void>
  readonly signal: (signal: Signal) => void
}

const lineOf = (line: string): string => (line.endsWith('\n') ? line : `${line}\n`)

export const processSupervisorLayer = Layer.effect(
  ProcessSupervisor,
  Effect.gen(function* () {
    const host = yield* HostProcesses
    const sink = yield* StderrSink
    const registry = yield* ProcessRegistry
    const engine = crypto.randomUUID()

    const signalQuietly = (child: Child, signal: Signal) =>
      Effect.sync(() => {
        try {
          child.signal(signal)
        } catch {
          // A group that ended a moment before the signal landed: nothing is left to signal.
        }
      })

    const takeTreeDown = (child: Child) =>
      Effect.gen(function* () {
        const pid = child.pid()
        if (pid === undefined || !(yield* Ref.get(child.spawned))) return
        yield* host.killTree(pid, child.grouped)
      })

    /** The input closed, `SIGTERM` to the group on POSIX, the grace, then the tree by force. */
    const stopOf = (child: Child): Effect.Effect<void> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(child.lifecycle)) === 'exited') return
        yield* Ref.set(child.lifecycle, 'exiting')
        yield* child.closeInput
        if (host.platform !== 'win32') yield* signalQuietly(child, 'SIGTERM')
        const ended = yield* Deferred.await(child.observation).pipe(
          Effect.timeoutOption(child.grace),
        )
        if (Option.isNone(ended)) {
          yield* takeTreeDown(child)
          yield* Deferred.await(child.observation).pipe(Effect.timeoutOption('5 seconds'))
        }
      })

    const killOf = (child: Child): Effect.Effect<void> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(child.lifecycle)) === 'exited') return
        yield* Ref.set(child.lifecycle, 'exiting')
        yield* takeTreeDown(child)
      })

    /** The end of a child, written down once: the state first, then the news. */
    const ended = (child: Child, registered: string | null) => (observation: ExitObservation) =>
      Effect.gen(function* () {
        yield* Ref.set(child.lifecycle, 'exited')
        const first = yield* Deferred.succeed(child.observation, observation)
        if (!first) return
        if (registered !== null) yield* registry.remove(registered)
        yield* sink.write(
          `${child.label} (${String(child.pid())}) ended with ${String(observation.code ?? observation.signal)}`,
        )
      })

    const start = (
      program: string,
      args: ReadonlyArray<string>,
      options: StartOptions,
    ): Effect.Effect<Supervised, SpawnFailed, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const grouped = host.platform !== 'win32'
          const answer = yield* Deferred.make<void, SpawnFailed>()
          const observation = yield* Deferred.make<ExitObservation>()
          const lifecycle = yield* Ref.make<Lifecycle>('running')
          const spawned = yield* Ref.make(false)
          const id = crypto.randomUUID()
          const label = basename(program)
          // Started and listened to in one synchronous step: the events these listeners answer
          // are the child's first moments, and Node tells them on the next tick.
          const { child, process: started } = yield* Effect.sync(() => {
            const started = host.start(program, args, {
              detached: grouped,
              cwd: options.cwd,
              env: options.env,
              verbatim: options.verbatim ?? false,
            })
            const child: Child = {
              pid: () => started.pid,
              label,
              grouped,
              grace: Duration.millis(options.graceMillis ?? DEFAULT_GRACE_MS),
              lifecycle,
              observation,
              spawned,
              closeInput: Effect.sync(() => started.end()),
              signal: (signal) => started.signal(signal),
            }
            started.onSpawn(() => {
              Effect.runSync(Ref.set(spawned, true))
              Effect.runSync(Deferred.succeed(answer, undefined))
            })
            started.onExit((code, signal) => {
              Effect.runFork(
                ended(child, id)({ code, signal, when: new Date().toISOString() }),
              )
            })
            started.onFailure((reason) => {
              Effect.runSync(Deferred.fail(answer, new SpawnFailed({ program, reason })))
              Effect.runFork(
                ended(child, null)({
                  code: null,
                  signal: `error: ${reason}`,
                  when: new Date().toISOString(),
                }),
              )
            })
            started.onStderr((line) => {
              Effect.runSync(sink.write(`${label} (${String(started.pid)}): ${line}`))
            })
            return { child, process: started }
          })
          yield* Deferred.await(answer)
          const pid = started.pid
          if (pid === undefined) {
            return yield* new SpawnFailed({ program, reason: 'it did not become a process' })
          }
          yield* registry.add({ id, pid, program, args, owner: options.owner, engine })
          // An end seen before the registry was written forgot nothing: forget it now.
          if ((yield* Ref.get(lifecycle)) === 'exited') yield* registry.remove(id)
          return { child, started, pid }
        }),
        ({ child }) => stopOf(child),
      ).pipe(
        Effect.map(
          ({ child, started, pid }): Supervised => ({
            pid,
            exited: Deferred.await(child.observation),
            write: (line) =>
              Effect.gen(function* () {
                if (!started.write(lineOf(line))) {
                  yield* sink.write(`${child.label} (${String(pid)}) could not be written to`)
                }
              }),
            closeInput: child.closeInput,
            stop: stopOf(child),
            kill: killOf(child),
            onStdout: (read) => started.onStdout(read),
            onStderr: (read) => started.onStderr(read),
          }),
        ),
      )

    const adopt = (
      handed: HandedOver,
      options: Pick<StartOptions, 'graceMillis' | 'owner'>,
    ): Effect.Effect<Supervised, never, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const child: Child = {
            pid: () => handed.pid,
            label: basename(handed.program),
            // A process forked elsewhere is not the leader of a group of its own.
            grouped: false,
            grace: Duration.millis(options.graceMillis ?? DEFAULT_GRACE_MS),
            lifecycle: yield* Ref.make<Lifecycle>('running'),
            observation: yield* Deferred.make<ExitObservation>(),
            spawned: yield* Ref.make(true),
            closeInput: handed.closeInput,
            signal: (signal) => process.kill(handed.pid, signal),
          }
          yield* registry.add({
            id,
            pid: handed.pid,
            program: handed.program,
            args: handed.args,
            owner: options.owner,
            engine,
          })
          yield* handed.exited.pipe(Effect.flatMap(ended(child, id)), Effect.forkDetach)
          return child
        }),
        stopOf,
      ).pipe(
        Effect.map(
          (child): Supervised => ({
            pid: handed.pid,
            exited: Deferred.await(child.observation),
            write: () => Effect.void,
            closeInput: child.closeInput,
            stop: stopOf(child),
            kill: killOf(child),
            onStdout: () => {},
            onStderr: () => {},
          }),
        ),
      )

    const endOrphans = (kind: ProcessOwner['kind']) =>
      Effect.gen(function* () {
        const left = yield* registry.leftBy(kind, engine)
        const orphans: Orphan[] = []
        for (const root of left) {
          let ours = false
          if (host.alive(root.pid)) {
            const line = yield* host.commandLineOf(root.pid)
            ours = line !== null && stillRuns(root, line, host.platform)
          }
          if (ours) {
            yield* host.killTree(root.pid, host.platform !== 'win32')
            yield* sink.write(
              `ended ${basename(root.program)} (${String(root.pid)}), left running by a previous engine for ${root.owner.kind} ${root.owner.id}`,
            )
          }
          yield* registry.remove(root.id)
          orphans.push({ root, ended: ours })
        }
        return orphans
      })

    return { engine, start, adopt, endOrphans }
  }),
)

/** The supervisor over this machine and the data folder's registry, its stderr into `write`. */
export const supervisorLayer = (write: (line: string) => void) => {
  const sink = Layer.succeed(StderrSink, { write: (line) => Effect.sync(() => write(line)) })
  return processSupervisorLayer.pipe(
    Layer.provideMerge(databaseRegistryLayer),
    Layer.provideMerge(Layer.merge(hostProcessesLayer, sink)),
  )
}
