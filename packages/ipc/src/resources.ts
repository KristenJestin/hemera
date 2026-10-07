/**
 * The exclusive resources (#88), as they cross the links: a Project's declarations, read and
 * replaced whole (the settings screen is #104's); and every resource of the machine with the
 * mission holding it and those waiting for it, read once and followed as it changes, for the
 * mission page and the settings.
 *
 * Only the catalogue commands declared on a resource are protected: a free line of an agent, a
 * Chat's command or a command run in the user's own terminal cannot be recognised (CT-40).
 */

import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/**
 * An exclusive resource as the Project declares it: its name (its identity on the whole machine
 * once trimmed and case-folded; within one profile, as another profile keeps its own
 * reservations), what it is, the catalogue commands that use it, those that change
 * it, and the command that brings it back to the state a mission expects, if one does. The reset
 * command is always one that changes it.
 */
export const ResourceDraft = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  uses: Schema.Array(Schema.String),
  changes: Schema.Array(Schema.String),
  resetCommandId: Schema.NullOr(Schema.String),
})
export type ResourceDraft = typeof ResourceDraft.Type

export const ExclusiveResource = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  ...ResourceDraft.fields,
})
export type ExclusiveResource = typeof ExclusiveResource.Type

/** A declaration refused at save, and why, in words. */
export class InvalidResources extends Schema.TaggedError<InvalidResources>()('InvalidResources', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `These resources are refused: ${this.reason}.`
  }
}

/** Where the taking of a held resource stands: ready, or what it waits for. */
export const RESOURCE_READINESS = ['taking', 'resetting', 'needs-you', 'ready'] as const

/** A mission holding a resource or waiting for it, and since when. */
export const ResourceClaimant = Schema.Struct({
  missionId: Schema.String,
  missionKey: Schema.String,
  projectId: Schema.String,
  since: Schema.String,
})
export type ResourceClaimant = typeof ResourceClaimant.Type

/** One resource of the machine: the names it is declared under, its holder, and its queue. */
export const ResourceHolding = Schema.Struct({
  key: Schema.String,
  names: Schema.Array(Schema.String),
  holder: Schema.NullOr(
    Schema.Struct({ ...ResourceClaimant.fields, readiness: Schema.Literals(RESOURCE_READINESS) }),
  ),
  queue: Schema.Array(ResourceClaimant),
})
export type ResourceHolding = typeof ResourceHolding.Type

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

export const ResourcesRpcs = RpcGroup.make(
  Rpc.make('resources.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(ExclusiveResource),
    error: failing(StorageFailed, EngineGone, UnknownProject),
  }),
  /** Replaces a Project's declarations whole, every one checked first. */
  Rpc.make('resources.save', {
    payload: { projectId: Schema.String, resources: Schema.Array(ResourceDraft) },
    success: Schema.Array(ExclusiveResource),
    error: failing(StorageFailed, EngineGone, UnknownProject, InvalidResources),
  }),
  /** Every resource of the machine, declared or held, with its holder and its queue. */
  Rpc.make('resources.holders', {
    success: Schema.Array(ResourceHolding),
    error: failing(StorageFailed, EngineGone),
  }),
  /** The same now, then again each time a reservation or a declaration changes. */
  Rpc.make('resources.changed', {
    success: Schema.Array(ResourceHolding),
    error: failing(StorageFailed, EngineGone),
    stream: true,
  }),
)
