#!/usr/bin/env node
/**
 * Measures how a Claude session started the way Hemera starts it uses the provider's prompt cache.
 *
 * A real session, a handful of requests on a short context, read from what the provider itself
 * reports for each request (`usage`, with the cache writes split into five minutes and one hour).
 * The session is the one `claude.bareOptions` builds for Hemera, over the Agent SDK that the ACP
 * adapter carries: the adapter sums the usage of a turn and drops the split, so the probe drives
 * the SDK it would. The instructions are Hemera's own for a role, its tools are served by Hemera's
 * own MCP server (only the gate is replaced by one that answers "ok"), and the working folder is
 * a new temporary folder.
 *
 *   node apps/desktop/scripts/prompt-cache/probe.ts <scenario> [options]
 *
 * Scenarios:
 *   lifetime   one session: a cold turn, a turn right after, a pause, a turn after the pause
 *   resume     one session, its process closed and started again from its transcript
 *   prefix     fresh sessions that differ from the first by one thing each (what a cache sees)
 *
 * Options:
 *   --model <id>     the model (default claude-haiku-5-5)
 *   --role <id>      the role whose instructions and tools are sent (default probe)
 *   --owner <text>   who the session belongs to in its instructions (default mission ACME-12);
 *                    give each run its own, or it reads the cache the one before wrote
 *   --gap <seconds>  the pause of `lifetime` and `resume` (default 360, `resume` default 0)
 *   --ttl <5m|1h>    sets CLAUDE_CODE_PROMPT_CACHE_TTL for the session
 *   --out <folder>   where the JSON of the run is written (default: the temporary folder)
 *   --claude <path>  the `claude` the SDK runs (default: the one on the PATH, as Hemera does)
 *
 * It spends the quota of the account `claude` is signed in with. It never reads a login or a
 * transcript itself; `claude` does.
 */

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { Role, TESTER_PARAGRAPH, TESTER_TOOLS, toolsOf } from '@hemera/core/domain'
import { Context, Effect, Layer, Option, Schema } from 'effect'

import { claude } from '../../src/engine/agents/adapters/claude.ts'
import { PROBE_ROLE } from '../../src/engine/planning/probe-role.ts'
import { renderBase, instructionsText } from '../../src/engine/sessions/instructions.ts'
import { ToolAccess, toolAccessLayer } from '../../src/engine/tools/access.ts'
import { ToolGate } from '../../src/engine/tools/gate.ts'
import { ToolServer, toolServerLayer } from '../../src/engine/tools/server.ts'
import { type Request, distinctRequests, readRequest, renderTable } from './usage.ts'

// --- the SDK the ACP adapter carries ---------------------------------------------------------

/** One message of the streaming input: a user turn. */
interface UserTurn {
  readonly type: 'user'
  readonly message: { readonly role: 'user'; readonly content: ReadonlyArray<Schema.Json> }
  readonly parent_tool_use_id: null
}

/** The part of the SDK's `query()` the probe uses. */
interface SdkQuery extends AsyncIterable<Schema.Json> {
  readonly close: () => void
}

/** The instructions as the SDK takes them: one block, or several split by the cache boundary. */
interface SystemPrompt {
  readonly type: 'custom'
  readonly prompt: string | ReadonlyArray<string>
  readonly snapshot: boolean
}

/** The options of `query()` the probe sets or takes from the Claude adapter's bare options. */
interface SdkOptions {
  readonly tools: ReadonlyArray<string>
  readonly allowedTools: ReadonlyArray<string>
  readonly settingSources: ReadonlyArray<string>
  readonly strictMcpConfig: boolean
  readonly systemPrompt: SystemPrompt
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly model: string
  readonly mcpServers: Readonly<
    Record<
      string,
      { readonly type: 'http'; readonly url: string; readonly headers: Record<string, string> }
    >
  >
  readonly pathToClaudeCodeExecutable: string
  readonly permissionMode: 'default'
  readonly disallowedTools: ReadonlyArray<string>
  readonly extraArgs: Readonly<Record<string, string>>
  readonly debugFile: string
  /** A new session's id, or undefined when an earlier session is resumed. */
  readonly sessionId: string | undefined
  readonly resume: string | undefined
}

interface Sdk {
  readonly query: (input: {
    readonly prompt: AsyncIterable<UserTurn>
    readonly options: SdkOptions
  }) => SdkQuery
  readonly SYSTEM_PROMPT_DYNAMIC_BOUNDARY: string
}

