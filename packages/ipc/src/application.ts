/**
 * What main itself answers the window: the environment report (`--report` prints the same one),
 * the relaunch of the whole application, the diagnostic log shown in the system's file manager,
 * and the system's own folder picker.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { Channel } from './engine.ts'

export const Display = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  scaleFactor: Schema.Number,
  refreshRate: Schema.Number,
  primary: Schema.Boolean,
})

/**
 * What the machine this run is on says about itself. A field that cannot be read is null rather
 * than guessed, and a report never speaks for a target it was not produced on.
 */
export const EnvironmentReport = Schema.Struct({
  version: Schema.String,
  channel: Channel,
  platform: Schema.String,
  osVersion: Schema.String,
  distribution: Schema.NullOr(Schema.String),
  session: Schema.NullOr(Schema.String),
  displays: Schema.Array(Display),
  versions: Schema.Struct({
    electron: Schema.String,
    chrome: Schema.String,
    node: Schema.String,
  }),
  /** Where this run writes, `diagnostic.log` included. */
  dataFolder: Schema.String,
  notVerified: Schema.Array(Schema.String),
  producedAt: Schema.String,
})
export type EnvironmentReport = typeof EnvironmentReport.Type

export const ApplicationRpcs = RpcGroup.make(
  Rpc.make('environment.report', { success: EnvironmentReport }),
  Rpc.make('application.relaunch', { success: Schema.Void }),
  /** Shows `diagnostic.log` of the data folder in the system's file manager. */
  Rpc.make('application.showLog', { success: Schema.Void }),
  /** The system's own picker for a folder: the folder chosen, or null when none was. */
  Rpc.make('application.chooseFolder', { success: Schema.NullOr(Schema.String) }),
)
