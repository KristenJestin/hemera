/**
 * What makes an agent run bare: its own tools gone, Hemera's the only ones left (design D6-02,
 * D6-09).
 *
 * There is no native mode and no toggle. Every Session is bare, or it is not opened at all, and
 * the means belongs to each agent: one reads its options out of `session/new`'s `_meta`, the
 * other two take them from the environment and a directory of Hemera's own. What each adapter
 * declares is that means, and the answer to the only question that matters here — whether the
 * means removes *every* tool the agent ships. Claude Code and OpenCode answer yes and carry the
 * options to hand over; Codex answers no, and the residue it keeps is the reason its Sessions
 * are refused. That is why the options sit inside the qualified case of the declaration rather
 * than beside it: an agent that is not qualified has none to give, and no caller can ask it.
 *
 * The declarations come from the spike `docs/technical/bare-mode-2026-09.md` (21 September 2026),
 * which read them in the three agents' own sources. Until the phase 3 trial per agent and
 * platform, what is written here is what those sources say, not what a run has shown.
 *
 * The platform is a parameter and not `process.platform`: the answer is declared per platform
 * (D6-02), and the one place where the two differ today — OpenCode's wildcard matching is
 * case-insensitive on Windows only — has to be checkable from a machine that is neither.
 */

import { Data, Effect } from 'effect'

import type { AgentAdapter } from './adapter.ts'

/**
 * The options Claude Code reads out of `session/new`'s `_meta` (D6-02).
 *
 * It is the only agent of the three that takes its options there: the ACP field itself carries
 * `mcpServers` for all of them, and the rest comes from the environment.
 */
export type ClaudeCodeMeta = {
  readonly claudeCode: {
    readonly options: {
      /** The built-in tools: none of them, with the MCP tools kept. */
      readonly tools: readonly string[]
      /** The settings sources: no user, project or local file is read. */
      readonly settingSources: readonly string[]
      readonly systemPrompt: {
        readonly type: 'custom'
        readonly prompt: string
        readonly snapshot: boolean
      }
      /** What the agent runs with, which is where this agent's isolation is written. */
      readonly env: Readonly<Record<string, string>>
    }
  }
}

/** What an agent is handed so that it runs bare, per agent and per platform (D6-02, D6-09). */
export type BareOptions = {
  /** What `session/new` carries on `_meta`, for the agent that reads its options there. */
  readonly meta: ClaudeCodeMeta | undefined
  /** What the process is started with, on top of the environment it already has. */
  readonly env: Readonly<Record<string, string>>
}

/** What building them needs: Hemera's own directory for this agent, and the base (D6-07). */
export type BareInput = {
  /**
   * Hemera's directory for this Session's agent.
   *
   * The agents that isolate themselves through a configuration directory are pointed at this
   * one, so that what the agent reads is not the user's own configuration (D6-09). What survives
   * that redirection is reported by the Context view and not hidden here.
   */
  readonly ownerDirectory: string
  /** The base the Context provides, the one instruction a Session starts with (D6-07). */
  readonly base: string
}

/**
 * What an agent's adapter declares about running it bare, on the platform it is asked about.
 *
 * The two cases are one type rather than a `qualified` flag with an optional reason: an agent
 * whose means leaves a tool behind has a reason, and the refusal below reads it without asking
 * whether it is there.
 */
export type BareMode =
  | {
      /** The means, in the agent's own terms, as the Context view names it. */
      readonly means: string
      readonly qualified: true
      /** What the agent is handed: the options its own agent reads. */
      readonly options: (input: BareInput) => BareOptions
    }
  | {
      readonly means: string
      readonly qualified: false
      /** What the means leaves behind: the text a refused Session is shown with. */
      readonly reason: string
    }

/** An agent whose means leaves a tool behind: its Session is not opened, and this is why. */
export class BareModeNotQualifiedError extends Data.TaggedError('BareModeNotQualifiedError')<{
  readonly id: string
  readonly label: string
  readonly means: string
  readonly reason: string
}> {}

/** What this adapter declares about running its agent bare on this platform. */
export function bareModeOf(adapter: AgentAdapter, platform: NodeJS.Platform): BareMode {
  return adapter.bareMode(platform)
}

/**
 * What the agent is handed, or the refusal that stops its Session opening (D6-02).
 *
 * The refusal is not a fallback for a broken configuration: it is the design's answer for an
 * agent that cannot be emptied, and the reason it carries is the adapter's own sentence, so
 * that what the window shows is what the spike found rather than a message invented here.
 */
export function bareOptionsOf(
  adapter: AgentAdapter,
  platform: NodeJS.Platform,
  input: BareInput,
): Effect.Effect<BareOptions, BareModeNotQualifiedError> {
  const mode = bareModeOf(adapter, platform)
  if (mode.qualified) return Effect.succeed(mode.options(input))
  return Effect.fail(
    new BareModeNotQualifiedError({
      id: adapter.id,
      label: adapter.label,
      means: mode.means,
      reason: mode.reason,
    }),
  )
}
