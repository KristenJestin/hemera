/**
 * Exclusive resources (#88): a Project declares what its Workspaces share (a shared development
 * database), the catalogue commands that use it and change it, and the command that resets it;
 * Hemera then lets one mission at a time run those commands, the others waiting with the mark
 * "blocked", in their order, across a restart. Taking the reservation runs the reset, or asks the
 * user; an agent's run of a command that changes it always asks; a change cut short asks what
 * happened.
 *
 * Every test runs the engine as it starts, over a data folder of its own: one call of `engine` is
 * one opening, so two calls are a restart. The commands are `node` scripts writing to a log file of
 * the test's own: the shared database is a file, its migration a line appended to it.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ChosenAnswer,
  DecisionFields,
  EnvironmentFields,
  MissionOwner,
  type Move,
} from '@hemera/core/domain'
import { type CommandDraft, InvalidResources, type Mission, type ResourceDraft } from '@hemera/ipc'
import { eq, sql } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer, Option, Predicate, Result, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AskBeforeRunning } from '../src/engine/ask-before-running.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { readEvents } from '../src/engine/journal.ts'
import { Memory } from '../src/engine/memory/index.ts'
import {
  type MissionParts,
  createMission,
  getMission,
  moveMission,
} from '../src/engine/missions.ts'
import { answerNeed, retryNeed } from '../src/engine/needs.ts'
import { Judge } from '../src/engine/permissions/ports.ts'
import { createProject } from '../src/engine/projects.ts'
import { listResources, saveResources } from '../src/engine/resources/declarations.ts'
import { ExclusiveResources } from '../src/engine/resources/reservations.ts'
import { Runs, type RunAsked, getRun, startRun, stopRun } from '../src/engine/runs.ts'
import { Database } from '../src/engine/storage/database.ts'
import { missions } from '../src/engine/storage/schema.ts'
import {
  type EffectfulAction,
  EffectfulActions,
  actionRulesLayer,
  listActions,
} from '../src/engine/tools/actions.ts'
import { PermissionRequests } from '../src/engine/tools/ports.ts'
import { STAYS_UP, commandsEngine, nodeLine, script, until } from './commands-engine.ts'
import { on, removeFolders, temporaryFolder } from './storage.ts'
import { callTool, sessionOf } from './tools-world.ts'

let data: string
let work: string
let log: string
/** Appends its second argument as a line to the file its first names: the database's history. */
let writes: string
/** The same, but fails while the file its fourth argument names exists: a broken migration. */
let writesUnlessBroken: string
/** Writes its line, then stays up: a migration still running when the engine stops. */
let writesAndStays: string
/** Writes its pid to the file its first argument names, its line, then stays up; deaf to a stop when asked. */
let holds: string
/** Writes its line, or "collision" and fails while the process whose pid the first file holds is alive. */
let checks: string
/** Writes its line, then ends only once the file its third argument names exists. */
let writesThenWaits: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('resources'))
  work = realpathSync.native(temporaryFolder('resources-work'))
  log = join(work, 'database.log')
  writes = script(`
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], process.argv[3] + '\\n')
`)
  writesUnlessBroken = script(`
import { appendFileSync, existsSync } from 'node:fs'
if (existsSync(process.argv[4])) { console.log('migration 12 failed'); process.exit(3) }
appendFileSync(process.argv[2], process.argv[3] + '\\n')
`)
  writesAndStays = script(`
import { appendFileSync } from 'node:fs'
appendFileSync(process.argv[2], process.argv[3] + '\\n')
${STAYS_UP}`)
  holds = script(`
import { appendFileSync, writeFileSync } from 'node:fs'
writeFileSync(process.argv[2], String(process.pid))
appendFileSync(process.argv[3], process.argv[4] + '\\n')
if (process.argv[5] === 'deaf') process.on('SIGTERM', () => {})
${STAYS_UP}`)
  checks = script(`
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
let alive = false
if (existsSync(process.argv[2])) {
  try { process.kill(Number(readFileSync(process.argv[2], 'utf8')), 0); alive = true } catch {}
}
appendFileSync(process.argv[3], (alive ? 'collision' : process.argv[4]) + '\\n')
process.exit(alive ? 1 : 0)
`)
  writesThenWaits = script(`
import { appendFileSync, existsSync } from 'node:fs'
appendFileSync(process.argv[2], process.argv[3] + '\\n')
const timer = setInterval(() => { if (existsSync(process.argv[4])) clearInterval(timer) }, 20)
`)
})
afterEach(removeFolders)

const PASSING: MissionParts['guards'] = {
  freeze: () => Effect.succeed([]),
  launch: () => Effect.succeed([]),
  fix: () => Effect.succeed([]),
  ship: () => Effect.succeed([]),
}

type Parts = NonNullable<Parameters<typeof commandsEngine>[1]>

const engine = (parts: Parts = {}) =>
  commandsEngine(data, { ...parts, missions: { guards: PASSING, ...parts.missions } })

const history = (): ReadonlyArray<string> =>
  existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : []

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

const command = (projectId: string, name: string, line: string) =>
  saveCommand({ projectId, id: null, command: draft(name, line) })

const project = (name: string) =>
  Effect.gen(function* () {
    const folder = join(work, name.toLowerCase())
    mkdirSync(folder, { recursive: true })
    return yield* createProject({ name, mainCheckout: folder, repositories: [] })
  })

const ROAD: ReadonlyArray<readonly [Move, 'user' | 'hemera']> = [
  ['freeze', 'user'],
  ['launch', 'user'],
]

