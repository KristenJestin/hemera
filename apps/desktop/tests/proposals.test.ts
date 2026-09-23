/**
 * The agent proposes, the human adds (D8-11, D8-16).
 *
 * The whole engine over the fake provider, as `agent-tools.test.ts` runs it: the agent calls
 * `commands_run` and `commands_propose` over MCP with its token, through the guard, and the human
 * answers the proposal through the `Proposals` service, which is what the Session's block calls.
 * What is read is what each side reads: the thread, the catalogue, the Journal and the answer the
 * agent was given. Each suite is named after the scenario of the Spec it plays.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect, Fiber, Layer } from 'effect'
import { z } from 'zod'

import { DuplicateCommandNameError, type SessionEntry } from '@hemera/core'

import { fakeAgent } from '#engine/agents/fake.ts'
import { NoNotices } from '#engine/agents/notices.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { ProposalDecidedError, Proposals, proposalsLayer } from '#engine/commands/proposals.ts'
import { Commands } from '#engine/commands/service.ts'
import { Journal } from '#engine/journal.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { threadOf, toolApplication, until } from './application.ts'

let dataFolder: string
let workspace: string

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-proposals-'))
  workspace = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-proposals-workspace-')))
  mkdirSync(join(workspace, 'sources', 'api'), { recursive: true })
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

/** A line that ends well, which the agent runs as a one-off. */
const ONE_OFF = `"${process.execPath}" -e "process.exit(0)"`

/** The proposal service, as the engine builds it, over the suite's engine. */
const withProposals = Layer.provide(proposalsLayer, NoNotices)

/** A Project on the suite's folder declaring `./sources/api`, and a Session of it. */
const aProjectSession = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const created = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: workspace })
  const project = yield* projects.addRepository(created.id, created.version, './sources/api')
  return yield* sessions.create(project.id, 'claude')
})

/** A proposal as the agent writes it, at the Workspace root. */
const proposing = (name: string) => ({
  does: 'uses' as const,
  call: 'commands_propose',
  arguments: {
    name,
    line: `node scripts/${name}.js`,
    type: 'script',
    why: `the ${name} is run before every test`,
  },
})

/** The same proposal, in a folder of the agent's naming. */
const proposingIn = (name: string, folder: string) => {
  const step = proposing(name)
  return { ...step, arguments: { ...step.arguments, folder } }
}

/** What a proposal entry carries. */
const PROPOSAL = z.object({
  proposalId: z.string(),
  name: z.string(),
  folder: z.string().nullable(),
  state: z.string(),
})

/** The proposals of a thread, by name, as the block reads them. */
const proposalsIn = (entries: readonly SessionEntry[]) =>
  entries
    .filter((entry) => entry.kind === 'command_proposal')
    .map((entry) => {
      const proposal = PROPOSAL.parse(JSON.parse(entry.payload))
      // The entry's own state is what the block draws, and the payload's must agree with it.
      expect(proposal.state).toBe(entry.state)
      return proposal
    })

/** A turn in which the human is asked, allowed as the human does. */
const allowedTurn = (sessionId: string, text: string) =>
  Effect.gen(function* () {
    const runtime = yield* AgentRuntime
    const turn = yield* Effect.forkScoped(runtime.prompt(sessionId, text))
    const entries = yield* until(threadOf(sessionId), (seen) =>
      seen.some((entry) => entry.kind === 'permission_request' && entry.state === 'pending'),
    )
    const pending = entries.find(
      (entry) => entry.kind === 'permission_request' && entry.state === 'pending',
    )
    const question = z
      .object({ toolCallId: z.string() })
      .parse(JSON.parse(pending?.payload ?? '{}'))
    yield* runtime.decide(sessionId, question.toolCallId, 'allowed')
    yield* Fiber.join(turn)
  })

describe('A one-off execution stays out of the catalogue', () => {
  test('two runs of the same line are two runs in the activity, and nothing is promoted', async () => {
    const running = (key: string) => [
      { does: 'uses' as const, call: 'commands_run', arguments: { line: ONE_OFF, key } },
    ]
    const agent = fakeAgent({ turns: [running('once-1'), running('once-2')] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const commands = yield* Commands
        const session = yield* aProjectSession
        yield* allowedTurn(session.id, 'run the check')
        yield* allowedTurn(session.id, 'run it again')
        const entries = yield* until(
          threadOf(session.id),
          (read) =>
            read.filter((entry) => entry.kind === 'command_run' && entry.state === 'exited')
              .length === 2,
        )
        return {
          entries,
          runs: yield* commands.recent(session.id),
          catalogue: yield* commands.list(session.projectId),
        }
      }),
    )

    expect(agent.answers.used.map((one) => one.isError)).toEqual([false, false])
    // Both runs are in the Session's activity, each a one-off with no catalogue entry.
    const runs = seen.entries.filter((entry) => entry.kind === 'command_run')
    expect(runs).toHaveLength(2)
    for (const run of runs) expect(JSON.parse(run.payload)).toMatchObject({ oneOff: true })
    expect(seen.runs.map((run) => run.commandId)).toEqual([null, null])
    // Repeating a one-off promotes nothing: the catalogue is unchanged, and nothing was proposed.
    expect(seen.catalogue).toHaveLength(0)
    expect(proposalsIn(seen.entries)).toHaveLength(0)
  })
})

