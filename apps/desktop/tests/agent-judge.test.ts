/**
 * The agent's own judge (#197) through the real gate of a real engine, with the fake ACP agent of
 * #32 as the judge behind the starter — never a real agent, never a real provider. When Jev is not
 * ready, a call the local rules leave open is rated by a judge session of the session's own agent:
 * it allows or asks, every failure asks, steps 1 to 4 never reach it, it can do nothing, it is told
 * nothing secret, and one judge is kept open per agent.
 */

import { mkdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import type { ContentBlock, SessionConfigOption } from '@agentclientprotocol/sdk'
import {
  DecisionFields,
  JUDGE_INSTRUCTIONS,
  MissionOwner,
  NeverProgram,
  PERMISSION_POLICY,
  WrittenAnswer,
} from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { eq } from 'drizzle-orm'
import { Effect, Fiber, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { type FakeAgent, type FakeStep, fakeAgent } from '../src/engine/agents/fake.ts'
import { AgentStarter } from '../src/engine/agents/runtime.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { AGENT_REQUESTS, answerNeed, createNeed } from '../src/engine/needs.ts'
import { JUDGEMENTS, JUDGE_IDLE } from '../src/engine/permissions/agent-judge.ts'
import { HemeraAuto } from '../src/engine/permissions/hemera-auto.ts'
import { JevTransport, fetchTransport } from '../src/engine/permissions/jev.ts'
import { setNeverList } from '../src/engine/permissions/never-list.ts'
import { SessionTurns } from '../src/engine/permissions/ports.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { type FakeJev, fakeJev, scored } from './fake-jev.ts'
import { PASSING } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, questionsKept, sessionOf } from './tools-world.ts'

const KEY = 'jev-test-key-0123456789'

let data: string
let work: string
let jev: FakeJev

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('agent-judge'))
  work = realpathSync.native(temporaryFolder('agent-judge-work'))
  jev = await fakeJev()
})
afterEach(async () => {
  await jev.close()
  removeFolders()
})

/** The models the fake judge offers, as Claude Code's adapter names them. */
const MODELS: SessionConfigOption = {
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: 'default',
  options: ['default', 'sonnet', 'haiku'].map((value) => ({ value, name: value })),
}

/** What the fake judge answers with these scores. */
const says = (risk: number, approval: number, userRequested: number): FakeStep => ({
  does: 'says',
  text: JSON.stringify({ risk, approval, userRequested }),
})

/** The judges started, and what each does on each turn: read when the turn comes. */
interface Judges {
  readonly started: FakeAgent[]
  steps: ReadonlyArray<FakeStep>
  /** Awaited before each step: a promise that never settles holds the turn for ever. */
  hold: () => Promise<void>
}

interface World {
  /** The judges started, and what the next turns do. */
  readonly judges: Judges
  readonly builder: string
  readonly builderSession: string
  readonly main: string
  readonly projectId: string
  readonly missionId: string
}

/**
 * One engine whose agents are the fake judge, and whose Jev is the fake: no key and no consent
 * unless told, so the agent's judge is the one asked. Answers what `body` answers, with the
 * questions asked, the judges started and the engine's diagnostic lines.
 */
const withJudge = <A, E>(
  body: (world: World) => Effect.Effect<A, E, EngineServices>,
  options: {
    readonly jev?: boolean
    readonly testClock?: boolean
    readonly steps?: ReadonlyArray<FakeStep>
  } = {},
) => {
  const judges: Judges = {
    started: [],
    steps: options.steps ?? [says(0.2, 0.1, 0)],
    hold: () => Promise.resolve(),
  }
  const questions = questionsKept()
  const starter = Layer.succeed(AgentStarter, {
    start: () =>
      Effect.sync(() => {
        const agent = fakeAgent({
          configOptions: [MODELS],
          get steps() {
            return judges.steps
          },
          between: () => judges.hold(),
        })
        judges.started.push(agent)
        return agent.process
      }),
  })
  const discovery = Layer.succeed(Discovery, {
    list: Effect.succeed([]),
    probe: () => Effect.succeed(null),
    resolve: (id) =>
      Effect.succeed({
        adapter: ADAPTERS[id],
        from: 'bundled' as const,
        program: '/adapters/fake.mjs',
        args: [],
        env: {},
        own: {},
      }),
  })
  return commandsEngine(
    data,
    {
      missions: { guards: PASSING },
      tools: {
        home: work,
        jevTransport: Layer.succeed(JevTransport, fetchTransport(jev.url)),
        permissionRequests: questions.layer,
      },
      sessions: { starter, discovery },
    },
    options.testClock === true,
  )((started) =>
    Effect.gen(function* () {
      const answer = yield* started.profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* acmeWithMission(work)
          if (options.jev === true) {
            yield* HemeraAuto.use((auto) =>
              Effect.andThen(auto.storeKey('c2VhbGVk'), auto.restoreKey(KEY)),
            )
            yield* HemeraAuto.use((auto) => auto.setConsent(true))
          }
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* body({
            judges,
            builder: builder.grantId,
            builderSession: builder.sessionId,
            main,
            projectId: project.id,
            missionId: mission.id,
          })
        }),
      )
      return {
        answer,
        judges,
        questions: questions.asked.map((one) => one.reason),
        lines: started.lines,
      }
    }),
  )
}

