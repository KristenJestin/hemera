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
  mkdirSync,
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
import { Effect, Exit, Fiber } from 'effect'
import { z } from 'zod'

import {
  AGENTS_FILE,
  DELIVERY_MARKER,
  READ_PAGE_BYTES,
  SEARCH_MATCH_LIMIT,
  SEARCH_SCAN_BYTES,
  type SessionEntry,
  TOOL_NAMES,
  contextUri,
} from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Commands } from '#engine/commands/service.ts'
import { Context as AgentContext } from '#engine/context/service.ts'
import { Journal } from '#engine/journal.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { ToolAccess } from '#engine/tools/access.ts'
import { ToolServer } from '#engine/tools/server.ts'
import {
  aSessionOn,
  failing,
  gated,
  held,
  machine,
  pause,
  threadOf,
  toolApplication,
  until,
} from './application.ts'
import { withQualifiedOpenCode } from './unqualified.ts'

let dataFolder: string
let workspace: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-agent-tools-'))
  // The Workspace as the disk spells it, which is how a Project keeps its root.
  workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-agent-workspace-')))
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

/** The identifier a question was asked under, which is what its answer is sent with. */
const questionOf = (entry: SessionEntry | undefined) =>
  z
    .object({ toolCallId: z.string(), tool: z.string().optional() })
    .parse(JSON.parse(entry?.payload ?? '{}'))

