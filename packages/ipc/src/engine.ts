/**
 * The engine's domain: its start, its status, and the calls on the Profile it holds, the Projects,
 * their repositories, their Workspaces, their commands, their missions and the needs included,
 * and the coding agents with their state.
 * Served by the engine to main, and by main to the window, which forwards.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { AgentStatesRpcs } from './agent-states.ts'
import { EngineGone } from './gone.ts'
import {
  AutomaticBackups,
  DiagnosticsRetention,
  Preferences,
  PreferencesChange,
  RestoreRefused,
  StorageFailed,
} from './profile.ts'
import { CatalogueRpcs, RunsRpcs } from './commands.ts'
import { MemoryRpcs } from './memory.ts'
import { MissionsRpcs, NeedsRpcs } from './missions.ts'
import { NoticeFeedRpcs, NotificationSettingsRpcs } from './notifications.ts'
import { PermissionsRpcs } from './permissions.ts'
import { ProjectsRpcs, RepositoriesRpcs } from './projects.ts'
import { RecipeRpcs, VariablesRpcs, WorkspacesRpcs } from './workspaces.ts'

/** The channel a build of Hemera was made for; each one keeps a data folder of its own. */
export const Channel = Schema.Literals(['dev', 'beta', 'prod'])
export type Channel = typeof Channel.Type

/**
 * What main tells the engine when it starts it, posted once on the engine's own port with the
 * ports of its links. The engine reads nothing else before it serves.
 */
export const EngineStart = Schema.Struct({
  dataFolder: Schema.String,
  channel: Channel,
  version: Schema.String,
  /** The folder of the migrations this build carries. */
  migrations: Schema.String,
})
export type EngineStart = typeof EngineStart.Type

/** Whether a restored Profile is being reconciled with the world: never, now, or it failed. */
export const Reconciliation = Schema.Literals(['none', 'running', 'failed'])
export type Reconciliation = typeof Reconciliation.Type

/** The database is open: where it stands. */
export const DatabaseOpen = Schema.TaggedStruct('DatabaseOpen', {
  /** The last migration applied to it. */
  lastMigration: Schema.NullOr(Schema.String),
  /** The version of Hemera that opened the Profile last. */
  writtenByVersion: Schema.String,
  backups: AutomaticBackups,
  reconciliation: Reconciliation,
})

/** The database could not be opened at start; the sentence is what the window shows. */
export const DatabaseRefused = Schema.TaggedStruct('DatabaseRefused', {
  sentence: Schema.String,
})

export const DatabaseStatus = Schema.Union([DatabaseOpen, DatabaseRefused])
export type DatabaseStatus = typeof DatabaseStatus.Type

export const EngineStatus = Schema.Struct({
  ready: Schema.Boolean,
  version: Schema.String,
  channel: Channel,
  dataFolder: Schema.String,
  database: DatabaseStatus,
})
export type EngineStatus = typeof EngineStatus.Type

const ProfileFailed = Schema.Union([StorageFailed, EngineGone])

export const EngineRpcs = RpcGroup.make(
  Rpc.make('engine.status', { success: EngineStatus, error: EngineGone }),
  /** The current status, then every change of it, for as long as the caller listens. */
  Rpc.make('engine.statusChanges', { success: EngineStatus, error: EngineGone, stream: true }),
  Rpc.make('preferences.read', { success: Preferences, error: ProfileFailed }),
  /** Writes the keys the change names, each with its own schema. */
  Rpc.make('preferences.write', {
    payload: PreferencesChange,
    success: Schema.Void,
    error: ProfileFailed,
  }),
  /** The automatic backups of the data folder. */
  Rpc.make('profile.backups', { success: AutomaticBackups, error: ProfileFailed }),
  /** Writes a backup of the Profile into `folder`, and answers the backup folder it wrote. */
  Rpc.make('profile.backup', {
    payload: { folder: Schema.String },
    success: Schema.String,
    error: ProfileFailed,
  }),
  /** Where the diagnostics are kept, and the two constants of their rotation. */
  Rpc.make('diagnostics.retention', { success: DiagnosticsRetention, error: EngineGone }),
  /** Restores the backup folder `folder`, then relaunches Hemera. */
  Rpc.make('profile.restore', {
    payload: { folder: Schema.String },
    success: Schema.Void,
    error: Schema.Union([StorageFailed, RestoreRefused, EngineGone]),
  }),
).merge(
  ProjectsRpcs,
  RepositoriesRpcs,
  WorkspacesRpcs,
  RecipeRpcs,
  VariablesRpcs,
  CatalogueRpcs,
  RunsRpcs,
  MissionsRpcs,
  NeedsRpcs,
  MemoryRpcs,
  AgentStatesRpcs,
  NotificationSettingsRpcs,
  PermissionsRpcs,
)

/**
 * What the engine serves main: everything the window may ask, which main forwards, and what main
 * alone tells it or follows. The window is shown: what waits for the window before it runs (the
 * commands run at each opening) may start now; the engine answers at once and runs them in the
 * background. The notices are main's to deliver, never the window's to follow.
 */
export const EngineMainRpcs = EngineRpcs.merge(
  RpcGroup.make(Rpc.make('engine.windowShown', { success: Schema.Void, error: EngineGone })),
  NoticeFeedRpcs,
)
