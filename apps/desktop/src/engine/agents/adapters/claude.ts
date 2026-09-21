import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Claude Code, through the ACP adapter the agentclientprotocol organisation maintains (D5-02).
 *
 * The command is the adapter's own binary, `claude-agent-acp`, and not the `claude` CLI: Claude
 * Code does not speak ACP itself, and the adapter is what exposes it, as one process that holds
 * the Session, its MCP servers and its tools. It takes no arguments and reads ACP on standard
 * input and output, and it answers `--version` with its version, which is all the Agents page
 * ever shows of it (`docs/technical/acp-providers-2026-09.md` §2).
 *
 * Signing in stays outside Hemera. The two logins this adapter publishes, the subscription one
 * and the Anthropic Console one, are terminal flows, which it offers to a client that can run
 * an auth command in a terminal — Hemera advertises no terminal capability in this lot — and
 * its two gateway methods appear only for a client that advertises a gateway. So a list holding
 * one of the logins is a machine that still has to sign in: the Session stops there with a note
 * rather than starting on an account the user did not choose (D5-17).
 */

/** The two logins this adapter publishes when the machine has one still to do. */
const LOGINS: ReadonlySet<string> = new Set(['claude-ai-login', 'console-login'])

export const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude-agent-acp',
  args: [],
  installHint: 'npm install -g @agentclientprotocol/claude-agent-acp',
  package: '@agentclientprotocol/claude-agent-acp',
  readVersion: versionIn,
  isAuthenticated: (methods) => !methods.some((method) => LOGINS.has(method.id)),
}
