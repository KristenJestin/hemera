/**
 * The tools of Hemera as an agent reaches them: over MCP, with the token it was handed (D6-11).
 *
 * Every suite here runs the engine whole — the runtime, the tool server on a loopback port, the
 * catalogue behind it, the commands on the real supervisor — with the fake provider as the agent.
 * The agent is handed the server at `session/new` like any agent, connects to it, lists what it
 * lists and calls a tool by name; what is read is what the user and the agent each read: the
 * thread, the Commands panel, the Journal, and the answer the agent was given.
 *
 * Each suite is named after the scenario of the issue's Spec section it plays.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber } from 'effect'
import { z } from 'zod'

import { AGENTS_FILE, DELIVERY_MARKER, type SessionEntry, TOOL_NAMES } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Commands } from '#engine/commands/service.ts'
import { Context as AgentContext } from '#engine/context/service.ts'
import { Sessions } from '#engine/sessions.ts'
import { ToolAccess } from '#engine/tools/access.ts'
import { aSessionOn, threadOf, toolApplication, until } from './application.ts'

let dataFolder: string
let workspace: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-agent-tools-'))
  workspace = mkdtempSync(join(tmpdir(), 'hemera-agent-workspace-'))
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** What the runtime keeps of a tool call the agent streamed: its input and its output, as text. */
const CALL = z.object({
  call: z.object({
    rawInput: z.object({ text: z.string() }).nullable(),
    rawOutput: z.object({ text: z.string() }).nullable(),
  }),
})

/** A line that publishes an address and stays up, as a dev server does. */
const PUBLISHES_AN_ADDRESS = `"${process.execPath}" -e "console.log('http://localhost:4321');setInterval(()=>{},1000)"`

/**
 * A line that starts a child of its own, names it, and stays up with it: a tree, which is what a
 * dev server that watches files is, and what a stop has to take down whole.
 */
const STARTS_A_TREE = `"${process.execPath}" -e "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('child '+c.pid);console.log('http://localhost:4322');setInterval(()=>{},1000)"`

/** A line the agent writes itself: it says something and ends badly. */
const ONE_OFF = `"${process.execPath}" -e "console.log('checked');process.exit(2)"`

/** Whether a process of this machine is still there. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The child a tree named in its output, which is how a suite learns the pid of a grandchild. */
const childIn = (output: string): number => {
  const found = /child (\d+)/.exec(output)
  return Number.parseInt(found?.[1] ?? '0', 10)
}

/** The Commands panel of a Session: the runs going, and the ones that ended, newest first. */
const panelOf = (sessionId: string) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    return {
      running: yield* commands.running(sessionId),
      recent: yield* commands.recent(sessionId),
    }
  })

/** A command of the Project's catalogue, as the user adds it in the settings. */
const inCatalogue = (
  projectId: string,
  name: string,
  line: string,
  kind: 'app' | 'check' | 'utility',
  folder: string | null = null,
) =>
  Effect.gen(function* () {
    const commands = yield* Commands
    return yield* commands.save({ projectId, name, line, kind, folder }, false)
  })

/** The requests the human was asked in a thread by Hemera's tools, pending or answered. */
const questionsIn = (entries: readonly SessionEntry[]) =>
  entries.filter((entry) => entry.kind === 'permission_request' && entry.role === 'hemera')

/** Waits for the Session to be blocked on a question, and answers it as the human does. */
const decided = (sessionId: string, optionId: 'allowed' | 'refused') =>
  Effect.gen(function* () {
    yield* until(threadOf(sessionId), (entries) =>
      entries.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
    )
    const runtime = yield* AgentRuntime
    yield* runtime.decide(sessionId, optionId)
  })

/** A turn the human has to answer in, answered: the prompt, the question, the decision. */
const answeredTurn = (sessionId: string, text: string, optionId: 'allowed' | 'refused') =>
  Effect.gen(function* () {
    const runtime = yield* AgentRuntime
    const turn = yield* Effect.forkScoped(runtime.prompt(sessionId, text))
    yield* decided(sessionId, optionId)
    return yield* Fiber.join(turn)
  })

