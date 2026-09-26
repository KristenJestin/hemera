import { hemeraToolNamed } from '@hemera/core'
import type { CommandRun as Run, SessionEntry, SpecType } from '@hemera/ipc'
import {
  AgentReport,
  AgentText,
  CommandProposal,
  CommandRun,
  CreateSpecProposal,
  DecisionSummary,
  DiffBlock,
  HemeraToolCall,
  type HemeraToolStatus,
  MessageGroup,
  MissionBrief,
  PermissionRequest,
  SpecQuestion,
  StoppedTurn,
  ThoughtBlock,
  ToolCallCard,
  toolKindLabel,
  type PermissionOption,
  type PermissionOptionKind,
  type PlanEntry,
  type PlanPriority,
  type PlanStatus,
  type SpecAnswer,
  type ToolKind,
  type ToolStatus,
  type TouchedFile,
  type UsageCost,
} from '@hemera/ui'
import type { ReactNode } from 'react'
import { z } from 'zod'

import {
  agentReportOf,
  commandProposalOf,
  commandRunOf,
  contextDeliveryOf,
  elsewhereOf,
  hemeraPermissionOf,
  hemeraToolCallOf,
  hemeraToolLabelOf,
  nativeSubjectOf,
  questionOpen,
  subjectOf,
} from './agent-tool-payloads.ts'
import {
  type DefinedSpec,
  briefOf,
  proposalOf,
  questionAnchor,
  questionEntryOf,
} from './spec-entries.ts'

/**
 * What each entry of a thread is drawn as (design D5-11, D5-14, D5-16).
 *
 * The thread a Session holds is not a list of messages: it is what the agent reported, entry by
 * entry, and the kind of an entry is what says which block draws it. This is the one place that
 * reads that — a page asks for the blocks of a thread and draws them, and the Session details ask
 * for the same thread for the two things they keep.
 *
 * Everything is parsed and nothing is assumed. `payload` is JSON text on the wire rather than a
 * shape of its own — the same column holds every kind's details, and each kind validates what it
 * reads (ipc, `sessionEntrySchema`) — so each shape the engine writes is declared here, and an
 * entry that does not parse is an entry this version does not know how to draw. It is left out
 * rather than drawn from a guess: a version that met a newer entry still draws the thread it
 * understands.
 */

/**
 * A text of a call, as the engine keeps it: cut when it was too long, and honest that it was.
 *
 * Every text a call carries arrives in this shape (engine, `agents/runtime.ts`): what is here,
 * whether that is all of it, and how long the whole was. A window that drew the text alone
 * would show the beginning of a build log as if it were the log.
 */
const boundedSchema = z.object({
  text: z.string(),
  truncated: z.boolean(),
  length: z.number(),
})

type Bounded = z.infer<typeof boundedSchema>

/** One file a call is about, and the line in it the agent pointed at. */
const locationSchema = z.object({ path: z.string(), line: z.number().nullable() })

/**
 * One block of what a call carries, as ACP defines it (the SDK's `ToolCallContent`), with every
 * text of it bounded.
 *
 * Read as one permissive shape rather than as three exact ones: a block of a kind this version
 * does not know is a block it leaves out, and a union would refuse the whole call because of it.
 */
const blockSchema = z.object({
  type: z.string(),
  text: boundedSchema.optional(),
  mime: z.string().nullable().optional(),
  path: z.string().optional(),
  oldText: boundedSchema.nullable().optional(),
  newText: boundedSchema.optional(),
  terminalId: z.string().optional(),
})

/** The `Call` the runtime stores under `tool_call` (engine, `agents/runtime.ts`). */
const callSchema = z.object({
  title: z.string(),
  kind: z.string().nullable(),
  status: z.string().nullable(),
  locations: z.array(locationSchema),
  content: z.array(blockSchema),
  /** What the tool was called with, in its own words, or null when the agent said nothing. */
  rawInput: boundedSchema.nullable(),
  /** What it answered, the same way, or null while it has not answered. */
  rawOutput: boundedSchema.nullable(),
})

/** A step of the plan the agent published, as it wrote it (the SDK's `PlanEntry`). */
const planEntrySchema = z.object({
  content: z.string(),
  status: z.string(),
  priority: z.string().optional(),
})

const choiceSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.string(),
})

const permissionSchema = z.object({
  toolCallId: z.string(),
  options: z.array(choiceSchema),
  /**
   * What one of Hemera's own tools asks about, beside the agent's own questions (D6-05): the
   * tool, the place it would act on as the path resolves, the root it is outside of, and the
   * line a one-off command would run. Absent from a question the agent asked itself.
   */
  tool: z.string().optional(),
  /** The place as the agent named it, before it was resolved. */
  named: z.string().optional(),
  resolved: z.string().optional(),
  root: z.string().optional(),
  line: z.string().nullable().optional(),
})

const decisionSchema = z.object({
  toolCallId: z.string(),
  optionId: z.string().nullable(),
})

const turnSchema = z.object({ stopReason: z.string() })

const planSchema = z.object({ entries: z.array(planEntrySchema) })

/**
 * What the turn has spent, as the runtime writes it under `usage` (design D5-20).
 *
 * Either half can be missing and the entry is written all the same: an agent that accounts for a
 * turn but announces no window leaves nothing to divide by, and one that announces a window and
 * accounts for nothing leaves the meter with what it is filling. Both are read as they came.
 */
const usageSchema = z.object({
  used: z.number().nullable(),
  size: z.number().nullable(),
  cost: z.object({ amount: z.number(), currency: z.string() }).nullable(),
})

const callPayloadSchema = z.object({ call: callSchema })

/** What the agent's own vocabulary is when it names something this window does not know. */
const TOOL_KINDS: readonly ToolKind[] = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
]

const TOOL_STATES: readonly ToolStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  // A call the turn was stopped under, which is neither done nor failed: the engine writes it
  // when a turn is cancelled, and the card has a dot of its own for it (ipc, `ToolCallStatus`).
  'cancelled',
]

const PLAN_STATES: readonly PlanStatus[] = ['pending', 'in_progress', 'completed']

const PLAN_PRIORITIES: readonly PlanPriority[] = ['high', 'medium', 'low']

const PERMISSION_KINDS: readonly PermissionOptionKind[] = [
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]

/**
 * Which of a closed list a value is, or what the caller says to read instead.
 *
 * The fallback is named by the caller rather than being the last of the list: what an unknown
 * kind means is a decision about the block that draws it, and a routine that picked for everyone
 * would put that decision where nobody would look for it.
 */
function among<T extends string>(allowed: readonly T[], said: string | null, or: T): T {
  return allowed.find((one) => one === said) ?? or
}

/**
 * The payload of an entry, read as the shape this kind is written in.
 *
 * Answering null for anything that does not parse, which is what an unknown entry gets: the
 * thread draws what it understands and says nothing about the rest (see the note above).
 */
function readPayload<S extends z.ZodType>(schema: S, payload: string): z.infer<S> | null {
  try {
    const read = schema.safeParse(JSON.parse(payload))
    return read.success ? read.data : null
  } catch {
    return null
  }
}

/**
 * The text a call attached, as one text: its content blocks, in the order it sent them.
 *
 * Null when it attached none, which is what says a card has nothing to show there. A block that
 * carries bytes rather than words — an image, a sound — has an empty text and is left out: a box
 * opened on nothing says less than no box at all.
 */
function textOf(blocks: readonly z.infer<typeof blockSchema>[]): Bounded | null {
  const said = blocks.filter(
    (block) => block.type === 'content' && block.text !== undefined && block.text.text !== '',
  )
  if (said.length === 0) return null
  return {
    text: said.map((block) => block.text?.text ?? '').join('\n\n'),
    truncated: said.some((block) => block.text?.truncated === true),
    length: said.reduce((whole, block) => whole + (block.text?.length ?? 0), 0),
  }
}

/**
 * One of a call's texts, drawn as the card's own section draws it.
 *
 * What was cut is said under what is left, rather than left to be guessed at: a reader looking
 * at the last line of a log has to know whether it is the last line of the log.
 *
 * In characters, because that is what the engine counted: `length` is the length of the string
 * the agent sent, and the same text is anywhere between one and four bytes a character once it
 * is written down. A number called bytes that is not one is worse than no number.
 */
