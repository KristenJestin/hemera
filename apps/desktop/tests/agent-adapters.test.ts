/**
 * The three agents as Hemera declares them, and what running each bare means: the command, the
 * hints, the login files with each agent's own overrides, the ACP entry, how authentication is
 * read, the bare options, the qualification per OS, and the modes kept as data.
 *
 * What is checked is what Hemera hands an agent. What a fake agent then receives is the client's
 * suite to check; no real agent runs here.
 */

import { join } from 'node:path'

import { AGENT_PROVIDERS } from '@hemera/core/domain'
import { BareModeNotQualified, NotQualified, Qualified } from '@hemera/ipc'
import { Effect, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { versionIn } from '../src/engine/agents/adapter.ts'
import { ADAPTERS as BY_PROVIDER } from '../src/engine/agents/adapters/index.ts'
import { claude } from '../src/engine/agents/adapters/claude.ts'
import { codex } from '../src/engine/agents/adapters/codex.ts'
import { NOT_RUN_ON_LINUX, opencode } from '../src/engine/agents/adapters/opencode.ts'
import {
  type BareInput,
  E2E_QUALIFIED,
  agentDirectoryOf,
  hemeraServer,
  qualificationOf,
  refusedUnlessQualified,
} from '../src/engine/agents/bare.ts'
import { AGENT_MODES } from '../src/engine/agents/modes.ts'

const HOME = '/home/ana'

const ADAPTERS = AGENT_PROVIDERS.map((provider) => BY_PROVIDER[provider])

const ENDPOINT = { url: 'http://127.0.0.1:4321/mcp', token: 'token-of-the-session' }

const input: BareInput = {
  agentDirectory: '/data/agents/x',
  systemPrompt: 'Work inside Hemera, with its tools.',
  hemera: ENDPOINT,
}

const HEMERA_ONLY = [
  {
    type: 'http',
    name: 'hemera',
    url: ENDPOINT.url,
    headers: [{ name: 'Authorization', value: 'Bearer token-of-the-session' }],
  },
]

const ClaudeMeta = Schema.Struct({
  claudeCode: Schema.Struct({
    options: Schema.Struct({
      tools: Schema.Array(Schema.String),
      allowedTools: Schema.Array(Schema.String),
      settingSources: Schema.Array(Schema.String),
      strictMcpConfig: Schema.Boolean,
      systemPrompt: Schema.Struct({
        type: Schema.Literal('custom'),
        prompt: Schema.String,
        snapshot: Schema.Boolean,
      }),
      env: Schema.Record(Schema.String, Schema.String),
    }),
  }),
})

const CodexConfig = Schema.fromJsonString(
  Schema.Struct({
    web_search: Schema.String,
    tools: Schema.Record(Schema.String, Schema.Struct({ enabled: Schema.Boolean })),
    agents: Schema.Struct({ enabled: Schema.Boolean }),
    orchestrator: Schema.Struct({
      skills: Schema.Struct({ enabled: Schema.Boolean }),
      mcp: Schema.Struct({ enabled: Schema.Boolean }),
    }),
    skills: Schema.Struct({
      include_instructions: Schema.Boolean,
      bundled: Schema.Struct({ enabled: Schema.Boolean }),
    }),
    features: Schema.Record(Schema.String, Schema.Boolean),
  }),
)

const OpenCodeConfig = Schema.fromJsonString(
  Schema.Struct({
    model: Schema.optionalKey(Schema.String),
    small_model: Schema.optionalKey(Schema.String),
    default_agent: Schema.String,
    agent: Schema.Struct({
      hemera: Schema.Struct({
        mode: Schema.String,
        permission: Schema.Record(Schema.String, Schema.String),
      }),
      build: Schema.Struct({ disable: Schema.Boolean }),
      plan: Schema.Struct({ disable: Schema.Boolean }),
    }),
  }),
)

/** Every `allowedTools` list anywhere in some options, however deep, as JSON text. */
const allowedToolsIn = (json: string): ReadonlyArray<string> =>
  [...json.matchAll(/"allowedTools":\[([^\]]*)\]/g)].map((match) => match[1] ?? '')

