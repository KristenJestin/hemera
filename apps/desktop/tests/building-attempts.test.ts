/**
 * Attempts, attribution and the verdict loop (#142): every write belongs to the task that wrote it,
 * a writing command takes a lock on its repository, a command that rewrites another running task's
 * file records a conflict, a red check starts a new attempt for whoever made it, three reds become
 * an error need, an action cut by a restart is never counted done nor run again blindly, and Hemera
 * commits per task only when the mission's copy of the rule says so.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, a fake `TaskChecks`, the
 * test driving the Builder's and a helper's tools through their grants; Acme's real repositories
 * in temporary folders as the Workspace, and small Node scripts as the catalogue's commands.
 */

import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import type { BuildingAttemptView, CommandDraft } from '@hemera/ipc'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { BUILDER_TEMPLATE } from '../src/engine/building/builder-role.ts'
import { HELPER_TEMPLATE } from '../src/engine/building/helper-role.ts'
import { BuildDesk } from '../src/engine/building/desk.ts'
import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { buildingAttemptOf } from '../src/engine/building/tasks.ts'
import { Snapshots } from '../src/engine/building/snapshots.ts'
import { ONE_COMMIT_PER_TASK } from '../src/engine/building/validation.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, getNeed, retryNeed } from '../src/engine/needs.ts'
import { getProject } from '../src/engine/projects.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  commandRuns,
  domainEvents,
  effectfulActions,
  missionValidationSettings,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { beginAction } from '../src/engine/tools/actions.ts'
import { type JudgedCall, Verdicts } from '../src/engine/tools/ports.ts'
import { fingerprintOf } from '../src/engine/tools/read.ts'
import { call, eventsOf, grantOf } from './building-world.ts'
import { builderAgents, builderOf, buildingNow, launched, taskIn } from './builder-world.ts'
import { nodeLine } from './commands-engine.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
let scripts: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-attempts'))
  work = realpathSync.native(temporaryFolder('building-attempts-work'))
  scripts = realpathSync.native(temporaryFolder('building-attempts-scripts'))
})
afterEach(removeFolders)

/**
 * The engine over `data`, with the Builder of this version, a helper role, and every call the
 * agents make allowed: what is judged here is the Building's, never the permissions'.
 */
const builderEngine = (
  dataFolder: string,
  workFolder: string,
  building: {
    readonly checks?: Layer.Layer<TaskChecks>
    readonly hold?: BuilderHold
    readonly verdicts?: Layer.Layer<Verdicts>
  } = {},
) => {
  const { verdicts, ...rest } = building
  return sessionsEngine(dataFolder, builderAgents, {
    roles: [HELPER],
    tools: { home: workFolder, verdicts: verdicts ?? verdictsSaying(() => ALLOW).layer },
    building: rest,
  })
}

/**
 * A command's script: waits for `release` when it names one, then writes each `path=content` given
 * in its folder, then prints `lines` lines.
 */
const WRITER = `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
const [release, lines, ...writes] = process.argv.slice(2)
const wait = () => new Promise((done) => setTimeout(done, 20))
while (release !== '-' && !existsSync(release)) await wait()
for (const write of writes) {
  const [path, content] = write.split('=')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content + '\\n')
}
for (let at = 1; at <= Number(lines); at += 1) process.stdout.write('line ' + at + '\\n')
`

const writerScript = () => {
  const path = join(scripts, 'writer.mjs')
  if (!existsSync(path)) writeFileSync(path, WRITER)
  return path
}

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

/** A catalogue command in `api` that writes the files given, once `release` exists if named. */
const apiCommand = (
  projectId: string,
  name: string,
  writes: ReadonlyArray<string>,
  more: Partial<CommandDraft> & { readonly release?: string } = {},
) =>
  Effect.gen(function* () {
    const project = yield* getProject(projectId)
    const api = project.repositories.find((one) => one.path === 'api')
    const { release, ...rest } = more
    return yield* saveCommand({
      projectId,
      id: null,
      command: draft(name, nodeLine(writerScript(), release ?? '-', '0', ...writes), {
        repositoryId: api?.id ?? null,
        ...rest,
      }),
    })
  })

/** A helper session of the mission, in the Builder's Workspace, and its grant and lineage. */
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
    return { grantId: yield* grantOf(helper.id), lineage: helper.lineage, id: helper.id }
  })

/** The deliveries stored for a lineage, of a kind. */
const deliveriesTo = (lineage: string, kind: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* database
      .select({ body: sessionDeliveries.body })
      .from(sessionDeliveries)
      .where(and(eq(sessionDeliveries.targetLineage, lineage), eq(sessionDeliveries.kind, kind)))
  })

/** The runs of a command now going. */
const runningOf = (commandId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select({ state: commandRuns.state })
      .from(commandRuns)
      .where(eq(commandRuns.commandId, commandId))
    return rows.some((row) => row.state === 'running')
  })

const attemptsOf = (
  view: {
    readonly tasks: ReadonlyArray<{ id: string; attempts: ReadonlyArray<BuildingAttemptView> }>
  },
  taskId: string,
) => view.tasks.find((task) => task.id === taskId)?.attempts ?? []

const pathsOf = (attempt: BuildingAttemptView | undefined) =>
  (attempt?.files ?? []).map((file) => `${file.repository}/${file.path}`)

/** A fake `TaskChecks`: the verdicts it answers for each call on a scope, in order. */
const checksSaying = (
  answers: (asked: {
    readonly scope: string
    readonly subject: string | null
  }) => ReadonlyArray<CheckResult>,
) => Layer.succeed(TaskChecks, { run: (asked) => Effect.succeed(answers(asked)) })

