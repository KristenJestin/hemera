/**
 * The Profile at the engine's start, and the calls on it the engine serves.
 *
 * The start runs in this order: a staged restore is applied, the database is opened, the
 * migrations are applied, the opening is written down (`profile.opened`), a pending
 * reconciliation runs with the automation gate closed until it ends, and only then are the calls
 * served. A database that cannot be opened is not a crash: the engine still serves, its status
 * says why in a sentence the window shows, and every call on the Profile is refused with it.
 */

import { join } from 'node:path'

import {
  type AutomaticBackups,
  DatabaseOpen,
  DatabaseRefused,
  type DatabaseStatus,
  type Preferences,
  type PreferencesChange,
  type Reconciliation,
  RestoreRefused,
  StorageFailed,
} from '@hemera/ipc'
import { Context, Effect, Layer, Predicate, Result, Stream, SubscriptionRef } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../main/diagnostic.ts'
import { automaticBackups, backupFoldersLayer, writeBackup } from './backup.ts'
import { domainEventsLayer } from './domain-events.ts'
import { AutomationGate, automationGateLayer } from './gate.ts'
import { DATABASE_FILE, openProfile } from './migrate.ts'
import { readPreferences, writePreferences } from './preferences.ts'
import { ProfileHome } from './profile-home.ts'
import {
  type LiveMissions,
  type RestoreJournal,
  noLiveMissions,
  noRestoreJournal,
  pendingRestore,
  reconcile,
  reconciliationStepsLayer,
  recordProfileEvent,
  type ReconciliationStep,
} from './reconciliation.ts'
import { applyStagedRestore, clearStagedRestore, stageRestore } from './restore.ts'
import { type AskBeforeRunning, nobodyToAskLayer } from './ask-before-running.ts'
import { runAtOpen } from './at-open.ts'
import { gitLayer } from './git.ts'
import { resumeInterrupted } from './preparation.ts'
import { repositoryStatusesLayer } from './repositories.ts'
import {
  type RunServices,
  type RunsSettings,
  recoverRuns,
  runsEndWithEngine,
  runsLayer,
  runsRecipeRunnerLayer,
} from './runs.ts'
import { DatabaseError, databaseLayer, refusedWhile } from './storage/database.ts'
import { supervisorLayer } from './supervisor.ts'
import { type WorkspaceServices, preparationsLayer } from './workspaces.ts'

/** The calls on the Profile, with the errors a screen is shown. */
export interface ProfileCalls {
  readonly readPreferences: Effect.Effect<Preferences, StorageFailed>
  readonly writePreferences: (change: PreferencesChange) => Effect.Effect<void, StorageFailed>
  readonly backups: Effect.Effect<AutomaticBackups, StorageFailed>
  /** Writes a backup into `folder`; answers the backup folder written. */
  readonly backup: (folder: string) => Effect.Effect<string, StorageFailed>
  /** Stages the restore of the backup folder `folder` for the next start. */
  readonly restore: (folder: string) => Effect.Effect<void, StorageFailed | RestoreRefused>
}

/** What the later tickets plug into the Profile: the folders backed up, the steps, the ports. */
export interface ProfileParts {
  readonly backupFolders: ReadonlyArray<string>
  readonly reconciliationSteps: ReadonlyArray<ReconciliationStep>
  readonly liveMissions?: Layer.Layer<LiveMissions>
  readonly restoreJournal?: Layer.Layer<RestoreJournal>
  /** Who is asked before a command marked so runs; until the permission needs exist, no one. */
  readonly askBeforeRunning?: Layer.Layer<AskBeforeRunning>
  /** How runs wait for an address and give a process its grace; the defaults otherwise. */
  readonly runs?: Partial<RunsSettings>
}

/** What the calls on the Profile stand on: the Projects, their Workspaces and their runs. */
export type EngineServices = WorkspaceServices | RunServices

export interface ProfileStart {
  readonly dataFolder: string
  readonly version: string
  readonly migrations: string
}

