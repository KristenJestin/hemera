/**
 * Approvals that never block the agent (#37): a call that asks is answered at once with "waiting
 * for the user's approval, request #n", the request and its permission need are stored together,
 * and the user's answer is acted on by Hemera itself, after checking that the situation did not
 * change (CT-10); its result is handed over exactly once. "Allow for this mission" grants the same
 * action (CT-19) to every role of the mission, until it is revoked or its identity moves.
 *
 * The engine is the real one, with its real gate, order of decision and runs; no judge is set
 * up, so whatever the local rules do not allow asks. Its data folder and Acme's main checkout are
 * temporary folders, and the home folder of the order is the work folder.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { NeverProgram, PermissionAnswer, type PermissionChoice } from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { asc, eq } from 'drizzle-orm'
import { Effect, Layer, Predicate, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { TextBlock, defaultPermissionAnswerLayer } from '../src/engine/agents/client.ts'
import { Discovery } from '../src/engine/agents/discovery.ts'
import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { type FakeStep, fakeAgent } from '../src/engine/agents/fake.ts'
import { IdleAgents } from '../src/engine/agents/idle.ts'
import {
  AgentRuntime,
  AgentStarter,
  SessionInstructions,
  agentRuntimeLayer,
} from '../src/engine/agents/runtime.ts'
import { openAgentSession } from '../src/engine/agents/sessions.ts'
import { acpTracesLayer } from '../src/engine/agents/trace.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { moveMission } from '../src/engine/missions.ts'
import { answerNeed, getNeed } from '../src/engine/needs.ts'
import { Delivery, type HandedResult } from '../src/engine/permissions/delivery.ts'
import { listGrants, revokeGrant } from '../src/engine/permissions/grants.ts'
import { setNeverList } from '../src/engine/permissions/never-list.ts'
import { RESTORED_REQUESTS, TaskStates } from '../src/engine/permissions/requests.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { startRun } from '../src/engine/runs.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  permissionRequests,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { ToolAccess } from '../src/engine/tools/index.ts'
import { type Started, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('approvals'))
  work = realpathSync.native(temporaryFolder('approvals-work'))
})
afterEach(removeFolders)

type Parts = NonNullable<Parameters<typeof commandsEngine>[1]>

/** One opening of the engine on the suite's data folder, its home the work folder. */
const engine = (parts: Parts = {}) =>
  commandsEngine(data, { ...parts, tools: { home: work, ...parts.tools } })

/** Acme, its mission, and the ids a later opening finds them by. */
interface Acme {
  readonly projectId: string
  readonly missionId: string
  readonly main: string
  readonly builder: { readonly sessionId: string; readonly grantId: string }
}

const acme = Effect.gen(function* () {
  const { project, mission, main } = yield* acmeWithMission(work)
  const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
  return { projectId: project.id, missionId: mission.id, main, builder } satisfies Acme
})

/** A session opened by an earlier engine, its token minted again by this one. */
const grantAgain = (sessionId: string) =>
  Effect.gen(function* () {
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(sessionId))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return grant.id
  })

const inEngine =
  <A, E>(body: Effect.Effect<A, E, EngineServices>) =>
  ({ profile }: Started) =>
    profile.use(body)

const requests = Effect.flatMap(Database, (database) =>
  database.select().from(permissionRequests).orderBy(asc(permissionRequests.number)),
)

const requestNamed = (id: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(permissionRequests).where(eq(permissionRequests.id, id)),
  ).pipe(Effect.map(([row]) => row))

/** Waits until a request has its result and has been handed over. */
const handedOver = (id: string) =>
  until(requestNamed(id), (row) => row?.state === 'ended' && row.handedOverAt !== null)

const theOnlyRequest = Effect.flatMap(requests, ([row]) =>
  row === undefined ? Effect.die(new Error('no request')) : Effect.succeed(row),
)

const answer = (needId: string, choice: PermissionChoice) =>
  answerNeed({ id: needId, answer: PermissionAnswer.make({ choice }), key: crypto.randomUUID() })

const readPayload = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
)

/** The events of a type, their payload read. */
const eventsOf = (type: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(domainEvents).where(eq(domainEvents.type, type)),
  ).pipe(Effect.map((rows) => rows.map((row) => ({ ...row, payload: readPayload(row.payload) }))))

/** The results handed over: deliveries to the session that asked (#40). */
const queued = Effect.flatMap(Database, (database) => database.select().from(sessionDeliveries))

