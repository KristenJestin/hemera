import { COMMAND_TYPES, TOOL_LABELS, type ToolMark, hemeraToolNamed } from '@hemera/core'
import type { CommandRun, SessionEntry } from '@hemera/ipc'
import type {
  CommandProposalState,
  CommandState,
  CommandType,
  HemeraToolArgument,
  HemeraToolStatus,
  PortClaim,
  PortConflict,
  Readiness,
  ToolKind,
  ToolSubject,
} from '@hemera/ui'
import { z } from 'zod'

/**
 * The kinds Hemera writes into a thread, read out of their payload (design D6-06, D6-12, D6-10,
 * D8-11).
 *
 * Kept apart from `agent-blocks.tsx`, which draws them: that module imports `@hemera/ui`'s
 * components, which read the theme at module scope, so nothing that only wants to parse a
 * payload may import it. This module reads only, into a plain shape `agent-blocks.tsx` spreads
 * onto the block — a shape a test may check without a theme or a DOM.
 */

/**
 * What a call to one of Hemera's own tools carries (engine, `tools/catalogue.ts`).
 *
 * `agent` and `ms` are what the caller adds once it knows them, so a row written before they
 * were, is a row this schema still reads.
 */
const hemeraToolCallPayloadSchema = z.object({
  tool: z.string(),
  state: z.enum(['completed', 'failed', 'refused']),
  caller: z.string(),
  paths: z.array(z.string()),
  arguments: z.string(),
  agent: z.string().optional(),
  ms: z.number().optional(),
})

/** What a command Hemera ran for a Session carries (engine, `commands/service.ts`). */
const commandRunPayloadSchema = z.object({
  /** The run the entry is, which is what the run pushed as it changes is found by. */
  runId: z.string().optional(),
  name: z.string(),
  line: z.string(),
  type: z.enum(COMMAND_TYPES),
  state: z.enum(['running', 'exited', 'failed', 'stopped']),
  cwd: z.string(),
  url: z.string().nullable().optional(),
  exitCode: z.number().nullable().optional(),
  oneOff: z.boolean().optional(),
})

/**
 * What a command the agent proposed carries (engine, `tools/catalogue.ts`), and what the human
 * decided of it: the entry is written again in its outcome (engine, `commands/proposals.ts`).
 */
const commandProposalPayloadSchema = z.object({
  proposalId: z.string(),
  name: z.string(),
  line: z.string(),
  type: z.enum(COMMAND_TYPES),
  /** A repository of the Project, or null for the Workspace root. */
  folder: z.string().nullable(),
  why: z.string(),
  state: z.enum(['pending', 'accepted', 'declined']),
})

/** What one thing delivered to the agent carries (engine, `context/service.ts`). */
const contextDeliveryPayloadSchema = z.object({ fingerprint: z.string() })

/**
 * The payload of an entry, read as the shape this kind is written in.
 *
 * Answering null for anything that does not parse, which is what an unknown entry gets: the
 * thread draws what it understands and says nothing about the rest.
 */
function readPayload<S extends z.ZodType>(schema: S, payload: string): z.infer<S> | null {
  try {
    const read = schema.safeParse(JSON.parse(payload))
    return read.success ? read.data : null
  } catch {
    return null
  }
}

/** How many characters of a fingerprint are shown, enough to tell two apart at a glance. */
const FINGERPRINT_CHARACTERS = 12

/**
 * The arguments of a Hemera tool call, read out of the JSON text the engine bounded to 400
 * characters — one pair per key, or one pair holding the raw text when the bound cut it short
 * enough that it no longer parses.
 */
export function argumentsOf(bounded: string): readonly HemeraToolArgument[] {
  try {
    const parsed = JSON.parse(bounded)
    return Object.entries(parsed).map(([label, value]) => ({ label, value: String(value) }))
  } catch {
    return [{ label: 'arguments', value: bounded }]
  }
}