export interface StartedProfile {
  readonly calls: ProfileCalls
  readonly database: SubscriptionRef.SubscriptionRef<DatabaseStatus>
  /** The gate every automation passes; closed for good when the database was refused. */
  readonly gate: Effect.Effect<void>
  /**
   * Runs a call on the Projects, their repositories and their Workspaces, the data folder's
   * refusal said as a sentence; refused at once when the database was.
   */
  readonly use: <A, E>(
    effect: Effect.Effect<A, E, EngineServices>,
  ) => Effect.Effect<A, Exclude<E, DatabaseError> | StorageFailed>
  /** The same, for what is followed for as long as the caller listens. */
  readonly follow: <A, E>(
    stream: Stream.Stream<A, E, EngineServices>,
  ) => Stream.Stream<A, Exclude<E, DatabaseError> | StorageFailed>
  /**
   * The window is shown: the commands marked "at open" run, once per engine, in the background,
   * once automations may run. Answers at once.
   */
  readonly windowShown: Effect.Effect<void>
}

const said = <E>(failure: E): string =>
  failure instanceof Error && failure.message !== '' ? failure.message : String(failure)

const refusedProfile = (sentence: string): Effect.Effect<StartedProfile, never, Scope.Scope> =>
  Effect.gen(function* () {
    const failed = Effect.fail(new StorageFailed({ sentence }))
    return {
      calls: {
        readPreferences: failed,
        writePreferences: () => failed,
        backups: failed,
        backup: () => failed,
        restore: () => failed,
      },
      database: yield* SubscriptionRef.make<DatabaseStatus>(DatabaseRefused.make({ sentence })),
      gate: Effect.never,
      use: () => failed,
      follow: () => Stream.fail(new StorageFailed({ sentence })),
      windowShown: Effect.void,
    }
  })

