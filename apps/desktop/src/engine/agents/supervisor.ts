/**
 * The processes Hemera starts, and how it makes sure none of them outlives it (design D5-04).
 *
 * An agent is a program that runs on the user's machine and, being a program, it starts others:
 * a shell, a compiler, a dev server, a formatter. Stopping the one Hemera knows about and
 * leaving the rest behind would be a Stop button that lies. So this service supervises by tree
 * and never by name — it never goes looking for a process called `claude` and kills whatever
 * wears that name, because that reaches processes that are not ours. It has one duty: nothing
 * outlives the engine.
 *
 * Every child is started in a process group of its own, and every signal goes to that group and
 * not to a lone pid, so a grandchild dies with the child that made it. Windows has no process
 * group to signal: there, a graceful stop closes the child's standard input, gives it the grace
 * to make up its mind, and only then takes the tree down by its root pid.
 *
 * The child is registered with the scope it was started in, which is what makes this hold
 * without anyone remembering to: the engine's scope is the one scope, and when it closes — on a
 * quit, on a crash, on a restart — the finalizer below stops every child it ever started.
 *
 * Two things can be started and one policy covers both: an agent's own command, spawned here,
 * and a bundled adapter, which is a Node script and cannot be — the fuse that would make Electron
 * a Node interpreter is off, so the main process forks it as a utility process and hands back a
 * pid and a port (`adapter-process.ts`, D5-21). Everything below that seam is the same.
 *
 * What the child writes on standard error is not swallowed. A program that fails says so
 * there, and a run of lines nobody read is a failure nobody can account for; so those lines are
 * handed to a sink, which the engine points at the diagnostic log, and to whoever asked for them
 * through `onStderr` — the output of a command is where they are read a second time (D6-12).
 * Nothing in here prints.
 */

import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { Context, Data, Deferred, Duration, Effect, Layer, Option, Ref } from 'effect'
import type { Scope } from 'effect'

import { forkedScript } from './adapter-process.ts'

/** A command that could not be started at all: the program, and why it would not run. */
export class AgentSpawnError extends Data.TaggedError('AgentSpawnError')<{
  readonly command: string
  readonly cause: string
}> {
  /** A sentence for the note a Session writes when its agent could not be run (D5-17). */
  override get message(): string {
    return `The agent could not be started (${this.command}): ${this.cause}`
  }
}

/** How a supervised process ended, and when it was seen to. */
export interface ExitObservation {
  /** The exit code, or `null` when a signal is what ended it. */
  readonly code: number | null
  /** The signal that ended it, or `null` when it exited on its own. */
  readonly signal: string | null
  /** When the death was observed, as an ISO date. */
  readonly when: string
}

/**
 * One running process, as the engine needs it.
 *
 * `stop` is the graceful one and `kill` is the forced one, and the difference between them is
 * the whole of the escalation: `stop` closes the input, signals the group on Linux or waits the
 * grace on Windows, and takes the tree down only if the grace expires with the process still
 * alive; `kill` takes it down at once, for a turn that has already had its grace (D5-10) or a
 * scope that is closing.
 *
 * `exited` resolves once and only once, whether the process died by itself, was stopped by
 * Hemera, or was killed by someone else — the engine's answer is the same for all three, and
 * the observation is what tells them apart.
 */