/** How many characters of a query or a command line the line shows; the rest is in its title. */
const SUBJECT_CHARACTERS = 60

/** A subject that is not a path, cut to what the line shows and whole where the pointer rests. */
function shortened(text: string): ToolSubject {
  if (text.length <= SUBJECT_CHARACTERS) return { text }
  return { text: `${text.slice(0, SUBJECT_CHARACTERS - 1)}…`, full: text }
}

/** What a string argument is written as in JSON text: a quoted string, escapes and all. */
const JSON_STRING = String.raw`"((?:[^"\\]|\\.)*)"`

/**
 * One string argument of a call, out of JSON text that may have been cut short.
 *
 * The engine keeps the first 400 characters of the arguments, so a write carrying a whole file
 * is JSON that no longer parses — and its path, written first, is still there to be read. What
 * does parse is read as JSON; what does not is looked for as `"key": "value"`, and a value the
 * cut went through is not found at all rather than found half.
 */
function stringArgument(bounded: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const read = readPayload(z.object({ [key]: z.string() }), bounded)
    const value = read?.[key]
    if (value !== undefined) return value
  }
  for (const key of keys) {
    const found = new RegExp(`"${key}"\\s*:\\s*${JSON_STRING}`).exec(bounded)?.[1]
    if (found === undefined) continue
    const value = readPayload(z.string(), `"${found}"`)
    if (value !== null) return value
  }
  return undefined
}

/** A path as a subject: whole, because the line truncates it, and the press that goes there. */
function pathSubject(path: string): ToolSubject {
  return { text: path, path }
}

/**
 * What a call to one of Hemera's tools is about, read from its arguments (recette 3 of
 * 23 September 2026): the line reads "Read file notes.md", not "fs_read".
 *
 * The file of the three that touch one; the folder a listing is of, the Workspace root itself
 * named `root`; the query of a search, quoted, and the folder it was kept to; the catalogue name
 * or the one-off line a command was run by; the name of the run a stop or an output is about,
 * which the runs of the Session know and the arguments only hold the identifier of. Of the Spec
 * tools: an earlier version read, in the reader's words and not the engine's revision number; the
 * section, the list or the question written; the phase declared, `ready`, or the title of a Spec
 * proposed. Nothing for the three that are about nothing but the Project, the catalogue or the
 * Session, nor for a read of the current revision.
 */
export function subjectOf(
  tool: string,
  bounded: string,
  runs: readonly Pick<CommandRun, 'id' | 'name'>[] = [],
): ToolSubject | undefined {
  switch (hemeraToolNamed(tool)) {
    case 'fs_read':
    case 'fs_write':
    case 'fs_edit': {
      const path = stringArgument(bounded, ['path'])
      return path === undefined ? undefined : pathSubject(path)
    }
    case 'fs_list': {
      const path = stringArgument(bounded, ['path']) ?? '.'
      return path === '' || path === '.' || path === './' ? { text: 'root' } : pathSubject(path)
    }
    case 'search': {
      const query = stringArgument(bounded, ['query'])
      if (query === undefined) return undefined
      const within = stringArgument(bounded, ['path'])
      return shortened(within === undefined ? `"${query}"` : `"${query}" in ${within}`)
    }
    case 'commands_run': {
      const named = stringArgument(bounded, ['name', 'line'])
      return named === undefined ? undefined : shortened(named)
    }
    case 'commands_stop':
    case 'commands_output': {
      const run = stringArgument(bounded, ['run'])
      if (run === undefined) return undefined
      return shortened(runs.find((one) => one.id === run)?.name ?? run)
    }
    case 'spec_read': {
      const revision = new RegExp(String.raw`"revision"\s*:\s*(\d+)`).exec(bounded)?.[1]
      return revision === undefined ? undefined : { text: 'an earlier version' }
    }
    case 'spec_write': {
      const section = stringArgument(bounded, ['section'])
      if (section !== undefined) return { text: section }
      // A list is JSON text the bound may have cut: its name is enough to say what was written.
      for (const list of ['stories', 'tasks'])
        if (bounded.includes(`"${list}"`)) return { text: list }
      const question = stringArgument(bounded, ['question'])
      return question === undefined ? undefined : shortened(question)
    }
    case 'spec_propose': {
      const kind = stringArgument(bounded, ['kind'])
      if (kind === 'ready') return { text: 'ready' }
      const named = stringArgument(bounded, [kind === 'spec' ? 'title' : 'phase'])
      return named === undefined ? undefined : shortened(named)
    }
    case 'commands_list':
    case 'project_get':
    case 'session_get':
    case null:
      return undefined
  }
}

