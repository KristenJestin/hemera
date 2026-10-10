/**
 * Hemera Auto through the real gate of a real engine, with a fake Jev on a local socket: Jev as
 * step 5 of the order (it allows or asks, never refuses; every failure asks), the key and the
 * consent it needs, what it is told of the user's intent, the reuse of its verdict within a turn,
 * the parallel calls, the audit of each decision, and who judges in every agent mode.
 */

import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AGENT_PROVIDERS,
  ChosenAnswer,
  DecisionFields,
  MissionOwner,
  PERMISSION_POLICY,
  WrittenAnswer,
} from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import { Effect, Fiber, Layer, Predicate, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { TextBlock, defaultPermissionAnswerLayer } from '../src/engine/agents/client.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { fakeAgent } from '../src/engine/agents/fake.ts'
import { IdleAgents } from '../src/engine/agents/idle.ts'
import { AGENT_MODES } from '../src/engine/agents/modes.ts'
import {
  AgentRuntime,
  AgentStarter,
  SessionInstructions,
  agentRuntimeLayer,
} from '../src/engine/agents/runtime.ts'
import { openAgentSession } from '../src/engine/agents/sessions.ts'
import { acpTracesLayer } from '../src/engine/agents/trace.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
import { AGENT_REQUESTS, answerNeed, createNeed, getNeed } from '../src/engine/needs.ts'
import { HemeraAuto, decisionChanges, whoJudgesFor } from '../src/engine/permissions/hemera-auto.ts'
import { JEV_MODEL, JevTransport, fetchTransport } from '../src/engine/permissions/jev.ts'
import { SessionTurns } from '../src/engine/permissions/ports.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  agentSessions,
  appPreferences,
  domainEvents,
  memoryJournal,
  needs,
} from '../src/engine/storage/schema.ts'
import { type Started, commandsEngine } from './commands-engine.ts'
import { type FakeJev, type Reply, fakeJev, scored } from './fake-jev.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, questionsKept, sessionOf } from './tools-world.ts'

const KEY = 'jev-test-key-0123456789'
const CIPHERTEXT = 'c2VhbGVkIGJ5IHRoZSBzeXN0ZW0='

let data: string
let work: string
let jev: FakeJev

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('hemera-auto'))
  work = realpathSync.native(temporaryFolder('hemera-auto-work'))
  jev = await fakeJev()
})
afterEach(async () => {
  await jev.close()
  removeFolders()
})

interface World {
  readonly builder: string
  readonly builderSession: string
  readonly chat: string
  readonly main: string
  readonly projectId: string
  readonly missionId: string
  readonly started: Started
}

/** A key saved as main saves it: the ciphertext stored, then the key handed over in memory. */
const saveKey = HemeraAuto.use((auto) =>
  Effect.andThen(auto.storeKey(CIPHERTEXT), auto.restoreKey(KEY)),
)
const consent = (given: boolean) => HemeraAuto.use((auto) => auto.setConsent(given))

/**
 * One engine whose home is the work folder and whose Jev is the fake: runs `body` with a Builder
 * of Acme's mission and the Chat, a key saved and consent given unless told otherwise, and answers
 * what it answers with the questions asked and the engine's diagnostic lines.
 */
