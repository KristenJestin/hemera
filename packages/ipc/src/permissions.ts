/**
 * The permissions of a Project, as they cross the links: its "never" list, the commands that are
 * always refused to its agents, read and replaced whole. A change applies to the next call, in
 * every mission.
 */

import { NeverEntry } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { UnknownCommand } from './commands.ts'
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
)