describe("The fake agent reaches Hemera's tools through the MCP server", () => {
  test('it lists the tools, calls one by name with its token, and streams what came back', async () => {
    writeFileSync(join(workspace, 'notes.md'), 'the answer is 42\n')
    const agent = fakeAgent({
      steps: [
        { does: 'uses', call: 'fs_read', arguments: { path: 'notes.md' }, id: 'read-1' },
        { does: 'says', text: 'read it' },
      ],
    })

    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'read the notes')
        return yield* threadOf(session.id)
      }),
    )

    // What the agent could see is the server's list, and the server lists Hemera's tools.
    expect(agent.answers.tools).toHaveLength(1)
    expect([...(agent.answers.tools[0] ?? [])].sort()).toEqual([...TOOL_NAMES].sort())
    // The call went through the door with the token of the Session: a 200, and the file.
    expect(agent.answers.used).toHaveLength(1)
    expect(agent.answers.used[0]?.status).toBe(200)
    expect(agent.answers.used[0]?.isError).toBe(false)
    expect(agent.answers.used[0]?.text).toContain('the answer is 42')

    // The agent's own call, as it streamed it: what it asked and what it was answered.
    const streamed = entries.find((entry) => entry.correlationId === 'call:read-1')
    expect(streamed?.kind).toBe('tool_call')
    expect(streamed?.state).toBe('completed')
    const call = CALL.parse(JSON.parse(streamed?.payload ?? '{}')).call
    expect(call.rawInput?.text).toContain('notes.md')
    expect(call.rawOutput?.text).toContain('the answer is 42')
    // And Hemera's record of the same call, written by the tool that answered it.
    const recorded = entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(recorded.map((entry) => entry.state)).toEqual(['completed'])
    expect(recorded[0]?.body).toContain('notes.md')
  })
})

describe('The agent starts the app and the user opens it', () => {
  test('one process in its folder, its address in the panel, the same output for both', async () => {
    const agent = fakeAgent({
      turns: [
        [{ does: 'uses', call: 'commands_run', arguments: { name: 'dev', key: 'dev-1' } }],
        [{ does: 'uses', call: 'commands_output', arguments: {} }],
      ],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const session = yield* aSessionOn(workspace, 'claude')
        yield* inCatalogue(session.projectId, 'dev', PUBLISHES_AN_ADDRESS, 'app')
        yield* runtime.prompt(session.id, 'start the app')
        // The panel shows it running, with its address once the output has named one.
        const panel = yield* until(panelOf(session.id), (read) => read.running[0]?.url != null)
        yield* runtime.prompt(session.id, 'what does it say?')
        const run = panel.running[0]
        const read = run === undefined ? null : yield* commands.output(session.id, run.id)
        return { panel, read }
      }),
    )

    expect(seen.panel.running).toHaveLength(1)
    const run = seen.panel.running[0]
    expect(run?.state).toBe('running')
    expect(run?.cwd).toBe(workspace)
    expect(run?.url).toBe('http://localhost:4321')
    // What the agent read through its tool is what the user reads in the panel.
    expect(agent.answers.used.map((one) => one.isError)).toEqual([false, false])
    expect(agent.answers.used[1]?.text).toContain('address: http://localhost:4321')
    expect(agent.answers.used[1]?.text).toContain(seen.read?.output.trim() ?? 'no output')
  })
})

describe('A running app is not started twice', () => {
  test('a second run from the agent or the panel hands back the one running', async () => {
    const agent = fakeAgent({
      turns: [
        [{ does: 'uses', call: 'commands_run', arguments: { name: 'dev', key: 'dev-1' } }],
        [{ does: 'uses', call: 'commands_run', arguments: { name: 'dev', key: 'dev-2' } }],
      ],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const session = yield* aSessionOn(workspace, 'claude')
        const dev = yield* inCatalogue(session.projectId, 'dev', PUBLISHES_AN_ADDRESS, 'app')
        yield* runtime.prompt(session.id, 'start the app')
        yield* runtime.prompt(session.id, 'start it again')
        // The user presses Run in the panel, on the same command.
        const fromPanel = yield* commands.run({
          sessionId: session.id,
          projectId: session.projectId,
          commandId: dev.id,
          name: dev.name,
          line: dev.line,
          kind: dev.kind,
          cwd: workspace,
          startedBy: 'user',
        })
        return { fromPanel, panel: yield* panelOf(session.id) }
      }),
    )

    expect(seen.panel.running).toHaveLength(1)
    expect(agent.answers.used[1]?.text).toContain(seen.panel.running[0]?.id ?? 'no run')
    expect(agent.answers.used[1]?.text).toContain('already running')
    expect(seen.fromPanel.joined).toBe(true)
    expect(seen.fromPanel.id).toBe(seen.panel.running[0]?.id)
    expect(seen.fromPanel.pid).toBe(seen.panel.running[0]?.pid)
  })
})