const withJev = <A, E>(
  body: (world: World) => Effect.Effect<A, E, EngineServices>,
  options: {
    readonly key?: boolean
    readonly consent?: boolean
    readonly realRequests?: boolean
  } = {},
) => {
  const questions = questionsKept()
  const tools = { home: work, jevTransport: Layer.succeed(JevTransport, fetchTransport(jev.url)) }
  return commandsEngine(data, {
    tools:
      options.realRequests === true ? tools : { ...tools, permissionRequests: questions.layer },
  })((started) =>
    Effect.gen(function* () {
      const answer = yield* started.profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* acmeWithMission(work)
          if (options.key !== false) yield* saveKey
          yield* consent(options.consent !== false)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const chat = yield* sessionOf('chat', main, { kind: 'project', id: project.id })
          return yield* body({
            builder: builder.grantId,
            builderSession: builder.sessionId,
            chat: chat.grantId,
            main,
            projectId: project.id,
            missionId: mission.id,
            started,
          })
        }),
      )
      return { answer, questions: questions.asked.map((one) => one.reason), lines: started.lines }
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

const sent = (at = 0) => JSON.parse(jev.received[at]?.body ?? '{}')

describe('Jev is step 5: it allows or asks, and never refuses', () => {
  test('a safe write Jev rates low is allowed, decided by the judge with its model and scores', async () => {
    jev.answer = () => scored(0.4, 0.1, 0)
    const { answer, questions } = await withJev(({ builder }) =>
      Effect.gen(function* () {
        const said = yield* write(builder)
        return { said, events: yield* decided }
      }),
    )
    expect(answer.said.ok).toBe(true)
    expect(questions).toEqual([])
    expect(jev.received).toHaveLength(1)
    expect(sent().state.action).toMatchObject({
      tool: 'fs_write',
      path: '~/acme/notes.md',
      inside: true,
    })
    const [event] = answer.events
    expect(event?.author).toBe('hemera')
    expect(event?.payload).toMatchObject({
      tool: 'fs_write',
      verdict: 'allow',
      by: 'judge',
      judge: 'Jev',
      model: JEV_MODEL,
      risk: 0.4,
      approval: 0.1,
      userRequested: 0,
      settled: 'jev',
      policyVersion: PERMISSION_POLICY.policyVersion,
      level: PERMISSION_POLICY.level,
    })
    expect(event?.payload['latencyMs']).toBeGreaterThanOrEqual(0)
    expect(event?.payload['roundTripMs']).toBeGreaterThanOrEqual(0)
  })

  test('a destructive command asks, with Jev’s scores as Hemera’s reason; never a refusal', async () => {
    jev.answer = () => scored(2.9, 0.95, 0)
    const { answer, questions } = await withJev(({ builder }) => run(builder, 'make clean-all'))
    expect(answer.ok).toBe(false)
    expect(answer.text).not.toMatch(/^refused: (?!approvals)/)
    expect(questions).toEqual(['Jev rates it risk 2.9, approval 0.95, asked by the user 0'])
    expect(sent().state.action).toMatchObject({
      tool: 'commands_run',
      line: 'make clean-all',
      args: ['clean-all'],
      shell: false,
      platform: process.platform,
      cwd: '~/acme',
      inside: true,
    })
  })

  test('a sensitive place, a path outside and a local allow never reach Jev', async () => {
    const { questions } = await withJev(({ builder }) =>
      Effect.gen(function* () {
        writeFileSync(join(work, 'acme', 'README.md'), 'hello')
        yield* callTool(builder, 'fs_read', { path: 'README.md' })
        yield* write(builder, '.env')
        yield* write(builder, '../elsewhere.txt')
        yield* run(builder, 'ls')
      }),
    )
    expect(jev.received).toHaveLength(0)
    expect(questions).toEqual([
      'sensitive place: ~/acme/.env',
      'outside the Workspace: ~/elsewhere.txt',
    ])
  })
})

describe('Every failure of Jev asks; never an allow on an error path', () => {
  test('no key: the call asks, the need links to the Hemera Auto settings, Jev is not called', async () => {
    const { answer } = await withJev(
      ({ builder }) =>
        Effect.gen(function* () {
          yield* write(builder)
          const database = yield* Database
          const rows = yield* database
            .select({ id: needs.id })
            .from(needs)
            .where(eq(needs.kind, 'Permission'))
          return yield* Effect.forEach(rows, (row) => getNeed(row.id))
        }),
      { key: false, realRequests: true },
    )
    expect(jev.received).toHaveLength(0)
    const [need] = answer
    expect(Predicate.isTagged(need?.fields, 'Permission')).toBe(true)
    expect(need?.fields).toMatchObject({
      hemeraReason: 'no judge could rate it: no judge is set up',
      settingsSection: 'hemera-auto',
    })
  })

  test('a key without consent: the call asks and Jev is not called', async () => {
    const { questions } = await withJev(({ builder }) => write(builder), { consent: false })
    expect(jev.received).toHaveLength(0)
    expect(questions).toEqual([
      'no judge could rate it: Hemera Auto waits for consent to send calls to Jev',
    ])
  })

  test('a key Jev rejects (401) asks, makes the key invalid, and is not sent again', async () => {
    jev.answer = () => ({ status: 401, body: '{"error":"bad key"}' })
    const { answer, questions } = await withJev(({ builder }) =>
      Effect.gen(function* () {
        yield* write(builder, 'a.md')
        yield* write(builder, 'b.md')
        return yield* HemeraAuto.use((auto) => auto.state)
      }),
    )
    expect(jev.received).toHaveLength(1)
    expect(answer).toMatchObject({ stored: true, held: true, refused: true, consent: true })
    expect(questions).toEqual([
      'no judge could rate it: Jev refused the saved key',
      'no judge could rate it: Jev refused the saved key',
    ])
  })

  test.each<[string, Reply | 'closed', string, string]>([
    ['too many requests', { status: 429, body: '' }, 'Jev answered HTTP 429', 'failure=http 429'],
    ['a server error', { status: 502, body: 'x' }, 'Jev answered HTTP 502', 'failure=http 502'],
    [
      'an answer that does not read',
      { status: 200, body: '{"model":1}' },
      'Jev’s answer could not be read',
      'failure=response',
    ],
    [
      'another model',
      { status: 200, body: '{"model":"jev-0.1","answers":{}}' },
      'Jev’s answer could not be read',
      'failure=response',
    ],
    ['a network that refuses', 'closed', 'Jev could not be reached', 'failure=network'],
  ])('%s asks, the failure said in its category', async (_case, reply, reason, logged) => {
    if (reply === 'closed') await jev.close()
    else jev.answer = () => reply
    const { questions, lines } = await withJev(({ builder }) => write(builder))
    expect(questions).toEqual([`no judge could rate it: ${reason}`])
    const line = lines.find((one) => one.startsWith('permissions:') && one.includes('fs_write'))
    expect(line).toContain(logged)
    expect(line).toContain(': ask by rules')
  })

  test('an action whose destination holds a registered secret is not sent, and asks', async () => {
    const { questions } = await withJev(({ builder }) =>
      Effect.gen(function* () {
        yield* Secrets.useSync((secrets) => secrets.register('suite', ['notes.md']))
        return yield* write(builder)
      }),
    )
    expect(jev.received).toHaveLength(0)
    expect(questions).toEqual(['no judge could rate it: the call could not be sent to Jev whole'])
  })
})

describe('What Jev is told of the user’s intent', () => {
  test('the user’s answers and the options they chose, never the agent’s question nor its reason', async () => {
    await withJev(({ builder, projectId, missionId }) =>
      Effect.gen(function* () {
        const owner = MissionOwner.make({ projectId, missionId, taskId: null })
        const asked = (question: string, options: ReadonlyArray<string>) =>
          createNeed(
            AGENT_REQUESTS,
            owner,
            DecisionFields.make({ question, options, recommended: null }),
          )
        const one = yield* asked('AGENT QUESTION: which format?', ['CSV', 'JSON'])
        yield* answerNeed({
          id: one.id,
          answer: ChosenAnswer.make({ option: 'CSV' }),
          key: 'answer-1',
        })
        const two = yield* asked('AGENT QUESTION: anything else?', ['no'])
        yield* answerNeed({
          id: two.id,
          answer: WrittenAnswer.make({ text: 'Run the seed script once.' }),
          key: 'answer-2',
        })
        yield* callTool(builder, 'fs_write', {
          path: 'notes.md',
          content: 'FILE CONTENT',
          why: 'AGENT REASON',
        })
      }),
    )
    expect(sent().state.user_context).toEqual([
      'An option the user chose: CSV',
      'The user answered: Run the seed script once.',
    ])
    const body = jev.received[0]?.body ?? ''
    expect(body).not.toContain('AGENT QUESTION')
    expect(body).not.toContain('AGENT REASON')
    expect(body).not.toContain('FILE CONTENT')
  })

  test('a new human input before the call runs judges it again, with what the user said', async () => {
    let answered = false
    const { questions } = await withJev(({ builder, projectId, missionId }) =>
      Effect.gen(function* () {
        const need = yield* createNeed(
          AGENT_REQUESTS,
          MissionOwner.make({ projectId, missionId, taskId: null }),
          DecisionFields.make({ question: 'go on?', options: ['yes'], recommended: null }),
        )
        const services = yield* Effect.context<EngineServices>()
        // While Jev rates the call, the user answers: the verdict seen no longer holds.
        jev.answer = async () => {
          if (!answered) {
            answered = true
            await Effect.runPromise(
              answerNeed({
                id: need.id,
                answer: WrittenAnswer.make({ text: 'Yes, write the notes.' }),
                key: 'answer-3',
              }).pipe(Effect.provide(services)),
            )
          }
          return scored(1.8, 0.2, 0.95)
        }
        return yield* write(builder)
      }),
    )
    expect(jev.received).toHaveLength(2)
    expect(sent(0).state.user_context).toEqual([])
    expect(sent(1).state.user_context).toEqual(['The user answered: Yes, write the notes.'])
    expect(questions).toEqual([])
  })
})

describe('Cost: parallel calls, and a verdict reused within a turn only', () => {
  test('an identical call in the same turn reuses Jev’s verdict; the next turn asks Jev again', async () => {
    jev.answer = () => scored(0.5, 0.1, 0)
    const { answer } = await withJev(({ builder, builderSession }) =>
      Effect.gen(function* () {
        yield* SessionTurns.use((turns) => turns.begin(builderSession))
        yield* write(builder)
        yield* write(builder)
        const inTurn = jev.received.length
        yield* SessionTurns.use((turns) => turns.begin(builderSession))
        yield* write(builder)
        return { inTurn, events: yield* decided }
      }),
    )
    expect(answer.inTurn).toBe(1)
    expect(jev.received).toHaveLength(2)
    expect(answer.events.map((event) => event.payload['settled'])).toEqual(['jev', 'reused', 'jev'])
  })

  test('independent calls of a session are judged in parallel', async () => {
    let waiting = 0
    let most = 0
    jev.answer = async () => {
      waiting += 1
      most = Math.max(most, waiting)
      await new Promise((done) => setTimeout(done, 200))
      waiting -= 1
      return scored(0.2, 0, 0)
    }
    await withJev(({ builder }) =>
      Effect.all([write(builder, 'a.md'), write(builder, 'b.md'), write(builder, 'c.md')], {
        concurrency: 'unbounded',
      }),
    )
    expect(jev.received).toHaveLength(3)
    expect(most).toBe(3)
  })
})

describe('No secret leaves in a request, an event or a log line', () => {
  test('the key and a registered value appear in no body, no event and no line', async () => {
    jev.answer = () => scored(0.3, 0, 0)
    const { answer, lines } = await withJev(({ builder, projectId, missionId }) =>
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
          key: 'answer-4',
        })
        yield* callTool(builder, 'fs_write', {
          path: 'notes.md',
          content: `tok-registered-77 ${KEY}`,
        })
        // A line naming a secret is a destination masking would change: it is not sent at all.
        yield* run(builder, 'echo tok-registered-77')
        return yield* decided
      }),
    )
    expect(jev.received).toHaveLength(1)
    expect(sent().state.user_context).toEqual(['The user answered: use ••• now'])
    for (const received of jev.received) {
      expect(received.body).not.toContain(KEY)
      expect(received.body).not.toContain('tok-registered-77')
    }
    const told = JSON.stringify(answer) + lines.join('\n')
    expect(told).not.toContain(KEY)
    expect(told).not.toContain('tok-registered-77')
    const database = readFileSync(join(data, DATABASE_FILE))
    expect(database.includes(Buffer.from(KEY))).toBe(false)
  })

  test('the diagnostic line says the tool, the target, who decided, the verdict, the policy, the model, the scores and the round trip', async () => {
    jev.answer = () => scored(0.6, 0.2, 0.1)
    const { lines } = await withJev(({ builder }) => write(builder))
    const line = lines.find((one) => one.startsWith('permissions:') && one.includes('fs_write'))
    expect(line).toMatch(
      /fs_write ~\/acme\/notes\.md: allow by judge .*\[policy 1, normal\] judge=Jev model=jev-1\.13\.0 risk=0\.6 approval=0\.2 userRequested=0\.1 jev=\d+ms/,
    )
  })
})

