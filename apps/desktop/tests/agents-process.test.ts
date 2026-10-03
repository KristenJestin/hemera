/**
 * The agents' process, outside Electron: the program runs in a worker with real pipes, and the
 * engine's side of the port reads its lines and writes to it. Electron's own fork is the
 * end-to-end suite's.
 */

import { join } from 'node:path'
import { MessageChannel } from 'node:worker_threads'

import {
  AgentsProcessGone,
  AgentsRpcs,
  closedAs,
  Diagnostic,
  fromMessagePort,
  makeClientProtocol,
  Output,
  streamClosedAs,
} from '@hemera/ipc'
import { Effect, Fiber, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import { runProgram } from '../src/agents/program.ts'

const ECHO = join(import.meta.dirname, 'fixtures', 'echo.mjs')

const gone = () => new AgentsProcessGone()

/** The engine's side of a port whose other end runs the echo program. */
const echo = Effect.gen(function* () {
  const { port1: enginePort, port2: agentsPort } = new MessageChannel()
  const exited = yield* Effect.forkScoped(runProgram(fromMessagePort(agentsPort), ECHO, []))
  const protocol = yield* makeClientProtocol(fromMessagePort(enginePort), 'the agents’ process')
  const client = yield* RpcClient.make(AgentsRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )
  const write = (line: string) => client['agent.write']({ line }).pipe(closedAs(gone))
  const output = client['agent.output']().pipe(streamClosedAs(gone))
  return { client, write, output, exited, agentsPort }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(body))

describe('The agents’ process', () => {
  test('lines written to the program come back whole and in order', () =>
    run(
      Effect.gen(function* () {
        const { write, output } = yield* echo
        const read = yield* Effect.forkChild(Stream.runCollect(Stream.take(output, 3)))
        yield* write('first')
        yield* write('pieces cut in the middle')
        yield* write('last')
        expect(yield* Fiber.join(read)).toEqual([
          Output.make({ line: 'first' }),
          Output.make({ line: 'cut in the middle' }),
          Output.make({ line: 'last' }),
        ])
      }),
    ))

  test('what the program writes on its error output arrives as a diagnostic', () =>
    run(
      Effect.gen(function* () {
        const { write, output } = yield* echo
        const read = yield* Effect.forkChild(Stream.runCollect(Stream.take(output, 1)))
        yield* write('complain something went wrong')
        expect(yield* Fiber.join(read)).toEqual([Diagnostic.make({ line: 'something went wrong' })])
      }),
    ))

  test('the program ends with its own exit code', () =>
    run(
      Effect.gen(function* () {
        const { write, exited } = yield* echo
        yield* write('exit 3')
        expect(yield* Fiber.join(exited)).toBe(3)
      }),
    ))

  test('ending its input ends the program', () =>
    run(
      Effect.gen(function* () {
        const { client, exited } = yield* echo
        yield* client['agent.end']()
        expect(yield* Fiber.join(exited)).toBe(0)
      }),
    ))

  test('a dead agents’ process ends the output stream with AgentsProcessGone', () =>
    run(
      Effect.gen(function* () {
        const { output, write, agentsPort } = yield* echo
        const read = yield* Effect.forkChild(Stream.runCollect(output))
        yield* write('hello')
        yield* Effect.sleep(50)
        agentsPort.close()
        expect(yield* Effect.flip(Fiber.join(read))).toBeInstanceOf(AgentsProcessGone)
      }),
    ))
})
