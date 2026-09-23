/**
 * What makes an agent run bare: its own tools gone, Hemera's the only ones left (design D6-02,
 * D6-09).
 *
 * There is no native mode and no toggle. Every Session is bare, or it is not opened at all, and
 * the means belongs to each agent: one reads its options out of `session/new`'s `_meta`, the
 * other two take them from the environment and a directory of Hemera's own. What each adapter
 * declares is that means, and the answer to the only question that matters here — whether the
 * means removes *every* tool the agent ships. Claude Code and OpenCode answer yes; Codex answers
 * no, and the residue it keeps is the reason its Sessions are refused. Codex still declares the
 * options its means is made of: they are what a trial of it runs with, and what the refusal
 * says was not enough — never what a Session is opened with.
 *
 * The declarations come from the spike `docs/technical/bare-mode-2026-09.md` (21 September 2026),
 * which read them in the three agents' own sources. Until the phase 3 trial per agent and
 * platform, what is written here is what those sources say, not what a run has shown.
 *
 * The platform is a parameter and not `process.platform`: the answer is declared per platform
 * (D6-02), and the one place where the two differ today — OpenCode's wildcard matching is
 * case-insensitive on Windows only — has to be checkable from a machine that is neither.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, Data, Effect, Layer } from 'effect'

import type { AgentProvider, BaseReach } from '@hemera/core'

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
      /** The tools allowed without the agent asking: Hemera's own, which Hemera gates itself. */
      readonly allowedTools: readonly string[]
      /** The settings sources: no user, project or local file is read. */
      readonly settingSources: readonly string[]
      /** Only the servers handed over in the session: none of the user's own MCP configuration. */
      readonly strictMcpConfig: boolean
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

/** A file the means is made of, written into Hemera's directory for the agent before it starts. */
export type BareFile = {
  /** Its name inside that directory. */
  readonly name: string
  readonly content: string
}

/** What an agent is handed so that it runs bare, per agent and per platform (D6-02, D6-09). */
export type BareOptions = {
  /** What `session/new` carries on `_meta`, for the agent that reads its options there. */
  readonly meta: ClaudeCodeMeta | undefined
  /** What the process is started with, on top of the environment it already has. */
  readonly env: Readonly<Record<string, string>>
  /** What is written into Hemera's directory for this agent before its process starts. */
  readonly files: readonly BareFile[]
}

/** What building them needs: Hemera's own directory for this agent, and the base (D6-07). */
export type BareInput = {
  /**
   * Hemera's directory for this agent.
   *
   * The agents that isolate themselves through a configuration directory are pointed at this
   * one, so that what the agent reads is not the user's own configuration (D6-09). What survives
   * that redirection is reported by the Context view and not hidden here.
   */
  readonly ownerDirectory: string
  /** The base the Context provides, the one instruction a Session starts with (D6-07). */
  readonly base: string
  /**
   * What of the user's own choices the agent keeps, as its adapter read them out of the user's
   * files: the model they work with, which the redirection above would otherwise lose (D6-09).
   */
  readonly own?: Readonly<Record<string, string>>
}

/**
 * What an agent's adapter declares about running it bare, on the platform it is asked about.
 *
 * The two cases are one type rather than a `qualified` flag with an optional reason: an agent
 * whose means leaves a tool behind has a reason, and the refusal below reads it without asking
 * whether it is there.
 */
export type BareMode = {
  /** The means, in the agent's own terms, as the Context view names it. */
  readonly means: string
  /**
   * How the base reaches this agent (D6-07): its system prompt, where it has one to hand over,
   * or an embedded resource in the first prompt of the Session.
   */
  readonly base: BaseReach
  /**
   * What the agent keeps that Hemera does not see, in one sentence: the sources its means does
   * not reach (D6-09). The Context view lists it as the agent's private part, and claims nothing
   * about what the model retained (D6-10).
   */
  readonly private: string
  /** What the agent is handed: the options its own agent reads. */
  readonly options: (input: BareInput) => BareOptions
} & (
  | { readonly qualified: true }
  | {
      readonly qualified: false
      /** What the means leaves behind: the text a refused Session is shown with. */
      readonly reason: string
    }
)

/** An agent whose means leaves a tool behind: its Session is not opened, and this is why. */
export class BareModeNotQualifiedError extends Data.TaggedError('BareModeNotQualifiedError')<{
  readonly id: string
  readonly label: string
  readonly means: string
  readonly reason: string
}> {
  /**
   * What the window shows: the agent, and the adapter's own reason, word for word (D6-02).
   *
   * A tagged error has no message, and a refusal that crosses the port without one crosses as
   * its own fields. This is the sentence, the same wherever the refusal is met.
   */
  override get message(): string {
    return `${this.label} cannot run without its own tools here: ${this.reason}`
  }
}

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

/**
 * Nothing, or the refusal of an agent whose combination is not qualified on this platform (D6-02).
 *
 * Asked before a Session is made, not only when its agent is started: a Session on an agent that
 * cannot run bare is not a Session that fails later, it is one that is never written.
 */
export function refusedUnlessBare(
  adapter: AgentAdapter,
  platform: NodeJS.Platform,
): Effect.Effect<void, BareModeNotQualifiedError> {
  const mode = bareModeOf(adapter, platform)
  if (mode.qualified) return Effect.void
  return Effect.fail(
    new BareModeNotQualifiedError({
      id: adapter.id,
      label: adapter.label,
      means: mode.means,
      reason: mode.reason,
    }),
  )
}

/**
 * Writes the files a means is made of into Hemera's directory for the agent.
 *
 * Written again at every start, whole: the directory is Hemera's, and what it holds is what this
 * version of Hemera declares rather than what an older one left there.
 */
export function writtenFiles(
  directory: string,
  files: readonly BareFile[],
): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: async () => {
      await mkdir(directory, { recursive: true })
      for (const file of files) {
        // oxlint-disable-next-line no-await-in-loop -- a handful of files, one directory, written in the order they are declared
        await writeFile(join(directory, file.name), file.content, 'utf8')
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

export interface AgentDirectoriesService {
  /** Hemera's own directory for one agent: where its means is written, and nothing of the user's. */
  readonly of: (provider: AgentProvider) => string
}

/**
 * Where Hemera keeps a directory per agent (D6-09).
 *
 * Inside the data folder, so a trial run with `--data-dir` and a suite with a temporary folder
 * each have their own, and one agent's directory is shared by its Sessions: what an agent keeps
 * in it between two starts is kept for the next Session of the same agent.
 */
export class AgentDirectories extends Context.Service<AgentDirectories, AgentDirectoriesService>()(
  'AgentDirectories',
) {}

/** The directories of the agents, under the data folder the engine opened. */
export function agentDirectoriesLayer(dataFolder: string): Layer.Layer<AgentDirectories> {
  return Layer.succeed(AgentDirectories, {
    of: (provider) => join(dataFolder, 'agents', provider),
  })
}
