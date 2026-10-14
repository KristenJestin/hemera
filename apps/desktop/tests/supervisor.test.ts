/**
 * The process supervisor: whatever Hemera starts, it stops as a whole tree, on Windows too, and
 * nothing outlives the engine, even one that crashed.
 *
 * The children are real `node` processes running scripts this suite writes into a temporary
 * folder, and a process is gone when the system says so (`process.kill(pid, 0)` failing), never
 * because a `stop` returned. The registry is the data folder's own table. Only what a left-over
 * pid runs is answered by the suite, as the system says it: the real query (PowerShell on
 * Windows, slow on a loaded runner) has a test of its own, under a wider bound.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Effect, Fiber, Layer } from 'effect'
import type { Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  HostProcesses,
  ProcessRegistry,
  ProcessSupervisor,
  SpawnFailed,
  StderrSink,
  WINDOWS_COMMAND_LINE_MS,
  databaseRegistryLayer,
  hostProcessesLayer,
  machineCommandLines,
  outputOf,
  processSupervisorLayer,
  stillRuns,
} from '../src/engine/supervisor.ts'
import { type Storage, endChild, on, removeFolders, temporaryFolder } from './storage.ts'
import { opened } from './workspace-engine.ts'

const onWindows = process.platform === 'win32'

let folder: string
let data: string
let scripts = 0
const strays: ChildProcess[] = []
/**
 * What the machine says each process this suite left running runs, as the system would say it:
 * the supervisor's lookup is answered from here, never by PowerShell, which may take up to
 * `WINDOWS_COMMAND_LINE_MS` on a loaded runner (one test below asks the real machine, alone).
 */
const lines = new Map<number, string>()
/**
 * How long the real query of the machine may take in this suite: a PowerShell on a loaded Windows
 * runner was seen past the engine's `WINDOWS_COMMAND_LINE_MS` (20 s); this is six times that, and
 * more than ten times the few seconds it takes on an idle machine.
 */
const MACHINE_QUERY_MS = 120_000
/** Processes a test leaves behind on purpose, ended after it. */
const strayPids: number[] = []

beforeEach(async () => {
  folder = temporaryFolder('supervisor')
  data = temporaryFolder('supervisor-data')
  await opened(data)
})

afterEach(async () => {
  lines.clear()
  await Promise.all(strays.splice(0).map(endChild))
  const left = strayPids.splice(0).filter(alive)
  for (const pid of left) process.kill(pid, 'SIGKILL')
  // Not children of this process: gone is what the system says.
  await allGone(left)
  await removeFolders()
})

function script(body: string): string {
  scripts += 1
  const path = join(folder, `script-${String(scripts)}.mjs`)
  writeFileSync(path, body)
  return path
}

/** Keeps a script up on a timer of its own, never on its input. */
const STAYS_UP = 'setInterval(() => {}, 1000)\n'

/**
 * A child that starts a grandchild, which starts a great-grandchild: a tree of three, each pid
 * written down. Neither the child nor its descendants end when their input closes.
 */
const TREE_OF_THREE = `
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const [, , where, depth] = process.argv
appendFileSync(where, String(process.pid) + '\\n')
if (Number(depth) > 1) {
  spawn(process.execPath, [process.argv[1], where, String(Number(depth) - 1)], {
    stdio: 'ignore',
    windowsHide: true,
  })
}
${STAYS_UP}`

const REFUSES_TO_DIE = `
import { writeFileSync } from 'node:fs'
process.on('SIGTERM', () => {})
writeFileSync(process.argv[2], 'ready\\n')
${STAYS_UP}`

const WRITES_ON_STDERR = `
process.stderr.write('a tool said something\\n')
process.stderr.write('and something else\\n')
${STAYS_UP}`

const ENDS_WHEN_INPUT_ENDS = `
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
${STAYS_UP}`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function untilTrue(check: () => boolean, milliseconds: number): Promise<boolean> {
  const deadline = Date.now() + milliseconds
  const tick = async (): Promise<boolean> => {
    if (check()) return true
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
    return tick()
  }
  return tick()
}

/** Whether every pid is gone, each within its own wait. */
const allGone = async (pids: ReadonlyArray<number>) =>
  (await Promise.all(pids.map((pid) => goneWithin(pid)))).every(Boolean)

