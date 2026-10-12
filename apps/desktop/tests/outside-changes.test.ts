/**
 * Changes made outside Hemera and the mission's services (#148): a file the user changes in the
 * Workspace is detected, once, marked "Changed outside Hemera" and told to the agents working
 * there; what Hemera's own writers explain (a gate write, a writing command within its globs, a
 * service's declared globs) is not; a command that overwrites a user's change says so and keeps
 * their version; a moved base is told and never stops the Building; the mission's services are
 * started, stopped, restarted and dismissed from the mission.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent, the test driving the
 * Builder's and a helper's tools through their grants; Acme's real repositories in temporary
 * folders as the Workspace, and small Node scripts as the catalogue's commands.
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { ChangedOutsideMark, PermissionAnswer, markIdentity } from '@hemera/core/domain'
import type { CommandDraft } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Deferred, Effect, Fiber, Predicate, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { BuilderHold } from '../src/engine/building/builder.ts'
import { OutsideChanges, type OutsideSettings } from '../src/engine/building/outside.ts'
import {
  dismissService,
  missionServices,
  restartService,
  startService,
  stopService,
} from '../src/engine/building/services.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { sinceYouLeft } from '../src/engine/home/since-you-left.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { getMission } from '../src/engine/missions.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { getProject } from '../src/engine/projects.ts'
import { openSession } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  baseMoves,
  buildings,
  commandRuns,
  effectfulActions,
  outsideChanges,
  outsideWatches,
  sessionDeliveries,
} from '../src/engine/storage/schema.ts'
import { call, eventsOf, grantOf, pushedOnRemote } from './building-world.ts'
import { builderAgents, builderOf, launched } from './builder-world.ts'
import { SERVES, nodeLine, script } from './commands-engine.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
let scripts: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('outside-changes'))
  work = realpathSync.native(temporaryFolder('outside-changes-work'))
  scripts = realpathSync.native(temporaryFolder('outside-changes-scripts'))
})
afterEach(removeFolders)

/** The detector's timers: never on their own unless a suite says, so a compare is the test's. */
const QUIET_TIMERS: Partial<OutsideSettings> = {
  compareEveryMillis: 3_600_000,
  baseEveryMillis: 3_600_000,
}

/** The engine over `data`, with the Builder, a helper role, and every agent's call allowed. */
const engine = (outside: Partial<OutsideSettings> = {}, hold?: BuilderHold) =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: {
      outside: { ...QUIET_TIMERS, ...outside },
      hold: hold ?? (() => Effect.void),
    },
  })