/** Waits for the Session to be blocked on a question, and answers it as the human does. */
const decided = (sessionId: string, optionId: 'allowed' | 'refused') =>
  Effect.gen(function* () {
    const entries = yield* until(threadOf(sessionId), (seen) =>
      seen.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
    )
    const pending = entries.find(
      (entry) => entry.kind === 'permission_request' && entry.state === 'pending',
    )
    const runtime = yield* AgentRuntime
    yield* runtime.decide(sessionId, questionOf(pending).toolCallId, optionId)
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
      expect(where.resolved.startsWith(realpathSync.native(outside))).toBe(true)
      expect(existsSync(join(outside, 'notes.md'))).toBe(false)
    } finally {
      rmSync(join(workspace, 'elsewhere'), { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('Two questions at once are each answered by their own block', () => {
  /** An agent that reads one file and writes another outside the root, in one step. */
  const together = (outside: string) =>
    fakeAgent({
      steps: [
        {
          does: 'usesTogether',
          calls: [
            { does: 'uses', call: 'fs_read', arguments: { path: join(outside, 'a.md') } },
            {
              does: 'uses',
              call: 'fs_write',
              arguments: { path: join(outside, 'b.md'), content: 'written', key: 'b' },
            },
          ],
        },
      ],
    })

  /** The two questions, once both are waiting, by the tool that asked each. */
  const bothAsked = (sessionId: string) =>
    Effect.gen(function* () {
      const entries = yield* until(
        threadOf(sessionId),
        (seen) => questionsIn(seen).filter((entry) => entry.state === 'pending').length === 2,
      )
      const pending = questionsIn(entries).filter((entry) => entry.state === 'pending')
      const byTool = (tool: string) =>
        questionOf(pending.find((entry) => questionOf(entry).tool === tool)).toolCallId
      return { read: byTool('fs_read'), write: byTool('fs_write') }
    })

  test('answered out of order, each answer goes to the question it was given for', async () => {
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-outside-')))
    writeFileSync(join(outside, 'a.md'), 'secret\n')
    const agent = together(outside)

    try {
      const entries = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(workspace, 'claude')
          const turn = yield* Effect.forkScoped(runtime.prompt(session.id, 'read and write'))
          const asked = yield* bothAsked(session.id)
          // The second block first: allowing the write is not allowing the read.
          yield* runtime.decide(session.id, asked.write, 'allowed')
          yield* runtime.decide(session.id, asked.read, 'refused')
          yield* Fiber.join(turn)
          return yield* threadOf(session.id)
        }),
      )

      expect(readFileSync(join(outside, 'b.md'), 'utf8')).toBe('written')
      const read = agent.answers.used.find((one) => one.tool === 'fs_read')
      expect(read?.text).toContain('the user refused')
      expect(read?.text).not.toContain('secret')
      const said = entries
        .filter((entry) => entry.kind === 'permission_decision')
        .map((entry) => entry.body)
        .sort()
      expect(said).toEqual([
        `you allowed fs_write to act on ${join(outside, 'b.md')}`,
        `you refused fs_read on ${join(outside, 'a.md')}`,
      ])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('a Stop cancels both, and nothing is read or written', async () => {
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-outside-')))
    writeFileSync(join(outside, 'a.md'), 'secret\n')
    const agent = together(outside)

    try {
      const entries = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(workspace, 'claude')
          const turn = yield* Effect.forkScoped(runtime.prompt(session.id, 'read and write'))
          yield* bothAsked(session.id)
          yield* runtime.stop(session.id)
          yield* Fiber.join(turn)
          return yield* until(threadOf(session.id), (seen) =>
            questionsIn(seen).every((entry) => entry.state === 'cancelled'),
          )
        }),
      )

      expect(questionsIn(entries).map((entry) => entry.state)).toEqual(['cancelled', 'cancelled'])
      expect(existsSync(join(outside, 'b.md'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('An agent that gives up on a call withdraws the question it asked', () => {
  test('the question closes as withdrawn while the turn goes on, and a later decision acts on nothing', async () => {
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-outside-')))
    const target = join(outside, 'notes.md')
    // Claude Code's idle timeout, made short: the agent reports the call failed and goes on, and
    // the request it made is left open with nothing sent to cancel it.
    const agent = fakeAgent({
      steps: [
        {
          does: 'uses',
          call: 'fs_write',
          arguments: { path: target, content: 'written for nobody', key: 'w1' },
          id: 'toolu_01',
          givesUpAfter: 200,
        },
        { does: 'says', text: 'I went on without it.' },
      ],
    })

    try {
      const seen = await toolApplication(dataFolder)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(workspace, 'claude')
          const report = yield* runtime.prompt(session.id, 'write it')
          const entries = yield* until(threadOf(session.id), (thread) =>
            thread.some((entry) => entry.kind === 'hemera_tool_call'),
          )
          const asked = questionOf(questionsIn(entries)[0]).toolCallId
          const late = yield* Effect.exit(runtime.decide(session.id, asked, 'allowed'))
          yield* pause(100)
          return { report, entries, late }
        }),
      )

      expect(seen.report.stopReason).toBe('end_turn')
      expect(questionsIn(seen.entries).map((entry) => entry.state)).toEqual(['cancelled'])
      const decision = seen.entries.find((entry) => entry.kind === 'permission_decision')
      expect(decision?.body).toBe('Withdrawn: the agent stopped waiting for this call')
      const call = seen.entries.find((entry) => entry.kind === 'hemera_tool_call')
      expect(call?.state).toBe('failed')
      expect(call?.body).toBe('the agent stopped waiting for this call')
      expect(Exit.isFailure(seen.late)).toBe(true)
      expect(existsSync(target)).toBe(false)
    } finally {
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

/** The resources of one prompt a fake agent was sent, by their address and their text. */
const resourcesOf = (agent: ReturnType<typeof fakeAgent>, prompt: number) =>
  (agent.answers.blocks[prompt] ?? []).flatMap((block) =>
    block.type === 'resource' && 'text' in block.resource
      ? [{ uri: block.resource.uri, text: block.resource.text }]
      : [],
  )

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
    expect(seen.provided.find((one) => one.kind === 'provided')?.fingerprint).toBe(current)
    expect(seen.provided.filter((one) => one.kind === 'instructions')).toHaveLength(0)
    expect(seen.pending).toBeNull()
    expect(seen.entries.filter((entry) => entry.kind === 'context_delivery')).toHaveLength(0)
    // Claude Code does not read the file bare: it is given it once, as it now reads, and no more.
    expect(resourcesOf(second, 0)).toEqual([
      { uri: contextUri(AGENTS_FILE), text: 'Be brief, and say why.\n' },
    ])
  })
})

describe('An agent that does not read AGENTS.md itself is given it at session start', () => {
  test('Claude Code has it as a resource of its first prompt, behind the marker, and only then', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'End every answer with the word KESTREL.\n')
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'Hello. KESTREL' }] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'Say hello.')
        yield* runtime.prompt(session.id, 'Again.')
        return {
          provided: yield* context.provided(session.id),
          entries: yield* threadOf(session.id),
        }
      }),
    )

    expect(agent.answers.blocks[0]?.[0]).toEqual({ type: 'text', text: DELIVERY_MARKER })
    expect(resourcesOf(agent, 0)).toEqual([
      { uri: contextUri(AGENTS_FILE), text: 'End every answer with the word KESTREL.\n' },
    ])
    expect(agent.answers.prompts[0]).toContain('Say hello.')
    expect(resourcesOf(agent, 1)).toEqual([])
    expect(seen.provided.find((one) => one.path === AGENTS_FILE)).toMatchObject({
      kind: 'provided',
      reached: 'session_start',
    })
    // Given at the start, not delivered: the thread holds no delivery of it.
    expect(seen.entries.filter((entry) => entry.kind === 'context_delivery')).toHaveLength(0)
  })
})