const LONG_OUTPUT = Array.from({ length: 50 }, (_, at) => `FAIL test ${String(at + 1)}`).join('\n')

const red = (name = 'unit tests', place = 'api'): CheckResult => ({
  name,
  place,
  verdict: 'red',
  detail: 'exit code 1',
  outputTail: LONG_OUTPUT,
  runId: null,
})

const green: CheckResult = {
  name: 'unit tests',
  place: 'api',
  verdict: 'green',
  detail: 'exit code 0',
  outputTail: 'ok',
  runId: null,
}

/** Polls a fiber briefly: whether it ended by then. */
const endedSoon = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    yield* Effect.sleep('400 millis')
    return fiber.pollUnsafe() !== undefined
  })

describe('Attribution: a change belongs to the task that wrote it (CT-02)', () => {
  test('two tasks in parallel: each attempt’s diff holds only its own files, never the other’s', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv"]\n',
          })
          yield* call(helper.grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = true\n',
          })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* call(helper.grantId, 'task_finished', { task: 'T2', summary: 'Markdown.' })
          return yield* buildingNow(mission.id)
        }),
      ),
    )
    expect(pathsOf(attemptsOf(seen, 'T1')[0])).toEqual(['api/invoices.ts'])
    expect(pathsOf(attemptsOf(seen, 'T2')[0])).toEqual(['api/export.ts'])
    expect(attemptsOf(seen, 'T1')[0]?.files[0]).toMatchObject({ status: 'M', outside: false })
    expect(seen.unattributed).toEqual([])
  })

  test('a command run by T4’s session is attributed to T4 from its before and after snapshots, limited to its repository; a file changed by the test outside any author goes to the Building, not a task', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const generate = yield* apiCommand(project.id, 'generate', ['client.ts=generated'])
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          const ran = yield* call(grantId, 'commands_run', { command: generate.id, timeout: 60 })
          // Nobody's: a file the test writes once the command ended.
          writeFileSync(join(session.folder, 'api', 'stray.md'), 'Nobody wrote this.\n')
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          return { ran, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.ran).toMatch(/exit code 0/)
    const attempt = attemptsOf(seen.view, 'T4')[0]
    expect(pathsOf(attempt)).toEqual(['api/client.ts'])
    expect(attempt?.files[0]).toMatchObject({ status: 'A', outside: true })
    expect(seen.view.unattributed.map((one) => `${one.repository}/${one.path}`).toSorted()).toEqual(
      ['api/stray.md'],
    )
  })
})

