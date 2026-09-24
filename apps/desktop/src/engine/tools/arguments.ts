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

import {
  PHASE_IDS,
  READ_PAGE_BYTES,
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  SECTION_NAMES,
  SPEC_PAGE_CHARACTERS,
  SPEC_TYPES,
  TASK_EXECUTORS,
  type ToolName,
} from '@hemera/core'
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
  | {
      readonly tool: 'spec_read'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['spec_read']>
    }
  | {
      readonly tool: 'spec_write'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['spec_write']>
    }
  | {
      readonly tool: 'spec_propose'
      readonly arguments: z.infer<(typeof TOOL_ARGUMENTS)['spec_propose']>
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
 * A list sent as JSON text inside one argument, read against its schema.
 *
 * The arguments stay flat (see the head of this file), and the stories, the tasks, the options of
 * a question and the assumptions of a phase are lists: each is one string argument holding a JSON
 * array, read here, where a list that does not read is refused with the reason, like any argument.
 */
export function jsonList<T>(item: z.ZodType<T>) {
  return z
    .string()
    .transform((text, context) => {
      try {
        return JSON.parse(text)
      } catch {
        context.addIssue({ code: 'custom', message: 'is not JSON' })
        return z.NEVER
      }
    })
    .pipe(z.array(item))
}

/** One story of `spec_write`, as its JSON text reads. */
export const STORY_SENT = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  narrative: z.string(),
  priority: z.string().nullable().optional(),
  criteria: z.array(z.string().min(1)),
})

/** One task of `spec_write`, as its JSON text reads. */
export const TASK_SENT = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  result: z.string(),
  type: z.string(),
  executor: z.enum(TASK_EXECUTORS),
  criteria: z.string(),
  dependsOn: z.array(z.string().min(1)).default([]),
  stories: z.array(z.string().min(1)).default([]),
})

/** One answer a question of `spec_write` offers, as its JSON text reads. */
export const OPTION_SENT = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  recommended: z.boolean().optional(),
})

/** How long a list of the Spec tools may be, as the JSON text it is sent as. */
const LIST_CHARACTERS = SPEC_PAGE_CHARACTERS

/** What `spec_write` writes: exactly one of the four. */
const SPEC_WRITES = ['section', 'stories', 'tasks', 'question'] as const

