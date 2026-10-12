/**
 * The Project's checks, run by Hemera during a Building (#143): read from the mission's copy, run
 * through the run service in the Workspace with Hemera as the author, in each place the check
 * names, judged by their exit code or the number their output shows, waiting for a permission or
 * an exclusive resource like any of Hemera's runs, and run again when a stop cut them.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, the test driving the
 * Builder's and a helper's tools through their grants; Acme's real repositories in temporary
 * folders as the Workspace, and a small Node script as every check.
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { type CheckDraft, PermissionAnswer } from '@hemera/core/domain'
import type { BuildingAttemptView, CommandDraft } from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Effect, Fiber, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { removeCommand, saveCommand } from '../src/engine/catalogue.ts'
import { getMission, moveMission } from '../src/engine/missions.ts'
import { answerNeed, retryNeed } from '../src/engine/needs.ts'
import { saveCheck } from '../src/engine/project-checks.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { ExclusiveResources } from '../src/engine/resources/reservations.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingAttempts,
  buildingCheckResults,
  buildingCheckRuns,
  commandRuns,
  domainEvents,
  memoryJournal,
} from '../src/engine/storage/schema.ts'
import { call, eventsOf, grantOf, plannedIn } from './building-world.ts'
import { PLAN, builderAgents, builderOf, buildingNow, launched } from './builder-world.ts'
import { nodeLine } from './commands-engine.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
let scripts: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-checks'))
  work = realpathSync.native(temporaryFolder('building-checks-work'))
  scripts = realpathSync.native(temporaryFolder('building-checks-scripts'))
})
afterEach(removeFolders)

/** The engine with the Builder of this version, its real checks, and every agent call allowed. */
const checksEngine = (dataFolder: string, hold: BuilderHold = () => Effect.void) =>
  sessionsEngine(dataFolder, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: { hold },
  })

/**
 * A check's script: waits for `release` when it names one, notes where it ran and with which
 * files in `log`, prints `printed`, and exits with `code`.
 */
const CHECK = `
import { appendFileSync, existsSync } from 'node:fs'
const [log, release, code, printed, ...files] = process.argv.slice(2)
const wait = () => new Promise((done) => setTimeout(done, 20))
appendFileSync(log, JSON.stringify({ cwd: process.cwd(), files, started: true }) + '\\n')
while (release !== '-' && !existsSync(release)) await wait()
appendFileSync(log, JSON.stringify({ cwd: process.cwd(), files }) + '\\n')
if (printed !== '-') process.stdout.write(printed + '\\n')
process.exit(Number(code))
`

const checkScript = () => {
  const path = join(scripts, 'check.mjs')
  if (!existsSync(path)) writeFileSync(path, CHECK)
  return path
}

/** The line of a check that notes its run in `log`, prints `printed` and exits `code`. */
const checkLine = (
  log: string,
  code: number,
  printed = '-',
  more: { readonly release?: string; readonly files?: boolean } = {},
) =>
  `${nodeLine(checkScript(), join(scripts, log), more.release ?? '-', String(code), printed)}${more.files === true ? ' {files}' : ''}`

/** Each run a check's script noted in `log`, once it ended. */
const ranIn = (log: string): ReadonlyArray<{ cwd: string; files: ReadonlyArray<string> }> => {
  const path = join(scripts, log)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((one) => one.started !== true)
}

const check = (name: string, line: string, more: Partial<CheckDraft> = {}): CheckDraft => ({
  name,
  commandId: null,
  line,
  where: 'root',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
  ...more,
})

const command = (name: string, line: string, more: Partial<CommandDraft> = {}): CommandDraft => ({
  name,
  type: 'test',
  line,
  lineWindows: null,
  lineLinux: null,
  repositoryId: null,
  folder: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  check: true,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: true,
  writeGlobs: [],
  ...more,
})

/** A helper session of the mission, in the Builder's Workspace: its grant. */
const helperOf = (missionId: string, folder: string) =>
  Effect.gen(function* () {
    const helper = yield* openSession({
      provider: 'claude',
      owner: { kind: 'mission', missionId },
      role: 'helper',
      folder,
      parent: null,
      chosen: { model: null, effort: null, mode: null },
      modelLevel: null,
    })
    return yield* grantOf(helper.id)
  })

