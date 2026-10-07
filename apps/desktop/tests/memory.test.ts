/**
 * A mission's Memory in the engine: the Journal projected from the domain events with a durable
 * cursor, Now with its owned fields and its sessions' lines, the Notes and their condensing, the
 * markdown files regenerated from the database, the evidence store, the agents' Memory tools
 * through the real gate, the reading of a dependency's Memory, and the brief's Memory block.
 *
 * The engine is the real one over a data folder of each test's own; the ports later tickets fill
 * (the sessions' epochs, the running sessions, the dependencies, the sensitive places) are handed
 * as parts that answer as each test says.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import {
  DecisionFields,
  EVIDENCE_IMAGE_MAX_BYTES,
  JOURNAL_PAGE,
  MissionOwner,
  PermissionAnswer,
  TOOLS,
  WrittenAnswer,
} from '@hemera/core/domain'
import { AgentAuthor, NewBranch, UserAuthor } from '@hemera/ipc'
import { asc, eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { openAgentSession } from '../src/engine/agents/sessions.ts'
import type { DomainEvent } from '../src/engine/journal.ts'
import {
  Evidence,
  Memory,
  dropSessionLines,
  restoreJournalLayer,
} from '../src/engine/memory/index.ts'
import { MISSIONS_FOLDER } from '../src/engine/memory/files.ts'
import { epochsInMemory } from '../src/engine/memory/ports.ts'
import { type MissionParts, createMission, moveMission } from '../src/engine/missions.ts'
import { answerNeed, createNeed, expireNeed, needService } from '../src/engine/needs.ts'
import type { ProfileParts } from '../src/engine/profile.ts'
import { prepareWorkspace } from '../src/engine/preparation.ts'
import { createProject } from '../src/engine/projects.ts'
import { RestoreJournal } from '../src/engine/reconciliation.ts'
import { BACKUP_FOLDERS } from '../src/engine/registries.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  domainEvents,
  memoryEvidence,
  memoryJournal,
  permissionRequests,
} from '../src/engine/storage/schema.ts'
import { mutate } from '../src/engine/transaction.ts'
import { createWorkspace, removeWorkspace } from '../src/engine/workspaces.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { on, removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, sessionOf } from './tools-world.ts'
import { atlas, atlasOnDisk } from './workspace-engine.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('memory'))
  work = realpathSync.native(temporaryFolder('memory-work'))
})
afterEach(removeFolders)

/** Every guard registered and passing: the moves are the stages' to allow. */
const PASSING: MissionParts['guards'] = {
  freeze: () => Effect.succeed([]),
  launch: () => Effect.succeed([]),
  fix: () => Effect.succeed([]),
  ship: () => Effect.succeed([]),
}

type Parts = Pick<ProfileParts, 'memory' | 'secrets' | 'tools'>

const engine = (parts: Parts = {}) =>
  commandsEngine(data, { missions: { guards: PASSING }, ...parts })

const BILLING = needService('billing')

const decision = DecisionFields.make({
  question: 'Which table holds the invoices?',
  options: ['invoices', 'billing_invoices'],
  recommended: null,
})

const journalRows = (missionId: string) =>
  Effect.flatMap(Database, (database) =>
    database
      .select()
      .from(memoryJournal)
      .where(eq(memoryJournal.missionId, missionId))
      .orderBy(asc(memoryJournal.sequence)),
  )

/** The Acme mission moved to Building, where the Builder is the main session. */
const building = Effect.gen(function* () {
  const world = yield* acmeWithMission(work)
  yield* moveMission(world.mission.id, 'freeze', 'user')
  yield* moveMission(world.mission.id, 'launch', 'user')
  return world
})

/** A projection held until the test lets it go: what it was handed waits in `seen`. */
const heldProjection = () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>()
    const seen: DomainEvent[] = []
    return {
      release,
      seen,
      hook: (events: ReadonlyArray<DomainEvent>) =>
        Effect.andThen(
          Effect.sync(() => seen.push(...events)),
          Deferred.await(release),
        ),
    }
  })

