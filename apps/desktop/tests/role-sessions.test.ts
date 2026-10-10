/**
 * The role sessions, on the engine as it starts (its database, its gate and MCP server, its
 * Memory), with the fake agent of #32 behind the starter — never a real agent. Each scenario of
 * the ticket's list has its test here: the three layers set once, the Project's layer by bare
 * reading, the brief, the three channels, deliveries across a replacement, CT-12, CT-15, CT-11,
 * the start's order, `stopTree`, and #71's results reaching their session.
 */

import { realpathSync } from 'node:fs'

import { deliveryBlock } from '@hemera/core/domain'

import { Deferred, Effect, Fiber, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import type { FakeScript } from '../src/engine/agents/fake.ts'
import { createMission } from '../src/engine/missions.ts'
import { Delivery } from '../src/engine/permissions/delivery.ts'
import { startRun, stopRun } from '../src/engine/runs.ts'
import { assignWork, holdsWork, leaseOf } from '../src/engine/sessions/leases.ts'
import { SpecLanguage } from '../src/engine/sessions/ports.ts'
import type { RoleEntry } from '../src/engine/sessions/roles.ts'
import { TEST_ROLE } from './test-role.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { threadOf } from '../src/engine/sessions/thread.ts'
import {
  type RoleSession,
  getSession,
  openSession,
  sessionsIn,
} from '../src/engine/sessions/store.ts'
import { Database, DatabaseError } from '../src/engine/storage/database.ts'
import { betweenMutations } from '../src/engine/transaction.ts'
import {
  domainEvents,
  memoryJournal,
  permissionRequests,
  queuedDeliveries,
  sessionDeliveries,
  sessionThreads,
  supervisedProcesses,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/index.ts'
import { STAYS_UP, nodeLine, script } from './commands-engine.ts'
import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'
import {
  BUILDER,
  HELPER,
  REVIEWER,
  SILENCE,
  acmeIn,
  agentsFound,
  held,
  sessionsEngine,
  text,
  until,
  within,
} from './sessions-world.ts'
import { asc, eq, sql } from 'drizzle-orm'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('role-sessions'))
  work = realpathSync.native(temporaryFolder('role-sessions-work'))
})
afterEach(removeFolders)

const engine = (
  scriptOf: (index: number) => FakeScript,
  options: Parameters<typeof sessionsEngine>[2] = {},
) => sessionsEngine(data, scriptOf, options)

const acme = Effect.suspend(() => acmeIn(work))

const opened = (
  owner: { readonly kind: 'mission'; readonly missionId: string },
  main: string,
  role = 'builder',
  provider: 'claude' | 'codex' = 'claude',
  parent?: RoleSession,
) =>
  Sessions.use((sessions) =>
    sessions.open({
      owner,
      role,
      provider,
      folder: main,
      parent,
    }),
  )

const settled = (sessionId: string) => Sessions.use((sessions) => sessions.settled(sessionId))

describe('The three layers are set once, at the session’s start, then the brief', () => {
  test('Claude Code takes them as its system prompt, the Project’s CLAUDE.md among them; the first message is the brief', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'Use the invoices table.',
            }),
          )
          yield* settled(session.id)
        }),
      ),
    )
    const agent = world.agents[0]
    const meta = JSON.parse(agent?.answers.metas[0] ?? '{}')
    const prompt: string = meta.claudeCode.options.systemPrompt.prompt
    expect(prompt).toContain('one session of mission ACME-1, with the role **the Builder**')
    expect(prompt).toContain(TEST_ROLE.template)
    expect(prompt).toContain('## api/CLAUDE.md\n\napi: run pnpm test before saying done.')
    expect(prompt).not.toContain('api: agents read this.')
    const [first, second] = agent?.answers.prompts ?? []
    expect(text(first ?? [])).toMatch(
      /^\[hemera:brief\]\n## Your task\n\nExport the invoices as CSV\./,
    )
    expect(text(first ?? [])).toContain('## Now')
    expect(second).toEqual([{ type: 'text', text: '[hemera:answers]\nUse the invoices table.' }])
    expect(world.agents).toHaveLength(1)
  })

  test('Codex takes them as an embedded resource before its brief, and reads AGENTS.md itself: Hemera sends no file', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main, 'builder', 'codex')
          yield* settled(session.id)
        }),
      ),
    )
    const [resource, brief] = world.agents[0]?.answers.prompts[0] ?? []
    expect(resource).toMatchObject({ type: 'resource', resource: { uri: 'hemera://instructions' } })
    const instructions =
      resource?.type === 'resource' && 'text' in resource.resource ? resource.resource.text : ''
    expect(instructions).toContain('# Hemera base (every role)')
    expect(instructions).not.toContain('api/')
    expect(brief).toMatchObject({ type: 'text' })
    expect(text(brief === undefined ? [] : [brief])).toMatch(/^\[hemera:brief\]/)
  })

  test('a role that does not read the Memory gets no Memory block', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main, 'code-reviewer')
          yield* settled(session.id)
        }),
      ),
    )
    const meta = JSON.parse(world.agents[0]?.answers.metas[0] ?? '{}')
    expect(meta.claudeCode.options.systemPrompt.prompt).not.toContain('## The Memory')
    expect(text(world.agents[0]?.answers.prompts[0] ?? [])).not.toContain('## Now')
  })
  test('instructions that cannot be read fail the start: no agent starts on a bare base', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      sessions: {
        specLanguage: Layer.succeed(SpecLanguage, () =>
          Effect.die(new Error('the Spec language could not be read')),
        ),
      },
    })
    const first = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.map(getSession(session.id), (now) => now.state === 'failed'))
          return yield* getSession(session.id)
        }),
      ),
    )
    expect(first.stateReason).toContain('instructions')
    expect(world.agents).toHaveLength(0)
  })
})