/** A mission of the Project, in Building. */
const building = (projectId: string, sentence: string) =>
  Effect.gen(function* () {
    const mission = yield* createMission({ projectId, idea: { sentence, ticket: null } })
    for (const [move, actor] of ROAD) yield* moveMission(mission.id, move, actor)
    return yield* getMission(mission.id)
  })

const resource = (more: Partial<ResourceDraft> = {}): ResourceDraft => ({
  name: 'shared database',
  description: 'The development database every Workspace of Acme uses',
  uses: [],
  changes: [],
  resetCommandId: null,
  ...more,
})

/**
 * Acme, its shared database declared with `migrate` as its reset (unless `reset` is false), `test`
 * using it, and `lint` declared on nothing.
 */
const acme = (reset: 'migrate' | 'broken' | 'stays' | false = 'migrate', broken = '') =>
  Effect.gen(function* () {
    const acmeProject = yield* project('Acme')
    const migrateLine =
      reset === 'broken'
        ? nodeLine(writesUnlessBroken, log, 'migrate', broken)
        : nodeLine(reset === 'stays' ? writesAndStays : writes, log, 'migrate')
    const migrate = yield* command(acmeProject.id, 'migrate', migrateLine)
    const tests = yield* command(acmeProject.id, 'test', nodeLine(writes, log, 'test'))
    const lint = yield* command(acmeProject.id, 'lint', nodeLine(writes, log, 'lint'))
    yield* saveResources(acmeProject.id, [
      resource({ uses: [tests.id], resetCommandId: reset === false ? null : migrate.id }),
    ])
    return { project: acmeProject, migrate, test: tests, lint }
  })

const run = (
  projectId: string,
  missionId: string,
  commandId: string | null,
  more: Partial<RunAsked> = {},
) =>
  startRun({
    projectId,
    workspaceId: null,
    commandId,
    line: null,
    folder: null,
    startedBy: 'user',
    sessionId: null,
    missionId,
    ...more,
  })

const ended = (id: string) =>
  until(
    getRun(id),
    (seen) => !['starting', 'running', 'waiting_for_permission'].includes(seen.state),
  )

const sentences = (mission: Mission) => mission.marks.map((mark) => mark.sentence)

const marksOf = (id: string) => Effect.map(getMission(id), sentences)

const needsOf = (id: string) => Effect.map(getMission(id), (mission) => mission.needs)

const holders = ExclusiveResources.use((resources) => resources.holders)

const acquire = (missionId: string) =>
  ExclusiveResources.use((resources) => resources.acquire('shared database', missionId))

const release = (missionId: string) =>
  ExclusiveResources.use((resources) => resources.release('shared database', missionId, 'done'))

const holderOf = Effect.map(holders, (all) => all[0]?.holder?.missionId ?? null)
const queueOf = Effect.map(holders, (all) => (all[0]?.queue ?? []).map((one) => one.missionId))

describe('The declaration of an exclusive resource', () => {
  test('validation refuses a command listed that is not in the catalogue, or listed both as "use" and "change"', async () => {
    const refusals = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, migrate, test: testCommand } = yield* acme(false)
          const refusal = (drafts: ReadonlyArray<ResourceDraft>) =>
            saveResources(acmeProject.id, drafts).pipe(
              Effect.flip,
              Effect.map((failure) =>
                Predicate.isTagged(failure, 'InvalidResources') ? failure.reason : failure.message,
              ),
            )
          return yield* Effect.all([
            refusal([resource({ uses: ['no-such-command'] })]),
            refusal([resource({ uses: [testCommand.id], changes: [testCommand.id] })]),
            refusal([resource({ uses: [migrate.id], resetCommandId: migrate.id })]),
            refusal([resource({ resetCommandId: 'no-such-command' })]),
            refusal([resource({ name: '   ' })]),
            refusal([
              resource({ name: 'Shared Database' }),
              resource({ name: ' shared database ' }),
            ]),
          ])
        }),
      ),
    )
    expect(refusals).toEqual([
      'shared database: a command it lists is not in the catalogue',
      'shared database: test is listed both as using it and as changing it',
      'shared database: migrate is its reset command, which changes it, and cannot be listed as using it',
      'shared database: a command it lists is not in the catalogue',
      'a resource has no name',
      'shared database is declared twice',
    ])
    expect(new InvalidResources({ reason: 'x' }).message).toBe('These resources are refused: x.')
  })

  test('validation refuses a service as the reset command: it never ends, so the resource would never be ready', async () => {
    const refusal = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acmeProject = yield* project('Acme')
          const database = yield* saveCommand({
            projectId: acmeProject.id,
            id: null,
            command: { ...draft('database', nodeLine(writesAndStays, log, 'up')), type: 'serve' },
          })
          return yield* saveResources(acmeProject.id, [
            resource({ resetCommandId: database.id }),
          ]).pipe(
            Effect.flip,
            Effect.map((failure) =>
              Predicate.isTagged(failure, 'InvalidResources') ? failure.reason : failure.message,
            ),
          )
        }),
      ),
    )
    expect(refusal).toBe(
      'shared database: database is a service, which never ends, and cannot be its reset command',
    )
  })

  test('a list is read back as saved, its name trimmed, the reset command among those that change it', async () => {
    const [listed, migrateId, testId] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, migrate, test: testCommand } = yield* acme(false)
          yield* saveResources(acmeProject.id, [
            resource({
              name: '  Shared database ',
              uses: [testCommand.id],
              resetCommandId: migrate.id,
            }),
          ])
          return [yield* listResources(acmeProject.id), migrate.id, testCommand.id] as const
        }),
      ),
    )
    expect(listed).toMatchObject([
      {
        name: 'Shared database',
        description: 'The development database every Workspace of Acme uses',
        uses: [testId],
        changes: [migrateId],
        resetCommandId: migrateId,
      },
    ])
  })
})