const attemptsOf = (
  view: {
    readonly tasks: ReadonlyArray<{ id: string; attempts: ReadonlyArray<BuildingAttemptView> }>
  },
  taskId: string,
) => view.tasks.find((task) => task.id === taskId)?.attempts ?? []

const checksOf = (attempt: BuildingAttemptView | undefined) =>
  (attempt?.checks ?? []).map((one) => ({
    name: one.name,
    place: one.place,
    verdict: one.verdict,
    detail: one.detail,
  }))

/** The mission's Journal, once it holds a line starting so (#39's projection is not immediate). */
const journalWith = (missionId: string, start: string) =>
  Effect.gen(function* () {
    const lines = Effect.gen(function* () {
      const database = yield* Database
      const rows = yield* database
        .select({ text: memoryJournal.text })
        .from(memoryJournal)
        .where(eq(memoryJournal.missionId, missionId))
      return rows.map((row) => row.text)
    })
    yield* until(Effect.map(lines, (all) => all.some((line) => line.startsWith(start))))
    return yield* lines
  })

/** Writes a file through the agent's tool, its current content read first. */
const written = (grantId: string, repository: string, path: string, content: string) =>
  Effect.gen(function* () {
    yield* call(grantId, 'fs_read', { repository, path })
    return yield* call(grantId, 'fs_write', { repository, path, content })
  })

describe('Where a check runs', () => {
  test('a changed check runs in each repository with attributed files and nowhere else: a file changed in another repository by another task does not count', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.asVoid(
                saveCheck(
                  projectId,
                  null,
                  check('lint', checkLine('lint.log', 0), { where: 'changed' }),
                ),
              ),
            'The exports change api, web and nothing else',
          )
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(helper, 'task_start', { task: 'T2' })
          yield* written(grantId, 'api', 'invoices.ts', 'export const invoices = ["csv"]\n')
          yield* call(helper, 'fs_write', {
            repository: 'web',
            path: 'export.md',
            content: 'Markdown.\n',
          })
          const finished = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          const ranAfterT1 = ranIn('lint.log').map((one) => basename(one.cwd))
          yield* call(helper, 'task_finished', { task: 'T2', summary: 'Markdown.' })
          return { finished, ranAfterT1, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.finished).toBe('T1 is done, verified.')
    expect(seen.ranAfterT1).toEqual(['api'])
    expect(checksOf(attemptsOf(seen.view, 'T1')[0])).toEqual([
      { name: 'lint', place: 'api', verdict: 'green', detail: '' },
    ])
    expect(checksOf(attemptsOf(seen.view, 'T2')[0])).toEqual([
      { name: 'lint', place: 'web', verdict: 'green', detail: '' },
    ])
    expect(attemptsOf(seen.view, 'T1')[0]?.checks[0]?.shown).toBe('quiet')
    expect(ranIn('lint.log').map((one) => basename(one.cwd))).toEqual(['api', 'web'])
  })
})

describe('{files}', () => {
  test('{files} with **/*.test.ts runs only the tests the task wrote; with none, the check is skipped and the task is done, not verified', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            Effect.asVoid(
              saveCheck(
                projectId,
                null,
                check('unit', checkLine('unit.log', 0, '-', { files: true }), {
                  where: 'changed',
                  files: '**/*.test.ts',
                }),
              ),
            ),
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* written(grantId, 'api', 'invoices.ts', 'export const invoices = ["csv"]\n')
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.test.ts',
            content: 'test("csv", () => {})\n',
          })
          const first = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* call(grantId, 'task_start', { task: 'T2' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = true\n',
          })
          const second = yield* call(grantId, 'task_finished', { task: 'T2', summary: 'Md.' })
          return { first, second, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.first).toBe('T1 is done, verified.')
    expect(ranIn('unit.log').map((one) => one.files)).toEqual([['invoices.test.ts']])
    expect(checksOf(attemptsOf(seen.view, 'T2')[0])).toEqual([
      { name: 'unit', place: 'api', verdict: 'skipped', detail: 'no file matched **/*.test.ts' },
    ])
    expect(seen.second).toBe('T2 is done, not verified: no check ran.')
    const t2 = seen.view.tasks.find((task) => task.id === 'T2')
    expect([t2?.state, t2?.verified]).toEqual(['done', false])
  })
})