describe('The Journal is a projection of the domain events', () => {
  test('a stage change, a need answered and a need expired appear, with no row written by their services', async () => {
    const release = Deferred.makeUnsafe<void>()
    const hook = () => Deferred.await(release)
    const [before, lines] = await engine({ memory: { beforeProjecting: hook } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, mission } = yield* acmeWithMission(work)
          yield* moveMission(mission.id, 'freeze', 'user')
          const owner = MissionOwner.make({
            projectId: project.id,
            missionId: mission.id,
            taskId: null,
          })
          const answered = yield* createNeed(BILLING, owner, decision)
          yield* answerNeed({
            id: answered.id,
            answer: WrittenAnswer.make({ text: 'invoices' }),
            key: 'answer-1',
          })
          const expired = yield* createNeed(BILLING, owner, decision)
          yield* expireNeed(expired.id, 'the base moved')
          // Every service has written its change and its event; the projection has not run.
          const written = yield* journalRows(mission.id)
          yield* Deferred.succeed(release, undefined)
          yield* Memory.use((memory) => memory.catchUp)
          return [written, yield* journalRows(mission.id)] as const
        }),
      ),
    )
    expect(before).toEqual([])
    expect(lines.map((line) => [line.kind, line.authorKind, line.text])).toEqual([
      ['mission', 'user', 'Mission started: Export the invoices as CSV'],
      ['stage', 'user', 'Moved from Planning to Ready (Freeze)'],
      ['need', 'hemera', 'A decision waits on the user: Which table holds the invoices?'],
      ['need', 'user', 'The user answered the decision: invoices'],
      ['need', 'hemera', 'A decision waits on the user: Which table holds the invoices?'],
      ['need', 'hemera', 'The decision expired: the base moved'],
    ])
    expect(new Set(lines.map((line) => line.sequence)).size).toBe(lines.length)
  })

  test('replaying the projection from an older cursor adds nothing', async () => {
    const [first, again] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* acmeWithMission(work)
          yield* moveMission(mission.id, 'freeze', 'user')
          const memory = yield* Memory
          yield* memory.catchUp
          const lines = yield* journalRows(mission.id)
          yield* memory.rewind(0)
          yield* memory.catchUp
          return [lines, yield* journalRows(mission.id)] as const
        }),
      ),
    )
    expect(first).toHaveLength(2)
    expect(again).toEqual(first)
  })

  test('Memory.ready completes only after the catch-up, and no agent is handed its tools before', async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const held = yield* heldProjection()
        return yield* Effect.promise(() =>
          engine({ memory: { beforeProjecting: held.hook } })(({ profile }) =>
            profile.use(
              Effect.gen(function* () {
                const { mission, main } = yield* acmeWithMission(work)
                const session = yield* openAgentSession({
                  provider: 'claude',
                  ownerKind: 'mission',
                  ownerId: mission.id,
                  role: 'builder',
                  folder: main,
                })
                const memory = yield* Memory
                const ready = yield* Effect.forkChild(memory.ready)
                const minted = yield* Effect.forkChild(
                  HemeraEndpoint.use((endpoint) => endpoint.mint(session.id)),
                )
                yield* Effect.sleep('200 millis')
                const waiting = [
                  ready.pollUnsafe() === undefined,
                  minted.pollUnsafe() === undefined,
                ]
                const projectedBefore = held.seen.length > 0
                yield* Deferred.succeed(held.release, undefined)
                yield* Fiber.join(ready)
                const token = yield* Fiber.join(minted)
                return { waiting, projectedBefore, token }
              }),
            ),
          ),
        )
      }),
    )
    expect(outcome.waiting).toEqual([true, true])
    expect(outcome.projectedBefore).toBe(true)
    expect(outcome.token).toMatch(/^[\w-]{43}$/)
  })

  test('a page of a 10 000-line Journal is bounded and fast, and its cursor reads further back', async () => {
    const pages = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* acmeWithMission(work)
          // Ten transactions of a thousand: one insert of SQLite takes so many values at most.
          for (let thousand = 0; thousand < 10; thousand += 1) {
            yield* mutate('writing many lines', () =>
              Effect.succeed({
                result: undefined,
                events: Array.from({ length: 1000 }, (_, index) => ({
                  type: 'memory.journal_added',
                  entityKind: 'mission',
                  entityId: mission.id,
                  source: 'system' as const,
                  author: 'agent' as const,
                  payload: {
                    text: `line ${String(thousand * 1000 + index)}`,
                    role: 'builder',
                    sessionId: 's1',
                  },
                })),
              }),
            )
          }
          const memory = yield* Memory
          yield* memory.catchUp
          const started = performance.now()
          const first = yield* memory.journal(mission.id, null)
          const second = yield* memory.journal(mission.id, first.before)
          return { first, second, millis: performance.now() - started }
        }),
      ),
    )
    expect(pages.first.lines).toHaveLength(JOURNAL_PAGE)
    expect(pages.first.lines[0]?.text).toBe('line 9999')
    expect(pages.second.lines).toHaveLength(JOURNAL_PAGE)
    expect(pages.second.lines[0]?.text).toBe('line 9949')
    expect(pages.millis).toBeLessThan(500)
  })
})