describe('The commands of a resource are listed in a fixed order', () => {
  test('whatever order they were declared in, they come back by name: the Probe’s brief reads the same text twice', async () => {
    const [first, second] = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acmeProject = yield* project('Acme')
          const ids = new Map<string, string>()
          for (const name of ['zeta', 'echo', 'delta', 'charlie', 'bravo', 'alpha']) {
            ids.set(name, (yield* command(acmeProject.id, name, nodeLine(writes, log, name))).id)
          }
          const named = (...names: ReadonlyArray<string>) =>
            names.map((name) => ids.get(name) ?? name)
          const listedAs = (uses: ReadonlyArray<string>, changes: ReadonlyArray<string>) =>
            Effect.gen(function* () {
              yield* saveResources(acmeProject.id, [
                resource({ uses: named(...uses), changes: named(...changes) }),
              ])
              const [listed] = yield* listResources(acmeProject.id)
              const names = (listedIds: ReadonlyArray<string> | undefined) =>
                (listedIds ?? []).map((id) => [...ids].find(([, known]) => known === id)?.[0] ?? id)
              return { uses: names(listed?.uses), changes: names(listed?.changes) }
            })
          return [
            yield* listedAs(['zeta', 'charlie', 'alpha'], ['echo', 'delta', 'bravo']),
            yield* listedAs(['alpha', 'charlie', 'zeta'], ['bravo', 'delta', 'echo']),
          ] as const
        }),
      ),
    )
    expect(first).toEqual({
      uses: ['alpha', 'charlie', 'zeta'],
      changes: ['bravo', 'delta', 'echo'],
    })
    expect(second).toEqual(first)
  })
})

describe('One mission at a time runs the commands declared on a resource', () => {
  test('two missions of one Project: the second one’s declared command waits, blocked by shared database · ACME-1; it starts when the first Building ends, and the mark clears', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const firstRun = yield* run(acmeProject.id, first.id, testCommand.id)
          const firstEnded = yield* ended(firstRun.id)
          const secondRun = yield* run(acmeProject.id, second.id, testCommand.id)
          const blocked = yield* until(marksOf(second.id), (marks) => marks.length > 0)
          const waiting = yield* getRun(secondRun.id)
          const before = history()
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          const secondEnded = yield* ended(secondRun.id)
          const after = yield* marksOf(second.id)
          return { firstEnded, blocked, waiting, before, secondEnded, after, keys: [first.key] }
        }),
      ),
    )
    expect(seen.firstEnded.state).toBe('done')
    expect(seen.blocked).toEqual(['blocked by shared database · ACME-1'])
    expect(seen.waiting.state).toBe('starting')
    expect(seen.before).toEqual(['migrate', 'test'])
    expect(seen.secondEnded.state).toBe('done')
    expect(seen.after).toEqual([])
    expect(history()).toEqual(['migrate', 'test', 'migrate', 'test'])
  })

  test('two Projects declaring "Shared Database" and "shared database" share one reservation', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const hemera = yield* project('Hemera')
          const hemeraTest = yield* command(hemera.id, 'test', nodeLine(writes, log, 'hemera test'))
          yield* saveResources(hemera.id, [
            resource({ name: 'Shared Database', uses: [hemeraTest.id] }),
          ])
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(hemera.id, 'Rename the settings page')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const waiting = yield* run(hemera.id, second.id, hemeraTest.id)
          const blocked = yield* until(marksOf(second.id), (marks) => marks.length > 0)
          const all = yield* holders
          return { blocked, all, state: (yield* getRun(waiting.id)).state, first }
        }),
      ),
    )
    expect(seen.blocked).toEqual([`blocked by Shared Database · ${seen.first.key}`])
    expect(seen.state).toBe('starting')
    expect(seen.all).toHaveLength(1)
    expect(seen.all[0]).toMatchObject({
      key: 'shared database',
      holder: { missionKey: seen.first.key, readiness: 'ready' },
    })
    expect(seen.all[0]?.queue).toHaveLength(1)
  })

  test('an undeclared command and a free line run at once, never waiting', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand, lint } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const blockedRun = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(marksOf(second.id), (marks) => marks.length > 0)
          const undeclared = yield* ended((yield* run(acmeProject.id, second.id, lint.id)).id)
          // The very line of the declared command, written by hand, is not recognised (CT-40).
          const free = yield* ended(
            (yield* run(acmeProject.id, second.id, null, {
              line: nodeLine(writes, log, 'free test'),
            })).id,
          )
          return { undeclared, free, blocked: yield* getRun(blockedRun.id) }
        }),
      ),
    )
    expect(seen.undeclared.state).toBe('done')
    expect(seen.free.state).toBe('done')
    expect(seen.blocked.state).toBe('starting')
    expect(history()).toEqual(['migrate', 'test', 'lint', 'free test'])
  })
})

