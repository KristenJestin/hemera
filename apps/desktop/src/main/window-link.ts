/**
 * What main answers the window: the engine's calls, forwarded, and its own.
 *
 * A forwarded call is a call in flight on both links: a window that goes away interrupts it in
 * main, which interrupts it in the engine, and an engine that dies fails it in main with
 * `EngineGone`, which reaches the window as such. Nothing waits on a clock.
 */

import {
  ApplicationRpcs,
  closedAs,
  EngineGone,
  EngineRpcs,
  streamClosedAs,
  type EnvironmentReport,
} from '@hemera/ipc'
import type { Effect } from 'effect'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { observed, observedStream, type Log } from './diagnostic.ts'

export const WindowRpcs = EngineRpcs.merge(ApplicationRpcs)

export type EngineClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof EngineRpcs>,
  RpcClientError.RpcClientError
>

/** What main does itself when the window asks. */
export interface Application {
  readonly report: Effect.Effect<EnvironmentReport>
  readonly relaunch: Effect.Effect<void>
}

const gone = () => new EngineGone()

export const windowHandlers = (engine: EngineClient, application: Application, log: Log) =>
  WindowRpcs.toLayer({
    'engine.status': () =>
      engine['engine.status']().pipe(closedAs(gone), observed('engine.status', log)),
    'engine.statusChanges': () =>
      engine['engine.statusChanges']().pipe(
        streamClosedAs(gone),
        observedStream('engine.statusChanges', log),
      ),
    'environment.report': () => application.report.pipe(observed('environment.report', log)),
    'application.relaunch': () => application.relaunch.pipe(observed('application.relaunch', log)),
  })