describe('The key and the consent', () => {
  test('only the ciphertext is stored; the key lives in memory and is registered as a secret', async () => {
    const { answer } = await withJev(
      () =>
        Effect.gen(function* () {
          const database = yield* Database
          const rows = yield* database.select().from(appPreferences)
          const state = yield* HemeraAuto.use((auto) => auto.state)
          const masked = yield* Secrets.useSync((secrets) => secrets.mask(`key ${KEY}`))
          yield* HemeraAuto.use((auto) => auto.removeKey)
          const after = yield* HemeraAuto.use((auto) => auto.state)
          const unmasked = yield* Secrets.useSync((secrets) => secrets.mask(`key ${KEY}`))
          return { rows, state, masked, after, unmasked }
        }),
      { consent: false },
    )
    expect(JSON.stringify(answer.rows)).toContain(CIPHERTEXT)
    expect(JSON.stringify(answer.rows)).not.toContain(KEY)
    expect(answer.state).toEqual({ stored: true, held: true, refused: false, consent: false })
    expect(answer.masked).toBe('key •••')
    expect(answer.after).toEqual({ stored: false, held: false, refused: false, consent: false })
    expect(answer.unmasked).toBe(`key ${KEY}`)
  })

  test('a key restored after a restart serves without being saved again', async () => {
    await withJev(() => Effect.void)
    jev.answer = () => scored(0.1, 0, 0)
    const restarted = await commandsEngine(data, {
      tools: { home: work, jevTransport: Layer.succeed(JevTransport, fetchTransport(jev.url)) },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const before = yield* HemeraAuto.use((auto) => auto.state)
          const stored = yield* HemeraAuto.use((auto) => auto.ciphertext)
          yield* HemeraAuto.use((auto) => auto.restoreKey(KEY))
          return { before, stored, after: yield* HemeraAuto.use((auto) => auto.state) }
        }),
      ),
    )
    expect(restarted.before).toEqual({ stored: true, held: false, refused: false, consent: true })
    expect(restarted.stored).toBe(CIPHERTEXT)
    expect(restarted.after.held).toBe(true)
  })
})

