/**
 * The engine's domain: its start, its status, and the error every call waiting on it fails with
 * once it is gone. Served by the engine to main, and by main to the window, which forwards.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

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
})
export type EngineStart = typeof EngineStart.Type

export const EngineStatus = Schema.Struct({
  ready: Schema.Boolean,
  version: Schema.String,
  channel: Channel,
  dataFolder: Schema.String,
})
export type EngineStatus = typeof EngineStatus.Type

/** The engine is no longer there: every call that waited on it fails with this, at once. */
export class EngineGone extends Schema.TaggedError<EngineGone>()('EngineGone', {}) {
  override get message(): string {
    return 'Hemera’s engine stopped.'
  }
}

export const EngineRpcs = RpcGroup.make(
  Rpc.make('engine.status', { success: EngineStatus, error: EngineGone }),
  /** The current status, then every change of it, for as long as the caller listens. */
  Rpc.make('engine.statusChanges', { success: EngineStatus, error: EngineGone, stream: true }),
)