describe('Each agent is declared once', () => {
  test('the three agents, in the order of the domain', () => {
    expect(ADAPTERS.map((adapter) => adapter.id)).toEqual([...AGENT_PROVIDERS])
    expect(ADAPTERS.map((adapter) => adapter.label)).toEqual(['Claude Code', 'Codex', 'OpenCode'])
  })

  test('each names its own command, never npx, with its install and sign-in hints', () => {
    expect(ADAPTERS.map((adapter) => adapter.command)).toEqual(['claude', 'codex', 'opencode'])
    expect(ADAPTERS.map((adapter) => adapter.installHint)).toEqual([
      'npm install -g @anthropic-ai/claude-code',
      'npm install -g @openai/codex',
      'npm install -g opencode-ai',
    ])
    expect(ADAPTERS.map((adapter) => adapter.loginHint)).toEqual([
      'claude auth login',
      'codex login',
      'opencode auth login',
    ])
  })

  test('the ACP entry is the bundled adapter for Claude Code and Codex, opencode acp for OpenCode', () => {
    expect(claude.acp).toEqual({
      from: 'bundled',
      package: '@agentclientprotocol/claude-agent-acp',
      agentVariable: 'CLAUDE_CODE_EXECUTABLE',
    })
    expect(codex.acp).toEqual({
      from: 'bundled',
      package: '@agentclientprotocol/codex-acp',
      agentVariable: 'CODEX_PATH',
    })
    expect(opencode.acp).toEqual({ from: 'agent', args: ['acp'] })
  })

  test('the login files are where each agent keeps them by default', () => {
    expect(claude.loginFiles(HOME, {})).toEqual([join(HOME, '.claude', '.credentials.json')])
    expect(codex.loginFiles(HOME, {})).toEqual([join(HOME, '.codex', 'auth.json')])
    expect(opencode.loginFiles(HOME, {})).toEqual([
      join(HOME, '.local', 'share', 'opencode', 'auth.json'),
    ])
  })

  test("the login files honour each agent's own environment override", () => {
    expect(claude.loginFiles(HOME, { CLAUDE_CONFIG_DIR: '/c' })).toEqual([
      join('/c', '.credentials.json'),
    ])
    expect(codex.loginFiles(HOME, { CODEX_HOME: '/x' })).toEqual([join('/x', 'auth.json')])
    expect(opencode.loginFiles(HOME, { XDG_DATA_HOME: '/d' })).toEqual([
      join('/d', 'opencode', 'auth.json'),
    ])
  })

  test('the version is read out of whatever line the agent printed', () => {
    expect(versionIn('2.0.31 (Claude Code)')).toBe('2.0.31')
    expect(versionIn('codex-cli 0.154.0\n')).toBe('0.154.0')
    expect(versionIn('1.0.0-rc.1')).toBe('1.0.0-rc.1')
    expect(versionIn('command not found')).toBeNull()
  })
})

describe('Authentication is read from the methods the agent announces', () => {
  test('an agent that announces nothing has nothing left to sign in through', () => {
    for (const adapter of ADAPTERS) expect(adapter.isAuthenticated([])).toBe(true)
  })

  test('Claude Code announcing one of its logins is not signed in', () => {
    expect(claude.isAuthenticated([{ id: 'claude-ai-login' }])).toBe(false)
    expect(claude.isAuthenticated([{ id: 'console-login' }])).toBe(false)
    expect(claude.isAuthenticated([{ id: 'gateway' }])).toBe(true)
  })

  test("Codex's API key says nothing; one of its ChatGPT flows is a sign-in still to do", () => {
    expect(codex.isAuthenticated([{ id: 'api-key' }])).toBe(true)
    expect(codex.isAuthenticated([{ id: 'api-key' }, { id: 'chat-gpt' }])).toBe(false)
  })

  test("OpenCode's single login is a sign-in still to do", () => {
    expect(opencode.isAuthenticated([{ id: 'opencode' }])).toBe(false)
  })
})