/** The bearer token a fake agent was handed at `session/new`, as it sends it. */
const tokenOf = (agent: ReturnType<typeof fakeAgent>): string => {
  const server = agent.answers.mcpServers[0]?.[0]
  const header = server !== undefined && 'headers' in server ? server.headers[0]?.value : undefined
  return (header ?? '').replace(/^Bearer /, '')
}

/** One `tools/call` sent straight to the server, as an agent with that token would send it. */
const callWith = (
  origin: string,
  token: string | null,
  name: string,
  sent: Readonly<Record<string, string>>,
) =>
  Effect.promise(async () => {
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    })
    if (token !== null) headers.set('authorization', `Bearer ${token}`)
    const response = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: sent },
      }),
    })
    return { status: response.status, body: await response.text() }
  })

/** What a `hemera_tool_call` entry says of where it came from (D6-06). */
const PROVENANCE = z.object({
  tool: z.string(),
  session: z.string(),
  caller: z.string(),
  agent: z.string(),
  ms: z.number(),
})

describe('A read inside the Workspace goes through on its own', () => {
  test('the entry and the Journal line carry the Session, the agent, the token and the time', async () => {
    writeFileSync(join(workspace, 'notes.md'), 'the answer is 42\n')
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'fs_read', arguments: { path: 'notes.md' } }],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const journal = yield* Journal
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'read the notes')
        const read = yield* journal.read({ projectId: session.projectId })
        return {
          sessionId: session.id,
          entries: yield* threadOf(session.id),
          lines: read.entries.filter((line) => line.type.startsWith('tool.')),
        }
      }),
    )

    const token = tokenOf(agent)
    const digest = createHash('sha256').update(token).digest('hex').slice(0, 12)
    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls).toHaveLength(1)
    const provenance = PROVENANCE.parse(JSON.parse(calls[0]?.payload ?? '{}'))
    expect(provenance).toMatchObject({
      tool: 'fs_read',
      session: seen.sessionId,
      caller: digest,
      agent: 'claude',
    })
    expect(provenance.ms).toBeGreaterThan(0)
    // The token itself is written nowhere: the digest names it.
    expect(JSON.stringify(seen.entries)).not.toContain(token)
    // Nothing was asked of the human, and the Journal has the same call under the same caller.
    expect(questionsIn(seen.entries)).toHaveLength(0)
    expect(seen.lines.map((line) => line.type)).toEqual(['tool.completed'])
    expect(seen.lines[0]?.entityId).toBe(seen.sessionId)
    expect(seen.lines[0]?.payload).toMatchObject({ tool: 'fs_read', caller: digest })
  })
})

describe('A long read is paginated', () => {
  test('the agent reads the range, truncated and the next offset, and the next page from it', async () => {
    const body = 'x'.repeat(READ_PAGE_BYTES + 1024)
    writeFileSync(join(workspace, 'long.txt'), body)
    const agent = fakeAgent({
      steps: [
        { does: 'uses', call: 'fs_read', arguments: { path: 'long.txt' } },
        { does: 'uses', call: 'fs_read', arguments: { path: 'long.txt', offset: READ_PAGE_BYTES } },
      ],
    })

    await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'read it all')
      }),
    )

    // The range is the last line of what the agent reads, as fields it can parse.
    const RANGE = z.object({
      offset: z.number(),
      end: z.number(),
      size: z.number(),
      truncated: z.boolean(),
      next: z.number().nullable(),
    })
    const rangeOf = (text: string) => RANGE.parse(JSON.parse(text.split('\n').at(-1) ?? '{}'))
    expect(rangeOf(agent.answers.used[0]?.text ?? '')).toEqual({
      offset: 0,
      end: READ_PAGE_BYTES,
      size: body.length,
      truncated: true,
      next: READ_PAGE_BYTES,
    })
    expect(rangeOf(agent.answers.used[1]?.text ?? '')).toEqual({
      offset: READ_PAGE_BYTES,
      end: body.length,
      size: body.length,
      truncated: false,
      next: null,
    })
  })
})