describe('The verdict of a check', () => {
  test('64.2 under a minimum of 70 is red with "64.2 < 70"; a run that exits 1 is red whatever it printed; a command removed from the Project after launch still runs from the mission’s copy', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          let failing = ''
          const { project, mission } = yield* launched(work, (projectId) =>
            Effect.gen(function* () {
              yield* saveCheck(
                projectId,
                null,
                check('coverage', checkLine('coverage.log', 0, 'Coverage: 64.2%'), {
                  expect: { pattern: 'Coverage: ([0-9.]+)%', minimum: 70 },
                }),
              )
              const removed = yield* saveCommand({
                projectId,
                id: null,
                command: command('suite', checkLine('suite.log', 1, 'all good')),
              })
              failing = removed.id
              yield* saveCheck(
                projectId,
                null,
                check('suite', '', { commandId: removed.id, line: null }),
              )
            }),
          )
          yield* removeCommand(project.id, failing)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* written(grantId, 'api', 'invoices.ts', 'export const invoices = ["csv"]\n')
          const finished = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          return {
            finished,
            view: yield* buildingNow(mission.id),
            red: yield* eventsOf(mission.id, 'building.check_red'),
            journal: yield* journalWith(mission.id, 'Checks after T1'),
          }
        }),
      ),
    )
    expect(seen.finished).toMatch(/^T1 is red/)
    const [attempt] = attemptsOf(seen.view, 'T1')
    expect(checksOf(attempt)).toEqual([
      { name: 'coverage', place: '', verdict: 'red', detail: '64.2 < 70' },
      { name: 'suite', place: '', verdict: 'red', detail: 'exited with 1' },
    ])
    expect(attempt?.checks.map((one) => [one.value, one.exitCode, one.shown])).toEqual([
      [64.2, 0, 'stands-out'],
      [null, 1, 'stands-out'],
    ])
    expect(attempt?.checks.every((one) => one.runId !== null)).toBe(true)
    expect(ranIn('suite.log')).toHaveLength(1)
    expect(seen.red.map((one) => JSON.parse(one.payload))).toEqual([
      { check: 'coverage', place: '' },
      { check: 'suite', place: '' },
    ])
    expect(seen.journal).toContain('Checks after T1: red.')
    expect(seen.journal).toContain('coverage is red in the Workspace root.')
  })
})

describe('A check that asks before running', () => {
  const asking = (projectId: string) =>
    Effect.gen(function* () {
      const asked = yield* saveCommand({
        projectId,
        id: null,
        command: command('migrate-check', checkLine('asked.log', 0), { askBeforeRunning: true }),
      })
      yield* saveCheck(projectId, null, check('db', '', { commandId: asked.id, line: null }))
    })

  /** The mission's permission need waiting, once there is one. */
  const permissionNeed = (missionId: string) =>
    Effect.gen(function* () {
      yield* until(
        Effect.map(getMission(missionId), (one) =>
          one.needs.some((need) => Predicate.isTagged(need.fields, 'Permission')),
        ),
      )
      const found = (yield* getMission(missionId)).needs.find((need) =>
        Predicate.isTagged(need.fields, 'Permission'),
      )
      return found?.id ?? ''
    })

  test('an "ask before running" command makes the check wait for a permission need; Allow for this mission lets the next run go without asking', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, asking)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const finishing = yield* Effect.forkChild(
            call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }),
          )
          const need = yield* permissionNeed(mission.id)
          const waitedBeforeAnswer = ranIn('asked.log').length
          const waiting = yield* eventsOf(mission.id, 'building.check_waiting')
          yield* answerNeed({
            id: need,
            answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
            key: 'allow-1',
          })
          const first = yield* Fiber.join(finishing)
          yield* call(grantId, 'task_start', { task: 'T2' })
          const second = yield* call(grantId, 'task_finished', { task: 'T2', summary: 'Md.' })
          const needs = (yield* getMission(mission.id)).needs.filter((one) =>
            Predicate.isTagged(one.fields, 'Permission'),
          )
          return { waitedBeforeAnswer, waiting, first, second, needs }
        }),
      ),
    )
    expect(seen.waitedBeforeAnswer).toBe(0)
    expect(seen.waiting.map((one) => JSON.parse(one.payload))).toEqual([
      { check: 'db', place: '', waiting: 'permission' },
    ])
    expect(seen.first).toBe('T1 is done, verified.')
    expect(seen.second).toBe('T2 is done, verified.')
    // The second run asked nothing: no permission need waits.
    expect(seen.needs).toEqual([])
    expect(ranIn('asked.log')).toHaveLength(2)
  })

  test('Deny makes the check red with "denied by you"', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, asking)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const finishing = yield* Effect.forkChild(
            call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }),
          )
          const need = yield* permissionNeed(mission.id)
          yield* answerNeed({
            id: need,
            answer: PermissionAnswer.make({ choice: 'deny' }),
            key: 'deny-1',
          })
          const finished = yield* Fiber.join(finishing)
          return { finished, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.finished).toMatch(/^T1 is red/)
    expect(checksOf(attemptsOf(seen.view, 'T1')[0])).toEqual([
      { name: 'db', place: '', verdict: 'red', detail: 'denied by you' },
    ])
    expect(ranIn('asked.log')).toHaveLength(0)
  })
})

