import { join } from 'node:path'

import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Codex, and the adapter that exposes it (design D5-02, D5-21).
 *
 * The agent is `codex`: the command OpenAI's own documentation tells a reader to install and to
 * sign in with, and the only command the Agents page ever names. Codex speaks no ACP itself, and
 * what exposes it is `@agentclientprotocol/codex-acp` — a dependency of this application,
 * resolved from Hemera's own `node_modules`, spawned by the supervisor, never installed, never
 * shown and never asked of the reader (`docs/technical/acp-providers-2026-09.md` §3, D5-21).
 *
 * As with Claude Code, the command on the `PATH` is not what starts a Session: the adapter runs
 * the Codex it carries in its own `@openai/codex` dependency. The login is what a machine must
 * have for Codex to be usable.
 *
 * Where that login lives is the agent's own choice: `auth.json` inside the directory `CODEX_HOME`
 * names, `~/.codex` when it is not set. A machine that keeps its credentials in a keyring
 * instead (`cli_auth_credentials_store = keyring`) writes no file, so it reads as signed out
 * here — the word that counts is the one the agent gives at `initialize`, and this is only what
 * can be said before a Session starts.
 *
 * Signing in stays outside Hemera: the sign-in is `codex login`, which opens a browser, and
 * Hemera types it for nobody. Of the methods Codex publishes, the API key is the one it offers
 * whatever the machine's state is — it reads the key from the environment or from the request —
 * so its presence says nothing about being signed in, and a list that holds nothing else is read
 * as an agent with nothing left to do. The ChatGPT flows are the sign-in: one opens a browser,
 * the other is offered only to a client that supports URL elicitation, and Hemera drives
 * neither, so a list holding one is a Session that stops with a note rather than a route taken
 * on the user's behalf (D5-17).
 */

/** The method Codex offers whether or not the machine is signed in. */
const ALWAYS_OFFERED = 'api-key'

export const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  command: 'codex',
  installHint: 'npm install -g @openai/codex',
  loginHint: 'codex login',
  loginFiles: (home, env) => [join(env.CODEX_HOME ?? join(home, '.codex'), 'auth.json')],
  package: '@openai/codex',
  acp: { from: 'bundled', package: '@agentclientprotocol/codex-acp', args: [] },
  readVersion: versionIn,
  isAuthenticated: (methods) => methods.every((method) => method.id === ALWAYS_OFFERED),
}
