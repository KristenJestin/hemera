/**
 * Where a written entry goes besides the database: the window watching that Session (D5-12).
 *
 * A file of its own rather than a corner of the runtime, because two services push a notice now:
 * the runtime, for everything an agent says, and `ToolPermissions`, for a question Hemera's own
 * tools raise. The port would otherwise be imported from the runtime by a service the runtime
 * itself is built on, and that circle is not a dependency anyone should have to reason about.
 */

import { Context, Layer } from 'effect'

import type { SessionEntry } from '@hemera/core'

/** What a Session did that the window is told about, and that has no entry of its own. */
export type Notice =
  | 'permission_requested'
  | 'turn_started'
  | 'turn_ended'
  | 'agent_died'
  | 'session_fallback'

/** Where a written entry goes besides the database: the window watching this Session. */
export interface AgentNoticesService {
  readonly wrote: (sessionId: string, entry: SessionEntry) => void
  /** Something about a Session changed without an entry: a question arrived, a turn ended. */
  readonly changed: (sessionId: string, what: Notice) => void
}

export class AgentNotices extends Context.Service<AgentNotices, AgentNoticesService>()(
  'AgentNotices',
) {}

/**
 * A runtime with nobody watching.
 *
 * The engine's own layer puts the window there; a test that only reads the thread does not need
 * one, and a port with a default is what keeps a notice from being something a caller can
 * forget to provide.
 */
export const NoNotices = Layer.succeed(AgentNotices, {
  wrote: () => undefined,
  changed: () => undefined,
})
