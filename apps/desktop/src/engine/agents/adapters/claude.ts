import { join } from 'node:path'

import { type AgentAdapter, versionIn } from '../adapter.ts'

/**
 * Claude Code, and the adapter that exposes it (design D5-02, D5-21).
 *
 * The agent is `claude`: the command Claude Code's own documentation tells a reader to install
 * and to sign in with, and the only command the Agents page ever names. Claude Code speaks no
 * ACP itself, and what exposes it is `@agentclientprotocol/claude-agent-acp` — a dependency of
 * this application, carried with it, forked by the supervisor, never installed, never shown and
 * never asked of the reader (`docs/technical/acp-providers-2026-09.md` §2, D5-21).
 *
 * The command looked for on the `PATH` is the agent's own, and it *is* what a Session ends up
 * talking to: left to itself the adapter would run the Claude Code carried in its own
 * `@anthropic-ai/claude-agent-sdk` dependency, whose platform package holds the agent as a
 * binary of a few hundred megabytes (223 MB on win32-x64), and Hemera ships none of those. The
 * adapter reads `CLAUDE_CODE_EXECUTABLE` before anything else, so it is handed the `claude` this
 * machine has, and a Session runs the agent the reader installed and signed in
 * (`dist/acp-agent.js`, `claudeCliPath`).
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

/** How long this agent waits for one of Hemera's tools before it gives up on it: ten minutes. */
export const TOOL_WAIT_MS = 600_000

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
  acp: {
    from: 'bundled',
    package: '@agentclientprotocol/claude-agent-acp',
    args: [],
    agentVariable: 'CLAUDE_CODE_EXECUTABLE',
  },
  readVersion: versionIn,

  isAuthenticated: (methods) => !methods.some((method) => LOGINS.has(method.id)),
  /**
   * Every lever this agent has is in one place, which is why it needs no configuration file of
   * Hemera's: `session/new` carries its options on `_meta`, and the ACP field beside them
   * carries Hemera's server.
   *
   * What survives the means is managed and policy settings, which load whatever `settingSources`
   * says, and `~/.claude.json`, which is always read (D6-09): the Context view names them, and
   * nothing here pretends otherwise.
   *
   * `CLAUDE_CONFIG_DIR` is left where the user has it. The login lives in it — `.credentials.json`
   * wherever a file holds it — and `claude auth status` run with a directory of its own answers
   * `loggedIn: false` on a machine that is signed in (checked
   * on 23 September 2026, Windows, Claude Code 2.1.280). Nothing secret is copied or linked into
   * a directory of Hemera's instead: what the move was for is done by `settingSources: []`, which
   * reads none of the user's settings files, and `strictMcpConfig`, which loads none of the MCP
   * servers they configured — only Hemera's.
   */
  bareMode: () => ({
    means:
      'session/new _meta: no built-in tool, no settings source, no MCP server but Hemera, the base as the system prompt',
    base: 'system_prompt',
    // Claude Code reads CLAUDE.md, not AGENTS.md, and with no settings source it reads neither:
    // the Workspace's instructions reach it only if Hemera gives them.
    readsAgentsFile: false,
    private:
      'its managed and policy settings and ~/.claude.json still load; Hemera does not read them.',
    qualified: true,
    options: (input) => ({
      meta: {
        claudeCode: {
          options: {
            // Documented as removing every built-in, with the MCP tools kept — which is what
            // makes this agent qualified rather than merely configured.
            tools: [],
            // Hemera's tools are gated by Hemera (D6-05): allowed here so Claude Code does not
            // put its own permission, with its "always allow", in front of Hemera's gate.
            allowedTools: ['mcp__hemera__*'],
            settingSources: [],
            strictMcpConfig: true,
            systemPrompt: { type: 'custom', prompt: input.base, snapshot: true },
            env: {
              CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
              ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
              // A tool call can wait on the human — a path outside the root, a one-off command —
              // for as long as they take to answer, and the agent's own limits must not end it
              // first: ten minutes, as the prototype had it. Claude Code has two of them, one on
              // the whole call and one on a call that sends nothing, and a call waiting on the
              // human sends nothing: with the total one alone, 2.1 aborted it after 300 s.
              MCP_TOOL_TIMEOUT: String(TOOL_WAIT_MS),
              CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(TOOL_WAIT_MS),
            },
          },
        },
      },
      // This agent is handed its environment inside `_meta` and not on its process, which is the
      // one thing the three do not agree on.
      env: {},
      files: [],
    }),
  }),
}