describe('A check on an exclusive resource', () => {
  test('a check declared on an exclusive resource held by another mission waits with the blocked mark', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          let declaredId = ''
          const { project, main, mission } = yield* launched(work, (projectId) =>
            Effect.gen(function* () {
              const declared = yield* saveCommand({
                projectId,
                id: null,
                command: command('db-check', checkLine('db.log', 0)),
              })
              declaredId = declared.id
              yield* saveCheck(
                projectId,
                null,
                check('db', '', { commandId: declared.id, line: null }),
              )
            }),
          )
          const { grantId } = yield* builderOf(mission.id)
          // Another mission of the Project takes the shared database, which its user brings back.
          const other = yield* plannedIn(project.id, main, 'Import the invoices')
          const taking = yield* Effect.forkChild(
            ExclusiveResources.use((resources) =>
              resources.acquire('Shared database', other.mission.id),
            ),
          )
          yield* until(
            Effect.map(getMission(other.mission.id), (one) =>
              one.needs.some((need) => Predicate.isTagged(need.fields, 'Environment')),
            ),
          )
          const environment = (yield* getMission(other.mission.id)).needs.find((need) =>
            Predicate.isTagged(need.fields, 'Environment'),
          )
          yield* retryNeed(environment?.id ?? '')
          yield* Fiber.join(taking)
          // Declared now: this Building's mission waits for it behind the other.
          const reset = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: command('db-reset', checkLine('reset.log', 0), { readOnly: false }),
          })
          yield* saveResources(project.id, [
            {
              name: 'Shared database',
              description: 'The team database.',
              uses: [declaredId],
              changes: [reset.id],
              resetCommandId: reset.id,
            },
          ])
          yield* call(grantId, 'task_start', { task: 'T1' })
          const finishing = yield* Effect.forkChild(
            call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }),
          )
          yield* until(
            Effect.map(eventsOf(mission.id, 'building.check_waiting'), (rows) => rows.length > 0),
          )
          const marks = (yield* getMission(mission.id)).marks.map((one) => one.sentence)
          const ranWhileHeld = ranIn('db.log').length
          const waiting = yield* eventsOf(mission.id, 'building.check_waiting')
          yield* ExclusiveResources.use((resources) =>
            resources.release('Shared database', other.mission.id, 'done'),
          )
          const finished = yield* Fiber.join(finishing)
          return { marks, ranWhileHeld, waiting, finished, otherKey: other.mission.key }
        }),
      ),
    )
    expect(seen.marks).toEqual([`blocked by Shared database · ${seen.otherKey}`])
    expect(seen.ranWhileHeld).toBe(0)
    expect(seen.waiting.map((one) => JSON.parse(one.payload))).toEqual([
      { check: 'db', place: '', waiting: 'Shared database' },
    ])
    expect(seen.finished).toBe('T1 is done, verified.')
    expect(ranIn('db.log')).toHaveLength(1)
  })
})