const draft = (name: string, line: string, more: Partial<CommandDraft> = {}): CommandDraft => ({
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
  ...more,
})

/** A script that appends one line to the file it is given: its effect is counted. */
const APPENDS = `
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], 'ran\\n')
`

const linesIn = (file: string): number =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0

const WAITING = /^Waiting for the user's approval, request #(\d+)\. This action has not happened/

describe('A call that asks is answered at once, and waits for nobody', () => {
  test('the agent reads the waiting text with its number; nothing runs; the request and its need are stored', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          const began = performance.now()
          const first = yield* callTool(world.builder.grantId, 'commands_run', {
            line: nodeLine(appender, out),
            why: 'seed the notes',
          })
          const took = performance.now() - began
          const second = yield* callTool(world.builder.grantId, 'fs_write', {
            path: '../elsewhere.txt',
            content: 'x',
          })
          const rows = yield* requests
          const need = yield* getNeed(rows[0]?.needId ?? '')
          return { first, second, took, rows, need }
        }),
      ),
    )
    expect(seen.first.text).toMatch(WAITING)
    expect(seen.first.text).toContain('request #1.')
    expect(seen.second.text).toContain('request #2.')
    // No grace, no timer: the answer does not wait for the user.
    expect(seen.took).toBeLessThan(5000)
    expect(linesIn(out)).toBe(0)
    expect(existsSync(join(work, 'elsewhere.txt'))).toBe(false)
    expect(seen.rows.map((row) => [row.number, row.state, row.tool])).toEqual([
      [1, 'pending', 'commands_run'],
      [2, 'pending', 'fs_write'],
    ])
    expect(seen.need.state).toBe('pending')
    expect(Predicate.isTagged(seen.need.owner, 'Mission')).toBe(true)
    expect(Predicate.isTagged(seen.need.fields, 'Permission')).toBe(true)
    expect(seen.need.fields).toMatchObject({ agentReason: 'seed the notes', sensitive: false })
    expect(seen.need.choices).toEqual(['allow-once', 'allow-for-mission', 'deny'])
  })

  test("the Chat's request belongs to the Project, numbered there, with Allow once and Deny only", async () => {
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          const chat = yield* sessionOf('chat', world.main, {
            kind: 'project',
            id: world.projectId,
          })
          const said = yield* callTool(chat.grantId, 'fs_write', { path: 'notes.md', content: 'x' })
          const [row] = yield* requests
          return { said, row, need: yield* getNeed(row?.needId ?? '') }
        }),
      ),
    )
    expect(seen.said.text).toContain('request #1.')
    expect(seen.row).toMatchObject({ ownerKind: 'project', missionId: null })
    expect(Predicate.isTagged(seen.need.owner, 'Project')).toBe(true)
    expect(seen.need.choices).toEqual(['allow-once', 'deny'])
  })
})

describe('The same idempotency key gives the same request', () => {
  test('two calls under one key, from two sessions of the mission, make one request and one need', async () => {
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          const again = yield* sessionOf('builder', world.main, {
            kind: 'mission',
            id: world.missionId,
          })
          const args = { path: '../elsewhere.txt', content: 'x' }
          const first = yield* callTool(world.builder.grantId, 'fs_write', args, 'toolu_1')
          const second = yield* callTool(again.grantId, 'fs_write', args, 'toolu_1')
          const other = yield* callTool(again.grantId, 'fs_write', args, 'toolu_2')
          const needs = yield* eventsOf('need.created')
          return { first, second, other, rows: yield* requests, needs }
        }),
      ),
    )
    expect(seen.first.text).toBe(seen.second.text)
    expect(seen.other.text).toContain('request #2.')
    expect(seen.rows).toHaveLength(2)
    expect(seen.needs).toHaveLength(2)
  })
})

describe('A pending request survives a restart, and nothing runs before the answer', () => {
  test('closed and reopened, the request and its need are pending; Allow once runs it once', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const world = await engine()(
      inEngine(
        Effect.gen(function* () {
          const made = yield* acme
          yield* callTool(made.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          return made
        }),
      ),
    )
    const after = await engine()(
      inEngine(
        Effect.gen(function* () {
          const row = yield* theOnlyRequest
          const need = yield* getNeed(row.needId)
          const ranBefore = linesIn(out)
          yield* answer(row.needId, 'allow-once')
          const ended = yield* handedOver(row.id)
          return { row, need, ranBefore, ended, results: yield* eventsOf('permission.result') }
        }),
      ),
    )
    expect(world.missionId).toBe(after.row.missionId)
    expect(after.row.state).toBe('pending')
    expect(after.need.state).toBe('pending')
    expect(after.ranBefore).toBe(0)
    expect(after.ended).toMatchObject({ state: 'ended', result: 'done' })
    expect(linesIn(out)).toBe(1)
    expect(after.results).toHaveLength(1)
    expect(after.results[0]).toMatchObject({ entityKind: 'mission', entityId: world.missionId })
  })
})