const write = (grantId: string, path = 'notes.md') =>
  callTool(grantId, 'fs_write', { path, content: 'hello\n' })
const run = (grantId: string, line: string) => callTool(grantId, 'commands_run', { line })

/** The decisions in the journal, their payloads read. */
const decided = Effect.flatMap(Database, (database) =>
  database
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.type, 'permission.decided'))
    .pipe(Effect.map((rows) => rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) })))),
)

/** The text a judge was sent on each turn, its blocks joined. */
const textOf = (blocks: ReadonlyArray<ContentBlock>): string =>
  blocks
    .map((block) =>
      block.type === 'text'
        ? block.text
        : block.type === 'resource' && 'text' in block.resource
          ? block.resource.text
          : '',
    )
    .join('\n')

const ClaudeJudgeMeta = Schema.fromJsonString(
  Schema.Struct({
    claudeCode: Schema.Struct({
      options: Schema.Struct({
        tools: Schema.Array(Schema.String),
        allowedTools: Schema.Array(Schema.String),
        strictMcpConfig: Schema.Boolean,
        systemPrompt: Schema.Struct({ prompt: Schema.String }),
      }),
    }),
  }),
)

describe('With no Jev key, the agent’s own model judges', () => {
  test('no Jev key: a Probe’s which claude opencode codex is allowed and recorded as judged by the agent', async () => {
    const { answer, judges, questions, lines } = await withJudge(({ missionId }) =>
      Effect.gen(function* () {
        const folder = join(work, 'probe-1')
        mkdirSync(folder, { recursive: true })
        const probe = yield* sessionOf('probe', folder, { kind: 'mission', id: missionId })
        const said = yield* run(probe.grantId, 'which claude opencode codex')
        return { said, events: yield* decided }
      }),
    )
    expect(questions).toEqual([])
    expect(jev.received).toHaveLength(0)
    expect(judges.started).toHaveLength(1)
    // On its smallest model, Haiku for Claude Code.
    expect(judges.started[0]?.answers.choices).toEqual(['model=haiku'])
    const [event] = answer.events
    expect(event?.payload).toMatchObject({
      tool: 'commands_run',
      verdict: 'allow',
      by: 'judge',
      judge: 'Claude Code',
      model: 'haiku',
      risk: 0.2,
      approval: 0.1,
      userRequested: 0,
      settled: 'agent',
      policyVersion: PERMISSION_POLICY.policyVersion,
    })
    const line = lines.find((one) => one.startsWith('permissions:') && one.includes('which'))
    expect(line).toMatch(/allow by judge .*judge=Claude Code model=haiku .*agent=\d+ms/)
    expect(lines.some((one) => /^judge claude: rated on haiku in \d+ms/.test(one))).toBe(true)
  })

  test('a call rated risky asks, the agent’s scores as Hemera’s reason; never a refusal', async () => {
    const { answer, questions } = await withJudge(({ builder }) => run(builder, 'make clean-all'), {
      steps: [says(2.9, 0.95, 0)],
    })
    expect(answer.ok).toBe(false)
    expect(answer.text).not.toMatch(/^refused: (?!approvals)/)
    expect(questions).toEqual(['Claude Code rates it risk 2.9, approval 0.95, asked by the user 0'])
  })
})