describe('A one-off command shows and is not promoted', () => {
  test('it runs once the human allows it, shows with its exit code, and the catalogue is unchanged', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'commands_run', arguments: { line: ONE_OFF, key: 'once' } }],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const commands = yield* Commands
        const session = yield* aSessionOn(workspace, 'claude')
        yield* answeredTurn(session.id, 'run the check', 'allowed')
        const entries = yield* until(threadOf(session.id), (read) =>
          read.some((entry) => entry.kind === 'command_run' && entry.state === 'failed'),
        )
        return {
          entries,
          panel: yield* panelOf(session.id),
          catalogue: yield* commands.list(session.projectId),
        }
      }),
    )

    expect(agent.answers.used[0]?.text).toContain('exit code 2')
    expect(agent.answers.used[0]?.text).toContain('checked')
    // In the panel, ended, with how it ended.
    expect(seen.panel.running).toHaveLength(0)
    expect(seen.panel.recent.map((run) => [run.state, run.exitCode])).toEqual([['failed', 2]])
    // In the thread, one block for the run, said to be a one-off.
    const runs = seen.entries.filter((entry) => entry.kind === 'command_run')
    expect(runs).toHaveLength(1)
    expect(JSON.parse(runs[0]?.payload ?? '{}')).toMatchObject({ exitCode: 2, oneOff: true })
    // And the catalogue is the user's: nothing was promoted into it.
    expect(seen.catalogue).toHaveLength(0)
  })
})

describe('Nothing is left running', () => {
  test('the end of the Session stops its runs, by tree, and the panel shows them stopped', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'commands_run', arguments: { name: 'tree', key: 'tree-1' } }],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const session = yield* aSessionOn(workspace, 'claude')
        yield* inCatalogue(session.projectId, 'tree', STARTS_A_TREE, 'app')
        yield* runtime.prompt(session.id, 'start it')
        const panel = yield* until(panelOf(session.id), (read) => read.running[0]?.url != null)
        const run = panel.running[0]
        const pids = [run?.pid ?? 0, childIn(run?.output ?? '')]
        const before = pids.map(alive)
        // The Session ends: its agent is let go, and with it everything it started.
        yield* runtime.release(session.id)
        const after = run === undefined ? null : yield* commands.output(session.id, run.id)
        return { pids, before, after, panel: yield* panelOf(session.id) }
      }),
    )

    expect(seen.before).toEqual([true, true])
    expect(seen.pids.map(alive)).toEqual([false, false])
    expect(seen.after?.state).toBe('stopped')
    expect(seen.panel.running).toHaveLength(0)
  })

  test('the application quitting stops every run, by tree, and the panel shows them stopped', async () => {
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'commands_run', arguments: { name: 'tree', key: 'tree-1' } }],
    })

    const started = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* inCatalogue(session.projectId, 'tree', STARTS_A_TREE, 'app')
        yield* runtime.prompt(session.id, 'start it')
        const panel = yield* until(panelOf(session.id), (read) => read.running[0]?.url != null)
        const run = panel.running[0]
        return { sessionId: session.id, pids: [run?.pid ?? 0, childIn(run?.output ?? '')] }
      }),
    )
    // The engine is gone: its scope closed, which is what a quit is.
    expect(started.pids.map(alive)).toEqual([false, false])

    // And the next start reads the run as the quit left it.
    const panel = await toolApplication(dataFolder)(fakeAgent())(panelOf(started.sessionId))
    expect(panel.running).toHaveLength(0)
    expect(panel.recent.map((run) => run.state)).toEqual(['stopped'])
  })
})