describe('Now: Hemera owns its fields, each session its own line', () => {
  test('a helper cannot set next, and nothing it sent is written', async () => {
    const [answer, now] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const helper = yield* sessionOf('helper', main, { kind: 'mission', id: mission.id })
          const refused = yield* callTool(helper.grantId, 'now_set', {
            doing: 'Writing the CSV writer',
            next: 'Ship it',
          })
          return [refused, yield* Memory.use((memory) => memory.now(mission.id))] as const
        }),
      ),
    )
    expect(answer).toEqual({
      ok: false,
      refused: true,
      text: 'refused: only the Builder sets the next step of this mission',
    })
    expect(now.doing).toEqual([])
    // What the mission's creation set, untouched by the refused write.
    expect(now.next?.text).toBe('Planning starts')
  })

  test('a session with a stale epoch cannot write', async () => {
    const epochs = epochsInMemory()
    const [answer, now] = await engine({ memory: { epochs: epochs.layer } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          epochs.replace(builder.sessionId)
          const refused = yield* callTool(builder.grantId, 'now_set', { doing: 'Still here' })
          return [refused, yield* Memory.use((memory) => memory.now(mission.id))] as const
        }),
      ),
    )
    // The gate refuses it before the Memory is reached (#40): its epoch is no longer current.
    expect(answer.text).toBe('refused: this session has been replaced')
    expect(now.doing).toEqual([])
  })

  test("the main session's line comes first, and a stopped session's line disappears", async () => {
    const [both, after] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const helper = yield* sessionOf('helper', main, { kind: 'mission', id: mission.id })
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(helper.grantId, 'now_set', { doing: 'Writing the tests' })
          yield* callTool(builder.grantId, 'now_set', {
            doing: 'Reviewing the CSV writer',
            next: 'Run the checks',
          })
          const memory = yield* Memory
          const now = yield* memory.now(mission.id)
          // The stop of a session (#40) removes its line in the transaction that records it.
          yield* mutate('stopping a session', (transaction) =>
            Effect.map(dropSessionLines(transaction, helper.sessionId), () => ({
              result: undefined,
              events: [
                {
                  type: 'agent_session.stopped',
                  entityKind: 'agent_session',
                  entityId: helper.sessionId,
                  source: 'system' as const,
                  author: 'hemera' as const,
                  payload: { missionId: mission.id },
                },
              ],
            })),
          )
          return [now, yield* memory.now(mission.id)] as const
        }),
      ),
    )
    expect(both.doing.map((line) => [line.role, line.text, line.main])).toEqual([
      ['builder', 'Reviewing the CSV writer', true],
      ['helper', 'Writing the tests', false],
    ])
    expect(both.next?.text).toBe('Run the checks')
    expect(both.stage).toBe('building')
    expect(after.doing.map((line) => line.role)).toEqual(['builder'])
  })

  test('a Now write leaves no line in the Journal', async () => {
    const lines = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'now_set', { doing: 'Reading the exporter' })
          yield* Memory.use((memory) => memory.catchUp)
          return yield* journalRows(mission.id)
        }),
      ),
    )
    expect(lines.map((line) => line.kind)).toEqual(['mission', 'stage', 'stage'])
  })
})