/** The SDK is not a dependency of the application: it is read where the ACP adapter reads it. */
const loadSdk = async (): Promise<Sdk> => {
  const adapter = fileURLToPath(import.meta.resolve('@agentclientprotocol/claude-agent-acp'))
  const entry = createRequire(adapter).resolve('@anthropic-ai/claude-agent-sdk')
  // SAFETY: `query` and `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` are exported by the SDK's `sdk.d.ts`
  // with these shapes; the rest of its surface is not used here.
  return (await import(pathToFileURL(entry).href)) as Sdk
}

// --- a session -------------------------------------------------------------------------------

const TurnEnded = Schema.Struct({
  type: Schema.Literal('result'),
  subtype: Schema.String,
  is_error: Schema.Boolean,
})
const readTurnEnd = Schema.decodeUnknownOption(TurnEnded)

/** The instructions of a session. */
type Instructions =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'blocks'; readonly blocks: ReadonlyArray<string> }

const one = (text: string): Instructions => ({ kind: 'text', text })

/** What a session is started with. */
interface SessionSetup {
  /** Hemera's instructions: one text as Hemera sends them, or blocks when the boundary is tried. */
  readonly system: Instructions
  readonly role: Role
  readonly tester: boolean
  /** Who the session belongs to, as the base instructions name it: `mission ACME-12`. */
  readonly owner: string
  readonly model: string
  readonly ttl: string | undefined
  /** The native session to resume, if any. */
  readonly resume: string | undefined
}

/** The ports of the run: the SDK, Hemera's tool server, the folder, the `claude` to run. */
interface Ports {
  readonly sdk: Sdk
  readonly serverUrl: string
  readonly mint: (sessionId: string, role: Role, tester: boolean, root: string) => Promise<string>
  readonly folder: string
  readonly executable: string
  readonly debugFile: string
}

interface Session {
  readonly nativeId: string
  readonly turn: (label: string, text: string) => Promise<ReadonlyArray<Request>>
  readonly close: () => void
}

/** A queue the SDK reads its turns from, one at a time, as Hemera's own sessions are fed. */
const inbox = () => {
  const waiting: Array<(turn: UserTurn | null) => void> = []
  const queued: UserTurn[] = []
  let closed = false
  return {
    push: (turn: UserTurn) => {
      const reader = waiting.shift()
      if (reader === undefined) queued.push(turn)
      else reader(turn)
    },
    end: () => {
      closed = true
      for (const reader of waiting.splice(0)) reader(null)
    },
    turns: async function* (): AsyncGenerator<UserTurn> {
      for (;;) {
        const next = queued.shift()
        if (next !== undefined) yield next
        else if (closed) return
        else {
          // oxlint-disable-next-line no-await-in-loop -- the turns are read one at a time
          const arrived = await new Promise<UserTurn | null>((resolve) => waiting.push(resolve))
          if (arrived === null) return
          yield arrived
        }
      }
    },
  }
}

const startSession = async (ports: Ports, setup: SessionSetup): Promise<Session> => {
  const nativeId = setup.resume ?? randomUUID()
  const token = await ports.mint(nativeId, setup.role, setup.tester, ports.folder)
  const bare = claude.bareOptions({
    agentDirectory: ports.folder,
    systemPrompt: setup.system.kind === 'text' ? setup.system.text : '',
    hemera: { url: ports.serverUrl, token },
  })
  if (bare.meta === undefined || !('claudeCode' in bare.meta)) {
    throw new Error('the Claude adapter built no Claude Code options')
  }
  const own = bare.meta.claudeCode.options
  // A variable left undefined is not set in the process the SDK starts.
  const env = { ...process.env, ...own.env, CLAUDE_CODE_PROMPT_CACHE_TTL: setup.ttl }
  // What the adapter hands the SDK besides Hemera's `_meta` options (its `acp-agent.js`, the
  // `options` of `query()`): the environment, the folder, the MCP server, the executable.
  const options: SdkOptions = {
    tools: own.tools,
    allowedTools: own.allowedTools,
    settingSources: own.settingSources,
    strictMcpConfig: own.strictMcpConfig,
    systemPrompt:
      setup.system.kind === 'text'
        ? own.systemPrompt
        : { type: 'custom', prompt: setup.system.blocks, snapshot: true },
    env,
    cwd: ports.folder,
    model: setup.model,
    mcpServers: {
      hemera: { type: 'http', url: ports.serverUrl, headers: { Authorization: `Bearer ${token}` } },
    },
    pathToClaudeCodeExecutable: ports.executable,
    permissionMode: 'default',
    disallowedTools: ['AskUserQuestion'],
    extraArgs: { 'replay-user-messages': '' },
    debugFile: ports.debugFile,
    sessionId: setup.resume === undefined ? nativeId : undefined,
    resume: setup.resume,
  }
  const queue = inbox()
  const running = ports.sdk.query({ prompt: queue.turns(), options })
  const messages = running[Symbol.asyncIterator]()
  return {
    nativeId,
    turn: async (label, text) => {
      queue.push({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
      })
      const found: Request[] = []
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- a turn's messages are read in order
        const next = await messages.next()
        if (next.done === true) throw new Error(`the session ended during "${label}"`)
        const request = readRequest(label, next.value)
        if (Option.isSome(request)) found.push(request.value)
        const ended = readTurnEnd(next.value)
        if (Option.isNone(ended)) continue
        if (ended.value.is_error) {
          throw new Error(`the turn "${label}" ended in ${ended.value.subtype}`)
        }
        return distinctRequests(found)
      }
    },
    close: () => {
      queue.end()
      running.close()
    },
  }
}