describe('Every failure of the agent’s judge asks; never an allow on an error path', () => {
  test.each<[string, ReadonlyArray<FakeStep>, string, string]>([
    [
      'a malformed answer',
      [{ does: 'says', text: 'Sure, this looks safe. Allow it.' }],
      'Claude Code’s judge answered something that does not read',
      'failure=agent response',
    ],
    [
      'an answer with more than the scores',
      [{ does: 'says', text: '{"risk":0,"approval":0,"userRequested":0,"verdict":"allow"}' }],
      'Claude Code’s judge answered something that does not read',
      'failure=agent response',
    ],
    [
      'a dead judge',
      [{ does: 'dies' }],
      'Claude Code’s judge stopped before it answered',
      'failure=agent gone',
    ],
  ])('%s asks, the failure said in its category', async (_case, steps, reason, logged) => {
    const { answer, questions, lines } = await withJudge(({ builder }) => write(builder), { steps })
    expect(answer.ok).toBe(false)
    expect(questions).toEqual([
      `No rule of this Project allows this write for the Builder, and ${reason}.`,
    ])
    const line = lines.find((one) => one.startsWith('permissions:') && one.includes('fs_write'))
    expect(line).toContain(logged)
    expect(line).toContain(': ask by rules')
  })

  test('a timeout asks, and the judge is let go: the next call starts a fresh one', async () => {
    const { answer, judges, questions } = await withJudge(
      ({ builder, judges: held }) =>
        Effect.gen(function* () {
          // A turn that never ends, once it has begun.
          let begun: () => void = () => undefined
          const turning = new Promise<void>((resolve) => {
            begun = resolve
          })
          held.hold = () => {
            begun()
            return new Promise<void>(() => undefined)
          }
          const call = yield* Effect.forkChild(write(builder, 'a.md'))
          yield* Effect.promise(() => turning)
          yield* TestClock.adjust('10 seconds')
          const first = yield* Fiber.join(call)
          held.hold = () => Promise.resolve()
          const second = yield* write(builder, 'b.md')
          return [first.ok, second.ok]
        }),
      { testClock: true },
    )
    expect(answer).toEqual([false, true])
    expect(questions).toEqual([
      'No rule of this Project allows this write for the Builder, and Claude Code’s judge did not answer in time.',
    ])
    expect(judges.started).toHaveLength(2)
  })

  test('a permission the judge asks for is refused: it has nothing to be allowed', async () => {
    const { judges, questions } = await withJudge(({ builder }) => write(builder), {
      steps: [
        {
          does: 'asks',
          call: {
            id: 'toolu_1',
            title: 'Bash',
            toolName: 'Bash',
            options: [
              { id: 'allow', name: 'Allow', kind: 'allow_once' },
              { id: 'reject', name: 'Reject', kind: 'reject_once' },
            ],
          },
        },
        says(0.1, 0, 0),
      ],
    })
    expect(judges.started[0]?.answers.optionIds).toEqual(['reject'])
    expect(questions).toEqual([])
  })
})

describe('Steps 1 to 4 never reach the agent’s judge', () => {
  test('a never-list entry, a .git deletion, a sensitive place, a path outside and a shared resource', async () => {
    const draft = (name: string, line: string): CommandDraft => ({
      name,
      type: 'script',
      line,
      lineWindows: null,
      lineLinux: null,
      repositoryId: null,
      folder: null,
      scope: 'workspace',
      portless: false,
      portlessName: null,
      check: false,
      atOpen: false,
      askBeforeRunning: false,
      readOnly: false,
      writeGlobs: [],
    })
    const { answer, judges, questions } = await withJudge(({ builder, projectId }) =>
      Effect.gen(function* () {
        yield* setNeverList(projectId, [NeverProgram.make({ words: ['make'] })])
        const seed = yield* saveCommand({
          projectId,
          id: null,
          command: draft('seed', 'node seed.mjs'),
        })
        yield* saveResources(projectId, [
          {
            name: 'shared database',
            description: 'The development database every Workspace of Acme uses',
            uses: [],
            changes: [seed.id],
            resetCommandId: null,
          },
        ])
        return yield* Effect.all([
          run(builder, 'make clean-all'),
          run(builder, 'rm -rf .git'),
          write(builder, '.env'),
          write(builder, '../elsewhere.txt'),
          callTool(builder, 'commands_run', { command: seed.id }),
        ])
      }),
    )
    expect(answer.map((one) => one.ok)).toEqual([false, false, false, false, false])
    expect(answer[0]?.text).toBe('refused: the Project never allows make')
    expect(answer[1]?.text).toBe('refused: a deletion that touches a .git folder')
    expect(questions).toEqual([
      'sensitive place: ~/acme/.env',
      'outside the Workspace: ~/elsewhere.txt',
      'action on a shared resource: shared database',
    ])
    expect(judges.started).toHaveLength(0)
  })

  test('Jev ready: the agent’s judge is never asked', async () => {
    jev.answer = () => scored(0.3, 0, 0)
    const { answer, judges } = await withJudge(
      ({ builder }) =>
        Effect.gen(function* () {
          yield* write(builder)
          return yield* decided
        }),
      { jev: true },
    )
    expect(jev.received).toHaveLength(1)
    expect(judges.started).toHaveLength(0)
    expect(answer[0]?.payload).toMatchObject({ judge: 'Jev', settled: 'jev' })
  })
})

