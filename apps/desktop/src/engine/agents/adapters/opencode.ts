import { join } from 'node:path'

import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * OpenCode, which speaks ACP itself (design D5-02, D5-21).
 *
 * There is no adapter package for this one: ACP is native in `opencode-ai`, so the command a
 * reader installs, the command that signs it in and the command Hemera starts as an agent are
 * the same one — `opencode`, with the `acp` subcommand, over standard input and output.
 * `--version` is answered by that same CLI (`docs/technical/acp-providers-2026-09.md` §4).
 *
 * Where it keeps its login is its own choice: `auth.json` in its data directory, which is
 * `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`, on every platform it runs on.
 *
 * OpenCode publishes a single method, "Login with opencode", which is `opencode auth login`
 * typed in a terminal, and its `authenticate` accepts no other one. Hemera does not type that
 * for the user, so the list is read as the sign-in itself: an agent that announced nothing has
 * nothing left to do, and an announced login is a Session that stops with a note rather than a
 * route taken on the user's behalf (D5-17).
 */

/**
 * The agent OpenCode is asked to be: one primary agent of Hemera's own, and nothing else.
 *
 * A catch-all deny is what removes a tool's definition from the request sent to the provider,
 * which is what bare mode means here — a per-tool deny would only refuse at call time, with the
 * definition still on its way. The `hemera_*` re-allow is mandatory rather than polite: MCP tools
 * go through the same filter, so a blanket deny hides Hemera's own tools too. `build` and `plan`
 * are the two primary agents OpenCode ships, and they are disabled so that the namespace is the
 * only one reachable.
 */
const BARE_AGENT = {
  default_agent: 'hemera',
  agent: {
    hemera: { mode: 'primary', permission: { '*': 'deny', 'hemera_*': 'allow' } },
    build: { disable: true },
    plan: { disable: true },
  },
}

export const opencode: AgentAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  command: 'opencode',
  installHint: 'npm install -g opencode-ai',
  loginHint: 'opencode auth login',
  loginFiles: (home, env) => [
    join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'opencode', 'auth.json'),
  ],
  package: 'opencode-ai',
  acp: { from: 'agent', command: 'opencode', args: ['acp'] },
  readVersion: versionIn,
  isAuthenticated: (methods) => methods.length === 0,
  /**
   * This agent's means is a configuration of its own, handed inline so that no file of the
   * user's is read to get it, plus the two variables that keep the project's own configuration
   * out of the way (D6-09).
   *
   * The platform is read because the wildcard matching is not the same on both: on Windows it is
   * case-insensitive, so the re-allow holds whatever case the agent spells the namespace in.
   * What survives the means is `$HOME/.opencode`, managed configuration and a remote
   * `.well-known/opencode`, which the Context view names.
   */
  bareMode: (platform) => ({
    means:
      platform === 'win32'
        ? "OPENCODE_CONFIG_CONTENT: a primary agent of Hemera's, a catch-all deny with the hemera_* namespace re-allowed, build and plan disabled — matched case-insensitively on Windows"
        : "OPENCODE_CONFIG_CONTENT: a primary agent of Hemera's, a catch-all deny with the hemera_* namespace re-allowed, build and plan disabled",
    base: 'embedded_resource',
    private:
      '$HOME/.opencode, its managed configuration and a remote .well-known/opencode still load; Hemera does not read them.',
    qualified: true,
    options: (input) => ({
      meta: undefined,
      env: {
        XDG_CONFIG_HOME: input.ownerDirectory,
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        OPENCODE_CONFIG_CONTENT: JSON.stringify(BARE_AGENT),
      },
      files: [],
    }),
  }),
}