/** A text as a column of masked text keeps it: these hold no secret. */
const secretless = secretsRegistry().mask

/**
 * A script whose first turn waits before its step number `at` until `hold` is released, then goes
 * on; every later turn says done.
 */
const holding = (
  hold: { readonly promise: Promise<void> },
  at: number,
  steps: FakeScript['steps'],
): FakeScript => {
  let seen = 0
  return {
    turns: [steps ?? []],
    steps: [{ does: 'says', text: 'done' }],
    between: () => {
      seen += 1
      return seen === at + 1 ? hold.promise : Promise.resolve()
    },
  }
}

const deliveryRow = (id: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(sessionDeliveries).where(eq(sessionDeliveries.id, id)),
  ).pipe(Effect.map(([row]) => row))

describe('A session is settled once what it has to send is sent and answered', () => {
  test('a session whose brief waits to be sent is not settled: its first turn runs first', async () => {
    const writes = held()
    // Its brief is made as every write starts to wait: the driver is registered with the brief
    // unsent, and the brief cannot be marked sent until the writes go on.
    const holdingWrites: RoleEntry = {
      ...BUILDER,
      brief: () =>
        Effect.gen(function* () {
          const holds = yield* Deferred.make<void>()
          yield* betweenMutations(
            Effect.andThen(
              Deferred.succeed(holds, undefined),
              Effect.promise(() => writes.promise),
            ),
          ).pipe(Effect.forkDetach)
          yield* Deferred.await(holds)
          return [{ label: 'Your task', text: 'Export the invoices as CSV.' }]
        }),
    }
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      roles: [holdingWrites],
    })
    const promptsWhenSettled = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          const settling = yield* settled(session.id).pipe(
            Effect.andThen(Effect.sync(() => world.agents[0]?.answers.prompts.length ?? 0)),
            Effect.forkChild,
          )
          yield* Effect.sleep('300 millis')
          writes.release()
          return yield* Fiber.join(settling)
        }),
      ),
    )
    expect(promptsWhenSettled).toBe(1)
  })
})

describe('Deliveries between turns (channel 1)', () => {
  test('what is queued during a turn arrives as one message at its end, each block under its marker', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0 ? holding(hold, 0, [{ does: 'says', text: 'working' }]) : {},
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const deliver = (kind: string, body: string) =>
            Sessions.use((sessions) =>
              sessions.deliver({ owner, target: { lineage: session.lineage }, kind, body }),
            )
          yield* deliver('answers', 'The invoices table.')
          yield* deliver('result', 'Request #1 was approved.')
          hold.release()
          yield* settled(session.id)
        }),
      ),
    )
    const prompts = world.agents[0]?.answers.prompts ?? []
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toEqual([
      {
        type: 'text',
        text: '[hemera:answers]\nThe invoices table.\n\n[hemera:result]\nRequest #1 was approved.',
      },
    ])
  })

  test('a delivery queued for a session that is replaced reaches its replacement, once', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0 ? holding(hold, 0, [{ does: 'says', text: 'working' }]) : {},
    )
    const [first, successor, row] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const id = yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'The invoices table.',
            }),
          )
          const next = yield* Sessions.use((sessions) => sessions.replace(session.id, 'a test'))
          hold.release()
          if (next === null) return yield* Effect.die(new Error('not replaced'))
          yield* settled(next.id)
          return [session, next, yield* deliveryRow(id)] as const
        }),
      ),
    )
    expect(successor.lineage).toBe(first.lineage)
    expect(row?.sentTo).toBe(successor.id)
    const all = world.agents.flatMap((agent) => agent.answers.prompts.map(text))
    expect(all.filter((one) => one.includes('The invoices table.'))).toHaveLength(1)
    const replacementFirst = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(replacementFirst).toContain('[hemera:resume]\nYou replace a session that stopped at')
    expect(replacementFirst).toContain('[hemera:answers]\nThe invoices table.')
  })
})

