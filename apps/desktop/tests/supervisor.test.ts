/**
 * The processes an agent starts, and how Hemera makes sure none of them outlives it (D5-04).
 *
 * Each suite is named after the scenario of the issue's `Spec · agent-runtime` section that it
 * covers. Nothing here is mocked, and nothing is `vi.mock`ed — the lint refuses it — so what is
 * driven is a real machine: real children, started with `node:child_process` through the port
 * the supervisor declares, over scripts this suite wrote into a temporary folder. That is the
 * only way to show the two things this service promises: that a process which dies is seen to
 * die, and that a grandchild does not survive its grandparent.
 *
 * What is verified is always the machine and not the call: a process is gone when the kernel
 * says so — `process.kill(pid, 0)` raising `ESRCH` — never because a `stop` returned. Nothing
 * here reaches the network, an agent, or the `PATH` of the machine running the tests.
 *
 * A child's whole life is lived inside one `opened` call, because the scope that started it is
 * what stops it: a suite that returned a child from one scope to drive it in another would be
 * testing a process its own harness had already stopped.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Layer, Ref } from 'effect'
import type { Scope } from 'effect'

import type { SupervisedProcess } from '#engine/agents/supervisor.ts'
import {
  AgentSpawnError,
  ProcessSupervisor,
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'

let folder: string
let scripts = 0

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-supervisor-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** Writes a real script into the suite's folder and answers the path to run it with `node`. */
function script(body: string): string {
  scripts += 1
  const path = join(folder, `script-${String(scripts)}.mjs`)
  writeFileSync(path, body)
  return path
}

/** The lines a suite's sink was handed, and the port that proves nothing was swallowed. */
interface Sink {
  readonly layer: Layer.Layer<StderrSink>
  readonly lines: Ref.Ref<readonly string[]>
}

/**
 * A sink that keeps what it is handed.
 *
 * The engine points this at the diagnostic log; a suite points it at a list, which is what makes
 * "the `stderr` of the child was not swallowed" something a test can read.
 */
function sinkOf(): Sink {
  const lines = Ref.makeUnsafe<readonly string[]>([])
  return {
    lines,
    layer: Layer.succeed(StderrSink, {
      write: (line: string) => Ref.update(lines, (held) => [...held, line]),
    }),
  }
}

/** What the sink has been handed so far. A `Ref` is a value, so it reads outside the runtime. */
const said = (sink: Sink) => Effect.runSync(Ref.get(sink.lines))

/**
 * The supervisor over the real machine, and a sink a suite reads.
 *
 * `hostProcessesLayer` is the real spawn, and the real group: the group, the grace and the
 * observed death are all things the kernel has an opinion about, and a fake spawner could not
 * prove any of them. The scope is opened here and closed when the program ends, which is what
 * an engine's scope is — the promise under test is that closing it leaves nothing running.
 */
function opened(sink: Sink) {
  const layer = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink.layer)),
  )
  return <A, E>(program: Effect.Effect<A, E, ProcessSupervisor | Scope.Scope>): Promise<A> =>
    Effect.runPromise(Effect.scoped(Effect.provide(program, layer)))
}

/** Starts one command through the supervisor. */
const starting = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly graceMilliseconds?: number
  },
) =>
  Effect.gen(function* () {
    const supervisor = yield* ProcessSupervisor
    return yield* supervisor.start(command, args, options)
  })

/**
 * How a script keeps itself up: a timer of its own, and never the standard input pipe.
 *
 * A process whose only handle is its input ends the moment a stop closes that input — and then
 * what looked like a graceful stop would be a child that ended by itself, which is exactly the
 * thing a test of the grace must not be fooled into.
 */
const STAYS_UP = 'setInterval(() => {}, 1000)\n'

/** A child that never ends by itself, which is what a running agent is. */
const ALIVE_FOR = STAYS_UP

/**
 * A child that ends when its input ends, the way a program that reads a stream does.
 *
 * `resume` is what makes the input flow: a stream nobody reads never reports that it ended.
 */
const ENDS_WHEN_INPUT_ENDS =
  "process.stdin.resume()\nprocess.stdin.on('end', () => process.exit(0))\n" + STAYS_UP

/** A child that says back what it was written, so that a suite can see the line arrived. */
const ECHOES_ITS_INPUT =
  "process.stdin.setEncoding('utf8')\n" +
  "process.stdin.on('data', (line) => process.stderr.write(`heard ${line.trim()}\\n`))\n" +
  STAYS_UP

/**
 * A child that starts a grandchild and writes where it is.
 *
 * A process tree an agent's own tools produce every day: the child does not read its own group,
 * so what ends the grandchild is the signal Hemera sends to the group — and the grandchild is
 * the proof that signals go to the group and never to a pid alone.
 */
const SPAWNS_A_GRANDCHILD =
  "import { spawn } from 'node:child_process'\n" +
  "import { writeFileSync } from 'node:fs'\n" +
  "const grandchild = spawn('sleep', ['600'], { stdio: 'ignore' })\n" +
  'writeFileSync(process.argv[2], `${String(grandchild.pid)}\\n`)\n' +
  STAYS_UP