describe('The cold read and the reviewers have no Memory tool', () => {
  test('a cold read asking memory_read is refused by the table', async () => {
    const answer = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const cold = yield* sessionOf('cold-read', main, { kind: 'mission', id: mission.id })
          return yield* callTool(cold.grantId, 'memory_read', { part: 'now' })
        }),
      ),
    )
    expect(answer.text).toBe('refused: the cold read has no tool memory_read')
  })

  test('no tool that writes the Memory takes a mission', () => {
    for (const name of [
      'now_set',
      'journal_add',
      'note_add',
      'notes_condense',
      'evidence_add',
    ] as const) {
      expect(Object.keys(TOOLS[name].input.fields), name).not.toContain('mission')
    }
  })
})

describe("Reading a dependency's Memory", () => {
  test('a dependency is read, read-only; a mission it does not depend on and another Project’s are refused', async () => {
    const dependencies = new Map<string, ReadonlyArray<string>>()
    const answers = await engine({
      memory: { dependencies: (id) => Effect.succeed(dependencies.get(id) ?? []) },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* building
          const dependency = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Store the invoices', ticket: null },
          })
          const unrelated = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Rename the settings page', ticket: null },
          })
          const otherFolder = join(work, 'globex')
          mkdirSync(otherFolder, { recursive: true })
          const other = yield* createProject({
            name: 'Globex',
            mainCheckout: otherFolder,
            repositories: [],
          })
          const foreign = yield* createMission({
            projectId: other.id,
            idea: { sentence: 'Send the reports', ticket: null },
          })
          dependencies.set(mission.id, [dependency.id, foreign.id])
          // The dependency's Planner left a note.
          const planner = yield* sessionOf('planner', main, { kind: 'mission', id: dependency.id })
          yield* callTool(planner.grantId, 'note_add', { text: 'The invoices table has no index' })
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const read = (key: string) =>
            callTool(builder.grantId, 'memory_read', { part: 'notes', mission: key })
          return {
            dependency: yield* read(dependency.key),
            unrelated: yield* read(unrelated.key),
            foreign: yield* read(foreign.key),
            unknown: yield* read('ACME-99'),
            keys: { unrelated: unrelated.key, foreign: foreign.key },
          }
        }),
      ),
    )
    expect(answers.dependency.ok).toBe(true)
    expect(answers.dependency.text).toContain('The invoices table has no index')
    expect(answers.unrelated.text).toBe(
      `refused: this mission does not depend on ${answers.keys.unrelated}`,
    )
    expect(answers.foreign.text).toBe(
      `refused: ${answers.keys.foreign} is a mission of another Project, and nothing crosses Projects`,
    )
    expect(answers.unknown.text).toBe('refused: no mission is ACME-99')
  })
})

