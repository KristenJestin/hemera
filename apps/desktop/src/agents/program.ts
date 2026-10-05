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
import { Cause, Deferred, Effect, Predicate, Queue, Stream } from 'effect'
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
 * has ended and its output has been handed over, with the code it ended with.
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

    // A program that cannot even be loaded says so here and nowhere else.
    const failures = yield* Queue.unbounded<AgentLine, Cause.Done>()
    worker.on('error', (failed) => {
      Queue.offerUnsafe(failures, Diagnostic.make({ line: failed.message }))
    })

    /**
     * The program has ended and what it said has been handed over: every output call is
     * answered and nothing is left unread in its pipes, or the engine closed the port. Ending
     * sooner would interrupt the output on its way, and a program that says its line and exits
     * at once would be heard by no one.
     */
    const handedOver = Deferred.makeUnsafe<number>()
    const answering = new Set<string>()
    let code: number | undefined
    let engineGone = false
    const settle = (): void => {
      if (code === undefined) return
      const unread =
        worker.stdout.readableLength + worker.stderr.readableLength + Queue.sizeUnsafe(failures)
      if (engineGone || (answering.size === 0 && unread === 0)) {
        Deferred.doneUnsafe(handedOver, Effect.succeed(code))
      }
    }
    // The pipes have ended by now, and the load failure was told before: the output ends too.
    worker.on('exit', (exitCode) => {
      code = exitCode
      Queue.endUnsafe(failures)
      settle()
    })
    const served: Port = {
      post: (message) => {
        port.post(message)
        if (Predicate.isTagged(message, 'Exit') && answering.delete(String(message.requestId))) {
          settle()
        }
      },
      start: (onMessage, onClose) =>
        port.start(onMessage, () => {
          engineGone = true
          onClose()
          settle()
        }),
      close: () => port.close(),
    }

    const output = Stream.mergeAll(
      [
        Stream.map(linesOf(worker.stdout), (line): AgentLine => Output.make({ line })),
        Stream.map(linesOf(worker.stderr), (line): AgentLine => Diagnostic.make({ line })),
        Stream.fromQueue(failures),
      ],
      { concurrency: 'unbounded' },
    )

    const handlers = AgentsRpcs.toLayer({
      'agent.output': (_, { requestId }) => {
        answering.add(String(requestId))
        return output
      },
      'agent.write': ({ line }) =>
        Effect.callback<void>((resume) => {
          worker.stdin?.write(`${line}\n`, () => resume(Effect.void))
        }),
      'agent.end': () => Effect.sync(() => void worker.stdin?.end()),
    })

    const server = yield* makeServerProtocol
    server.accept(served)
    yield* RpcServer.make(AgentsRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    return yield* Deferred.await(handedOver)
  })