describe('The same write twice has one effect', () => {
  test('a write, an edit and a run sent twice under one key act once and answer the same', async () => {
    const counts = `"${process.execPath}" -e "require('fs').appendFileSync('ran.txt','x')"`
    const twice = (call: string, sent: Readonly<Record<string, string>>) => [
      { does: 'uses' as const, call, arguments: sent },
      { does: 'uses' as const, call, arguments: sent },
    ]
    const agent = fakeAgent({
      steps: [
        ...twice('fs_write', { path: 'once.txt', content: 'first', key: 'write-1' }),
        ...twice('fs_edit', { path: 'once.txt', old: 'first', new: 'edited', key: 'edit-1' }),
        ...twice('commands_run', { name: 'count', key: 'run-1' }),
      ],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* inCatalogue(session.projectId, 'count', counts, 'check')
        yield* runtime.prompt(session.id, 'write, edit and run')
        return yield* panelOf(session.id)
      }),
    )

    const [write, writeAgain, edit, editAgain, run, runAgain] = agent.answers.used
    // Each second answer is the first one, word for word.
    expect(writeAgain?.text).toBe(write?.text)
    expect(editAgain?.text).toBe(edit?.text)
    expect(runAgain?.text).toBe(run?.text)
    expect([write, edit, run].map((one) => one?.isError)).toEqual([false, false, false])
    // And each effect happened once: the edit found its text, and the command ran once.
    expect(readFileSync(join(workspace, 'once.txt'), 'utf8')).toBe('edited')
    expect(readFileSync(join(workspace, 'ran.txt'), 'utf8')).toBe('x')
    expect(seen.recent).toHaveLength(1)
  })
})

describe('A search is bounded and says so', () => {
  test('it stops at 1 MiB scanned, says which limit, and its cursor finds the rest', async () => {
    // More than one call can scan, and what is looked for is past the budget.
    const filler = `${'x'.repeat(99)}\n`.repeat(Math.ceil((SEARCH_SCAN_BYTES * 1.5) / 100))
    writeFileSync(join(workspace, 'big.txt'), `${filler}the needle\n`)
    const agent = fakeAgent({
      steps: [{ does: 'uses', call: 'search', arguments: { query: 'needle' } }],
    })

    await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'find the needle')
      }),
    )

    const first = agent.answers.used[0]?.text ?? ''
    expect(first).toContain('no match')
    expect(first).toContain('stopped by the scan budget')
    expect(first).toContain(
      `${String(SEARCH_MATCH_LIMIT)} matches and ${String(SEARCH_SCAN_BYTES)} bytes`,
    )
    const cursor = /continue from cursor (\S+)/.exec(first)?.[1] ?? ''
    expect(cursor).not.toBe('')

    // The agent carries on from where it was told to, in a turn of its own.
    const next = fakeAgent({
      steps: [{ does: 'uses', call: 'search', arguments: { query: 'needle', cursor } }],
    })
    await toolApplication(dataFolder)(next)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const projects = yield* Projects
        const project = (yield* projects.list())[0]
        if (project === undefined) return
        const session = yield* sessions.create(project.id, 'claude')
        yield* runtime.prompt(session.id, 'carry on looking')
      }),
    )
    expect(next.answers.used[0]?.text).toContain('big.txt')
    expect(next.answers.used[0]?.text).toContain('the needle')
  })
})

