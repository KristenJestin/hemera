/**
 * Hemera's MCP tools, the roles that have them, and the places those roles work in.
 *
 * In bare mode an agent has no tool of its own: these are the only way it reads, writes or runs
 * anything. Every agent session has a role, and the role says which tools it is offered and where
 * its paths are "inside". This one table says, for each tool, the roles that have it, its gate
 * class, what it does to the world, the argument that carries its path, and the `Schema` its
 * arguments are decoded with, whose annotations are what the agent reads. Later tickets register
 * their tools here, and the guarantee that no tool reaches Ship reads this table whole.
 *
 * The gate classes:
 * - **local**: reads only; may be allowed by local rules, but a path outside the role's place or
 *   in a sensitive place still asks;
 * - **judged**: writes or runs; goes through the full order of decision and may become a
 *   permission need;
 * - **workflow**: Hemera's own workflow tools; the role's guards only, plus the places rule for
 *   those that take a path; never judged, never a permission need.
 */

import { Schema } from 'effect'

/** The roles of an agent session at this version; later tickets add theirs. */
export const ROLES = [
  'planner',
  'probe',
  'cold-read',
  'builder',
  'helper',
  'documenter',
  'spec-reviewer',
  'code-reviewer',
  'chat',
] as const
export const Role = Schema.Literals(ROLES)
export type Role = typeof Role.Type

/** What a refusal calls a role. */
export const ROLE_NAMES: Readonly<Record<Role, string>> = {
  planner: 'the Planner',
  probe: 'the Probe',
  'cold-read': 'the cold read',
  builder: 'the Builder',
  helper: 'a helper',
  documenter: 'the documenter',
  'spec-reviewer': 'the Spec reviewer',
  'code-reviewer': 'the code reviewer',
  chat: 'the Chat',
}

/** The kinds of place a role works in. */
export type PlaceKind = 'main-checkout' | 'own-worktree' | 'workspace'

/** What a refusal calls a place. */
export const PLACE_NAMES: Readonly<Record<PlaceKind, string>> = {
  'main-checkout': 'the main checkout',
  'own-worktree': 'its worktree',
  workspace: 'the Workspace',
}

/** Where a role's paths are inside, and whether it may write there. */
export interface RolePlace {
  readonly kind: PlaceKind
  readonly readOnly: boolean
}

export const ROLE_PLACES: Readonly<Record<Role, RolePlace>> = {
  planner: { kind: 'main-checkout', readOnly: true },
  probe: { kind: 'own-worktree', readOnly: false },
  'cold-read': { kind: 'main-checkout', readOnly: true },
  builder: { kind: 'workspace', readOnly: false },
  helper: { kind: 'workspace', readOnly: false },
  documenter: { kind: 'workspace', readOnly: false },
  'spec-reviewer': { kind: 'workspace', readOnly: true },
  'code-reviewer': { kind: 'workspace', readOnly: true },
  chat: { kind: 'main-checkout', readOnly: false },
}

export type GateClass = 'local' | 'judged' | 'workflow'

/** What a tool does to the world: reads it, writes files, or runs (or stops) a command. */
export type ToolEffect = 'reads' | 'writes' | 'runs'

/** The most `fs_read` hands back in one call, and the page a long file is read in. */
export const READ_PAGE_BYTES = 256 * 1024

/** How deep `fs_list` goes at most. */
export const LIST_DEPTH_MAX = 5

/** How many entries one `fs_list` answers at most. */
export const LIST_ENTRIES_MAX = 1000

/** How many matches a search returns before it stops and says so. */
export const SEARCH_MATCH_LIMIT = 200

/** How many bytes a search scans in one call. */
export const SEARCH_SCAN_BYTES = 1024 * 1024

/** How many of the files a search passed over it names; the rest are counted. */
export const SEARCH_SKIPS_LISTED = 20

/** How many edits one `fs_edit` applies at most. */
export const EDITS_MAX = 50