describe('An urgent delivery is a note in the next Hemera tool result (channel 2)', () => {
  test('the note is appended once, to the next call’s result', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0
        ? holding(hold, 1, [
            { does: 'says', text: 'listing' },
            { does: 'uses', id: 'call-1', tool: 'fs_list', arguments: { path: '.' } },
            { does: 'uses', id: 'call-2', tool: 'fs_list', arguments: { path: '.' } },
          ])
        : {},
    )
    const [id, row] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const delivered = yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'Stop: the export moved to the web app.',
              urgency: 'urgent',
            }),
          )
          hold.release()
          yield* settled(session.id)
          return [delivered, yield* deliveryRow(delivered)] as const
        }),
      ),
    )
    const answers = world.agents[0]?.answers.toolAnswers ?? []
    expect(answers[0]?.text).toContain(
      `<hemera-note id="${id}">\n[hemera:note]\nStop: the export moved to the web app.\n</hemera-note>`,
    )
    expect(answers[1]?.text).not.toContain('hemera-note')
    expect(row?.state).toBe('sent')
    // Handed once: no later message carries it again.
    expect(world.agents[0]?.answers.prompts).toHaveLength(1)
  })

  test('with no Hemera tool call within the pickup, the turn is cancelled and the delivery sent', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0
        ? holding(hold, 1, [
            { does: 'says', text: 'thinking' },
            { does: 'says', text: 'still' },
          ])
        : {},
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'Use the web app.',
              urgency: 'urgent',
            }),
          )
          // The agent hears the cancel, stops its step and answers its turn cancelled.
          yield* until(Effect.sync(() => world.agents[0]?.answers.cancels === 1))
          hold.release()
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
        }),
      ),
    )
    expect(world.agents[0]?.answers.cancels).toBe(1)
    expect(world.agents[0]?.answers.prompts[1]).toEqual([
      { type: 'text', text: '[hemera:answers]\nUse the web app.' },
    ])
  })
})

describe('A redirect cancels the turn, then sends (channel 3)', () => {
  test('the turn is cancelled at once and the delivery is the next message', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0
        ? holding(hold, 1, [
            { does: 'says', text: 'a' },
            { does: 'says', text: 'b' },
          ])
        : {},
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'cancel',
              body: 'The user cancelled the export: stop.',
              urgency: 'redirect',
            }),
          )
          // The agent hears the cancel, stops its step and answers its turn cancelled.
          yield* until(Effect.sync(() => world.agents[0]?.answers.cancels === 1))
          hold.release()
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
        }),
      ),
    )
    expect(world.agents[0]?.answers.cancels).toBe(1)
    expect(text(world.agents[0]?.answers.prompts[1] ?? [])).toBe(
      '[hemera:cancel]\nThe user cancelled the export: stop.',
    )
  })
})