describe('The write lock of a command', () => {
  test('while format (no declared globs) runs in api, T2’s fs_write in api waits and then succeeds, and a second writing command waits', async () => {
    const release = join(scripts, 'release-format')
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['invoices.ts=formatted'], {
            release,
          })
          const generate = yield* apiCommand(project.id, 'generate', ['client.ts=generated'])
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const formatting = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: format.id, timeout: 60 }),
          )
          yield* until(runningOf(format.id))
          const writing = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          const generating = yield* Effect.forkChild(
            call(helper.grantId, 'commands_run', { command: generate.id, timeout: 60 }),
          )
          const writeEndedSoon = yield* endedSoon(writing)
          const generateStarted = yield* runningOf(generate.id)
          // Its own command does not hold back the task that runs it.
          const own = yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'notes.md',
            content: 'Mine.\n',
          })
          writeFileSync(release, '')
          const formatted = yield* Fiber.join(formatting)
          const written = yield* Fiber.join(writing)
          const generated = yield* Fiber.join(generating)
          return { writeEndedSoon, generateStarted, own, formatted, written, generated }
        }),
      ),
    )
    expect(seen.writeEndedSoon).toBe(false)
    expect(seen.generateStarted).toBe(false)
    expect(seen.own).not.toMatch(/^refused|waiting/)
    expect(seen.formatted).toMatch(/exit code 0/)
    expect(seen.written).toMatch(/^wrote export\.ts/)
    expect(seen.written).toContain('waiting for `format` (T4), which writes in api')
    expect(seen.generated).toContain('waiting for `format` (T4), which writes in api')
    expect(seen.generated).toMatch(/exit code 0/)
  })

  test('a call interrupted once its lock is taken, before its run starts, lets the lock go', async () => {
    const locked = Deferred.makeUnsafe<void>()
    const hold: BuilderHold = (at) =>
      at === 'locked'
        ? Effect.andThen(Deferred.succeed(locked, undefined), Effect.never)
        : Effect.void
    const { run } = builderEngine(data, work, { hold })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['invoices.ts=formatted'])
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const formatting = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: format.id, timeout: 60 }),
          )
          yield* Deferred.await(locked)
          yield* Fiber.interrupt(formatting)
          const writing = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          const writeEndedSoon = yield* endedSoon(writing)
          return { writeEndedSoon }
        }),
      ),
    )
    expect(seen.writeEndedSoon).toBe(true)
  })

  test('a writing command that outlives its call’s wait keeps the lock until it ends: another task’s write waits, and what it wrote after the call stopped waiting is its own task’s', async () => {
    const release = join(scripts, 'release-slow')
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['invoices.ts=formatted'], {
            release,
          })
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const ran = yield* call(grantId, 'commands_run', { command: format.id, timeout: 1 })
          const writing = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          const writeEndedSoon = yield* endedSoon(writing)
          writeFileSync(release, '')
          const written = yield* Fiber.join(writing)
          yield* until(Effect.map(runningOf(format.id), (going) => !going))
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          return { ran, writeEndedSoon, written, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.ran).not.toMatch(/exit code/)
    expect(seen.writeEndedSoon).toBe(false)
    expect(seen.written).toContain('waiting for `format` (T4), which writes in api')
    expect(pathsOf(attemptsOf(seen.view, 'T4')[0])).toEqual(['api/invoices.ts'])
    expect(attemptsOf(seen.view, 'T2')[0]?.conflicts ?? []).toEqual([])
    expect(seen.view.unattributed).toEqual([])
  })

  test('a command whose reservation comes after its call stopped waiting takes the lock and the snapshots like any run', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const migrate = yield* apiCommand(project.id, 'db:migrate', ['schema.sql=migrated'])
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          // With no reset command, taking the reservation asks the user first: the run waits.
          yield* saveResources(project.id, [
            {
              name: 'Shared database',
              description: 'The team database.',
              uses: [],
              changes: [migrate.id],
              resetCommandId: null,
            },
          ])
          const ran = yield* call(grantId, 'commands_run', { command: migrate.id, timeout: 1 })
          const environment = () =>
            Effect.map(getMission(mission.id), (one) =>
              one.needs.find((need) => Predicate.isTagged(need.fields, 'Environment')),
            )
          yield* until(Effect.map(environment(), (need) => need !== undefined))
          yield* retryNeed((yield* environment())?.id ?? '')
          // Its outcome is written once what it changed is attributed.
          const database = yield* Database
          yield* until(
            Effect.map(
              database
                .select({ state: effectfulActions.state })
                .from(effectfulActions)
                .where(eq(effectfulActions.kind, 'command.run')),
              (rows) => rows.some((row) => row.state === 'done'),
            ),
          )
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Migrated.' })
          return { ran, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.ran).not.toMatch(/exit code/)
    expect(pathsOf(attemptsOf(seen.view, 'T4')[0])).toEqual(['api/schema.sql'])
    expect(seen.view.unattributed).toEqual([])
  })

  test('a command waiting for its exclusive reservation holds no lock', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const migrate = yield* apiCommand(project.id, 'db:migrate', ['schema.sql=migrated'])
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          // With no reset command, taking the reservation asks the user first: the run waits.
          yield* saveResources(project.id, [
            {
              name: 'Shared database',
              description: 'The team database.',
              uses: [],
              changes: [migrate.id],
              resetCommandId: null,
            },
          ])
          const migrating = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: migrate.id, timeout: 60 }),
          )
          yield* Effect.sleep('300 millis')
          const writing = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          const writeEndedSoon = yield* endedSoon(writing)
          const written = writeEndedSoon ? yield* Fiber.join(writing) : ''
          yield* Fiber.interrupt(migrating)
          return { writeEndedSoon, written }
        }),
      ),
    )
    expect(seen.writeEndedSoon).toBe(true)
    expect(seen.written).not.toContain('waiting')
  })

  test('a file write approved while another task’s command took the lock lands after that command, attributed to its writer alone', async () => {
    const release = join(scripts, 'release-approved')
    const judged = Deferred.makeUnsafe<void>()
    const approve = Deferred.makeUnsafe<void>()
    const verdicts = Layer.succeed(Verdicts, {
      judge: (asked: JudgedCall) =>
        asked.tool === 'fs_write' && asked.path?.named.endsWith('export.ts') === true
          ? Effect.andThen(
              Deferred.succeed(judged, undefined),
              Effect.as(Deferred.await(approve), ALLOW),
            )
          : Effect.succeed(ALLOW),
      refusal: () => Effect.succeed(null),
    })
    const { run } = builderEngine(data, work, { verdicts })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['invoices.ts=formatted'], {
            release,
          })
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const writing = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          yield* Deferred.await(judged)
          const formatting = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: format.id, timeout: 60 }),
          )
          yield* until(runningOf(format.id))
          yield* Deferred.succeed(approve, undefined)
          const writeEndedSoon = yield* endedSoon(writing)
          writeFileSync(release, '')
          yield* Fiber.join(formatting)
          yield* Fiber.join(writing)
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          return { writeEndedSoon, view: yield* buildingNow(mission.id) }
        }),
      ),
    )
    expect(seen.writeEndedSoon).toBe(false)
    expect(pathsOf(attemptsOf(seen.view, 'T4')[0])).toEqual(['api/invoices.ts'])
    const t2 = attemptsOf(seen.view, 'T2')[0]
    expect(t2?.conflicts ?? []).toEqual([])
  })

  test('a command declaring **/*.generated.ts blocks only those paths; a command declaring no writes takes no lock', async () => {
    const release = join(scripts, 'release-codegen')
    const releaseLint = join(scripts, 'release-lint')
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const codegen = yield* apiCommand(project.id, 'codegen', ['client.generated.ts=x'], {
            release,
            writeGlobs: ['**/*.generated.ts'],
          })
          const lint = yield* apiCommand(project.id, 'lint', [], {
            release: releaseLint,
            readOnly: true,
          })
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const generating = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: codegen.id, timeout: 60 }),
          )
          yield* until(runningOf(codegen.id))
          const free = yield* call(helper.grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = true\n',
          })
          const held = yield* Effect.forkChild(
            call(helper.grantId, 'fs_write', {
              repository: 'api',
              path: 'models/invoice.generated.ts',
              content: 'export {}\n',
            }),
          )
          const heldEndedSoon = yield* endedSoon(held)
          writeFileSync(release, '')
          yield* Fiber.join(generating)
          const afterwards = yield* Fiber.join(held)
          const linting = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: lint.id, timeout: 60 }),
          )
          yield* until(runningOf(lint.id))
          const duringLint = yield* call(helper.grantId, 'fs_write', {
            repository: 'api',
            path: 'export.ts',
            content: 'export const markdown = false\n',
          })
          writeFileSync(releaseLint, '')
          yield* Fiber.join(linting)
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          return {
            free,
            heldEndedSoon,
            afterwards,
            duringLint,
            view: yield* buildingNow(mission.id),
          }
        }),
      ),
    )
    expect(seen.free).toMatch(/^wrote export\.ts/)
    expect(seen.free).not.toContain('waiting')
    expect(seen.heldEndedSoon).toBe(false)
    expect(seen.afterwards).toContain('waiting for `codegen` (T4), which writes in api')
    expect(seen.duringLint).not.toContain('waiting')
    // The read-only command took no snapshot pair: T4 holds only what codegen wrote.
    expect(pathsOf(attemptsOf(seen.view, 'T4')[0])).toEqual(['api/client.generated.ts'])
  })
})