export interface SupervisedProcess {
  /** The process id, or `undefined` when the command never became one. */
  readonly pid: number | undefined
  /** The death of the process, observed when it happens and remembered afterwards. */
  readonly exited: Effect.Effect<ExitObservation>
  /**
   * Writes one line to the child's standard input.
   *
   * A line and not a chunk: what goes down there is NDJSON, and a line cut in two by a writer
   * that did not finish is an agent reading half a message and answering nothing. A write to a
   * child that is already gone is not a failure of this service — the death is what the caller
   * is told about, through `exited`.
   */
  readonly write: (line: string) => Effect.Effect<void>
  /** Closes the child's standard input: half of a graceful stop, and all of the signal. */
  readonly closeInput: Effect.Effect<void>
  /** Ends the process, its group and its children: the graceful stop of this service. */
  readonly stop: Effect.Effect<void>
  /** Ends them now, with no grace at all. */
  readonly kill: Effect.Effect<void>
  /**
   * Reads what the child writes on its standard output, one line at a time, as it arrives.
   *
   * The lines are handed over rather than buffered: an agent's answer is read as it is spoken,
   * and the supervisor is not a mailbox. Reading is one-way — what arrived before a reader
   * attached is gone, which is why the runtime attaches its reader before it writes anything.
   */
  readonly onStdout: (read: (line: string) => void) => void
  /**
   * Reads what the child writes on its standard error, one line at a time, as it arrives.
   *
   * Handed over the same way `onStdout` is, and for a reason of its own: a tool that fails says
   * why on standard error — `tsc`, `vitest`, `eslint`, `cargo` all do — so a run that kept only
   * standard output would show an exit code with nothing to explain it (D6-12). This is one more
   * ear and never a redirection: the diagnostic sink is handed every line all the same.
   */
  readonly onStderr: (read: (line: string) => void) => void
}

/** What the engine hands its children's `stderr` to. `main/diagnostic.ts` holds the `Log`. */
export interface StderrSinkService {
  readonly write: (line: string) => Effect.Effect<void>
}

export class StderrSink extends Context.Service<StderrSink, StderrSinkService>()('StderrSink') {}

/** What a process can be told to do to itself. */
export type Signal = 'SIGTERM' | 'SIGKILL' | 'SIGINT'

/**
 * How a child is started, which is the part of `child_process` this service decides.
 *
 * Mutable on purpose: the supervisor builds it in statements, adding only the properties a
 * caller named, so that a cwd or an env that is not there is not a property at all.
 */
export interface HostProcessOptions {
  /** Whether the child is its own process group (POSIX) or its own console (Windows). */
  detached: boolean
  /**
   * What is being started: a program of the machine, or a Node script this application carries.
   *
   * The two are started by different things, for one reason: a package of this application has no
   * Node to run a script with — `process.execPath` is Electron, and the `runAsNode` fuse is off so
   * that a packaged application cannot be talked into being a Node interpreter. So a bundled
   * adapter is forked as a utility process by the main process (D5-21), while an agent's own
   * command is spawned here as it always was.
   */
  runtime: 'command' | 'script'
  cwd?: string
  env?: Record<string, string>
}

/**
 * A started child, in the few words this service needs to say to it.
 *
 * A port and not the `ChildProcess` itself: what a test drives is exactly these, and a fake
 * that answers `write` and `signal` lets a suite see what the supervisor said to a child
 * without a child. The lint refuses `vi.mock`, so injection is the only way in (D5-16), and
 * this is the door.
 *
 * The callbacks are attached synchronously, inside `start`, before anything awaits: a command
 * that cannot be run reports it on an event that fires almost immediately, and a listener added
 * one turn of the loop later would be added too late.
 */
export interface HostProcess {
  readonly pid: number | undefined
  /**
   * Writes to standard input, and says whether the stream took it.
   *
   * `false` is a stream whose end has come or whose buffer is full.
   */
  readonly write: (line: string) => boolean
  /** Ends standard input, once. */
  readonly end: () => void
  /** Sends this signal to the process, or to the group when it was started detached. */
  readonly signal: (signal: Signal) => void
  /** The child became a process: the spawn is what a caller waits for before using it. */
  readonly onSpawn: (spawned: () => void) => void
  /** The child ended, by itself or because a signal reached it. */
  readonly onExit: (ended: (code: number | null, signal: string | null) => void) => void
  /** The child could not be started, or its standard error pipe broke. */
  readonly onFailure: (failed: (cause: string) => void) => void
  /** A line the child wrote on standard error, without its newline. */
  readonly onStderr: (read: (line: string) => void) => void
  /**
   * A line the child wrote on standard output, without its newline.
   *
   * This is where an agent speaks ACP: the engine hands every line to the client and parses it
   * (design D5-01). Nothing else reads it — the supervisor keeps no copy, and what an agent says
   * belongs to the thread rather than to the log.
   */
  readonly onStdout: (read: (line: string) => void) => void
}