/** The keys an agent's own tools name what a call is about under, by the kind of the call. */
const NATIVE_KEYS: Record<ToolKind, readonly string[]> = {
  read: ['file_path', 'filePath', 'path', 'notebook_path'],
  edit: ['file_path', 'filePath', 'path', 'notebook_path'],
  delete: ['file_path', 'filePath', 'path'],
  move: ['source', 'from', 'file_path', 'filePath', 'path'],
  search: ['pattern', 'query'],
  execute: ['command', 'cmd'],
  fetch: ['url'],
  think: [],
  other: ['file_path', 'filePath', 'path', 'command', 'query', 'pattern', 'url'],
}

/** What an agent reports of one of its own calls, as far as its subject goes. */
export interface ReportedCall {
  readonly title: string
  readonly locations: readonly { readonly path: string; readonly line: number | null }[]
  readonly rawInput: { readonly text: string } | null
}

/**
 * What an agent's own call is about, by the same rule as Hemera's (recette 3 of 23 September
 * 2026): the file the call reported touching first; else what its input names under the key its
 * kind is read by — the file, the query, quoted, the command line, the address; else, for a call
 * of a kind, the title the agent gave it, which is where an agent that sends no input says it.
 * A call of no kind is read by its title already, so its title is not said twice.
 */
export function nativeSubjectOf(kind: ToolKind, call: ReportedCall): ToolSubject | undefined {
  const first = call.locations[0]
  if (first !== undefined) {
    return {
      text: first.line === null ? first.path : `${first.path}:${first.line}`,
      path: first.path,
    }
  }
  const input = call.rawInput?.text ?? ''
  const keys = NATIVE_KEYS[kind]
  const said =
    stringArgument(input, keys) ??
    // A command may be sent as its words rather than as one line.
    keys
      .map((key) => readPayload(z.object({ [key]: z.array(z.string()) }), input)?.[key]?.join(' '))
      .find((line) => line !== undefined)
  if (said !== undefined) {
    if (kind === 'search') return shortened(`"${said}"`)
    if (kind === 'read' || kind === 'edit' || kind === 'delete' || kind === 'move') {
      return pathSubject(said)
    }
    return shortened(said)
  }
  if (kind === 'other' || kind === 'think') return undefined
  return shortened(call.title)
}

/** What `HemeraToolCall` needs, read off a `hemera_tool_call` entry. */
export interface HemeraToolCallDrawn {
  readonly tool: string
  readonly label: string
  readonly mark: ToolMark | undefined
  readonly subject: ToolSubject | undefined
  readonly status: HemeraToolStatus
  readonly summary: string
  readonly arguments: readonly HemeraToolArgument[]
  readonly ms: number | undefined
  readonly error: string | undefined
  /** How a call Hemera answered "not yet" ended, in the few words its line says. */
  readonly note: string | undefined
  readonly defaultOpen: boolean
}

/** What a reader calls one of Hemera's tools and the mark it wears; its own name for a stranger. */
export function hemeraToolLabelOf(tool: string): { label: string; mark: ToolMark | undefined } {
  const named = hemeraToolNamed(tool)
  return named === null ? { label: tool, mark: undefined } : TOOL_LABELS[named]
}