describe('Silence, waiting and stuck (CT-12)', () => {
  test('a session silent mid-turn past the bound is stuck, then replaced, with one Journal line', async () => {
    const hold = held()
    const { world, run } = engine(
      (index) => (index === 0 ? holding(hold, 0, [{ does: 'says', text: 'never' }]) : {}),
      { timings: SILENCE },
    )
    const [first, lines] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.map(getSession(session.id), (now) => now.state === 'replaced'))
          const database = yield* Database
          yield* until(
            Effect.map(
              database.select().from(memoryJournal).where(eq(memoryJournal.missionId, mission.id)),
              (rows) => rows.some((row) => row.kind === 'session'),
            ),
          )
          const journal = yield* database
            .select()
            .from(memoryJournal)
            .where(eq(memoryJournal.missionId, mission.id))
          // The successor starts its own agent.
          yield* until(Effect.sync(() => world.agents.length === 2))
          return [
            yield* getSession(session.id),
            journal.filter((row) => row.kind === 'session'),
          ] as const
        }),
      ),
    )
    hold.release()
    expect(first.stateReason).toMatch(/^no activity for /)
    expect(lines.map((row) => row.text)).toEqual([
      `The Builder’s session was replaced: ${first.stateReason ?? ''}`,
    ])
    expect(world.agents).toHaveLength(2)
  })

  test('a session whose own command runs, silent, is not stuck', async () => {
    const hold = held()
    const { world, run } = engine(
      (index) =>
        index === 0 ? holding(hold, 0, [{ does: 'says', text: 'waiting on the tests' }]) : {},
      { timings: SILENCE },
    )
    const state = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project, mission } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const started = yield* startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: null,
            line: nodeLine(script(STAYS_UP)),
            folder: null,
            startedBy: 'user',
            sessionId: session.id,
            missionId: mission.id,
          })
          yield* Effect.sleep('1 second')
          const now = (yield* getSession(session.id)).state
          yield* stopRun(started.id)
          hold.release()
          return now
        }),
      ),
    )
    expect(state).toBe('working')
  })

  test('a session whose silent command ran past the bound is not stuck as the command ends', async () => {
    const hold = held()
    const { world, run } = engine(
      (index) =>
        index === 0 ? holding(hold, 0, [{ does: 'says', text: 'waiting on the tests' }]) : {},
      { timings: SILENCE },
    )
    const state = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project, mission } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          const started = yield* startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: null,
            line: nodeLine(script(STAYS_UP)),
            folder: null,
            startedBy: 'user',
            sessionId: session.id,
            missionId: mission.id,
          })
          yield* Effect.sleep('700 millis')
          yield* stopRun(started.id)
          // Swept more than once before the agent reports the command's end.
          yield* Effect.sleep('250 millis')
          const now = (yield* getSession(session.id)).state
          hold.release()
          return now
        }),
      ),
    )
    expect(state).toBe('working')
  })

  test('a session idle between turns, waiting for an answer, is not stuck', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'I wait for request #1.' }] }), {
      timings: SILENCE,
    })
    const state = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* Effect.sleep('1 second')
          return (yield* getSession(session.id)).state
        }),
      ),
    )
    expect(state).toBe('idle')
  })

  test('a provider’s wait keeps a long turn alive', async () => {
    // One wait longer than the stuck bound: the provider's retry outlasts it, then the turn ends.
    let seen = 0
    const pause = () => {
      seen += 1
      return new Promise<void>((resolve) => setTimeout(resolve, seen === 2 ? 1000 : 0))
    }
    const { world, run } = engine(
      () => ({
        between: pause,
        steps: [
          { does: 'waits', title: 'Retrying Claude, attempt 1 of 10.' },
          { does: 'says', text: 'done' },
        ],
      }),
      { timings: SILENCE },
    )
    const state = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          return (yield* getSession(session.id)).state
        }),
      ),
    )
    expect(state).toBe('idle')
    expect(world.agents).toHaveLength(1)
  })
})

describe('Compaction and saturation (CT-15)', () => {
  test('a compaction the agent signals sends the three layers and the brief again', async () => {
    const { world, run } = engine(() => ({
      turns: [[{ does: 'compacts', id: 'compact-1' }]],
      steps: [{ does: 'says', text: 'done' }],
    }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
          yield* settled(session.id)
        }),
      ),
    )
    const again = text(world.agents[0]?.answers.prompts[1] ?? [])
    expect(again).toMatch(/^\[hemera:instructions\]\n# Hemera base \(every role\)/)
    expect(again).toContain(TEST_ROLE.template)
    expect(again).toContain('\n\n[hemera:brief]\n')
  })

  test('the instructions sent again are those it was started with, once its thread is gone', async () => {
    const hold = held()
    const { world, run } = engine((index) =>
      index === 0 ? holding(hold, 0, [{ does: 'compacts', id: 'compact-1' }]) : {},
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          // The diagnostic retention removed its thread while it ran.
          const database = yield* Database
          yield* database.delete(sessionThreads).where(eq(sessionThreads.sessionId, session.id))
          hold.release()
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
          yield* settled(session.id)
        }),
      ),
    )
    const meta = JSON.parse(world.agents[0]?.answers.metas[0] ?? '{}')
    const started: string = meta.claudeCode.options.systemPrompt.prompt
    const again = text(world.agents[0]?.answers.prompts[1] ?? [])
    expect(again.startsWith(`${deliveryBlock('instructions', started)}\n\n[hemera:brief]\n`)).toBe(
      true,
    )
  })

  test('with no such signal, past 80 % of the window the session is replaced', async () => {
    const { world, run } = engine((index) =>
      index === 0 ? { steps: [{ does: 'spends', used: 85_000, size: 100_000 }] } : {},
    )
    const first = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main, 'builder', 'codex')
          yield* until(Effect.map(getSession(session.id), (now) => now.state === 'replaced'))
          // The successor starts its own agent.
          yield* until(Effect.sync(() => world.agents.length === 2))
          return yield* getSession(session.id)
        }),
      ),
    )
    expect(first.stateReason).toBe('its conversation filled most of its window')
    expect(world.agents).toHaveLength(2)
  })
})

