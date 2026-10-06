/**
 * What an agent is, from Hemera's side: one declaration per agent, under `adapters/`.
 *
 * A declaration says which command the user installs and signs in with, where that agent keeps
 * its login (honouring the agent's own environment overrides), what speaks ACP for it, how its
 * `initialize` answer says it is signed in, whether it has been qualified to run bare on an OS,
 * and the options that make it run bare. It starts nothing and resolves no path: discovery asks
 * the machine, the runtime starts what discovery resolved.
 *
 * The agent itself is never shipped: it is the command on the user's `PATH`. The ACP adapter of
 * Claude Code and Codex is the opposite, a dependency of Hemera carried with it, which the user
 * never installs nor sees.
 */

import type { AgentProvider } from '@hemera/core/domain'
import type { Qualification } from '@hemera/ipc'

import type { BareInput, BareOptions } from './bare.ts'

/** The environment an agent's own paths take their overrides from. */
export type Environment = Readonly<Record<string, string | undefined>>

/** One authentication method an agent announced at `initialize`, as far as Hemera reads it. */
export interface AuthMethod {
  readonly id: string
}

/**
 * What speaks ACP for an agent. `bundled`: an adapter package Hemera carries, forked as a Node
 * script, told which agent to run by the variable it reads for that. `agent`: the agent's own
 * command, with the arguments that start it as an ACP agent.
 */
export type AcpEntry =
  | { readonly from: 'bundled'; readonly package: string; readonly agentVariable: string }
  | { readonly from: 'agent'; readonly args: ReadonlyArray<string> }

/** Where an agent's own settings are read from, and what of them a bare session keeps. */
export interface OwnSettings {
  readonly files: (home: string, env: Environment) => ReadonlyArray<string>
  /** The settings kept, from the texts of `files` in their order (undefined: not there). */
  readonly kept: (
    texts: ReadonlyArray<string | undefined>,
  ) => Readonly<Partial<Record<string, string>>>
}

export interface AgentAdapter {
  readonly id: AgentProvider
  /** The agent's own name, as its documentation gives it. */
  readonly label: string
  /** Its command on the `PATH`: never `npx`, never a path Hemera ships. */
  readonly command: string
  /** The published package of the agent, which an update installs; never the adapter's. */
  readonly package: string
  readonly installHint: string
  /** The agent's own sign-in command, which the user types; Hemera never does. */
  readonly loginHint: string
  /** Where the agent keeps its login; looked for, never opened. */
  readonly loginFiles: (home: string, env: Environment) => ReadonlyArray<string>
  readonly acp: AcpEntry
  /** Whether the methods announced at `initialize` leave the agent usable as it is. */
  readonly isAuthenticated: (methods: ReadonlyArray<AuthMethod>) => boolean
  /** Whether running bare was shown to work on this OS, or why it is refused. */
  readonly qualification: (platform: NodeJS.Platform) => Qualification
  /** What the agent is handed so that Hemera's tools are its only tools. */
  readonly bareOptions: (input: BareInput) => BareOptions
  /** For an agent whose bare options move its configuration away: what of the user's it keeps. */
  readonly ownSettings?: OwnSettings
  /** The instruction file of a repository this agent reads when it reads one itself. */
  readonly instructionFile: 'CLAUDE.md' | 'AGENTS.md'
  /**
   * Whether, run bare, it reads the repositories' instruction files by itself on this OS: Hemera
   * then never sends them too. The value is the one the real-system proof found.
   */
  readonly readsInstructionFiles: (platform: NodeJS.Platform) => boolean
  /**
   * Whether it tells when it compacts its conversation: then the instructions are sent again
   * after a compaction; otherwise a session past 80 % of its window is replaced (CT-15).
   */
  readonly signalsCompaction: boolean
  /**
   * Whether it obeys a note in a tool's result (`<hemera-note>`): otherwise an urgent delivery
   * cancels the turn and is sent as a message at once.
   */
  readonly obeysNotes: boolean
}

/** The version in a line an agent printed for `--version`, wherever it sits, or null. */
export function versionIn(output: string): string | null {
  return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(output)?.[0] ?? null
}