describe('A command that rewrites another running task’s file', () => {
  test('format of T4 rewriting export.ts claimed by T2: kept, attributed to T4, a conflict on both, T2’s runner gets the delivery', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['export.ts=formatted'])
          const { session, grantId } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          yield* call(grantId, 'commands_run', { command: format.id, timeout: 60 })
          yield* until(
            Effect.map(deliveriesTo(helper.lineage, 'conflict'), (rows) => rows.length > 0),
          )
          yield* call(grantId, 'task_finished', { task: 'T4', summary: 'Named.' })
          return {
            view: yield* buildingNow(mission.id),
            delivered: yield* deliveriesTo(helper.lineage, 'conflict'),
            events: yield* eventsOf(mission.id, 'building.write_conflict'),
          }
        }),
      ),
    )
    expect(pathsOf(attemptsOf(seen.view, 'T4')[0])).toEqual(['api/export.ts'])
    const conflict = {
      repository: 'api',
      path: 'export.ts',
      command: 'format',
      byTask: 'T4',
      heldBy: 'T2',
    }
    expect(attemptsOf(seen.view, 'T4')[0]?.conflicts).toEqual([conflict])
    expect(attemptsOf(seen.view, 'T2')[0]?.conflicts).toEqual([conflict])
    expect(seen.delivered.map((one) => one.body)).toEqual([
      'api/export.ts was rewritten by `format` of T4: read it again before writing.',
    ])
    expect(seen.events).toHaveLength(1)
  })
})

describe('The verdict loop', () => {
  test('a red verdict opens a new attempt and delivers check, place and output tail to the runner, a helper when it made it', async () => {
    let calls = 0
    const checks = checksSaying(() => {
      calls += 1
      return calls === 1 ? [red()] : [green]
    })
    const { run } = builderEngine(data, work, { checks })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          const first = yield* call(helper.grantId, 'task_finished', { task: 'T2', summary: 'A.' })
          const between = yield* buildingNow(mission.id)
          const redId = between.tasks.find((task) => task.id === 'T2')?.attempts[0]?.id ?? ''
          const second = yield* call(helper.grantId, 'task_finished', { task: 'T2', summary: 'B.' })
          return {
            first,
            second,
            between,
            asked: yield* buildingAttemptOf(mission.id, redId),
            after: yield* buildingNow(mission.id),
            delivered: yield* deliveriesTo(helper.lineage, 'red'),
            reds: yield* eventsOf(mission.id, 'building.attempt_red'),
          }
        }),
      ),
    )
    expect(seen.first).toMatch(/T2 is red: unit tests failed in api/)
    const t2 = seen.between.tasks.find((task) => task.id === 'T2')
    expect(t2?.state).toBe('in_progress')
    expect(t2?.attempts.map((one) => [one.number, one.verdict, one.endedAt === null])).toEqual([
      [1, 'red', false],
      [2, null, true],
    ])
    expect(t2?.attempts[0]?.checks[0]).toMatchObject({ name: 'unit tests', verdict: 'red' })
    expect(seen.asked).toMatchObject({ id: t2?.attempts[0]?.id, number: 1, verdict: 'red' })
    expect(seen.asked.checks[0]).toMatchObject({ name: 'unit tests', place: 'api', verdict: 'red' })
    const body = seen.delivered[0]?.body ?? ''
    expect(body).toContain('unit tests')
    expect(body).toContain('in api')
    expect(body).toContain('FAIL test 50')
    expect(body).not.toContain('FAIL test 10\n')
    expect(body).toContain('the first 10 line(s) are cut')
    expect(seen.second).toMatch(/T2 is done, verified/)
    expect(seen.after.tasks.find((task) => task.id === 'T2')?.state).toBe('done')
    expect(seen.reds).toHaveLength(1)
  })

  test('a red at requirement scope keeps its attempt, opens the next on that scope for the Builder, and changes no task state', async () => {
    const checks = checksSaying((asked) => (asked.scope === 'requirement' ? [red('e2e', '')] : []))
    const { run } = builderEngine(data, work, { checks })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          const before = yield* buildingNow(mission.id)
          const said = yield* BuildDesk.use((desk) =>
            desk.judgeScope(mission.id, 'requirement', 'R1'),
          )
          return {
            said,
            before,
            after: yield* buildingNow(mission.id),
            delivered: yield* deliveriesTo(session.lineage, 'red'),
          }
        }),
      ),
    )
    expect(seen.said).toBe('red')
    expect(seen.after.tasks.map((task) => task.state)).toEqual(
      seen.before.tasks.map((task) => task.state),
    )
    // The first red keeps its own attempt and results; the next one is open for the Builder.
    expect(seen.after.scopes).toMatchObject([
      { scope: 'requirement', subject: 'R1', number: 1, verdict: 'red' },
      { scope: 'requirement', subject: 'R1', number: 2, verdict: null },
    ])
    expect(seen.after.scopes[0]?.checks[0]).toMatchObject({ name: 'e2e', verdict: 'red' })
    expect(seen.delivered[0]?.body).toContain('e2e')
    expect(seen.delivered[0]?.body).toContain('the Workspace root')
  })
})

