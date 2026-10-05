/**
 * What an agents' process does with the program it was started for.
 *
 * A utility process has no standard input (`stdin` may only be ignored), and an agent speaks
 * over its standard input and output. So the program runs in a worker thread of this process,
 * which Node does give three real pipes, and this file serves those pipes to the engine over the
 * port main handed over: lines in, whole lines and diagnostics out. Nothing of what the program
 * says is read here.
 */

import type { Readable } from 'node:stream'
import { Worker } from 'node:worker_threads'

import {
  AgentsRpcs,
  Diagnostic,
  makeServerProtocol,
  Output,
  type AgentLine,
  type Port,
} from '@hemera/ipc'
import { Cause, Deferred, Effect, Queue, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcServer } from 'effect/rpc'

/**
 * The next piece a pipe holds, waiting for one if it is empty, and `Done` once it has ended.
 *
 * Read on demand rather than as it arrives, so a program writing faster than the engine reads
 * waits on its own pipe; and the wait is interruptible, so a stream the engine stops ends at once
 * instead of at the program's next write.
 */
const nextPiece = (readable: Readable): Effect.Effect<string, Cause.Done> =>
  Effect.callback<string, Cause.Done>((resume) => {
    const attempt = (): void => {
      const piece: string | null = readable.read()
      if (piece !== null) return settle(Effect.succeed(piece))
      if (readable.readableEnded || readable.destroyed) settle(Cause.done())
    }
    const settle = (outcome: Effect.Effect<string, Cause.Done>): void => {
      stop()
      resume(outcome)
    }
    const stop = (): void => {
      readable.off('readable', attempt)
      readable.off('end', attempt)
      readable.off('close', attempt)
    }
    readable.on('readable', attempt)
    readable.on('end', attempt)
    readable.on('close', attempt)
    attempt()
    return Effect.sync(stop)
  })

/**
 * Whole lines, and never the pieces a pipe cut them into: a line handed over in two halves is two
 * messages the engine cannot read.
 */
const linesOf = (readable: Readable): Stream.Stream<string> =>
  Stream.splitLines(Stream.fromEffectRepeat(nextPiece(readable.setEncoding('utf8'))))

/**
 * Runs `program` with `args` in a worker, in `environment`, and serves it over `port` until it
 * ends, with the code it ended with.
 */
export const runProgram = (
  port: Port,
  program: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): Effect.Effect<number, never, Scope.Scope> =>
  Effect.gen(function* () {
    const worker = new Worker(program, {
      argv: [...args],
      env: environment,
      stdin: true,
      stdout: true,
      stderr: true,
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => worker.terminate()))

    const exited = Deferred.makeUnsafe<number>()
    worker.on('exit', (code) => {
      Deferred.doneUnsafe(exited, Effect.succeed(code))
    })
    // A program that cannot even be loaded says so here and nowhere else.
    const failures = yield* Queue.unbounded<AgentLine>()
    worker.on('error', (failed) => {
      Queue.offerUnsafe(failures, Diagnostic.make({ line: failed.message }))
    })

    const output = Stream.mergeAll(
      [
        Stream.map(linesOf(worker.stdout), (line): AgentLine => Output.make({ line })),
        Stream.map(linesOf(worker.stderr), (line): AgentLine => Diagnostic.make({ line })),
        Stream.fromQueue(failures),
      ],
      { concurrency: 'unbounded' },
    )

    const handlers = AgentsRpcs.toLayer({
      'agent.output': () => output,
      'agent.write': ({ line }) =>
        Effect.callback<void>((resume) => {
          worker.stdin?.write(`${line}\n`, () => resume(Effect.void))
        }),
      'agent.end': () => Effect.sync(() => void worker.stdin?.end()),
    })

    const server = yield* makeServerProtocol
    server.accept(port)
    yield* RpcServer.make(AgentsRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    return yield* Deferred.await(exited)
  })