/** How long `commands_run` waits for a command when it is not told, and at most, in seconds. */
export const RUN_WAIT_SECONDS = 30
export const RUN_WAIT_SECONDS_MAX = 600

/** How many lines of a run's output an answer carries when it is not told, and at most. */
export const OUTPUT_TAIL_LINES = 40
export const OUTPUT_TAIL_LINES_MAX = 1000

/** The longest reason an agent gives for a judged call. */
export const WHY_MAX = 500

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty()).annotate({ description })

const Count = (minimum: number, maximum: number, description: string) =>
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(minimum),
    Schema.isLessThanOrEqualTo(maximum),
  ).annotate({ description })

const Repository = Schema.optionalKey(
  Text(
    'A repository of the Project, by its path as the Project names it (`api`); the root of your place without it. A path is relative to it.',
  ),
)

const Why = Schema.optionalKey(
  Schema.String.check(Schema.isMaxLength(WHY_MAX)).annotate({
    description:
      'Why you make this call, in one sentence: shown to the user if Hemera asks them about it.',
  }),
)

const FsRead = Schema.Struct({
  repository: Repository,
  path: Text('The file, relative to the repository or to your place.'),
  range: Schema.optionalKey(
    Schema.Struct({
      offset: Schema.optionalKey(
        Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
          description: 'The byte to start at; 0 without it.',
        }),
      ),
      length: Schema.optionalKey(
        Count(1, READ_PAGE_BYTES, `How many bytes at most; ${String(READ_PAGE_BYTES)} without it.`),
      ),
    }).annotate({ description: 'The page to read, by bytes.' }),
  ),
}).annotate({
  description: `Read one page of a file, by bytes: at most ${String(READ_PAGE_BYTES)} bytes, ending on a line end when it can. The answer gives the page with its line numbers, the offset of the next page, and the file's total size.`,
})

const FsList = Schema.Struct({
  repository: Repository,
  path: Text('The folder, relative to the repository or to your place: `.` for its root.'),
  depth: Schema.optionalKey(
    Count(
      1,
      LIST_DEPTH_MAX,
      `How many levels to list, 1 without it, ${String(LIST_DEPTH_MAX)} at most.`,
    ),
  ),
}).annotate({
  description: `List a folder: each entry with its kind and size, at most ${String(LIST_ENTRIES_MAX)} entries. What could not be read is named, never left out.`,
})

const Search = Schema.Struct({
  pattern: Text('The text to look for, as it is written; case does not matter.'),
  repository: Repository,
  glob: Schema.optionalKey(
    Text(
      'Only the files whose path matches this glob (`src/**/*.ts`), relative to where it searches.',
    ),
  ),
  cursor: Schema.optionalKey(Text('Where to resume, as the previous answer gave it.')),
}).annotate({
  description: `Search the files for a piece of text, \`.gitignore\` respected. One call returns at most ${String(SEARCH_MATCH_LIMIT)} matches and scans at most ${String(SEARCH_SCAN_BYTES)} bytes: the answer says which limit stopped it, gives the cursor to resume from, and names the files it did not read.`,
})

const FsWrite = Schema.Struct({
  repository: Repository,
  path: Text('The file, relative to the repository or to your place; its folders are created.'),
  content: Schema.String.annotate({ description: 'What the whole file becomes.' }),
  why: Why,
}).annotate({
  description:
    'Write a whole file. An existing file is written only if it is still the version you last read or wrote: read it first; a file that changed since is refused with what changed.',
})

const FsEdit = Schema.Struct({
  repository: Repository,
  path: Text('The file, relative to the repository or to your place.'),
  edits: Schema.Array(
    Schema.Struct({
      old: Text('The text to replace: it must appear exactly once in the file as it then stands.'),
      new: Schema.String.annotate({ description: 'What replaces it; empty to remove it.' }),
    }),
  )
    .check(Schema.isNonEmpty(), Schema.isMaxLength(EDITS_MAX))
    .annotate({ description: 'The edits, applied in order: all of them, or none.' }),
  why: Why,
}).annotate({
  description:
    'Edit a file with anchored replacements, applied in order, all or none. The file must still be the version you last read or wrote: read it first.',
})

