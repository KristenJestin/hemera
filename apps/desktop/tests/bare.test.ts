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

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { z } from 'zod'
import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS } from '#engine/agents/adapter.ts'
import { bareModeOf, bareOptionsOf } from '#engine/agents/bare.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'
import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { aSessionOn, application } from './application.ts'

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

/** A data folder and a Workspace of the suite's own, for the runs below. */
const folders = () => ({
  data: mkdtempSync(join(tmpdir(), 'hemera-bare-')),
  workspace: mkdtempSync(join(tmpdir(), 'hemera-bare-workspace-')),
})

describe("A qualified agent has only Hemera's tools", () => {
  test('its means reaches the agent: the process for OpenCode, the session for Claude Code', async () => {
    const places = folders()
    const opencodeAgent = fakeAgent()
    const claudeAgent = fakeAgent()
    try {
      for (const [provider, agent] of [
        ['opencode', opencodeAgent],
        ['claude', claudeAgent],
      ] as const) {
        mkdirSync(join(places.data, provider))
        // oxlint-disable-next-line no-await-in-loop -- one run of the application per agent, one after the other
        await application(join(places.data, provider))(agent)(
          Effect.gen(function* () {
            const runtime = yield* AgentRuntime
            const session = yield* aSessionOn(places.workspace, provider)
            yield* runtime.start(session.id)
          }),
        )
      }

      // OpenCode reads its means from its environment, pointed at a directory of Hemera's.
      const environment = opencodeAgent.environments[0] ?? {}
      expect(environment.XDG_CONFIG_HOME).toBe(join(places.data, 'opencode', 'agents', 'opencode'))
      expect(environment.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
      expect(environment.OPENCODE_CONFIG_CONTENT).toContain('"hemera_*":"allow"')
      expect(opencodeAgent.answers.metas).toEqual([null])
      // Claude Code reads it from `_meta`, on the session itself: no built-in tool.
      const meta = z
        .object({ claudeCode: z.object({ options: z.object({ tools: z.array(z.string()) }) }) })
        .parse(JSON.parse(claudeAgent.answers.metas[0] ?? '{}'))
      expect(meta.claudeCode.options.tools).toEqual([])
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})

describe('An unqualified combination is refused with its reason', () => {
  test('a Session on Codex starts nothing, and the refusal is the reason Codex declares', async () => {
    const places = folders()
    const agent = fakeAgent()
    try {
      const refused = await application(places.data)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(places.workspace, 'codex')
          return yield* Effect.flip(runtime.start(session.id))
        }),
      )

      expect(refused.message).toContain(reasonOf(codex, process.platform))
      // Refused before anything was written or started for it.
      expect(agent.starts).toEqual([])
      expect(existsSync(join(places.data, 'agents', 'codex'))).toBe(false)
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})
