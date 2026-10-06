/**
 * The tester mode's findings, as the Developer section reads them (#45): the list, from the files,
 * the latest seen first, and the folder they are in. The mode itself is a preference. The section
 * is #50's.
 */

import { FINDING_KINDS, FINDING_SEVERITIES } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'

/** A finding as the Developer section lists it. */
export const TesterFinding = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  kind: Schema.Literals(FINDING_KINDS),
  place: Schema.String,
  severity: Schema.Literals(FINDING_SEVERITIES),
  occurrences: Schema.Number,
  lastSeen: Schema.String,
  /** Its file, relative to the findings' folder. */
  file: Schema.String,
})
export type TesterFinding = typeof TesterFinding.Type

/** The tester folder could not be read. */
export class TesterFolderUnreadable extends Schema.TaggedError<TesterFolderUnreadable>()(
  'TesterFolderUnreadable',
  { reason: Schema.String },
) {
  override get message(): string {
    return `The tester folder could not be read: ${this.reason}`
  }
}

export const TesterRpcs = RpcGroup.make(
  Rpc.make('tester.findings', {
    success: Schema.Array(TesterFinding),
    error: Schema.Union([TesterFolderUnreadable, StorageFailed, EngineGone]),
  }),
  /** The folder the findings are written in, `<data folder>/tester`. */
  Rpc.make('tester.folder', {
    success: Schema.String,
    error: Schema.Union([StorageFailed, EngineGone]),
  }),
)