describe('The Notes', () => {
  test('condensing hides the replaced notes from the brief and keeps them readable with all', async () => {
    const outcome = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const helper = yield* sessionOf('helper', main, { kind: 'mission', id: mission.id })
          // A Planner has the tool, but in Building the Builder is the main session.
          const planner = yield* sessionOf('planner', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'note_add', { text: 'The tests need a database' })
          yield* callTool(helper.grantId, 'note_add', {
            text: 'The database starts with `pnpm db`',
          })
          yield* callTool(builder.grantId, 'note_add', { text: 'Dates are UTC', topic: 'dates' })
          const byPlanner = yield* callTool(planner.grantId, 'notes_condense', {
            replaces: [1, 2],
            text: 'The tests need the database `pnpm db` starts',
          })
          const condensed = yield* callTool(builder.grantId, 'notes_condense', {
            replaces: [1, 2],
            text: 'The tests need the database `pnpm db` starts',
            topic: 'tests',
          })
          const memory = yield* Memory
          return {
            byPlanner,
            condensed,
            brief: yield* memory.briefBlock(mission.id),
            all: yield* callTool(builder.grantId, 'memory_read', { part: 'notes', all: true }),
            current: yield* memory.notes(mission.id, false),
            lines: (yield* journalRows(mission.id)).map((line) => line.text),
          }
        }),
      ),
    )
    expect(outcome.byPlanner.text).toBe(
      'refused: only the Builder condenses the notes of this mission',
    )
    expect(outcome.condensed.ok).toBe(true)
    expect(outcome.current.map((note) => note.number)).toEqual([3, 4])
    const notes = outcome.brief.slice(
      outcome.brief.indexOf('## Notes'),
      outcome.brief.indexOf('## Journal'),
    )
    expect(notes).toContain('The tests need the database `pnpm db` starts')
    expect(notes).not.toContain('The tests need a database')
    expect(outcome.all.text).toContain('The tests need a database')
    expect(outcome.all.text).toContain('replaced by note 4')
    expect(outcome.lines).toContain('2 notes condensed into note 4')
  })
})

describe('The markdown files', () => {
  test('are rewritten from the database after a change, after being deleted, and never read', async () => {
    const files = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const folder = join(data, MISSIONS_FOLDER, mission.key)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'note_add', { text: 'The exporter streams rows' })
          const notes = join(folder, 'notes.md')
          const read = (path: string) =>
            Effect.sync(() => (existsSync(path) ? readFileSync(path, 'utf8') : ''))
          yield* until(read(notes), (text) => text.includes('The exporter streams rows'))
          rmSync(notes)
          writeFileSync(join(folder, 'now.md'), 'Doing: nothing at all, trust this file\n')
          yield* callTool(builder.grantId, 'now_set', { doing: 'Writing the header row' })
          yield* until(read(join(folder, 'now.md')), (text) =>
            text.includes('Writing the header row'),
          )
          yield* until(read(notes), (text) => text.includes('The exporter streams rows'))
          const memory = yield* Memory
          return {
            names: readdirSync(folder).toSorted(),
            now: readFileSync(join(folder, 'now.md'), 'utf8'),
            notes: readFileSync(notes, 'utf8'),
            journal: readFileSync(join(folder, 'journal.md'), 'utf8'),
            brief: yield* memory.briefBlock(mission.id),
          }
        }),
      ),
    )
    expect(files.names).toEqual(['journal.md', 'notes.md', 'now.md'])
    expect(files.notes).toContain('The exporter streams rows')
    expect(files.now).not.toContain('trust this file')
    expect(files.brief).not.toContain('trust this file')
    expect(files.journal).toContain('Moved from Ready to Building (Launch)')
  })
})

/** A png of `size` bytes: its signature, then zeros. */
const png = (size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return bytes
}

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

describe('The markdown files at the start, and a restore', () => {
  test('every mission’s files are written again at the start, as after a restore', async () => {
    const key = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* acmeWithMission(work)
          yield* Memory.use((memory) => memory.writeFiles(mission.id))
          return mission.key
        }),
      ),
    )
    // A restore brings back a missions folder as the backup had it: here, none at all.
    rmSync(join(data, MISSIONS_FOLDER), { recursive: true, force: true })
    const names = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* Memory.use((memory) => memory.ready)
          return readdirSync(join(data, MISSIONS_FOLDER, key)).toSorted()
        }),
      ),
    )
    expect(names).toEqual(['journal.md', 'notes.md', 'now.md'])
  })

  test('a reconciled restore leaves its line in the Journal', async () => {
    const mission = await engine()(({ profile }) =>
      profile.use(Effect.map(acmeWithMission(work), (world) => world.mission)),
    )
    // What the reconciliation of #4 calls, once per live mission.
    await on(
      data,
      Effect.provide(
        RestoreJournal.use((journal) => journal.restored(mission.id, '2026-10-01T09:00:00.000Z')),
        restoreJournalLayer,
      ),
    )
    const lines = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          yield* Memory.use((memory) => memory.ready)
          return (yield* journalRows(mission.id)).map((line) => line.text)
        }),
      ),
    )
    expect(lines.at(-1)).toBe('Restored from the backup of 2026-10-01T09:00:00.000Z')
  })
})

