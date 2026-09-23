/**
 * Bare mode: the means of each agent, and the Session an unqualified one would not get
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
import { Effect, Layer } from 'effect'
import { z } from 'zod'
import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS, type AgentAdapter } from '#engine/agents/adapter.ts'
import { type BareOptions, bareModeOf, bareOptionsOf } from '#engine/agents/bare.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'
import { fakeAgent } from '#engine/agents/fake.ts'
import { MachineEnvironment } from '#engine/agents/discovery.ts'
import { AgentRuntime, NoNotices } from '#engine/agents/runtime.ts'
import { aSessionOn, application } from './application.ts'
import { RESIDUE, unqualified, withUnqualifiedCodex } from './unqualified.ts'

const ADAPTERS = [claude, codex, opencode]

/** What a refused agent declares it keeps, or a test that named a qualified one by mistake. */
const reasonOf = (adapter: AgentAdapter, platform: NodeJS.Platform): string => {
  const mode = bareModeOf(adapter, platform)
  if (mode.qualified) throw new Error(`${adapter.id} is qualified: it declares no reason`)
  return mode.reason
}

/** The two a machine can be, asked from whichever one this is. */
const PLATFORMS: readonly NodeJS.Platform[] = ['linux', 'win32']

/** What Claude Code is handed on `_meta`, of which it is the only reader of these options. */
const claudeOptionsOf = (options: BareOptions) =>
  options.meta !== undefined && 'claudeCode' in options.meta
    ? options.meta.claudeCode.options
    : undefined

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

  test('the three agents can be emptied, on both platforms', () => {
    for (const platform of PLATFORMS) {
      for (const adapter of ADAPTERS) expect(bareModeOf(adapter, platform).qualified).toBe(true)
    }
  })

  test('Claude Code is handed no built-in tool and no settings source', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(claudeOptionsOf(options)?.tools).toEqual([])
    expect(claudeOptionsOf(options)?.settingSources).toEqual([])
    expect(claudeOptionsOf(options)?.systemPrompt).toEqual({
      type: 'custom',
      prompt: input.base,
      snapshot: true,
    })
    // This agent reads its environment out of `_meta`, so nothing is handed to its process.
    expect(options.env).toEqual({})
  })

  test('Claude Code loads no MCP server but the ones handed to its session', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(claudeOptionsOf(options)?.strictMcpConfig).toBe(true)
  })

  test("Claude Code runs Hemera's tools without asking its own permission for them", async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(claudeOptionsOf(options)?.allowedTools).toEqual(['mcp__hemera__*'])
  })

  test('Claude Code is told to wait ten minutes on a silent tool as well as on a slow one', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    // A call waiting on the human sends nothing until they answer: the total limit alone let
    // Claude Code 2.1 abort it after 300 s of silence.
    expect(claudeOptionsOf(options)?.env).toMatchObject({
      MCP_TOOL_TIMEOUT: '600000',
      CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '600000',
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
  test('an agent that keeps a tool opens no Session, on either platform', async () => {
    // The refusal is the answer, and there is nothing to hand over: flipping the effect is what
    // proves no options were built at all, on either platform.
    const refused = await Promise.all(
      PLATFORMS.map((platform) => {
        expect(bareModeOf(unqualified, platform).qualified).toBe(false)
        return Effect.runPromise(Effect.flip(bareOptionsOf(unqualified, platform, input)))
      }),
    )

    for (const one of refused) {
      expect(one.id).toBe('codex')
      expect(one.label).toBe('Codex')
    }
  })

  test('the reason shown is the one the adapter declares, and it names the residue', async () => {
    const refused = await Effect.runPromise(Effect.flip(bareOptionsOf(unqualified, 'linux', input)))

    expect(refused.reason).toBe(reasonOf(unqualified, 'linux'))
    expect(refused.reason).toBe(RESIDUE)
    // The means travels with the refusal, because the window shows both.
    expect(refused.means).toBe(bareModeOf(unqualified, 'linux').means)
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
  test('a Session on an agent that keeps a tool starts nothing, and says its reason', async () => {
    const places = folders()
    const agent = fakeAgent()
    try {
      const refused = await withUnqualifiedCodex(() =>
        application(places.data)(agent)(
          Effect.gen(function* () {
            const runtime = yield* AgentRuntime
            const session = yield* aSessionOn(places.workspace, 'codex')
            return yield* Effect.flip(runtime.start(session.id))
          }),
        ),
      )

      expect(refused.message).toContain(RESIDUE)
      // Refused before anything was written or started for it.
      expect(agent.starts).toEqual([])
      expect(existsSync(join(places.data, 'agents', 'codex'))).toBe(false)
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})

/** The configuration a bare Codex is handed through `CODEX_CONFIG`, as far as these suites read it. */
const CODEX_CONFIG = z.object({
  web_search: z.string(),
  tools: z.record(z.string(), z.object({ enabled: z.boolean() })),
  agents: z.object({ enabled: z.boolean() }),
  orchestrator: z.object({ skills: z.object({ enabled: z.boolean() }) }),
  skills: z.object({
    include_instructions: z.boolean(),
    bundled: z.object({ enabled: z.boolean() }),
  }),
  features: z.record(z.string(), z.boolean()),
})

describe("A bare Codex offers only Hemera's tools", () => {
  test("its session asks the patched adapter for no environment and for Hemera's tools", async () => {
    const options = await Effect.runPromise(bareOptionsOf(codex, 'linux', input))

    // What the patch of the adapter reads: no environment, and the tools of the server named.
    expect(options.meta).toEqual({ hemera: { bare: true, toolServer: 'hemera' } })
    // Nothing is written for it: the configuration travels in the environment.
    expect(options.files).toEqual([])
    expect(Object.keys(options.env)).toEqual(['CODEX_CONFIG'])
  })

  test('every tool a switch reaches is switched off, in the shape the adapter keeps', async () => {
    const options = await Effect.runPromise(bareOptionsOf(codex, 'linux', input))
    const config = CODEX_CONFIG.parse(JSON.parse(options.env.CODEX_CONFIG ?? '{}'))

    expect(config.web_search).toBe('disabled')
    expect(config.tools).toEqual({
      update_plan: { enabled: false },
      experimental_request_user_input: { enabled: false },
    })
    expect(config.agents.enabled).toBe(false)
    expect(config.orchestrator.skills.enabled).toBe(false)
    // No index of the user's skills in the prompt, and no bundled skill.
    expect(config.skills).toEqual({ include_instructions: false, bundled: { enabled: false } })
    for (const feature of [
      'shell_tool',
      'unified_exec',
      'view_image',
      'sleep_tool',
      'request_permissions_tool',
      'token_budget',
      'deferred_executor',
      'code_mode',
      'multi_agent',
      'multi_agent_v2',
      'image_generation',
      'standalone_web_search',
      'tool_suggest',
      'apps',
      'plugins',
      'goals',
      'browser_use',
      'computer_use',
    ]) {
      expect(config.features[feature]).toBe(false)
    }
    // Nested, never dotted: the adapter adds a `features` table of its own to every thread, and a
    // dotted `features.x` beside it is lost.
    expect(Object.keys(config).some((key) => key.includes('.'))).toBe(false)
  })
})

/** A machine like the suites' own, whose environment is the one given. */
const machineWith = (env: Readonly<Record<string, string>>) =>
  Layer.succeed(MachineEnvironment, {
    home: '/home/ana',
    env,
    locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
    bundled: (packageName: string) =>
      Effect.succeed(join('/opt/hemera/node_modules', packageName, 'dist', 'index.js')),
    readVersion: () => Effect.succeed('1.0.0'),
    holds: () => Effect.succeed(true),
    read: () => Effect.succeed(undefined),
  })

/** What Claude Code's session was configured with on `_meta`, as far as its environment goes. */
const CLAUDE_OPTIONS = z.object({
  claudeCode: z.object({
    options: z.object({
      settingSources: z.array(z.string()),
      strictMcpConfig: z.boolean(),
      env: z.record(z.string(), z.string()),
    }),
  }),
})

/** The one field of Codex's `_meta` these suites read. */
const CODEX_META = z.object({ hemera: z.object({ bare: z.literal(true), toolServer: z.string() }) })

describe("A bare Codex keeps the user's login", () => {
  test('its home is the one the user has, and its configuration comes through CODEX_CONFIG', async () => {
    const places = folders()
    const own = join(places.workspace, 'codex-home')
    try {
      for (const [name, env] of [
        ['default', {}],
        ['moved', { CODEX_HOME: own }],
      ] as const) {
        const agent = fakeAgent()
        mkdirSync(join(places.data, name))
        // oxlint-disable-next-line no-await-in-loop -- one run of the application per machine, one after the other
        await application(join(places.data, name), NoNotices, machineWith(env))(agent)(
          Effect.gen(function* () {
            const runtime = yield* AgentRuntime
            const session = yield* aSessionOn(places.workspace, 'codex')
            yield* runtime.start(session.id)
          }),
        )

        // The process runs on the user's own home, or on none named: never on Hemera's.
        const environment = agent.environments[0] ?? {}
        expect(environment.CODEX_HOME).toBe(name === 'moved' ? own : undefined)
        expect(environment.CODEX_CONFIG).toBeDefined()
        // Hemera's directory for the agent holds nothing the agent reads.
        expect(existsSync(join(places.data, name, 'agents', 'codex', 'config.toml'))).toBe(false)
        // The session carries what the patched adapter reads, beside Hemera's server.
        expect(CODEX_META.parse(JSON.parse(agent.answers.metas[0] ?? '{}')).hemera).toEqual({
          bare: true,
          toolServer: 'hemera',
        })
        expect(agent.answers.mcpServers[0]?.map((server) => server.name)).toEqual(['hemera'])
        // So the login the agent reads is the one discovery found before the Session started.
        expect(codex.loginFiles('/home/ana', env)).toEqual([
          join(name === 'moved' ? own : join('/home/ana', '.codex'), 'auth.json'),
        ])
      }
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})

describe("A bare Claude session still finds the user's login", () => {
  test('its configuration directory is the one the user has, where the login is', async () => {
    const places = folders()
    const own = join(places.workspace, 'claude-config')
    try {
      for (const [name, env] of [
        ['default', {}],
        ['moved', { CLAUDE_CONFIG_DIR: own }],
      ] as const) {
        const agent = fakeAgent()
        mkdirSync(join(places.data, name))
        // oxlint-disable-next-line no-await-in-loop -- one run of the application per machine, one after the other
        await application(join(places.data, name), NoNotices, machineWith(env))(agent)(
          Effect.gen(function* () {
            const runtime = yield* AgentRuntime
            const session = yield* aSessionOn(places.workspace, 'claude')
            yield* runtime.start(session.id)
          }),
        )

        // The process is started with the user's own directory, or with none: never Hemera's.
        expect(agent.environments[0]?.CLAUDE_CONFIG_DIR).toBe(name === 'moved' ? own : undefined)
        const options = CLAUDE_OPTIONS.parse(JSON.parse(agent.answers.metas[0] ?? '{}'))
        // Nor does the session move it: what the move was for is done by reading no settings
        // file and no MCP server of the user's.
        expect(options.claudeCode.options.env.CLAUDE_CONFIG_DIR).toBeUndefined()
        expect(options.claudeCode.options.settingSources).toEqual([])
        expect(options.claudeCode.options.strictMcpConfig).toBe(true)
        // A question to the human can outlast the agent's default wait on a tool: ten minutes.
        expect(options.claudeCode.options.env.MCP_TOOL_TIMEOUT).toBe('600000')
        // So the login the agent reads is the one discovery found before the Session started.
        expect(claude.loginFiles('/home/ana', env)).toEqual([
          join(name === 'moved' ? own : join('/home/ana', '.claude'), '.credentials.json'),
        ])
      }
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})

describe('A bare OpenCode session starts on the model the user uses', () => {
  /** OpenCode's own files on a machine, as `own` names them: the configuration, then the state. */
  const ownOn = (home: string, env: Readonly<Record<string, string>>) =>
    opencode.own?.files(home, env) ?? []

  test("the model and the small model of the user's configuration, and no other setting", () => {
    const files = ownOn('/home/ana', {})
    expect(files).toEqual([
      join('/home/ana', '.config', 'opencode', 'config.json'),
      join('/home/ana', '.config', 'opencode', 'opencode.json'),
      join('/home/ana', '.config', 'opencode', 'opencode.jsonc'),
      join('/home/ana', '.local', 'state', 'opencode', 'model.json'),
    ])
    const kept = opencode.own?.kept([
      undefined,
      undefined,
      `{
        // the user's own comment
        "model": "anthropic/claude-sonnet-4", /* and another */
        "small_model": "anthropic/claude-haiku",
        "provider": { "anthropic": { "options": { "apiKey": "sk-secret", "baseURL": "https://a//b" } } },
      }`,
      '{"recent":[{"providerID":"opencode-go","modelID":"kimi-k3"}]}',
    ])
    // The configuration wins over the last model of the interface, and the key stays where it was.
    expect(kept).toEqual({
      model: 'anthropic/claude-sonnet-4',
      small_model: 'anthropic/claude-haiku',
    })
  })

  test('without a model in the configuration, the one last picked in OpenCode itself', () => {
    const kept = opencode.own?.kept([
      undefined,
      undefined,
      '{ "$schema": "https://opencode.ai/config.json" }',
      '{"recent":[{"providerID":"opencode-go","modelID":"deepseek-v4.1-flash"},{"providerID":"opencode","modelID":"x"}]}',
    ])
    expect(kept).toEqual({ model: 'opencode-go/deepseek-v4.1-flash' })
    // Nothing at all is nothing kept, and a broken file is the same.
    expect(opencode.own?.kept([undefined, '{ "model": ', undefined, undefined])).toEqual({})
  })

  test("the files are read where the user's own XDG directories say", () => {
    expect(ownOn('/home/ana', { XDG_CONFIG_HOME: '/cfg', XDG_STATE_HOME: '/state' })).toEqual([
      join('/cfg', 'opencode', 'config.json'),
      join('/cfg', 'opencode', 'opencode.json'),
      join('/cfg', 'opencode', 'opencode.jsonc'),
      join('/state', 'opencode', 'model.json'),
    ])
  })

  test("the agent is handed that model under Hemera's own configuration", async () => {
    const places = folders()
    const agent = fakeAgent()
    const configuration = join('/home/ana', '.config', 'opencode', 'opencode.json')
    const machine = Layer.succeed(MachineEnvironment, {
      home: '/home/ana',
      env: {},
      locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
      bundled: (packageName: string) =>
        Effect.succeed(join('/opt/hemera/node_modules', packageName, 'dist', 'index.js')),
      readVersion: () => Effect.succeed('1.0.0'),
      holds: () => Effect.succeed(true),
      read: (path: string) =>
        Effect.succeed(
          path === configuration ? '{"model":"anthropic/claude-sonnet-4"}' : undefined,
        ),
    })
    try {
      await application(places.data, NoNotices, machine)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(places.workspace, 'opencode')
          yield* runtime.start(session.id)
        }),
      )

      const content = z
        .object({ model: z.string(), default_agent: z.string() })
        .parse(JSON.parse(agent.environments[0]?.OPENCODE_CONFIG_CONTENT ?? '{}'))
      expect(content).toEqual({ model: 'anthropic/claude-sonnet-4', default_agent: 'hemera' })
      // The configuration directory is still Hemera's: only the model came across.
      expect(agent.environments[0]?.XDG_CONFIG_HOME).toBe(join(places.data, 'agents', 'opencode'))
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
  })
})
