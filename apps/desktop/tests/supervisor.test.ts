/**
 * The process supervisor: whatever Hemera starts, it stops as a whole tree, on Windows too, and
 * nothing outlives the engine, even one that crashed.
 *
 * Nothing is mocked: the children are real `node` processes running scripts this suite writes
 * into a temporary folder, and a process is gone when the system says so (`process.kill(pid, 0)`
 * failing), never because a `stop` returned. The registry is the data folder's own table.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  HostProcesses,
  ProcessRegistry,
  ProcessSupervisor,
  SpawnFailed,
  StderrSink,
  databaseRegistryLayer,
  hostProcessesLayer,
  processSupervisorLayer,
  stillRuns,
} from '../src/engine/supervisor.ts'
import { type Storage, on, removeFolders, temporaryFolder } from './storage.ts'
import { opened } from './workspace-engine.ts'

const onWindows = process.platform === 'win32'

let folder: string
let data: string
let scripts = 0
const strays: ChildProcess[] = []
/** Processes a test leaves behind on purpose, ended after it. */
const strayPids: number[] = []

beforeEach(async () => {
  folder = temporaryFolder('supervisor')
  data = temporaryFolder('supervisor-data')
  await opened(data)
})

afterEach(() => {
  for (const stray of strays.splice(0)) {
    if (stray.pid !== undefined && alive(stray.pid)) stray.kill('SIGKILL')
  }
  for (const pid of strayPids.splice(0)) if (alive(pid)) process.kill(pid, 'SIGKILL')
  removeFolders()
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

const goneWithin = (pid: number, milliseconds = 10_000) =>
  untilTrue(() => !alive(pid), milliseconds)

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

/** What a run of the supervisor saw: the sink's lines, and the trees `taskkill` was asked for. */
interface Seen {
  readonly sink: string[]
  readonly killedTrees: number[]
}

/** The supervisor over the real machine, a sink and a spy on the tree kills, on `data`. */
function supervised(seen: Seen) {
  const host = Layer.effect(
    HostProcesses,
    Effect.gen(function* () {
      const real = yield* HostProcesses
      return {
        ...real,
        killTree: (pid: number, grouped: boolean) =>
          Effect.andThen(
            Effect.sync(() => seen.killedTrees.push(pid)),
            real.killTree(pid, grouped),
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
    const left = spawn(process.execPath, [tree, where, '2'], {
      detached: !onWindows,
      stdio: 'ignore',
      windowsHide: true,
    })
    // And a pid it registered that another program holds now.
    const stranger = spawn(process.execPath, [other], { stdio: 'ignore', windowsHide: true })
    strays.push(left, stranger)
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