describe('A requirement’s checks', () => {
  test('a requirement’s checks run once every task covering it is done, not before, and once', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            Effect.asVoid(
              saveCheck(
                projectId,
                null,
                check('unit', checkLine('unit.log', 0), { when: 'requirement' }),
              ),
            ),
          )
          const { grantId } = yield* builderOf(mission.id)
          // T3 waits for T1 and T2: the order in which every task of R1 gets done.
          const ranBefore: number[] = []
          for (const task of ['T1', 'T2', 'T4', 'T3']) {
            ranBefore.push(ranIn('unit.log').length)
            yield* call(grantId, 'task_start', { task })
            yield* call(grantId, 'task_finished', { task, summary: 'Done.' })
          }
          yield* until(
            Effect.map(buildingNow(mission.id), (view) =>
              view.scopes.some((one) => one.verdict !== null),
            ),
          )
          return { ranBefore, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.ranBefore).toEqual([0, 0, 0, 0])
    expect(seen.view.scopes.map((one) => [one.scope, one.subject, one.verdict])).toEqual([
      ['requirement', 'R1', 'green'],
    ])
    expect(checksOf(seen.view.scopes[0])).toEqual([
      { name: 'unit', place: '', verdict: 'green', detail: '' },
    ])
    expect(ranIn('unit.log')).toHaveLength(1)
  })
})

describe('A restart while the task that completes a requirement is checking', () => {
  test('an engine stopped while the task that completes a requirement is checking: at the next start the requirement’s checks run once', async () => {
    const release = join(scripts, 'release-requirement')
    // T4 covers no requirement: T3 completes R1 and is not the last task.
    const plan = PLAN.map((task) =>
      task.title === 'Name the invoices' ? { ...task, requirements: [] } : task,
    )
    // T4 and T3 stay checking: the engine stops between their verdict and their done.
    let held = 0
    const both = Promise.withResolvers<void>()
    let armed = false
    const hold: BuilderHold = (at) =>
      at === 'judging' && armed
        ? Effect.andThen(
            Effect.sync(() => {
              held += 1
              if (held === 2) both.resolve()
            }),
            Effect.never,
          )
        : Effect.void
    const first = await checksEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.gen(function* () {
                yield* saveCheck(
                  projectId,
                  null,
                  check('unit', checkLine('unit.log', 0, '-', { release }), {
                    when: 'requirement',
                  }),
                )
                const declared = yield* saveCommand({
                  projectId,
                  id: null,
                  command: command('db-check', checkLine('db.log', 0, '-', { release })),
                })
                yield* saveCheck(
                  projectId,
                  null,
                  check('db', '', { commandId: declared.id, line: null, when: 'requirement' }),
                )
                const reset = yield* saveCommand({
                  projectId,
                  id: null,
                  command: command('db-reset', checkLine('reset.log', 0), { readOnly: false }),
                })
                yield* saveResources(projectId, [
                  {
                    name: 'Shared database',
                    description: 'The team database.',
                    uses: [declared.id],
                    changes: [reset.id],
                    resetCommandId: reset.id,
                  },
                ])
              }),
            'The impact.',
            plan,
          )
          const { grantId } = yield* builderOf(mission.id)
          for (const task of ['T1', 'T2', 'T4', 'T3']) {
            yield* call(grantId, 'task_start', { task })
            armed = task === 'T4' || task === 'T3'
            const finished = call(grantId, 'task_finished', { task, summary: 'Done.' })
            if (armed) yield* Effect.forkChild(finished)
            else yield* finished
          }
          yield* Effect.promise(() => both.promise)
          return { mission }
        }),
      ),
    )
    // The start goes on once the requirement's checks run: what a slower start meets.
    const running = Promise.withResolvers<void>()
    const resuming: BuilderHold = (at) =>
      at === 'resuming' ? Effect.promise(() => running.promise) : Effect.void
    const view = await checksEngine(data, resuming).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const database = yield* Database
          yield* Effect.forkChild(
            Effect.andThen(
              until(
                Effect.map(database.select().from(buildingCheckRuns), (rows) =>
                  rows.some((row) => row.runId !== null),
                ),
              ),
              Effect.sync(() => running.resolve()),
            ),
          )
          // The checks stay running a while: long enough for the start to see them.
          yield* Effect.forkChild(
            Effect.andThen(
              Effect.sleep('1 second'),
              Effect.sync(() => writeFileSync(release, '')),
            ),
          )
          yield* until(
            Effect.map(buildingNow(first.mission.id), (now) =>
              now.scopes.some((one) => one.verdict !== null),
            ),
            15_000,
          )
          // Long enough for a second run of either check to be seen.
          yield* Effect.sleep('1 second')
          return yield* buildingNow(first.mission.id)
        }),
      ),
    )
    expect(view.scopes.map((one) => [one.scope, one.subject, one.verdict])).toEqual([
      ['requirement', 'R1', 'green'],
    ])
    expect(checksOf(view.scopes[0])).toEqual([
      { name: 'unit', place: '', verdict: 'green', detail: '' },
      { name: 'db', place: '', verdict: 'green', detail: '' },
    ])
    expect(ranIn('unit.log')).toHaveLength(1)
    expect(ranIn('db.log')).toHaveLength(1)
  })
})

