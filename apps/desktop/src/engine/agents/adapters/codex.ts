import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Codex, through the ACP adapter the agentclientprotocol organisation maintains (D5-02).
 *
 * `codex-acp` is the binary, and like Claude Code's adapter it takes no arguments, speaks ACP
 * over standard input and output, and answers `--version` with its version. Hemera runs it
 * rather than the `codex` CLI so that the Session and its MCP servers come from the process
 * that speaks the protocol (`docs/technical/acp-providers-2026-09.md` §3).
 *
 * Of the methods Codex publishes, the API key is the one it offers whatever the machine's state
 * is — it reads the key from the environment or from the request — so its presence says nothing
 * about being signed in, and a list that holds nothing else is read as an agent with nothing
 * left to do. The ChatGPT flows are the sign-in: one opens a browser, the other is offered only
 * to a client that supports URL elicitation, and Hemera drives neither, so a list holding one
 * is a Session that stops with a note rather than a route taken on the user's behalf (D5-17).
 */

/** The method Codex offers whether or not the machine is signed in. */
const ALWAYS_OFFERED = 'api-key'

export const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  command: 'codex-acp',
  args: [],
  installHint: 'npm install -g @agentclientprotocol/codex-acp',
  package: '@agentclientprotocol/codex-acp',
  readVersion: versionIn,
  isAuthenticated: (methods) => methods.every((method) => method.id === ALWAYS_OFFERED),
}