describe('Outside Building, and at Cancel', () => {
  test('a declared command run in Review takes the reservation for its own duration, waiting like any other, and lets it go when it ends', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* moveMission(second.id, 'endBuilding', 'hemera')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const live = yield* run(acmeProject.id, second.id, testCommand.id)
          const blocked = yield* until(marksOf(second.id), (marks) => marks.length > 0)
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          const done = yield* ended(live.id)
          const holder = yield* until(holderOf, (id) => id === null)
          return { blocked, done, holder }
        }),
      ),
    )
    expect(seen.blocked).toEqual(['blocked by shared database · ACME-1'])
    expect(seen.done.state).toBe('done')
    expect(seen.holder).toBeNull()
    expect(history()).toEqual(['migrate', 'test', 'migrate', 'test'])
  })

  test('a Cancel of the holder releases the reservation, and the next mission takes it', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const waiting = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(queueOf, (queue) => queue.length === 1)
          yield* moveMission(first.id, 'cancel', 'user')
          return { done: yield* ended(waiting.id), holder: yield* holderOf, second }
        }),
      ),
    )
    expect(seen.done.state).toBe('done')
    expect(seen.holder).toBe(seen.second.id)
  })
})

describe('A resource is handed over only once what its holder runs on it has ended', () => {
  /**
   * Acme, its shared database used by `long test` (which stays up, its pid written down) and by
   * `test` (which fails, writing "collision", while `long test` is alive), reset by `migrate`.
   */
  const sharing = (deaf: boolean) =>
    Effect.gen(function* () {
      const pid = join(work, 'long-test.pid')
      const acmeProject = yield* project('Acme')
      const migrate = yield* command(acmeProject.id, 'migrate', nodeLine(writes, log, 'migrate'))
      const long = yield* command(
        acmeProject.id,
        'long test',
        nodeLine(holds, pid, log, 'long test', deaf ? 'deaf' : 'hears'),
      )
      const tests = yield* command(acmeProject.id, 'test', nodeLine(checks, pid, log, 'test'))
      yield* saveResources(acmeProject.id, [
        resource({ uses: [long.id, tests.id], resetCommandId: migrate.id }),
      ])
      return { project: acmeProject, long, test: tests }
    })

  /** A third mission's asking settles the reservations under their lock, after what came before. */
  const settledBy = (missionId: string) =>
    Effect.gen(function* () {
      const before = (yield* queueOf).length
      yield* Effect.forkChild(acquire(missionId))
      yield* until(queueOf, (queue) => queue.includes(missionId) || queue.length < before)
    })

  test('a mission leaving Building while its run still uses the resource keeps it until that run ends; the next one waits', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, long, test: testCommand } = yield* sharing(false)
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const third = yield* building(acmeProject.id, 'Archive the old invoices')
          const longRun = yield* run(acmeProject.id, first.id, long.id)
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('long test'),
          )
          const waiting = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(queueOf, (queue) => queue.length === 1)
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          yield* settledBy(third.id)
          const holderThen = yield* holderOf
          const waitingThen = (yield* getRun(waiting.id)).state
          yield* stopRun(longRun.id)
          const done = yield* ended(waiting.id)
          return { first, holderThen, waitingThen, done }
        }),
      ),
    )
    expect(seen.holderThen).toBe(seen.first.id)
    expect(seen.waitingThen).toBe('starting')
    expect(seen.done.state).toBe('done')
    expect(history()).toEqual(['migrate', 'long test', 'migrate', 'test'])
  })

  test('a Cancel of the holder hands the resource over only once its stopped runs have ended', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, long, test: testCommand } = yield* sharing(true)
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const third = yield* building(acmeProject.id, 'Archive the old invoices')
          const longRun = yield* run(acmeProject.id, first.id, long.id)
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('long test'),
          )
          const waiting = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(queueOf, (queue) => queue.length === 1)
          const cancelling = yield* Effect.forkChild(moveMission(first.id, 'cancel', 'user'))
          yield* until(getMission(first.id), (mission) => mission.stage === 'cancelled')
          yield* settledBy(third.id)
          const holderThen = yield* holderOf
          const longThen = (yield* getRun(longRun.id)).state
          yield* Fiber.join(cancelling)
          const done = yield* ended(waiting.id)
          return { first, holderThen, longThen, done }
        }),
      ),
    )
    // Whenever the next mission holds it, the cancelled one's run has ended.
    expect(seen.holderThen === seen.first.id || seen.longThen !== 'running').toBe(true)
    expect(seen.done.state).toBe('done')
    expect(history()).not.toContain('collision')
    expect(history()).toEqual(['migrate', 'long test', 'migrate', 'test'])
  })

  test('a Cancel while the reset runs lets the resource go once the stopped reset has ended, without asking about it', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme('stays')
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* Effect.forkChild(acquire(first.id))
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('migrate'),
          )
          yield* Effect.forkChild(acquire(second.id))
          yield* until(queueOf, (queue) => queue.length === 1)
          yield* moveMission(first.id, 'cancel', 'user')
          const next = yield* until(holderOf, (id) => id === second.id)
          return { second, next, needs: yield* needsOf(first.id) }
        }),
      ),
    )
    expect(seen.next).toBe(seen.second.id)
    expect(seen.needs).toEqual([])
  })

  test('a release while the reset still runs lets the resource go once the reset has ended', async () => {
    const gate = join(work, 'migrated')
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acmeProject = yield* project('Acme')
          const migrate = yield* command(
            acmeProject.id,
            'migrate',
            nodeLine(writesThenWaits, log, 'migrate', gate),
          )
          yield* saveResources(acmeProject.id, [resource({ resetCommandId: migrate.id })])
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const holding = yield* Effect.forkChild(Effect.result(acquire(first.id)))
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('migrate'),
          )
          yield* Effect.forkChild(acquire(second.id))
          yield* until(queueOf, (queue) => queue.length === 1)
          const released = yield* release(first.id)
          const holderThen = yield* holderOf
          const resetsThen = history()
          writeFileSync(gate, '')
          const lost = yield* Fiber.join(holding)
          const next = yield* until(
            holders,
            (all) => all[0]?.holder?.missionId === second.id && all[0].holder.readiness === 'ready',
          )
          return { first, second, released, holderThen, resetsThen, lost, next }
        }),
      ),
    )
    expect(seen.released).toBe(true)
    expect(seen.holderThen).toBe(seen.first.id)
    expect(seen.resetsThen).toEqual(['migrate'])
    expect(Result.isFailure(seen.lost)).toBe(true)
    expect(seen.next[0]?.holder?.missionId).toBe(seen.second.id)
    expect(history()).toEqual(['migrate', 'migrate'])
  })
})

