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
  'commands_propose',
  'project_get',
  'session_get',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/**
 * The mark a tool is drawn with in the thread: one per tool, so that two tools never share a
 * picture (recette 3 of 23 September 2026). The design system holds the icon of each; this is
 * the name both ends agree on.
 */
export type ToolMark =
  | 'read-file'
  | 'list-folder'
  | 'search'
  | 'write-file'
  | 'edit-file'
  | 'run-command'
  | 'stop-command'
  | 'list-commands'
  | 'command-output'
  | 'project'
  | 'session'

/** What a reader calls a tool, and the mark it wears. */
export interface ToolLabel {
  readonly label: string
  readonly mark: ToolMark
}

/**
 * What a reader calls each tool, and the mark it wears.
 *
 * The catalogue's name is the agent's word and stays on the line, quieter; the label is the
 * reader's, and it is what the line is read by.
 */
export const TOOL_LABELS: Readonly<Record<ToolName, ToolLabel>> = {
  fs_read: { label: 'Read file', mark: 'read-file' },
  fs_list: { label: 'List folder', mark: 'list-folder' },
  search: { label: 'Search', mark: 'search' },
  fs_write: { label: 'Write file', mark: 'write-file' },
  fs_edit: { label: 'Edit file', mark: 'edit-file' },
  commands_run: { label: 'Run command', mark: 'run-command' },
  commands_stop: { label: 'Stop command', mark: 'stop-command' },
  commands_list: { label: 'List commands', mark: 'list-commands' },
  commands_output: { label: 'Command output', mark: 'command-output' },
  project_get: { label: 'Project', mark: 'project' },
  session_get: { label: 'Session', mark: 'session' },
}

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

/**
 * The tool of Hemera's a name an agent reports designates, or null for one of the agent's own
 * (D6-06).
 *
 * Every agent reports the calls it makes, Hemera's included, as its own: the name is the tool's
 * under the agent's prefix — `mcp__hemera__fs_read` on Claude Code and Codex, `hemera_fs_read`
 * on OpenCode — or the bare name.
 */
export function hemeraToolNamed(title: string): ToolName | null {
  const bare = title
    .replace(/^mcp__hemera__/i, '')
    .replace(/^hemera_/i, '')
    .toLowerCase()
  return TOOL_NAMES.find((name) => name === bare) ?? null
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