/**
 * A phase the agent proposed finished before it could be (D7-08): the protocol refused it, and the
 * refusal is a "not yet" rather than a mistake (issue #134) — the agent carries on, and the thread
 * folds the call to a quiet line. The engine words it `The shape phase cannot finish: …`; the line
 * names the question when a question is what holds it.
 */
function notYetOf(tool: string, state: string, body: string): string | null {
  if (tool !== 'spec_propose' || state !== 'refused') return null
  if (!/^The \w+ phase cannot finish: /.test(body)) return null
  return body.includes('a blocking question is open') ? 'not yet: a question is open' : 'not yet'
}

/**
 * `null` when the payload does not parse: the entry is left out rather than drawn from a guess.
 *
 * `runs` are the Session's runs as the window last heard them, which is where the name of the
 * run a stop or an output was about is found.
 */
export function hemeraToolCallOf(
  entry: SessionEntry,
  runs: readonly Pick<CommandRun, 'id' | 'name'>[] = [],
): HemeraToolCallDrawn | null {
  const read = readPayload(hemeraToolCallPayloadSchema, entry.payload)
  if (read === null) return null
  const { tool, state, arguments: bounded, ms } = read
  const said = state === 'completed' ? entry.body : plainRefusal(entry.body)
  const notYet = notYetOf(tool, state, entry.body)
  return {
    tool,
    ...hemeraToolLabelOf(tool),
    subject: subjectOf(tool, bounded, runs),
    status: notYet === null ? state : 'deferred',
    summary: said,
    arguments: argumentsOf(bounded),
    ms,
    error: state !== 'completed' ? said : undefined,
    note: notYet ?? undefined,
    defaultOpen: state !== 'completed' && notYet === null,
  }
}

/**
 * What a run shows of what it ran beside its line (D8-06, D8-09): where its address stands, the
 * variables it was given, and a port conflict on either side of it. Nothing until the window has
 * heard of the run: the entry alone carries none of it.
 */
export interface RunFacts {
  readonly readiness: Readiness | undefined
  readonly environment: Readonly<Record<string, string>>
  readonly portConflict: PortConflict | undefined
  readonly heldAgainst: readonly PortClaim[]
}

export function runFactsOf(run: CommandRun | undefined): RunFacts {
  const conflict = run?.portConflict ?? null
  return {
    readiness: run?.readiness ?? undefined,
    environment: run?.environment ?? {},
    portConflict:
      conflict === null
        ? undefined
        : {
            port: conflict.port,
            holderRun: conflict.name,
            holderWorkspace: conflict.workspaceName,
          },
    heldAgainst: (run?.heldAgainst ?? []).map((one) => ({
      port: one.port,
      run: one.name,
      workspace: one.workspaceName,
    })),
  }
}

/** What a Spec's status is, said to the reader where the engine names the value. */
function statusSaid(status: string): string {
  if (status === 'ready') return 'is marked ready'
  if (status === 'in_progress') return 'is being built'
  return 'was cancelled'
}

/**
 * The core's refusals of a Spec write, in the reader's words (`writable`, `StaleSectionError`).
 *
 * The agent is answered in the engine's words, which name the revision, the version and the
 * status it works with; the card in the thread says the same refusal as the Spec panel would.
 * The sentence is matched at its start and what follows it is kept; one this does not know is
 * shown as the engine wrote it.
 */
const REFUSALS: readonly (readonly [RegExp, (...parts: string[]) => string])[] = [
  [
    /^revision \d+ of (\S+) is not its current revision/,
    (key) => `This is an earlier version of ${key}; only the latest can be changed`,
  ],
  [
    /^(\S+) is (ready|in_progress|cancelled): only a draft is written/,
    (key, status) => `${key} ${statusSaid(status)}; only a draft can be changed`,
  ],
  [/^(\S+) has no writer Session/, (key) => `No Session is set to change ${key}`],
  [
    /^the write right on (\S+) belongs to the Session "(.*)"/,
    (key, title) => `Only the Session "${title}" can change ${key}`,
  ],
  [
    /^the (\w+) section changed since version \d+: it is at version \d+/,
    (section) => `The ${section.replaceAll('_', ' ')} section changed since the agent read it`,
  ],
]

