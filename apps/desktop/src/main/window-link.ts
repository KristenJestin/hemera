/**
 * What main answers the window: the engine's calls, forwarded, and its own.
 *
 * A forwarded call is a call in flight on both links: a window that goes away interrupts it in
 * main, which interrupts it in the engine, and an engine that dies fails it in main with
 * `EngineGone`, which reaches the window as such. Nothing waits on a clock.
 *
 * The preferences pass through main on their way: whatever the engine answers of them is what
 * main paints the next start from (`display-sidecar.ts`) and the theme the window wears now.
 */

import {
  closedAs,
  EngineGone,
  streamClosedAs,
  WindowRpcs,
  type EngineRpcs,
  type EnvironmentReport,
  type Preferences,
  type PreferencesChange,
} from '@hemera/ipc'
import { Effect } from 'effect'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { observed, observedStream, type Log } from './diagnostic.ts'

export type EngineClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof EngineRpcs>,
  RpcClientError.RpcClientError
>

/** What main does itself when the window asks. */
export interface Application {
  readonly report: Effect.Effect<EnvironmentReport>
  readonly relaunch: Effect.Effect<void>
  /** The preferences the engine answered: worn now, and kept for the next start's first frame. */
  readonly display: (preferences: Preferences) => Effect.Effect<void>
}

const gone = () => new EngineGone()

/** The preferences as the engine has them, worn by main; a failure is left to the caller. */
export const refreshDisplay = (engine: EngineClient, application: Application) =>
  engine['preferences.read']().pipe(closedAs(gone), Effect.tap(application.display))

/** A change of the preferences, written by the engine, then worn by main. */
export const changePreferences =
  (engine: EngineClient, application: Application) => (change: PreferencesChange) =>
    engine['preferences.write'](change).pipe(
      closedAs(gone),
      Effect.andThen(refreshDisplay(engine, application)),
      Effect.asVoid,
    )

export const windowHandlers = (engine: EngineClient, application: Application, log: Log) =>
  WindowRpcs.toLayer({
    'engine.status': () =>
      engine['engine.status']().pipe(closedAs(gone), observed('engine.status', log)),
    'engine.statusChanges': () =>
      engine['engine.statusChanges']().pipe(
        streamClosedAs(gone),
        observedStream('engine.statusChanges', log),
      ),
    'preferences.read': () =>
      refreshDisplay(engine, application).pipe(observed('preferences.read', log)),
    'preferences.write': (change) =>
      changePreferences(engine, application)(change).pipe(observed('preferences.write', log)),
    'profile.backups': () =>
      engine['profile.backups']().pipe(closedAs(gone), observed('profile.backups', log)),
    'profile.backup': (request) =>
      engine['profile.backup'](request).pipe(closedAs(gone), observed('profile.backup', log)),
    // A restore takes effect at the next start: once the engine has staged it, Hemera relaunches.
    'profile.restore': (request) =>
      engine['profile.restore'](request).pipe(
        closedAs(gone),
        Effect.andThen(application.relaunch),
        observed('profile.restore', log),
      ),
    'environment.report': () => application.report.pipe(observed('environment.report', log)),
    'application.relaunch': () => application.relaunch.pipe(observed('application.relaunch', log)),
  })