describe('Allow once runs the call once through the executor; Deny runs nothing', () => {
  test('Allow once: one run, its result recorded and handed over; a second answer changes nothing', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'allow-once')
          const ended = yield* handedOver(row.id)
          yield* answer(row.needId, 'allow-once')
          yield* Effect.sleep('200 millis')
          const decided = (yield* eventsOf('permission.decided')).filter(
            (event) => event.payload['by'] === 'user',
          )
          return { ended, queued: yield* queued, decided }
        }),
      ),
    )
    expect(linesIn(out)).toBe(1)
    expect(seen.ended?.resultText).toContain(
      'Request #1 (commands_run) was approved by the user, and Hemera has now done it.',
    )
    expect(seen.queued).toHaveLength(1)
    expect(seen.queued[0]?.kind).toBe('approval')
    expect(seen.queued[0]?.body).toBe(seen.ended?.resultText)
    expect(seen.decided).toHaveLength(1)
    expect(seen.decided[0]?.payload).toMatchObject({ by: 'user', choice: 'allow-once' })
  })

  test('Deny: nothing runs, the result says the user refused', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const ended = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'deny')
          return yield* handedOver(row.id)
        }),
      ),
    )
    expect(linesIn(out)).toBe(0)
    expect(ended).toMatchObject({ result: 'refused' })
    expect(ended?.resultText).toBe(
      'Request #1 (commands_run) was refused by the user. Nothing was done.',
    )
  })
})

describe('CT-10: an approval is checked again when Hemera acts on it', () => {
  /** Asks, changes the world, allows, and answers what came of it. */
  const changedThenAllowed = (
    ask: (world: Acme) => Effect.Effect<unknown, unknown, EngineServices>,
    change: (world: Acme) => Effect.Effect<unknown, unknown, EngineServices>,
    parts: Parts = {},
  ) =>
    engine(parts)(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* ask(world)
          const row = yield* theOnlyRequest
          yield* change(world)
          yield* answer(row.needId, 'allow-once')
          const ended = yield* handedOver(row.id)
          return { ended, need: yield* getNeed(row.needId) }
        }),
      ),
    )

  const fellBecauseChanged = (seen: Awaited<ReturnType<typeof changedThenAllowed>>) => {
    expect(seen.ended).toMatchObject({ result: 'not-executed' })
    expect(seen.ended?.resultText).toContain(
      'was not executed: the situation changed since it was allowed',
    )
    expect(seen.need.state).toBe('expired')
    expect(seen.need.endedReason).toBe('the situation changed since you allowed it')
  }

  test('a path whose link changed', async () => {
    const first = join(work, 'first')
    const second = join(work, 'second')
    mkdirSync(first)
    mkdirSync(second)
    const seen = await changedThenAllowed(
      (world) =>
        Effect.gen(function* () {
          symlinkSync(first, join(world.main, 'out'), 'junction')
          return yield* callTool(world.builder.grantId, 'fs_write', {
            path: 'out/notes.md',
            content: 'x',
          })
        }),
      (world) =>
        Effect.sync(() => {
          rmSync(join(world.main, 'out'))
          symlinkSync(second, join(world.main, 'out'), 'junction')
        }),
    )
    fellBecauseChanged(seen)
    expect(existsSync(join(first, 'notes.md'))).toBe(false)
    expect(existsSync(join(second, 'notes.md'))).toBe(false)
  })

  test('a command added to the "never" list', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await changedThenAllowed(
      (world) => callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) }),
      (world) => setNeverList(world.projectId, [NeverProgram.make({ words: [process.execPath] })]),
    )
    fellBecauseChanged(seen)
    expect(linesIn(out)).toBe(0)
  })

  test('a file whose fingerprint changed since the request', async () => {
    const seen = await changedThenAllowed(
      (world) =>
        Effect.gen(function* () {
          writeFileSync(join(world.main, 'notes.md'), 'first\n')
          yield* callTool(world.builder.grantId, 'fs_read', { path: 'notes.md' })
          return yield* callTool(world.builder.grantId, 'fs_write', {
            path: 'notes.md',
            content: 'from the agent\n',
          })
        }),
      (world) => Effect.sync(() => appendFileSync(join(world.main, 'notes.md'), 'someone else\n')),
    )
    fellBecauseChanged(seen)
    expect(readFileSync(join(work, 'acme', 'notes.md'), 'utf8')).toBe('first\nsomeone else\n')
  })

  test('a task that ended', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    let ended = false
    const seen = await changedThenAllowed(
      (world) => callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) }),
      () =>
        Effect.sync(() => {
          ended = true
        }),
      {
        tools: {
          taskStates: Layer.succeed(TaskStates, { holds: () => Effect.sync(() => !ended) }),
        },
      },
    )
    fellBecauseChanged(seen)
    expect(linesIn(out)).toBe(0)
  })

  test('a cancelled mission expires its requests: nothing runs, a late answer changes nothing', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          const row = yield* theOnlyRequest
          yield* moveMission(world.missionId, 'cancel', 'user')
          const ended = yield* until(requestNamed(row.id), (now) => now?.state === 'ended')
          const late = yield* answer(row.needId, 'allow-once')
          yield* Effect.sleep('200 millis')
          return { ended, late, after: yield* requestNamed(row.id) }
        }),
      ),
    )
    expect(seen.ended).toMatchObject({ result: 'not-executed' })
    expect(seen.late.state).toBe('expired')
    expect(seen.after).toEqual(seen.ended)
    expect(linesIn(out)).toBe(0)
  })
})