describe('Taking the reservation', () => {
  test('with a reset command, it runs once at each take, before the first declared command', async () => {
    await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          yield* moveMission(first.id, 'fix', 'user')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
        }),
      ),
    )
    expect(history()).toEqual(['migrate', 'test', 'test', 'migrate', 'test'])
  })

  test('a failed reset becomes an error need with its output and nothing declared runs; Retry runs it again', async () => {
    const broken = join(work, 'broken')
    writeFileSync(broken, '')
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme('broken', broken)
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const waiting = yield* run(acmeProject.id, first.id, testCommand.id)
          const needs = yield* until(needsOf(first.id), (pending) => pending.length > 0)
          const state = (yield* getRun(waiting.id)).state
          const before = history()
          rmSync(broken)
          yield* answerNeed({
            id: needs[0]?.id ?? '',
            answer: ChosenAnswer.make({ option: 'Retry' }),
            key: 'retry-1',
          })
          return { needs, state, before, after: yield* ended(waiting.id) }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(Predicate.isTagged(seen.needs[0]?.fields, 'Error')).toBe(true)
    expect(seen.needs[0]?.fields).toMatchObject({
      failed: 'The reset of shared database failed: migrate',
      proposals: ['Retry', 'Release'],
    })
    expect(JSON.stringify(seen.needs[0]?.fields)).toContain('migration 12 failed')
    expect(seen.state).toBe('starting')
    expect(seen.before).toEqual([])
    expect(seen.after.state).toBe('done')
    expect(history()).toEqual(['migrate', 'test'])
  })

  test('a failed reset answered Release lets the reservation go: the run waiting for it fails and the next mission takes it', async () => {
    const broken = join(work, 'broken')
    writeFileSync(broken, '')
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme('broken', broken)
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const waiting = yield* run(acmeProject.id, first.id, testCommand.id)
          const needs = yield* until(needsOf(first.id), (pending) => pending.length > 0)
          yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(marksOf(second.id), (marks) => marks.length > 0)
          yield* answerNeed({
            id: needs[0]?.id ?? '',
            answer: ChosenAnswer.make({ option: 'Release' }),
            key: 'release-1',
          })
          const failed = yield* ended(waiting.id)
          const holder = yield* until(holderOf, (id) => id === second.id)
          return { failed, holder, second }
        }),
      ),
    )
    expect(seen.failed.state).toBe('failed')
    expect(seen.holder).toBe(seen.second.id)
  })

  test('without a reset command, taking the reservation opens one need and the declared commands wait until it is answered, while undeclared work goes on', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand, lint } = yield* acme(false)
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const one = yield* run(acmeProject.id, first.id, testCommand.id)
          const two = yield* run(acmeProject.id, first.id, testCommand.id)
          const needs = yield* until(needsOf(first.id), (pending) => pending.length > 0)
          const undeclared = yield* ended((yield* run(acmeProject.id, first.id, lint.id)).id)
          const waiting = [(yield* getRun(one.id)).state, (yield* getRun(two.id)).state]
          const before = history()
          yield* retryNeed(needs[0]?.id ?? '')
          return {
            needs,
            undeclared,
            waiting,
            before,
            after: [(yield* ended(one.id)).state, (yield* ended(two.id)).state],
            left: yield* needsOf(first.id),
          }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.fields).toEqual(
      EnvironmentFields.make({
        missing: 'ACME-1 now holds shared database',
        action: 'Bring it to the state this mission expects, then confirm.',
        settingsSection: null,
      }),
    )
    expect(seen.undeclared.state).toBe('done')
    expect(seen.waiting).toEqual(['starting', 'starting'])
    expect(seen.before).toEqual(['lint'])
    expect(seen.after).toEqual(['done', 'done'])
    expect(seen.left).toEqual([])
    expect(history()).toEqual(['lint', 'test', 'test'])
  })
})

