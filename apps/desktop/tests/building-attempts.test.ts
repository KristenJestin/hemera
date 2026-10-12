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

import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ChosenAnswer, WrittenAnswer } from '@hemera/core/domain'
import type { BuildingAttemptView, CommandDraft } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect, Fiber, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { BuildDesk } from '../src/engine/building/desk.ts'
import { type CheckResult, TaskChecks } from '../src/engine/building/checks.ts'
import { ONE_COMMIT_PER_TASK } from '../src/engine/building/validation.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed, getNeed } from '../src/engine/needs.ts'
import { getProject } from '../src/engine/projects.ts'
import { saveResources } from '../src/engine/resources/declarations.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  commandRuns,
  missionValidationSettings,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { beginAction } from '../src/engine/tools/actions.ts'
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
  building: { readonly checks?: Layer.Layer<TaskChecks> } = {},
) =>
  sessionsEngine(dataFolder, builderAgents, {
    roles: [HELPER],
    tools: { home: workFolder, verdicts: verdictsSaying(() => ALLOW).layer },
    building,
  })

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
          const second = yield* call(helper.grantId, 'task_finished', { task: 'T2', summary: 'B.' })
          return {
            first,
            second,
            between,
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

  test('a red at requirement scope opens an attempt on that scope for the Builder and changes no task state', async () => {
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
    expect(seen.after.scopes).toMatchObject([
      { scope: 'requirement', subject: 'R1', number: 1, verdict: null },
    ])
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

describe('An action cut by a restart (CT-09)', () => {
  test('an fs_write intent without outcome after a simulated crash is resolved from the file’s fingerprint; a command intent becomes indeterminate in the resume brief and is not run again', async () => {
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
          yield* beginAction('command.run', owner, {
            command: build.id,
            line: 'pnpm build',
            folder: null,
            sessionId: session.id,
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
    expect(pathsOf(attemptsOf(seen.view, 'T1')[0])).toEqual(['api/invoices.ts'])
  })

  test('on a command declared on an exclusive resource, a decision need is created and the task waits for it', async () => {
    const before = builderEngine(data, work)
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const migrate = yield* apiCommand(project.id, 'db:migrate', [])
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* saveResources(project.id, [
            {
              name: 'Shared database',
              description: 'The team database.',
              uses: [],
              changes: [migrate.id],
              resetCommandId: null,
            },
          ])
          yield* beginAction(
            'command.run',
            { kind: 'mission', missionId: mission.id, taskId: 'T1' },
            { command: migrate.id, line: 'pnpm db:migrate', folder: null, sessionId: session.id },
          )
          return { mission }
        }),
      ),
    )
    const after = builderEngine(data, work)
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
          return { need, blocked }
        }),
      ),
    )
    expect(Predicate.isTagged(seen.need?.fields, 'Decision')).toBe(true)
    const fields = seen.need?.fields
    if (!Predicate.isTagged(fields, 'Decision')) return
    expect(fields.question).toBe('`db:migrate` was cut by a restart. Did it run?')
    expect(fields.options).toEqual(['it ran', 'it did not run'])
    expect(seen.blocked.tasks.find((task) => task.id === 'T1')?.state).toBe('blocked')
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
