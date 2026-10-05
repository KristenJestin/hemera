/**
 * The agents Hemera drives: Claude Code, Codex and OpenCode, each over the Agent Client Protocol
 * and in bare mode. The list is the domain's, so a fourth agent is a compile error everywhere it
 * has to be named rather than a place someone forgets.
 */

import { Schema } from 'effect'

export const AGENT_PROVIDERS = ['claude', 'codex', 'opencode'] as const
export const AgentProvider = Schema.Literals(AGENT_PROVIDERS)
export type AgentProvider = typeof AgentProvider.Type
