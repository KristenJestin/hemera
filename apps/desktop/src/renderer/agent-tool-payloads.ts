import { hemeraToolNamed } from '@hemera/core'
import type { CommandRun, SessionEntry } from '@hemera/ipc'
import type { CommandKind, CommandState, HemeraToolArgument, HemeraToolStatus } from '@hemera/ui'
import { z } from 'zod'

/**
 * The three kinds this lot writes, read out of their payload (design D6-06, D6-12, D6-10).
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
  kind: z.enum(['app', 'check', 'utility']),
  state: z.enum(['running', 'exited', 'failed', 'stopped']),
  cwd: z.string(),
  url: z.string().nullable().optional(),
  exitCode: z.number().nullable().optional(),
  oneOff: z.boolean().optional(),
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

/** What `HemeraToolCall` needs, read off a `hemera_tool_call` entry. */
export interface HemeraToolCallDrawn {
  readonly tool: string
  readonly status: HemeraToolStatus
  readonly summary: string
  readonly arguments: readonly HemeraToolArgument[]
  readonly paths: readonly string[]
  readonly ms: number | undefined
  readonly provenance: { readonly session: string; readonly agent: string; readonly token: string }
  readonly error: string | undefined
  readonly defaultOpen: boolean
}

/** `null` when the payload does not parse: the entry is left out rather than drawn from a guess. */
export function hemeraToolCallOf(entry: SessionEntry): HemeraToolCallDrawn | null {
  const read = readPayload(hemeraToolCallPayloadSchema, entry.payload)
  if (read === null) return null
  const { tool, state, caller, paths, arguments: bounded, agent, ms } = read
  return {
    tool,
    status: state,
    summary: entry.body,
    arguments: argumentsOf(bounded),
    paths,
    ms,
    provenance: { session: entry.sessionId, agent: agent ?? 'agent', token: caller },
    error: state !== 'completed' ? entry.body : undefined,
    defaultOpen: state !== 'completed',
  }
}

/** What `CommandRun` needs, read off a `command_run` entry. */
export interface CommandRunDrawn {
  /** The run it is, or null for an entry written before runs were named in it. */
  readonly runId: string | null
  readonly name: string
  readonly command: string
  readonly kind: CommandKind
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
  const { runId, name, line, kind, cwd, oneOff } = read
  const heard = runId === undefined ? undefined : live.find((one) => one.id === runId)
  const state = heard?.state ?? read.state
  const url = heard === undefined ? read.url : heard.url
  const exitCode = heard === undefined ? read.exitCode : heard.exitCode
  return {
    runId: runId ?? null,
    name,
    command: line,
    kind,
    state: state === 'exited' ? 'finished' : state,
    folder: cwd,
    url: url ?? undefined,
    exitCode: exitCode ?? undefined,
    oneOff,
    output: heard?.output ?? '',
  }
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
