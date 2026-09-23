/**
 * The bare mode of each agent, as the Agents section of the settings reads it (design D6-02).
 *
 * The section is drawn from `agents.list`, asked through the agent store over the whole engine:
 * what is under test is that each agent's row carries what its adapter declares for this
 * platform — qualified or not, the means, and the adapter's own sentence when it is not.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { ADAPTERS } from '#engine/agents/discovery.ts'
import { bareModeOf } from '#engine/agents/bare.ts'
import { agentSnapshot, loadAgents } from '#renderer/agent-store.ts'
import { bareRowOf } from '#renderer/bare-mode.ts'

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
  test('its row says it runs bare, and by which means', async () => {
    opened = await openWindow(dataFolder, fakeAgent())
    install(opened.bridge)
    await loadAgents()

    const opencode = agentSnapshot().agents.find((one) => one.id === 'opencode')
    expect(opencode?.bareMode.qualified).toBe(true)
    expect(opencode?.bareMode.reason).toBeNull()
    const row = opencode === undefined ? null : bareRowOf(opencode)
    expect(row?.qualified).toBe(true)
    expect(row?.reason).toContain(bareModeOf(ADAPTERS.opencode, process.platform).means)
  })
})

describe('An unqualified combination is refused with its reason', () => {
  test('its row says it does not run bare, in the words its adapter declares', async () => {
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
    })
    const row = codex === undefined ? null : bareRowOf(codex)
    expect(row?.qualified).toBe(false)
    expect(row?.reason).toContain(declared.qualified ? 'unreachable' : declared.reason)
  })
})
