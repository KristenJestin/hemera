/**
 * The whole path of an agents' process, outside Electron: the engine asks main over its link,
 * main "forks" (here, runs the agents' process in this one, on a Node port pair), the engine is
 * handed its end of the port and talks to the echo program through it.
 */

import { join } from 'node:path'
import { MessageChannel, type MessagePort } from 'node:worker_threads'

import {
  AgentsProcessGone,
  fromMessagePort,
  HostRpcs,
  makeClientProtocol,
  makeServerProtocol,
  Output,
} from '@hemera/ipc'
import { Effect, Fiber, FiberSet, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import { runProgram } from '../src/agents/program.ts'
import { agentsLauncher } from '../src/engine/agents.ts'
import { portHandovers } from '../src/engine/handovers.ts'
import { launchHandlers, type Forked, type Launcher } from '../src/main/launches.ts'

const ECHO = join(import.meta.dirname, 'fixtures', 'echo.mjs')

const setup = Effect.gen(function* () {
  const runFork = yield* FiberSet.makeRuntime<never, void, never>()
  const engineLines: string[] = []
  const handovers = portHandovers<MessagePort>()
  const killers: Array<() => void> = []
  let nextPid = 100

  /** An agents' process run in this one: `kill` closes its port and reports an exit. */
  const launcher: Launcher<MessagePort> = {
    fork: (program, args) => {
      const spawned: Array<() => void> = []
      const exited: Array<(code: number) => void> = []
      const exit = (code: number) => {
        for (const listener of exited) listener(code)
      }
      let given: MessagePort | undefined
      const forked: Forked<MessagePort> = {
        pid: nextPid++,
        onSpawn: (listener) => spawned.push(listener),
        onExit: (listener) => exited.push(listener),
        give: (port) => {
          given = port
          runFork(
            Effect.scoped(
              Effect.flatMap(runProgram(fromMessagePort(port), program, args), (code) =>
                Effect.sync(() => exit(code)),
              ),
            ),
          )
        },
        kill: () => {
          given?.close()
          exit(137)
        },
      }
      killers.push(forked.kill)
      setTimeout(() => {
        for (const listener of spawned) listener()
      }, 0)
      return forked
    },
    channel: () => {
      const { port1, port2 } = new MessageChannel()
      return [port1, port2]
    },
    handOver: (launch, port) => handovers.receive(launch, port),
  }

  const { port1: engineEnd, port2: mainEnd } = new MessageChannel()
  const server = yield* makeServerProtocol
  server.accept(fromMessagePort(mainEnd))
  yield* RpcServer.make(HostRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(launchHandlers(launcher, () => undefined)),
    Effect.provideService(RpcServer.Protocol, server.protocol),
    Effect.forkScoped,
  )
  const protocol = yield* makeClientProtocol(fromMessagePort(engineEnd), 'main')
  const host = yield* RpcClient.make(HostRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )
  const launch = agentsLauncher(host, handovers, fromMessagePort, (line) => engineLines.push(line))
  return { launch, engineLines, kill: () => killers[0]?.() }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

describe('The engine speaks to a program through an agents’ process main started', () => {
  test('the engine writes lines and reads them back, then sees the exit and its code', () =>
    run(
      Effect.gen(function* () {
        const { launch, engineLines } = yield* setup
        const agents = yield* launch(ECHO, [])
        expect(agents.pid).toBe(100)
        const read = yield* Effect.forkChild(Stream.runCollect(Stream.take(agents.output, 2)))
        yield* agents.write('hello')
        yield* agents.write('pieces in two')
        expect(yield* Fiber.join(read)).toEqual([
          Output.make({ line: 'hello' }),
          Output.make({ line: 'in two' }),
        ])
        yield* agents.write('exit 4')
        expect(yield* agents.exited).toBe(4)
        expect(engineLines).toContain(`agents' process for ${ECHO} exited with code 4`)
      }),
    ))

  test('a killed agents’ process ends its stream with AgentsProcessGone', () =>
    run(
      Effect.gen(function* () {
        const { launch, kill } = yield* setup
        const agents = yield* launch(ECHO, [])
        const read = yield* Effect.forkChild(Stream.runDrain(agents.output))
        yield* agents.write('hello')
        yield* Effect.sleep(50)
        kill()
        expect(yield* Effect.flip(Fiber.join(read))).toBeInstanceOf(AgentsProcessGone)
        expect(yield* agents.exited).toBe(137)
      }),
    ))
})