describe('Who judges, whatever the agent and its mode', () => {
  test('"Jev" with a key and consent, "Hemera asks" otherwise; never "Auto"', async () => {
    const pairs = AGENT_PROVIDERS.flatMap((agent) =>
      [null, ...AGENT_MODES[agent].map((mode): string | null => mode.id)].map((mode) => ({
        agent,
        mode,
      })),
    )
    const said = (options: { key?: boolean; consent?: boolean }) =>
      withJev(
        () => Effect.forEach(pairs, ({ agent, mode }) => whoJudgesFor(agent, mode)),
        options,
      ).then((seen) => seen.answer)
    expect(new Set(await said({}))).toEqual(new Set(['Jev']))
    for (const options of [{ key: false }, { consent: false }]) {
      // oxlint-disable-next-line no-await-in-loop -- one engine at a time on the data folder
      const answers = await said(options)
      expect(new Set(answers)).toEqual(new Set(['Hemera asks']))
      expect(answers.some((one) => /auto/i.test(one))).toBe(false)
    }
  })

  test('the gate’s verdict is the same in every mode the agent stands on', async () => {
    jev.answer = () => scored(1.9, 0.3, 0)
    const { questions } = await withJev(({ builder, builderSession }) =>
      Effect.gen(function* () {
        const database = yield* Database
        for (const mode of ['default', 'auto', 'bypassPermissions', 'acceptEdits']) {
          yield* database
            .update(agentSessions)
            .set({ chosenMode: mode, takenMode: mode })
            .where(eq(agentSessions.id, builderSession))
          yield* SessionTurns.use((turns) => turns.begin(builderSession))
          yield* write(builder)
        }
      }),
    )
    expect(questions).toEqual(
      Array.from({ length: 4 }, () => 'Jev rates it risk 1.9, approval 0.3, asked by the user 0'),
    )
  })
})