/**
 * What a process is started through, and what a tree is taken down through.
 *
 * Two doors and not one, because they are two different programs: `node:child_process` starts a
 * child, and on Windows `taskkill` — a program of the system, not of this repository — ends a
 * tree. Both are behind this port so that the supervisor can be read as the policy it is — the
 * group, the grace, the escalation — with the system calls at the edges, where a test replaces
 * them.
 */
export interface HostProcessesService {
  readonly start: (
    command: string,
    args: readonly string[],
    options: HostProcessOptions,
  ) => HostProcess
  /** Ends a whole process tree by its root pid. Windows is the platform that needs this one. */
  readonly killTree: (pid: number) => Effect.Effect<void>
}

export class HostProcesses extends Context.Service<HostProcesses, HostProcessesService>()(
  'HostProcesses',
) {}

/**
 * The lines a pipe carries, each handed over whole and without its newline.
 *
 * A pipe delivers chunks, and a chunk ends wherever the operating system cut it — a message of a
 * few tens of kilobytes arrives in several. What did not end with a newline is carried over to
 * the next chunk rather than handed over as a line of its own, and what is left when the pipe
 * closes is the last line.
 */
function linesOf(stream: Readable, read: (line: string) => void): void {
  let rest = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    const parts = `${rest}${chunk}`.split('\n')
    rest = parts.pop() ?? ''
    for (const line of parts) if (line !== '') read(line)
  })
  stream.on('end', () => {
    if (rest !== '') read(rest)
    rest = ''
  })
}

/**
 * The machine as this process sees it.
 *
 * `detached` is what buys a process group on POSIX and a separate console on Windows, and the
 * child's three pipes are its whole conversation: ACP speaks NDJSON on the standard input and
 * output, and the standard error is the diagnostic.
 *
 * A signal reaches the group through the negative of its leader's pid. Windows has no such
 * addressing and raises `ESRCH` for every signal but `SIGKILL`, which it reads as an immediate
 * termination; there, ending a tree is `taskkill`'s job, and this layer only starts the child.
 */
export const hostProcessesLayer = Layer.succeed(HostProcesses, {
  start: (command, args, options) => {
    if (options.runtime === 'script') return forkedScript(command, args, options)
    const { runtime: _runtime, ...spawnOptions } = options
    const child: ChildProcess = spawn(command, [...args], {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    return {
      get pid() {
        return child.pid
      },
      write: (line) => child.stdin?.write(line) ?? false,
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
        child.on('error', (cause: Error) => {
          failed(cause.message)
        })
      },
      onStderr: (read) => {
        if (child.stderr !== null) linesOf(child.stderr, read)
      },
      onStdout: (read) => {
        if (child.stdout !== null) linesOf(child.stdout, read)
      },
    }
  },
  killTree: (pid) =>
    // `/T` walks the tree and `/F` ends it outright: `/PID` addresses the root and every
    // descendant goes with it, which is the same promise the Linux group makes. A `taskkill`
    // that fails — a tree that is already gone — is not a failure of stopping: what the caller
    // asked for is that nothing be alive afterwards, and nothing is.
    //
    // A utility process is a tree on Windows and a lone pid on POSIX: it is not started in a
    // group of its own, so what is left there is the pid itself. The graceful stop is what
    // takes an adapter's own children with it — closing its input ends the conversation and the
    // adapter disposes of the agent it started — and this is the escalation after that failed.
    process.platform === 'win32'
      ? Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {
                resolve()
              })
            }),
        )
      : Effect.sync(() => {
          process.kill(pid, 'SIGKILL')
        }).pipe(Effect.catchCause(() => Effect.void)),
})