/** What `spec_propose` hands over. */
export const PROPOSALS = ['phase_done', 'ready', 'spec'] as const

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
  spec_read: z.object({
    revision: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('a revision of the Spec, by number, to read as it was; the current one without it'),
    offset: z.number().int().min(0).optional().describe('the character to start at; 0 without it'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SPEC_PAGE_CHARACTERS)
      .optional()
      .describe(`how many characters at most; ${SPEC_PAGE_CHARACTERS} without it`),
  }),
  spec_write: z
    .object({
      section: z
        .enum(SECTION_NAMES)
        .optional()
        .describe('the section to write; send body and baseVersion with it'),
      body: z
        .string()
        .max(SPEC_PAGE_CHARACTERS)
        .optional()
        .describe('with section: the whole Markdown text the section becomes'),
      baseVersion: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'with section: the version you read the section at, as spec_read shows it; 0 for a section the Spec does not hold yet',
        ),
      stories: z
        .string()
        .max(LIST_CHARACTERS)
        .optional()
        .describe(
          'every story of the Spec, in order, as a JSON array of {"id"?, "title", "narrative", "priority"?, "criteria": ["…"]}: it replaces them all; keep the id of a story you keep',
        ),
      tasks: z
        .string()
        .max(LIST_CHARACTERS)
        .optional()
        .describe(
          'every task of the contract, in order, as a JSON array of {"id"?, "title", "result", "type", "executor": "agent"|"human", "criteria", "dependsOn"?: ["task id or title"], "stories"?: ["story id or title"]}: it replaces them all',
        ),
      question: z
        .string()
        .min(1)
        .max(SPEC_PAGE_CHARACTERS)
        .optional()
        .describe('a question for the user, asked in the chat; send blocking with it'),
      blocking: z
        .boolean()
        .optional()
        .describe('with question: true when the Spec cannot be ready until it is answered'),
      phase: z.enum(PHASE_IDS).optional().describe('with question: the phase it belongs to'),
      options: z
        .string()
        .max(LIST_CHARACTERS)
        .optional()
        .describe(
          'with question: the answers offered, as a JSON array of {"id", "label", "recommended"?}; none for an answer in the user\'s own words',
        ),
      revision: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('the revision you read; a write naming one that is not the current is refused'),
      key: KEY.describe('an idempotency key, so a retry does not write twice'),
    })
    .superRefine((sent, context) => {
      const writes = SPEC_WRITES.filter((write) => sent[write] !== undefined)
      if (writes.length !== 1) {
        context.addIssue({
          code: 'custom',
          message: `send exactly one of section, stories, tasks or question, not ${writes.length === 0 ? 'none' : writes.join(' and ')}`,
        })
      }
      if (
        sent.section !== undefined &&
        (sent.body === undefined || sent.baseVersion === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'a section is sent with its body and baseVersion',
        })
      }
      if (sent.question !== undefined && sent.blocking === undefined) {
        context.addIssue({ code: 'custom', message: 'a question is sent with blocking' })
      }
      const lists = [
        ['stories', STORY_SENT],
        ['tasks', TASK_SENT],
        ['options', OPTION_SENT],
      ] as const
      for (const [field, item] of lists) {
        const text = sent[field]
        if (text === undefined) continue
        const listed = jsonList<z.infer<typeof item>>(item).safeParse(text)
        for (const issue of listed.success ? [] : listed.error.issues) {
          context.addIssue({ code: 'custom', path: [field, ...issue.path], message: issue.message })
        }
      }
    }),
  spec_propose: z
    .object({
      kind: z
        .enum(PROPOSALS)
        .describe(
          'phase_done: declare a phase finished, with a summary; ready: attest the contract is complete, for the user to mark it ready; spec: from a free Session, propose the user a Spec to create, with a title and a type',
        ),
      phase: z.enum(PHASE_IDS).optional().describe('with phase_done: the phase declared finished'),
      summary: z
        .string()
        .min(1)
        .max(SPEC_PAGE_CHARACTERS)
        .optional()
        .describe('with phase_done: what the phase settled, kept with the phase'),
      supporting: z
        .string()
        .max(SPEC_PAGE_CHARACTERS)
        .optional()
        .describe('with phase_done: the elements of the Spec that support it'),
      assumptions: z
        .string()
        .max(LIST_CHARACTERS)
        .optional()
        .describe(
          'with phase_done: the assumptions and questions still open, as a JSON array of strings',
        ),
      title: z.string().trim().min(1).max(200).optional().describe('with spec: its title'),
      type: z.enum(SPEC_TYPES).optional().describe('with spec: feature, bug or maintenance'),
    })
    .superRefine((sent, context) => {
      if (sent.kind === 'phase_done' && (sent.phase === undefined || sent.summary === undefined)) {
        context.addIssue({
          code: 'custom',
          message: 'phase_done is sent with a phase and a summary',
        })
      }
      if (sent.kind === 'spec' && (sent.title === undefined || sent.type === undefined)) {
        context.addIssue({ code: 'custom', message: 'spec is sent with a title and a type' })
      }
      if (sent.assumptions === undefined) return
      const listed = jsonList(z.string()).safeParse(sent.assumptions)
      for (const issue of listed.success ? [] : listed.error.issues) {
        context.addIssue({
          code: 'custom',
          path: ['assumptions', ...issue.path],
          message: issue.message,
        })
      }
    }),
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
  commands_run: `Ask for a command of the Project's catalogue to run, by name, or a one-off line, which the user is asked to allow before it runs. An app command that is already running is handed back rather than started twice. A check or a utility is waited for, up to timeout, and answers with its exit code and the end of its output; one still running then is left running in the background and its run id is given, so there is nothing to poll for. background: true answers at once. An app is left running as soon as it has started. The output, and the address it published, come back as they stand. Send a key so that a retry after a lost answer does not start it twice.`,
  commands_output:
    'What a run of this Session has printed, whoever started it, bounded, the address it published, and how it ended if it has.',
  commands_stop: 'Stop a run and everything it started.',
  project_get:
    'The Project this Session belongs to: its name, where its Workspace root is, and what it reads from.',
  session_get:
    'This Session: its title, its Project, its agent, and the last entries of its thread.',
  spec_read: `Read the Spec this Session defines, rendered as Markdown: its key, type, status and revision, each section with its version as <!-- version: n -->, the stories with their criteria, the tasks, the phases and the open questions. The current revision, or an older one by number, which is read-only. One call returns at most ${SPEC_PAGE_CHARACTERS} characters and ends with the range read as JSON: offset, end, size, truncated and next.`,
  spec_write: `Write the current draft of the Spec this Session defines, and only while this Session holds its write right. Exactly one of: a section, with its whole body and the version you read it at; every story; every task; or a question for the user, asked in the chat. A section that changed since the version you send, a Spec that is not a draft, an older revision, and a Session that does not hold the write right are refused, and nothing is written. Send a key so that a retry after a lost answer does not write twice.`,
  spec_propose:
    "Hand the Spec this Session defines over to Hemera's checks. phase_done declares a phase finished with a summary, the elements of the Spec that support it and the assumptions still open: Hemera runs the phase's exit checks, and either finishes it and opens the phases that wait on it, or answers what fails and changes nothing. ready attests the contract is complete and executable: the user's Mark ready is what freezes it, never this call. Both only while this Session holds the write right. spec is for a free Session, which defines no Spec yet: it proposes one, a title and a type, and the user creates it or not.",
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
  spec_read: `this Session's Spec, ${SPEC_PAGE_CHARACTERS / 1024} K characters a page`,
  spec_write: "one write of this Session's draft, on its current version",
  spec_propose:
    'a phase declared finished, the contract attested, or a Spec proposed; never marked ready',
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
    case 'spec_read':
      return decide(tool, read(TOOL_ARGUMENTS['spec_read'], raw))
    case 'spec_write':
      return decide(tool, read(TOOL_ARGUMENTS['spec_write'], raw))
    case 'spec_propose':
      return decide(tool, read(TOOL_ARGUMENTS['spec_propose'], raw))
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