describe('Live decisions for Settings › Developer', () => {
  test('each decision is told on the stream as it is made', async () => {
    jev.answer = () => scored(0.2, 0, 0)
    const { answer } = await withJev(({ builder }) =>
      Effect.gen(function* () {
        const seen = yield* decisionChanges.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        )
        yield* Effect.sleep('50 millis')
        yield* write(builder)
        return yield* Fiber.join(seen)
      }),
    )
    expect([...answer]).toEqual([
      expect.objectContaining({ tool: 'fs_write', verdict: 'allow', by: 'judge', judge: 'Jev' }),
    ])
  })
})

describe('One human question per call: the agent’s own requests are Hemera’s to answer', () => {
  test('in auto mode, a permission request for a Hemera tool is answered allow_once, no need is created, and Hemera’s gate asks the one question', async () => {
    const { answer } = await withJev(
      ({ main, missionId }) =>
        Effect.gen(function* () {
          const session = yield* openAgentSession({
            provider: 'claude',
            ownerKind: 'mission',
            ownerId: missionId,
            role: 'builder',
            folder: main,
          })
          const allow = { id: 'allow', name: 'Allow', kind: 'allow_once' } as const
          const reject = { id: 'reject', name: 'Reject', kind: 'reject_once' } as const
          const agent = fakeAgent({
            steps: [
              { does: 'switches', option: 'mode', value: 'auto', as: 'mode' },
              // What Claude Code sends after its classifier refused three calls in a row.
              {
                does: 'asks',
                call: {
                  id: 'toolu_9',
                  title: 'Write notes.md',
                  toolName: 'mcp__hemera__fs_write',
                  options: [allow, reject],
                },
              },
              {
                does: 'uses',
                id: 'toolu_9',
                tool: 'fs_write',
                arguments: { path: 'notes.md', content: 'hello\n' },
              },
            ],
          })
          const world = Layer.mergeAll(
            Layer.succeed(AgentStarter, { start: () => Effect.succeed(agent.process) }),
            Layer.succeed(Discovery, {
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
            }),
            Layer.succeed(IdleAgents, {
              hold: () => Effect.void,
              touch: () => Effect.void,
              drop: () => Effect.void,
            }),
            acpTracesLayer(data),
            defaultPermissionAnswerLayer,
            Layer.succeed(SessionInstructions, { of: () => Effect.succeed('# Instructions') }),
          )
          yield* AgentRuntime.use((runtime) =>
            runtime.prompt(session.id, [TextBlock.make({ text: 'write the notes' })]),
          ).pipe(
            Effect.provide(agentRuntimeLayer({ dataFolder: data, log: () => {} })),
            Effect.provide(world),
          )
          const database = yield* Database
          const created = yield* database.select({ kind: needs.kind }).from(needs)
          return { chosen: agent.answers.optionIds, created }
        }),
      { key: false, realRequests: true },
    )
    expect(answer.chosen).toEqual(['allow'])
    // The only need is Hemera's own question, from its gate, for the call itself.
    expect(answer.created).toEqual([{ kind: 'Permission' }])
  })
})

