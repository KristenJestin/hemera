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
 * The command a turn that names it has the agent propose for the catalogue (design D8-11).
 *
 * A prompt that says `seed` is answered with a call to Hemera's `commands_propose` over MCP, then
 * the sentence below: the agent proposes, and only a human's "Accept" writes the catalogue. The
 * line is Node's own, which is on the `PATH` of whatever runs the suite.
 */
export const PROPOSAL = {
  name: 'seed',
  line: `node -e "console.log('seeded')"`,
  type: 'script',
  why: 'The data is seeded by hand before every trial.',
} as const

export const PROPOSE_ANSWER = 'A human decides whether seed is kept.'
