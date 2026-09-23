/**
 * What each tool is asked with, declared once (design D6-03).
 *
 * One declaration serves three readers: the schema handed to the agent so it knows what to send,
 * the guard that reads what arrived, and the tool itself, which reads fields and not a document
 * of its own. A tool that took its arguments from somewhere else would be a tool whose contract
 * is two things that drift.
 *
 * The arguments are flat on purpose — a string, a number, a boolean, or nothing at all — because
 * MCP is what carries them and a nested document is a document nobody validates twice.
 */

import { READ_PAGE_BYTES, SEARCH_MATCH_LIMIT, SEARCH_SCAN_BYTES, type ToolName } from '@hemera/core'
import { z } from 'zod'

import { OUTPUT_KEPT_BYTES } from '../commands/service.ts'

/** The arguments of a tool as they arrived: flat, JSON, and not yet read. */
export type ToolArguments = Readonly<Record<string, string | number | boolean | null>>

/** What an argument was refused with, said so that the agent can send better ones. */
export type ParsedCall =
  | { readonly tool: 'fs_read'; readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['fs_read']> }
  | { readonly tool: 'fs_edit'; readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['fs_edit']> }
  | { readonly tool: 'fs_write'; readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['fs_write']> }
  | { readonly tool: 'fs_list'; readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['fs_list']> }
  | { readonly tool: 'search'; readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['search']> }
  | {
      readonly tool: 'commands_list'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['commands_list']>
    }
  | {
      readonly tool: 'commands_run'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['commands_run']>
    }
  | {
      readonly tool: 'commands_output'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['commands_output']>
    }
  | {
      readonly tool: 'commands_stop'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['commands_stop']>
    }
  | {
      readonly tool: 'project_get'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['project_get']>
    }
  | {
      readonly tool: 'session_get'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['session_get']>
    }

/**
 * The key an idempotency key may be, so that a key is a name and not a document.
 *
 * Every write, edit and run carries one (D6-03): a lost answer and a second call look the same
 * from where the agent stands, and without a key the second one would act twice.
 */
const KEY = z.string().min(1).max(200)

/** How long `commands_run` waits for a command to end when it is not told: 30 seconds. */
export const RUN_WAIT_MS = 30_000

/** The longest it may be told to wait: 10 minutes. */
export const RUN_WAIT_LONGEST_MS = 600_000

/** How many entries of the thread `session_get` hands back. */
export const THREAD_TAIL = 20

/**
 * The arguments of every tool, as the agent is told them and as they are read back.
 *
 * A path is always relative to the Workspace root: an absolute path is accepted and judged, but
 * a relative one is what an agent should send, because it is the one that survives the project
 * being moved.
 */