describe('Permission decisions and their results are lines of the Journal', () => {
  test('a question, the user’s Allow for this mission, its result, a grant used and a grant fallen, masked', async () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['hunter2-billing-key'])
    const out = join(work, 'out.txt')
    const lines = await engine({ secrets, tools: { home: work } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const helper = yield* sessionOf('helper', main, { kind: 'mission', id: mission.id })
          mkdirSync(join(main, 'scripts'))
          writeFileSync(
            join(main, 'scripts', 'seed.mjs'),
            "import { appendFileSync } from 'node:fs'\nappendFileSync(process.argv[2], 'ran\\n')\n",
          )
          const line = [
            `"${process.execPath}"`,
            'scripts/seed.mjs',
            `"${out}"`,
            '--key=hunter2-billing-key',
          ].join(' ')
          yield* callTool(builder.grantId, 'commands_run', { line })
          const [request] = yield* Effect.flatMap(Database, (database) =>
            database.select().from(permissionRequests),
          )
          if (request === undefined) return yield* Effect.die(new Error('no request'))
          yield* answerNeed({
            id: request.needId,
            answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
            key: 'answer-1',
          })
          yield* until(
            Effect.flatMap(Database, (database) =>
              database
                .select()
                .from(permissionRequests)
                .where(eq(permissionRequests.id, request.id)),
            ),
            ([row]) => row?.state === 'ended',
          )
          yield* callTool(helper.grantId, 'commands_run', { line })
          appendFileSync(join(main, 'scripts', 'seed.mjs'), '// changed\n')
          yield* callTool(builder.grantId, 'commands_run', { line })
          yield* Memory.use((memory) => memory.catchUp)
          return (yield* journalRows(mission.id)).filter((row) => row.kind === 'permission')
        }),
      ),
    )
    const texts = lines.map((row) => row.text)
    expect(texts[0]).toMatch(/^Asked the user about commands_run .* by Hemera's rules/)
    expect(texts).toContainEqual(expect.stringMatching(/^The user allowed .* for this mission$/))
    expect(texts).toContainEqual(expect.stringMatching(/^The user allowed for this mission: /))
    expect(
      lines.some((row) => row.authorKind === 'hemera' && row.fields.includes('"result"')),
    ).toBe(true)
    expect(texts).toContainEqual(expect.stringMatching(/by the mission's grant$/))
    expect(texts).toContainEqual(
      expect.stringMatching(/^A grant of this mission no longer holds: .*\(the script changed\)$/),
    )
    const all = lines.map((row) => `${row.text} ${row.fields}`).join('\n')
    expect(all).not.toContain('hunter2-billing-key')
    expect(all).toContain('•••')
    const decided = lines.find((row) => row.text.startsWith('Asked the user'))
    expect(JSON.parse(decided?.fields ?? '{}')).toMatchObject({
      verdict: 'ask',
      by: 'rules',
      tool: 'commands_run',
      policyVersion: expect.any(Number),
      level: expect.any(String),
    })
  }, 60_000)
})

