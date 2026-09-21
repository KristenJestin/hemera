import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * OpenCode, which speaks ACP itself (D5-02).
 *
 * There is no adapter package to install for this one: ACP is native in `opencode-ai`, so the
 * command is `opencode` and the argument that starts it as an agent is the `acp` subcommand,
 * over standard input and output. `--version` is answered by the agent's own CLI
 * (`docs/technical/acp-providers-2026-09.md` §4).
 *
 * OpenCode publishes a single method, "Login with opencode", which is `opencode auth login`
 * typed in a terminal, and its `authenticate` accepts no other one. Hemera does not type that
 * for the user, so the list is read as the sign-in itself: an agent that announced nothing has
 * nothing left to do, and an announced login is a Session that stops with a note rather than a
 * route taken on the user's behalf (D5-17).
 */

export const opencode: AgentAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  command: 'opencode',
  args: ['acp'],
  installHint: 'npm install -g opencode-ai',
  package: 'opencode-ai',
  readVersion: versionIn,
  isAuthenticated: (methods) => methods.length === 0,
}
