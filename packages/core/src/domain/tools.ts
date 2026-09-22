/**
 * The capabilities Hemera lends an agent, and the limits it lends them with (D6-03, D6-04).
 *
 * The names are the interface's: an agent asks for `fs_read`, and what it is asked with is a
 * bounded argument, never a command line of its own. The four sizes below are part of the
 * contract and not of the implementation — the tool description carries them, every result
 * repeats them, and a reader that never saw this file still learns from one call that a read is
 * paginated and a search is bounded.
 *
 * The mission is the seam and not a choice: a Session is `free` in this lot and is offered the
 * whole set, and the day a mission exists the same call answers with the set of that mission
 * instead. The guard is a function of what is offered and what is asked for, so a tool the
 * Session should never have been offered is refused by the same code path as one that was
 * offered and used wrongly (D6-03).
 */

import type { Mission } from './session.ts'

/**
 * Everything Hemera can lend, named as the model sees it once it has gone through MCP.
 *
 * The name here is the tool's own name and not the wire name: each agent prefixes what it
 * registers — `mcp__hemera__fs.read` on Claude Code and Codex, `hemera_fs.read` on OpenCode —
 * and a name that carried one of those prefixes would be a name that is wrong on two agents.
 */
export const TOOL_NAMES = [
  'fs_read',
  'fs_edit',
  'fs_write',
  'fs_list',
  'search',
  'commands_list',
  'commands_run',
  'commands_output',
  'commands_stop',
  'project_get',
  'session_get',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** The most `fs_read` hands back in one call, and the page a long file is read in. */
export const READ_PAGE_BYTES = 256 * 1024

/** How many matches a search may return before it stops and says so. */
export const SEARCH_MATCH_LIMIT = 200

/** How many bytes a search may scan in one call, `.gitignore` respected (D6-04). */
export const SEARCH_SCAN_BYTES = 1024 * 1024

/** What a search hit is: where it is, and the line as it was found. */
export interface SearchHit {
  readonly path: string
  readonly line: number
  readonly text: string
}

/** How many of the files a search passed over it names; the rest are counted. */
export const SEARCH_SKIPS_LISTED = 20

/** A file a search did not read, and why: what looks binary, or what could not be read. */
export interface SearchSkip {
  readonly path: string
  readonly reason: 'binary' | 'unreadable'
}

/** Which of the two limits stopped a search, and null when neither did. */
export type SearchLimit = 'matches' | 'scanned'

export interface SearchResult {
  readonly hits: readonly SearchHit[]
  /** The limit that was hit, and null for a search that ran to the end of what it scanned. */
  readonly stoppedBy: SearchLimit | null
  readonly scanned: number
  /** Where to continue from, and null when there is nothing left to read. */
  readonly cursor: string | null
  /** The first files it passed over, at most `SEARCH_SKIPS_LISTED`, said rather than hidden. */
  readonly skipped: readonly SearchSkip[]
  /** How many files it passed over in all. */
  readonly skippedCount: number
}

/**
 * The tools of a Session, by its mission.
 *
 * `free` is the only mission of this lot and it is offered everything; the mission is a
 * parameter rather than a constant so that the sets of the next issues arrive here and not in
 * eleven tools that each grew a condition.
 */
export function offeredTools(mission: Mission): readonly ToolName[] {
  switch (mission) {
    case 'free':
      return TOOL_NAMES
  }
}

/** What the guard answers: the call goes through, or it does not and says why. */
export type GuardDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string }

/**
 * Whether a call may go through, asked for every call and never remembered.
 *
 * Two refusals and one admission, and the reason is a sentence because it is shown to the agent
 * and written in the thread: a name no tool of Hemera has — which is how an action reserved to
 * the human stays unreachable (D6-05) — and a tool the Session's set does not hold, refused
 * just the same even when it was on the list handed to the agent. Technical reachability is not
 * an authorisation, which is why the question is asked again for every call.
 */
export function admitTool(offered: readonly ToolName[], tool: string): GuardDecision {
  const named = TOOL_NAMES.find((name) => name === tool)
  if (named === undefined) {
    return { admitted: false, reason: `Hemera has no tool named ${tool}` }
  }
  if (!offered.includes(named)) {
    return { admitted: false, reason: `the tool ${tool} is not offered to this Session` }
  }
  return { admitted: true }
}