export const startProfile = (
  start: ProfileStart,
  parts: ProfileParts,
  log: Log,
): Effect.Effect<StartedProfile, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { dataFolder, version } = start
    const file = join(dataFolder, DATABASE_FILE)

    let restored
    try {
      restored = applyStagedRestore(dataFolder)
    } catch (cause) {
      log(`the staged restore could not be applied: ${said(cause)}`)
      return yield* refusedProfile(
        `The backup could not be restored into the data folder: ${said(cause)}`,
      )
    }
    if (restored !== null) log(`restored the backup taken at ${restored.takenAt}`)

    const profileLayers = Layer.mergeAll(
      databaseLayer(file),
      domainEventsLayer,
      automationGateLayer,
      backupFoldersLayer(parts.backupFolders),
      reconciliationStepsLayer(parts.reconciliationSteps),
      parts.liveMissions ?? noLiveMissions,
      parts.restoreJournal ?? noRestoreJournal,
      Layer.succeed(ProfileHome, start),
      gitLayer(),
      repositoryStatusesLayer,
      preparationsLayer(log),
    )
    // The commands: the supervisor (its registry in the database, its children's standard error
    // in the diagnostic), the runs, the "ask before running" port, and the recipe's runner on them.
    const layers = runsRecipeRunnerLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          supervisorLayer(log),
          runsLayer(log, parts.runs),
          parts.askBeforeRunning ?? nobodyToAskLayer(log),
        ),
      ),
      Layer.provideMerge(profileLayers),
    )
    const opened = yield* Layer.build(layers).pipe(
      Effect.flatMap((context) =>
        openProfile(dataFolder, start.migrations, version).pipe(
          Effect.provide(context),
          Effect.map((standing) => ({ context, standing })),
        ),
      ),
      // Whatever the database or the driver throws is a data folder that was not opened, said as
      // such, rather than an engine that dies before it serves anything.
      Effect.catchDefect((defect) => Effect.fail(refusedWhile('opening it')(defect))),
      Effect.result,
    )
    if (Result.isFailure(opened)) {
      log(`the database ${file} was not opened: ${said(opened.failure)}`)
      return yield* refusedProfile(opened.failure.message)
    }
    const { context, standing } = opened.success
    log(`opened the database ${file} at ${standing.lastMigration ?? 'no migration'}`)
    if (standing.backedUp !== null) log(`backed the database up into ${standing.backedUp}`)
    if (standing.behind.length > 0) log(`migrated it with ${standing.behind.join(', ')}`)

    const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layers>>) =>
      Effect.provide(effect, context)
    const gate = Context.get(context, AutomationGate)

    let reconciliation: Reconciliation = 'none'
    const databaseNow = (): DatabaseStatus =>
      DatabaseOpen.make({
        lastMigration: standing.lastMigration,
        writtenByVersion: version,
        backups: automaticBackups(dataFolder),
        reconciliation,
      })
    const database = yield* SubscriptionRef.make(databaseNow())
    /** Says where the Profile stands now, the backups counted again. */
    const publish = (now: Reconciliation = reconciliation) =>
      Effect.suspend(() => {
        reconciliation = now
        return SubscriptionRef.set(database, databaseNow())
      })

    if (restored !== null) {
      yield* run(
        recordProfileEvent('profile.restored', {
          takenAt: restored.takenAt,
          version: restored.hemeraVersion,
        }),
      ).pipe(Effect.orDie)
      clearStagedRestore(dataFolder)
    }

    const pending = yield* run(pendingRestore).pipe(Effect.orDie)
    if (pending === null) {
      yield* gate.open
    } else {
      yield* publish('running')
      log('reconciling the restored Profile; automations wait until it ends')
      yield* run(reconcile(pending, log)).pipe(
        Effect.matchEffect({
          onFailure: () => publish('failed'),
          onSuccess: () => Effect.andThen(gate.open, publish('none')),
        }),
        Effect.forkScoped,
      )
    }

    // What a stopped engine left running is ended and marked interrupted before anything starts;
    // what is still going when this engine ends is written stopped.
    yield* run(recoverRuns).pipe(
      Effect.tap((interrupted) =>
        interrupted.length === 0
          ? Effect.void
          : Effect.sync(() => log(`interrupted the runs ${interrupted.join(', ')}`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`the runs a stopped engine left were not ended: ${said(refusal)}`)),
      ),
    )
    yield* Effect.addFinalizer(() => run(runsEndWithEngine))

    // A preparation a stopped engine interrupted carries on once automations may run.
    yield* gate.pass.pipe(
      Effect.andThen(run(resumeInterrupted)),
      Effect.tap((resumed) =>
        resumed.length === 0
          ? Effect.void
          : Effect.sync(() => log(`resumed the preparation of ${resumed.join(', ')}`)),
      ),
      Effect.catch((refusal) =>
        Effect.sync(() => log(`interrupted preparations were not resumed: ${said(refusal)}`)),
      ),
      Effect.forkScoped,
    )

    const storageFailed = <E>(failure: E) => new StorageFailed({ sentence: said(failure) })

    const calls: ProfileCalls = {
      readPreferences: run(readPreferences).pipe(Effect.mapError(storageFailed)),
      writePreferences: (change) =>
        run(writePreferences(change)).pipe(Effect.mapError(storageFailed)),
      backups: Effect.sync(() => automaticBackups(dataFolder)),
      backup: (folder) =>
        run(writeBackup(folder, 'hemera-backup')).pipe(Effect.mapError(storageFailed)),
      restore: (folder) =>
        run(stageRestore(folder)).pipe(
          Effect.mapError((failure) =>
            Predicate.isTagged(failure, 'RestoreRefusal')
              ? new RestoreRefused({ sentence: failure.message })
              : storageFailed(failure),
          ),
          Effect.ensuring(publish()),
        ),
    }

    /** The data folder's refusal as a sentence; any other refusal as itself. */
    const sentenced = <E>(failure: E): Exclude<E, DatabaseError> | StorageFailed => {
      if (failure instanceof DatabaseError) return storageFailed(failure)
      // SAFETY: the line above took every DatabaseError; what is left is the rest of E.
      return failure as Exclude<E, DatabaseError>
    }
    const scope = yield* Effect.scope
    let shown = false
    const windowShown = Effect.suspend(() => {
      if (shown) return Effect.void
      shown = true
      return gate.pass.pipe(
        Effect.andThen(run(runAtOpen)),
        Effect.tap((started) =>
          Effect.sync(() => log(`ran ${String(started.length)} command(s) at open`)),
        ),
        Effect.catch((refusal) =>
          Effect.sync(() => log(`the commands at open were not run: ${said(refusal)}`)),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      )
    })
    return {
      calls,
      database,
      gate: gate.pass,
      use: (effect) => Effect.mapError(run(effect), sentenced),
      follow: (stream) => Stream.mapError(Stream.provideContext(stream, context), sentenced),
      windowShown,
    }
  })