const CommandsList = Schema.Struct({}).annotate({
  description:
    "The commands of the Project's catalogue you may run: id, name, type, where each runs, and its line.",
})

const CommandsRun = Schema.Struct({
  command: Schema.optionalKey(Text('A command of the catalogue, by its id from commands_list.')),
  line: Schema.optionalKey(
    Text(
      'A command line to run instead, without shell syntax (no `>`, `|`, `&&`, `;`, `$(…)` or glob).',
    ),
  ),
  repository: Schema.optionalKey(
    Text(
      'For a line: the repository it runs in, by its path as the Project names it; the root of your place without it.',
    ),
  ),
  timeout: Schema.optionalKey(
    Count(
      1,
      RUN_WAIT_SECONDS_MAX,
      `How long to wait for it to end, in seconds: ${String(RUN_WAIT_SECONDS)} without it, ${String(RUN_WAIT_SECONDS_MAX)} at most.`,
    ),
  ),
  why: Why,
})
  .annotate({
    description: `Run a command of the catalogue, by its id, or a command line. The answer comes when it ends, or after the timeout (${String(RUN_WAIT_SECONDS)} s without one) with its run id: it keeps going, and commands_output reads it. The answer carries the end of its output.`,
  })
  .check(
    Schema.makeFilter((asked) => (asked.command === undefined) !== (asked.line === undefined), {
      expected: 'either a command or a line, not both',
    }),
  )

const CommandsOutput = Schema.Struct({
  run: Text('The run, by the id commands_run answered.'),
  tail: Schema.optionalKey(
    Count(
      1,
      OUTPUT_TAIL_LINES_MAX,
      `How many of its last lines; ${String(OUTPUT_TAIL_LINES)} without it.`,
    ),
  ),
}).annotate({
  description:
    'The state of a run you started, its exit code once it ended, and the end of its output.',
})

const CommandsStop = Schema.Struct({
  run: Text('The run, by the id commands_run answered.'),
}).annotate({ description: 'Stop a run you started, and everything it started.' })

/** What a reader calls a tool, the mark it wears, and what the turn is doing while it runs. */
export interface ToolLabel {
  readonly label: string
  readonly mark: string
  readonly doing: string
}

/** One tool of the table. */
export interface ToolEntry<Input extends Schema.Struct.Fields = Schema.Struct.Fields> {
  readonly roles: ReadonlyArray<Role>
  readonly gate: GateClass
  readonly effect: ToolEffect
  /**
   * The argument that carries the path the tool acts on, or null when it takes none. Required of
   * every tool: a workflow tool that takes a path cannot skip the places rule by not saying so.
   */
  readonly path: (keyof Input & string) | null
  readonly input: Schema.Struct<Input>
  readonly label: ToolLabel
}

const tool = <Input extends Schema.Struct.Fields>(entry: ToolEntry<Input>): ToolEntry<Input> =>
  entry

const READERS: ReadonlyArray<Role> = [
  'planner',
  'probe',
  'cold-read',
  'builder',
  'helper',
  'documenter',
  'chat',
]
const WRITERS: ReadonlyArray<Role> = ['probe', 'builder', 'helper', 'documenter', 'chat']
const RUNNERS: ReadonlyArray<Role> = ['probe', 'builder', 'helper', 'chat']