describe('A dead agent is replaced', () => {
  test('its session is replaced by a fresh one of its lineage, which resumes', async () => {
    const { world, run } = engine((index) =>
      index === 0 ? { steps: [{ does: 'dies' }] } : { steps: [{ does: 'says', text: 'back' }] },
    )
    const [first, sessions] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* until(Effect.map(getSession(session.id), (now) => now.state === 'replaced'))
          // The successor's agent is handed its first message.
          yield* until(Effect.sync(() => (world.agents[1]?.answers.prompts.length ?? 0) >= 1))
          const live = yield* sessionsIn(['starting', 'working', 'idle'], owner)
          return [yield* getSession(session.id), live] as const
        }),
      ),
    )
    expect(first.stateReason).toBe('its agent stopped')
    expect(sessions.map((one) => [one.lineage, one.epoch])).toEqual([[first.lineage, 1]])
    expect(text(world.agents[1]?.answers.prompts[0] ?? [])).toContain('[hemera:resume]')
  })
})

describe('Leases and epochs (CT-11)', () => {
  test('reassigning a piece of work raises its epoch; the old session’s calls are refused', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [answer, lease, stillHolds] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* assignWork('task-1', session)
          const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
          const grant = yield* ToolAccess.use((access) => access.byToken(token))
          yield* Sessions.use((sessions) => sessions.replace(session.id, 'a test'))
          const refused = yield* callTool(grant?.id ?? '', 'fs_list', { path: '.' })
          return [
            refused,
            yield* leaseOf('task-1'),
            yield* holdsWork('task-1', session.id, 0),
          ] as const
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(lease?.epoch).toBe(1)
    expect(stillHolds).toBe(false)
  })
  test('a replacement whose lease cannot pass is not written: no lease is left on a replaced session', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [lease, holder] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* assignWork('task-1', session)
          const database = yield* Database
          yield* database.run(sql`CREATE TRIGGER refuse_leases BEFORE UPDATE ON runner_leases
            BEGIN SELECT RAISE(ABORT, 'refused'); END`)
          yield* Sessions.use((sessions) => sessions.replace(session.id, 'a test')).pipe(
            Effect.ignore,
          )
          yield* database.run(sql`DROP TRIGGER refuse_leases`)
          const now = yield* leaseOf('task-1')
          return [now, yield* getSession(now?.sessionId ?? '')] as const
        }),
      ),
    )
    expect(lease?.epoch).toBe(0)
    expect(holder.state).not.toBe('replaced')
  })
})

describe('A lineage has one live session at most', () => {
  test('the database refuses a second live session on a lineage, and takes one once the first ended', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [second, third] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const next = {
            provider: session.provider,
            owner,
            role: session.role,
            folder: main,
            parent: null,
            lineage: session.lineage,
            epoch: session.epoch + 1,
          }
          const refused = yield* openSession(next).pipe(Effect.flip)
          yield* Sessions.use((sessions) => sessions.end(session.lineage, 'a test'))
          const taken = yield* openSession(next)
          return [refused, taken] as const
        }),
      ),
    )
    expect(second).toBeInstanceOf(DatabaseError)
    expect(third.epoch).toBe(1)
  })
})