function boundedNode(bounded: Bounded | null): ReactNode {
  if (bounded === null) return undefined
  return (
    <>
      {bounded.text}
      {bounded.truncated && (
        <p className="mt-1 text-muted-foreground">
          {`Truncated; ${String(bounded.length)} characters in all.`}
        </p>
      )}
    </>
  )
}

/** How much of what a change did, for the column: what the file gained and what it lost. */
function countsOf(oldText: string | null, newText: string) {
  const before = oldText === null ? [] : oldText.split('\n')
  const after = newText.split('\n')
  // The head and the tail both files share are not part of the change, and everything between
  // them is: what is left is what a reader would see coloured. It is not a full comparison — two
  // lines swapped would count as two of each — and it is what the column needs, which counts
  // rather than shows (the block above shows, and compares for itself).
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head += 1
  let tail = 0
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1
  }
  return { added: after.length - head - tail, removed: before.length - head - tail }
}

/** The states of Hemera's block a report of the agent can be in, before Hemera answered. */
const REPORTED_STATES: readonly HemeraToolStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
]

/** How the agent's report of one of Hemera's calls stands, in the block's words. */
function reportedStatus(status: string | null): HemeraToolStatus {
  // A call the turn was stopped under did not answer: the block has no word for a stop.
  if (status === 'cancelled') return 'failed'
  return among(REPORTED_STATES, status, 'pending')
}

/** Which Session block an entry is, when the thread is read in order. */
export interface AgentContext {
  /** When this render happened, so a line about time is written once. */
  now: number
  /** When the next entry was written, which is what a thought's seconds are measured to. */
  nextAt: number | null
  /** Answers the question of one block, by its identifier, in one of the options it offered. */
  onDecide: (toolCallId: string, option: PermissionOption) => void
  /** The runs of the Session as they were last pushed: what a run's block is drawn from (D6-12). */
  runs: readonly Run[]
  /** The name of the Session's Workspace, which a run elsewhere is told apart from (D8-08). */
  workspace: string | undefined
  /** Opens the address a run published, in the browser: this window is not one. */
  onOpenUrl: (url: string) => void
  /** Stops a run and everything it started. */
  onStopRun: (runId: string) => void
  /**
   * The agent's report of a call, by the identifier the agent gave it: what a question about
   * that call is headed by — the label and the subject of its line (recette 3 of 23 September
   * 2026).
   */
  reportedCall: (toolCallId: string) => SessionEntry | undefined
  /** Writes a command the agent proposed into the catalogue: the human's click (D8-11). */
  onAcceptProposal: (proposalId: string) => void
  /** Leaves it out of the catalogue, and says so on the proposal. */
  onDeclineProposal: (proposalId: string) => void
  /** Keeps a one-off run in the catalogue, which is the human's to do (D8-11). */
  onAddToCatalogue: (run: Run) => void
  /** What the Spec entries of the thread are drawn with. */
  spec: SpecContext
}

/** What the Spec entries of a thread need beyond themselves (D7-01, D7-07). */
export interface SpecContext {
  /** The whole thread, where the answer written beside a question is found. */
  thread: readonly SessionEntry[]
  /** The Spec the Session defines, or null while it is `free`. */
  specId: string | null
  /** That Spec as its first revision named it, once it is read: what a created proposal names. */
  defined: DefinedSpec | null
  /** The ids of the current revision's questions, null until the Spec is read. */
  asked: ReadonlySet<string> | null
  /** The proposals `Not now` was pressed on, in this window only: nothing keeps it. */
  declined: ReadonlySet<string>
  onAnswer: (questionId: string, answer: SpecAnswer) => void
  onCreate: (title: string, type: SpecType) => void
  onDecline: (entryId: string) => void
}

/**
 * The block an entry is drawn as, or null when the page draws it elsewhere.
 *
 * Two kinds are not blocks of the thread: the plan is the Session details', and the usage is the
 * composer's — both are states rather than events, and the thread already carries every call
 * they add up. The console is the third: what a terminal would show is not in the thread (the
 * engine does not answer `terminal/output`), so an entry that only names a console says its name
 * as the call it belongs to rather than opening an empty box.
 */
