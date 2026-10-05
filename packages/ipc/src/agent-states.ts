/**
 * The coding agents as the window reads them: Claude Code, Codex and OpenCode, each with what this
 * machine says of it (installed or not, its version, signed in or not, the tool that installed
 * it) and whether it may run bare on this OS. Plus the two moves on them: check for updates, and
 * update. The refusals a session start meets are declared here too, so they cross as themselves.
 */

import { AgentProvider } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'

/** The tool that put an agent's command where it is, read from its path. */
export const InstallerTool = Schema.Literals(['vp', 'npm', 'pnpm', 'bun', 'brew', 'unknown'])
export type InstallerTool = typeof InstallerTool.Type

export const Qualified = Schema.TaggedStruct('Qualified', {})
/** The agent has not been shown to run bare on this OS: it is refused, and this is why. */
export const NotQualified = Schema.TaggedStruct('NotQualified', { reason: Schema.String })
export const Qualification = Schema.Union([Qualified, NotQualified])
export type Qualification = typeof Qualification.Type

export const AgentState = Schema.Struct({
  id: AgentProvider,
  /** The agent's own name: Claude Code, Codex, OpenCode. */
  label: Schema.String,
  installed: Schema.Boolean,
  /** What it answered to `--version`; null when not asked yet, or it answered none. */
  version: Schema.NullOr(Schema.String),
  /** From its login file: a presence, never what it holds. */
  signedIn: Schema.Boolean,
  installer: InstallerTool,
  qualification: Qualification,
  installHint: Schema.String,
  loginHint: Schema.String,
  /**
   * The latest published version; null until a check answered, or when the registry answered
   * none. Listing checks by itself, in the background, once the last answer is stale.
   */
  latest: Schema.NullOr(Schema.String),
})
export type AgentState = typeof AgentState.Type

/** What an update printed, and the version the agent answers afterwards. */
export const AgentUpdate = Schema.Struct({
  output: Schema.String,
  version: Schema.NullOr(Schema.String),
})
export type AgentUpdate = typeof AgentUpdate.Type

export class AgentNotInstalled extends Schema.TaggedError<AgentNotInstalled>()(
  'AgentNotInstalled',
  { agent: AgentProvider, label: Schema.String },
) {
  override get message(): string {
    return `${this.label} is not installed on this machine.`
  }
}

export class AgentNotSignedIn extends Schema.TaggedError<AgentNotSignedIn>()('AgentNotSignedIn', {
  agent: AgentProvider,
  label: Schema.String,
  loginHint: Schema.String,
}) {
  override get message(): string {
    return `${this.label} is installed but not signed in: run ${this.loginHint}.`
  }
}

/** The adapter Hemera carries for this agent is not where this installation should have it. */
export class AgentAdapterMissing extends Schema.TaggedError<AgentAdapterMissing>()(
  'AgentAdapterMissing',
  { agent: AgentProvider, label: Schema.String, package: Schema.String },
) {
  override get message(): string {
    return `${this.label} cannot start: this installation of Hemera is missing ${this.package}.`
  }
}

export class BareModeNotQualified extends Schema.TaggedError<BareModeNotQualified>()(
  'BareModeNotQualified',
  { agent: AgentProvider, label: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `${this.label} cannot run with Hemera's tools only here: ${this.reason}.`
  }
}

/** An update Hemera will not run: the agent is not there, or no known tool installed it. */
export class AgentUpdateRefused extends Schema.TaggedError<AgentUpdateRefused>()(
  'AgentUpdateRefused',
  { agent: AgentProvider, reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

/**
 * The agents with their state, answered from what is known without waiting on a version probe;
 * the same with the latest published versions read; and the update of one agent.
 */
export const AgentStatesRpcs = RpcGroup.make(
  Rpc.make('agents.list', { success: Schema.Array(AgentState), error: EngineGone }),
  Rpc.make('agents.checkUpdates', { success: Schema.Array(AgentState), error: EngineGone }),
  Rpc.make('agents.update', {
    payload: { agent: AgentProvider },
    success: AgentUpdate,
    error: Schema.Union([AgentUpdateRefused, EngineGone]),
  }),
)