describe('Allow for this mission is offered only where it may be', () => {
  test('absent on a sensitive place, present on an "ask before running" catalogue command', async () => {
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          writeFileSync(join(world.main, '.env'), 'TOKEN=x')
          const seed = yield* saveCommand({
            projectId: world.projectId,
            id: null,
            command: draft('seed', nodeLine(script(APPENDS), join(work, 'seed.txt')), {
              askBeforeRunning: true,
            }),
          })
          yield* callTool(world.builder.grantId, 'fs_read', { path: '.env' })
          yield* callTool(world.builder.grantId, 'commands_run', { command: seed.id })
          const rows = yield* requests
          return yield* Effect.forEach(rows, (row) => getNeed(row.needId))
        }),
      ),
    )
    expect(seen.map((need) => need.choices)).toEqual([
      ['allow-once', 'deny'],
      ['allow-once', 'allow-for-mission', 'deny'],
    ])
  })
})

describe('A grant allows the same action, for every role, and nothing else', () => {
  test('another session runs it without asking; --update asks; a changed script asks; a revoked grant no longer applies', async () => {
    const out = join(work, 'out.txt')
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          mkdirSync(join(world.main, 'scripts'))
          writeFileSync(join(world.main, 'scripts', 'seed.mjs'), APPENDS)
          const line = (...more: ReadonlyArray<string>) =>
            [`"${process.execPath}"`, 'scripts/seed.mjs', `"${out}"`, ...more].join(' ')
          yield* callTool(world.builder.grantId, 'commands_run', { line: line() })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'allow-for-mission')
          yield* handedOver(row.id)

          const helper = yield* sessionOf('helper', world.main, {
            kind: 'mission',
            id: world.missionId,
          })
          const byHelper = yield* callTool(helper.grantId, 'commands_run', { line: line() })
          const updated = yield* callTool(helper.grantId, 'commands_run', {
            line: line('--update'),
          })
          const [grant] = yield* listGrants(world.missionId)

          appendFileSync(join(world.main, 'scripts', 'seed.mjs'), '// changed\n')
          const changed = yield* callTool(world.builder.grantId, 'commands_run', { line: line() })
          const afterChange = yield* listGrants(world.missionId)
          return { byHelper, updated, grant, changed, afterChange }
        }),
      ),
    )
    expect(seen.byHelper.ok).toBe(true)
    expect(seen.byHelper.text).not.toMatch(WAITING)
    expect(seen.updated.text).toMatch(WAITING)
    expect(seen.grant).toMatchObject({ state: 'live', uses: 1, givenBy: 'user' })
    expect(seen.grant?.action).toContain('scripts/seed.mjs')
    expect(seen.changed.text).toMatch(WAITING)
    expect(seen.afterChange[0]).toMatchObject({ state: 'fallen', reason: 'the script changed' })
    // The first run, allowed by the user, then the helper's under the grant.
    expect(linesIn(out)).toBe(2)
  })

  test('a revoked grant no longer applies from the next call, with a line in the Journal', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          const line = nodeLine(appender, out)
          yield* callTool(world.builder.grantId, 'commands_run', { line })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'allow-for-mission')
          yield* handedOver(row.id)
          const allowed = yield* callTool(world.builder.grantId, 'commands_run', { line })
          const [grant] = yield* listGrants(world.missionId)
          yield* revokeGrant(grant?.id ?? '')
          const asked = yield* callTool(world.builder.grantId, 'commands_run', { line })
          const byGrant = (yield* eventsOf('permission.decided')).filter(
            (event) => event.payload['by'] === 'grant',
          )
          return { allowed, asked, byGrant, revoked: yield* eventsOf('permission.revoked'), grant }
        }),
      ),
    )
    expect(seen.allowed.ok).toBe(true)
    expect(seen.asked.text).toMatch(WAITING)
    expect(seen.byGrant).toHaveLength(1)
    expect(seen.byGrant[0]?.payload).toMatchObject({ grantId: seen.grant?.id })
    expect(seen.revoked).toHaveLength(1)
    expect(linesIn(out)).toBe(2)
  })

  test('Hemera\'s own run of an "ask before running" command in a mission takes Allow for this mission', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const seen = await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          const seed = yield* saveCommand({
            projectId: world.projectId,
            id: null,
            command: draft('seed', nodeLine(appender, out), { askBeforeRunning: true }),
          })
          const run = () =>
            startRun({
              projectId: world.projectId,
              workspaceId: null,
              commandId: seed.id,
              line: null,
              folder: null,
              startedBy: 'hemera',
              sessionId: null,
              missionId: world.missionId,
            })
          yield* run()
          const asked = yield* until(eventsOf('need.created'), (events) => events.length === 1)
          const needId = asked[0]?.entityId ?? ''
          const need = yield* getNeed(needId)
          yield* answer(needId, 'allow-for-mission')
          yield* until(
            Effect.sync(() => linesIn(out)),
            (lines) => lines === 1,
          )
          yield* run()
          yield* until(
            Effect.sync(() => linesIn(out)),
            (lines) => lines === 2,
          )
          // The agent's call of the same command is the same action: allowed by the grant too.
          const byAgent = yield* callTool(world.builder.grantId, 'commands_run', {
            command: seed.id,
          })
          return {
            need,
            needs: yield* eventsOf('need.created'),
            grants: yield* listGrants(world.missionId),
            byAgent,
          }
        }),
      ),
    )
    expect(seen.need.choices).toEqual(['allow-once', 'allow-for-mission', 'deny'])
    expect(seen.needs).toHaveLength(1)
    expect(seen.grants).toHaveLength(1)
    expect(seen.grants[0]).toMatchObject({ uses: 2 })
    expect(seen.byAgent.ok).toBe(true)
    expect(linesIn(out)).toBe(3)
  })
})

