/**
 * Main as the launcher of the agents' processes, and as nothing else.
 *
 * The engine starts every agent, but a packaged Hemera has no Node to run a program with:
 * `process.execPath` is Electron and the `runAsNode` fuse is off. `utilityProcess.fork` runs a
 * script on Node without that fuse, and it exists in main alone. So the engine asks here, main
 * forks this application's own agents' process (never a program the engine names) with the
 * program as its argument, hands one end of a fresh port to it and the other to the engine, and
 * steps out: what the program says never crosses main.
 *
 * Electron is reached through `Launcher`, so the launch itself is tested without it.
 */

import { Exited, HostRpcs, LaunchFailed, Started, type LaunchEvent } from '@hemera/ipc'
import { Effect, Queue, Stream } from 'effect'

import type { Log } from './diagnostic.ts'

/** A forked agents' process, as much of it as a launch uses. */
export interface Forked<P> {
  readonly pid: number | undefined
  readonly onSpawn: (listener: () => void) => void
  readonly onExit: (listener: (code: number) => void) => void
  /** Posts this process its end of the port, before anything else reaches it. */
  readonly give: (port: P) => void
  readonly kill: () => void
}

export interface Launcher<P> {
  /** Forks the agents' process for `program`; throws when it cannot. */
  readonly fork: (program: string, args: ReadonlyArray<string>) => Forked<P>
  /** A fresh pair of joined ports: the process's end, then the engine's. */
  readonly channel: () => readonly [P, P]
  /** Posts the engine its end of the port of `launch`. */
  readonly handOver: (launch: number, port: P) => void
}

/** The answer to `agents.launch`: the launch's events, for as long as its process runs. */
export const launchHandlers = <P>(launcher: Launcher<P>, log: Log) =>
  HostRpcs.toLayer({
    'agents.launch': ({ launch, program, args }) =>
      Stream.callback<LaunchEvent, LaunchFailed>((events) =>
        Effect.gen(function* () {
          let forked: Forked<P>
          try {
            forked = launcher.fork(program, args)
          } catch (cause) {
            const reason = cause instanceof Error ? cause.message : String(cause)
            log(`agents.launch: ${program} was not started: ${reason}`)
            return yield* Queue.fail(events, new LaunchFailed({ reason }))
          }
          let running = true
          forked.onSpawn(() => {
            const [forProcess, forEngine] = launcher.channel()
            forked.give(forProcess)
            launcher.handOver(launch, forEngine)
            Queue.offerUnsafe(events, Started.make({ pid: forked.pid ?? -1 }))
          })
          forked.onExit((code) => {
            running = false
            if (code !== 0) log(`agents.launch: ${program} ended with code ${String(code)}`)
            Queue.offerUnsafe(events, Exited.make({ code }))
            Queue.endUnsafe(events)
          })
          // An engine that stops listening, or is gone, leaves no agent running behind it.
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (running) forked.kill()
            }),
          )
        }),
      ),
  })
