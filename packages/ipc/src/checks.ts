/**
 * The Project's checks (#143), as they cross the links: the list, the defaults proposed from the
 * catalogue (never saved until the user accepts them), a check written, removed or moved. A check
 * refused carries the sentence the settings show.
 */

import { CheckDraft, ProjectCheck, CheckField } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export { CheckDraft, CheckField, ProjectCheck }

/**
 * A check the settings cannot save, the sentence they show, and the field they show it under when
 * it concerns one.
 */
export class CheckRefused extends Schema.TaggedError<CheckRefused>()('CheckRefused', {
  reason: Schema.String,
  field: Schema.optionalKey(Schema.NullOr(CheckField)),
}) {
  override get message(): string {
    return this.reason
  }
}

/** A proof's time limit refused: under a minute, over the bound, or not whole minutes (#321). */
export class InvalidProofLimit extends Schema.TaggedError<InvalidProofLimit>()(
  'InvalidProofLimit',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

export class UnknownProjectCheck extends Schema.TaggedError<UnknownProjectCheck>()(
  'UnknownProjectCheck',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This check is no longer in the Project.'
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone, UnknownProject] as const

export const ChecksRpcs = RpcGroup.make(
  /** The Project's checks, in their order. */
  Rpc.make('checks.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(ProjectCheck),
    error: failing(...always),
  }),
  /**
   * The checks proposed from the catalogue's check commands: none for a Project that has checks,
   * unless `asked`. Nothing is saved.
   */
  Rpc.make('checks.propose', {
    payload: { projectId: Schema.String, asked: Schema.Boolean },
    success: Schema.Array(CheckDraft),
    error: failing(...always),
  }),
  /** Saves the proposals kept, edited or not, all at once: one refused refuses them all. */
  Rpc.make('checks.accept', {
    payload: { projectId: Schema.String, proposals: Schema.Array(CheckDraft) },
    success: Schema.Array(ProjectCheck),
    error: failing(...always, CheckRefused),
  }),
  /** Writes a check: a new one, last, when `id` is null; the one `id` names otherwise. */
  Rpc.make('checks.save', {
    payload: { projectId: Schema.String, id: Schema.NullOr(Schema.String), check: CheckDraft },
    success: ProjectCheck,
    error: failing(...always, CheckRefused, UnknownProjectCheck),
  }),
  /** Takes a check out; the results it left in Buildings stay, named as they ran. */
  Rpc.make('checks.remove', {
    payload: { projectId: Schema.String, id: Schema.String },
    success: Schema.Void,
    error: failing(...always, UnknownProjectCheck),
  }),
  /** Moves a check to `rank`, its 0-based place in the list; answers the list. */
  Rpc.make('checks.move', {
    payload: { projectId: Schema.String, id: Schema.String, rank: Schema.Number },
    success: Schema.Array(ProjectCheck),
    error: failing(...always, UnknownProjectCheck),
  }),
  /** How long a proof may run, in minutes (#321); null while the Project keeps the default. */
  Rpc.make('checks.proofLimit', {
    payload: { projectId: Schema.String },
    success: Schema.NullOr(Schema.Number),
    error: failing(...always),
  }),
  /** Sets it, or empties it back to the default with null; answers what is kept. */
  Rpc.make('checks.setProofLimit', {
    payload: { projectId: Schema.String, minutes: Schema.NullOr(Schema.Number) },
    success: Schema.NullOr(Schema.Number),
    error: failing(...always, InvalidProofLimit),
  }),
)