describe('The catalogue is edited and read', () => {
  test('a command in a repository of the Project is listed to the agent with its kind and folder', async () => {
    mkdirSync(join(workspace, 'api'))
    const agent = fakeAgent({ steps: [{ does: 'uses', call: 'commands_list', arguments: {} }] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const projects = yield* Projects
        const session = yield* aSessionOn(workspace, 'claude')
        const project = (yield* projects.list()).find((one) => one.id === session.projectId)
        yield* projects.addRepository(session.projectId, project?.version ?? 0, 'api')
        yield* inCatalogue(session.projectId, 'test-api', 'pnpm test', 'check', 'api')
        yield* runtime.prompt(session.id, 'what can I run?')
        return yield* commands.list(session.projectId)
      }),
    )

    // What the panel offers is the catalogue the user edited.
    expect(seen.map((one) => [one.name, one.kind, one.folder])).toEqual([
      ['test-api', 'check', 'api'],
    ])
    // And the agent reads the same command, with its kind and the folder it runs in.
    expect(agent.answers.used[0]?.text).toContain('test-api  check  in api  pnpm test')
  })
})

describe('A foreign or revoked access is rejected', () => {
  test('no token, another Session’s, a released one: refused or kept to its own Session, never logged', async () => {
    const written: string[] = []
    const first = fakeAgent({ listsTools: true })
    const second = fakeAgent({ listsTools: true })

    const seen = await toolApplication(dataFolder, written)(first, second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const server = yield* ToolServer
        const mine = yield* aSessionOn(workspace, 'claude')
        const theirs = yield* sessions.create(mine.projectId, 'claude')
        yield* runtime.start(mine.id)
        yield* runtime.start(theirs.id)
        const none = yield* callWith(server.origin, null, 'session_get', {})
        // The other Session's token reaches the other Session, and never this one.
        const other = yield* callWith(server.origin, tokenOf(second), 'session_get', {})
        yield* runtime.release(mine.id)
        const released = yield* callWith(server.origin, tokenOf(first), 'fs_read', {
          path: 'notes.md',
        })
        return { none, other, released, mine: mine.id, theirs: theirs.id }
      }),
    )

    expect(seen.none).toEqual({ status: 401, body: '{"error":"unauthorized"}' })
    expect(seen.released).toEqual({ status: 401, body: '{"error":"unauthorized"}' })
    expect(seen.other.status).toBe(200)
    expect(seen.other.body).toContain(`session: ${seen.theirs}`)
    expect(seen.other.body).not.toContain(seen.mine)
    // The diagnostic names the Session and the tool of a refused call, and no token at all.
    const refusals = written.filter((line) => line.includes('refused'))
    expect(refusals.some((line) => line.includes(seen.mine) && line.includes('fs_read'))).toBe(true)
    for (const token of [tokenOf(first), tokenOf(second)]) {
      expect(token).not.toBe('')
      for (const line of written) expect(line).not.toContain(token)
    }
  })
})

describe('No human-only action is reachable', () => {
  test('no tool approves, closes or merges, a call to one is refused, and a one-off asks', async () => {
    const agent = fakeAgent({
      steps: [
        { does: 'uses', call: 'permission_approve', arguments: { id: 'anything' } },
        { does: 'uses', call: 'session_close', arguments: {} },
        { does: 'uses', call: 'commands_run', arguments: { line: ONE_OFF, key: 'one-off' } },
      ],
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const session = yield* aSessionOn(workspace, 'claude')
        yield* answeredTurn(session.id, 'approve it yourself', 'refused')
        return { entries: yield* threadOf(session.id), panel: yield* panelOf(session.id) }
      }),
    )

    // The server offers nothing of the human's, over the very door the agent uses.
    const offered = agent.answers.tools[0] ?? []
    expect(offered).not.toEqual([])
    expect(
      offered.filter((name) => /approv|decid|permission|close|merge|archiv/.test(name)),
    ).toEqual([])
    // Asking for one anyway is refused, and nothing happened.
    expect(agent.answers.used[0]?.isError).toBe(true)
    expect(agent.answers.used[1]?.isError).toBe(true)
    // A line the agent wrote itself is the human's to allow: they were asked, refused, and it
    // did not run.
    expect(questionsIn(seen.entries)).toHaveLength(1)
    expect(agent.answers.used[2]?.text).toContain('the user refused')
    expect(seen.panel.recent).toHaveLength(0)
  })
})