describe('The last requirement before the end', () => {
  test('the last task’s requirement checks are judged before the end is called, never after', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            Effect.asVoid(
              saveCheck(
                projectId,
                null,
                check('unit', checkLine('unit.log', 0), { when: 'requirement' }),
              ),
            ),
          )
          const { grantId } = yield* builderOf(mission.id)
          for (const task of ['T1', 'T2', 'T4', 'T3']) {
            yield* call(grantId, 'task_start', { task })
            yield* call(grantId, 'task_finished', { task, summary: 'Done.' })
          }
          const database = yield* Database
          const order = Effect.map(
            database
              .select({ type: domainEvents.type })
              .from(domainEvents)
              .where(
                and(
                  eq(domainEvents.entityId, mission.id),
                  inArray(domainEvents.type, ['building.checks_ran', 'building.tasks_done']),
                ),
              )
              .orderBy(asc(domainEvents.sequence)),
            (rows) => rows.map((row) => row.type),
          )
          yield* until(Effect.map(order, (types) => types.length === 2))
          return yield* order
        }),
      ),
    )
    expect(seen).toEqual(['building.checks_ran', 'building.tasks_done'])
  })
})

describe('A restart before or during a requirement’s checks', () => {
  /** Atlas with one requirement check, its line waiting for `release` when named. */
  const withUnit = (release?: string) =>
    launched(work, (projectId) =>
      Effect.asVoid(
        saveCheck(
          projectId,
          null,
          check('unit', checkLine('unit.log', 0, '-', release === undefined ? {} : { release }), {
            when: 'requirement',
          }),
        ),
      ),
    )

  /** Every task of R1 done in order, the last one's call left to finish on its own. */
  const allDone = (grantId: string) =>
    Effect.gen(function* () {
      for (const task of ['T1', 'T2', 'T4', 'T3']) {
        yield* call(grantId, 'task_start', { task })
        const finished = call(grantId, 'task_finished', { task, summary: 'Done.' })
        if (task === 'T3') yield* Effect.forkChild(finished)
        else yield* finished
      }
    })

  /** The scopes judged after a restart, once one has its verdict. */
  const judgedAfterRestart = (missionId: string) =>
    checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(buildingNow(missionId), (view) =>
              view.scopes.some((one) => one.verdict !== null),
            ),
            15_000,
          )
          return yield* buildingNow(missionId)
        }),
      ),
    )

  test('an engine stopped after the last task of a requirement is done, before its checks start: they run at the next start', async () => {
    const reached = Promise.withResolvers<void>()
    const hold: BuilderHold = (at) =>
      at === 'requirements'
        ? Effect.andThen(
            Effect.sync(() => reached.resolve()),
            Effect.never,
          )
        : Effect.void
    const first = await checksEngine(data, hold).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* withUnit()
          const { grantId } = yield* builderOf(mission.id)
          yield* allDone(grantId)
          yield* Effect.promise(() => reached.promise)
          return { mission }
        }),
      ),
    )
    expect(existsSync(join(scripts, 'unit.log'))).toBe(false)
    const view = await judgedAfterRestart(first.mission.id)
    expect(view.scopes.map((one) => [one.scope, one.subject, one.verdict])).toEqual([
      ['requirement', 'R1', 'green'],
    ])
    expect(ranIn('unit.log')).toHaveLength(1)
  })

  test('an engine stopped while a requirement’s check runs: the open attempt is judged again at the next start', async () => {
    const release = join(scripts, 'release-unit')
    const first = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* withUnit(release)
          const { grantId } = yield* builderOf(mission.id)
          yield* allDone(grantId)
          const database = yield* Database
          yield* until(
            Effect.map(
              database.select().from(buildingCheckRuns).where(eq(buildingCheckRuns.name, 'unit')),
              (rows) => rows.some((row) => row.runId !== null),
            ),
          )
          return { mission }
        }),
      ),
    )
    writeFileSync(release, '')
    const view = await judgedAfterRestart(first.mission.id)
    expect(view.scopes.map((one) => [one.scope, one.subject, one.verdict])).toEqual([
      ['requirement', 'R1', 'green'],
    ])
    expect(checksOf(view.scopes[0])).toEqual([
      { name: 'unit', place: '', verdict: 'green', detail: '' },
    ])
    expect(ranIn('unit.log')).toHaveLength(1)
  })
})