export interface ProcessSupervisorService {
  /**
   * Starts one program and hands back what can be said to it.
   *
   * A command that does not exist is a refusal and not a defect: `AgentSpawnError` carries the
   * command, for the note a Session writes when its agent cannot run (D5-17). The child is
   * registered with the scope it was started in, so an engine shutdown stops it even when
   * nobody ever calls `stop`.
   */
  readonly start: (
    command: string,
    args: readonly string[],
    options: {
      readonly cwd?: string
      readonly env?: Record<string, string>
      /** How long a graceful stop is given before the tree is taken down. 3000 ms by default. */
      readonly graceMilliseconds?: number
      /**
       * Whether what is named is a Node script this application carries rather than a command.
       *
       * The two bundled adapters are scripts, and nothing in this process can run one: the fuse
       * that would make Electron a Node interpreter is off, so they are forked as utility
       * processes by the main process (D5-21). An agent's own command is spawned as it was.
       */
      readonly script?: boolean
    },
  ) => Effect.Effect<SupervisedProcess, AgentSpawnError, Scope.Scope>
}

/**
 * The `ProcessSupervisor` the engine asks for (D5-04).
 *
 * Named as the design names it: what a caller wants is not a child process but the promise that
 * nothing outlives the engine, and that promise is what this service is.
 */
export class ProcessSupervisor extends Context.Service<
  ProcessSupervisor,
  ProcessSupervisorService
>()('ProcessSupervisor') {}

/** How long a child is given to close itself after its group was signalled, when not told. */
const DEFAULT_GRACE_MS = 3_000

/**
 * What the host is told, with only the properties the caller named.
 *
 * Built in statements rather than by conditionally spreading an empty object: a cwd or an env
 * that is not there is simply not a property, and a shape that hides that behind a spread is a
 * shape nobody can read.
 */
function hostOptionsOf(
  grouped: boolean,
  runtime: HostProcessOptions['runtime'],
  cwd: string | undefined,
  env: Record<string, string> | undefined,
): HostProcessOptions {
  const settings: HostProcessOptions = { detached: grouped, runtime }
  if (cwd !== undefined) settings.cwd = cwd
  if (env !== undefined) settings.env = env
  return settings
}

/** A line is written whole or not at all: what goes to a child that reads lines ends in one. */
function lineOf(line: string): string {
  return line.endsWith('\n') ? line : `${line}\n`
}

/** What a child's life has been so far, which is the whole of the supervisor's bookkeeping. */
type Lifecycle = 'running' | 'exiting' | 'exited'

/** One running child, and everything the supervisor knows about it. */
interface Child {
  /**
   * The child itself, which is also where its pid is read from rather than kept.
   *
   * Read through and not copied: a program this machine does not have never becomes a process
   * and has no pid at all, and a bundled adapter is a process the main process forks, so its
   * pid arrives after the start was answered. The listeners below are attached before either is
   * known, because the news of a command that cannot run arrives on the first turn of the loop.
   */
  readonly process: HostProcess
  readonly lifecycle: Ref.Ref<Lifecycle>
  /** The death, kept so that a second reader is answered exactly what the first one was. */
  readonly observation: Deferred.Deferred<ExitObservation, AgentSpawnError>
  readonly grace: Duration.Duration
  /** A group is signalled as a group on Linux; a tree is `taskkill`'d on Windows. */
  readonly grouped: boolean
  /**
   * Whether the child ever answered a spawn.
   *
   * A command this machine does not have is an `error` event and never an `exit`, and the two
   * ways of taking a tree down want different things: `taskkill` needs a pid that exists,
   * `process.kill` needs nothing more than a pid.
   */
  readonly spawned: Ref.Ref<boolean>
}

/**
 * The process supervisor, over whichever machine it is handed.
 *
 * The grace is spent on the injected `Clock`, so a suite that drives the clock (D5-05) does not
 * spend three real seconds per stop, and a real run spends exactly the three the design chose.
 * Nothing here reaches the console: what a child says goes to the sink.
 */