/** A refused call's line in the reader's words, or the line as it came when it is not a Spec's. */
export function plainRefusal(text: string): string {
  for (const [pattern, say] of REFUSALS) {
    const found = pattern.exec(text)
    if (found !== null) return say(...found.slice(1)) + text.slice(found[0].length)
  }
  return text
}

/** What `CommandRun` needs, read off a `command_run` entry. */
export interface CommandRunDrawn extends RunFacts {
  /** The run it is, or null for an entry written before runs were named in it. */
  readonly runId: string | null
  readonly name: string
  readonly command: string
  readonly type: CommandType
  readonly state: CommandState
  readonly folder: string
  readonly url: string | undefined
  readonly exitCode: number | undefined
  readonly oneOff: boolean | undefined
  /** What it printed, as the run pushed it last; empty until the window has heard of it. */
  readonly output: string
}

/**
 * `null` when the payload does not parse: the entry is left out rather than drawn from a guess.
 *
 * The entry is written when the run starts and when it ends; `live` holds the runs of the Session
 * as they were last pushed, and the one this entry is which knows what came between — the address it published, what it printed, and an end
 * the entry has not been rewritten with yet. Where the window has heard of the run, it is what is
 * drawn: the thread's block and the Commands panel show the same run (D6-12).
 */
export function commandRunOf(
  entry: SessionEntry,
  live: readonly CommandRun[] = [],
): CommandRunDrawn | null {
  const read = readPayload(commandRunPayloadSchema, entry.payload)
  if (read === null) return null
  const { runId, name, line, type, cwd, oneOff } = read
  const heard = runId === undefined ? undefined : live.find((one) => one.id === runId)
  const state = heard?.state ?? read.state
  const url = heard === undefined ? read.url : heard.url
  const exitCode = heard === undefined ? read.exitCode : heard.exitCode
  return {
    runId: runId ?? null,
    name,
    command: line,
    type,
    state: state === 'exited' ? 'finished' : state,
    folder: cwd,
    url: url ?? undefined,
    exitCode: exitCode ?? undefined,
    oneOff,
    output: heard?.output ?? '',
    ...runFactsOf(heard),
  }
}

/** What `CommandProposal` needs, read off a `command_proposal` entry (D8-11). */
export interface CommandProposalDrawn {
  /** What Accept and Decline name the proposal by. */
  readonly proposalId: string
  readonly name: string
  readonly line: string
  readonly type: CommandType
  /** Where it would run, `.` for the Workspace root, which is what the block says it as. */
  readonly folder: string
  readonly why: string
  readonly state: CommandProposalState
}

/** `null` when the payload does not parse: the entry is left out rather than drawn from a guess. */
export function commandProposalOf(entry: SessionEntry): CommandProposalDrawn | null {
  const read = readPayload(commandProposalPayloadSchema, entry.payload)
  if (read === null) return null
  return { ...read, folder: read.folder ?? '.' }
}

/**
 * The Workspace a run's block names, or undefined when it is the Session's own (D8-08): a
 * Project-scoped service asked for from a Session elsewhere runs in `main` (D8-07). Undefined too
 * while the Session's own is not known, rather than naming every run.
 */
export function elsewhereOf(run: CommandRun, own: string | undefined): string | undefined {
  return own === undefined || run.workspaceName === own ? undefined : run.workspaceName
}

/** What the thread shows of a `context_delivery` entry: one line, like a `note`. */
export interface ContextDeliveryDrawn {
  readonly id: string
  readonly body: string
}