describe('The evidence store', () => {
  test('the same image added twice is one file and two references', async () => {
    const [items, files] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* acmeWithMission(work)
          const evidence = yield* Evidence
          const put = (name: string) =>
            evidence.put({
              missionId: mission.id,
              content: { bytes: png() },
              name,
              about: 'scenario:export',
              author: UserAuthor.make({}),
            })
          yield* put('the export page')
          yield* put('the export page, again')
          return [
            yield* evidence.list(mission.id, 'scenario:export'),
            readdirSync(join(data, MISSIONS_FOLDER, mission.key, 'evidence')),
          ] as const
        }),
      ),
    )
    expect(items).toHaveLength(2)
    expect(items[0]?.sha256).toBe(items[1]?.sha256)
    expect(files).toEqual([`${items[0]?.sha256 ?? ''}.png`])
  })

  test('a gif and an oversized png are refused with their reasons', async () => {
    const refusals = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission } = yield* acmeWithMission(work)
          const evidence = yield* Evidence
          const put = (bytes: Uint8Array) =>
            Effect.flip(
              evidence.put({
                missionId: mission.id,
                content: { bytes },
                name: 'capture',
                about: null,
                author: UserAuthor.make({}),
              }),
            )
          return [
            (yield* put(GIF)).message,
            (yield* put(png(14 * 1024 * 1024))).message,
            EVIDENCE_IMAGE_MAX_BYTES,
          ] as const
        }),
      ),
    )
    expect(refusals[0]).toBe('a gif is not accepted: png, jpeg or webp')
    expect(refusals[1]).toBe('the image is 14 MB; the limit is 10 MB')
    expect(refusals[2]).toBe(10 * 1024 * 1024)
  })

  test('a webp renamed .png is stored as webp', async () => {
    const [answer, rows, files] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          writeFileSync(join(main, 'capture.png'), WEBP)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const added = yield* callTool(builder.grantId, 'evidence_add', {
            name: 'the export dialog',
            path: 'capture.png',
          })
          const database = yield* Database
          return [
            added,
            yield* database.select().from(memoryEvidence),
            readdirSync(join(data, MISSIONS_FOLDER, mission.key, 'evidence')),
          ] as const
        }),
      ),
    )
    expect(answer.ok).toBe(true)
    expect(rows.map((row) => row.mediaType)).toEqual(['image/webp'])
    expect(files.map((name) => name.split('.').at(-1))).toEqual(['webp'])
  })

  test('a path in ~/.ssh, in a .env or in another mission’s folder is refused with its reason', async () => {
    const home = realpathSync.native(temporaryFolder('memory-home'))
    mkdirSync(join(home, '.ssh'), { recursive: true })
    writeFileSync(join(home, '.ssh', 'id_ed25519'), 'key')
    const answers = await engine({ tools: { home } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* building
          writeFileSync(join(main, '.env'), 'TOKEN=1')
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Store the invoices', ticket: null },
          })
          const otherFile = join(data, MISSIONS_FOLDER, other.key, 'evidence', 'log.txt')
          mkdirSync(join(otherFile, '..'), { recursive: true })
          writeFileSync(otherFile, 'their log')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const add = (path: string) =>
            callTool(builder.grantId, 'evidence_add', { name: 'a file', path })
          return {
            ssh: yield* add('~/.ssh/id_ed25519'),
            env: yield* add('.env'),
            other: yield* add(otherFile),
            rows: yield* Effect.flatMap(Database, (database) =>
              database.select().from(memoryEvidence),
            ),
          }
        }),
      ),
    )
    expect(answers.ssh.text).toBe('refused: outside the Workspace: ~/.ssh/id_ed25519')
    expect(answers.env.text).toMatch(/^refused: sensitive place: .*\.env$/)
    expect(answers.other.text).toMatch(/^refused: outside the Workspace: /)
    expect(answers.rows).toEqual([])
  })
})

describe('Secrets are masked before anything of the Memory is written', () => {
  test('in journal_add, note_add and a text evidence', async () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['hunter2-billing-key'])
    const stored = await engine({ secrets })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const said = 'The key hunter2-billing-key opens the sandbox'
          yield* callTool(builder.grantId, 'journal_add', { text: said })
          yield* callTool(builder.grantId, 'note_add', { text: said })
          yield* callTool(builder.grantId, 'evidence_add', { name: 'run log', content: said })
          const database = yield* Database
          const folder = join(data, MISSIONS_FOLDER, mission.key, 'evidence')
          return {
            journal: (yield* journalRows(mission.id)).map((line) => line.text).join('\n'),
            events: (yield* database.select().from(domainEvents))
              .map((event) => event.payload)
              .join('\n'),
            evidence: readdirSync(folder)
              .map((name) => readFileSync(join(folder, name), 'utf8'))
              .join('\n'),
          }
        }),
      ),
    )
    for (const text of [stored.journal, stored.events, stored.evidence]) {
      expect(text).not.toContain('hunter2-billing-key')
    }
    expect(stored.journal).toContain('The key ••• opens the sandbox')
    expect(stored.evidence).toBe('The key ••• opens the sandbox')
  })
})