export const processSupervisorLayer = Layer.effect(
  ProcessSupervisor,
  Effect.gen(function* () {
    const host = yield* HostProcesses
    const sink = yield* StderrSink

    /**
     * A signal that reached nothing is not a failure of stopping.
     *
     * Between the moment Hemera decides to signal a group and the moment the signal lands, the
     * process can end by itself; `process.kill` then raises `ESRCH` on a group that is already
     * gone. A stop that died because it was a moment too late would be a Stop button that
     * breaks on the fastest case, and what a caller watches is `exited`, not this.
     */
    const signalQuietly = (child: Child, signal: Signal): Effect.Effect<void> =>
      Effect.sync(() => {
        child.process.signal(signal)
      }).pipe(Effect.catchCause(() => Effect.void))

    /**
     * The tree, ended by force.
     *
     * On Windows that is `taskkill /T /F`, which needs a pid to walk from; on Linux the tree is
     * the group, and the group is the negative of the leader's pid. A command that never became
     * a process has no tree and needs none taken down.
     */
    const takeTreeDown = (child: Child): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (child.process.pid === undefined) return
        if (child.grouped) {
          yield* signalQuietly(child, 'SIGKILL')
          return
        }
        if (!(yield* Ref.get(child.spawned))) return
        yield* host.killTree(child.process.pid)
      })

    /**
     * Takes a child and its tree down, and waits until it really is.
     *
     * The order is the design's: close the input — a child that reads a stream learns a lot from
     * the stream ending — then end it, then give it the grace, and only then insist. On Linux
     * the ending is a `SIGTERM` to the group, because a child that spawned a grandchild would
     * otherwise leave the grandchild whole; on Windows nothing is sent yet, because the tree is
     * taken down by `taskkill` once the grace has passed (decision 94).
     *
     * A second caller has nothing to do: a child that is already gone is a `taskkill` on a pid
     * that no longer exists, which is a line in a log for nobody.
     */
    const stopOf = (child: Child): Effect.Effect<void> =>
      Effect.gen(function* () {
        if ((yield* Ref.get(child.lifecycle)) === 'exited') return
        yield* Ref.set(child.lifecycle, 'exiting')

        yield* Effect.sync(child.process.end)
        if (child.grouped) yield* signalQuietly(child, 'SIGTERM')

        // The grace. A child that ends inside it is the whole of the stop and nobody is killed;
        // a grace that expires is the escalation, and it happens whether or not the child ever
        // answered the signal.
        const ended = yield* child.observation.pipe(
          Deferred.await,
          Effect.orDie,
          Effect.timeoutOption(child.grace),
        )
        if (Option.isNone(ended)) yield* takeTreeDown(child)
      })

    /**
     * A child's death, recorded once: the first listener to arrive is the one that is kept.
     *
     * The state is written before the news is told, and the order is the whole point: completing
     * the `Deferred` wakes whoever was waiting on `exited` on this very stack, and that wake-up
     * can be the end of a scope — whose finalizer asks whether the process is still there. Told
     * before marked, the finalizer would find a process it believed alive and stop it a second
     * time, signalling a group that no longer exists.
     */
    const record =
      (child: Child, failure: AgentSpawnError | null) =>
      (code: number | null, signal: string | null): Effect.Effect<void> =>
        Effect.gen(function* () {
          const when = yield* Effect.sync(() => new Date().toISOString())
          yield* Ref.set(child.lifecycle, 'exited')
          const first = yield* Deferred.complete(
            child.observation,
            failure === null
              ? Effect.succeed({ code, signal, when } satisfies ExitObservation)
              : Effect.succeed({
                  code: null,
                  signal: `error: ${failure.cause}`,
                  when,
                } satisfies ExitObservation),
          )
          if (!first) return
          yield* sink.write(
            failure === null
              ? `${String(child.process.pid)} ended with ${String(code ?? signal)}`
              : `${String(child.process.pid)} could not be started: ${failure.cause}`,
          )
        })

    /** The child as the engine sees it: the two stops, its input, and its observed death. */
    const supervised = (child: Child): SupervisedProcess => ({
      pid: child.process.pid,
      // A refused spawn is a death as much as an end is: what a caller waits for is the news,
      // and a caller that awaited a death that can never come would be waiting forever.
      exited: Effect.orDie(Deferred.await(child.observation)),
      write: (line) =>
        Effect.gen(function* () {
          const written = yield* Effect.sync(() => child.process.write(lineOf(line)))
          if (!written) {
            yield* sink.write(
              `${String(child.process.pid)} could not be written to: the pipe is closed`,
            )
          }
        }),
      closeInput: Effect.sync(child.process.end),
      onStdout: (read) => {
        child.process.onStdout(read)
      },
      onStderr: (read) => {
        child.process.onStderr(read)
      },
      stop: stopOf(child),
      kill: Effect.gen(function* () {
        yield* Ref.set(child.lifecycle, 'exiting')
        yield* takeTreeDown(child)
      }),
    })

    /** Starts one child, watches it, and registers its ending with the scope that asked. */
    const handle = (
      command: string,
      args: readonly string[],
      options: {
        readonly cwd?: string
        readonly env?: Record<string, string>
        readonly graceMilliseconds?: number
        readonly script?: boolean
      },
    ): Effect.Effect<SupervisedProcess, AgentSpawnError, Scope.Scope> =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const lifecycle = yield* Ref.make<Lifecycle>('running')
          const spawned = yield* Ref.make(false)
          const observation = yield* Deferred.make<ExitObservation, AgentSpawnError>()
          const answer = yield* Deferred.make<void, AgentSpawnError>()
          const grace = Duration.millis(options.graceMilliseconds ?? DEFAULT_GRACE_MS)
          // A utility process is not started in a group of its own, so a script is never a group
          // whatever the platform; an agent's own command is one everywhere but Windows.
          const grouped = process.platform !== 'win32' && options.script !== true

          const started = host.start(
            command,
            args,
            hostOptionsOf(
              grouped,
              options.script === true ? 'script' : 'command',
              options.cwd,
              options.env,
            ),
          )

          const child: Child = {
            process: started,
            lifecycle,
            observation,
            grace,
            grouped,
            spawned,
          }
          const ended = record(child, null)
          const refused = (failure: AgentSpawnError) => record(child, failure)(null, null)
          /** Answers the spawn, once: a refusal and a spawn cannot both be the truth. */
          const answerWith = (outcome: Effect.Effect<void, AgentSpawnError>, spawned_: boolean) =>
            Effect.gen(function* () {
              const first = yield* Deferred.complete(answer, outcome)
              if (first) yield* Ref.set(spawned, spawned_)
            })

          // The four listeners are attached here, before the spawn is awaited, and none of them
          // is attached after: the events they answer are the child's first moments.
          yield* Effect.sync(() => {
            started.onSpawn(() => {
              Effect.runSync(answerWith(Effect.void, true))
            })
            started.onExit((code, signal) => {
              Effect.runSync(ended(code, signal))
            })
            started.onFailure((cause) => {
              const failure = new AgentSpawnError({ command, cause })
              Effect.runSync(refused(failure))
              Effect.runSync(answerWith(Effect.fail(failure), false))
            })
            started.onStderr((line) => {
              Effect.runSync(sink.write(`${command} (${String(started.pid)}): ${line}`))
            })
          })

          // The command has to become a process before anything is written to it: a program
          // this machine does not have is a refusal here (D5-17), and not a write that went
          // nowhere. The pid is a fact by then, so what is missing it is a spawn that never
          // answered — which the listener above has already named, and this only covers.
          yield* Deferred.await(answer)
          if (child.process.pid === undefined) {
            return yield* Effect.fail(
              new AgentSpawnError({ command, cause: 'the command did not become a process' }),
            )
          }
          return child
        }),
        // Whatever became of the process, stopping it is what this service promised — and a
        // finalizer that threw would be a quit that half happened, so nothing here can fail.
        (child) => stopOf(child),
      ).pipe(Effect.map(supervised))

    return { start: handle } satisfies ProcessSupervisorService
  }),
)