describe('Three reds become an error need', () => {
  test('the third red gives an error need with three failures and the task blocked, the others going on; task_finished is refused; need_propose fills its proposal; a fourth attempt starts only after the answer', async () => {
    const checks = checksSaying((asked) => (asked.subject === 'T1' ? [red()] : []))
    const { run } = builderEngine(data, work, { checks })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'One.' })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Two.' })
          const third = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Three.' })
          const blocked = yield* buildingNow(mission.id)
          const read = yield* call(grantId, 'build_read', { task: 'T1' })
          const again = yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Four.' })
          const startRefused = yield* call(grantId, 'task_start', { task: 'T1' })
          const others = yield* call(grantId, 'task_start', { task: 'T2' })
          const [need] = (yield* getMission(mission.id)).needs
          const needId = need?.id ?? ''
          const asked = yield* deliveriesTo(session.lineage, 'propose')
          const proposed = yield* call(grantId, 'need_propose', {
            need: needId,
            options: [
              { label: 'Mock the clock', detail: 'The tests assume the time zone.' },
              { label: 'Drop the test', detail: 'It tests nothing of R1.' },
            ],
            recommended: 'Mock the clock',
            reason: 'The failure names the time zone.',
          })
          const filled = yield* getNeed(needId)
          yield* answerNeed({
            id: needId,
            answer: WrittenAnswer.make({ text: 'Use UTC everywhere.' }),
            key: 'answer-1',
          })
          yield* taskIn(mission.id, 'T1', 'available')
          yield* until(
            Effect.map(deliveriesTo(session.lineage, 'answer'), (rows) => rows.length > 0),
          )
          const direction = yield* deliveriesTo(session.lineage, 'answer')
          const fourth = yield* call(grantId, 'task_start', { task: 'T1' })
          return {
            third,
            blocked,
            read,
            again,
            startRefused,
            others,
            asked,
            proposed,
            filled,
            direction,
            fourth,
            events: yield* eventsOf(mission.id, 'building.three_reds'),
          }
        }),
      ),
    )
    expect(seen.third).toMatch(/red for the third time/)
    const t1 = seen.blocked.tasks.find((task) => task.id === 'T1')
    expect(t1?.state).toBe('blocked')
    expect(t1?.attempts.map((one) => one.verdict)).toEqual(['red', 'red', 'red'])
    expect(seen.read).toMatch(/Attempt 3: [^\n]*, red/)
    expect(seen.blocked.tasks.find((task) => task.id === 'T2')?.state).toBe('available')
    expect(seen.again).toMatch(/^refused: T1 is not in progress/)
    expect(seen.startRefused).toMatch(/^refused: T1 is blocked/)
    expect(seen.others).toMatch(/T2 started/)
    expect(seen.asked[0]?.body).toContain('need_propose')
    expect(seen.proposed).not.toMatch(/^refused/)
    const fields = seen.filled.fields
    expect(Predicate.isTagged(fields, 'Error')).toBe(true)
    if (!Predicate.isTagged(fields, 'Error')) return
    expect(fields.attempts).toHaveLength(3)
    expect(fields.attempts[0]?.what).toMatch(/unit tests in api · attempt 1 by /)
    expect(fields.attempts[0]?.output).toContain('FAIL test 50')
    expect(fields.proposals).toEqual([
      'Mock the clock: The tests assume the time zone.',
      'Drop the test: It tests nothing of R1.',
    ])
    expect(fields.recommended).toEqual({
      option: 'Mock the clock: The tests assume the time zone.',
      reason: 'The failure names the time zone.',
    })
    expect(seen.direction.at(-1)?.body).toContain('Use UTC everywhere.')
    expect(seen.fourth).toMatch(/T1 started: attempt 4/)
    expect(seen.events).toHaveLength(1)
  })

  test('need_propose is refused for a need it was not asked for', async () => {
    const { run } = builderEngine(data, work)
    const refused = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'task_blocked', {
            task: 'T1',
            kind: 'decision',
            reason: 'Which format?',
            options: ['CSV', 'TSV'],
            recommended: 'CSV',
            recommended_reason: 'Asked for.',
          })
          const [need] = (yield* getMission(mission.id)).needs
          return yield* call(grantId, 'need_propose', {
            need: need?.id ?? '',
            options: [{ label: 'CSV', detail: 'Asked for.' }],
            recommended: 'CSV',
            reason: 'Asked for.',
          })
        }),
      ),
    )
    expect(refused).toBe('refused: this need is not an error need you were asked to fill.')
  })
})

