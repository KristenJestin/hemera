/**
 * Who hears that a Spec changed: the window, which redraws the panel of every Session on it, and
 * the thread of a Session a question of a Spec was asked or answered in (D7-01).
 *
 * Called after the transaction commits, never inside it, so a window is never told about a change
 * that was rolled back. The engine's own layer puts the port there (`index.ts`); a test that only
 * reads the rows has nobody watching.
 */

import { Context, Layer } from 'effect'

import type { SessionEntry } from '../sessions.ts'

export interface SpecNoticesService {
  readonly changed: (specId: string, projectId: string) => void
  /** An entry a Spec step wrote into a Session's thread: pushed as the runtime pushes its own. */
  readonly wrote: (sessionId: string, entry: SessionEntry) => void
}

export class SpecNotices extends Context.Service<SpecNotices, SpecNoticesService>()(
  'SpecNotices',
) {}

/** Nobody watching. */
export const NoSpecNotices = Layer.succeed(SpecNotices, {
  changed: () => undefined,
  wrote: () => undefined,
})