describe('Hemera Auto’s verdicts are lines of the mission’s Journal', () => {
  test('who judged and how, allowed or asked, with the model and scores, masked', async () => {
    jev.answer = (request) =>
      request.body.includes('fs_write') ? scored(0.4, 0.1, 0) : scored(2.7, 0.9, 0)
    const { answer } = await withJev(({ builder, missionId }) =>
      Effect.gen(function* () {
        yield* Secrets.useSync((secrets) => secrets.register('suite', ['tok-registered-77']))
        yield* callTool(builder, 'fs_write', {
          path: 'notes.md',
          content: 'x',
          why: 'tok-registered-77',
        })
        yield* run(builder, 'make clean-all')
        yield* Memory.use((memory) => memory.catchUp)
        const database = yield* Database
        return yield* database
          .select()
          .from(memoryJournal)
          .where(eq(memoryJournal.missionId, missionId))
          .orderBy(asc(memoryJournal.sequence))
      }),
    )
    const lines = answer.filter((row) => row.kind === 'permission')
    expect(lines.map((row) => row.text)).toEqual([
      'Allowed fs_write ~/acme/notes.md by Jev: Jev rates it risk 0.4, approval 0.1, asked by the user 0',
      'Asked the user about commands_run make clean-all by Jev: Jev rates it risk 2.7, approval 0.9, asked by the user 0',
    ])
    expect(JSON.parse(lines[0]?.fields ?? '{}')).toMatchObject({
      verdict: 'allow',
      by: 'judge',
      judge: 'Jev',
      model: JEV_MODEL,
      risk: 0.4,
      approval: 0.1,
      userRequested: 0,
      settled: 'jev',
    })
    const all = answer.map((row) => `${row.text} ${row.fields}`).join('\n')
    expect(all).not.toContain('tok-registered-77')
    expect(all).not.toContain(KEY)
  })

  test('a call Jev could not rate is asked by Hemera’s rules, the failure said', async () => {
    jev.answer = () => ({ status: 503, body: '' })
    const { answer } = await withJev(({ builder, missionId }) =>
      Effect.gen(function* () {
        yield* write(builder)
        yield* Memory.use((memory) => memory.catchUp)
        const database = yield* Database
        return yield* database
          .select()
          .from(memoryJournal)
          .where(eq(memoryJournal.missionId, missionId))
      }),
    )
    const [line] = answer.filter((row) => row.kind === 'permission')
    expect(line?.text).toBe(
      "Asked the user about fs_write ~/acme/notes.md by Hemera's rules: no judge could rate it: Jev answered HTTP 503",
    )
    expect(JSON.parse(line?.fields ?? '{}')).toMatchObject({ failure: 'http 503', judge: null })
  })
})
