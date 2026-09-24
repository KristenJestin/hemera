/**
 * The bare mode of each agent, as the Agents section of the settings reads it (design D6-02).
 *
 * The section is drawn from `agents.list`, asked through the agent store over the whole engine:
 * what is under test is that each agent's row carries what its adapter declares for this
 * platform — for a qualified agent, what it keeps that Hemera does not control; for one that is
 * not, the adapter's own sentence and the means it was about.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { ADAPTERS } from '#engine/agents/discovery.ts'
import { bareModeOf } from '#engine/agents/bare.ts'
import { NOT_RUN_ON_LINUX } from '#engine/agents/adapters/opencode.ts'
import { agentSnapshot, loadAgents } from '#renderer/agent-store.ts'
import { bareRowOf } from '#renderer/bare-mode.ts'

import { withUnqualifiedCodex } from './unqualified.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-agents-section-'))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
})

describe("A qualified agent has only Hemera's tools", () => {
  test('its row says what it keeps that Hemera does not control', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    install(opened.bridge)
    await loadAgents()

    const declared = bareModeOf(ADAPTERS.claude, process.platform)
    const claude = agentSnapshot().agents.find((one) => one.id === 'claude')
    expect(claude?.bareMode.qualified).toBe(true)
    expect(claude?.bareMode.reason).toBeNull()
    expect(claude?.bareMode.private).toBe(declared.private)
    const row = claude === undefined ? null : bareRowOf(claude)
    expect(row).toEqual({ qualified: true, private: declared.private })
  })

  test('OpenCode is qualified on Windows and not yet on Linux', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    install(opened.bridge)
    await loadAgents()

    // The section reads the declaration of the platform the engine runs on, so the row this
    // machine draws is the one of its own platform, and the other one is the declaration's.
    const declared = bareModeOf(ADAPTERS.opencode, process.platform)
    const opencode = agentSnapshot().agents.find((one) => one.id === 'opencode')
    const row = opencode === undefined ? null : bareRowOf(opencode)
    if (process.platform === 'linux') {
      expect(row).toEqual({
        qualified: false,
        reason: `${NOT_RUN_ON_LINUX} Means tried: ${declared.means}.`,
      })
    } else {
      expect(row).toEqual({ qualified: true, private: declared.private })
    }
    expect(bareModeOf(ADAPTERS.opencode, 'win32').qualified).toBe(true)
    expect(bareModeOf(ADAPTERS.opencode, 'linux')).toMatchObject({
      qualified: false,
      reason: NOT_RUN_ON_LINUX,
    })
  })
})

describe('An unqualified combination is refused with its reason', () => {
  test('its row says it does not run bare, in the words its adapter declares', () =>
    withUnqualifiedCodex(async () => {
      opened = await openWindow(dataFolder, fakeAgent())
      install(opened.bridge)
      await loadAgents()

      const declared = bareModeOf(ADAPTERS.codex, process.platform)
      const codex = agentSnapshot().agents.find((one) => one.id === 'codex')
      expect(declared.qualified).toBe(false)
      expect(codex?.bareMode).toEqual({
        means: declared.means,
        qualified: false,
        reason: declared.qualified ? null : declared.reason,
        private: declared.private,
      })
      const row = codex === undefined ? null : bareRowOf(codex)
      expect(row).toEqual({
        qualified: false,
        reason: `${declared.qualified ? 'unreachable' : declared.reason} Means tried: ${declared.means}.`,
      })
    }))
})
