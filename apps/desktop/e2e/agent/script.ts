/**
 * What the agent the suite talks to announces, and what it answers (design D5-16).
 *
 * The end-to-end suite needs an agent, and the one thing it may not have is a real one: no
 * verification depends on an account with a provider. So the agent is the engine's own fake —
 * a real ACP peer, with the protocol's framing, its handshake and its ids — and this file is the
 * part of it a suite reads back: the models it publishes, the answer it gives to the first
 * prompt, and the one it gives to the next.
 *
 * Two answers and not one, because what a reopened application has to prove is that the
 * conversation carried on: a second turn that said the same thing as the first would be a thread
 * nobody could tell apart from a replay.
 */

import type { SessionConfigOption } from '@agentclientprotocol/sdk'

/** What the command prints to `--version`, which is what the Agents page reads. */
export const VERSION = '1.18.31'

/** The agent this machine is given, under the name the interface calls it by. */
export const AGENT = 'OpenCode'

/** The models it publishes, which are its own and never a list frozen in Hemera. */
export const MODELS = [
  { value: 'fake-fast', name: 'Fake Fast' },
  { value: 'fake-deep', name: 'Fake Deep' },
] as const

/**
 * The one option it opens a session with: the models, under the category the menu reads.
 *
 * Built from the value it is on rather than copied and changed, because the protocol answers a
 * choice with the whole set of options as they stand: what the agent announces after a pick is
 * the same option, on another value.
 */
export function modelOption(current: string): SessionConfigOption {
  return {
    id: 'model',
    type: 'select',
    name: 'Model',
    category: 'model',
    currentValue: current,
    options: MODELS.map((model) => ({ value: model.value, name: model.name })),
  }
}

/** What it announces when a session opens, which is the first of its models. */
export const MODEL_OPTION = modelOption(MODELS[0].value)

/** What it thinks before it answers, one thought per turn, folded in the thread. */
export const THOUGHTS = [
  'Reading the export code before answering.',
  'Checking the change once more.',
] as const

/** What it answers, one message per turn, shown as a message and not as a thought. */
export const ANSWERS = [
  'The export drops the invoice date.',
  'It is fixed now: the date is written again.',
] as const

/** What the agent does on the turn of this number, counted from one. */
export function turnOf(turn: number) {
  const at = Math.min(Math.max(turn, 1), ANSWERS.length) - 1
  return { thought: THOUGHTS[at] ?? THOUGHTS[0], answer: ANSWERS[at] ?? ANSWERS[0] }
}

/**
 * The file a turn asks the agent to read, and what the agent answers once it has (design D6-11).
 *
 * A prompt that names it is answered with a call to Hemera's `fs_read` over the MCP server the
 * agent was handed, then this sentence: the read goes through Hemera's tools, never the agent's.
 */
export const NOTES = 'notes.md'

export const READ_ANSWER = 'The notes are read through Hemera.'

/**
 * What makes the agent propose a Spec: a prompt that asks for one (design D7-07).
 *
 * The agent answers, then proposes through Hemera's `spec_propose` with kind `spec`, the one Spec
 * tool a `free` Session is offered: Hemera writes the proposal the thread draws below the answer.
 * A prompt that does not ask is answered without one.
 */
export const PROPOSE = 'Write it down as a Spec.'

/** The Spec it proposes then. */
export const PROPOSAL = { title: 'CSV export keeps the invoice date', type: 'feature' } as const

/**
 * What makes the writer's agent finish the Spec (design D7-14): a prompt that asks for it.
 *
 * It writes through `spec_write` what the draft still lacks, declares `shape`, `plan` and
 * `decompose` finished through `spec_propose phase_done`, each once what it owns is written,
 * attests the contract through `spec_propose ready`, and says so. Only the human's Mark ready
 * freezes it.
 */
export const COMPLETE = 'Write the rest of the Spec, then attest it.'

/**
 * The sections it writes then, on the version `spec_read` would show: the sections of its type
 * the Spec was created with, empty, at `CONTRACT_VERSION`; `plan`, which it does not hold yet, at 0.
 */
export const WRITTEN = {
  expected_outcome: 'Every row of the invoice CSV export carries its issue date.',
  verification: 'An export of a month of invoices has no empty date cell.',
  behaviour: 'The date column is filled with the issue date, in ISO 8601.',
  plan: 'Read the issue date in the export query and format it in the CSV writer.',
} as const

/** The version of a section of the type's contract, created empty with the Spec. */
export const CONTRACT_VERSION = 1

/** The one story it writes, with its criterion, as the JSON `spec_write` reads. */
export const STORY = {
  title: 'Dated export',
  narrative: 'As an accountant, I read the issue date of each invoice in the CSV.',
  criteria: ['Every row carries the issue date'],
} as const

/** The one task, which covers the story, as the JSON `spec_write` reads. */
export const TASK = {
  title: 'Write the issue date',
  result: 'The CSV writer fills the date column',
  type: 'code',
  executor: 'agent',
  criteria: 'The export test passes',
  stories: [STORY.title],
} as const

/** What it says once the Spec is written and attested. */
export const COMPLETED = 'The Spec is written and attested: it is yours to mark ready.'

/**
 * What makes it write a section once more: `expected_outcome`, on the version its own write left
 * it at. On a Spec the human marked ready, the call is refused and nothing changes.
 */
export const REWRITE = 'Tighten the expected outcome.'

/** What it tries to write then, and what it says after the answer. */
export const REWRITTEN = 'Every row of every CSV export carries its issue date.'
export const REWRITE_ANSWER = 'I tried to tighten the expected outcome.'