/** A child that refuses to close itself, which is what the escalation exists for. */
const REFUSES_TO_DIE =
  "import { writeFileSync } from 'node:fs'\n" +
  "process.on('SIGTERM', () => {})\n" +
  'writeFileSync(process.argv[2], `ready\\n`)\n' +
  STAYS_UP

/** A child that says something on its standard error and stays up. */
const WRITES_ON_STDERR =
  "process.stderr.write('a tool said something\\n')\n" +
  "process.stderr.write('and something else\\n')\n" +
  STAYS_UP

/**
 * Waits for a file the child writes, and answers what it holds.
 *
 * A child has no line to say when the process itself is what it reports, so a file is how a
 * script hands a suite a pid, and how a suite knows the child is up before it kills it.
 */
function writtenIn(path: string): Promise<string> {
  return new Promise((resolve) => {
    const waiting = setInterval(() => {
      let wrote = ''
      try {
        wrote = readFileSync(path, 'utf8').trim()
      } catch {
        // Not there yet: a file a child is about to write is a file that is not there.
      }
      if (wrote !== '') {
        clearInterval(waiting)
        resolve(wrote)
      }
    }, 20)
  })
}

/**
 * Whether a process is still there, asked of the kernel.
 *
 * Signalling zero reaches nothing, so `ESRCH` is the kernel saying the pid names no process, and
 * that is the only proof that a process is gone. A zombie is a pid the kernel still knows, so a
 * child that was reaped and a child that was never reaped are told apart here.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    // SAFETY: `process.kill` raises a Node error, and its `code` is what says whether the pid
    // named a process; a cause that is anything else is not a living process either.
    return (cause as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/**
 * Waits for a check to pass, and answers whether it did before the wait ran out.
 *
 * Bounded on purpose: a process that refuses to die has to fail a test rather than hang it. It
 * recurses rather than loops because each wait is one promise paid at a time.
 */
async function untilTrue(check: () => boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds
  const until = async (): Promise<boolean> => {
    if (check()) return true
    if (Date.now() > deadline) return check()
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    return until()
  }
  return until()
}

/**
 * Waits until a process is really gone, and answers whether it went.
 *
 * A `stop` that returned is not the claim under test; the claim is that nothing is alive
 * afterwards, which is a question only the kernel can answer.
 */
const goneWithin = (pid: number, milliseconds: number) => untilTrue(() => !alive(pid), milliseconds)

/** The pid of a child that has one, or a refusal to go on with a test that needs one. */
function pidOf(child: SupervisedProcess): number {
  if (child.pid === undefined) throw new Error('the child has no pid')
  return child.pid
}

describe('The process is killed by hand', () => {
  test('a child that dies is seen to die, with the signal that ended it', async () => {
    const sink = sinkOf()
    const aliveFor = script(ALIVE_FOR)

    const [observation, where] = await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [aliveFor], {})
        const pid = pidOf(child)
        // Killed by hand, the way a user or the system does it: this death is not one the
        // supervisor asked for, and it still has to notice it.
        process.kill(pid, 'SIGTERM')
        return [yield* child.exited, pid] as const
      }),
    )

    expect(observation.signal).toBe('SIGTERM')
    expect(observation.code).toBeNull()
    expect(Number.isNaN(Date.parse(observation.when))).toBe(false)
    expect(await goneWithin(where, 2_000)).toBe(true)
    // The engine is told, and being told is what lets a thread survive a death it did not cause.
    expect(said(sink)).toContain(`${String(where)} ended with SIGTERM`)
  })

  test('a child that ends by itself is seen to end, with the code it chose', async () => {
    const sink = sinkOf()
    const endsWhenInputEnds = script(ENDS_WHEN_INPUT_ENDS)

    const observation = await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [endsWhenInputEnds], {})
        // The child ends when its input does, so closing the input is the whole of this stop —
        // and the death is still observed, because every death is observed the same way.
        yield* child.closeInput
        return yield* child.exited
      }),
    )

    expect(observation.code).toBe(0)
    expect(observation.signal).toBeNull()
  })

  test('the death is observed once, however many wait for it', async () => {
    const sink = sinkOf()
    const aliveFor = script(ALIVE_FOR)

    const observations = await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [aliveFor], {})
        // `kill` is the forced stop; the death it causes is the one `exited` reports, and the
        // second and third readers have to be answered exactly what the first one was.
        yield* child.kill
        return [yield* child.exited, yield* child.exited, yield* child.exited] as const
      }),
    )

    expect(observations[1]).toEqual(observations[0])
    expect(observations[2]).toEqual(observations[0])
    expect(observations[0]?.signal).toBe('SIGKILL')
  })

  test('nothing an agent started survives the engine scope closing', async () => {
    const sink = sinkOf()
    const aliveFor = script(ALIVE_FOR)

    const pid = await opened(sink)(
      Effect.gen(function* () {
        return pidOf(yield* starting(process.execPath, [aliveFor], {}))
      }),
    )

    // The scope the child was started in is closed — the engine quit — and its promise is that
    // the agent it started did not survive it.
    expect(await goneWithin(pid, 3_000)).toBe(true)
  })

  test('what is written to the child reaches it, a line at a time', async () => {
    const sink = sinkOf()
    const echoes = script(ECHOES_ITS_INPUT)

    await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [echoes], {})
        yield* child.write('bonjour')
        // The line is written whole: what the child reads back is the line, not a fragment.
        yield* Effect.promise(() =>
          untilTrue(() => said(sink).some((line) => line.endsWith(': heard bonjour')), 2_000),
        )
      }),
    )

    expect(said(sink).some((line) => line.endsWith(': heard bonjour'))).toBe(true)
  })
})

