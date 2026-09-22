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
}
