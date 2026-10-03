/**
 * The end-to-end suite's handle on the engine, put on `globalThis.hemeraProbe` when the suite
 * runs headless and never otherwise. The suite reaches it from main with
 * `browser.electron.execute`; each method answers a promise of plain values.
 */

import { fromMessagePortMain, makeClientProtocol } from '@hemera/ipc'
import { Cause, Effect, Exit, Option, Predicate, Stream } from 'effect'
import type { Scope } from 'effect'
import { RpcClient } from 'effect/rpc'
import { app } from 'electron/main'
import type { MessagePortMain, UtilityProcess } from 'electron/main'

import { ProbeRpcs } from '../engine/probe.ts'
import type { HemeraProbe, LoadMeasure } from './probe-types.ts'
import type { WindowPorts } from './window-ports.ts'

export const installProbe = (
  port: MessagePortMain,
  engine: UtilityProcess,
  windows: WindowPorts,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(ProbeRpcs).pipe(
      Effect.provideServiceEffect(
        RpcClient.Protocol,
        makeClientProtocol(fromMessagePortMain(port), 'the engine'),
      ),
    )
    const lines: string[] = []
    let outcome: Promise<string> = Promise.resolve('no agents’ process was started')

    const probe: HemeraProbe = {
      enginePid: () => engine.pid,
      closeWindowLinks: () => windows.closeAll(),
      crashEngine: () => {
        Effect.runFork(client['probe.crash']())
      },
      startAgents: (program, input) =>
        new Promise((resolve, reject) => {
          const run = Stream.runForEach(client['probe.agents']({ program, input }), (event) =>
            Effect.sync(() =>
              Predicate.isTagged(event, 'Pid') ? resolve(event.pid) : lines.push(event.line),
            ),
          )
          outcome = Effect.runPromiseExit(run).then((exit) => {
            if (Exit.isSuccess(exit)) return 'ended'
            const failure = Cause.findErrorOption(exit.cause)
            const said = Option.isSome(failure) ? failure.value.message : Cause.pretty(exit.cause)
            reject(new Error(said))
            return said
          })
        }),
      agentsOutcome: async () => ({ ended: await outcome, lines }),
      load: (count, size) => {
        const metrics = () =>
          app.getAppMetrics().find((metric) => metric.pid === engine.pid)?.memory.workingSetSize ??
          0
        const before = { main: process.memoryUsage().rss, engine: metrics() }
        const started = performance.now()
        let received = 0
        return Effect.runPromise(
          Stream.runForEach(client['probe.load']({ count, size }), () =>
            Effect.sync(() => {
              received += 1
            }),
          ),
        ).then((): LoadMeasure => ({
          items: received,
          millis: performance.now() - started,
          mainRssBefore: before.main,
          mainRssAfter: process.memoryUsage().rss,
          engineWorkingSetBeforeKb: before.engine,
          engineWorkingSetAfterKb: metrics(),
        }))
      },
    }
    globalThis.hemeraProbe = probe
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        globalThis.hemeraProbe = undefined
      }),
    )
  })