export const TOOL_ARGUMENTS = {
  fs_read: z.object({
    path: z.string().min(1).describe('the file, relative to the Workspace root'),
    offset: z.number().int().min(0).optional().describe('the byte to start at; 0 without it'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(READ_PAGE_BYTES)
      .optional()
      .describe(`how many bytes at most; ${READ_PAGE_BYTES} without it`),
  }),
  fs_edit: z.object({
    path: z.string().min(1).describe('the file, relative to the Workspace root'),
    old: z.string().min(1).describe('the text to replace, which must appear exactly once'),
    new: z.string().describe('what to replace it with; an empty string deletes it'),
    key: KEY.describe('an idempotency key, so a retry does not edit twice'),
  }),
  fs_write: z.object({
    path: z.string().min(1).describe('the file, relative to the Workspace root'),
    content: z.string().describe('what the whole file becomes; the folders are created'),
    key: KEY.describe('an idempotency key, so a retry does not write twice'),
  }),
  fs_list: z.object({
    path: z.string().optional().describe('the folder, relative to the Workspace root'),
  }),
  search: z.object({
    query: z.string().min(1).describe('what to look for, as it is written'),
    path: z.string().optional().describe('a folder or a file to search in, instead of everything'),
    cursor: z.string().optional().describe('where to continue from, as the last answer gave it'),
  }),
  commands_list: z.object({}),
  commands_run: z.object({
    name: z.string().min(1).optional().describe('a command of the Project catalogue, by name'),
    line: z.string().min(1).optional().describe('a one-off command line, instead of a name'),
    folder: z
      .string()
      .optional()
      .describe(
        'where to run a one-off line: a repository of the Project, or a path in the Workspace; a catalogue command runs in its own folder',
      ),
    key: KEY.describe('an idempotency key, so a retry does not start it twice'),
    timeout: z
      .number()
      .int()
      .min(0)
      .max(RUN_WAIT_LONGEST_MS)
      .optional()
      .describe(
        `how long to wait for it to end, in milliseconds: ${RUN_WAIT_MS} by default, ${RUN_WAIT_LONGEST_MS} at most`,
      ),
    background: z
      .boolean()
      .optional()
      .describe('true to answer as soon as it has started, without waiting for it to end'),
  }),
  commands_output: z.object({
    run: z
      .string()
      .min(1)
      .optional()
      .describe('which run, as commands_list names it; the one running, or the last, without it'),
  }),
  commands_stop: z.object({
    run: z.string().min(1).optional().describe('which run; the only one running without it'),
  }),
  project_get: z.object({}),
  session_get: z.object({}),
} as const

/** What each tool is, in the words the agent reads before it asks. */
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  fs_read: `Read a file inside the Workspace root. A long file is paginated: one call returns at most ${READ_PAGE_BYTES} bytes, each line comes with its number in front of it, a page ends on a whole line, and the answer ends with the range read as JSON: offset, end, size, truncated and next, the offset of the next page.`,
  fs_edit: `Replace a piece of text in a file of the Workspace root. The text must appear exactly once: none, or several, is refused and the refusal says how many were found. Send a key so that a retry after a lost answer does not edit twice.`,
  fs_write: `Write a file inside the Workspace root, creating the folders it needs; the whole file becomes what you send. Send a key so that a retry after a lost answer does not write twice.`,
  fs_list:
    'List one level of a folder of the Workspace root: the name, the kind and the size of what it holds.',
  search: `Search the files of the Workspace root for a piece of text, \`.gitignore\` respected. One call returns at most ${SEARCH_MATCH_LIMIT} matches and scans at most ${SEARCH_SCAN_BYTES} bytes: the answer says which limit stopped it, gives the cursor to continue from, and names the files it did not read (binary or unreadable).`,
  commands_list:
    "The commands the Project's catalogue holds: name, line, kind, and the folder each runs in. Then the runs of this Session, whoever started them, you or the user from the Commands panel: run id, name, state, the exit code once it ended, catalogue or one-off, and the line.",
  commands_run: `Ask for a command of the Project's catalogue to run, by name, or a one-off line, which the user is asked to allow before it runs. A serve command that is already running is handed back rather than started twice. Any other type is waited for, up to timeout, and answers with its exit code and the end of its output; one still running then is left running in the background and its run id is given, so there is nothing to poll for. background: true answers at once. A serve command is left running as soon as it has started. The output, and the address it published, come back as they stand. Send a key so that a retry after a lost answer does not start it twice.`,
  commands_output:
    'What a run of this Session has printed, whoever started it, bounded, the address it published, and how it ended if it has.',
  commands_stop: 'Stop a run and everything it started.',
  project_get:
    'The Project this Session belongs to: its name, where its Workspace root is, and what it reads from.',
  session_get:
    'This Session: its title, its Project, its agent, and the last entries of its thread.',
}

/**
 * The limit each tool is held to, in one line, as the Context view lists it (design D6-10).
 *
 * The same numbers the descriptions give the agent, said for the reader: a tool offered with a
 * limit is a different promise from a tool offered, which is why the limit is on the line.
 */
