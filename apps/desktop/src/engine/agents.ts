/**
 * The engine's side of an agents' process: it asks main to start one for a program, takes the
 * port main hands over for that launch, and speaks to the program over it.
 *
 * The engine never forks anything itself. A process that ends, for whatever reason, ends its
 * streams with `AgentsProcessGone` and its exit code is written down.
 */

import {
  AgentsProcessGone,
  AgentsRpcs,
  closedAs,
  closesWith,
  LaunchFailed,
  makeClientProtocol,
  streamClosedAs,
  type AgentLine,
  type Port,
} from '@hemera/ipc'
import { Deferred, Effect, FiberSet, Match, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import type { RpcClientError, RpcGroup } from 'effect/rpc'

import type { Log } from '../main/diagnostic.ts'
import type { Handovers } from './handovers.ts'
import type { HostRpcs } from '@hemera/ipc'

export type HostClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof HostRpcs>,
  RpcClientError.RpcClientError
>

export interface AgentsProcess {
  readonly pid: number
  /** Every line the program writes, until it ends. */
  readonly output: Stream.Stream<AgentLine, AgentsProcessGone>
  readonly write: (line: string) => Effect.Effect<void, AgentsProcessGone>
  /** Ends the program's input. */
  readonly end: Effect.Effect<void, AgentsProcessGone>
  /** The code the process ended with, once it has. */
  readonly exited: Effect.Effect<number>
}

const gone = () => new AgentsProcessGone()

/** Starts agents' processes through main, numbering each launch so its port finds it. */
export const agentsLauncher = <P>(
  host: HostClient,
  handovers: Handovers<P>,
  toPort: (port: P) => Port,
  log: Log,
) => {
  let launches = 0
  return (
    program: string,
    args: ReadonlyArray<string>,
  ): Effect.Effect<AgentsProcess, LaunchFailed, Scope.Scope> =>
    Effect.gen(function* () {
      const launch = launches
      launches += 1
      const runFork = yield* FiberSet.makeRuntime<never, void, never>()
      const started = yield* Deferred.make<number, LaunchFailed>()
      const exited = yield* Deferred.make<number>()

      yield* host['agents.launch']({ launch, program, args }).pipe(
        Stream.runForEach((event) =>
          Match.value(event).pipe(
            Match.tagsExhaustive({
              Started: ({ pid }) => Deferred.succeed(started, pid),
              Exited: ({ code }) =>
                Effect.gen(function* () {
                  log(`agents' process for ${program} exited with code ${String(code)}`)
                  yield* Deferred.fail(
                    started,
                    new LaunchFailed({
                      reason: `it ended with code ${String(code)} before it ran`,
                    }),
                  )
                  yield* Deferred.succeed(exited, code)
                }),
            }),
          ),
        ),
        closedAs(() => new LaunchFailed({ reason: 'main closed the link' })),
        Effect.catch((failed) => Deferred.fail(started, failed)),
        Effect.forkScoped,
      )

      const pid = yield* Deferred.await(started)
      const port = yield* handovers.take(launch)
      const protocol = yield* makeClientProtocol(
        closesWith(toPort(port), (close) => {
          runFork(Effect.andThen(Deferred.await(exited), Effect.sync(close)))
        }),
        `the agents' process for ${program}`,
      )
      const client = yield* RpcClient.make(AgentsRpcs).pipe(
        Effect.provideService(RpcClient.Protocol, protocol),
      )
      return {
        pid,
        output: client['agent.output']().pipe(streamClosedAs(gone)),
        write: (line) => client['agent.write']({ line }).pipe(closedAs(gone)),
        end: client['agent.end']().pipe(closedAs(gone)),
        exited: Deferred.await(exited),
      }
    })
}
