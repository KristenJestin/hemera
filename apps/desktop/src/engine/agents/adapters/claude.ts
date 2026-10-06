/**
 * Claude Code. Its command is `claude`; it speaks no ACP itself, so what Hemera starts is the
 * adapter `@agentclientprotocol/claude-agent-acp` it carries, pointed at the user's own `claude`
 * through `CLAUDE_CODE_EXECUTABLE` (left to itself, the adapter would run a platform binary of
 * its own that Hemera does not ship).
 *
 * The login is `.credentials.json` in `CLAUDE_CONFIG_DIR`, `~/.claude` by default. On macOS the
 * Keychain holds it and no file is written: the machine then reads as signed out before a
 * session starts, and the answer to `initialize` is what counts.
 *
 * Bare mode goes through `session/new` `_meta.claudeCode.options`: no built-in tool, no settings
 * source (so it reads neither `CLAUDE.md` nor `AGENTS.md` on its own), only the MCP servers
 * handed in, and Hemera's system prompt. `CLAUDE_CONFIG_DIR` is left where the user has it: the
 * login lives there.
 */

import { join } from 'node:path'

import { Qualified } from '@hemera/ipc'

import type { AgentAdapter } from '../adapter.ts'
import { hemeraServer } from '../bare.ts'

/** How long the agent waits on one of Hemera's tools, which may wait on the user: ten minutes. */
export const TOOL_WAIT_MS = 600_000

/** The two logins the adapter announces when the machine still has to sign in. */
const LOGINS: ReadonlySet<string> = new Set(['claude-ai-login', 'console-login'])

export const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  instructionFile: 'CLAUDE.md',
  // Started with `settingSources: []`, it reads no CLAUDE.md of its own: Hemera sends it.
  readsInstructionFiles: () => false,
  // Its adapter reports a compaction as a tool call marked `_meta.contextCompaction`.
  signalsCompaction: true,
  obeysNotes: true,
  command: 'claude',
  package: '@anthropic-ai/claude-code',
  installHint: 'npm install -g @anthropic-ai/claude-code',
  loginHint: 'claude auth login',
  loginFiles: (home, env) => [
    join(env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'), '.credentials.json'),
  ],
  acp: {
    from: 'bundled',
    package: '@agentclientprotocol/claude-agent-acp',
    agentVariable: 'CLAUDE_CODE_EXECUTABLE',
  },
  // The gateway methods appear only for a client that advertises a gateway, which Hemera does
  // not: only the two logins mean a sign-in is still to do.
  isAuthenticated: (methods) => !methods.some((method) => LOGINS.has(method.id)),
  qualification: () => Qualified.make({}),
  bareOptions: (input) => ({
    mcpServers: [hemeraServer(input.hemera)],
    meta: {
      claudeCode: {
        options: {
          tools: [],
          allowedTools: input.allowedTools ?? [],
          settingSources: [],
          strictMcpConfig: true,
          systemPrompt: { type: 'custom', prompt: input.systemPrompt, snapshot: true },
          env: {
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
            ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
            // A call waiting on the user sends nothing: both the total and the idle limit must
            // outlast the wait, or Claude Code aborts the call first.
            MCP_TOOL_TIMEOUT: String(TOOL_WAIT_MS),
            CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: String(TOOL_WAIT_MS),
          },
        },
      },
    },
    env: {},
    systemPromptAs: 'session-meta',
  }),
}