describe('Two at once: the reservation under concurrency', () => {
  test('two acquires racing for a free resource: one holds it, the other waits behind it', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          // Both started before either is looked at: they race for the lock.
          const one = yield* Effect.forkChild(acquire(first.id))
          const two = yield* Effect.forkChild(acquire(second.id))
          const all = yield* until(
            holders,
            (now) => now[0]?.holder?.readiness === 'ready' && now[0].queue.length === 1,
          )
          const holder = all[0]?.holder?.missionId
          const waiter = holder === first.id ? second : first
          yield* Fiber.join(holder === first.id ? one : two)
          const waiting = yield* marksOf(waiter.id)
          yield* release(holder ?? '')
          yield* Fiber.join(holder === first.id ? two : one)
          return { all, holder, waiter, waiting, after: yield* holders }
        }),
      ),
    )
    expect(seen.all[0]?.queue.map((one) => one.missionId)).toEqual([seen.waiter.id])
    expect(seen.waiting).toHaveLength(1)
    expect(seen.after[0]?.holder?.missionId).toBe(seen.waiter.id)
    expect(seen.after[0]?.queue).toEqual([])
    expect(history()).toEqual(['migrate', 'migrate'])
  })

  test('an acquire racing a release: the acquirer ends up holding it, never two holders', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const rounds: Array<readonly [string | null, number]> = []
          let holder = first
          let next = second
          yield* acquire(holder.id)
          for (let round = 0; round < 4; round += 1) {
            yield* Effect.all([release(holder.id), acquire(next.id)], { concurrency: 'unbounded' })
            const all = yield* holders
            rounds.push([all[0]?.holder?.missionId ?? null, all[0]?.queue.length ?? -1])
            ;[holder, next] = [next, holder]
          }
          return { rounds, first, second }
        }),
      ),
    )
    expect(seen.rounds).toEqual([
      [seen.second.id, 0],
      [seen.first.id, 0],
      [seen.second.id, 0],
      [seen.first.id, 0],
    ])
    expect(history()).toHaveLength(5)
  })

  test('a waiter interrupted while it waits leaves the queue, and its mark clears', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const waiting = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(marksOf(second.id), (marks) => marks.length > 0)
          const queued = yield* queueOf
          const stopped = yield* stopRun(waiting.id)
          const queue = yield* queueOf
          const marks = yield* marksOf(second.id)
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          const holder = yield* until(holderOf, (id) => id === null)
          return { queued, stopped, queue, marks, holder, second }
        }),
      ),
    )
    expect(seen.queued).toEqual([seen.second.id])
    expect(seen.stopped.state).toBe('stopped')
    expect(seen.queue).toEqual([])
    expect(seen.marks).toEqual([])
    expect(seen.holder).toBeNull()
    expect(history()).toEqual(['migrate', 'test'])
  })

  test('a waiter that leaves the queue takes its mark with it, or neither goes when the data folder refuses', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const waiting = yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(marksOf(second.id), (marks) => marks.length > 0)
          yield* Database.use((database) =>
            database.run(sql`CREATE TRIGGER refuse_marks BEFORE DELETE ON mission_marks
              BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`),
          )
          yield* stopRun(waiting.id)
          return { queue: yield* queueOf, marks: yield* marksOf(second.id), second }
        }),
      ),
    )
    expect(seen.queue).toEqual([seen.second.id])
    expect(seen.marks).toEqual(['blocked by shared database · ACME-1'])
  })

  test('a release by a mission that does not hold it changes nothing', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const other = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* acquire(first.id)
          const released = yield* release(other.id)
          return { released, holder: yield* holderOf, first }
        }),
      ),
    )
    expect(seen.released).toBe(false)
    expect(seen.holder).toBe(seen.first.id)
  })

  test('a double release releases once, and never the next holder', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* acquire(first.id)
          const waiter = yield* Effect.forkChild(acquire(second.id))
          yield* until(queueOf, (queue) => queue.length === 1)
          const twice = yield* Effect.all([release(first.id), release(first.id)], {
            concurrency: 'unbounded',
          })
          yield* Fiber.join(waiter)
          const again = yield* release(first.id)
          return { twice, again, holder: yield* holderOf, second }
        }),
      ),
    )
    expect([...seen.twice].sort()).toEqual([false, true])
    expect(seen.again).toBe(false)
    expect(seen.holder).toBe(seen.second.id)
  })
  test('a run stopped just as its wait for the reservation succeeds still leaves it when it ends', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          let waited = false
          let leaves = 0
          const runs = yield* Runs
          // The reservation promises its leave in the step that takes it, as the real one does; the
          // stop reaches the run right then and lands at its very next step, the narrowest window a
          // real stop can hit once the reservation is taken.
          runs.reservations.current = {
            enter: () =>
              Effect.succeed({
                wait: (runEnded) =>
                  Effect.withFiber((fiber) =>
                    Effect.andThen(
                      Effect.forkDetach(
                        Effect.andThen(
                          runEnded,
                          Effect.sync(() => {
                            leaves += 1
                          }),
                        ),
                      ),
                      Effect.sync(() => {
                        waited = true
                        fiber.interruptUnsafe()
                      }),
                    ),
                  ),
              }),
          }
          const started = yield* run(acmeProject.id, mission.id, testCommand.id)
          yield* until(
            Effect.sync(() => waited),
            (done) => done,
          )
          const stopped = yield* stopRun(started.id)
          const left = yield* until(
            Effect.sync(() => leaves),
            (count) => count > 0,
          )
          return { stopped, left }
        }),
      ),
    )
    expect(seen.stopped.state).toBe('stopped')
    expect(seen.left).toBe(1)
    expect(history()).toEqual([])
  })
})

describe('What the mission page and the settings follow', () => {
  test('the holders are told now, then again at each change of a reservation', async () => {
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const told = yield* Deferred.make<void>()
          const follower = yield* Stream.unwrap(
            ExclusiveResources.useSync((resources) => resources.changes),
          ).pipe(
            Stream.tap(() => Deferred.succeed(told, undefined)),
            Stream.filter((all) => all[0]?.holder?.readiness === 'ready'),
            Stream.runHead,
            Effect.forkChild,
          )
          yield* Deferred.await(told)
          yield* acquire(first.id)
          return yield* Fiber.join(follower)
        }),
      ),
    )
    expect(Option.getOrNull(seen)?.[0]).toMatchObject({
      key: 'shared database',
      names: ['shared database'],
      holder: { missionKey: 'ACME-1', readiness: 'ready' },
      queue: [],
    })
  })
})