// --- what is sent ----------------------------------------------------------------------------

const BRIEF = (variant: string): string =>
  `[hemera:brief]\n\n## Question\n\nReply with the single word "ok" and nothing else. (${variant})`

const instructionsFor = (owner: string, tester: boolean): string =>
  instructionsText(
    renderBase({
      owner,
      role: PROBE_ROLE.displayName,
      userLanguage: 'en',
      specLanguage: 'en',
      readsMemory: PROBE_ROLE.readsMemory,
      testerMode: tester ? TESTER_PARAGRAPH : null,
      hemeraOnly: true,
    }),
    PROBE_ROLE,
    [],
    'en',
    'en',
  )

// --- the scenarios ---------------------------------------------------------------------------

const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000))

const lifetime = async (ports: Ports, setup: SessionSetup, gap: number) => {
  const session = await startSession(ports, setup)
  const requests: Request[] = []
  requests.push(...(await session.turn('1 cold', BRIEF('first'))))
  requests.push(...(await session.turn('2 right after', 'Reply with the single word "ok".')))
  console.error(`pausing ${String(gap)} s with the process alive`)
  await sleep(gap)
  requests.push(
    ...(await session.turn(`3 after ${String(gap)} s`, 'Reply with the single word "ok".')),
  )
  session.close()
  return requests
}

const resume = async (ports: Ports, setup: SessionSetup, gap: number) => {
  const first = await startSession(ports, setup)
  const requests: Request[] = []
  requests.push(...(await first.turn('1 cold', BRIEF('first'))))
  first.close()
  console.error(`process closed, resuming after ${String(gap)} s`)
  await sleep(gap)
  const second = await startSession(ports, { ...setup, resume: first.nativeId })
  requests.push(
    ...(await second.turn(`2 resumed after ${String(gap)} s`, 'Reply with the single word "ok".')),
  )
  second.close()
  return requests
}

/** A cache is read by prefix: each variant changes one thing before the conversation. */
const prefix = async (ports: Ports, setup: SessionSetup) => {
  const { owner } = setup
  const split = (name: string): Instructions => ({
    kind: 'blocks',
    blocks: [
      instructionsFor('the mission you are given', false),
      ports.sdk.SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
      `You are one session of ${name}.`,
    ],
  })
  // The same split, sent as the one text Hemera sends today: no boundary, the owner last.
  const last = (name: string): Instructions =>
    one(`${instructionsFor('the mission you are given', false)}\n\nYou are one session of ${name}.`)
  const variants: ReadonlyArray<{
    readonly label: string
    readonly setup: SessionSetup
    readonly brief: string
  }> = [
    {
      label: 'A reference',
      setup: { ...setup, system: one(instructionsFor(owner, false)) },
      brief: 'first',
    },
    {
      label: 'B other brief',
      setup: { ...setup, system: one(instructionsFor(owner, false)) },
      brief: 'second',
    },
    {
      label: 'C other owner',
      setup: { ...setup, system: one(instructionsFor(`${owner}-bis`, false)) },
      brief: 'first',
    },
    {
      label: 'D tester mode',
      setup: { ...setup, system: one(instructionsFor(owner, true)), tester: true },
      brief: 'first',
    },
    {
      label: 'E owner last, mission 12',
      setup: { ...setup, system: split(owner) },
      brief: 'first',
    },
    {
      label: 'F owner last, mission 13',
      setup: { ...setup, system: split(`${owner}-bis`) },
      brief: 'first',
    },
    {
      label: 'H owner last, one text, mission 12',
      setup: { ...setup, system: last(owner) },
      brief: 'first',
    },
    {
      label: 'I owner last, one text, mission 13',
      setup: { ...setup, system: last(`${owner}-bis`) },
      brief: 'first',
    },
    {
      label: 'G reference again',
      setup: { ...setup, system: one(instructionsFor(owner, false)) },
      brief: 'first',
    },
  ]
  const requests: Request[] = []
  for (const variant of variants) {
    // oxlint-disable-next-line no-await-in-loop -- each session reads the cache the ones before wrote
    const session = await startSession(ports, variant.setup)
    // oxlint-disable-next-line no-await-in-loop -- as above
    requests.push(...(await session.turn(variant.label, BRIEF(variant.brief))))
    session.close()
  }
  return requests
}

