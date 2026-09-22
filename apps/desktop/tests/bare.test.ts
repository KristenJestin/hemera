/**
 * Bare mode: the means of each agent, and the Session an unqualified one does not get
 * (design D6-02, D6-09).
 *
 * The two scenarios of the Spec are played here against what the adapters declare, on both
 * platforms and from a machine that is only one of them. What a real agent then lists is the
 * phase 3 trial's to read; what is checked here is what Hemera hands it, and what it refuses to
 * hand. The declarations themselves come from `docs/technical/bare-mode-2026-09.md`, which read
 * them in the three agents' own sources.
 */

import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS } from '#engine/agents/adapter.ts'
import { bareModeOf, bareOptionsOf } from '#engine/agents/bare.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'

const ADAPTERS = [claude, codex, opencode]

/** What a refused agent declares it keeps, or a test that named a qualified one by mistake. */
const reasonOf = (adapter: (typeof ADAPTERS)[number], platform: NodeJS.Platform): string => {
  const mode = bareModeOf(adapter, platform)
  if (mode.qualified) throw new Error(`${adapter.id} is qualified: it declares no reason`)
  return mode.reason
}

/** The two a machine can be, asked from whichever one this is. */
const PLATFORMS: readonly NodeJS.Platform[] = ['linux', 'win32']

/** A Session's own directory, and the base the Context provides (D6-07). */
const input = {
  ownerDirectory: '/hemera/agents/session-1',
  base: 'Work inside Hemera, and favour its tools.',
}

describe("A qualified agent has only Hemera's tools", () => {
  test('the three agents each declare one, so a fourth is a compile error', () => {
    for (const adapter of ADAPTERS) expect(bareModeOf(adapter, 'linux').means).not.toBe('')
    expect(ADAPTERS.map((adapter) => adapter.id)).toEqual([...AGENT_PROVIDERS])
  })

  test('Claude Code and OpenCode are the two that can be emptied, on both platforms', () => {
    for (const platform of PLATFORMS) {
      expect(bareModeOf(claude, platform).qualified).toBe(true)
      expect(bareModeOf(opencode, platform).qualified).toBe(true)
    }
  })

  test('Claude Code is handed no built-in tool and no settings source', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(options.meta?.claudeCode.options.tools).toEqual([])
    expect(options.meta?.claudeCode.options.settingSources).toEqual([])
    expect(options.meta?.claudeCode.options.systemPrompt).toEqual({
      type: 'custom',
      prompt: input.base,
      snapshot: true,
    })
    // This agent reads its environment out of `_meta`, so nothing is handed to its process.
    expect(options.env).toEqual({})
  })

  test('the isolation Claude Code is pointed at is a directory of Hemera own', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(options.meta?.claudeCode.options.env).toEqual({
      CLAUDE_CONFIG_DIR: input.ownerDirectory,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    })
  })

  test('OpenCode is handed a catch-all deny, with its own namespace re-allowed', async () => {
    const options = await Effect.runPromise(bareOptionsOf(opencode, 'linux', input))

    expect(options.meta).toBeUndefined()
    expect(options.env).toEqual({
      XDG_CONFIG_HOME: input.ownerDirectory,
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        default_agent: 'hemera',
        agent: {
          hemera: { mode: 'primary', permission: { '*': 'deny', 'hemera_*': 'allow' } },
          build: { disable: true },
          plan: { disable: true },
        },
      }),
    })
  })

  test('the re-allow is the one that matters: a blanket deny hides Hemera tools too', async () => {
    const options = await Effect.runPromise(bareOptionsOf(opencode, 'linux', input))
    const config = options.env.OPENCODE_CONFIG_CONTENT ?? ''

    expect(config).toContain('"*":"deny"')
    expect(config).toContain('"hemera_*":"allow"')
  })

  test('the means it declares is the one the Context view names, per platform', () => {
    const windows = bareModeOf(opencode, 'win32')
    const linux = bareModeOf(opencode, 'linux')

    expect(linux.means).not.toBe('')
    // The wildcard matching is case-insensitive on Windows only, and the declaration says so
    // where it is read rather than in a comment nobody sees.
    expect(windows.means).toContain('Windows')
    expect(windows.means).not.toBe(linux.means)
  })
})

describe('An unqualified combination is refused with its reason', () => {
  test('Codex opens no Session, on either platform', async () => {
    // The refusal is the answer, and there is nothing to hand over: flipping the effect is what
    // proves no options were built at all, on either platform.
    const refused = await Promise.all(
      PLATFORMS.map((platform) => {
        expect(bareModeOf(codex, platform).qualified).toBe(false)
        return Effect.runPromise(Effect.flip(bareOptionsOf(codex, platform, input)))
      }),
    )

    for (const one of refused) {
      expect(one.id).toBe('codex')
      expect(one.label).toBe('Codex')
    }
  })

  test('the reason shown is the one the adapter declares, and it names the residue', async () => {
    const refused = await Effect.runPromise(Effect.flip(bareOptionsOf(codex, 'linux', input)))

    expect(refused.reason).toBe(reasonOf(codex, 'linux'))
    expect(refused.reason).toContain('apply_patch')
    expect(refused.reason).toContain('read_mcp_resource')
    // The means travels with the refusal, because the window shows both.
    expect(refused.means).toBe(bareModeOf(codex, 'linux').means)
  })
})