const goneWithin = async (pid: number, milliseconds = 10_000) => {
  // `process.kill(-1, 0)` signals every process of the user and succeeds: never wait on it.
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${String(pid)} is not a pid`)
  return untilTrue(() => !alive(pid), milliseconds)
}

/** The pids a tree wrote, once it wrote `count` of them. */
async function pidsIn(path: string, count: number): Promise<number[]> {
  let pids: number[] = []
  await untilTrue(() => {
    try {
      pids = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(Number)
    } catch {
      pids = []
    }
    return pids.length >= count
  }, 10_000)
  return pids
}

/** A process a previous engine left running, its command line answered as the system says it. */
function leftRunning(args: ReadonlyArray<string>, options: { readonly detached?: boolean } = {}) {
  const child = spawn(process.execPath, [...args], {
    detached: options.detached ?? !onWindows,
    stdio: 'ignore',
    windowsHide: true,
  })
  strays.push(child)
  lines.set(child.pid ?? -1, child.spawnargs.join(' '))
  return child
}

/** What a run of the supervisor saw: the sink's lines, and the trees `taskkill` was asked for. */
interface Seen {
  readonly sink: string[]
  readonly killedTrees: number[]
}

/**
 * The supervisor over the real machine, a sink and a spy on the tree kills, on `data`. With
 * `killLandsAfter`, a tree kill answers at once and only lands that many milliseconds later: a
 * `taskkill` that returns before the process has exited; with `NEVER`, it never lands (a `taskkill`
 * that hung past its bound, or whose `/F` was refused). What a pid runs is answered from `lines`;
 * with `lineUnknown`, the machine cannot say what any pid runs: a PowerShell that did not answer in
 * time.
 */
function supervised(seen: Seen, killLandsAfter?: number, lineUnknown = false) {
  const host = Layer.effect(
    HostProcesses,
    Effect.gen(function* () {
      const real = yield* HostProcesses
      return {
        ...real,
        commandLinesOf: (pids: ReadonlyArray<number>) =>
          Effect.succeed(
            new Map(
              lineUnknown
                ? []
                : pids.flatMap((pid) => {
                    const line = lines.get(pid)
                    return line === undefined ? [] : [[pid, line] as const]
                  }),
            ),
          ),
        killTree: (pid: number, grouped: boolean) =>
          Effect.andThen(
            Effect.sync(() => seen.killedTrees.push(pid)),
            killLandsAfter === undefined
              ? real.killTree(pid, grouped)
              : Effect.sync(() => {
                  if (Number.isFinite(killLandsAfter))
                    setTimeout(() => Effect.runFork(real.killTree(pid, grouped)), killLandsAfter)
                }),
          ),
      }
    }),
  ).pipe(Layer.provide(hostProcessesLayer))
  const sink = Layer.succeed(StderrSink, {
    write: (line) => Effect.sync(() => seen.sink.push(line)),
  })
  const layer = processSupervisorLayer.pipe(
    Layer.provideMerge(databaseRegistryLayer),
    Layer.provideMerge(Layer.merge(host, sink)),
  )
  return <A, E>(
    program: Effect.Effect<A, E, ProcessSupervisor | ProcessRegistry | Storage | Scope.Scope>,
  ): Promise<A> => on(data, Effect.provide(program, layer))
}

const freshSeen = (): Seen => ({ sink: [], killedTrees: [] })

/** A tree kill that is asked and never lands. */
const NEVER = Number.POSITIVE_INFINITY

const owner = { kind: 'run', id: 'run-1' } as const

const starting = (path: string, args: ReadonlyArray<string>, graceMillis = 500) =>
  ProcessSupervisor.use((supervisor) =>
    supervisor.start(process.execPath, [path, ...args], { owner, graceMillis }),
  )

describe('A stop ends the whole tree', () => {
  test('a child, its grandchild and its great-grandchild are all gone after a stop', async () => {
    const seen = freshSeen()
    const where = join(folder, 'tree.pids')
    const tree = script(TREE_OF_THREE)

    const pids = await supervised(seen)(
      Effect.gen(function* () {
        const child = yield* starting(tree, [where, '3'])
        const written = yield* Effect.promise(() => pidsIn(where, 3))
        expect(written.every(alive)).toBe(true)
        expect(written[0]).toBe(child.pid)
        yield* child.stop
        return written
      }),
    )

    expect(pids).toHaveLength(3)
    expect(await allGone(pids)).toBe(true)
    if (onWindows) {
      // No group to signal: the grace passed, and `taskkill /T /F` took the tree down.
      expect(seen.killedTrees).toEqual([pids[0]])
    } else {
      // The group carried the SIGTERM to every member: no escalation was needed.
      expect(seen.killedTrees).toEqual([])
      expect(seen.sink.some((line) => line.endsWith('ended with SIGTERM'))).toBe(true)
    }
  })

  test.skipIf(onWindows)(
    'a child that ignores SIGTERM is killed once the grace expires',
    async () => {
      const seen = freshSeen()
      const ready = join(folder, 'ready')
      const stubborn = script(REFUSES_TO_DIE)

      const [pid, spent, signal] = await supervised(seen)(
        Effect.gen(function* () {
          const child = yield* starting(stubborn, [ready], 300)
          yield* Effect.promise(() => untilTrue(() => alive(child.pid) && readable(ready), 5_000))
          const from = Date.now()
          yield* child.stop
          const observation = yield* child.exited
          return [child.pid, Date.now() - from, observation.signal] as const
        }),
      )

      expect(await goneWithin(pid)).toBe(true)
      expect(spent).toBeGreaterThanOrEqual(300)
      expect(signal).toBe('SIGKILL')
    },
  )

  test('nothing started survives the scope closing, grandchildren included', async () => {
    const seen = freshSeen()
    const where = join(folder, 'tree.pids')
    const tree = script(TREE_OF_THREE)

    const pids = await supervised(seen)(
      Effect.gen(function* () {
        yield* starting(tree, [where, '2'])
        return yield* Effect.promise(() => pidsIn(where, 2))
      }),
    )

    expect(pids).toHaveLength(2)
    expect(await allGone(pids)).toBe(true)
  })

  test('a child that ends by itself is seen to end with its code', async () => {
    const seen = freshSeen()
    const ends = script(ENDS_WHEN_INPUT_ENDS)

    const observation = await supervised(seen)(
      Effect.gen(function* () {
        const child = yield* starting(ends, [])
        yield* child.closeInput
        return yield* child.exited
      }),
    )

    expect(observation.code).toBe(0)
    expect(observation.signal).toBeNull()
  })
})

const readable = (path: string): boolean => {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

describe('Standard error is never swallowed', () => {
  test('it reaches the diagnostic sink and a listener alike', async () => {
    const seen = freshSeen()
    const loud = script(WRITES_ON_STDERR)
    const heard: string[] = []

    await supervised(seen)(
      Effect.gen(function* () {
        const child = yield* starting(loud, [])
        child.onStderr((line) => heard.push(line))
        yield* Effect.promise(() => untilTrue(() => heard.length >= 2, 5_000))
        yield* child.stop
      }),
    )

    expect(heard).toEqual(['a tool said something', 'and something else'])
    expect(seen.sink.some((line) => line.endsWith(': a tool said something'))).toBe(true)
    expect(seen.sink.some((line) => line.endsWith(': and something else'))).toBe(true)
  })

  test('a program that is not there is refused, naming it', async () => {
    const absent = join(folder, 'not-here')
    const failure = await supervised(freshSeen())(
      Effect.flip(ProcessSupervisor.use((supervisor) => supervisor.start(absent, [], { owner }))),
    )
    expect(failure).toBeInstanceOf(SpawnFailed)
    expect(failure.program).toBe(absent)
    expect(failure.message).toContain(absent)
  })
})

describe('A child started elsewhere is under the same policy', () => {
  test('it is stopped by its pid: its input closed, the grace, then its tree', async () => {
    const seen = freshSeen()
    const where = join(folder, 'tree.pids')
    const tree = script(TREE_OF_THREE)
    const forked = spawn(process.execPath, [tree, where, '2'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    })
    strays.push(forked)
    const pids = await pidsIn(where, 2)
    // Forked outside a group of its own: on POSIX only the root is the supervisor's to end.
    strayPids.push(...pids)

    await supervised(seen)(
      Effect.gen(function* () {
        const supervisor = yield* ProcessSupervisor
        const child = yield* supervisor.adopt(
          {
            pid: forked.pid ?? -1,
            program: process.execPath,
            args: [tree, where, '2'],
            closeInput: Effect.sync(() => forked.stdin?.end()),
            exited: Effect.callback((resume) => {
              forked.once('exit', (code, signal) =>
                resume(Effect.succeed({ code, signal, when: new Date().toISOString() })),
              )
            }),
          },
          { owner, graceMillis: 300 },
        )
        yield* child.stop
      }),
    )

    expect(await goneWithin(pids[0] ?? -1)).toBe(true)
    if (onWindows) {
      expect(seen.killedTrees).toEqual([pids[0]])
      expect(await allGone(pids)).toBe(true)
    }
  })
})

describe('The registry outlives a crash', () => {
  test('a root is registered while it runs and forgotten once it ends', async () => {
    const seen = freshSeen()
    const ends = script(ENDS_WHEN_INPUT_ENDS)

    const [during, after] = await supervised(seen)(
      Effect.gen(function* () {
        const child = yield* starting(ends, [])
        const registry = yield* ProcessRegistry
        const registered = yield* registry.leftBy('run', 'another engine')
        yield* child.closeInput
        yield* child.exited
        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
        return [registered, yield* registry.leftBy('run', 'another engine')] as const
      }),
    )

    expect(during).toEqual([
      expect.objectContaining({ program: process.execPath, args: [ends], owner }),
    ])
    expect(after).toEqual([])
  })

  test("a previous engine's root still alive is ended as a tree; a pid now another program's is not touched", async () => {
    const seen = freshSeen()
    const where = join(folder, 'tree.pids')
    const tree = script(TREE_OF_THREE)
    const other = script(STAYS_UP)
    // What a crashed engine left: a tree it started in a group of its own, still running.
    const left = leftRunning([tree, where, '2'])
    // And a pid it registered that another program holds now.
    const stranger = leftRunning([other], { detached: false })
    const pids = await pidsIn(where, 2)

    const orphans = await supervised(seen)(
      Effect.gen(function* () {
        const registry = yield* ProcessRegistry
        yield* registry.add({
          id: 'left',
          pid: left.pid ?? -1,
          program: process.execPath,
          args: [tree, where, '2'],
          owner: { kind: 'run', id: 'run-left' },
          engine: 'crashed',
        })
        yield* registry.add({
          id: 'reused',
          pid: stranger.pid ?? -1,
          program: process.execPath,
          args: [join(folder, 'what-was-started.mjs')],
          owner: { kind: 'run', id: 'run-reused' },
          engine: 'crashed',
        })
        yield* registry.add({
          id: 'session',
          pid: stranger.pid ?? -1,
          program: process.execPath,
          args: [other],
          owner: { kind: 'session', id: 's1' },
          engine: 'crashed',
        })
        const supervisor = yield* ProcessSupervisor
        const ended = yield* supervisor.endOrphans('run')
        const remaining = yield* registry.leftBy('session', supervisor.engine)
        return { orphans: ended, remaining }
      }),
    )

    expect(await allGone(pids)).toBe(true)
    expect(alive(stranger.pid ?? -1)).toBe(true)
    expect(orphans.orphans.map((one) => [one.root.owner.id, one.ended]).toSorted()).toEqual([
      ['run-left', true],
      ['run-reused', false],
    ])
    // The agents' orphans are the session supervisor's to end: left in the registry for it.
    expect(orphans.remaining.map((one) => one.id)).toEqual(['session'])
  })
  test('an orphan is said ended only once it is gone, even when the kill answers before it exits', async () => {
    const seen = freshSeen()
    const left = leftRunning([script(STAYS_UP)])
    const pid = left.pid ?? -1

    const [orphans, aliveWhenSaid, said] = await supervised(
      seen,
      300,
    )(
      Effect.gen(function* () {
        const registry = yield* ProcessRegistry
        yield* registry.add({
          id: 'left',
          pid,
          program: process.execPath,
          args: left.spawnargs.slice(1),
          owner: { kind: 'run', id: 'run-left' },
          engine: 'crashed',
        })
        const ended = yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('run'))
        return [ended, alive(pid), [...seen.sink]] as const
      }),
    )

    expect(orphans.map((one) => one.ended)).toEqual([true])
    expect(said).toEqual([expect.stringContaining(`(${String(pid)})`)])
    expect(aliveWhenSaid).toBe(false)
  })
  test('an orphan its kill did not end is kept for the next start, which ends it', async () => {
    const seen = freshSeen()
    const left = leftRunning([script(STAYS_UP)])
    const pid = left.pid ?? -1
    const leftNow = ProcessRegistry.use((registry) => registry.leftBy('run', 'another engine'))

    // A start whose kill does not end it: the pid is said alive, and not forgotten.
    const survived = await supervised(
      seen,
      NEVER,
    )(
      Effect.gen(function* () {
        yield* ProcessRegistry.use((registry) =>
          registry.add({
            id: 'left',
            pid,
            program: process.execPath,
            args: left.spawnargs.slice(1),
            owner: { kind: 'run', id: 'run-left' },
            engine: 'crashed',
          }),
        )
        const orphans = yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('run'))
        return { orphans, kept: yield* leftNow }
      }),
    )
    expect(survived.orphans.map((one) => one.ended)).toEqual([false])
    expect(survived.kept.map((one) => one.id)).toEqual(['left'])
    expect(seen.killedTrees).toEqual([pid])
    expect(alive(pid)).toBe(true)
    expect(seen.sink).toEqual([
      expect.stringContaining(`kept ${basename(process.execPath)} (${String(pid)})`),
    ])

    // The next start's kill lands: the orphan is ended, then forgotten.
    const known = await supervised(freshSeen())(
      Effect.gen(function* () {
        const orphans = yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('run'))
        return { orphans, kept: yield* leftNow }
      }),
    )
    expect(known.orphans.map((one) => one.ended)).toEqual([true])
    expect(known.kept).toEqual([])
    expect(alive(pid)).toBe(false)
  })
  test('a live orphan whose command line is unknown is kept for the next start, which ends it', async () => {
    const seen = freshSeen()
    const left = leftRunning([script(STAYS_UP)])
    const pid = left.pid ?? -1
    const root = {
      id: 'left',
      pid,
      program: process.execPath,
      args: left.spawnargs.slice(1),
      owner: { kind: 'run', id: 'run-left' },
      engine: 'crashed',
    } as const
    const leftNow = ProcessRegistry.use((registry) => registry.leftBy('run', 'another engine'))

    // A start whose machine cannot say what the pid runs: the pid is not touched, nor forgotten.
    const unknown = await supervised(
      seen,
      undefined,
      true,
    )(
      Effect.gen(function* () {
        yield* ProcessRegistry.use((registry) => registry.add(root))
        const orphans = yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('run'))
        return { orphans, kept: yield* leftNow }
      }),
    )
    expect(unknown.orphans.map((one) => one.ended)).toEqual([false])
    expect(unknown.kept.map((one) => one.id)).toEqual(['left'])
    expect(seen.killedTrees).toEqual([])
    expect(alive(pid)).toBe(true)
    expect(seen.sink).toEqual([
      expect.stringContaining(`kept ${basename(process.execPath)} (${String(pid)})`),
    ])

    // The next start can say it: the orphan is ended, then forgotten.
    const known = await supervised(seen)(
      Effect.gen(function* () {
        const orphans = yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('run'))
        return { orphans, kept: yield* leftNow }
      }),
    )
    expect(known.orphans.map((one) => one.ended)).toEqual([true])
    expect(known.kept).toEqual([])
    expect(alive(pid)).toBe(false)
  })
})

describe('The start does not wait on the left-over agents one after another', () => {
  test('three orphans whose lookups each take the worst case are handled in about one worst case', async () => {
    // Three pids alive, whose lookup never answers: on Windows, a PowerShell past its bound.
    const pids = [90_001, 90_002, 90_003]
    const host = Layer.effect(
      HostProcesses,
      Effect.gen(function* () {
        const real = yield* HostProcesses
        return {
          ...real,
          alive: (pid: number) => pids.includes(pid),
          commandLinesOf: () => Effect.never,
          killTree: () => Effect.void,
        }
      }),
    ).pipe(Layer.provide(hostProcessesLayer))
    const layer = processSupervisorLayer.pipe(
      Layer.provideMerge(databaseRegistryLayer),
      Layer.provideMerge(
        Layer.merge(host, Layer.succeed(StderrSink, { write: () => Effect.void })),
      ),
    )

    const [settled, orphans] = await on(
      data,
      Effect.gen(function* () {
        const registry = yield* ProcessRegistry
        for (const pid of pids) {
          yield* registry.add({
            id: `left-${String(pid)}`,
            pid,
            program: process.execPath,
            args: ['agent.mjs'],
            owner: { kind: 'session', id: `s-${String(pid)}` },
            engine: 'crashed',
          })
        }
        const sweep = yield* ProcessSupervisor.use((supervisor) =>
          supervisor.endOrphans('session'),
        ).pipe(Effect.forkChild)
        // One worst case of a lookup on the test clock: every orphan's bound passes at once.
        yield* TestClock.adjust(WINDOWS_COMMAND_LINE_MS)
        yield* Effect.yieldNow
        const done = sweep.pollUnsafe() !== undefined
        return [done, done ? yield* Fiber.join(sweep) : []] as const
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(settled).toBe(true)
    // Each orphan the bound cut is kept, as one whose command line is unknown.
    expect(orphans.map((one) => [one.root.pid, one.ended])).toEqual(pids.map((pid) => [pid, false]))
  })
})

describe('A command line that came too late is never decided on', () => {
  test('a lookup that answers past its bound leaves every living orphan kept and registered, nothing ended', async () => {
    // Alive, and the machine says they run what they were started with, but only once the bound
    // has passed: on Windows, a PowerShell slower than `WINDOWS_COMMAND_LINE_MS` on a loaded machine.
    const pids = [92_001, 92_002]
    const killed: number[] = []
    const host = Layer.effect(
      HostProcesses,
      Effect.gen(function* () {
        const real = yield* HostProcesses
        return {
          ...real,
          alive: (pid: number) => pids.includes(pid),
          commandLinesOf: (wanted: ReadonlyArray<number>) =>
            Effect.succeed(
              new Map(wanted.map((pid) => [pid, `${process.execPath} agent.mjs`] as const)),
            ).pipe(Effect.delay(WINDOWS_COMMAND_LINE_MS * 2)),
          killTree: (pid: number) => Effect.sync(() => killed.push(pid)),
        }
      }),
    ).pipe(Layer.provide(hostProcessesLayer))
    const layer = processSupervisorLayer.pipe(
      Layer.provideMerge(databaseRegistryLayer),
      Layer.provideMerge(
        Layer.merge(host, Layer.succeed(StderrSink, { write: () => Effect.void })),
      ),
    )

    const [orphans, kept, registered] = await on(
      data,
      Effect.gen(function* () {
        const registry = yield* ProcessRegistry
        for (const pid of pids) {
          yield* registry.add({
            id: `left-${String(pid)}`,
            pid,
            program: process.execPath,
            args: ['agent.mjs'],
            owner: { kind: 'session', id: `s-${String(pid)}` },
            engine: 'crashed',
          })
        }
        const supervisor = yield* ProcessSupervisor
        const sweep = yield* supervisor.endOrphans('session').pipe(Effect.forkChild)
        // The bound passes first, then the late answer.
        yield* TestClock.adjust(WINDOWS_COMMAND_LINE_MS * 2)
        return [
          yield* Fiber.join(sweep),
          yield* supervisor.kept,
          yield* registry.leftBy('session', supervisor.engine),
        ] as const
      }).pipe(Effect.provide(layer), Effect.provide(TestClock.layer())),
    )

    expect(orphans.map((one) => [one.root.pid, one.ended])).toEqual(pids.map((pid) => [pid, false]))
    expect(kept.map((root) => root.pid).toSorted()).toEqual(pids)
    expect(registered.map((root) => root.pid).toSorted()).toEqual(pids)
    expect(killed).toEqual([])
  })

  test(
    'a lookup cut by its bound says nothing, not even the lines it had printed',
    async () => {
      // A query that printed one whole line and half of the next, then never ended: what it
      // printed is not an answer, since the half line would read as another program.
      const where = join(folder, 'printed')
      const printsHalf = script(`
import { writeFileSync } from 'node:fs'
process.stdout.write('4242 node agent.mjs\\n4243 node age', () => {
  writeFileSync(process.argv[2], 'printed')
})
${STAYS_UP}`)
      const said = await Effect.runPromise(
        Effect.gen(function* () {
          const lookup = yield* outputOf(
            process.execPath,
            [printsHalf, where],
            WINDOWS_COMMAND_LINE_MS,
          ).pipe(Effect.forkChild)
          yield* Effect.promise(() => untilTrue(() => readable(where), 30_000))
          yield* TestClock.adjust(WINDOWS_COMMAND_LINE_MS)
          return yield* Fiber.join(lookup)
        }).pipe(Effect.provide(TestClock.layer())),
      )

      expect(said).toBe(null)
    },
    WINDOWS_COMMAND_LINE_MS + 40_000,
  )
})

describe('The machine is asked once for every left-over agent', () => {
  test('many orphans are looked up in one query of the machine, and each is ended', async () => {
    const pids = Array.from({ length: 10 }, (_, index) => 91_000 + index)
    const living = new Set(pids)
    const asked: Array<ReadonlyArray<number>> = []
    const host = Layer.effect(
      HostProcesses,
      Effect.gen(function* () {
        const real = yield* HostProcesses
        return {
          ...real,
          alive: (pid: number) => living.has(pid),
          commandLinesOf: (wanted: ReadonlyArray<number>) =>
            Effect.sync(() => {
              asked.push(wanted)
              return new Map(wanted.map((pid) => [pid, `${process.execPath} agent.mjs`]))
            }),
          killTree: (pid: number) => Effect.sync(() => living.delete(pid)),
        }
      }),
    ).pipe(Layer.provide(hostProcessesLayer))
    const layer = processSupervisorLayer.pipe(
      Layer.provideMerge(databaseRegistryLayer),
      Layer.provideMerge(
        Layer.merge(host, Layer.succeed(StderrSink, { write: () => Effect.void })),
      ),
    )

    const orphans = await on(
      data,
      Effect.gen(function* () {
        const registry = yield* ProcessRegistry
        for (const pid of pids) {
          yield* registry.add({
            id: `left-${String(pid)}`,
            pid,
            program: process.execPath,
            args: ['agent.mjs'],
            owner: { kind: 'session', id: `s-${String(pid)}` },
            engine: 'crashed',
          })
        }
        return yield* ProcessSupervisor.use((supervisor) => supervisor.endOrphans('session'))
      }).pipe(Effect.provide(layer)),
    )

    expect(asked.map((one) => one.toSorted())).toEqual([pids])
    expect(orphans.every((one) => one.ended)).toBe(true)
  })

  describe('a lookup that is over', () => {
    // The program says its pid first and hangs after it. The test waits for that pid before it
    // ends the lookup, however long Node took to start: a pid never read is a failure, not a pid.
    const hangsAfterItsPid = () =>
      script(`
import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], String(process.pid))
${STAYS_UP}`)

    test('a lookup cut by its bound ends the program it started', async () => {
      const where = join(folder, 'lookup.pid')
      const hangs = hangsAfterItsPid()
      const [said, pids] = await Effect.runPromise(
        Effect.gen(function* () {
          const lookup = yield* outputOf(
            process.execPath,
            [hangs, where],
            WINDOWS_COMMAND_LINE_MS,
          ).pipe(Effect.forkChild)
          const written = yield* Effect.promise(() => pidsIn(where, 1))
          yield* TestClock.adjust(WINDOWS_COMMAND_LINE_MS)
          return [yield* Fiber.join(lookup), written] as const
        }).pipe(Effect.provide(TestClock.layer())),
      )

      expect(said).toBe(null)
      expect(pids).toHaveLength(1)
      expect(await goneWithin(pids[0] ?? -1)).toBe(true)
    }, 30_000)

    test('a lookup given up on by the one waiting ends the program it started', async () => {
      const where = join(folder, 'lookup.pid')
      const hangs = hangsAfterItsPid()
      const pids = await Effect.runPromise(
        Effect.gen(function* () {
          const lookup = yield* outputOf(
            process.execPath,
            [hangs, where],
            WINDOWS_COMMAND_LINE_MS,
          ).pipe(Effect.forkChild)
          const written = yield* Effect.promise(() => pidsIn(where, 1))
          yield* Fiber.interrupt(lookup)
          return written
        }),
      )

      expect(pids).toHaveLength(1)
      expect(await goneWithin(pids[0] ?? -1)).toBe(true)
    }, 30_000)
  })

  test('a pid that is not a positive integer is refused, never signalled', async () => {
    // `process.kill(-1, 0)` reaches every process of the user: waiting on it never ends.
    const refused = [-1, 0, 1.5, Number.NaN].map((pid) =>
      expect(goneWithin(pid)).rejects.toThrow('not a pid'),
    )
    await Promise.all(refused)
  })
})

describe('A kept agent is followed until it is ended or gone', () => {
  test('a kept orphan is listed while it runs, and dropped once it is gone', async () => {
    const left = leftRunning([script(STAYS_UP)])
    const pid = left.pid ?? -1

    const [whileRunning, afterGone, registered] = await supervised(
      freshSeen(),
      undefined,
      true,
    )(
      Effect.gen(function* () {
        yield* ProcessRegistry.use((registry) =>
          registry.add({
            id: 'left',
            pid,
            program: process.execPath,
            args: left.spawnargs.slice(1),
            owner: { kind: 'session', id: 's1' },
            engine: 'crashed',
          }),
        )
        const supervisor = yield* ProcessSupervisor
        yield* supervisor.endOrphans('session')
        const kept = yield* supervisor.kept
        // It ends by itself, without Hemera: the next start would only forget it.
        process.kill(pid, 'SIGKILL')
        yield* Effect.promise(() => goneWithin(pid))
        yield* Effect.promise(() =>
          untilTrue(() => Effect.runSync(supervisor.kept).length === 0, 10_000),
        )
        return [
          kept,
          yield* supervisor.kept,
          yield* ProcessRegistry.use((registry) => registry.leftBy('session', supervisor.engine)),
        ] as const
      }),
    )

    expect(whileRunning.map((root) => [root.pid, root.owner])).toEqual([
      [pid, { kind: 'session', id: 's1' }],
    ])
    expect(afterGone).toEqual([])
    expect(registered).toEqual([])
  })
})

describe('The machine says what a pid runs', () => {
  test(
    'living processes are matched by what the system says they run, in one query',
    async () => {
      const one = leftRunning([script(STAYS_UP), '--flag'])
      const other = leftRunning([script(STAYS_UP), 'two words'])
      const gone = leftRunning([script('')])
      await goneWithin(gone.pid ?? -1)
      // The engine's own query, under a bound wide enough for a loaded runner: past the engine's
      // bound, its answer is unknown, and what the engine does then has tests of its own above.
      const said = await Effect.runPromise(
        machineCommandLines([one.pid ?? -1, other.pid ?? -1, gone.pid ?? -1], MACHINE_QUERY_MS),
      )
      for (const child of [one, other]) {
        expect(
          stillRuns(
            { program: process.execPath, args: child.spawnargs.slice(1) },
            said.get(child.pid ?? -1) ?? '',
            process.platform,
          ),
        ).toBe(true)
      }
      expect(said.has(gone.pid ?? -1)).toBe(false)
    },
    MACHINE_QUERY_MS + 10_000,
  )
})

describe('A command line is matched before anything is ended', () => {
  test('on Linux, the words started, whole', () => {
    const root = { program: 'node', args: ['/w/server.mjs', '--port', '4000'] }
    expect(stillRuns(root, 'node /w/server.mjs --port 4000', 'linux')).toBe(true)
    expect(stillRuns(root, 'node /w/other.mjs', 'linux')).toBe(false)
  })

  test("on Windows, the system's own quoting and the program's full path", () => {
    const root = {
      program: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\w\\node_modules\\.bin\\vite.cmd ^"--port^" ^"4000^""'],
    }
    expect(
      stillRuns(
        root,
        'C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\w\\node_modules\\.bin\\vite.cmd ^"--port^" ^"4000^"""',
        'win32',
      ),
    ).toBe(true)
    expect(stillRuns(root, '"C:\\Program Files\\Other\\other.exe" --flag', 'win32')).toBe(false)
  })
})