describe('The result is handed to the Delivery port exactly once', () => {
  test('even after a restart between the run and the hand-over', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const handed: HandedResult[] = []
    const refusing = Layer.succeed(Delivery, {
      deliver: () => Effect.die(new Error('the session is not there')),
    })
    const keeping = Layer.succeed(Delivery, {
      deliver: (result) =>
        Effect.sync(() => {
          handed.push(result)
        }),
    })
    const id = await engine({ tools: { delivery: refusing } })(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'allow-once')
          yield* until(requestNamed(row.id), (now) => now?.state === 'ended')
          yield* Effect.sleep('200 millis')
          return row.id
        }),
      ),
    )
    expect(linesIn(out)).toBe(1)
    expect(handed).toEqual([])
    // Opened twice more: handed over at the first, not again at the second.
    const reopened = () =>
      engine({ tools: { delivery: keeping } })(
        inEngine(until(requestNamed(id), (row) => row?.handedOverAt !== null)),
      )
    await reopened()
    await reopened()
    expect(handed).toHaveLength(1)
    expect(handed[0]).toMatchObject({ requestId: id, number: 1 })
    expect(linesIn(out)).toBe(1)
  })
})

describe('After a restore, the pending requests expire', () => {
  test('every pending request of the restored Profile expires "restored from a backup", and nothing runs', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    await engine()(
      inEngine(
        Effect.gen(function* () {
          const world = yield* acme
          yield* callTool(world.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
        }),
      ),
    )
    const backups = temporaryFolder('approvals-backups')
    const backup = await engine()(({ profile }) => profile.calls.backup(backups))
    await engine()(({ profile }) => profile.calls.restore(backup))
    const seen = await engine({ reconciliationSteps: [RESTORED_REQUESTS] })(({ profile }) =>
      Effect.andThen(
        profile.gate,
        profile.use(
          Effect.gen(function* () {
            const row = yield* theOnlyRequest
            return { row, need: yield* getNeed(row.needId) }
          }),
        ),
      ),
    )
    expect(seen.row).toMatchObject({ state: 'ended', result: 'not-executed' })
    expect(seen.row.resultText).toContain('restored from a backup')
    expect(seen.need).toMatchObject({ state: 'expired', endedReason: 'restored from a backup' })
    expect(linesIn(out)).toBe(0)
  })
})