/** Every tool of Hemera's, by its name as the agent asks for it. */
export const TOOLS = {
  fs_read: tool({
    roles: [...READERS, 'code-reviewer'],
    gate: 'local',
    effect: 'reads',
    path: 'path',
    input: FsRead,
    label: { label: 'Read file', mark: 'read-file', doing: 'Reading a file' },
  }),
  fs_list: tool({
    roles: READERS,
    gate: 'local',
    effect: 'reads',
    path: 'path',
    input: FsList,
    label: { label: 'List folder', mark: 'list-folder', doing: 'Listing a folder' },
  }),
  search: tool({
    roles: [...READERS, 'spec-reviewer', 'code-reviewer'],
    gate: 'local',
    effect: 'reads',
    path: null,
    input: Search,
    label: { label: 'Search', mark: 'search', doing: 'Searching the code' },
  }),
  fs_write: tool({
    roles: WRITERS,
    gate: 'judged',
    effect: 'writes',
    path: 'path',
    input: FsWrite,
    label: { label: 'Write file', mark: 'write-file', doing: 'Writing a file' },
  }),
  fs_edit: tool({
    roles: WRITERS,
    gate: 'judged',
    effect: 'writes',
    path: 'path',
    input: FsEdit,
    label: { label: 'Edit file', mark: 'edit-file', doing: 'Editing a file' },
  }),
  commands_list: tool({
    roles: ['planner', ...RUNNERS],
    gate: 'local',
    effect: 'reads',
    path: null,
    input: CommandsList,
    label: { label: 'List commands', mark: 'list-commands', doing: 'Listing the commands' },
  }),
  commands_run: tool({
    roles: ['planner', ...RUNNERS],
    gate: 'judged',
    effect: 'runs',
    path: null,
    input: CommandsRun,
    label: { label: 'Run command', mark: 'run-command', doing: 'Running a command' },
  }),
  commands_output: tool({
    roles: ['planner', ...RUNNERS],
    gate: 'local',
    effect: 'reads',
    path: null,
    input: CommandsOutput,
    label: {
      label: 'Command output',
      mark: 'command-output',
      doing: 'Reading the output of a command',
    },
  }),
  commands_stop: tool({
    roles: RUNNERS,
    gate: 'workflow',
    effect: 'runs',
    path: null,
    input: CommandsStop,
    label: { label: 'Stop command', mark: 'stop-command', doing: 'Stopping a command' },
  }),
}

export type ToolName = keyof typeof TOOLS

/** The names of the table, in its order. */
export const TOOL_NAMES = [
  'fs_read',
  'fs_list',
  'search',
  'fs_write',
  'fs_edit',
  'commands_list',
  'commands_run',
  'commands_output',
  'commands_stop',
] as const satisfies ReadonlyArray<ToolName>

/** The arguments of a tool once decoded. */
export type ToolArguments<Name extends ToolName> = (typeof TOOLS)[Name]['input']['Type']

/** The tools a role is offered, in the table's order. */
export const toolsOf = (role: Role): ReadonlyArray<ToolName> =>
  TOOL_NAMES.filter((name) => TOOLS[name].roles.includes(role))

/** The MCP annotation a tool publishes: true for a tool that only reads. */
export const readOnlyHint = (name: ToolName): boolean => TOOLS[name].effect === 'reads'

/**
 * The tool of Hemera's a name an agent reports designates, or null for one of the agent's own.
 * Each agent prefixes what it registers: `mcp__hemera__fs_read` on Claude Code and Codex,
 * `hemera_fs_read` on OpenCode.
 */
export function hemeraToolNamed(title: string): ToolName | null {
  const bare = title
    .replace(/^mcp__hemera__/i, '')
    .replace(/^hemera_/i, '')
    .toLowerCase()
  return TOOL_NAMES.find((name) => name === bare) ?? null
}

/** What the gate answers about a tool's name: admitted, or refused with the reason. */
export type ToolAdmission =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string }

/**
 * Whether a session may call a tool by this name: a name no tool of Hemera's has (which is how an
 * action reserved to the human stays unreachable), or a tool its grant does not hold, is refused.
 */
export function admitTool(
  role: Role,
  offered: ReadonlyArray<ToolName>,
  name: string,
): ToolAdmission {
  const named = TOOL_NAMES.find((one) => one === name)
  if (named === undefined) {
    return { admitted: false, reason: `refused: Hemera has no tool named ${name.slice(0, 64)}` }
  }
  if (!offered.includes(named)) {
    return { admitted: false, reason: `refused: ${ROLE_NAMES[role]} has no tool ${named}` }
  }
  return { admitted: true }
}
