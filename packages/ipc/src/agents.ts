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
 * What an agent's adapter declares about running it bare on this platform (design D6-02).
 *
 * `means` is how its own tools are taken away, in the agent's own terms. `reason` is the
 * adapter's sentence for a combination that is not qualified, and null for one that is: a
 * Session is not made on an agent that is not qualified, and this is why.
 */
export const bareModeSchema = z.object({
  means: z.string(),
  qualified: z.boolean(),
  reason: z.string().nullable(),
})

export type BareModeState = z.infer<typeof bareModeSchema>

/**
 * One agent, as this machine answers for it (design D5-02, D5-17, D5-21).
 *
 * The agent, and never the adapter that may expose it: every name and every command on this wire
 * belongs to the tool the reader installed, and the package Hemera spawns on its behalf is named
 * nowhere (D5-21).
 *
 * `found` is whether the agent's own command is on the machine at all, and `version` is what it
 * answered to `--version`: null when it is not there, or there and silent about its version.
 * Null and not absent, because nothing is optional over this wire — a field the page does not
 * receive and a field nothing answered look the same to it, and the page has to say which one it
 * is showing.
 *
 * `authenticated` is what the login file that agent writes says: the file is looked for and never
 * opened, and signed in or not is the one bit of it the page shows (D5-21). An agent whose
 * credentials no file answers for — the Keychain on macOS, a keyring — reads as signed out here,
 * and the word that counts is the one it gives to a Session that asks it to `initialize` (D5-17).
 * `installHint` is the one sentence that says how to get the agent, and `loginHint` the command
 * that signs it in, which the page offers when it is not signed in.
 *
 * `latest` is the version published for the agent — Homebrew's formula for a `brew` install, the
 * npm registry for any other, `unknown` included — and it is null whenever nobody asked or the
 * registry answered nothing: the list a Session is created from is read locally, and only the
 * Agents section goes to the network, when it is opened (D5-18). The installer decides whether
 * an update is offered, never whether the version is read.
 *
 * `bareMode` is what the adapter declares and not what the machine answered: it is read off
 * Hemera's own adapter for this platform, so it is there whether or not the agent is (D6-02).
 */
export const agentAvailabilitySchema = z.object({
  id: agentProviderSchema,
  label: z.string(),
  found: z.boolean(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  installHint: z.string(),
  loginHint: z.string(),
  installer: installerToolSchema,
  latest: z.string().nullable(),
  bareMode: bareModeSchema,
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
 *
 * A value carries two things beside its name, and both are the agent's own (decision of
 * 22 September 2026). `description` is the sentence the agent wrote about that value, which is
 * the only thing that can say what a value like `Default` stands for — the window draws it where
 * there is one and draws nothing where there is not. `recommended` is the value the agent itself
 * named as the one it advises, resolved by the engine out of the announcement's `_meta`: it is
 * derived and never the raw metadata, because a page reading an agent's extension namespace
 * would be a page tied to the agents that write it.
 *
 * Both are absent rather than null where the agent said nothing, which is the one place this
 * wire allows it: they are not facts about the option but words the agent may or may not have
 * added to it, and a page that never received them draws what one told there are none draws.
 */
export const configOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  values: z.readonly(
    z.array(
      z.object({
        value: z.string(),
        name: z.string(),
        /** What the agent said this value is, where it said anything about it at all. */
        description: z.string().optional(),
        /** Whether the agent named this value as the one it recommends. */
        recommended: z.boolean().optional(),
      }),
    ),
  ),
  /** Which of the values the agent is on now, so the page shows it rather than guesses it. */
  current: z.string(),
})

export type ConfigOption = z.infer<typeof configOptionSchema>

/**
 * Why an agent has nothing to offer a Home's composer (design D5-17, D5-21).
 *
 * Three refusals rather than an empty list, because they are three different things to be told
 * and two of them have something the reader can do about them: the agent is not installed on
 * this machine, it is installed and nobody has signed it in, or it was started and would not
 * speak. `message` is the sentence the composer shows, written by the engine for a reader; the
 * `kind` is what the page draws it as. An agent that offers no options at all is not a refusal:
 * it answers an empty list and no refusal.
 */
export const agentOfferRefusalSchema = z.object({
  kind: z.enum(['not_installed', 'not_signed_in', 'failed']),
  message: z.string(),
})

export type AgentOfferRefusal = z.infer<typeof agentOfferRefusalSchema>

/**
 * What an agent offers before a Session holds it, or why it offers nothing.
 *
 * Both fields always cross, because a page cannot read a field it was not sent: the options are
 * empty when there is a refusal, and the refusal is null when there is not.
 */
export const agentOfferSchema = z.object({
  options: z.readonly(z.array(configOptionSchema)),
  refusal: agentOfferRefusalSchema.nullable(),
})

export type AgentOffer = z.infer<typeof agentOfferSchema>

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
  /**
   * Hemera's own, for a turn the agent answered with an error rather than a stop reason: its
   * provider refused the request, most often. Never `cancelled`, which is a Stop someone pressed;
   * the agent's sentence is the `note` written beside it.
   */
  'failed',
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

/**
 * How far a tool call got, in the words the thread draws it with (design D5-11).
 *
 * The first four are the protocol's own — a call is announced, runs, finishes or fails. The
 * fifth is Hemera's, for the one end ACP has no word for: a turn the user stopped leaves the
 * calls it was running unfinished, and a call left `in_progress` is a spinner that never stops.
 */
export const toolCallStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
])

export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>