describe('A proposal enters the catalogue only when accepted', () => {
  test('seed is in the catalogue after the click and not before; reset never is', async () => {
    const agent = fakeAgent({ turns: [[proposing('seed')], [proposingIn('reset', 'sources/api')]] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const journal = yield* Journal
        const proposals = yield* Proposals
        const session = yield* aProjectSession
        const catalogue = () => commands.list(session.projectId)

        yield* runtime.prompt(session.id, 'propose the seed')
        const proposed = proposalsIn(yield* threadOf(session.id))
        const beforeClick = yield* catalogue()
        yield* proposals.accept(session.id, proposed[0]?.proposalId ?? '')
        const afterClick = yield* catalogue()

        yield* runtime.prompt(session.id, 'propose the reset')
        const second = proposalsIn(yield* threadOf(session.id))
        yield* proposals.decline(session.id, second[1]?.proposalId ?? '')

        const read = yield* journal.read({ projectId: session.projectId })
        return {
          proposed,
          beforeClick,
          afterClick,
          final: proposalsIn(yield* threadOf(session.id)),
          catalogue: yield* catalogue(),
          lines: read.entries
            .filter((line) => line.type.startsWith('command.'))
            .toSorted((left, right) => left.sequence - right.sequence),
        }
      }).pipe(Effect.provide(withProposals)),
    )

    // The agent is told a human decides, and the proposal waits in the thread.
    expect(agent.answers.used[0]?.isError).toBe(false)
    expect(agent.answers.used[0]?.text).toBe(
      'proposed: a human will decide in the Session; nothing is in the catalogue yet',
    )
    expect(seen.proposed.map((one) => [one.name, one.state])).toEqual([['seed', 'pending']])
    // Not in the catalogue before the click, in it after.
    expect(seen.beforeClick.map((command) => command.name)).toEqual([])
    expect(seen.afterClick.map((command) => [command.name, command.line])).toEqual([
      ['seed', 'node scripts/seed.js'],
    ])
    // reset never is, and both entries carry their outcome; reset keeps its repository.
    expect(seen.catalogue.map((command) => command.name)).toEqual(['seed'])
    expect(seen.final.map((one) => [one.name, one.folder, one.state])).toEqual([
      ['seed', null, 'accepted'],
      ['reset', './sources/api', 'declined'],
    ])
    // The Journal says each step, on the proposal it is about.
    expect(seen.lines.map((line) => [line.type, line.entityKind])).toEqual([
      ['command.proposed', 'command'],
      ['command.created', 'project'],
      ['command.accepted', 'command'],
      ['command.proposed', 'command'],
      ['command.declined', 'command'],
    ])
    expect(seen.lines[0]?.entityId).toBe(seen.proposed[0]?.proposalId)
    expect(seen.lines[2]?.entityId).toBe(seen.proposed[0]?.proposalId)
  })
})

describe('a proposal the catalogue cannot take as it stands', () => {
  test('a folder that is no repository and a name already held are refused to the agent', async () => {
    const agent = fakeAgent({ turns: [[proposingIn('seed', 'elsewhere')], [proposing('dev')]] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const session = yield* aProjectSession
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'dev',
            line: 'pnpm dev',
            lineWindows: null,
            lineLinux: null,
            type: 'serve',
            folder: null,
            scope: 'workspace',
            portless: false,
          },
          false,
        )
        yield* runtime.prompt(session.id, 'propose the seed')
        yield* runtime.prompt(session.id, 'propose dev')
        return proposalsIn(yield* threadOf(session.id))
      }),
    )

    expect(agent.answers.used.map((one) => one.isError)).toEqual([true, true])
    expect(agent.answers.used[0]?.text).toContain('./sources/api')
    expect(agent.answers.used[1]?.text).toContain('dev is already a command of Atlas')
    expect(seen).toHaveLength(0)
  })

  test('a name taken since leaves it pending, and a decided one is not decided again', async () => {
    const agent = fakeAgent({ steps: [proposing('seed')] })

    const seen = await toolApplication(dataFolder)(agent)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const commands = yield* Commands
        const proposals = yield* Proposals
        const session = yield* aProjectSession
        yield* runtime.prompt(session.id, 'propose the seed')
        const proposalId = proposalsIn(yield* threadOf(session.id))[0]?.proposalId ?? ''
        // The user adds a `seed` of their own before deciding.
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'seed',
            line: 'pnpm seed',
            lineWindows: null,
            lineLinux: null,
            type: 'script',
            folder: null,
            scope: 'workspace',
            portless: false,
          },
          false,
        )
        const taken = yield* Effect.flip(proposals.accept(session.id, proposalId))
        const stillPending = proposalsIn(yield* threadOf(session.id))
        yield* proposals.decline(session.id, proposalId)
        const again = yield* Effect.flip(proposals.accept(session.id, proposalId))
        return {
          taken,
          stillPending,
          again,
          catalogue: yield* commands.list(session.projectId),
        }
      }).pipe(Effect.provide(withProposals)),
    )

    expect(seen.taken).toBeInstanceOf(DuplicateCommandNameError)
    expect(seen.stillPending.map((one) => one.state)).toEqual(['pending'])
    expect(seen.again).toBeInstanceOf(ProposalDecidedError)
    expect(seen.catalogue.map((command) => command.line)).toEqual(['pnpm seed'])
  })
})