describe('A restart', () => {
  test('restart while one holds and others wait: the holder keeps it, the queue keeps its order', async () => {
    const before = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          const third = yield* building(acmeProject.id, 'Archive the old invoices')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          yield* run(acmeProject.id, second.id, testCommand.id)
          yield* until(queueOf, (queue) => queue.length === 1)
          yield* run(acmeProject.id, third.id, testCommand.id)
          yield* until(queueOf, (queue) => queue.length === 2)
          return { first, second, third, testId: testCommand.id, projectId: acmeProject.id }
        }),
      ),
    )
    const after = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const kept = { holder: yield* holderOf, queue: yield* queueOf }
          const marks = yield* marksOf(before.third.id)
          yield* moveMission(before.first.id, 'endBuilding', 'hemera')
          const next = yield* until(holderOf, (id) => id === before.second.id)
          return { kept, marks, next, queue: yield* queueOf }
        }),
      ),
    )
    expect(after.kept).toEqual({
      holder: before.first.id,
      queue: [before.second.id, before.third.id],
    })
    expect(after.marks).toEqual(['blocked by shared database · ACME-1'])
    expect(after.next).toBe(before.second.id)
    expect(after.queue).toEqual([before.third.id])
  })

  test('a held reservation whose mission left Building while the engine was stopped is released at start, with a Journal line', async () => {
    const first = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          yield* ended((yield* run(acmeProject.id, mission.id, testCommand.id)).id)
          return mission
        }),
      ),
    )
    // Moved by an engine that stopped before its reservations heard of it.
    await on(
      data,
      Database.use((database) =>
        database.update(missions).set({ stage: 'review' }).where(eq(missions.id, first.id)),
      ),
    )
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const holder = yield* holderOf
          const events = (yield* readEvents({
            entity: { kind: 'resource', id: 'shared database' },
          })).events
          const journal = yield* until(
            Memory.use((memory) => memory.journal(first.id, null)),
            (page) =>
              page.lines.some((line) => line.kind === 'resource' && line.text.includes('start')),
          )
          return { holder, events, journal }
        }),
      ),
    )
    expect(seen.holder).toBeNull()
    expect(seen.events.map((event) => event.type)).toContain('resource.released_at_start')
    expect(seen.journal.lines.map((line) => line.text)).toContain(
      'Released shared database at the start: the mission left Building',
    )
  })
})

describe('Actions on a shared resource always ask', () => {
  test('an agent’s run of a "change" command becomes a permission need even when the judge would allow it, offering Allow once and Deny', async () => {
    const asked: Array<{ readonly reason: string; readonly sensitive: boolean }> = []
    const requests = Layer.succeed(PermissionRequests, {
      request: ({ reason, sensitive }) =>
        Effect.sync(() => {
          asked.push({ reason, sensitive })
          return { answer: 'refused: approvals are not available yet' }
        }),
    })
    const allows = Layer.succeed(Judge, {
      judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
    })
    const answers = await engine({
      tools: { home: work, permissionRequests: requests, judge: allows },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, migrate, test: testCommand } = yield* acme()
          const seed = yield* command(acmeProject.id, 'seed', nodeLine(writes, log, 'seed'))
          yield* saveResources(acmeProject.id, [
            resource({ uses: [testCommand.id], changes: [seed.id], resetCommandId: migrate.id }),
          ])
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const builder = yield* sessionOf('builder', acmeProject.mainCheckout, {
            kind: 'mission',
            id: mission.id,
          })
          return yield* Effect.all([
            callTool(builder.grantId, 'commands_run', { command: seed.id }),
            callTool(builder.grantId, 'commands_run', { command: migrate.id }),
          ])
        }),
      ),
    )
    expect(answers.map((answer) => answer.ok)).toEqual([false, false])
    expect(asked).toEqual([
      { reason: 'action on a shared resource: shared database', sensitive: true },
      { reason: 'action on a shared resource: shared database', sensitive: true },
    ])
    expect(history()).toEqual([])
  })
})

