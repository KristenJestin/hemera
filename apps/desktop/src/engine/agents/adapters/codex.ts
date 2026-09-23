import { join } from 'node:path'

import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Codex, and the adapter that exposes it (design D5-02, D5-21).
 *
 * The agent is `codex`: the command OpenAI's own documentation tells a reader to install and to
 * sign in with, and the only command the Agents page ever names. Codex speaks no ACP itself, and
 * what exposes it is `@agentclientprotocol/codex-acp` — a dependency of this application,
 * carried with it, forked by the supervisor, never installed, never shown and never asked of the
 * reader (`docs/technical/acp-providers-2026-09.md` §3, D5-21).
 *
 * As with Claude Code, the adapter left to itself would run the Codex carried in its own
 * `@openai/codex` dependency, and Hemera ships none of it: `CODEX_PATH` is what the adapter
 * reads to know which `codex` to start `app-server` on, so a Session runs the one this machine
 * has (`dist/index.js`, `startCodexConnection`). The login is what makes it usable.
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
  acp: {
    from: 'bundled',
    package: '@agentclientprotocol/codex-acp',
    args: [],
    agentVariable: 'CODEX_PATH',
  },
  readVersion: versionIn,

  isAuthenticated: (methods) => methods.every((method) => method.id === ALWAYS_OFFERED),
  /**
   * Codex's means is a configuration file, and it is not enough: about fourteen switches turn off
   * what can be turned off, and two families of tools have no switch at all. So this agent is not
   * qualified, and a Session on it is refused before anything is written or started (D6-02): the
   * options are declared for the trial that may qualify it, never handed to a Session.
   */
  bareMode: () => ({
    means:
      "a config.toml in a directory of Hemera's: about fourteen switches, from web_search to shell_tool, view_image, sleep_tool, multi_agent and code_mode",
    base: 'embedded_resource',
    options: (input) => ({
      meta: undefined,
      env: { CODEX_HOME: input.ownerDirectory },
      files: [],
    }),
    qualified: false,
    reason:
      'apply_patch has no configuration key — it is gated by the model catalog — and list_mcp_resources, list_mcp_resource_templates and read_mcp_resource appear as soon as an MCP server exists, which bare mode requires. Hemera would not see those calls, so this Session is not opened.',
  }),
}