describe('Three reds on a scope', () => {
  /** The error needs of a mission that wait for the user. */
  const errorNeedsOf = (missionId: string) =>
    Effect.map(getMission(missionId), (mission) =>
      mission.needs.filter((need) => Predicate.isTagged(need.fields, 'Error')),
    )

  test('the third red of a requirement’s checks gives one error need carrying the three failures', async () => {
    const checks = checksSaying((asked) => (asked.scope === 'requirement' ? [red('e2e', '')] : []))
    const { run } = builderEngine(data, work, { checks })
    const needs = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          yield* builderOf(mission.id)
          for (let at = 0; at < 3; at += 1) {
            yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'requirement', 'R1'))
          }
          return yield* errorNeedsOf(mission.id)
        }),
      ),
    )
    expect(needs).toHaveLength(1)
    const fields = needs[0]?.fields
    if (!Predicate.isTagged(fields, 'Error')) return expect.unreachable()
    expect(fields.attempts).toHaveLength(3)
    expect(fields.attempts.every((one) => one.output.includes('FAIL test 50'))).toBe(true)
  })

  test('while a scope’s error need waits for the user, another red asks nothing more', async () => {
    const checks = checksSaying((asked) => (asked.scope === 'requirement' ? [red('e2e', '')] : []))
    const { run } = builderEngine(data, work, { checks })
    const needs = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          yield* builderOf(mission.id)
          for (let at = 0; at < 5; at += 1) {
            yield* BuildDesk.use((desk) => desk.judgeScope(mission.id, 'requirement', 'R1'))
          }
          return yield* errorNeedsOf(mission.id)
        }),
      ),
    )
    expect(needs).toHaveLength(1)
  })

  test('answering one scope’s error need restarts only that scope’s count of reds', async () => {
    const checks = checksSaying(() => [red('e2e', '')])
    const { run } = builderEngine(data, work, { checks })
    const needs = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          yield* builderOf(mission.id)
          const judge = (scope: 'requirement' | 'end', subject: string | null) =>
            BuildDesk.use((desk) => desk.judgeScope(mission.id, scope, subject))
          for (let at = 0; at < 3; at += 1) yield* judge('requirement', 'R1')
          yield* judge('end', null)
          yield* judge('end', null)
          const [asked] = yield* errorNeedsOf(mission.id)
          yield* answerNeed({
            id: asked?.id ?? '',
            answer: WrittenAnswer.make({ text: 'Run the e2e suite against a fresh database.' }),
            key: 'answer-r1',
          })
          // The end's third red still counts its first two.
          yield* judge('end', null)
          return yield* errorNeedsOf(mission.id)
        }),
      ),
    )
    // Only the end's need waits now: R1's was answered.
    expect(needs).toHaveLength(1)
    const fields = needs[0]?.fields
    if (!Predicate.isTagged(fields, 'Error')) return expect.unreachable()
    expect(fields.failed).toBe('The end of the Building: three red attempts')
  })
})

describe('An action cut by a restart (CT-09)', () => {
  test('an fs_write intent without outcome after a simulated crash is resolved from the file’s fingerprint; a command intent becomes indeterminate in the resume brief, is not run again, and what it changed before the stop is its task’s', async () => {
    const before = builderEngine(data, work)
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const build = yield* apiCommand(project.id, 'build', ['dist.js=built'])
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          const owner = { kind: 'mission', missionId: mission.id, taskId: 'T1' } as const
          // The write happened, its outcome was lost; the second never happened.
          const written = join(session.folder, 'api', 'invoices.ts')
          const content = 'export const invoices = ["csv"]\n'
          writeFileSync(written, content)
          yield* beginAction('file.write', owner, {
            path: written,
            before: null,
            after: fingerprintOf(Buffer.from(content, 'utf8')),
            sessionId: session.id,
          })
          yield* beginAction('file.write', owner, {
            path: join(session.folder, 'api', 'never.ts'),
            before: null,
            after: fingerprintOf(Buffer.from('never\n', 'utf8')),
            sessionId: session.id,
          })
          // The build was cut after its snapshot before and after it wrote a file.
          const tree = yield* Snapshots.use((snapshots) =>
            snapshots.take(
              { name: 'api', folder: join(session.folder, 'api') },
              { kind: 'run', missionId: mission.id, runId: 'cut-build', side: 'before' },
            ),
          )
          writeFileSync(join(session.folder, 'api', 'built.js'), 'built\n')
          yield* beginAction('command.run', owner, {
            command: build.id,
            line: 'pnpm build',
            folder: null,
            sessionId: session.id,
            trees: [{ repository: 'api', tree }],
            globs: null,
          })
          return { mission, builder: session, build }
        }),
      ),
    )
    const after = builderEngine(data, work)
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(
              deliveriesTo(first.builder.lineage, 'indeterminate'),
              (rows) => rows.length > 0,
            ),
          )
          const { grantId } = yield* builderOf(first.mission.id)
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'Done.' })
          const database = yield* Database
          return {
            delivered: yield* deliveriesTo(first.builder.lineage, 'indeterminate'),
            view: yield* buildingNow(first.mission.id),
            runs: yield* database
              .select()
              .from(commandRuns)
              .where(eq(commandRuns.commandId, first.build.id)),
            journal: yield* eventsOf(first.mission.id, 'building.indeterminate'),
          }
        }),
      ),
    )
    expect(seen.delivered.map((one) => one.body)).toEqual([
      'T1: indeterminate result: `pnpm build` may have run; check the real state before running it again.',
    ])
    expect(seen.runs).toEqual([])
    expect(seen.journal).toHaveLength(1)
    expect(pathsOf(attemptsOf(seen.view, 'T1')[0]).toSorted()).toEqual([
      'api/built.js',
      'api/invoices.ts',
    ])
  })

  test('on a command declared on an exclusive resource, a decision need is created and the task waits for it, and the Building resumes only once it is handed over, however slow', async () => {
    const before = builderEngine(data, work)
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          let migrateId = ''
          // Declared before the launch: the Building's start reserves it, which asks the user once.
          const { mission } = yield* launched(work, (projectId) =>
            Effect.gen(function* () {
              const migrate = yield* apiCommand(projectId, 'db:migrate', [])
              migrateId = migrate.id
              yield* saveResources(projectId, [
                {
                  name: 'Shared database',
                  description: 'The team database.',
                  uses: [],
                  changes: [migrate.id],
                  resetCommandId: null,
                },
              ])
            }),
          )
          yield* until(
            Effect.map(getMission(mission.id), (one) =>
              one.needs.some((need) => Predicate.isTagged(need.fields, 'Environment')),
            ),
          )
          const reserved = (yield* getMission(mission.id)).needs.find((need) =>
            Predicate.isTagged(need.fields, 'Environment'),
          )
          yield* retryNeed(reserved?.id ?? '')
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* beginAction(
            'command.run',
            { kind: 'mission', missionId: mission.id, taskId: 'T1' },
            { command: migrateId, line: 'pnpm db:migrate', folder: null, sessionId: session.id },
          )
          return { mission }
        }),
      ),
    )
    // The hand-over is slow: the Building must still wait for it before it resumes.
    const after = builderEngine(data, work, {
      hold: (at) => (at === 'cutting' ? Effect.sleep('500 millis') : Effect.void),
    })
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(getMission(first.mission.id), (mission) => mission.needs.length > 0),
          )
          const [need] = (yield* getMission(first.mission.id)).needs
          const blocked = yield* buildingNow(first.mission.id)
          yield* answerNeed({
            id: need?.id ?? '',
            answer: ChosenAnswer.make({ option: 'it ran' }),
            key: 'answer-1',
          })
          // The stop's cut command is handed over before the Building resumes and its Builder acts.
          yield* until(
            Effect.map(eventsOf(first.mission.id, 'building.resumed'), (rows) => rows.length > 0),
          )
          const database = yield* Database
          const order = yield* database
            .select({ type: domainEvents.type })
            .from(domainEvents)
            .where(
              and(
                eq(domainEvents.entityId, first.mission.id),
                inArray(domainEvents.type, ['building.indeterminate', 'building.resumed']),
              ),
            )
            .orderBy(asc(domainEvents.sequence))
          return { need, blocked, order: order.map((one) => one.type) }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.need?.fields, 'Decision')).toBe(true)
    const fields = seen.need?.fields
    if (!Predicate.isTagged(fields, 'Decision')) return
    expect(fields.question).toBe('`db:migrate` was cut by a restart. Did it run?')
    expect(fields.options).toEqual(['it ran', 'it did not run'])
    expect(seen.blocked.tasks.find((task) => task.id === 'T1')?.state).toBe('blocked')
    expect(seen.order).toEqual(['building.indeterminate', 'building.resumed'])
  })
})