export const TOOL_BOUNDS: Record<ToolName, string> = {
  fs_read: `${READ_PAGE_BYTES / 1024} KiB a page, inside the Workspace root`,
  fs_edit: 'one unique match, inside the Workspace root',
  fs_write: 'the whole file, inside the Workspace root',
  fs_list: 'one level, inside the Workspace root',
  search: `${SEARCH_MATCH_LIMIT} matches and ${SEARCH_SCAN_BYTES / 1024 / 1024} MiB scanned a call`,
  commands_list: "the Project's catalogue, and this Session's last runs",
  commands_run: 'the catalogue, or a one-off line the user allows',
  commands_output: `the last ${OUTPUT_KEPT_BYTES / 1024} KiB a run printed`,
  commands_stop: 'a run of this Project, and all it started',
  project_get: 'this Project',
  session_get: `this Session and its last ${THREAD_TAIL} entries`,
}

/** What one reading of the arguments answered. */
export type ArgumentsDecision =
  | { readonly ok: true; readonly call: ParsedCall }
  | { readonly ok: false; readonly reason: string }

/** Reads what arrived against the schema of one tool. */
function read<A>(
  schema: z.ZodType<A>,
  raw: ToolArguments,
): { readonly ok: true; readonly value: A } | { readonly ok: false; readonly reason: string } {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return { ok: true, value: parsed.data }
  return {
    ok: false,
    reason: parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'the arguments'}: ${issue.message}`)
      .join('; '),
  }
}

/** The value when it read, and the sentence to answer with when it did not. */
function decide<T extends ToolName, A>(
  tool: T,
  reading:
    | { readonly ok: true; readonly value: A }
    | { readonly ok: false; readonly reason: string },
): ArgumentsDecision {
  if (!reading.ok) return { ok: false, reason: reading.reason }
  // SAFETY: `reading` is the result of the schema this very switch names for `tool`, and the
  // union below lists exactly the pairs the switch can produce: the tool and its arguments are
  // read from the same schema, in the same call, one line above.
  return { ok: true, call: { tool, arguments: reading.value } as ParsedCall }
}

/**
 * The arguments of a call, read once.
 *
 * Every tool goes through here, so a call whose arguments do not read never reaches a tool: the
 * first thing a tool does is trust its own fields, and that trust is bought exactly here.
 */
export function parseCall(tool: ToolName, raw: ToolArguments): ArgumentsDecision {
  switch (tool) {
    case 'fs_read':
      return decide(tool, read(TOOL_ARGUMENTS['fs_read'], raw))
    case 'fs_edit':
      return decide(tool, read(TOOL_ARGUMENTS['fs_edit'], raw))
    case 'fs_write':
      return decide(tool, read(TOOL_ARGUMENTS['fs_write'], raw))
    case 'fs_list':
      return decide(tool, read(TOOL_ARGUMENTS['fs_list'], raw))
    case 'search':
      return decide(tool, read(TOOL_ARGUMENTS.search, raw))
    case 'commands_list':
      return decide(tool, read(TOOL_ARGUMENTS['commands_list'], raw))
    case 'commands_run':
      return decide(tool, read(TOOL_ARGUMENTS['commands_run'], raw))
    case 'commands_output':
      return decide(tool, read(TOOL_ARGUMENTS['commands_output'], raw))
    case 'commands_stop':
      return decide(tool, read(TOOL_ARGUMENTS['commands_stop'], raw))
    case 'project_get':
      return decide(tool, read(TOOL_ARGUMENTS['project_get'], raw))
    case 'session_get':
      return decide(tool, read(TOOL_ARGUMENTS['session_get'], raw))
  }
}

/**
 * What an MCP client sent, as the flat arguments a tool is read from.
 *
 * The one place where what arrived is trusted: a value the agent sent that is not a string, a
 * number, a boolean or null is dropped, and a schema that then wants it says so. Nothing here
 * decides anything — it is the shape, and the reading is `parseCall`'s.
 */
export function flatArguments(
  entries: readonly (readonly [string, string | number | boolean | null | undefined])[],
) {
  return Object.fromEntries(carried(entries))
}

/** The entries that carry a value, which are the ones a tool can be read from. */
function carried(
  entries: readonly (readonly [string, string | number | boolean | null | undefined])[],
): readonly (readonly [string, string | number | boolean | null])[] {
  return entries.filter(
    (pair): pair is readonly [string, string | number | boolean | null] => pair[1] !== undefined,
  )
}