/** `null` when the payload does not parse: the entry is left out rather than drawn from a guess. */
export function contextDeliveryOf(entry: SessionEntry): ContextDeliveryDrawn | null {
  const read = readPayload(contextDeliveryPayloadSchema, entry.payload)
  if (read === null) return null
  const short = read.fingerprint.slice(0, FINGERPRINT_CHARACTERS)
  return { id: entry.id, body: `${entry.body} (${short})` }
}

/**
 * Whether a permission question still waits for the reader, and so is drawn with its buttons.
 *
 * The engine rewrites the request in the state it closed in — decided, refused, cancelled — and
 * writes the decision after it (D5-09, D6-05). A closed question is drawn by that decision alone,
 * one line. Read from the entry and nothing the window holds, so a Session read back draws it
 * as an open one does.
 */
export function questionOpen(entry: SessionEntry): boolean {
  return entry.state === 'pending'
}

/** What the agent reports of a call, as far as telling one of Hemera's apart goes. */
const reportedCallSchema = z.object({ call: z.object({ title: z.string() }) })

/** What the agent says it called with, which is where its idempotency key is when it sent one. */
const reportedInputSchema = z.object({
  call: z.object({ rawInput: z.object({ text: z.string() }).nullable() }),
})

/** The two things a Hemera entry names its call by, beside the tool (engine, `catalogue.ts`). */
const hemeraCallNamesSchema = z.object({
  callId: z.string().nullable().optional(),
  key: z.string().nullable().optional(),
})

/** The idempotency key an agent's report of a call says it sent, or null. */
function reportedKeyOf(entry: SessionEntry): string | null {
  const text = readPayload(reportedInputSchema, entry.payload)?.call.rawInput?.text ?? null
  if (text === null) return null
  return readPayload(z.object({ key: z.string() }), text)?.key ?? null
}

/** The agent's identifier of a reported call: its `tool_call` entry is correlated by it. */
function reportedIdOf(entry: SessionEntry): string | null {
  const id = entry.correlationId ?? ''
  return id.startsWith('call:') ? id.slice('call:'.length) : null
}

/** The tool of Hemera's an entry is about, whichever end reported it, or null. */
function hemeraToolOf(entry: SessionEntry): string | null {
  if (entry.kind === 'hemera_tool_call') return hemeraToolCallOf(entry)?.tool ?? null
  if (entry.kind !== 'tool_call') return null
  return hemeraToolNamed(readPayload(reportedCallSchema, entry.payload)?.call.title ?? '')
}

/** What the thread draws once for each of Hemera's calls rather than twice (D6-06). */
export interface FoldedCalls {
  /** Hemera's entries drawn in the place of the agent's report of them, not where they stand. */
  readonly hidden: ReadonlySet<string>
  /** The entry drawn in the place of an agent's report: Hemera's own, once it was written. */
  readonly inPlaceOf: ReadonlyMap<string, SessionEntry>
}

/**
 * Pairs each agent's report of a Hemera call with the entry Hemera wrote for it (D6-06).
 *
 * The call is drawn once, as Hemera's block — distinct from a native call, which is the point —
 * and in the place where the agent reported it, which is when it happened. The agent's entry is
 * kept in the thread and in the Journal; only its drawing is folded.
 *
 * They are paired by what both carry, first: the agent's identifier of the call, when its request
 * sent one (Claude Code does), then the idempotency key the agent sent with it. Only what neither
 * names is paired in order, tool by tool: the first such report of `fs_read` with the first such
 * entry. Order alone goes wrong as soon as one call has no entry — a retry answered from memory,
 * a call still running — or calls finish out of order. A report whose entry Hemera has not
 * written yet is drawn as Hemera's block in the state the agent reports.
 */