describe("Each agent's bare options contain no built-in tool and only the hemera MCP server", () => {
  test('the hemera server is the http entry with the bearer token handed in', () => {
    expect([hemeraServer(ENDPOINT)]).toEqual(HEMERA_ONLY)
    for (const adapter of ADAPTERS) {
      expect(adapter.bareOptions(input).mcpServers).toEqual(HEMERA_ONLY)
    }
  })

  test('Claude Code: no tool, no settings source, strict MCP, a custom system prompt', () => {
    const options = claude.bareOptions(input)
    const meta = Schema.decodeUnknownSync(ClaudeMeta)(options.meta)
    expect(meta.claudeCode.options.tools).toEqual([])
    expect(meta.claudeCode.options.settingSources).toEqual([])
    expect(meta.claudeCode.options.strictMcpConfig).toBe(true)
    expect(meta.claudeCode.options.systemPrompt).toEqual({
      type: 'custom',
      prompt: input.systemPrompt,
      snapshot: true,
    })
    expect(meta.claudeCode.options.env).toEqual({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      MCP_TOOL_TIMEOUT: '600000',
      CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '600000',
    })
    expect(options.env).toEqual({})
    expect(options.systemPromptAs).toBe('session-meta')
  })

  test("Codex: the patch's bare session, every optional feature and tool off", () => {
    const options = codex.bareOptions(input)
    expect(options.meta).toEqual({ hemera: { bare: true, toolServer: 'hemera' } })
    expect(Object.keys(options.env)).toEqual(['CODEX_CONFIG'])
    const config = Schema.decodeUnknownSync(CodexConfig)(options.env.CODEX_CONFIG)
    expect(config.web_search).toBe('disabled')
    expect(config.agents.enabled).toBe(false)
    expect(config.orchestrator).toEqual({ skills: { enabled: false }, mcp: { enabled: false } })
    expect(config.skills).toEqual({ include_instructions: false, bundled: { enabled: false } })
    expect(Object.values(config.tools).every((tool) => !tool.enabled)).toBe(true)
    expect(Object.keys(config.features).length).toBeGreaterThan(0)
    expect(Object.values(config.features).every((enabled) => !enabled)).toBe(true)
    // Nested, never dotted: the adapter adds a `features` table of its own and a dotted key
    // beside it is lost.
    expect(Object.keys(config).some((key) => key.includes('.'))).toBe(false)
    expect(options.systemPromptAs).toBe('embedded-resource')
  })

  test("OpenCode: Hemera's primary agent denies everything but hemera_*, build and plan off", () => {
    const options = opencode.bareOptions(input)
    expect(options.meta).toBeUndefined()
    expect(options.env.XDG_CONFIG_HOME).toBe(input.agentDirectory)
    expect(options.env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
    const config = Schema.decodeUnknownSync(OpenCodeConfig)(options.env.OPENCODE_CONFIG_CONTENT)
    expect(config.default_agent).toBe('hemera')
    expect(config.agent.hemera).toEqual({
      mode: 'primary',
      permission: { '*': 'deny', 'hemera_*': 'allow' },
    })
    expect(config.agent.build.disable).toBe(true)
    expect(config.agent.plan.disable).toBe(true)
    expect(options.systemPromptAs).toBe('embedded-resource')
  })

  test("OpenCode keeps the user's model and small model under Hemera's agent", () => {
    const options = opencode.bareOptions({
      ...input,
      own: { model: 'anthropic/sonnet', small_model: 'anthropic/haiku' },
    })
    const config = Schema.decodeUnknownSync(OpenCodeConfig)(options.env.OPENCODE_CONFIG_CONTENT)
    expect(config.model).toBe('anthropic/sonnet')
    expect(config.small_model).toBe('anthropic/haiku')
    expect(config.default_agent).toBe('hemera')
  })

  test('the agent folders are <data>/agents/<provider>', () => {
    expect(agentDirectoryOf('/data', 'opencode')).toBe(join('/data', 'agents', 'opencode'))
  })
})

describe("The user's own OpenCode settings a bare session keeps", () => {
  const own = opencode.ownSettings

  test('read from its global configuration files, then its last used model', () => {
    expect(own?.files(HOME, {})).toEqual([
      join(HOME, '.config', 'opencode', 'config.json'),
      join(HOME, '.config', 'opencode', 'opencode.json'),
      join(HOME, '.config', 'opencode', 'opencode.jsonc'),
      join(HOME, '.local', 'state', 'opencode', 'model.json'),
    ])
    expect(own?.files(HOME, { XDG_CONFIG_HOME: '/cfg', XDG_STATE_HOME: '/st' })).toEqual([
      join('/cfg', 'opencode', 'config.json'),
      join('/cfg', 'opencode', 'opencode.json'),
      join('/cfg', 'opencode', 'opencode.jsonc'),
      join('/st', 'opencode', 'model.json'),
    ])
  })

  test('only the model and the small model, comments allowed, a key never', () => {
    const kept = own?.kept([
      undefined,
      undefined,
      `{
        // a comment of the user's
        "model": "anthropic/sonnet", /* another */
        "small_model": "anthropic/haiku",
        "provider": { "anthropic": { "options": { "apiKey": "sk-secret", "baseURL": "https://a//b" } } },
      }`,
      '{"recent":[{"providerID":"go","modelID":"kimi"}]}',
    ])
    expect(kept).toEqual({ model: 'anthropic/sonnet', small_model: 'anthropic/haiku' })
  })

  test('without a configured model, the one last used in OpenCode; nothing from a broken file', () => {
    expect(
      own?.kept([
        undefined,
        undefined,
        undefined,
        '{"recent":[{"providerID":"go","modelID":"k"}]}',
      ]),
    ).toEqual({ model: 'go/k' })
    expect(own?.kept([undefined, '{ "model": ', undefined, undefined])).toEqual({})
  })
})

describe("No adapter sends allowedTools with a wildcard over Hemera's tools", () => {
  test('allowedTools is an input, the empty list by default', () => {
    const meta = Schema.decodeUnknownSync(ClaudeMeta)(claude.bareOptions(input).meta)
    expect(meta.claudeCode.options.allowedTools).toEqual([])
    const given = claude.bareOptions({ ...input, allowedTools: ['mcp__hemera__mission_state'] })
    expect(
      Schema.decodeUnknownSync(ClaudeMeta)(given.meta).claudeCode.options.allowedTools,
    ).toEqual(['mcp__hemera__mission_state'])
  })

  test('no allowedTools anywhere in any options holds a wildcard', () => {
    for (const adapter of ADAPTERS) {
      const json = JSON.stringify(adapter.bareOptions(input))
      for (const list of allowedToolsIn(json)) expect(list).not.toContain('*')
    }
    // The check finds a list where there is one.
    expect(allowedToolsIn(JSON.stringify(claude.bareOptions(input)))).toEqual([''])
  })
})

describe('An unqualified agent and OS pair is refused with its reason', () => {
  test('Claude Code and Codex are qualified on Linux and Windows, OpenCode on Windows', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(qualificationOf(claude, platform, {})).toEqual(Qualified.make({}))
      expect(qualificationOf(codex, platform, {})).toEqual(Qualified.make({}))
    }
    expect(qualificationOf(opencode, 'win32', {})).toEqual(Qualified.make({}))
    expect(qualificationOf(opencode, 'linux', {})).toEqual(
      NotQualified.make({ reason: NOT_RUN_ON_LINUX }),
    )
  })

  test('OpenCode on Linux is refused with its reason, the others pass', async () => {
    const refused = await Effect.runPromise(
      Effect.flip(refusedUnlessQualified(opencode, 'linux', {})),
    )
    expect(refused).toBeInstanceOf(BareModeNotQualified)
    expect(refused.reason).toBe(NOT_RUN_ON_LINUX)
    expect(refused.message).toContain('OpenCode')
    await Effect.runPromise(refusedUnlessQualified(claude, 'linux', {}))
  })

  test('the end-to-end flag qualifies the one agent it names, and nothing else', () => {
    expect(qualificationOf(opencode, 'linux', { [E2E_QUALIFIED]: 'opencode' })).toEqual(
      Qualified.make({}),
    )
    for (const value of ['codex', 'OpenCode', '']) {
      expect(qualificationOf(opencode, 'linux', { [E2E_QUALIFIED]: value })).toEqual(
        NotQualified.make({ reason: NOT_RUN_ON_LINUX }),
      )
    }
  })
})

describe('The modes each agent reports are kept as data', () => {
  test('identifiers and names, per agent; OpenCode has none in bare mode', () => {
    expect(AGENT_MODES.claude).toEqual([
      { id: 'default', name: 'Manual' },
      { id: 'acceptEdits', name: 'Accept edits' },
      { id: 'plan', name: 'Plan' },
      { id: 'auto', name: 'Auto' },
      { id: 'bypassPermissions', name: 'Bypass permissions' },
    ])
    expect(AGENT_MODES.codex).toEqual([
      { id: 'read-only', name: 'Ask for approval' },
      { id: 'agent', name: 'Approve for me' },
      { id: 'agent-full-access', name: 'Full access' },
    ])
    expect(AGENT_MODES.opencode).toEqual([])
  })
})
