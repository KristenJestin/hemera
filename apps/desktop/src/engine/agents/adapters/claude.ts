import { join } from 'node:path'

import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Claude Code, and the adapter that exposes it (design D5-02, D5-21).
 *
 * The agent is `claude`: the command Claude Code's own documentation tells a reader to install
 * and to sign in with, and the only command the Agents page ever names. Claude Code speaks no
 * ACP itself, and what exposes it is `claude-agent-acp` — a package of Hemera's, spawned by the
 * supervisor, never shown and never asked of the reader
 * (`docs/technical/acp-providers-2026-09.md` §2).
 *
 * The command looked for on the `PATH` is the agent's own, and it is not what starts a Session:
 * the adapter runs the Claude Code it carries in its own `@anthropic-ai/claude-agent-sdk`
 * dependency, whose platform package holds the agent as a binary of its own (214 MB on
 * darwin-arm64, 230 MB on linux-arm64), overridable only through `CLAUDE_CODE_EXECUTABLE`, and
 * it never looks at the `PATH`. What a machine must have for Claude Code to be usable is
 * therefore the login and not this command, which is why the Agents page shows the login first
 * and the command second, as the place where a reader's own CLI is or is not.
 *
 * Where that login lives is the agent's own choice: `.credentials.json` inside the directory
 * `CLAUDE_CONFIG_DIR` names, `~/.claude` when it is not set. On macOS the Keychain holds it and
 * no file is written, so a signed-in Mac reads as signed out here — the word that counts is the
 * one the agent gives at `initialize`, and this is only what can be said before a Session starts.
 *
 * Signing in stays outside Hemera: the sign-in is `claude auth login`, typed by the user in a
 * terminal, and Hemera types it for nobody. The two logins this adapter publishes, the
 * subscription one and the Anthropic Console one, are terminal flows, offered to a client that
 * can run an auth command in a terminal — Hemera advertises no terminal capability in this lot —
 * and its two gateway methods appear only for a client that advertises a gateway. So a list
 * holding one of the logins is a machine that still has to sign in: the Session stops there with
 * a note rather than starting on an account the user did not choose (D5-17).
 */

/** The two logins this adapter publishes when the machine has one still to do. */
const LOGINS: ReadonlySet<string> = new Set(['claude-ai-login', 'console-login'])

export const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  command: 'claude',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  loginHint: 'claude auth login',
  loginFiles: (home, env) => [
    join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), '.credentials.json'),
  ],
  package: '@anthropic-ai/claude-code',
  acp: { command: 'claude-agent-acp', args: [] },
  readVersion: versionIn,
  isAuthenticated: (methods) => !methods.some((method) => LOGINS.has(method.id)),
}