export function foldedCallsOf(entries: readonly SessionEntry[]): FoldedCalls {
  const reports: { readonly entry: SessionEntry; readonly tool: string }[] = []
  const written: { readonly entry: SessionEntry; readonly tool: string }[] = []
  for (const entry of entries) {
    const tool = hemeraToolOf(entry)
    if (tool === null) continue
    ;(entry.kind === 'tool_call' ? reports : written).push({ entry, tool })
  }
  const hidden = new Set<string>()
  const inPlaceOf = new Map<string, SessionEntry>()
  const pair = (report: SessionEntry, answer: SessionEntry) => {
    hidden.add(answer.id)
    inPlaceOf.set(report.id, answer)
  }
  const namesOf = (entry: SessionEntry) => readPayload(hemeraCallNamesSchema, entry.payload)
  const unpaired = (tool: string) =>
    written.filter((one) => one.tool === tool && !hidden.has(one.entry.id))

  // By the agent's own identifier of the call, which only that call carries.
  for (const report of reports) {
    const id = reportedIdOf(report.entry)
    if (id === null) continue
    const answer = unpaired(report.tool).find((one) => namesOf(one.entry)?.callId === id)
    if (answer !== undefined) pair(report.entry, answer.entry)
  }
  // By the key the agent sent, which names one call and its retries: the first report under it.
  for (const report of reports) {
    if (inPlaceOf.has(report.entry.id)) continue
    const key = reportedKeyOf(report.entry)
    if (key === null) continue
    const answer = unpaired(report.tool).find((one) => namesOf(one.entry)?.key === key)
    if (answer !== undefined) pair(report.entry, answer.entry)
  }
  // In order, among what names nothing either end can match on. A report whose key an entry
  // already carries is a retry answered from memory, which has no entry of its own.
  for (const report of reports) {
    if (inPlaceOf.has(report.entry.id)) continue
    const key = reportedKeyOf(report.entry)
    if (key !== null && written.some((one) => namesOf(one.entry)?.key === key)) continue
    const answer = unpaired(report.tool).find((one) => {
      const names = namesOf(one.entry)
      return (names?.callId ?? null) === null && (names?.key ?? null) === null
    })
    if (answer !== undefined) pair(report.entry, answer.entry)
  }
  return { hidden, inPlaceOf }
}

/** What a permission card is headed by: the label, the subject and what the call asks. */
export interface PermissionHead {
  readonly label: string | undefined
  readonly subject: string | undefined
  readonly intent: string
}

/**
 * The head of a question one of Hemera's tools asks (D6-05), in the words of the call's own line
 * (recette 3 of 23 September 2026): "Write file ../outside.txt asks to act outside the
 * Workspace", not "fs_write asks to act outside the Workspace: /home/…/outside.txt".
 *
 * The subject is what the agent named — the path as it wrote it, the line a one-off would run —
 * and the intent is the engine's sentence without the two things the card already says: the
 * tool's code name in front, and the resolved place, which is a parameter of the card. A tool
 * the catalogue does not know keeps the sentence whole.
 */
export function hemeraPermissionOf(
  tool: string,
  body: string,
  asked: {
    readonly named?: string | undefined
    readonly resolved?: string | undefined
    readonly line?: string | null | undefined
  },
): PermissionHead {
  const named = hemeraToolNamed(tool)
  if (named === null) return { label: undefined, subject: undefined, intent: body }
  const { label } = TOOL_LABELS[named]
  const line = asked.line ?? null
  const subject = line ?? asked.named
  let intent = body.startsWith(`${tool} `) ? body.slice(tool.length + 1) : body
  if (line !== null && intent.startsWith(`asks to run ${line} `)) {
    intent = `asks to run ${intent.slice(`asks to run ${line} `.length)}`
  }
  const resolved = asked.resolved
  if (resolved !== undefined && intent.endsWith(`: ${resolved}`)) {
    intent = intent.slice(0, -(resolved.length + 2))
  }
  return { label, subject, intent }
}