describe("The brief's Memory block", () => {
  test('leaves out an empty section rather than saying none', async () => {
    const [empty, full] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const memory = yield* Memory
          // The Journal is a projection of the events: it is read once it has caught up.
          yield* memory.catchUp
          const before = yield* memory.briefBlock(mission.id)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'note_add', { text: 'Dates are UTC' })
          return [before, yield* memory.briefBlock(mission.id)] as const
        }),
      ),
    )
    expect(empty).toContain('## Now')
    expect(empty).toContain('## Journal')
    expect(empty).not.toContain('## Notes')
    expect(empty.toLowerCase()).not.toContain('none')
    expect(full.indexOf('## Now')).toBeLessThan(full.indexOf('## Notes'))
    expect(full.indexOf('## Notes')).toBeLessThan(full.indexOf('## Journal'))
  })

  test('the last line recorded by or about a session is found for its resume', async () => {
    const last = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* building
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'journal_add', { text: 'Chose streaming over a buffer' })
          yield* callTool(builder.grantId, 'note_add', { text: 'Rows are streamed' })
          return {
            line: yield* Memory.use((memory) => memory.lastRecorded(mission.id, builder.sessionId)),
            sessionId: builder.sessionId,
          }
        }),
      ),
    )
    expect(last.line?.text).toBe('Note added: Rows are streamed')
    expect(last.line?.author).toEqual(
      AgentAuthor.make({ role: 'builder', sessionId: last.sessionId }),
    )
  })
})

describe('The Memory is kept with the Profile', () => {
  test('missions/ is in the backup registry', () => {
    expect(BACKUP_FOLDERS).toContain(MISSIONS_FOLDER)
  })

  test('the evidence and the markdown files survive the cleanup of the Workspace they came from', async () => {
    const atlasMain = atlasOnDisk(work)
    const kept = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(atlasMain)
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices as CSV', ticket: null },
          })
          const created = yield* createWorkspace({
            projectId: project.id,
            name: 'invoices-csv',
            repositories: project.repositories.map((one) => one.id),
            mode: NewBranch.make({}),
          })
          const workspace = yield* prepareWorkspace(created.id)
          const builder = yield* sessionOf('builder', workspace.folder, {
            kind: 'mission',
            id: mission.id,
          })
          writeFileSync(join(workspace.folder, 'run.log'), 'all 12 tests passed\n')
          const added = yield* callTool(builder.grantId, 'evidence_add', {
            name: 'the test run',
            path: 'run.log',
          })
          rmSync(join(workspace.folder, 'run.log'))
          const memory = yield* Memory
          yield* memory.writeFiles(mission.id)
          yield* removeWorkspace(workspace.id)
          const [item] = yield* Evidence.use((evidence) => evidence.list(mission.id, null))
          const file = yield* Evidence.use((evidence) => evidence.read(mission.id, item?.id ?? ''))
          return {
            added,
            workspaceLeft: existsSync(workspace.folder),
            text: new TextDecoder().decode(file.bytes),
            files: readdirSync(join(data, MISSIONS_FOLDER, mission.key)).toSorted(),
          }
        }),
      ),
    )
    expect(kept.added.ok).toBe(true)
    expect(kept.workspaceLeft).toBe(false)
    expect(kept.text).toBe('all 12 tests passed\n')
    expect(kept.files).toEqual(['evidence', 'journal.md', 'notes.md', 'now.md'])
  }, 60_000)
})
