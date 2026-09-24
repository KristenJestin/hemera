/**
 * The stand-ins of the bare-mode suites (D6-02): an agent whose means leaves a tool of its own
 * behind, for the suites of the refusal, and OpenCode qualified on every platform, for the suites
 * that run a Session on it.
 *
 * An agent whose means leaves a tool of its own behind, for the suites of the refusal.
 *
 * None of the three agents is one since Codex was qualified by Hemera's patch of its adapter, and
 * the refusal is still the design's answer for the next agent that cannot be emptied. So it is
 * played on a stand-in: Codex's name and means, a residue declared, and discovery answering it in
 * Codex's place for as long as a suite runs.
 */

import { afterEach, beforeEach } from 'vite-plus/test'

import type { AgentAdapter } from '#engine/agents/adapter.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'
import { ADAPTERS } from '#engine/agents/discovery.ts'

/** What the stand-in declares it keeps. */
export const RESIDUE = 'a stand-in residue: one tool of its own that no switch reaches'

/** Codex, declaring a residue. */
export const unqualified: AgentAdapter = {
  ...codex,
  bareMode: (platform) => {
    const { means, base, readsAgentsFile, private: kept, options } = codex.bareMode(platform)
    return {
      means,
      base,
      readsAgentsFile,
      private: kept,
      options,
      qualified: false,
      reason: RESIDUE,
    }
  },
}

/** Runs `body` with discovery answering the stand-in for Codex, and puts Codex back after. */
export async function withUnqualifiedCodex<T>(body: () => Promise<T>): Promise<T> {
  ADAPTERS.codex = unqualified
  try {
    return await body()
  } finally {
    ADAPTERS.codex = codex
  }
}

/**
 * OpenCode, qualified wherever the suite runs.
 *
 * Its declaration keeps it off Linux until it has run bare there, which the suites that run a
 * Session on it through the fake agent are not about: they test what Hemera does with an OpenCode
 * Session, on the Linux runner of the CI as on Windows. Its means is its own, untouched.
 */
export const qualifiedOpenCode: AgentAdapter = {
  ...opencode,
  bareMode: (platform) => {
    const { means, base, readsAgentsFile, private: kept, options } = opencode.bareMode(platform)
    return { means, base, readsAgentsFile, private: kept, options, qualified: true }
  },
}

/** Has discovery answer OpenCode qualified for every test of the calling suite, and puts it back. */
export function withQualifiedOpenCode(): void {
  beforeEach(() => {
    ADAPTERS.opencode = qualifiedOpenCode
  })
  afterEach(() => {
    ADAPTERS.opencode = opencode
  })
}
