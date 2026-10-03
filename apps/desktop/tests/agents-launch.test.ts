/**
 * How an agents' process is launched: main forks it for the engine and hands each of them one
 * end of a port, and the engine matches every port it is handed to the launch it asked for.
 * Electron is replaced by a stand-in that records what main did; the real fork is the end-to-end
 * suite's.
 */

import { MessageChannel } from 'node:worker_threads'

import {
  Exited,
  fromMessagePort,
  HostRpcs,
  LaunchFailed,
  makeClientProtocol,
  makeServerProtocol,
  Started,
  type LaunchEvent,
} from '@hemera/ipc'
import { Effect, Fiber, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import { launchHandlers, type Forked, type Launcher } from '../src/main/launches.ts'
import { portHandovers } from '../src/engine/handovers.ts'

/** A forked process that does what the test tells it to, and remembers what it was given. */
interface StandIn extends Forked<string> {
  spawn: () => void
  exit: (code: number) => void
  given: string[]
  killed: boolean
}

const standIn = (pid: number): StandIn => {
  const spawned: Array<() => void> = []
  const exited: Array<(code: number) => void> = []
  const self: StandIn = {
    pid,
    given: [],
    killed: false,
    onSpawn: (listener) => spawned.push(listener),
    onExit: (listener) => exited.push(listener),
    give: (port) => self.given.push(port),
    kill: () => {
      self.killed = true
    },
    spawn: () => {
      for (const listener of spawned) listener()
    },
    exit: (code) => {
      for (const listener of exited) listener(code)
    },
  }
  return self
}

const host = (forks: Array<StandIn | Error>) =>
  Effect.gen(function* () {
    const handedToEngine: Array<{ launch: number; port: string }> = []
    const asked: Array<{ program: string; args: ReadonlyArray<string> }> = []
    let channels = 0
    const launcher: Launcher<string> = {
      fork: (program, args) => {
        asked.push({ program, args })
        const next = forks.shift()
        if (next === undefined || next instanceof Error) throw next ?? new Error('no stand-in')
        return next
      },
      channel: () => {
        channels += 1
        return [`process end ${channels}`, `engine end ${channels}`]
      },
      handOver: (launch, port) => handedToEngine.push({ launch, port }),
    }
    const lines: string[] = []
    const { port1: enginePort, port2: mainPort } = new MessageChannel()
    const server = yield* makeServerProtocol
    server.accept(fromMessagePort(mainPort))
    yield* RpcServer.make(HostRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(launchHandlers(launcher, (line) => lines.push(line))),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    const protocol = yield* makeClientProtocol(fromMessagePort(enginePort), 'main')
    const client = yield* RpcClient.make(HostRpcs).pipe(
      Effect.provideService(RpcClient.Protocol, protocol),
    )
    return { client, handedToEngine, asked, lines }
  })

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

describe('Main launches an agents’ process for the engine', () => {
  test('it reports the pid once started, then the exit code, and the launch ends', () =>
    run(
      Effect.gen(function* () {
        const child = standIn(4242)
        const { client, asked } = yield* host([child])
        const events = yield* Effect.forkChild(
          Stream.runCollect(
            client['agents.launch']({ launch: 7, program: '/echo.mjs', args: ['-v'] }),
          ),
        )
        yield* Effect.sleep(10)
        child.spawn()
        yield* Effect.sleep(10)
        child.exit(3)
        expect(yield* Fiber.join(events)).toEqual<LaunchEvent[]>([
          Started.make({ pid: 4242 }),
          Exited.make({ code: 3 }),
        ])
        expect(asked).toEqual([{ program: '/echo.mjs', args: ['-v'] }])
      }),
    ))

  test('one end of a fresh port goes to the process, the other to the engine under its launch', () =>
    run(
      Effect.gen(function* () {
        const child = standIn(1)
        const { client, handedToEngine } = yield* host([child])
        yield* Effect.forkChild(
          Stream.runDrain(client['agents.launch']({ launch: 9, program: '/p', args: [] })),
        )
        yield* Effect.sleep(10)
        child.spawn()
        yield* Effect.sleep(10)
        expect(child.given).toEqual(['process end 1'])
        expect(handedToEngine).toEqual([{ launch: 9, port: 'engine end 1' }])
      }),
    ))

  test('a process that cannot be forked fails the launch with a sentence and is logged', () =>
    run(
      Effect.gen(function* () {
        const { client, lines } = yield* host([new Error('no such file')])
        const failure = yield* Effect.flip(
          Stream.runDrain(client['agents.launch']({ launch: 1, program: '/missing', args: [] })),
        )
        expect(failure).toBeInstanceOf(LaunchFailed)
        expect(failure).toMatchObject({ reason: 'no such file' })
        expect(lines.join('\n')).toContain('agents.launch')
      }),
    ))

  test('an engine that stops listening takes the process down with it', () =>
    run(
      Effect.gen(function* () {
        const child = standIn(5)
        const { client } = yield* host([child])
        const events = yield* Effect.forkChild(
          Stream.runDrain(client['agents.launch']({ launch: 2, program: '/p', args: [] })),
        )
        yield* Effect.sleep(10)
        child.spawn()
        yield* Effect.sleep(10)
        yield* Fiber.interrupt(events)
        yield* Effect.sleep(20)
        expect(child.killed).toBe(true)
      }),
    ))
})

describe('The engine matches each port it is handed to its launch', () => {
  test('ports handed over in any order reach the launch they belong to', () =>
    run(
      Effect.gen(function* () {
        const handovers = portHandovers<string>()
        const first = yield* Effect.forkChild(handovers.take(1))
        const second = yield* Effect.forkChild(handovers.take(2))
        handovers.receive(2, 'port of 2')
        handovers.receive(1, 'port of 1')
        expect(yield* Fiber.join(first)).toBe('port of 1')
        expect(yield* Fiber.join(second)).toBe('port of 2')
      }),
    ))

  test('a port handed over before the launch asks for it waits for it', () =>
    run(
      Effect.gen(function* () {
        const handovers = portHandovers<string>()
        handovers.receive(3, 'early port')
        expect(yield* handovers.take(3)).toBe('early port')
      }),
    ))

  test('a port is taken once', () =>
    run(
      Effect.gen(function* () {
        const handovers = portHandovers<string>()
        handovers.receive(4, 'only port')
        yield* handovers.take(4)
        const again = yield* Effect.forkChild(handovers.take(4))
        yield* Effect.sleep(10)
        expect(again.pollUnsafe()).toBeUndefined()
        yield* Fiber.interrupt(again)
      }),
    ))
})