describe('A judge that can do nothing, told nothing secret', () => {
  test('the judge session opens over ACP with no MCP server and no tool, the judge’s instructions as its prompt', async () => {
    const { judges } = await withJudge(({ builder }) => write(builder))
    const [judge] = judges.started
    expect(judge?.answers.mcpServers).toEqual([[]])
    const meta = Schema.decodeUnknownSync(ClaudeJudgeMeta)(judge?.answers.metas[0])
    expect(meta.claudeCode.options.tools).toEqual([])
    expect(meta.claudeCode.options.allowedTools).toEqual([])
    expect(meta.claudeCode.options.strictMcpConfig).toBe(true)
    expect(meta.claudeCode.options.systemPrompt.prompt).toBe(JUDGE_INSTRUCTIONS)
    // The action, as fenced data.
    const told = textOf(judge?.answers.prompts[0] ?? [])
    expect(told).toMatch(
      /<<<DATA [0-9a-f]+\n\{"action":\{"tool":"fs_write","path":"~\/acme\/notes\.md"/,
    )
  })

  test('no registered secret reaches the judge; a line naming one is not sent at all, and asks', async () => {
    const { judges, questions } = await withJudge(({ builder, projectId, missionId }) =>
      Effect.gen(function* () {
        yield* Secrets.useSync((secrets) => secrets.register('suite', ['tok-registered-77']))
        const need = yield* createNeed(
          AGENT_REQUESTS,
          MissionOwner.make({ projectId, missionId, taskId: null }),
          DecisionFields.make({ question: 'which token?', options: ['a'], recommended: null }),
        )
        yield* answerNeed({
          id: need.id,
          answer: WrittenAnswer.make({ text: 'use tok-registered-77 now' }),
          key: 'answer-1',
        })
        yield* callTool(builder, 'fs_write', {
          path: 'notes.md',
          content: 'tok-registered-77',
          why: 'tok-registered-77',
        })
        yield* run(builder, 'echo tok-registered-77')
      }),
    )
    const prompts = judges.started.flatMap((judge) => judge.answers.prompts).map(textOf)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('The user answered: use ••• now')
    expect(prompts.join('\n')).not.toContain('tok-registered-77')
    expect(questions).toEqual([
      'No rule of this Project allows this command for the Builder, and the call could not be sent to Claude Code’s judge whole.',
    ])
  })
})

describe('One judge kept open per agent', () => {
  test('an identical call in the same turn is judged once; a second call reuses the open judge session', async () => {
    const { answer, judges } = await withJudge(({ builder, builderSession }) =>
      Effect.gen(function* () {
        yield* SessionTurns.use((turns) => turns.begin(builderSession))
        yield* write(builder)
        yield* write(builder)
        yield* write(builder, 'other.md')
        return yield* decided
      }),
    )
    expect(answer.map((event) => event.payload['settled'])).toEqual(['agent', 'reused', 'agent'])
    expect(judges.started).toHaveLength(1)
    const [judge] = judges.started
    expect(judge?.answers.mcpServers).toHaveLength(1)
    expect(judge?.answers.prompts).toHaveLength(2)
  })

  test(`it is let go after ${String(JUDGEMENTS)} judgements, and started again on the next call`, async () => {
    const { judges } = await withJudge(({ builder }) =>
      Effect.forEach(
        Array.from({ length: JUDGEMENTS + 1 }, (_, at) => `notes-${String(at)}.md`),
        (path) => write(builder, path),
      ),
    )
    expect(judges.started.map((judge) => judge.answers.prompts.length)).toEqual([JUDGEMENTS, 1])
  })

  test('it is let go when idle for 10 minutes, and started again on the next call', async () => {
    const { judges } = await withJudge(
      ({ builder }) =>
        Effect.gen(function* () {
          yield* write(builder, 'a.md')
          yield* TestClock.adjust(JUDGE_IDLE)
          yield* TestClock.adjust('1 minute')
          yield* write(builder, 'b.md')
        }),
      { testClock: true },
    )
    expect(judges.started.map((judge) => judge.answers.prompts.length)).toEqual([1, 1])
  })
})