describe('The final checks', () => {
  test('a final check records its tree, keeps its whole output as evidence, and is said in the journal', async () => {
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(
            work,
            (projectId) =>
              Effect.asVoid(
                saveCheck(
                  projectId,
                  null,
                  check('build', checkLine('build.log', 0, 'built'), { when: 'end' }),
                ),
              ),
            'The exports change api, web and nothing else',
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const finished = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          const verdict = yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'end', null))
          return {
            finished,
            verdict,
            view: yield* buildingNow(mission.id),
            final: yield* eventsOf(mission.id, 'building.final_checks'),
            journal: yield* journalWith(mission.id, 'Final checks'),
          }
        }),
      ),
    )
    // An end check never runs after a task.
    expect(seen.finished).toBe('T1 is done, not verified: no check ran.')
    expect(seen.verdict).toBe('green')
    const [end] = seen.view.scopes
    const [result] = end?.checks ?? []
    expect(result).toMatchObject({ name: 'build', place: '', verdict: 'green', shown: 'final' })
    expect(result?.trees.map((one) => one.repository).toSorted()).toEqual(['api', 'web'])
    expect(result?.trees.every((one) => /^[0-9a-f]{40}$/.test(one.tree))).toBe(true)
    expect(result?.evidenceId).not.toBeNull()
    expect(seen.final.map((one) => JSON.parse(one.payload))).toEqual([{ checks: ['build: green'] }])
    expect(seen.journal).toContain('Final checks: build: green.')
  })
})