describe('No orphan after stop', () => {
  test('a child that spawned a grandchild leaves neither behind when it is stopped', async () => {
    const sink = sinkOf()
    const where = join(folder, 'grandchild.pid')
    const spawnsAGrandchild = script(SPAWNS_A_GRANDCHILD)

    const [child, grandchild, bothUp] = await opened(sink)(
      Effect.gen(function* () {
        const started = yield* starting(process.execPath, [spawnsAGrandchild, where], {})
        const childPid = pidOf(started)
        const grandchildPid = Number(yield* Effect.promise(() => writtenIn(where)))
        const bothWereUp = alive(childPid) && alive(grandchildPid)
        // The graceful stop: the input closes, the group is signalled, the grace is spent.
        yield* started.stop
        return [childPid, grandchildPid, bothWereUp] as const
      }),
    )

    expect(bothUp).toBe(true)
    // The signal, and not the escalation, is what ended the child: the group carried it.
    expect(said(sink)).toContain(`${String(child)} ended with SIGTERM`)
    // Both are really gone, asked of the kernel and not of the call that returned.
    expect(await goneWithin(child, 3_000)).toBe(true)
    expect(await goneWithin(grandchild, 3_000)).toBe(true)
  })

  test('a child that ignores the signal is taken down when the grace expires', async () => {
    const sink = sinkOf()
    const ready = join(folder, 'ready')
    const refusesToDie = script(REFUSES_TO_DIE)

    const [where, spent, signal] = await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [refusesToDie, ready], {
          graceMilliseconds: 200,
        })
        const pid = pidOf(child)
        // The child is up and refusing only once it says so.
        yield* Effect.promise(() => writtenIn(ready))
        const from = Date.now()
        yield* child.stop
        const observation = yield* child.exited
        return [pid, Date.now() - from, observation.signal] as const
      }),
    )

    expect(await goneWithin(where, 3_000)).toBe(true)
    // The grace was really spent before the tree was taken down: a stop that killed at once
    // would be an escalation that never waited, and a child mid-turn would lose its work.
    expect(spent).toBeGreaterThanOrEqual(200)
    expect(signal).toBe('SIGKILL')
  })

  test('a grandchild does not survive the engine scope closing either', async () => {
    const sink = sinkOf()
    const where = join(folder, 'grandchild.pid')
    const spawnsAGrandchild = script(SPAWNS_A_GRANDCHILD)

    const [child, grandchild] = await opened(sink)(
      Effect.gen(function* () {
        const started = yield* starting(process.execPath, [spawnsAGrandchild, where], {})
        return [pidOf(started), Number(yield* Effect.promise(() => writtenIn(where)))] as const
      }),
    )

    expect(await goneWithin(child, 3_000)).toBe(true)
    expect(await goneWithin(grandchild, 3_000)).toBe(true)
  })
})

describe('Standard error is handed to the sink and never swallowed', () => {
  test('what the child writes on stderr reaches the port the engine injected', async () => {
    const sink = sinkOf()
    const writesOnStderr = script(WRITES_ON_STDERR)

    await opened(sink)(
      Effect.gen(function* () {
        const child = yield* starting(process.execPath, [writesOnStderr], {})
        yield* Effect.promise(() =>
          untilTrue(
            () => said(sink).some((line) => line.endsWith(': a tool said something')),
            2_000,
          ),
        )
        yield* child.stop
      }),
    )

    const lines = said(sink)
    expect(lines.some((line) => line.endsWith(': a tool said something'))).toBe(true)
    expect(lines.some((line) => line.endsWith(': and something else'))).toBe(true)
  })

  test('a command this machine does not have is refused, naming the command', async () => {
    const sink = sinkOf()
    const absent = join(folder, 'an-agent-that-is-not-here')

    const failure = await opened(sink)(Effect.flip(starting(absent, [], {})))

    expect(failure).toBeInstanceOf(AgentSpawnError)
    expect(failure.command).toBe(absent)
    expect(failure.cause).not.toBe('')
  })
})

/**
 * The Windows tree, which this Linux machine cannot run.
 *
 * There, the graceful stop closes the child's input, waits the grace and takes the tree down
 * with `taskkill /PID <pid> /T /F` (issue decision 94): Windows has no process group to signal,
 * and `process.kill(-pid)` means nothing to it. None of that is verified here — this machine is
 * Linux, and the report says so — so the branch is named and skipped rather than guessed at.
 */
describe('No orphan after stop, on Windows', () => {
  test.skip('taskkill /T /F ends the tree after the grace: not verified on this machine', () => {
    expect(process.platform).toBe('win32')
  })
})
