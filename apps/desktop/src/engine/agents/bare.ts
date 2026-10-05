/**
 * Bare mode: every built-in tool of an agent removed, Hemera's MCP server the only one it has.
 *
 * Each agent has its own means (its adapter declares it): Claude Code reads options from
 * `session/new` `_meta`, Codex is run through Hemera's patch of its adapter, OpenCode takes a
 * configuration of Hemera's in its environment. What is common is here: what building the
 * options takes, Hemera's MCP server entry, the agent folders, and the refusal of an agent and OS
 * pair that has not been qualified, with its reason.
 */

import { join } from 'node:path'

import type { McpServer } from '@agentclientprotocol/sdk'
import { AGENT_PROVIDERS, type AgentProvider } from '@hemera/core/domain'
import { BareModeNotQualified, Qualified, type Qualification } from '@hemera/ipc'
import { Effect, Match } from 'effect'

import type { AgentAdapter, Environment } from './adapter.ts'

/** Where Hemera's MCP server answers this agent, and the token minted for its session. */
export interface HemeraAccess {
  readonly url: string
  readonly token: string
}

/** What building an agent's bare options takes. */
export interface BareInput {
  /** Hemera's own folder for this agent, `<data>/agents/<provider>`. */
  readonly agentDirectory: string
  readonly systemPrompt: string
  readonly hemera: HemeraAccess
  /**
   * The Hemera tools Claude Code may call without its own permission check: exact names, never
   * a wildcard over Hemera's tools. Empty unless given (#38 decides the final list).
   */
  readonly allowedTools?: ReadonlyArray<string>
  /** What of the user's own settings the agent keeps (its adapter's `ownSettings`). */
  readonly own?: Readonly<Partial<Record<string, string>>>
}

/** The options Claude Code reads from `session/new` `_meta`. */
export interface ClaudeCodeMeta {
  readonly claudeCode: {
    readonly options: {
      readonly tools: ReadonlyArray<string>
      readonly allowedTools: ReadonlyArray<string>
      readonly settingSources: ReadonlyArray<string>
      readonly strictMcpConfig: boolean
      readonly systemPrompt: {
        readonly type: 'custom'
        readonly prompt: string
        readonly snapshot: boolean
      }
      readonly env: Readonly<Record<string, string>>
    }
  }
}

/** What Hemera's patch of Codex's adapter reads from `session/new` `_meta`. */
export interface CodexMeta {
  readonly hemera: { readonly bare: true; readonly toolServer: string }
}

/** What an agent is handed to run bare. */
export interface BareOptions {
  /** `session/new` `mcpServers`: Hemera's server, and nothing else. */
  readonly mcpServers: ReadonlyArray<McpServer>
  /** `session/new` `_meta`, for the agents that read their options there. */
  readonly meta: ClaudeCodeMeta | CodexMeta | undefined
  /** Added to the agent process's environment. */
  readonly env: Readonly<Record<string, string>>
  /**
   * How the system prompt reaches the agent: inside `_meta` (Claude Code), or as an
   * `embedded_resource` block of the first message (Codex, OpenCode).
   */
  readonly systemPromptAs: 'session-meta' | 'embedded-resource'
}

/** The name of Hemera's MCP server, which Codex's patch and OpenCode's permissions rely on. */
export const HEMERA_SERVER = 'hemera'

/** Hemera's MCP server as `session/new` hands it to every agent. */
export function hemeraServer(access: HemeraAccess): McpServer {
  return {
    type: 'http',
    name: HEMERA_SERVER,
    url: access.url,
    headers: [{ name: 'Authorization', value: `Bearer ${access.token}` }],
  }
}

/** Hemera's own folder for one agent, inside the data folder. */
export function agentDirectoryOf(dataFolder: string, provider: AgentProvider): string {
  return join(dataFolder, 'agents', provider)
}

/**
 * The variable the end-to-end suite sets to the agent its fake answers for: that one agent is
 * qualified on this OS whatever its declaration says, since the fake has no tool of its own. The
 * application never sets it.
 */
export const E2E_QUALIFIED = 'HEMERA_E2E_QUALIFIED'

/** Whether this agent may run bare on this OS: its declaration, or the suite's flag. */
export function qualificationOf(
  adapter: AgentAdapter,
  platform: NodeJS.Platform,
  env: Environment,
): Qualification {
  const named = AGENT_PROVIDERS.find((provider) => provider === env[E2E_QUALIFIED])
  return named === adapter.id ? Qualified.make({}) : adapter.qualification(platform)
}

/** Nothing, or the refusal of an agent not qualified to run bare on this OS, with its reason. */
export const refusedUnlessQualified = (
  adapter: AgentAdapter,
  platform: NodeJS.Platform,
  env: Environment,
): Effect.Effect<void, BareModeNotQualified> =>
  Match.valueTags(qualificationOf(adapter, platform, env), {
    Qualified: () => Effect.void,
    NotQualified: ({ reason }) =>
      Effect.fail(new BareModeNotQualified({ agent: adapter.id, label: adapter.label, reason })),
  })