describe('A restart rebuilds the tree top-down, after the orphans are ended (CT-11)', () => {
  test('a Builder and its helper come back as fresh sessions, the helper under the new Builder', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    // A real process a stopped engine left: the registry still names it.
    const orphan = (await import('node:child_process')).spawn(
      process.execPath,
      [script(STAYS_UP)],
      { detached: true, stdio: 'ignore' },
    )
    orphan.unref()
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const builder = yield* opened(owner, main)
          yield* settled(builder.id)
          const helper = yield* opened(owner, main, 'helper', 'claude', builder)
          yield* settled(helper.id)
          yield* assignWork('task-1', builder)
          const database = yield* Database
          yield* database.insert(supervisedProcesses).values({
            id: 'left-1',
            pid: orphan.pid ?? 0,
            program: process.execPath,
            args: JSON.stringify(orphan.spawnargs.slice(1)),
            ownerKind: 'session',
            ownerId: helper.id,
            engine: 'a previous engine',
            startedAt: new Date().toISOString(),
          })
          return { owner, builder, helper }
        }),
      ),
    )
    const after = engine(() => ({ steps: [{ does: 'says', text: 'resumed' }] }))
    const [rebuilt, lease, lines] = await after.run(({ profile, lines: said }) =>
      within(
        profile,
        Effect.gen(function* () {
          // The sessions the stopped engine left are replaced, then their successors settle.
          yield* until(
            Effect.map(
              Effect.forEach([before.builder.id, before.helper.id], (id) => getSession(id)),
              (left) => left.every((one) => one.state === 'replaced'),
            ),
          )
          yield* until(Effect.map(sessionsIn(['idle'], before.owner), (live) => live.length === 2))
          return [
            yield* sessionsIn(['idle'], before.owner),
            yield* leaseOf('task-1'),
            said,
          ] as const
        }),
      ),
    )
    const [builder, helper] = rebuilt
    expect(builder?.lineage).toBe(before.builder.lineage)
    expect(helper?.lineage).toBe(before.helper.lineage)
    expect(helper?.parent).toBe(builder?.lineage)
    expect((builder?.createdAt ?? '') <= (helper?.createdAt ?? '')).toBe(true)
    expect(lease?.sessionId).toBe(builder?.id)
    const orphanLine = lines.findIndex((line) => line.includes('orphan agent process'))
    expect(orphanLine).toBeGreaterThanOrEqual(0)
    expect(() => process.kill(orphan.pid ?? 0, 0)).toThrow()
    expect(after.world.agents.map((agent) => text(agent.answers.prompts[0] ?? []))).toEqual([
      expect.stringContaining('[hemera:resume]'),
      expect.stringContaining('[hemera:resume]'),
    ])
  })
})

describe('Nothing starts before the Memory is ready', () => {
  test('a session opened while the Journal catches up starts once it has', async () => {
    const release = held()
    let holdingProjection = true
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      memory: {
        beforeProjecting: () =>
          holdingProjection ? Effect.promise(() => release.promise) : Effect.void,
      },
    })
    const startedBefore = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const session = yield* opened(owner, main)
          yield* Effect.sleep('300 millis')
          const before = world.agents.length
          holdingProjection = false
          release.release()
          yield* settled(session.id)
          return before
        }),
      ),
    )
    expect(startedBefore).toBe(0)
    expect(world.agents).toHaveLength(1)
  })
})

describe('stopTree', () => {
  test('stops a tree of depth 2 children first, and leaves no process', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      children: true,
    })
    const [stopped, order] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const builder = yield* opened(owner, main)
          yield* settled(builder.id)
          const helper = yield* opened(owner, main, 'helper', 'claude', builder)
          yield* settled(helper.id)
          const deeper = yield* opened(owner, main, 'helper', 'claude', helper)
          yield* settled(deeper.id)
          yield* Sessions.use((sessions) => sessions.stopTree(owner, 'the mission was cancelled'))
          const database = yield* Database
          const events = yield* database
            .select()
            .from(domainEvents)
            .where(eq(domainEvents.type, 'session.stopped'))
            .orderBy(asc(domainEvents.sequence))
          return [
            yield* Effect.forEach([builder, helper, deeper], (one) => getSession(one.id)),
            [events.map((event) => event.entityId), [deeper.id, helper.id, builder.id]],
          ] as const
        }),
      ),
    )
    expect(stopped.map((one) => one.state)).toEqual(['ended', 'ended', 'ended'])
    expect(order[0]).toEqual(order[1])
    expect(world.pids).toHaveLength(3)
    for (const pid of world.pids) expect(() => process.kill(pid, 0)).toThrow()
  })
})