describe('Grants are listed with who gave them, when, and how often they were used', () => {
  test('a mission with no grant lists none', async () => {
    const grants = await engine()(
      inEngine(Effect.flatMap(acme, (world) => listGrants(world.missionId))),
    )
    expect(grants).toEqual([])
  })

  test('a new session of an earlier engine is minted again and its grant still applies', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const world = await engine()(
      inEngine(
        Effect.gen(function* () {
          const made = yield* acme
          yield* callTool(made.builder.grantId, 'commands_run', { line: nodeLine(appender, out) })
          const row = yield* theOnlyRequest
          yield* answer(row.needId, 'allow-for-mission')
          yield* handedOver(row.id)
          return made
        }),
      ),
    )
    const again = await engine()(
      inEngine(
        Effect.gen(function* () {
          const grantId = yield* grantAgain(world.builder.sessionId)
          return yield* callTool(grantId, 'commands_run', { line: nodeLine(appender, out) })
        }),
      ),
    )
    expect(again.ok).toBe(true)
    expect(linesIn(out)).toBe(2)
  })
})

describe('An agent over real MCP is never held by a question', () => {
  /** Runs one turn of the fake agent on a session, over Hemera's real MCP server. */
  const turn = (sessionId: string, steps: ReadonlyArray<FakeStep>) =>
    Effect.gen(function* () {
      const agent = fakeAgent({ steps: [...steps] })
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
        Layer.succeed(SessionInstructions, {
          of: () => Effect.succeed('# Instructions'),
          renewed: () => Effect.succeed('# Instructions'),
        }),
      )
      const began = performance.now()
      yield* AgentRuntime.use((runtime) =>
        runtime.prompt(sessionId, [TextBlock.make({ text: 'seed the notes' })]),
      ).pipe(
        Effect.provide(agentRuntimeLayer({ dataFolder: data, log: () => {} })),
        Effect.provide(world),
      )
      return { answers: agent.answers.toolAnswers, took: performance.now() - began }
    })

  test('the agent reads the waiting answer and goes on; quit with the need pending; started again, nothing ran; Allow runs it once', async () => {
    const out = join(work, 'out.txt')
    const appender = script(APPENDS)
    const first = await engine()(
      inEngine(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const session = yield* openAgentSession({
            provider: 'claude',
            ownerKind: 'mission',
            ownerId: mission.id,
            role: 'builder',
            folder: main,
          })
          writeFileSync(join(main, 'README.md'), 'Acme\n')
          return yield* turn(session.id, [
            {
              does: 'uses',
              id: 'toolu_seed',
              tool: 'commands_run',
              arguments: { line: nodeLine(appender, out), why: 'seed the notes' },
            },
            { does: 'uses', id: 'toolu_read', tool: 'fs_read', arguments: { path: 'README.md' } },
            { does: 'says', text: 'I wait for the approval of the seed.' },
          ])
        }),
      ),
    )
    expect(first.answers[0]?.text).toMatch(WAITING)
    // It went on with what does not depend on it: the next call was answered in the same turn.
    expect(first.answers[1]?.text).toContain('Acme')
    expect(first.took).toBeLessThan(10_000)
    expect(linesIn(out)).toBe(0)

    const after = await engine()(
      inEngine(
        Effect.gen(function* () {
          const row = yield* theOnlyRequest
          const need = yield* getNeed(row.needId)
          const ranBefore = linesIn(out)
          yield* answer(row.needId, 'allow-once')
          return { need, ranBefore, ended: yield* handedOver(row.id) }
        }),
      ),
    )
    expect(after.need.state).toBe('pending')
    expect(after.ranBefore).toBe(0)
    expect(after.ended).toMatchObject({ result: 'done' })
    expect(linesIn(out)).toBe(1)
  })
})
