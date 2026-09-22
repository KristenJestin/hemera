/**
 * The three agents, as Hemera describes them to itself (design D5-02, D5-21).
 *
 * What is checked here is what each adapter claims about its own agent: the command the reader
 * installs and the `PATH` is read for, the command Hemera spawns to expose it as an ACP agent,
 * the version its output carries, where its own login file sits, and what its `initialize` answer
 * says about being signed in. The commands, the arguments and the auth methods come from the
 * survey of the three providers (`docs/technical/acp-providers-2026-09.md`), which read them in
 * the agents' own sources without running any of them.
 */

import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS, versionIn } from '#engine/agents/adapter.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'

const ADAPTERS = [claude, codex, opencode]

/**
 * A home directory, and the separator of the machine the suite runs on: an agent's own paths are
 * built with the platform's own `join`, so what is expected here is built the same way.
 */
const HOME = '/home/ana'

describe('An adapter is one agent, described', () => {
  test('the three agents of the lot each have one, under their own name', () => {
    expect(ADAPTERS.map((adapter) => adapter.id)).toEqual([...AGENT_PROVIDERS])
  })

  test('each one carries the name its own documentation uses', () => {
    expect(claude.label).toBe('Claude Code')
    expect(codex.label).toBe('Codex')
    expect(opencode.label).toBe('OpenCode')
  })

  test('each one names the command the reader installs, and never npx', () => {
    expect(claude.command).toBe('claude')
    expect(codex.command).toBe('codex')
    expect(opencode.command).toBe('opencode')
    expect(ADAPTERS.map((adapter) => adapter.command)).not.toContain('npx')
  })

  test('the command that exposes an agent as an ACP one belongs to Hemera, not to the reader', () => {
    // Claude Code and Codex speak no ACP themselves: what a Session starts is the package Hemera
    // depends on and resolves out of its own `node_modules`, which the page never shows and the
    // reader never installs. OpenCode is the one agent that starts itself as one (D5-21).
    expect(claude.acp).toEqual({
      from: 'bundled',
      package: '@agentclientprotocol/claude-agent-acp',
      args: [],
    })
    expect(codex.acp).toEqual({
      from: 'bundled',
      package: '@agentclientprotocol/codex-acp',
      args: [],
    })
    expect(opencode.acp).toEqual({ from: 'agent', command: 'opencode', args: ['acp'] })
  })

  test('each one says how to install the agent, and never the adapter Hemera runs (D5-21)', () => {
    expect(claude.installHint).toBe('npm install -g @anthropic-ai/claude-code')
    expect(codex.installHint).toBe('npm install -g @openai/codex')
    expect(opencode.installHint).toBe('npm install -g opencode-ai')
  })

  test('each one says which command signs its agent in, for the page to offer (D5-21)', () => {
    expect(claude.loginHint).toBe('claude auth login')
    expect(codex.loginHint).toBe('codex login')
    expect(opencode.loginHint).toBe('opencode auth login')
  })

  test('each one says where the agent keeps the login its own command wrote (D5-21)', () => {
    expect(claude.loginFiles(HOME, {})).toEqual([join(HOME, '.claude', '.credentials.json')])
    expect(codex.loginFiles(HOME, {})).toEqual([join(HOME, '.codex', 'auth.json')])
    expect(opencode.loginFiles(HOME, {})).toEqual([
      join(HOME, '.local', 'share', 'opencode', 'auth.json'),
    ])
  })

  test('the directory an agent was told to use is the one read, over its default', () => {
    // Each of the three reads the variable its own documentation gives, so a reader who moved a
    // config directory is read where the agent really writes.
    expect(claude.loginFiles(HOME, { CLAUDE_CONFIG_DIR: join(HOME, 'config') })).toEqual([
      join(HOME, 'config', '.credentials.json'),
    ])
    expect(codex.loginFiles(HOME, { CODEX_HOME: join(HOME, 'elsewhere') })).toEqual([
      join(HOME, 'elsewhere', 'auth.json'),
    ])
    expect(opencode.loginFiles(HOME, { XDG_DATA_HOME: join(HOME, 'data') })).toEqual([
      join(HOME, 'data', 'opencode', 'auth.json'),
    ])
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