describe('A write outside the root asks the human', () => {
  test('refused, nothing is written; allowed, it is written once; nothing is kept as always', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hemera-outside-'))
    const target = join(outside, 'notes.md')
    const writing = (content: string, key: string) => [
      {
        does: 'uses' as const,
        call: 'fs_write',
        arguments: { path: target, content, key },
      },
    ]
    const agent = fakeAgent({
      turns: [writing('refused', 'w1'), writing('allowed', 'w2'), writing('again', 'w3')],
    })

    try {
      const seen = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const session = yield* aSessionOn(workspace, 'claude')
          yield* answeredTurn(session.id, 'write it', 'refused')
          const afterRefusal = existsSync(target)
          yield* answeredTurn(session.id, 'write it now', 'allowed')
          const afterAllowing = readFileSync(target, 'utf8')
          // The same write, asked again: nothing about the last answer was kept.
          yield* answeredTurn(session.id, 'write it once more', 'refused')
          return { afterRefusal, afterAllowing, entries: yield* threadOf(session.id) }
        }),
      )

      expect(seen.afterRefusal).toBe(false)
      expect(seen.afterAllowing).toBe('allowed')
      expect(readFileSync(target, 'utf8')).toBe('allowed')
      // Three writes, three questions: the human was asked each time.
      const asked = questionsIn(seen.entries).filter((entry) => entry.state !== 'pending')
      expect(asked).toHaveLength(3)
      // And none of them offered an "always": what is allowed is the call, not the tool.
      for (const question of asked) {
        const offered = z
          .object({ options: z.array(z.object({ kind: z.string() })) })
          .parse(JSON.parse(question.payload ?? '{}'))
        expect(offered.options.map((option) => option.kind).sort()).toEqual([
          'allow_once',
          'reject_once',
        ])
      }
      expect(
        seen.entries
          .filter((entry) => entry.kind === 'hemera_tool_call')
          .map((entry) => entry.state),
      ).toEqual(['failed', 'completed', 'failed'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('a link inside the root that leads outside is asked about where it leads', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hemera-outside-'))
    // A junction on Windows, which needs no privilege; a symbolic link elsewhere.
    symlinkSync(outside, join(workspace, 'elsewhere'), 'junction')
    const agent = fakeAgent({
      steps: [
        {
          does: 'uses',
          call: 'fs_write',
          arguments: { path: 'elsewhere/notes.md', content: 'through the link', key: 'w1' },
        },
      ],
    })

    try {
      const entries = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const session = yield* aSessionOn(workspace, 'claude')
          yield* answeredTurn(session.id, 'write it', 'refused')
          return yield* threadOf(session.id)
        }),
      )

      const asked = questionsIn(entries)
      expect(asked).toHaveLength(1)
      const where = z.object({ resolved: z.string() }).parse(JSON.parse(asked[0]?.payload ?? '{}'))
      expect(where.resolved.startsWith(realpathSync(outside))).toBe(true)
      expect(existsSync(join(outside, 'notes.md'))).toBe(false)
    } finally {
      rmSync(join(workspace, 'elsewhere'), { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('A token is not an authorisation', () => {
  test('an agent holding a valid token still waits for the human outside the root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hemera-outside-'))
    writeFileSync(join(outside, 'secret.md'), 'not for the agent\n')
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'fs_read', arguments: { path: join(outside, 'secret.md') } }],
    })

    try {
      const seen = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const access = yield* ToolAccess
          const session = yield* aSessionOn(workspace, 'claude')
          const turn = yield* Effect.forkScoped(runtime.prompt(session.id, 'read it'))
          yield* until(threadOf(session.id), (entries) => questionsIn(entries).length > 0)
          // The token is valid and the call is in: it is waiting on the human, and nothing else.
          const whileAsked = {
            live: yield* access.live(session.id),
            answered: agent.answers.used.length,
          }
          yield* decided(session.id, 'refused')
          yield* Fiber.join(turn)
          return whileAsked
        }),
      )

      expect(seen.live).toBe(true)
      expect(seen.answered).toBe(0)
      expect(agent.answers.used[0]?.status).toBe(200)
      expect(agent.answers.used[0]?.text).toContain('the user refused')
      expect(agent.answers.used[0]?.text).not.toContain('not for the agent')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('A new Session starts from the current instructions', () => {
  test('the fingerprint recorded is the current one, and no update is queued', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const first = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })
    const second = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

    const seen = await toolApplication(dataFolder)(first, second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const sessions = yield* Sessions
        const before = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(before.id, 'start')
        // The instructions change, and only then is the next Session opened.
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        const after = yield* sessions.create(before.projectId, 'claude')
        yield* runtime.prompt(after.id, 'start')
        return {
          provided: yield* context.provided(after.id),
          pending: yield* context.pending(after.id),
          entries: yield* threadOf(after.id),
        }
      }),
    )

    const current = createHash('sha256').update('Be brief, and say why.\n', 'utf8').digest('hex')
    expect(seen.provided.find((one) => one.kind === 'native')?.fingerprint).toBe(current)
    expect(seen.provided.filter((one) => one.kind === 'instructions')).toHaveLength(0)
    expect(seen.pending).toBeNull()
    expect(seen.entries.filter((entry) => entry.kind === 'context_delivery')).toHaveLength(0)
    expect(second.answers.prompts.join('\n')).not.toContain(DELIVERY_MARKER)
  })
})
