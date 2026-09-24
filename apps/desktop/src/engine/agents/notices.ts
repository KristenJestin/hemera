/**
 * Where a written entry goes besides the database: the window watching that Session (D5-12).
 *
 * A file of its own rather than a corner of the runtime, because several services push a notice:
 * the runtime, for everything an agent says; `ToolPermissions`, for a question Hemera's own tools
 * raise; the tool catalogue and the commands, for the entries they write into the same thread and
 * the runs they start (D6-06, D6-12); the Workspaces and their preparation, for what changes of a
 * Workspace (D8-05). The port would otherwise be imported from the runtime by
 * services the runtime itself is built on, and that circle is not a dependency anyone should have
 * to reason about.
 */

import { Context, Layer } from 'effect'

import type { SessionEntry } from '@hemera/core'
import type { CommandRun } from '@hemera/ipc'

/** What a Session did that the window is told about, and that has no entry of its own. */
export type Notice =
  | 'permission_requested'
  | 'turn_started'
  | 'turn_ended'
  | 'agent_died'
  | 'session_fallback'
  | 'context_delivered'

/** Where a written entry goes besides the database: the window watching this Session. */
export interface AgentNoticesService {
  readonly wrote: (sessionId: string, entry: SessionEntry) => void
  /** Something about a Session changed without an entry: a question arrived, a turn ended. */
  readonly changed: (sessionId: string, what: Notice) => void
  /**
   * A run changed — it started, named its address, printed, or ended (D6-12).
   *
   * The run as it stands and not a line of it: the panel draws the whole of what is kept, and a
   * window that missed one push reads the next one whole.
   */
  readonly ran: (sessionId: string, run: CommandRun) => void
  /**
   * A Workspace or its steps changed (D8-05): created, made on a folder, cleaned up, a step of
   * its preparation written, or the preparation over. About a Project rather than a Session: the
   * page showing that Workspace reads it again.
   */
  readonly workspace: (projectId: string, workspaceId: string) => void
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
  ran: () => undefined,
  workspace: () => undefined,
})
