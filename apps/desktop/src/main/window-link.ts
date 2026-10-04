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
  type EngineMainRpcs,
  type EnvironmentReport,
  type Preferences,
  type PreferencesChange,
} from '@hemera/ipc'
import { Effect } from 'effect'
import type { RpcClient, RpcClientError, RpcGroup } from 'effect/rpc'

import { observed, observedStream, type Log } from './diagnostic.ts'

export type EngineClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof EngineMainRpcs>,
  RpcClientError.RpcClientError
>

/** What main does itself when the window asks. */
export interface Application {
  readonly report: Effect.Effect<EnvironmentReport>
  readonly relaunch: Effect.Effect<void>
  /** Shows the diagnostic log in the system's file manager. */
  readonly showLog: Effect.Effect<void>
  /** The system's own folder picker: the folder chosen, or null when none was. */
  readonly chooseFolder: Effect.Effect<string | null>
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

/** A restore staged by the engine, then the relaunch that applies it. */
export const restoreProfile =
  (engine: EngineClient, application: Application) => (folder: string) =>
    engine['profile.restore']({ folder }).pipe(closedAs(gone), Effect.andThen(application.relaunch))

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
    'profile.restore': ({ folder }) =>
      restoreProfile(engine, application)(folder).pipe(observed('profile.restore', log)),
    // The Projects and their repositories are the engine's alone: forwarded as they are.
    'projects.list': () =>
      engine['projects.list']().pipe(closedAs(gone), observed('projects.list', log)),
    'projects.get': (request) =>
      engine['projects.get'](request).pipe(closedAs(gone), observed('projects.get', log)),
    'projects.create': (request) =>
      engine['projects.create'](request).pipe(closedAs(gone), observed('projects.create', log)),
    'projects.update': (request) =>
      engine['projects.update'](request).pipe(closedAs(gone), observed('projects.update', log)),
    'projects.detectRepositories': (request) =>
      engine['projects.detectRepositories'](request).pipe(
        closedAs(gone),
        observed('projects.detectRepositories', log),
      ),
    'projects.setWorkspacesRoot': (request) =>
      engine['projects.setWorkspacesRoot'](request).pipe(
        closedAs(gone),
        observed('projects.setWorkspacesRoot', log),
      ),
    'projects.setBranchPrefix': (request) =>
      engine['projects.setBranchPrefix'](request).pipe(
        closedAs(gone),
        observed('projects.setBranchPrefix', log),
      ),
    'repositories.add': (request) =>
      engine['repositories.add'](request).pipe(closedAs(gone), observed('repositories.add', log)),
    'repositories.remove': (request) =>
      engine['repositories.remove'](request).pipe(
        closedAs(gone),
        observed('repositories.remove', log),
      ),
    'repositories.update': (request) =>
      engine['repositories.update'](request).pipe(
        closedAs(gone),
        observed('repositories.update', log),
      ),
    'repositories.status': (request) =>
      engine['repositories.status'](request).pipe(
        closedAs(gone),
        observed('repositories.status', log),
      ),
    'repositories.remotes': (request) =>
      engine['repositories.remotes'](request).pipe(
        closedAs(gone),
        observed('repositories.remotes', log),
      ),
    'repositories.setRemote': (request) =>
      engine['repositories.setRemote'](request).pipe(
        closedAs(gone),
        observed('repositories.setRemote', log),
      ),
    'repositories.setBaseBranch': (request) =>
      engine['repositories.setBaseBranch'](request).pipe(
        closedAs(gone),
        observed('repositories.setBaseBranch', log),
      ),
    'repositories.upToDateBase': (request) =>
      engine['repositories.upToDateBase'](request).pipe(
        closedAs(gone),
        observed('repositories.upToDateBase', log),
      ),
    'projects.changes': () =>
      engine['projects.changes']().pipe(
        streamClosedAs(gone),
        observedStream('projects.changes', log),
      ),
    'repositories.changes': () =>
      engine['repositories.changes']().pipe(
        streamClosedAs(gone),
        observedStream('repositories.changes', log),
      ),
    // The Workspaces, their recipe and their variables are the engine's alone: forwarded as they are.
    'workspaces.create': (request) =>
      engine['workspaces.create'](request).pipe(closedAs(gone), observed('workspaces.create', log)),
    'workspaces.get': (request) =>
      engine['workspaces.get'](request).pipe(closedAs(gone), observed('workspaces.get', log)),
    'workspaces.list': (request) =>
      engine['workspaces.list'](request).pipe(closedAs(gone), observed('workspaces.list', log)),
    'workspaces.status': (request) =>
      engine['workspaces.status'](request).pipe(closedAs(gone), observed('workspaces.status', log)),
    'workspaces.prepare': (request) =>
      engine['workspaces.prepare'](request).pipe(
        closedAs(gone),
        observed('workspaces.prepare', log),
      ),
    'workspaces.resume': (request) =>
      engine['workspaces.resume'](request).pipe(closedAs(gone), observed('workspaces.resume', log)),
    'workspaces.remove': (request) =>
      engine['workspaces.remove'](request).pipe(closedAs(gone), observed('workspaces.remove', log)),
    'workspaces.changes': () =>
      engine['workspaces.changes']().pipe(
        streamClosedAs(gone),
        observedStream('workspaces.changes', log),
      ),
    'recipe.get': (request) =>
      engine['recipe.get'](request).pipe(closedAs(gone), observed('recipe.get', log)),
    'recipe.save': (request) =>
      engine['recipe.save'](request).pipe(closedAs(gone), observed('recipe.save', log)),
    'recipe.check': (request) =>
      engine['recipe.check'](request).pipe(closedAs(gone), observed('recipe.check', log)),
    'variables.list': (request) =>
      engine['variables.list'](request).pipe(closedAs(gone), observed('variables.list', log)),
    'variables.set': (request) =>
      engine['variables.set'](request).pipe(closedAs(gone), observed('variables.set', log)),
    'variables.remove': (request) =>
      engine['variables.remove'](request).pipe(closedAs(gone), observed('variables.remove', log)),
    'variables.reveal': (request) =>
      engine['variables.reveal'](request).pipe(closedAs(gone), observed('variables.reveal', log)),
    // The commands and their runs are the engine's alone: forwarded as they are.
    'catalogue.list': (request) =>
      engine['catalogue.list'](request).pipe(closedAs(gone), observed('catalogue.list', log)),
    'catalogue.save': (request) =>
      engine['catalogue.save'](request).pipe(closedAs(gone), observed('catalogue.save', log)),
    'catalogue.remove': (request) =>
      engine['catalogue.remove'](request).pipe(closedAs(gone), observed('catalogue.remove', log)),
    'catalogue.checkLine': (request) =>
      engine['catalogue.checkLine'](request).pipe(
        closedAs(gone),
        observed('catalogue.checkLine', log),
      ),
    'runs.list': (request) =>
      engine['runs.list'](request).pipe(closedAs(gone), observed('runs.list', log)),
    'runs.start': (request) =>
      engine['runs.start'](request).pipe(closedAs(gone), observed('runs.start', log)),
    'runs.stop': (request) =>
      engine['runs.stop'](request).pipe(closedAs(gone), observed('runs.stop', log)),
    'runs.restart': (request) =>
      engine['runs.restart'](request).pipe(closedAs(gone), observed('runs.restart', log)),
    'runs.output': (request) =>
      engine['runs.output'](request).pipe(closedAs(gone), observed('runs.output', log)),
    'runs.changes': () =>
      engine['runs.changes']().pipe(streamClosedAs(gone), observedStream('runs.changes', log)),
    'environment.report': () => application.report.pipe(observed('environment.report', log)),
    'application.relaunch': () => application.relaunch.pipe(observed('application.relaunch', log)),
    'application.showLog': () => application.showLog.pipe(observed('application.showLog', log)),
    'application.chooseFolder': () =>
      application.chooseFolder.pipe(observed('application.chooseFolder', log)),
  })