export function drawEntry(entry: SessionEntry, context: AgentContext): ReactNode | null {
  if (entry.kind === 'message') {
    return entry.role === 'user' ? null : <AgentText text={entry.body} />
  }

  if (entry.kind === 'thought') {
    const seconds =
      context.nextAt === null
        ? 0
        : Math.max(0, Math.round((context.nextAt - entry.createdAt) / 1000))
    return (
      <ThoughtBlock seconds={seconds}>
        <AgentText text={entry.body} />
      </ThoughtBlock>
    )
  }

  if (entry.kind === 'tool_call') {
    const read = readPayload(callPayloadSchema, entry.payload)
    if (read === null) return null
    const { call } = read
    // One of Hemera's own calls, reported by the agent before Hemera answered it: drawn as
    // Hemera's block, in the state the agent reports, until Hemera's entry takes its place.
    const hemera = hemeraToolNamed(call.title)
    if (hemera !== null) {
      return (
        <HemeraToolCall
          tool={hemera}
          {...hemeraToolLabelOf(hemera)}
          subject={subjectOf(hemera, call.rawInput?.text ?? '', context.runs)}
          status={reportedStatus(call.status)}
          summary={call.title}
          defaultOpen={false}
        />
      )
    }
    const said = textOf(call.content)
    // What came back is the tool's own answer where it gave one, and what it attached where it
    // did not. What it was called with is the raw input, and the attached text stands in for it
    // only when that text is not already the answer above — one box of a card is one thing.
    const output = call.rawOutput ?? said
    const input = call.rawInput ?? (output === said ? null : said)
    const kind = among(TOOL_KINDS, call.kind, 'other')
    return (
      <ToolCallCard
        title={call.title}
        kind={kind}
        subject={nativeSubjectOf(kind, call)}
        status={among(TOOL_STATES, call.status, 'pending')}
        locations={call.locations.map((location) => ({
          path: location.path,
          line: location.line ?? undefined,
        }))}
        input={boundedNode(input)}
        output={boundedNode(output)}
        error={call.status === 'failed' ? entry.body : undefined}
      />
    )
  }

  if (entry.kind === 'diff') {
    const blocks = readPayload(z.array(blockSchema), entry.payload) ?? []
    const changes = blocks.filter((block) => block.type === 'diff' && block.newText !== undefined)
    if (changes.length === 0) return null
    return (
      <div className="flex flex-col gap-2">
        {changes.map((change) => (
          <DiffBlock
            key={`${entry.id}:${change.path ?? ''}`}
            path={change.path ?? ''}
            oldText={change.oldText?.text ?? null}
            newText={change.newText?.text ?? ''}
          />
        ))}
      </div>
    )
  }

  if (entry.kind === 'permission_request') {
    // A question already answered is drawn by the decision written after it, without buttons.
    if (!questionOpen(entry)) return null
    const read = readPayload(permissionSchema, entry.payload)
    if (read === null) return null
    // A question of Hemera's own tools (D6-05): the tool by its name, the place it would act on
    // as the path resolves and the root it leaves, the line a one-off would run. Its two options
    // are this call's only — nothing is remembered, so there is no "always" to offer.
    if (read.tool !== undefined && read.resolved !== undefined) {
      return (
        <PermissionRequest
          toolName={read.tool}
          {...hemeraPermissionOf(read.tool, entry.body, read)}
          parameters={[
            { label: 'Resolved path', value: read.resolved },
            { label: 'Outside', value: read.root ?? 'the Workspace root' },
          ]}
          command={read.line ?? read.resolved}
          options={read.options.map((option) => ({
            optionId: option.optionId,
            name: option.name,
            kind: among(PERMISSION_KINDS, option.kind, 'reject_once'),
          }))}
          onDecide={(option) => context.onDecide(read.toolCallId, option)}
        />
      )
    }
    // An agent's own question is headed by the line of the call it is about, where the thread
    // holds the agent's report of it: the kind's label and what the call is about.
    const asked = context.reportedCall(read.toolCallId)
    const reported = asked === undefined ? null : readPayload(callPayloadSchema, asked.payload)
    const head =
      reported === null
        ? { label: undefined, subject: undefined, intent: entry.body }
        : {
            label: toolKindLabel(
              among(TOOL_KINDS, reported.call.kind, 'other'),
              reported.call.title,
            ),
            subject: nativeSubjectOf(among(TOOL_KINDS, reported.call.kind, 'other'), reported.call)
              ?.text,
            intent: 'asks for your permission',
          }
    return (
      <PermissionRequest
        toolName={entry.body}
        {...head}
        options={read.options.map((option) => ({
          optionId: option.optionId,
          name: option.name,
          kind: among(PERMISSION_KINDS, option.kind, 'reject_once'),
        }))}
        scope="For this Session"
        onDecide={(option) => context.onDecide(read.toolCallId, option)}
      />
    )
  }

  if (entry.kind === 'permission_decision') {
    const read = readPayload(decisionSchema, entry.payload)
    const refused = (read?.optionId ?? null) === null
    return (
      <DecisionSummary
        answer={entry.body}
        at={new Date(entry.createdAt).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        refused={refused}
      />
    )
  }

  if (entry.kind === 'turn') {
    const read = readPayload(turnSchema, entry.payload)
    // A turn that simply ended is not news: the agent's answer above it is. What is worth a line
    // is a turn that stopped for a reason the reader has to know about (D5-13).
    if (read === null || read.stopReason === 'end_turn') return null
    return (
      <StoppedTurn
        doing={entry.body}
        at={new Date(entry.createdAt).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        byTheReader={read.stopReason === 'cancelled'}
      />
    )
  }

  // The brief a `define` turn rode on: Hemera's line, folded, never a message of yours (D7-09).
  if (entry.kind === 'mission_brief') {
    const { title, detail, brief } = briefOf(entry)
    return <MissionBrief title={title} detail={detail} brief={brief} />
  }

  // A question of the Spec, asked here and answered here (D7-01). The answer written beside it is
  // drawn by the question itself, folded to what was chosen, and has no block of its own.
  if (entry.kind === 'spec_question') {
    const block = questionEntryOf(entry, context.spec.thread, context.spec.asked)
    if (block === null) return null
    const { question, cancelled } = block
    return (
      <div id={questionAnchor(question.id)}>
        <SpecQuestion
          question={question}
          cancelled={cancelled}
          onAnswer={(answer) => context.spec.onAnswer(question.id, answer)}
        />
      </div>
    )
  }

  if (entry.kind === 'spec_answer') return null

  // The Spec the agent of a `free` Session proposed, which `Create` accepts (D7-07).
  if (entry.kind === 'spec_proposal') {
    const { thread, specId, defined, declined } = context.spec
    const proposal = proposalOf(entry, thread, specId, defined, declined.has(entry.id))
    if (proposal === null) return null
    return (
      <CreateSpecProposal
        title={proposal.title}
        type={proposal.type}
        state={proposal.state}
        createdKey={defined?.key}
        onCreate={context.spec.onCreate}
        onDecline={() => context.spec.onDecline(entry.id)}
      />
    )
  }

  if (entry.kind === 'note') {
    const report = agentReportOf(entry)
    if (report !== null) {
      return (
        <AgentReport
          title={report.title}
          detail={report.detail}
          at={new Date(entry.createdAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        />
      )
    }
    return (
      <MessageGroup author="hemera" name="Hemera" lines={[{ id: entry.id, body: entry.body }]} />
    )
  }

  if (entry.kind === 'hemera_tool_call') {
    const drawn = hemeraToolCallOf(entry, context.runs)
    if (drawn === null) return null
    return <HemeraToolCall {...drawn} />
  }

  if (entry.kind === 'command_run') {
    // The run as the window last heard it, where it has: its address and what it printed arrive
    // between the two writes of its entry, and the panel beside the thread reads the same run.
    const drawn = commandRunOf(entry, context.runs)
    if (drawn === null) return null
    const { runId, ...shown } = drawn
    // What is kept is the run as it ran — its line and its folder — so only a run the window has
    // heard of can be added; the block offers it on a one-off alone.
    const heard = context.runs.find((one) => one.id === runId)
    return (
      <CommandRun
        {...shown}
        onOpenUrl={context.onOpenUrl}
        onStop={runId === null ? undefined : () => context.onStopRun(runId)}
        workspace={heard === undefined ? undefined : elsewhereOf(heard, context.workspace)}
        onAddToCatalogue={heard === undefined ? undefined : () => context.onAddToCatalogue(heard)}
      />
    )
  }

  if (entry.kind === 'command_proposal') {
    // A command the agent proposes, and nothing more until a human decides (D8-11): the decision
    // comes back as this same entry in its outcome, which draws the block again without buttons.
    const drawn = commandProposalOf(entry)
    if (drawn === null) return null
    const { proposalId, ...shown } = drawn
    return (
      <CommandProposal
        {...shown}
        onAccept={() => context.onAcceptProposal(proposalId)}
        onDecline={() => context.onDeclineProposal(proposalId)}
      />
    )
  }

  if (entry.kind === 'context_delivery') {
    // A delivery is Hemera's line and never the user's (D6-08): what changed, and its fingerprint.
    const drawn = contextDeliveryOf(entry)
    if (drawn === null) return null
    return (
      <MessageGroup author="hemera" name="Hemera" lines={[{ id: drawn.id, body: drawn.body }]} />
    )
  }

  return null
}

/** What the turn has spent, as the meter above the composer reads it (design D5-20). */
export interface TurnUsage {
  used: number
  /** How big the window is, or null when the agent announced none to divide by. */
  size: number | null
  cost?: UsageCost | undefined
}

/**
 * What the last accounted turn spent, or null when nothing has been accounted for.
 *
 * The last one and not a sum: what the agent announces is where the session stands, so adding
 * them up would count the same window twice over.
 */
export function usageOf(entries: readonly SessionEntry[]): TurnUsage | null {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry === undefined || entry.kind !== 'usage') continue
    const read = readPayload(usageSchema, entry.payload)
    if (read === null || read.used === null) return null
    return {
      used: read.used,
      size: read.size,
      cost:
        read.cost === null ? undefined : { amount: read.cost.amount, currency: read.cost.currency },
    }
  }
  return null
}

/** The plan the agent last published, which is the whole of it and never a merge. */
export function planOf(entries: readonly SessionEntry[]): readonly PlanEntry[] {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry === undefined || entry.kind !== 'plan') continue
    const read = readPayload(planSchema, entry.payload)
    if (read === null) return []
    return read.entries.map((step) => ({
      content: step.content,
      status: among(PLAN_STATES, step.status, 'pending'),
      priority: among(PLAN_PRIORITIES, step.priority ?? null, 'medium'),
    }))
  }
  return []
}

