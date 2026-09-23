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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { z } from 'zod'
import { describe, expect, test } from 'vite-plus/test'

import { AGENT_PROVIDERS } from '#engine/agents/adapter.ts'
import { bareModeOf, bareOptionsOf, writtenFiles } from '#engine/agents/bare.ts'
import { claude } from '#engine/agents/adapters/claude.ts'
import { codex } from '#engine/agents/adapters/codex.ts'
import { opencode } from '#engine/agents/adapters/opencode.ts'
import { fakeAgent } from '#engine/agents/fake.ts'
import { MachineEnvironment } from '#engine/agents/discovery.ts'
import { AgentRuntime, NoNotices } from '#engine/agents/runtime.ts'
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

  test('Claude Code loads no MCP server but the ones handed to its session', async () => {
    const options = await Effect.runPromise(bareOptionsOf(claude, 'linux', input))

    expect(options.meta?.claudeCode.options.strictMcpConfig).toBe(true)
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

describe('Codex is handed its bare configuration and stays unqualified', () => {
  test('the config.toml of the spike, in a CODEX_HOME of Hemera, and the residue as the reason', async () => {
    const places = folders()
    try {
      const mode = bareModeOf(codex, process.platform)
      const options = mode.options({ ownerDirectory: join(places.data, 'codex'), base: 'the base' })
      // Its home is Hemera's, and the configuration is written into it, as the process reads it.
      expect(options.env).toEqual({ CODEX_HOME: join(places.data, 'codex') })
      expect(options.meta).toBeUndefined()
      await Effect.runPromise(writtenFiles(join(places.data, 'codex'), options.files))
      const written = readFileSync(join(places.data, 'codex', 'config.toml'), 'utf8')
      expect(written).toContain('web_search = "disabled"')
      for (const table of ['[tools.update_plan]', '[tools.experimental_request_user_input]']) {
        expect(written).toContain(`${table}\nenabled = false`)
      }
      for (const feature of [
        'shell_tool',
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
      ]) {
        expect(written).toMatch(new RegExp(`^${feature} = false$`, 'm'))
      }
      // And it is still not qualified: two families of tools have no switch at all.
      expect(mode.qualified).toBe(false)
      const reason = reasonOf(codex, process.platform)
      for (const residue of [
        'apply_patch',
        'list_mcp_resources',
        'list_mcp_resource_templates',
        'read_mcp_resource',
      ]) {
        expect(reason).toContain(residue)
      }
    } finally {
      rmSync(places.data, { recursive: true, force: true })
      rmSync(places.workspace, { recursive: true, force: true })
    }
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
