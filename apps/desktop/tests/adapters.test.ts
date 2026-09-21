/**
 * The three agents, as Hemera describes them to itself (design D5-02).
 *
 * What is checked here is what each adapter claims about its own agent: the command to look for
 * on the `PATH`, the arguments that start it, the version its output carries, and what its
 * `initialize` answer says about being signed in. The commands, the arguments and the auth
 * methods come from the survey of the three providers
 * (`docs/technical/acp-providers-2026-09.md`), which read them in the agents' own sources
 * without running any of them.
 */

import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS, versionIn } from '#engine/agents/adapter.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'

const ADAPTERS = [claude, codex, opencode]

describe('An adapter is one agent, described', () => {
  test('the three agents of the lot each have one, under their own name', () => {
    expect(ADAPTERS.map((adapter) => adapter.id)).toEqual([...AGENT_PROVIDERS])
  })

  test('each one carries the name its own documentation uses', () => {
    expect(claude.label).toBe('Claude Code')
    expect(codex.label).toBe('Codex')
    expect(opencode.label).toBe('OpenCode')
  })

  test('each one names the command that starts it on a machine, and never npx', () => {
    expect(claude.command).toBe('claude-agent-acp')
    expect(claude.args).toEqual([])
    expect(codex.command).toBe('codex-acp')
    expect(codex.args).toEqual([])
    expect(opencode.command).toBe('opencode')
    expect(opencode.args).toEqual(['acp'])
    expect(ADAPTERS.map((adapter) => adapter.command)).not.toContain('npx')
  })

  test('each one says how to install it, for a machine that does not have it yet', () => {
    expect(claude.installHint).toBe('npm install -g @agentclientprotocol/claude-agent-acp')
    expect(codex.installHint).toBe('npm install -g @agentclientprotocol/codex-acp')
    expect(opencode.installHint).toBe('npm install -g opencode-ai')
  })
})

describe('The version an agent printed', () => {
  test('is read out of the line, wherever in the line the agent put it', () => {
    expect(versionIn('0.78.0')).toBe('0.78.0')
    expect(versionIn('claude-agent-acp 0.78.0\n')).toBe('0.78.0')
    expect(versionIn('codex-acp v1.12.0 (2026-09-15)')).toBe('1.12.0')
    expect(versionIn('opencode-ai@1.18.31')).toBe('1.18.31')
    expect(versionIn('1.0.0-rc.1')).toBe('1.0.0-rc.1')
  })

  test('is unknown when the agent printed none, not an agent that was not found', () => {
    expect(versionIn('')).toBeUndefined()
    expect(versionIn('codex-acp: command not found')).toBeUndefined()
  })

  test('is read the same way by the three adapters, the one thing their agents agree on', () => {
    for (const adapter of ADAPTERS) expect(adapter.readVersion('2.0.31')).toBe('2.0.31')
  })
})

describe('Being signed in is read from what the agent announced', () => {
  test('an agent that announced nothing has nothing left to sign in through', () => {
    for (const adapter of ADAPTERS) expect(adapter.isAuthenticated([])).toBe(true)
  })

  test('Claude Code announcing a login is a sign-in Hemera does not do for the user', () => {
    expect(claude.isAuthenticated([{ id: 'claude-ai-login' }])).toBe(false)
    expect(
      claude.isAuthenticated([{ id: 'console-login', name: 'Use Anthropic Console (API usage)' }]),
    ).toBe(false)
    // The gateway methods appear only for a client that advertises a gateway, which Hemera is
    // not: a machine that configured one has nothing left to sign in through.
    expect(claude.isAuthenticated([{ id: 'gateway' }])).toBe(true)
  })

  test('the API key Codex offers whatever the machine is read as saying nothing', () => {
    expect(codex.isAuthenticated([{ id: 'api-key' }])).toBe(true)
  })

  test('Codex announcing one of its ChatGPT flows is a sign-in Hemera does not drive', () => {
    expect(codex.isAuthenticated([{ id: 'api-key' }, { id: 'chat-gpt' }])).toBe(false)
    expect(codex.isAuthenticated([{ id: 'chat-gpt-device-code' }])).toBe(false)
  })

  test('the single login OpenCode publishes is a sign-in Hemera does not type', () => {
    expect(opencode.isAuthenticated([{ id: 'opencode', name: 'Login with opencode' }])).toBe(false)
  })
})