describe('Commits per task', () => {
  /** The mission's copy of the validation settings, its "who commits" section set to `value`. */
  const commitsSay = (missionId: string, value: typeof ONE_COMMIT_PER_TASK) =>
    Effect.gen(function* () {
      const database = yield* Database
      const [row] = yield* database
        .select()
        .from(missionValidationSettings)
        .where(eq(missionValidationSettings.missionId, missionId))
      const sections = { ...JSON.parse(row?.sections ?? '{}'), commits: value }
      yield* database
        .update(missionValidationSettings)
        .set({ sections: JSON.stringify(sections) })
        .where(eq(missionValidationSettings.missionId, missionId))
    })

  const builtWith = (perTask: boolean) =>
    Effect.gen(function* () {
      const { mission } = yield* launched(work)
      if (perTask) yield* commitsSay(mission.id, ONE_COMMIT_PER_TASK)
      const { session, grantId } = yield* builderOf(mission.id)
      const api = join(session.folder, 'api')
      // The user's own identity, as their machine has it.
      git(api, 'config', 'user.name', 'Ada Lovelace')
      git(api, 'config', 'user.email', 'ada@example.com')
      git(api, 'config', 'commit.gpgsign', 'false')
      const head = git(api, 'rev-parse', 'HEAD')
      const helper = yield* helperOf(mission.id, session.folder)
      yield* call(grantId, 'task_start', { task: 'T1' })
      yield* call(helper.grantId, 'task_start', { task: 'T2' })
      yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
      yield* call(grantId, 'fs_write', {
        repository: 'api',
        path: 'invoices.ts',
        content: 'export const invoices = ["csv"]\n',
      })
      yield* call(helper.grantId, 'fs_write', {
        repository: 'api',
        path: 'export.ts',
        content: 'export const markdown = true\n',
      })
      yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
      yield* taskIn(mission.id, 'T1', 'done')
      if (perTask) {
        yield* until(Effect.map(eventsOf(mission.id, 'building.commit'), (rows) => rows.length > 0))
      }
      return {
        log: git(api, 'log', '--format=%an <%ae>|%s', `${head}..HEAD`),
        files: git(api, 'show', '--name-only', '--format=', 'HEAD'),
        status: git(api, 'status', '--porcelain'),
      }
    })

  /** A Building whose copy commits per task, its Builder on T1, and api set to the user's identity. */
  const committing = (
    more: { readonly before?: (projectId: string) => Effect.Effect<void> } = {},
  ) =>
    Effect.gen(function* () {
      const { project, mission } = yield* launched(work, more.before)
      yield* commitsSay(mission.id, ONE_COMMIT_PER_TASK)
      const { session, grantId } = yield* builderOf(mission.id)
      const api = join(session.folder, 'api')
      git(api, 'config', 'user.name', 'Ada Lovelace')
      git(api, 'config', 'user.email', 'ada@example.com')
      git(api, 'config', 'commit.gpgsign', 'false')
      const head = git(api, 'rev-parse', 'HEAD')
      yield* call(grantId, 'task_start', { task: 'T1' })
      yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
      yield* call(grantId, 'fs_write', {
        repository: 'api',
        path: 'invoices.ts',
        content: 'export const invoices = ["csv"]\n',
      })
      return { project, mission, session, grantId, api, head }
    })

  const committed = (missionId: string) =>
    until(Effect.map(eventsOf(missionId, 'building.commit'), (rows) => rows.length > 0))

  test('a file the task wrote and then removed is left out, and the rest is committed', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* committing()
          yield* call(grantId, 'fs_write', { repository: 'api', path: 'gone.ts', content: 'x\n' })
          rmSync(join(api, 'gone.ts'))
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* committed(mission.id)
          return {
            log: git(api, 'log', '--format=%s', `${head}..HEAD`),
            files: git(api, 'show', '--name-only', '--format=', 'HEAD'),
          }
        }),
      ),
    )
    expect(seen.log).toBe('ACME-1 T1: Export as CSV')
    expect(seen.files).toBe('invoices.ts')
  })

  test('a file a task’s command renamed is committed with its old path’s removal', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId, api } = yield* committing()
          const mover = join(scripts, 'mover.mjs')
          writeFileSync(
            mover,
            "import { renameSync } from 'node:fs'\nrenameSync(process.argv[2], process.argv[3])\n",
          )
          const apiRepository = (yield* getProject(project.id)).repositories.find(
            (one) => one.path === 'api',
          )
          const move = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: draft('move', nodeLine(mover, 'README.md', 'DOCS.md'), {
              repositoryId: apiRepository?.id ?? null,
            }),
          })
          yield* call(grantId, 'commands_run', { command: move.id, timeout: 60 })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* committed(mission.id)
          return {
            files: git(api, 'show', '--name-status', '--no-renames', '--format=', 'HEAD'),
            status: git(api, 'status', '--porcelain'),
          }
        }),
      ),
    )
    expect(seen.files).toContain('A\tDOCS.md')
    expect(seen.files).toContain('D\tREADME.md')
    expect(seen.status).not.toContain('README.md')
  })

  test('a repository switched off its branch is not committed on: Hemera asks the user instead', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* committing()
          git(api, 'checkout', '-q', '-b', 'elsewhere')
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* taskIn(mission.id, 'T1', 'done')
          yield* until(
            Effect.map(getMission(mission.id), (one) =>
              one.needs.some((need) => Predicate.isTagged(need.fields, 'Environment')),
            ),
          )
          return {
            log: git(api, 'log', '--format=%s', `${head}..HEAD`),
            commits: yield* eventsOf(mission.id, 'building.commit'),
            needs: (yield* getMission(mission.id)).needs.map((need) => need.fields),
          }
        }),
      ),
    )
    expect(seen.log).toBe('')
    expect(seen.commits).toEqual([])
    const asked = seen.needs.find((fields) => Predicate.isTagged(fields, 'Environment'))
    if (!Predicate.isTagged(asked, 'Environment')) return expect.unreachable()
    expect(asked.missing).toContain('elsewhere')
  })

  test('a task whose own command still runs is committed only once that command has ended', async () => {
    const release = join(scripts, 'release-late')
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission, grantId, api } = yield* committing()
          const late = yield* apiCommand(project.id, 'late', ['invoices.ts=late'], { release })
          yield* call(grantId, 'commands_run', { command: late.id, timeout: 1 })
          yield* call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' })
          yield* taskIn(mission.id, 'T1', 'done')
          yield* Effect.sleep('500 millis')
          const early = yield* eventsOf(mission.id, 'building.commit')
          writeFileSync(release, '')
          yield* committed(mission.id)
          return { early, content: git(api, 'show', 'HEAD:invoices.ts') }
        }),
      ),
    )
    expect(seen.early).toEqual([])
    expect(seen.content).toBe('late')
  })

  test('a stop between a task’s done and its commit commits it at the next start', async () => {
    const hold: BuilderHold = (at) => (at === 'committing' ? Effect.never : Effect.void)
    const before = builderEngine(data, work, { hold })
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, grantId, api, head } = yield* committing()
          yield* Effect.forkChild(call(grantId, 'task_finished', { task: 'T1', summary: 'CSV.' }))
          yield* taskIn(mission.id, 'T1', 'done')
          return { mission, api, head }
        }),
      ),
    )
    const after = builderEngine(data, work)
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* committed(first.mission.id)
          return { log: git(first.api, 'log', '--format=%s', `${first.head}..HEAD`) }
        }),
      ),
    )
    expect(seen.log).toBe('ACME-1 T1: Export as CSV')
  })

  test('with a “one commit per task” copy, a done task is committed with only its files and the user’s identity', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) => within(profile, builtWith(true)))
    expect(seen.log).toBe('Ada Lovelace <ada@example.com>|ACME-1 T1: Export as CSV')
    expect(seen.files).toBe('invoices.ts')
    expect(seen.status).toContain('?? export.ts')
  })

  test('without it, nothing is committed', async () => {
    const { run } = builderEngine(data, work)
    const seen = await run(({ profile }) => within(profile, builtWith(false)))
    expect(seen.log).toBe('')
  })
})

describe('What the roles are told of reds', () => {
  test('the Builder and the helper both read how a red comes back and what to do with it', () => {
    const said = (text: string) => text.replaceAll(/\s+/g, ' ')
    const sentence =
      'Hemera runs the checks after task_finished. A red comes back to you as a delivery: the check, the place it ran in and the end of its output. Fix it in the same task, then task_finished again.'
    expect(said(BUILDER_TEMPLATE)).toContain(sentence)
    expect(said(HELPER_TEMPLATE)).toContain(sentence)
  })
})
