/**
 * The agents: what Hemera knows how to start, and what it is told about them (design D5-02).
 *
 * An agent is a command on this machine, and everything here is something that command
 * answered — that it is installed, which version it is, whether it is signed in, and what it
 * offers once a Session is running. None of it belongs to a Session: the same agent answers the
 * same for every Session that talks to it, so none of it is a row.
 *
 * The use cases that carry these answers are declared with every other one, in `engine.ts`.
 * What is here is what they answer with, so that an agent's own vocabulary stays in one place.
 */

import { z } from 'zod'

/** The agents Hemera knows how to start, as the interface is told them. */
export const agentProviderSchema = z.enum(['claude', 'codex', 'opencode'])

export type AgentProvider = z.infer<typeof agentProviderSchema>

/**
 * The installer a command came from (design D5-18).
 *
 * An agent is a global package before it is a command, and the tool that installed it is the
 * only one that can update it: `npm i -g`, `pnpm add -g`, `bun add -g` and `brew upgrade` are
 * four different ways to move the same binary, and none of them stands in for another. The tool
 * is read off the command's path — a pnpm global prefix, a Homebrew cellar — and `unknown` is
 * an honest answer rather than a guess: a command from anywhere else is one Hemera will not
 * offer to update.
 */
export const installerToolSchema = z.enum(['npm', 'pnpm', 'bun', 'brew', 'unknown'])

export type InstallerTool = z.infer<typeof installerToolSchema>

/**
 * One agent, as this machine answers for it (design D5-02, D5-17).
 *
 * `found` is whether the command is on the machine at all, and `version` is what it answered to
 * `--version`: null when it is not there, or there and silent about its version. Null and not
 * absent, because nothing is optional over this wire — a field the page does not receive and a
 * field nothing answered look the same to it, and the page has to say which one it is showing.
 *
 * `authenticated` is false until a Session has started the agent: being signed in is what an
 * agent reports when it is asked to `initialize`, and this page starts nothing (D5-17). When
 * the agent is not there, `installHint` is the one sentence that says how to get it.
 *
 * `latest` is the version published by the registry of `installer`, and it is null whenever
 * nobody asked: the list a Session is created from is read locally, and only the Agents section
 * goes to the network, when it is opened (D5-18).
 */
export const agentAvailabilitySchema = z.object({
  id: agentProviderSchema,
  label: z.string(),
  found: z.boolean(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  installHint: z.string(),
  installer: installerToolSchema,
  latest: z.string().nullable(),
})

export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>

/**
 * What an update answered (design D5-18).
 *
 * The tool's own output, kept whole: it is what the reader is shown under the button, and a
 * sentence Hemera wrote instead would hide the reason an update refused. `version` is what the
 * command reports once the update is over, or null when it reported nothing — the section
 * rechecks by itself, so this is only what the run itself said.
 */
export const agentUpdateSchema = z.object({
  output: z.string(),
  version: z.string().nullable(),
})

export type AgentUpdate = z.infer<typeof agentUpdateSchema>

/**
 * One choice an agent offers, and the one it is on now (design D5-13).
 *
 * An agent announces its own options when a Session starts — the models it can be asked for,
 * the mode it can be put in — and Hemera draws them as they come rather than holding a list of
 * its own. `category` is the agent's word for what an option is for, and null when it says
 * none: a list of the words Hemera knows would be a list of the agents it has tried.
 */
export const configOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  values: z.readonly(z.array(z.object({ value: z.string(), name: z.string() }))),
  /** Which of the values the agent is on now, so the page shows it rather than guesses it. */
  current: z.string(),
})

export type ConfigOption = z.infer<typeof configOptionSchema>

/**
 * How a turn ended, in the words of the protocol the agents speak (design D5-13).
 *
 * A turn is answered when it is over and not when it starts, and what it answers is why it
 * ended: the agent finished, ran out of tokens, was refused, or was stopped. `cancelled` is the
 * one the interface causes, by stopping the turn it started.
 */
export const stopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
  /**
   * Hemera's own, for a turn whose agent stopped running under it.
   *
   * The protocol has no word for it — an agent that dies answers nothing — and a turn that ended
   * because the process went is not a turn the user stopped, so the page has to be told which of
   * the two it is showing (design D5-12).
   */
  'interrupted',
])

export type StopReason = z.infer<typeof stopReasonSchema>

/**
 * How far a Session came back to its agent's own native session, which is what a resume answers
 * (design D5-06).
 *
 * `attached` when the agent took its own session back, `fallback` when it did not and the
 * thread is what it was given instead, `lost` when there was nothing left to come back to.
 * `none` is not among them: it is what a Session nothing has been asked of yet holds, and a
 * resume of one has nothing to answer.
 */
export const resumeStateSchema = z.enum(['attached', 'fallback', 'lost'])

export type ResumeState = z.infer<typeof resumeStateSchema>
