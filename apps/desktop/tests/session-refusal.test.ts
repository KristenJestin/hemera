/**
 * A Session is not made on an agent that cannot run bare (design D6-02).
 *
 * The refusal is the engine's, at `sessions.create`, before anything is written — not only when
 * the agent is started. What is under test is what the window is told, through the stores the
 * Home is drawn from: the composer's menu draws the agent, off, with one line under it; a
 * Session asked for all the same is refused in the adapter's own words, and no Session exists.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { bareModeOf } from '#engine/agents/bare.ts'
import { ADAPTERS } from '#engine/agents/discovery.ts'
import { fakeAgent } from '#engine/agents/fake.ts'
import { agentSnapshot, loadAgents } from '#renderer/agent-store.ts'
import { offeredOf } from '#renderer/bare-mode.ts'
import { sessionsSnapshot, startSession } from '#renderer/sessions-store.ts'

import { withQualifiedOpenCode, withUnqualifiedCodex } from './unqualified.ts'
import { type OpenWindow, install, openWindow } from './window.ts'

let dataFolder: string
let workspace: string
let opened: OpenWindow | null = null

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-session-refusal-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-session-refusal-workspace-'))
})

afterEach(async () => {
  await opened?.close()
  opened = null
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

describe('An unqualified combination is refused with its reason', () => {
  test('the menu draws the agent off, with one line under it and not the reason', () =>
    withUnqualifiedCodex(async () => {
      opened = await openWindow(dataFolder, fakeAgent())
      install(opened.bridge)
      const declared = bareModeOf(ADAPTERS.codex, process.platform)
      if (declared.qualified)
        throw new Error('the stand-in is qualified: this scenario has no subject')

      await loadAgents()
      const codex = agentSnapshot().agents.find((one) => one.id === 'codex')
      const offered = codex === undefined ? null : offeredOf(codex)
      expect(offered?.available).toBe(false)
      expect(offered?.hint).toBe('Not available here')
      // A qualified agent is offered as it always was, with nothing under it.
      const claude = agentSnapshot().agents.find((one) => one.id === 'claude')
      const qualified = claude === undefined ? null : offeredOf(claude)
      expect(qualified?.available).toBe(true)
      expect(qualified?.hint).toBeUndefined()
    }))

  test('the Session is not created, and the reason shown is the one the adapter declares', () =>
    withUnqualifiedCodex(async () => {
      opened = await openWindow(dataFolder, fakeAgent())
      install(opened.bridge)
      const project = await opened.bridge.invoke('projects.create', {
        name: 'Atlas',
        tone: 'primary',
        mainPath: workspace,
      })
      const declared = bareModeOf(ADAPTERS.codex, process.platform)
      if (declared.qualified)
        throw new Error('the stand-in is qualified: this scenario has no subject')
      const sentence = `Codex cannot run without its own tools here: ${declared.reason}`

      // Asked all the same, the engine refuses at the creation, in the adapter's own words.
      expect(await startSession(project.id, 'codex')).toBeNull()
      expect(sessionsSnapshot().refusal).toBe(sentence)
      expect(await opened.bridge.invoke('sessions.list', { projectId: project.id })).toEqual([])
    }))
})

describe("A qualified agent has only Hemera's tools", () => {
  withQualifiedOpenCode()

  test('the diagnostic says it started bare and was handed the MCP server, and not the token', async () => {
    opened = await openWindow(dataFolder, fakeAgent({ steps: [{ does: 'says', text: 'ok' }] }))
    const project = await opened.bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: workspace,
    })
    const session = await opened.bridge.invoke('sessions.create', {
      projectId: project.id,
      provider: 'opencode',
    })
    await opened.bridge.invoke('agents.prompt', { sessionId: session.id, text: 'hello' })

    const started = opened.written.filter((line) =>
      line.startsWith('agents: OpenCode started bare'),
    )
    expect(started).toHaveLength(1)
    expect(started[0]).toContain(`for Session ${session.id}`)
    expect(started[0]).toContain(bareModeOf(ADAPTERS.opencode, process.platform).means)
    expect(started[0]).toMatch(/Hemera's MCP server handed at http:\/\/127\.0\.0\.1:\d+ as \S+$/)
    expect(started[0]).not.toContain('Bearer')
  })
})
