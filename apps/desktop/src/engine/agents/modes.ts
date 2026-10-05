/**
 * The permission modes each agent reports, kept as data only: identifiers and names, for the
 * settings and the decision records of #38. Nothing reads a mode to decide whether a call is
 * asked: an agent's own mode never lets a call through by itself.
 *
 * The identifiers and names are the adapters' own (`claude-agent-acp` announces Bypass
 * permissions only where it is allowed). OpenCode in bare mode runs Hemera's own agent, with
 * `build` and `plan` disabled: it has no mode to report.
 */

import type { AgentProvider } from '@hemera/core/domain'

export interface AgentMode {
  readonly id: string
  readonly name: string
}

export const AGENT_MODES: Readonly<Record<AgentProvider, ReadonlyArray<AgentMode>>> = {
  claude: [
    { id: 'default', name: 'Manual' },
    { id: 'acceptEdits', name: 'Accept edits' },
    { id: 'plan', name: 'Plan' },
    { id: 'auto', name: 'Auto' },
    { id: 'bypassPermissions', name: 'Bypass permissions' },
  ],
  codex: [
    { id: 'read-only', name: 'Ask for approval' },
    { id: 'agent', name: 'Approve for me' },
    { id: 'agent-full-access', name: 'Full access' },
  ],
  opencode: [],
}
