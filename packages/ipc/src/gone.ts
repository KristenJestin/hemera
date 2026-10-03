/**
 * The error every call waiting on the engine fails with once it is gone, in a file of its own:
 * every group the engine serves names it.
 */

import { Schema } from 'effect'

/** The engine is no longer there: every call that waited on it fails with this, at once. */
export class EngineGone extends Schema.TaggedError<EngineGone>()('EngineGone', {}) {
  override get message(): string {
    return 'Hemera’s engine stopped.'
  }
}