describe('An action cut short on a shared resource', () => {
  test('a reset killed with the engine is indeterminate at restart and becomes a decision need, never rerun', async () => {
    const before = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme('stays')
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const waiting = yield* run(acmeProject.id, mission.id, testCommand.id)
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('migrate'),
          )
          return { mission, waiting, testId: testCommand.id, projectId: acmeProject.id }
        }),
      ),
    )
    const seen = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const needs = yield* until(needsOf(before.mission.id), (pending) => pending.length > 0)
          const reran = history()
          yield* answerNeed({
            id: needs[0]?.id ?? '',
            answer: ChosenAnswer.make({ option: 'It is already done' }),
            key: 'done-1',
          })
          const next = yield* ended(
            (yield* run(before.projectId, before.mission.id, before.testId)).id,
          )
          return { needs, reran, next }
        }),
      ),
    )
    expect(seen.needs).toHaveLength(1)
    expect(seen.needs[0]?.fields).toEqual(
      DecisionFields.make({
        question:
          'migrate may have run on shared database when Hemera stopped: check its real state. What happened?',
        options: ['Run it again', 'It is already done'],
        recommended: null,
      }),
    )
    expect(seen.reran).toEqual(['migrate'])
    expect(seen.next.state).toBe('done')
    expect(history()).toEqual(['migrate', 'test'])
  })

  test('an agent’s "change" command left without an outcome becomes a decision need on its mission', async () => {
    const before = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, migrate, test: testCommand } = yield* acme()
          const seed = yield* command(acmeProject.id, 'seed', nodeLine(writes, log, 'seed'))
          yield* saveResources(acmeProject.id, [
            resource({ uses: [testCommand.id], changes: [seed.id], resetCommandId: migrate.id }),
          ])
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          // What `commands_run` writes before the run starts; the engine stops before its outcome.
          yield* EffectfulActions.use((actions) =>
            actions.begin(
              'command.run',
              { kind: 'mission', missionId: mission.id, taskId: null },
              {
                command: seed.id,
                line: seed.line,
                folder: null,
                sessionId: 'session-1',
              },
            ),
          )
          // A command that only uses it is not asked about.
          yield* EffectfulActions.use((actions) =>
            actions.begin(
              'command.run',
              { kind: 'mission', missionId: mission.id, taskId: null },
              {
                command: testCommand.id,
                line: testCommand.line,
                folder: null,
                sessionId: 'session-1',
              },
            ),
          )
          return { mission }
        }),
      ),
    )
    const needs = await engine()(({ profile }) =>
      profile.use(until(needsOf(before.mission.id), (pending) => pending.length > 0)),
    )
    expect(needs).toHaveLength(1)
    expect(needs[0]?.owner).toEqual(
      MissionOwner.make({
        projectId: before.mission.projectId,
        missionId: before.mission.id,
        taskId: null,
      }),
    )
    expect(needs[0]?.fields).toEqual(
      DecisionFields.make({
        question:
          'seed may have run on shared database when Hemera stopped: check its real state. What happened?',
        options: ['Run it again', 'It is already done'],
        recommended: null,
      }),
    )
  })

  test('an agent’s declared command waiting in the queue has no intent written until it launches', async () => {
    const allows = Layer.succeed(Judge, {
      judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
    })
    const seen = await engine({ tools: { home: work, judge: allows } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme()
          const first = yield* building(acmeProject.id, 'Export the invoices as CSV')
          const second = yield* building(acmeProject.id, 'Import the invoices from CSV')
          yield* ended((yield* run(acmeProject.id, first.id, testCommand.id)).id)
          const builder = yield* sessionOf('builder', acmeProject.mainCheckout, {
            kind: 'mission',
            id: second.id,
          })
          const calling = yield* Effect.forkChild(
            callTool(builder.grantId, 'commands_run', { command: testCommand.id }),
          )
          yield* until(marksOf(second.id), (marks) => marks.length > 0)
          const ofTest = (all: ReadonlyArray<EffectfulAction>) =>
            all.filter((one) => JSON.stringify(one.details).includes(testCommand.id))
          const whileWaiting = ofTest(yield* listActions())
          yield* moveMission(first.id, 'endBuilding', 'hemera')
          const answer = yield* Fiber.join(calling)
          const after = yield* until(Effect.map(listActions(), ofTest), (all) =>
            all.some((one) => one.state === 'done'),
          )
          return { whileWaiting, answer, after }
        }),
      ),
    )
    expect(seen.whileWaiting).toEqual([])
    expect(seen.answer.ok).toBe(true)
    expect(seen.after.map((one) => one.state)).toEqual(['done'])
  })

  test('a reset still waiting for permission when the engine stopped never launched: at restart it is not asked about, it is taken again', async () => {
    const never = Layer.succeed(AskBeforeRunning, { decide: () => Effect.never })
    const before = await engine({ askBeforeRunning: never })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const acmeProject = yield* project('Acme')
          const migrate = yield* saveCommand({
            projectId: acmeProject.id,
            id: null,
            command: {
              ...draft('migrate', nodeLine(writes, log, 'migrate')),
              askBeforeRunning: true,
            },
          })
          const tests = yield* command(acmeProject.id, 'test', nodeLine(writes, log, 'test'))
          yield* saveResources(acmeProject.id, [
            resource({ uses: [tests.id], resetCommandId: migrate.id }),
          ])
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          yield* run(acmeProject.id, mission.id, tests.id)
          yield* until(holders, (all) => all[0]?.holder?.readiness === 'resetting')
          return { mission }
        }),
      ),
    )
    const allowed = Layer.succeed(AskBeforeRunning, { decide: () => Effect.succeed('allowed') })
    const seen = await engine({ askBeforeRunning: allowed })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const ready = yield* until(holders, (all) => all[0]?.holder?.readiness === 'ready')
          return { ready, needs: yield* needsOf(before.mission.id) }
        }),
      ),
    )
    expect(seen.needs).toEqual([])
    expect(seen.ready[0]?.holder?.readiness).toBe('ready')
    expect(history()).toEqual(['migrate'])
  })

  test('a reset a stop cut short is asked about at the start, before anything else, whatever becomes of its action', async () => {
    const before = await engine()(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project: acmeProject, test: testCommand } = yield* acme('stays')
          const mission = yield* building(acmeProject.id, 'Export the invoices as CSV')
          yield* run(acmeProject.id, mission.id, testCommand.id)
          yield* until(
            Effect.sync(() => history()),
            (lines) => lines.includes('migrate'),
          )
          return { mission }
        }),
      ),
    )
    // No handler of indeterminate actions: the reservation alone must not stay "resetting".
    const seen = await engine({ actionRules: actionRulesLayer() })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const needs = yield* until(needsOf(before.mission.id), (pending) => pending.length > 0)
          return { needs, all: yield* holders }
        }),
      ),
    )
    expect(seen.needs.map((need) => need.fields)).toEqual([
      DecisionFields.make({
        question:
          'migrate may have run on shared database when Hemera stopped: check its real state. What happened?',
        options: ['Run it again', 'It is already done'],
        recommended: null,
      }),
    ])
    expect(seen.all[0]?.holder?.readiness).toBe('needs-you')
    expect(history()).toEqual(['migrate'])
  })
})
