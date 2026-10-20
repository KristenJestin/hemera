/**
 * The ends the supervisor saw. A suite that asks whether a process it stopped is gone must not ask
 * the system about its pid: Windows gives a freed pid to the next process at once, so on a busy
 * machine the pid of a child that ended can already be another's. The host's own `exit` event
 * belongs to one child, whatever its pid becomes.
 */

import type { ChildProcess } from 'node:child_process'

import { Effect, Layer } from 'effect'

import { HostProcesses, type HostProcess, hostProcessesLayer } from '../src/engine/supervisor.ts'

/** The machine's processes, each start noted and each end seen. */
export const observedProcesses = () => {
  const started: Array<{ readonly child: HostProcess; ended: boolean }> = []
  const layer = Layer.effect(
    HostProcesses,
    Effect.gen(function* () {
      const machine = yield* HostProcesses
      return {
        ...machine,
        start: (...asked: Parameters<typeof machine.start>) => {
          const child = machine.start(...asked)
          const seen = { child, ended: false }
          // Before the supervisor's own listener: its stop returns after this one ran.
          child.onExit(() => {
            seen.ended = true
          })
          started.push(seen)
          return child
        },
      }
    }),
  ).pipe(Layer.provide(hostProcessesLayer))
  return {
    layer,
    /** Whether a child started under this pid was seen to end, and none of them is still there. */
    ended: (pid: number) => {
      const named = started.filter((seen) => seen.child.pid === pid)
      return named.length > 0 && named.every((seen) => seen.ended)
    },
  }
}

/** How long `ends` waits: a guard against a hang, which a child that ends takes no part of. */
const ENDS_WITHIN_MS = 10_000

/** A child the suite started itself, and its end by its own `exit` event. */
export const endOf = (child: ChildProcess) => {
  let ended = false
  const exited = new Promise<boolean>((resolve) => {
    child.once('exit', () => {
      ended = true
      resolve(true)
    })
  })
  return {
    /** Whether it has not ended yet: a process that runs has sent no `exit`. */
    stillRuns: () => !ended,
    /** Whether it ended, waiting for it. */
    ends: () =>
      Promise.race([
        exited,
        new Promise<boolean>((resolve) => setTimeout(resolve, ENDS_WITHIN_MS, false).unref()),
      ]),
  }
}