describe('The results of #71 reach their session', () => {
  test('a result handed to the Delivery port reaches the lineage that asked, once', async () => {
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const result = {
            requestId: 'request-1',
            number: 1,
            owner: { kind: 'mission' as const, missionId: mission.id, taskId: null },
            sessionId: session.id,
            text: secretless('Request #1 (commands_run) was approved by the user.'),
          }
          yield* Delivery.use((delivery) => delivery.deliver(result))
          yield* Delivery.use((delivery) => delivery.deliver(result))
          yield* settled(session.id)
        }),
      ),
    )
    const prompts = world.agents[0]?.answers.prompts.map(text) ?? []
    expect(prompts.slice(1)).toEqual([
      '[hemera:approval]\nRequest #1 (commands_run) was approved by the user.',
    ])
  })

  test('what #71 queued before the sessions existed is drained to the session that asked', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, mission, project } = yield* acme
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          const database = yield* Database
          yield* database.insert(permissionRequests).values({
            id: 'request-9',
            ownerKind: 'mission',
            ownerId: mission.id,
            projectId: project.id,
            missionId: mission.id,
            number: 9,
            sessionId: session.id,
            role: 'builder',
            tool: 'commands_run',
            call: '{}',
            guard: '{}',
            identity: '{}',
            described: secretless('pnpm test'),
            hemeraReason: secretless('outside'),
            agentReason: secretless('no reason given'),
            sensitive: false,
            needId: 'need-9',
            state: 'ended',
            createdAt: new Date().toISOString(),
          })
          yield* database.insert(queuedDeliveries).values({
            requestId: 'request-9',
            ownerKind: 'mission',
            ownerId: mission.id,
            taskId: null,
            number: 9,
            text: secretless(
              'Request #9 (commands_run) was refused by the user. Nothing was done.',
            ),
            queuedAt: new Date().toISOString(),
          })
          return { owner, lineage: session.lineage }
        }),
      ),
    )
    const after = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const left = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(Effect.sync(() => after.world.agents.length === 1))
          yield* until(
            Effect.sync(() =>
              (after.world.agents[0]?.answers.prompts ?? []).some((one) =>
                text(one).includes('Request #9'),
              ),
            ),
          )
          const database = yield* Database
          return yield* database.select().from(queuedDeliveries)
        }),
      ),
    )
    expect(before.lineage).toBeTruthy()
    expect(left).toEqual([])
  })
})

describe('The hidden thread', () => {
  test('keeps what a session was sent, what it said and its tools, in order, masked', async () => {
    const { run } = engine(() => ({
      steps: [
        { does: 'uses', id: 'call-1', tool: 'fs_list', arguments: { path: '.' } },
        { does: 'says', text: 'Listed the api folder.' },
      ],
    }))
    const lines = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* Secrets.use((secrets) =>
            Effect.sync(() => secrets.register('suite', ['acme-token-1234'])),
          )
          const session = yield* opened(owner, main)
          yield* settled(session.id)
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { lineage: session.lineage },
              kind: 'answers',
              body: 'The deploy token is acme-token-1234.',
            }),
          )
          yield* settled(session.id)
          return yield* threadOf(session.id)
        }),
      ),
    )
    expect(lines.map((line) => line.kind)).toEqual([
      'sent',
      'instructions',
      'tool',
      'said',
      'sent',
      'tool',
      'said',
    ])
    expect(lines[4]?.text).toBe('[hemera:answers]\nThe deploy token is •••.')
    expect(lines.some((line) => line.text.includes('acme-token-1234'))).toBe(false)
  })
})

describe('deliverOrStart', () => {
  test('opens a session of the role for its own owner, even when another mission runs that role', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [opened2, received] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main, project } = yield* acme
          const builder = yield* opened(owner, main)
          yield* settled(builder.id)
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Archive old invoices', ticket: null },
          })
          const otherOwner = { kind: 'mission' as const, missionId: other.id }
          yield* Sessions.use((sessions) =>
            sessions.deliverOrStart(
              { owner: otherOwner, target: { role: 'builder' }, kind: 'answers', body: 'Start.' },
              { owner: otherOwner, role: 'builder', folder: main },
            ),
          )
          const live = yield* sessionsIn(['starting', 'working', 'idle'], otherOwner)
          for (const one of live) yield* settled(one.id)
          const threads = yield* Effect.forEach(live, (one) => threadOf(one.id))
          return [live.length, threads.flat().some((line) => line.text.includes('Start.'))] as const
        }),
      ),
    )
    expect(opened2).toBe(1)
    expect(received).toBe(true)
  })
})

describe('A session stopped while it starts stays stopped', () => {
  test('stopTree before its start passed the Memory: ended, and no agent starts', async () => {
    const release = held()
    let holdingProjection = true
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      memory: {
        beforeProjecting: () =>
          holdingProjection ? Effect.promise(() => release.promise) : Effect.void,
      },
    })
    const [state, agents] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const stopped = yield* opened(owner, main)
          yield* Sessions.use((sessions) => sessions.stopTree(owner, 'the mission was cancelled'))
          const other = yield* opened(owner, main, 'code-reviewer')
          holdingProjection = false
          release.release()
          yield* settled(other.id)
          yield* settled(stopped.id)
          return [(yield* getSession(stopped.id)).state, world.agents.length] as const
        }),
      ),
    )
    expect(state).toBe('ended')
    expect(agents).toBe(1)
  })
})