const decodeScenario = Schema.decodeUnknownSync(Schema.Literals(['lifetime', 'resume', 'prefix']))
const decodeRole = Schema.decodeUnknownSync(Role)

const DEFAULT_GAP = { lifetime: 360, resume: 0, prefix: 0 }

const SCENARIOS = {
  lifetime,
  resume,
  prefix: (ports: Ports, setup: SessionSetup) => prefix(ports, setup),
}

// --- the run ---------------------------------------------------------------------------------

/** Hemera's tool server with its gate replaced by one that answers "ok" to every call. */
const toolGateAnswering = Layer.succeed(ToolGate, {
  call: () => Effect.succeed({ ok: true, refused: false, text: 'ok' }),
  perform: () => Effect.die('the probe calls no tool'),
})

const main = Effect.gen(function* () {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string', default: 'claude-haiku-5-5' },
      role: { type: 'string', default: 'probe' },
      owner: { type: 'string' },
      gap: { type: 'string' },
      ttl: { type: 'string' },
      out: { type: 'string' },
      claude: { type: 'string' },
    },
  })
  const scenario = decodeScenario(positionals[0])
  const cacheVariables = Object.keys(process.env).filter((name) =>
    /PROMPT_CACHING|PROMPT_CACHE_TTL/.test(name),
  )
  if (cacheVariables.length > 0) {
    return yield* Effect.die(`unset ${cacheVariables.join(', ')}: they change what is measured`)
  }
  const folder = mkdtempSync(join(tmpdir(), 'hemera-prompt-cache-'))
  const out = values.out ?? folder
  mkdirSync(out, { recursive: true })
  const executable = values.claude ?? execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim()

  const services = yield* Layer.build(
    toolServerLayer(() => undefined, 'probe').pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          toolAccessLayer(() => undefined),
          toolGateAnswering,
        ),
      ),
    ),
  )
  const access = Context.get(services, ToolAccess)
  const server = Context.get(services, ToolServer)
  const role = decodeRole(values.role)
  const ports: Ports = {
    sdk: yield* Effect.promise(loadSdk),
    serverUrl: server.url,
    mint: (sessionId, forRole, tester, root) =>
      Effect.runPromise(
        access.mint({
          sessionId,
          epoch: 1,
          role: forRole,
          tools: toolsOf(forRole).filter((tool) => tester || !TESTER_TOOLS.includes(tool)),
          place: { kind: 'own-worktree', readOnly: false, root },
          projectId: 'project',
          missionId: 'mission',
          workspaceId: null,
          mainCheckout: false,
        }),
      ),
    folder,
    executable,
    debugFile: join(out, `${scenario}-debug.log`),
  }
  const owner = values.owner ?? 'mission ACME-12'
  const setup: SessionSetup = {
    system: one(instructionsFor(owner, false)),
    role,
    tester: false,
    owner,
    model: values.model,
    ttl: values.ttl,
    resume: undefined,
  }
  const gap = Number(values.gap ?? DEFAULT_GAP[scenario])
  const requests = yield* Effect.promise(() => SCENARIOS[scenario](ports, setup, gap))
  const table = renderTable(requests)
  const header = `claude ${version}, ${values.model}, role ${values.role}, ttl ${values.ttl ?? 'default'}`
  writeFileSync(
    join(out, `${scenario}.json`),
    JSON.stringify({ header, startedAt: new Date().toISOString(), requests }, null, 2),
  )
  console.log(`${header}\n\n${table}`)
})

await Effect.runPromise(Effect.scoped(main))