/** The files the turn has touched, counted, in the order the calls named them. */
export function touchedOf(entries: readonly SessionEntry[]): readonly TouchedFile[] {
  const files: TouchedFile[] = []
  for (const entry of entries) {
    if (entry.kind !== 'diff') continue
    const blocks = readPayload(z.array(blockSchema), entry.payload) ?? []
    for (const block of blocks) {
      if (block.type !== 'diff' || block.newText === undefined) continue
      const path = block.path ?? ''
      const counted = countsOf(block.oldText?.text ?? null, block.newText.text)
      const held = files.find((one) => one.path === path)
      if (held === undefined) files.push({ path, ...counted })
      else {
        held.added += counted.added
        held.removed += counted.removed
      }
    }
  }
  return files
}

/**
 * The permission the agent is waiting on, when it is waiting.
 *
 * A request is answered by the decision written after it, and the two share the call they are
 * about: that is what says the question is closed, rather than the fact that something else has
 * happened since. A Session whose agent was stopped mid-question has a request and no decision —
 * and is not waiting, because no turn is running (D5-17).
 */
export function waitingOf(entries: readonly SessionEntry[]): SessionEntry | null {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]
    if (entry === undefined) continue
    if (entry.kind === 'permission_decision') return null
    if (entry.kind === 'permission_request') {
      // A question the engine closed — answered, stopped, or left by an agent that died — is not
      // one the agent is waiting on, whatever follows it.
      if (entry.state !== 'pending') return null
      for (let after = at + 1; after < entries.length; after += 1) {
        const later = entries[after]
        if (later === undefined || later.kind !== 'permission_decision') continue
        const read = readPayload(decisionSchema, later.payload)
        const asked = readPayload(permissionSchema, entry.payload)
        if (read !== null && asked !== null && read.toolCallId === asked.toolCallId) return null
      }
      return entry
    }
  }
  return null
}