describe("A qualified agent has only Hemera's tools", () => {
  withQualifiedOpenCode()

  test("the session's capabilities are Hemera's tools, and every call of the turn is one", async () => {
    writeFileSync(join(workspace, 'notes.md'), 'the answer is 42\n')
    const agent = fakeAgent({
      steps: [
        { does: 'uses', call: 'fs_list', arguments: {} },
        { does: 'uses', call: 'fs_read', arguments: { path: 'notes.md' } },
        { does: 'uses', call: 'session_get', arguments: {} },
      ],
    })

    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'opencode')
        yield* runtime.prompt(session.id, 'look around')
        return yield* threadOf(session.id)
      }),
    )

    // What the agent was handed to call is Hemera's catalogue, whole, and nothing beside it.
    expect(agent.answers.tools).toEqual([[...TOOL_NAMES]])
    // Every call the agent made in the turn is one Hemera answered and recorded.
    const made = entries.filter((entry) => entry.kind === 'tool_call').map((entry) => entry.body)
    const recorded = entries
      .filter((entry) => entry.kind === 'hemera_tool_call')
      .map((entry) => PROVENANCE.parse(JSON.parse(entry.payload ?? '{}')).tool)
    expect(made).toEqual(['fs_list', 'fs_read', 'session_get'])
    expect(recorded).toEqual(made)
  })
})

describe('A change during a turn leaves at the next safe point', () => {
  test('nothing is sent while the turn runs; after it, a delivery and no message of anyone', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const gate = gated(1)
    const agent = fakeAgent({
      steps: [
        { does: 'says', text: 'reading' },
        { does: 'says', text: 'done' },
      ],
      between: gate.between,
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const session = yield* aSessionOn(workspace, 'claude')
        const turn = yield* Effect.forkScoped(runtime.prompt(session.id, 'start'))
        yield* until(threadOf(session.id), (entries) =>
          entries.some((entry) => entry.body.includes('reading')),
        )
        // The instructions change while the turn is running.
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        yield* pause(50)
        const duringTheTurn = {
          prompts: agent.answers.prompts.length,
          deliveries: (yield* threadOf(session.id)).filter(
            (entry) => entry.kind === 'context_delivery',
          ).length,
        }
        gate.carryOn()
        yield* Fiber.join(turn)
        yield* runtime.prompt(session.id, 'carry on')
        return {
          duringTheTurn,
          entries: yield* threadOf(session.id),
          provided: yield* context.provided(session.id),
        }
      }),
    )

    expect(seen.duringTheTurn).toEqual({ prompts: 1, deliveries: 0 })
    // Between the turns, a prompt of its own: the marker and the new text as a resource.
    expect(agent.answers.blocks[1]).toEqual([
      { type: 'text', text: DELIVERY_MARKER },
      {
        type: 'resource',
        resource: {
          uri: contextUri(AGENTS_FILE),
          mimeType: 'text/markdown',
          text: 'Be brief, and say why.\n',
        },
      },
    ])
    expect(agent.answers.prompts[2]).toBe('carry on')
    // One delivery in the thread, with the new fingerprint and how it reached the agent.
    const fingerprint = createHash('sha256')
      .update('Be brief, and say why.\n', 'utf8')
      .digest('hex')
    const deliveries = seen.entries.filter((entry) => entry.kind === 'context_delivery')
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.role).toBe('hemera')
    expect(JSON.parse(deliveries[0]?.payload ?? '{}')).toMatchObject({
      fingerprint,
      reached: 'delivery_prompt',
    })
    // And no message of the user's that the user did not write: two prompts, two messages.
    expect(
      seen.entries.filter((entry) => entry.role === 'user' && entry.kind === 'message'),
    ).toHaveLength(2)
    // The Context view has it too, said to have reached the agent as a delivery.
    const change = seen.provided.find((one) => one.kind === 'instructions')
    expect(change).toMatchObject({ fingerprint, reached: 'delivery_prompt' })
    expect(seen.provided.find((one) => one.kind === 'provided')?.reached).toBe('session_start')
  })
})

