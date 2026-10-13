import type { ReactNode } from 'react'

import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { IconTerminal } from '../../icons.ts'

/** What a kept agent is, in plain words: its chip's legend. */
export const KEPT_AGENT_WORDS =
  'An agent Hemera started before its last restart is still running. Hemera could not stop it, and stops it the next time Hemera starts.'

/** An agent Hemera started before its last restart and could not stop: its program and pid. */
export interface KeptAgentView {
  program: string
  pid: number
}

/** The kept agents of a stage card's chips, one chip each. */
export function keptAgentChips(kept: readonly KeptAgentView[]): ReactNode {
  return kept.map((agent) => (
    <KeptAgentChip key={agent.pid} program={agent.program} pid={agent.pid} />
  ))
}

export interface KeptAgentChipProps {
  /** The agent's program, as the system names it: `claude`, `codex`. */
  program: string
  pid: number
}

/**
 * An agent of the mission that Hemera started before its last restart and could not stop, in the
 * stage card's chips of what runs: its program and pid, the bell in the warning tone, no duration
 * (Hemera does not know since when it runs), and what it is in plain words as its legend. It goes
 * once the agent is stopped or gone.
 */
export function KeptAgentChip({ program, pid }: KeptAgentChipProps): ReactNode {
  return (
    <LiveChip
      name={`${program} · pid ${String(pid)}`}
      icon={<IconTerminal size="sm" />}
      state="stuck"
      calls
      startedAt={null}
      endedAt={null}
      legend={KEPT_AGENT_WORDS}
    />
  )
}