/** Writes each `path=content` given in its folder once `release` exists when it names one. */
const WRITER = `
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
const [release, ...writes] = process.argv.slice(2)
const wait = () => new Promise((done) => setTimeout(done, 20))
while (release !== '-' && !existsSync(release)) await wait()
for (const write of writes) {
  const [path, content] = write.split('=')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content + '\\n')
}
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

const apiId = (projectId: string) =>
  Effect.map(
    getProject(projectId),
    (project) => project.repositories.find((one) => one.path === 'api')?.id ?? null,
  )

/** A catalogue command in `api` that writes the files given, once `release` exists if named. */
const apiCommand = (
  projectId: string,
  name: string,
  writes: ReadonlyArray<string>,
  more: Partial<CommandDraft> & { readonly release?: string } = {},
) =>
  Effect.gen(function* () {
    const { release, ...rest } = more
    return yield* saveCommand({
      projectId,
      id: null,
      command: draft(name, nodeLine(writerScript(), release ?? '-', ...writes), {
        repositoryId: yield* apiId(projectId),
        ...rest,
      }),
    })
  })

/** A `serve` command of `api`: a dev server that says its address. */
const apiServer = (projectId: string, more: Partial<CommandDraft> = {}) =>
  Effect.gen(function* () {
    return yield* saveCommand({
      projectId,
      id: null,
      command: draft('web', nodeLine(script(SERVES), join(scripts, 'pids')), {
        type: 'serve',
        repositoryId: yield* apiId(projectId),
        ...more,
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
    const rows = yield* database
      .select({ body: sessionDeliveries.body })
      .from(sessionDeliveries)
      .where(and(eq(sessionDeliveries.targetLineage, lineage), eq(sessionDeliveries.kind, kind)))
    return rows.map((row) => row.body)
  })

/** The changes outside Hemera recorded for a mission, as `repository/path`. */
const recorded = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(outsideChanges)
      .where(eq(outsideChanges.missionId, missionId))
    return rows.map((row) => `${row.repository}/${row.path}`).toSorted()
  })

/** Whether every command of the mission ended and the Workspace was compared after its end. */
const comparedAfterEnd = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const ends = yield* database
      .select({ endedAt: effectfulActions.endedAt })
      .from(effectfulActions)
      .where(and(eq(effectfulActions.ownerId, missionId), eq(effectfulActions.kind, 'command.run')))
    const [building] = yield* database
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.missionId, missionId))
    const watches = yield* database
      .select({ comparedAt: outsideWatches.comparedAt })
      .from(outsideWatches)
      .where(eq(outsideWatches.buildingId, building?.id ?? ''))
    return ends.every(
      (end) =>
        end.endedAt !== null &&
        watches.some((watch) => end.endedAt !== null && watch.comparedAt >= end.endedAt),
    )
  })

/**
 * The user's index as if `path` had been checked out, the index written and the file rewritten at
 * the same size all in one second, a minute ago: its entry keeps the old content under the file's
 * present times, and the index's own time is that second, so Git reads the entry as racy and looks
 * at the content. Whenever a compare copies the index, it is in a later second. The index is
 * written `late` seconds into that second; what its time holds below the second is answered.
 */
const inOneSecond = (repository: string, path: string, late = 0) => {
  const target = join(repository, path)
  const then = Math.floor(Date.now() / 1000) - 60
  utimesSync(target, then, then)
  const file = statSync(target, { bigint: true })
  const index = git(repository, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
  const bytes = readFileSync(index)
  if (bytes.readUInt32BE(4) !== 2) throw new Error('the index is not of version 2')
  // A version 2 entry: 40 bytes of times and stat, the 20 bytes of its sha-1, 2 of flags, the path.
  const at = bytes.indexOf(Buffer.from(`${path}\0`)) - 62
  const second = 1_000_000_000n
  const times = [
    file.ctimeNs / second,
    file.ctimeNs % second,
    file.mtimeNs / second,
    file.mtimeNs % second,
  ]
  for (const [slot, value] of times.entries()) bytes.writeUInt32BE(Number(value), at + slot * 4)
  const body = bytes.subarray(0, bytes.length - 20)
  writeFileSync(index, Buffer.concat([body, createHash('sha1').update(body).digest()]))
  utimesSync(index, then + late, then + late)
  return statSync(index, { bigint: true }).mtimeNs % second
}

const compare = (missionId: string) =>
  OutsideChanges.use((outside) => outside.compare(missionId, null))

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

describe('A change made outside Hemera is detected (CT-22)', () => {
  test('a file changed by the test (as me) while nothing runs is detected within one tick, once, with the mark naming the repository and the Journal line', async () => {
    const tick = 300
    const { run } = engine({ compareEveryMillis: tick })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          // A tick first, so the expected tree stands before the user's change.
          yield* Effect.sleep(tick * 2)
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          const at = Date.now()
          yield* until(
            Effect.map(recorded(mission.id), (rows) => rows.length > 0),
            tick * 4,
          )
          const took = Date.now() - at
          // Several ticks more: still once.
          yield* Effect.sleep(tick * 3)
          yield* Memory.use((memory) => memory.catchUp)
          const journal = yield* Memory.use((memory) => memory.journal(mission.id, null))
          return {
            took,
            rows: yield* recorded(mission.id),
            marks: (yield* getMission(mission.id)).marks,
            apiId: yield* apiId(project.id),
            listed: yield* OutsideChanges.use((outside) => outside.list(mission.id)),
            journal: journal.lines.map((line) => line.text),
          }
        }),
      ),
    )
    expect(seen.took).toBeLessThan(tick * 2 + 1_000)
    expect(seen.rows).toEqual(['api/invoices.ts'])
    expect(seen.marks.map((one) => one.mark)).toContainEqual(
      ChangedOutsideMark.make({ repositoryId: seen.apiId ?? '' }),
    )
    expect(seen.marks.map((one) => one.sentence)).toContain('Changed outside Hemera')
    expect(seen.listed).toHaveLength(1)
    expect(seen.listed[0]?.repository).toBe('api')
    expect(seen.listed[0]?.changes.map((one) => one.path)).toEqual(['invoices.ts'])
    expect(seen.journal).toContain('Changed outside Hemera: api/invoices.ts')
  })

  test('a file written by an agent’s fs_write, or by a command within its globs, is not reported; a file outside a command’s declared globs during its run is reported', async () => {
    const release = join(scripts, 'release-generate')
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const generate = yield* apiCommand(
            project.id,
            'generate',
            ['client.generated.ts=generated'],
            { release, writeGlobs: ['**/*.generated.ts'] },
          )
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv"]\n',
          })
          const generating = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: generate.id, timeout: 60 }),
          )
          yield* until(runningOf(generate.id))
          // Mine, during its run, outside its globs.
          writeFileSync(join(session.folder, 'api', 'stray.md'), 'mine\n')
          yield* compare(mission.id)
          writeFileSync(release, '')
          yield* Fiber.join(generating)
          yield* compare(mission.id)
          return yield* recorded(mission.id)
        }),
      ),
    )
    expect(seen).toEqual(['api/stray.md'])
  })

  test('with a serve running and declaring no write globs, a change in its repository is reported (no blind window)', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const web = yield* apiServer(project.id)
          const { session } = yield* builderOf(mission.id)
          const started = yield* startService(mission.id, web.id)
          yield* until(
            Effect.map(missionServices(mission.id), (services) =>
              services.some((one) => one.runId === started.runId && one.state === 'ready'),
            ),
            10_000,
          )
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          yield* compare(mission.id)
          const rows = yield* recorded(mission.id)
          yield* stopService(mission.id, started.runId)
          return rows
        }),
      ),
    )
    expect(seen).toEqual(['api/invoices.ts'])
  })

  test('a service’s declared write globs explain what it writes there, and nothing else', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const web = yield* apiServer(project.id, { writeGlobs: ['dist/**'] })
          const { session } = yield* builderOf(mission.id)
          const started = yield* startService(mission.id, web.id)
          writeFileSync(join(session.folder, 'api', 'README.md'), 'mine\n')
          mkdirSync(join(session.folder, 'api', 'dist'), { recursive: true })
          writeFileSync(join(session.folder, 'api', 'dist', 'app.js'), 'built\n')
          yield* compare(mission.id)
          const rows = yield* recorded(mission.id)
          yield* stopService(mission.id, started.runId)
          return rows
        }),
      ),
    )
    expect(seen).toEqual(['api/README.md'])
  })

  test('a change I make during a writing command in the same repository is attributed to the command (the documented bound)', async () => {
    const release = join(scripts, 'release-format')
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['README.md=formatted'], {
            release,
          })
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          const formatting = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: format.id, timeout: 60 }),
          )
          yield* until(runningOf(format.id))
          writeFileSync(join(session.folder, 'api', 'mine.md'), 'mine\n')
          yield* compare(mission.id)
          writeFileSync(release, '')
          yield* Fiber.join(formatting)
          // The bound ends once Hemera recorded the command's end, and compared after it.
          yield* until(comparedAfterEnd(mission.id))
          const during = yield* recorded(mission.id)
          // Once it ended, the same act is the user's again.
          writeFileSync(join(session.folder, 'api', 'mine.md'), 'mine, after\n')
          yield* compare(mission.id)
          return { during, after: yield* recorded(mission.id) }
        }),
      ),
    )
    expect(seen.during).toEqual([])
    expect(seen.after).toEqual(['api/mine.md'])
  })

  test('the Builder and a helper in that repository get the note listing the files', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          const helper = yield* helperOf(mission.id, session.folder)
          yield* call(helper.grantId, 'task_start', { task: 'T2' })
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          writeFileSync(join(session.folder, 'api', 'README.md'), 'mine too\n')
          yield* compare(mission.id)
          return {
            builder: yield* deliveriesTo(session.lineage, 'outside'),
            helper: yield* deliveriesTo(helper.lineage, 'outside'),
          }
        }),
      ),
    )
    const note =
      'Changed outside Hemera: api/README.md, api/invoices.ts. Do not overwrite these changes: read the file again, keep them, build on them, and say in the Journal what you did.'
    expect(seen.builder).toEqual([note])
    expect(seen.helper).toEqual([note])
  })

  test('a gate write of an agent compares first: a change I made just before it is recorded and the writer is told', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          const answer = yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv"]\n',
          })
          return {
            answer,
            rows: yield* recorded(mission.id),
            told: yield* deliveriesTo(session.lineage, 'outside'),
          }
        }),
      ),
    )
    expect(seen.rows).toEqual(['api/invoices.ts'])
    expect(seen.answer).toMatch(/^refused/)
    expect(seen.told.join('\n')).toContain('Changed outside Hemera: api/invoices.ts.')
  })
})

describe('Races and restarts', () => {
  test('a gate write that lands while a compare takes its snapshot is never reported as outside', async () => {
    // The write, once compared before it, waits; a compare begins and waits before its snapshot;
    // then the write lands, and only then is the snapshot taken.
    const writing = Deferred.makeUnsafe<void>()
    const write = Deferred.makeUnsafe<void>()
    const holding = Deferred.makeUnsafe<void>()
    const snapshot = Deferred.makeUnsafe<void>()
    let armed = false
    const builderHold: BuilderHold = (at) =>
      at === 'writing' && !armed
        ? Effect.suspend(() => {
            armed = true
            return Effect.andThen(Deferred.succeed(writing, undefined), Deferred.await(write))
          })
        : Effect.void
    let held = false
    const hold: OutsideSettings['hold'] = (at) =>
      at === 'snapshot' && armed && !held
        ? Effect.suspend(() => {
            held = true
            return Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(snapshot))
          })
        : Effect.void
    const { run } = engine({ hold }, builderHold)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T2' })
          const writer = yield* Effect.forkChild(
            call(grantId, 'fs_write', {
              repository: 'api',
              path: 'export.ts',
              content: 'export const markdown = true\n',
            }),
          )
          yield* Deferred.await(writing)
          const comparing = yield* Effect.forkChild(compare(mission.id))
          yield* Deferred.await(holding)
          yield* Deferred.succeed(write, undefined)
          const answer = yield* Fiber.join(writer)
          yield* Deferred.succeed(snapshot, undefined)
          yield* Fiber.join(comparing)
          yield* compare(mission.id)
          return { answer, rows: yield* recorded(mission.id) }
        }),
      ),
    )
    expect(seen.answer).toMatch(/^wrote export\.ts/)
    expect(seen.rows).toEqual([])
  })

  // Not a test of the order of the writers and the snapshot: a launch compares its repositories
  // first, one compare at a time, so a command is running when a compare starts or starts after
  // it, and either order sees it. The gate write's race above is the one the order decides.
  test('a writing command running when a compare starts, which writes and ends during its snapshot, explains what it wrote', async () => {
    const release = join(scripts, 'release-generate')
    const holding = Deferred.makeUnsafe<void>()
    const go = Deferred.makeUnsafe<void>()
    // Armed once the command runs: the compare before its launch is not the one held.
    let armed = false
    let held = false
    const hold: OutsideSettings['hold'] = (at) =>
      at === 'snapshot' && armed && !held
        ? Effect.suspend(() => {
            held = true
            return Effect.andThen(Deferred.succeed(holding, undefined), Deferred.await(go))
          })
        : Effect.void
    const { run } = engine({ hold })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const generate = yield* apiCommand(project.id, 'generate', ['client.ts=generated'], {
            release,
            writeGlobs: ['client.ts'],
          })
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          const generating = yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: generate.id, timeout: 60 }),
          )
          yield* until(runningOf(generate.id))
          armed = true
          const comparing = yield* Effect.forkChild(compare(mission.id))
          yield* Deferred.await(holding)
          // The command writes and its process ends once the compare began, before its snapshot;
          // the user writes outside its globs meanwhile, which the command does not explain.
          writeFileSync(release, '')
          writeFileSync(join(session.folder, 'api', 'mine.md'), 'mine\n')
          yield* until(Effect.sync(() => existsSync(join(session.folder, 'api', 'client.ts'))))
          yield* until(Effect.map(runningOf(generate.id), (going) => !going))
          yield* Deferred.succeed(go, undefined)
          yield* Fiber.join(comparing)
          yield* Fiber.join(generating)
          yield* compare(mission.id)
          return yield* recorded(mission.id)
        }),
      ),
    )
    expect(seen).toEqual(['api/mine.md'])
  })

  /** `README.md` rewritten at the same size in one second with the index, then compared. */
  const sameSize = (late: number) =>
    engine().run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          const api = join(session.folder, 'api')
          // "Acme api" and "mine too" are nine bytes each.
          writeFileSync(join(api, 'README.md'), 'mine too\n')
          const fraction = inOneSecond(api, 'README.md', late)
          // Git, on the user's own index, sees it changed.
          expect(git(api, 'ls-files', '--modified')).toBe('README.md')
          yield* compare(mission.id)
          return { fraction, rows: yield* recorded(mission.id) }
        }),
      ),
    )

  test('a file I rewrite at the same size in the second its Workspace was checked out is detected', async () => {
    const seen = await sameSize(0)
    expect(seen.rows).toEqual(['api/README.md'])
  })

  test('a file I rewrite at the same size in the second its Workspace was checked out is detected when the index was written at the very end of that second', async () => {
    const seen = await sameSize(0.9999)
    // The filesystem kept the fraction: the copy's time is never rounded up to the next second.
    expect(seen.fraction).toBeGreaterThan(0n)
    expect(seen.rows).toEqual(['api/README.md'])
  })

  test('after a restart, a change made while Hemera was stopped is detected once, and one detected before is not reported again', async () => {
    const before = engine()
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* launched(work)
          const { session } = yield* builderOf(mission.id)
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          yield* compare(mission.id)
          return { mission, folder: session.folder, rows: yield* recorded(mission.id) }
        }),
      ),
    )
    writeFileSync(join(first.folder, 'api', 'README.md'), 'mine while stopped\n')
    const after = engine()
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* compare(first.mission.id)
          yield* compare(first.mission.id)
          return yield* recorded(first.mission.id)
        }),
      ),
    )
    expect(first.rows).toEqual(['api/invoices.ts'])
    expect(seen).toEqual(['api/README.md', 'api/invoices.ts'])
  })
  test('a writing command cut by a restart no longer explains the changes made in its repository afterwards', async () => {
    const release = join(scripts, 'release-never')
    const before = engine()
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          // No globs: the whole repository is its to write while it runs.
          const format = yield* apiCommand(project.id, 'format', ['README.md=formatted'], {
            release,
          })
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          yield* Effect.forkChild(
            call(grantId, 'commands_run', { command: format.id, timeout: 60 }),
          )
          yield* until(runningOf(format.id))
          // The engine stops while the command runs: its action is left without an outcome.
          return { mission, folder: session.folder }
        }),
      ),
    )
    const after = engine()
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* compare(first.mission.id)
          writeFileSync(join(first.folder, 'api', 'mine.md'), 'mine after the restart\n')
          yield* compare(first.mission.id)
          return yield* recorded(first.mission.id)
        }),
      ),
    )
    expect(seen).toContain('api/mine.md')
  })
})

describe('A command never overwrites a change outside Hemera silently (CT-20)', () => {
  test('format rewriting a file I had changed: “overwritten by format” recorded, my version readable after the Workspace is gone, the runner told', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const format = yield* apiCommand(project.id, 'format', ['invoices.ts=formatted'])
          const { session, grantId } = yield* builderOf(mission.id)
          yield* call(grantId, 'task_start', { task: 'T4' })
          writeFileSync(join(session.folder, 'api', 'invoices.ts'), 'mine\n')
          yield* call(grantId, 'commands_run', { command: format.id, timeout: 60 })
          yield* compare(mission.id)
          const listed = yield* OutsideChanges.use((outside) => outside.list(mission.id))
          const change = listed[0]?.changes[0]
          rmSync(session.folder, { recursive: true, force: true })
          const read = yield* OutsideChanges.use((outside) =>
            outside.contents(mission.id, change?.id ?? ''),
          )
          yield* Memory.use((memory) => memory.catchUp)
          const journal = yield* Memory.use((memory) => memory.journal(mission.id, null))
          return {
            listed,
            read,
            told: yield* deliveriesTo(session.lineage, 'overwritten'),
            events: yield* eventsOf(mission.id, 'mission.overwritten_by_command'),
            journal: journal.lines.map((line) => line.text),
          }
        }),
      ),
    )
    expect(seen.listed.flatMap((one) => one.changes.map((change) => change.path))).toEqual([
      'invoices.ts',
    ])
    expect(seen.listed[0]?.changes[0]?.overwrittenBy).toMatchObject({
      command: 'format',
      task: 'T4',
    })
    expect(seen.read.after?.content).toBe('mine\n')
    expect(seen.read.before?.content).toBe('export const invoices = []\n')
    expect(seen.told).toEqual([
      '`format` overwrote your user’s change to api/invoices.ts; their version is kept: read both and restore what they meant.',
    ])
    expect(seen.events).toHaveLength(1)
    expect(seen.journal).toContain(
      '`format` of T4 overwrote a change made outside Hemera to api/invoices.ts; the user’s version is kept.',
    )
  })
})

describe('The base moving during a Building', () => {
  test('a moved base is recorded and shown, and the Building goes on', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, bare } = yield* Effect.map(launched(work), (one) => ({
            ...one,
            bare: join(work, 'remotes', 'acme-api.git'),
          }))
          const { grantId } = yield* builderOf(mission.id)
          const pushed = pushedOnRemote(work, bare, (clone) => {
            writeFileSync(join(clone, 'invoices.ts'), 'export const invoices = [1]\n')
            writeFileSync(join(clone, 'other.ts'), 'other\n')
          })
          yield* OutsideChanges.use((outside) => outside.focused)
          // Read twice: told once.
          yield* OutsideChanges.use((outside) => outside.focused)
          const database = yield* Database
          const moves = yield* database
            .select()
            .from(baseMoves)
            .where(eq(baseMoves.missionId, mission.id))
          yield* Memory.use((memory) => memory.catchUp)
          const journal = yield* Memory.use((memory) => memory.journal(mission.id, null))
          const told = yield* sinceYouLeft(null)
          const started = yield* call(grantId, 'task_start', { task: 'T1' })
          const [building] = yield* database
            .select({ state: buildings.state })
            .from(buildings)
            .where(eq(buildings.missionId, mission.id))
          return {
            pushed,
            moves,
            journal: journal.lines.map((line) => line.text),
            told: told.groups.flatMap((group) => group.events.map((event) => event.text)),
            started,
            state: building?.state,
            stage: (yield* getMission(mission.id)).stage,
            marks: (yield* getMission(mission.id)).marks.map((one) => markIdentity(one.mark)),
          }
        }),
      ),
    )
    expect(seen.moves).toHaveLength(1)
    expect(seen.moves[0]).toMatchObject({ repository: 'api', toCommit: seen.pushed })
    expect(JSON.parse(seen.moves[0]?.files ?? '[]')).toEqual(['invoices.ts', 'other.ts'])
    expect(JSON.parse(seen.moves[0]?.targeted ?? '[]')).toEqual(['invoices.ts'])
    const line = 'The base of api moved: 2 file(s) changed, invoices.ts among the targets.'
    expect(seen.journal).toContain(line)
    expect(seen.told.some((text) => text.includes('The base of api moved'))).toBe(true)
    expect(seen.started).not.toMatch(/^refused/)
    expect(seen.state).toBe('active')
    expect(seen.stage).toBe('building')
    expect(seen.marks.some((one) => one.startsWith('outdated:'))).toBe(false)
  })
})

describe('The mission’s services', () => {
  test('starting, stopping and restarting a service from the RPC; its URL once ready; a running service cannot be dismissed', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const web = yield* apiServer(project.id)
          const { session } = yield* builderOf(mission.id)
          const started = yield* startService(mission.id, web.id)
          yield* until(
            Effect.map(missionServices(mission.id), (services) =>
              services.some((one) => one.state === 'ready'),
            ),
            10_000,
          )
          const ready = (yield* missionServices(mission.id))[0]
          const refused = yield* Effect.result(dismissService(mission.id, started.runId))
          const restarted = yield* restartService(mission.id, started.runId)
          yield* until(
            Effect.map(missionServices(mission.id), (services) =>
              services.some((one) => one.runId === restarted.runId && one.state === 'ready'),
            ),
            10_000,
          )
          const afterRestart = yield* missionServices(mission.id)
          yield* stopService(mission.id, restarted.runId)
          const stopped = yield* missionServices(mission.id)
          yield* dismissService(mission.id, restarted.runId)
          return {
            ready,
            refused,
            afterRestart,
            stopped,
            dismissed: yield* missionServices(mission.id),
            told: yield* deliveriesTo(session.lineage, 'service'),
            events: [
              ...(yield* eventsOf(mission.id, 'service.started')),
              ...(yield* eventsOf(mission.id, 'service.restarted')),
              ...(yield* eventsOf(mission.id, 'service.stopped')),
            ],
          }
        }),
      ),
    )
    expect(seen.ready?.url).toMatch(/^http:\/\/localhost:\d+\/?$/)
    expect(seen.ready?.startedBy).toBe('user')
    expect(seen.ready?.name).toBe('web')
    expect(Result.isFailure(seen.refused)).toBe(true)
    expect(seen.afterRestart).toHaveLength(1)
    expect(seen.stopped.map((one) => one.state)).toEqual(['stopped'])
    expect(seen.dismissed).toEqual([])
    expect(seen.events).toHaveLength(3)
    expect(seen.told).toHaveLength(3)
    expect(seen.told[0]).toContain('The user started the service `web`')
  })

  test('an “ask before running” service asks, with Allow for this mission', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const web = yield* apiServer(project.id, { askBeforeRunning: true })
          yield* builderOf(mission.id)
          const started = yield* startService(mission.id, web.id)
          yield* until(
            Effect.map(getMission(mission.id), (one) =>
              one.needs.some((need) => Predicate.isTagged(need.fields, 'Permission')),
            ),
          )
          const need = (yield* getMission(mission.id)).needs.find((one) =>
            Predicate.isTagged(one.fields, 'Permission'),
          )
          const waiting = (yield* missionServices(mission.id))[0]
          yield* answerNeed({
            id: need?.id ?? '',
            answer: PermissionAnswer.make({ choice: 'allow-for-mission' }),
            key: 'allow-web',
          })
          yield* until(
            Effect.map(missionServices(mission.id), (services) =>
              services.some((one) => one.state === 'ready'),
            ),
            10_000,
          )
          yield* stopService(mission.id, started.runId)
          return { choices: need?.choices ?? [], waiting }
        }),
      ),
    )
    expect(seen.choices).toContain('allow-for-mission')
    expect(seen.waiting?.state).toBe('starting')
  })

  test('after a restart it shows stopped, with Start', async () => {
    const before = engine()
    const first = await before.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, mission } = yield* launched(work)
          const web = yield* apiServer(project.id)
          yield* builderOf(mission.id)
          const started = yield* startService(mission.id, web.id)
          yield* until(
            Effect.map(missionServices(mission.id), (services) =>
              services.some((one) => one.state === 'ready'),
            ),
            10_000,
          )
          return { mission, started }
        }),
      ),
    )
    const after = engine()
    const seen = await after.run(({ profile }) =>
      within(
        profile,
        Effect.suspend(() => missionServices(first.mission.id)),
      ),
    )
    expect(seen.map((one) => [one.runId, one.state])).toEqual([[first.started.runId, 'stopped']])
    expect(seen[0]?.dismissable).toBe(true)
  })
})
