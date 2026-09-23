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

/**
 * What a bare Codex is configured with, through `CODEX_CONFIG` (`docs/technical/bare-mode-2026-09.md` §2).
 *
 * The adapter reads that variable once, as a JSON object, and merges it into every `thread/start`,
 * `thread/resume` and `thread/fork` exactly like `-c` on the command line: the user's
 * `CODEX_HOME`, where their login lives, is left where it is. Every tool a switch can turn off is
 * turned off — the hosted web search, the shell, the image viewer, the sleep and clock tools, the
 * permission and budget tools, the deferred executor, code mode, the two generations of
 * sub-agents, image generation, the standalone web search, the tool suggestions, the apps, the
 * plugins, the goals, the browser and the computer, the plan and the question to the user, the
 * sub-agents the model's catalogue asks for and the skill tools. What no key reaches —
 * `apply_patch` and the three MCP resource tools — is removed by the patch of the adapter, through
 * `_meta` below. Code mode is the model's catalogue's too: its `exec` is a V8 isolate with no file
 * system, network or process, and it reaches exactly the tools above (tried on 23 September 2026).
 */
const BARE_CONFIG = {
  web_search: 'disabled',
  approval_policy: 'on-request',
  tools: {
    update_plan: { enabled: false },
    experimental_request_user_input: { enabled: false },
  },
  // The sub-agent tools follow the model's catalogue unless `[agents]` turns them off.
  agents: { enabled: false },
  // `skills__list` and `skills__read`, and the orchestrator's own MCP tools.
  orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
  // Nested and not dotted: the adapter adds a `features` table of its own to every thread, and a
  // `features.x` key beside it is lost (tried on codex-acp 1.12.0, codex-cli 0.154.0).
  features: {
    shell_tool: false,
    unified_exec: false,
    view_image: false,
    sleep_tool: false,
    current_time_reminder: false,
    request_permissions_tool: false,
    token_budget: false,
    deferred_executor: false,
    code_mode: false,
    multi_agent: false,
    multi_agent_v2: false,
    image_generation: false,
    standalone_web_search: false,
    tool_suggest: false,
    apps: false,
    plugins: false,
    goals: false,
    browser_use: false,
    computer_use: false,
  },
}

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
   * Codex's means is Hemera's patch of its adapter (`patches/`), and the configuration above.
   *
   * The session is opened with `_meta.hemera`, and the patched adapter starts its thread with no
   * environment — `environments: []` on `thread/start` and on every `turn/start`, which removes
   * the shell, `apply_patch` and the image viewer together — and with the tools of Hemera's MCP
   * server handed to Codex as dynamic tools (`hemera_fs_read`, …) rather than as an MCP server:
   * with no MCP server at all, the three MCP resource tools are never registered. A call comes back
   * through `item/tool/call` and the adapter forwards it to Hemera's server, with the token the
   * session was handed. The MCP servers of the user's own configuration are turned off by name.
   * Both fields are experimental in `codex app-server`: they were tried on codex-cli 0.154.0, and a
   * Codex upgrade needs the trial again.
   *
   * `CODEX_HOME` is left where the user has it. The login lives in it — `auth.json`, or the keyring
   * entry keyed by its path — and `codex login status` run with a directory of its own answers
   * "Not logged in" on a machine that is (checked on 23 September 2026, Windows, codex-cli 0.154.0).
   * So Codex still reads the user's own `config.toml` beneath Hemera's overrides; what it keeps of
   * it is its private part.
   */
  bareMode: () => ({
    means:
      "Hemera's patch of the adapter: no environment, Hemera's tools as dynamic tools, CODEX_CONFIG turning off web search, the feature tools and the user's MCP servers",
    base: 'embedded_resource',
    // Codex collects every AGENTS.md from the project root down to its working directory
    // (`codex-rs/core/src/agents_md.rs`), and the patch leaves that alone.
    readsAgentsFile: true,
    private:
      "the user's own config.toml under Hemera's overrides, their ~/.codex/AGENTS.md, skills and hooks, and the project's .codex/config.toml still load; Hemera does not read them.",
    options: () => ({
      meta: { hemera: { bare: true, toolServer: 'hemera' } },
      env: { CODEX_CONFIG: JSON.stringify(BARE_CONFIG) },
      files: [],
    }),
    qualified: true,
  }),
}
