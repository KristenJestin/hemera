/**
 * Codex. Its command is `codex`; it speaks no ACP itself, so what Hemera starts is the adapter
 * `@agentclientprotocol/codex-acp` it carries, pointed at the user's own `codex` through
 * `CODEX_PATH`.
 *
 * The login is `auth.json` in `CODEX_HOME`, `~/.codex` by default (a keyring writes no file: the
 * machine then reads as signed out before a session starts). `CODEX_HOME` is left where the user
 * has it.
 *
 * Bare mode is Hemera's patch of the adapter (`patches/`), switched on by `_meta.hemera`: no
 * environment on any thread or turn (no shell, no `apply_patch`, no image viewer), Hemera's MCP
 * tools handed to Codex as dynamic tools `hemera_<tool>` and forwarded to Hemera's server as
 * `tools/call` with the bearer token and the call id, the user's MCP servers and skills disabled,
 * no title thread. `CODEX_CONFIG` turns off the rest.
 */

import { join } from 'node:path'

import { Qualified } from '@hemera/ipc'

import type { AgentAdapter } from '../adapter.ts'
import { HEMERA_SERVER, hemeraServer } from '../bare.ts'

/** The method Codex announces whether or not the machine is signed in. */
const ALWAYS_OFFERED = 'api-key'

/**
 * Merged by the adapter into every thread, like `-c` on Codex's command line: web search off,
 * every optional feature off, sub-agents and skills off. Nested and never dotted: the adapter
 * adds a `features` table of its own, and a dotted `features.x` beside it is lost.
 */
const BARE_CONFIG = {
  web_search: 'disabled',
  approval_policy: 'on-request',
  tools: {
    update_plan: { enabled: false },
    experimental_request_user_input: { enabled: false },
  },
  agents: { enabled: false },
  orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
  skills: { include_instructions: false, bundled: { enabled: false } },
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
  instructionFile: 'AGENTS.md',
  // Codex reads the AGENTS.md of the folder it runs in, bare or not (the old adapter's value).
  readsInstructionFiles: () => true,
  signalsCompaction: false,
  obeysNotes: true,
  command: 'codex',
  package: '@openai/codex',
  installHint: 'npm install -g @openai/codex',
  loginHint: 'codex login',
  loginFiles: (home, env) => [join(env.CODEX_HOME ?? join(home, '.codex'), 'auth.json')],
  acp: { from: 'bundled', package: '@agentclientprotocol/codex-acp', agentVariable: 'CODEX_PATH' },
  // The API key says nothing about the machine; a ChatGPT flow is a sign-in Hemera does not drive.
  isAuthenticated: (methods) => methods.every((method) => method.id === ALWAYS_OFFERED),
  qualification: () => Qualified.make({}),
  bareOptions: (input) => ({
    mcpServers: [hemeraServer(input.hemera)],
    meta: { hemera: { bare: true, toolServer: HEMERA_SERVER } },
    env: { CODEX_CONFIG: JSON.stringify(BARE_CONFIG) },
    systemPromptAs: 'embedded-resource',
  }),
}
