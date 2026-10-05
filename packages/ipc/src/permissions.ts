/**
 * The permissions of a Project, as they cross the links: its "never" list, the commands that are
 * always refused to its agents, read and replaced whole (a change applies to the next call, in
 * every mission); and the "Allow for this mission" grants of a mission, listed and revoked (a
 * revocation applies from the next call).
 */

import { NeverEntry } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { UnknownCommand } from './commands.ts'
import { UnknownMission } from './missions.ts'
import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

/** A Project's "never" list, replaced whole. */
export const NeverListEdit = Schema.Struct({
  projectId: Schema.String,
  entries: Schema.Array(NeverEntry),
})

/**
 * An "Allow for this mission" grant: the action in words, who gave it and when, how many calls it
 * allowed, and whether it still holds (`revoked` by the user, `fallen` when its identity moved,
 * with the reason).
 */
export const MissionGrant = Schema.Struct({
  id: Schema.String,
  missionId: Schema.String,
  action: Schema.String,
  givenBy: Schema.String,
  givenAt: Schema.String,
  uses: Schema.Number,
  state: Schema.Literals(['live', 'revoked', 'fallen']),
  reason: Schema.NullOr(Schema.String),
})
export type MissionGrant = typeof MissionGrant.Type

export const PermissionsRpcs = RpcGroup.make(
  Rpc.make('permissions.neverList', {
    payload: { projectId: Schema.String },
    success: Schema.Array(NeverEntry),
    error: failing(StorageFailed, EngineGone, UnknownProject),
  }),
  Rpc.make('permissions.setNeverList', {
    payload: NeverListEdit,
    success: Schema.Array(NeverEntry),
    error: failing(StorageFailed, EngineGone, UnknownProject, UnknownCommand),
  }),
  Rpc.make('permissions.grants', {
    payload: { missionId: Schema.String },
    success: Schema.Array(MissionGrant),
    error: failing(StorageFailed, EngineGone, UnknownMission),
  }),
  /** Revokes a grant from the next call; one that no longer holds is left as it is. */
  Rpc.make('permissions.revoke', {
    payload: { grantId: Schema.String },
    success: Schema.Void,
    error: failing(StorageFailed, EngineGone),
  }),
)