describe('A restart in the middle of the checks', () => {
  test('results survive a restart; a check left running is run again', async () => {
    const release = join(scripts, 'release-slow')
    const first = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            Effect.gen(function* () {
              yield* saveCheck(projectId, null, check('fast', checkLine('fast.log', 0)))
              yield* saveCheck(
                projectId,
                null,
                check('slow', checkLine('slow.log', 0, '-', { release })),
              )
            }),
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* Effect.forkChild(call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }))
          const database = yield* Database
          yield* until(
            Effect.map(
              database.select().from(buildingCheckRuns).where(eq(buildingCheckRuns.name, 'slow')),
              (rows) => rows.length > 0,
            ),
          )
          return { mission }
        }),
      ),
    )
    writeFileSync(release, '')
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(
              buildingNow(first.mission.id),
              (view) => view.tasks.find((task) => task.id === 'T1')?.state === 'done',
            ),
            15_000,
          )
          const database = yield* Database
          return {
            view: yield* buildingNow(first.mission.id),
            left: yield* database.select().from(buildingCheckRuns),
            runs: yield* database.select({ state: commandRuns.state }).from(commandRuns),
          }
        }),
      ),
    )
    const t1 = seen.view.tasks.find((task) => task.id === 'T1')
    expect([t1?.state, t1?.verified]).toEqual(['done', true])
    expect(checksOf(attemptsOf(seen.view, 'T1')[0])).toEqual([
      { name: 'fast', place: '', verdict: 'green', detail: '' },
      { name: 'slow', place: '', verdict: 'green', detail: '' },
    ])
    // The fast one's result stood; the slow one, cut, ran again to its end.
    expect(ranIn('fast.log')).toHaveLength(1)
    expect(ranIn('slow.log')).toHaveLength(1)
    expect(seen.left).toEqual([])
    expect(seen.runs).toHaveLength(3)
    expect(seen.runs.filter((one) => one.state === 'done')).toHaveLength(2)
  })

  test('a check on an exclusive resource left running is not run again: it is red, and its runner is told to check the real state', async () => {
    const release = join(scripts, 'release-never')
    const first = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            Effect.gen(function* () {
              const declared = yield* saveCommand({
                projectId,
                id: null,
                command: command('db-check', checkLine('db.log', 0, '-', { release })),
              })
              yield* saveCheck(
                projectId,
                null,
                check('db', '', { commandId: declared.id, line: null }),
              )
              const reset = yield* saveCommand({
                projectId,
                id: null,
                command: command('db-reset', checkLine('reset.log', 0), { readOnly: false }),
              })
              yield* saveResources(projectId, [
                {
                  name: 'Shared database',
                  description: 'The team database.',
                  uses: [declared.id],
                  changes: [reset.id],
                  resetCommandId: reset.id,
                },
              ])
            }),
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* Effect.forkChild(call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }))
          const database = yield* Database
          yield* until(
            Effect.map(
              database.select().from(buildingCheckRuns).where(eq(buildingCheckRuns.name, 'db')),
              (rows) => rows.some((row) => row.runId !== null),
            ),
          )
          return { mission }
        }),
      ),
    )
    writeFileSync(release, '')
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(buildingNow(first.mission.id), (view) => attemptsOf(view, 'T1').length > 1),
            15_000,
          )
          return { view: yield* buildingNow(first.mission.id) }
        }),
      ),
    )
    expect(checksOf(attemptsOf(seen.view, 'T1')[0])).toEqual([
      {
        name: 'db',
        place: '',
        verdict: 'red',
        detail:
          'cut by a restart while it ran on Shared database: it may have run; check the real state before running it again',
      },
    ])
    expect(ranIn('db.log')).toHaveLength(0)
  })
})

describe('A cancel in the middle of the checks', () => {
  test('Cancel stops a check that runs: its run ends stopped, and no result, verdict or red is written', async () => {
    const release = join(scripts, 'release-cancel')
    const seen = await checksEngine(data).run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work, (projectId) =>
            saveCheck(projectId, null, check('slow', checkLine('slow.log', 0, '-', { release }))),
          )
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* Effect.forkChild(call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }))
          const database = yield* Database
          const running = Effect.map(
            database.select({ state: commandRuns.state }).from(commandRuns),
            (rows) => rows.map((row) => row.state),
          )
          yield* until(Effect.map(running, (states) => states.includes('running')))
          yield* moveMission(mission.id, 'cancel', 'user')
          yield* until(Effect.map(running, (states) => !states.includes('running')))
          // The check is over once its row is gone: nothing it judged is written after that.
          yield* until(
            Effect.map(database.select().from(buildingCheckRuns), (rows) => rows.length === 0),
          )
          return {
            states: yield* running,
            verdicts: yield* database
              .select({ verdict: buildingAttempts.verdict })
              .from(buildingAttempts),
            results: yield* database.select().from(buildingCheckResults),
            reds: yield* eventsOf(mission.id, 'building.check_red'),
          }
        }),
      ),
    )
    writeFileSync(release, '')
    expect(seen.states).toEqual(['stopped'])
    expect(ranIn('slow.log')).toHaveLength(0)
    // A check Cancel stopped is no verdict: nothing red is said of a mission the user cancelled.
    expect(seen.verdicts).toEqual([{ verdict: null }])
    expect(seen.results).toEqual([])
    expect(seen.reds).toEqual([])
  })
})
