/**
 * What the Developer section reads to diagnose the engine's own records. `snapshots.diagnose`
 * (#140): per repository of a mission, the refs of the snapshot store that hold its trees, and the
 * file sides and distinct contents copied into the database.
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'

/** One repository of a mission, as its snapshots stand. */
export const RepositorySnapshots = Schema.Struct({
  repository: Schema.String,
  refs: Schema.Array(Schema.String),
  files: Schema.Number,
  contents: Schema.Number,
})
export type RepositorySnapshots = typeof RepositorySnapshots.Type

export const DeveloperRpcs = RpcGroup.make(
  Rpc.make('snapshots.diagnose', {
    payload: { missionId: Schema.String },
    success: Schema.Array(RepositorySnapshots),
    error: Schema.Union([StorageFailed, EngineGone]),
  }),
)