describe('A session stopped while its agent starts leaves nothing', () => {
  test('stopTree during the agent’s start: no process left, no turn run', async () => {
    const reached = held()
    const hold = held()
    const { world, run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      children: true,
      starting: () =>
        Effect.andThen(
          Effect.sync(() => reached.release()),
          Effect.promise(() => hold.promise),
        ),
    })
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          yield* opened(owner, main)
          yield* Effect.promise(() => reached.promise)
          yield* Sessions.use((sessions) => sessions.stopTree(owner, 'the mission was cancelled'))
          hold.release()
          yield* until(
            Effect.sync(() => {
              try {
                process.kill(world.pids[0] ?? 0, 0)
                return false
              } catch {
                return true
              }
            }),
          )
        }),
      ),
    )
    expect(world.pids).toHaveLength(1)
    expect(world.agents).toHaveLength(0)
  })
})

describe('deliverOrStart, twice at once', () => {
  test('opens one session of the role, which gets both deliveries', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }))
    const [count, received] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const once = (body: string) =>
            Sessions.use((sessions) =>
              sessions.deliverOrStart(
                { owner, target: { role: 'helper' }, kind: 'answers', body },
                { owner, role: 'helper', folder: main },
              ),
            )
          yield* Effect.all([once('First.'), once('Second.')], { concurrency: 'unbounded' })
          const live = yield* sessionsIn(['starting', 'working', 'idle'], owner)
          for (const one of live) yield* settled(one.id)
          const lines = (yield* Effect.forEach(live, (one) => threadOf(one.id))).flat()
          return [
            live.length,
            ['First.', 'Second.'].every((body) => lines.some((line) => line.text.includes(body))),
          ] as const
        }),
      ),
    )
    expect(count).toBe(1)
    expect(received).toBe(true)
  })
})

describe('A session that fails before its agent took the turn', () => {
  test('gives its deliveries back: the next session of the role gets them', async () => {
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      sessions: { discovery: agentsFound(['codex']) },
    })
    const [stateAfterFailure, received] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const id = yield* Sessions.use((sessions) =>
            sessions.deliverOrStart(
              { owner, target: { role: 'helper' }, kind: 'answers', body: 'Check the totals.' },
              { owner, role: 'helper', provider: 'codex', folder: main },
            ),
          )
          const database = yield* Database
          yield* until(Effect.map(sessionsIn(['failed'], owner), (failed) => failed.length === 1))
          const [row] = yield* database
            .select()
            .from(sessionDeliveries)
            .where(eq(sessionDeliveries.id, id))
          const next = yield* opened(owner, main, 'helper')
          yield* settled(next.id)
          const lines = yield* threadOf(next.id)
          return [
            row?.state,
            lines.some((line) => line.text.includes('Check the totals.')),
          ] as const
        }),
      ),
    )
    expect(stateAfterFailure).toBe('queued')
    expect(received).toBe(true)
  })
})

describe('A session whose start fails', () => {
  test('fails in words, and its parent is told', async () => {
    const BROKEN: RoleEntry = {
      ...HELPER,
      id: 'broken',
      displayName: 'a broken helper',
      brief: () =>
        Effect.fail(new DatabaseError({ doing: 'reading the brief', reason: 'disk I/O error' })),
    }
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      roles: [BUILDER, HELPER, REVIEWER, BROKEN],
    })
    const [child, told] = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const builder = yield* opened(owner, main)
          yield* settled(builder.id)
          const broken = yield* opened(owner, main, 'broken', 'claude', builder)
          yield* until(Effect.map(getSession(broken.id), (one) => one.state === 'failed'))
          yield* settled(builder.id)
          const lines = yield* threadOf(builder.id)
          return [
            yield* getSession(broken.id),
            lines.some((line) => line.text.includes('a broken helper session failed')),
          ] as const
        }),
      ),
    )
    expect(child.stateReason).toContain('disk I/O error')
    expect(told).toBe(true)
  })
})

describe('A restart ends the sessions of a role this version no longer registers', () => {
  test('ended at the rebuild, said why; the others rebuilt', async () => {
    const RETIRED: RoleEntry = { ...HELPER, id: 'retired', displayName: 'a retired role' }
    const { run } = engine(() => ({ steps: [{ does: 'says', text: 'done' }] }), {
      roles: [BUILDER, HELPER, REVIEWER, RETIRED],
    })
    const before = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { owner, main } = yield* acme
          const retired = yield* opened(owner, main, 'retired')
          yield* settled(retired.id)
          const builder = yield* opened(owner, main)
          yield* settled(builder.id)
          return { retired, builder }
        }),
      ),
    )
    const after = engine(() => ({ steps: [{ does: 'says', text: 'resumed' }] }))
    const retired = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(getSession(before.builder.id), (builder) => builder.state === 'replaced'),
          )
          return yield* getSession(before.retired.id)
        }),
      ),
    )
    expect(retired.state).toBe('ended')
    expect(retired.stateReason).toBe('no role retired is registered')
  })
})