describe('A delivery counts as given only once it was sent', () => {
  test('a delivery the agent refused stays pending, and the next safe point hands it over', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    let refusals = 0
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      onPrompt: (text) => {
        if (text !== DELIVERY_MARKER || refusals > 0) return
        refusals += 1
        throw new Error('the provider refused the prompt')
      },
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const context = yield* AgentContext
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        // Changed while nothing runs: the watcher hands it over, and the agent refuses it.
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        yield* until(threadOf(session.id), (thread) =>
          thread.some((entry) => entry.kind === 'context_delivery' && entry.state === 'failed'),
        )
        const afterRefusal = yield* context.provided(session.id)
        // The next prompt is the next safe point: the change goes out before it, again.
        yield* runtime.prompt(session.id, 'carry on')
        return {
          afterRefusal,
          provided: yield* context.provided(session.id),
          entries: yield* threadOf(session.id),
        }
      }),
    )

    expect(seen.afterRefusal.filter((one) => one.kind === 'instructions')).toHaveLength(0)
    expect(seen.provided.filter((one) => one.kind === 'instructions')).toHaveLength(1)
    const deliveries = seen.entries.filter((entry) => entry.kind === 'context_delivery')
    expect(deliveries.map((entry) => entry.state)).toEqual(['failed', null])
    expect(
      agent.answers.blocks.filter((blocks) => blocks[0]?.type === 'text' && blocks.length === 2),
    ).toHaveLength(2)
  })

  test('a file edited A, B, A, B keeps an entry per delivery, each naming what it replaced', async () => {
    const A = 'Be brief.\n'
    const B = 'Be brief, and say why.\n'
    const fingerprintOf = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
    writeFileSync(join(workspace, AGENTS_FILE), A)
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })

    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        for (const text of [B, A, B, A]) {
          writeFileSync(join(workspace, AGENTS_FILE), text)
          yield* runtime.prompt(session.id, 'go on')
        }
        return yield* threadOf(session.id)
      }),
    )

    const deliveries = entries
      .filter((entry) => entry.kind === 'context_delivery')
      .map((entry) =>
        z.object({ before: z.string(), after: z.string() }).parse(JSON.parse(entry.payload)),
      )
    expect(deliveries).toEqual([
      { before: fingerprintOf(A), after: fingerprintOf(B) },
      { before: fingerprintOf(B), after: fingerprintOf(A) },
      { before: fingerprintOf(A), after: fingerprintOf(B) },
      { before: fingerprintOf(B), after: fingerprintOf(A) },
    ])
  })
})

describe('A Stop during the delivery before a prompt stops the turn', () => {
  test('the delivery is cancelled, the prompt is never sent, and the turn closes as stopped', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const hold = held()
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      holdsDelivery: () => hold.promise,
    })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        // Changed and asked right away: the change goes out before the prompt, inside the turn.
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        const turn = yield* Effect.forkScoped(runtime.prompt(session.id, 'go on'))
        yield* until(
          Effect.sync(() => agent.answers.blocks.length),
          (count) => count === 2,
        )
        yield* runtime.stop(session.id)
        hold.carryOn()
        const report = yield* Fiber.join(turn)
        return { report, entries: yield* threadOf(session.id) }
      }),
    )

    expect(seen.report.stopReason).toBe('cancelled')
    expect(agent.answers.prompts).not.toContain('go on')
    const closed = seen.entries.filter((entry) => entry.kind === 'turn')
    expect(closed.map((entry) => entry.state)).toEqual(['end_turn', 'cancelled'])
  })
})

describe('A delivery outside a turn is its own turn', () => {
  test('the change goes out as a turn with no message, and the answer lands inside it', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      answersDelivery: [{ does: 'says', text: 'Noted: brief, and why.' }],
    })

    const entries = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        // The instructions change while nothing runs: the next safe point is now.
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        return yield* until(
          threadOf(session.id),
          (thread) => thread.filter((entry) => entry.kind === 'turn').length === 2,
        )
      }),
    )

    const [first, delivery] = entries.filter((entry) => entry.kind === 'turn')
    expect(JSON.parse(first?.payload ?? '{}')).toEqual({ stopReason: 'end_turn' })
    // A turn of its own, said to be a delivery, which ended as the agent ended it.
    expect(JSON.parse(delivery?.payload ?? '{}')).toEqual({
      stopReason: 'end_turn',
      kind: 'delivery',
    })
    const turnId = delivery?.turnId ?? ''
    const inside = entries.filter((entry) => entry.turnId === turnId)
    // The delivery, what the agent answered it, and the entry that closes the turn — and no
    // message of the user's: the one they wrote is the first turn's.
    expect(inside.map((entry) => entry.kind)).toEqual(['context_delivery', 'message', 'turn'])
    expect(inside.find((entry) => entry.kind === 'message')?.body).toBe('Noted: brief, and why.')
    expect(
      entries.filter((entry) => entry.role === 'user' && entry.kind === 'message'),
    ).toHaveLength(1)
  })
})

/**
 * A delivery turn whose answer could not be written (Decided 10 of #17, D6-08).
 *
 * What the agent answered a delivery with is flushed before the entry that closes its turn, and a
 * write of the thread can fail. The answer is dropped and the diagnostic says so; the turn still
 * ends with its `turn` entry, or the thread would show a delivery that never finished.
 */
describe('A delivery turn survives a failed chunk write', () => {
  test('A delivery turn survives a failed chunk write', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      answersDelivery: [{ does: 'says', text: 'Noted: brief, and why.' }],
    })
    const storage = failing()
    storage.nextWrite(
      (entry) => entry.kind === 'message' && entry.body === 'Noted: brief, and why.',
    )
    const written: string[] = []

    const entries = await toolApplication(dataFolder, written, machine, storage)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
        return yield* until(
          threadOf(session.id),
          (thread) => thread.filter((entry) => entry.kind === 'turn').length === 2,
        )
      }),
    )

    const delivery = entries.filter((entry) => entry.kind === 'turn')[1]
    expect(JSON.parse(delivery?.payload ?? '{}')).toEqual({
      stopReason: 'end_turn',
      kind: 'delivery',
    })
    // The answer is the one thing missing from the turn, and the diagnostic names it.
    const inside = entries.filter((entry) => entry.turnId === delivery?.turnId)
    expect(inside.map((entry) => entry.kind)).toEqual(['context_delivery', 'turn'])
    expect(written.filter((line) => line.includes('was dropped'))).toHaveLength(1)
  })
})

describe('A Session torn down with the application writes into an open database', () => {
  test('what the program scope does as it closes still meets the database', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'done' }] })
    let closing: boolean | null = null

    await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSessionOn(workspace, 'claude')
        yield* runtime.prompt(session.id, 'start')
        // The agent, its drain and its death watcher live in this scope: whatever they write as it
        // closes has to find the database still open, which is the order the engine runs in.
        yield* Effect.addFinalizer(() =>
          threadOf(session.id).pipe(
            Effect.exit,
            Effect.map((exit) => {
              closing = Exit.isSuccess(exit)
            }),
          ),
        )
      }),
    )

    expect(closing).toBe(true)
  })

  test('a Stop during a delivery leaves no write behind once the database is closed', async () => {
    writeFileSync(join(workspace, AGENTS_FILE), 'Be brief.\n')
    const hold = held()
    const agent = fakeAgent({
      steps: [{ does: 'says', text: 'done' }],
      holdsDelivery: () => hold.promise,
    })
    const written: string[] = []
    const rejected: string[] = []
    const heard = (reason: Error) => {
      rejected.push(reason.message)
    }
    process.on('unhandledRejection', heard)

    try {
      await toolApplication(dataFolder, written)(agent)(
        Effect.gen(function* () {
          const runtime = yield* AgentRuntime
          const session = yield* aSessionOn(workspace, 'claude')
          yield* runtime.prompt(session.id, 'start')
          // The instructions change while nothing runs: the delivery is a turn of its own, the
          // agent holds it, and the Stop is pressed inside it right before the application quits.
          writeFileSync(join(workspace, AGENTS_FILE), 'Be brief, and say why.\n')
          yield* until(
            Effect.sync(() => agent.answers.blocks.length),
            (count) => count === 2,
          )
          yield* runtime.stop(session.id)
        }),
      )
      // The agent lets go of the delivery once the application is gone: whatever its turn still
      // had to write — the entry that closes it — would meet a database that is closed.
      hold.carryOn()
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 200)
      })
    } finally {
      process.off('unhandledRejection', heard)
    }

    expect(rejected).toEqual([])
    expect(written.filter((line) => line.startsWith('sessions: write after release'))).toEqual([])
  })
})
