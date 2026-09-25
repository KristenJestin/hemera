/**
 * The Project's checks, and how a build runs them (design D10-06, D10-07, L4, L5, L12).
 *
 * Every suite is named after the scenario of `Spec · build-checks` it covers, or after what it
 * proves, and runs over the whole engine on the fake agent `window.ts` composes: the checks are
 * real runs of the Commands service, `node` itself started in real repositories.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CheckDraft, CheckWhen } from '@hemera/core'
import { Effect } from 'effect'
import { afterEach, beforeEach, expect, test } from 'vite-plus/test'

import { fakeAgent } from '#engine/agents/fake.ts'
import { BuildChecks, type CheckRunRequest, ProjectChecks } from '#engine/build/checks.ts'
import { Commands } from '#engine/commands/service.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { SqliteClient } from '#engine/storage/database.ts'

import { repository } from './repositories.ts'
import { type OpenWindow, openWindow } from './window.ts'

let dataFolder: string
let opened: OpenWindow | undefined

beforeEach(() => {
  dataFolder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-build-checks-')))
})

afterEach(async () => {
  await opened?.close()
  opened = undefined
  rmSync(dataFolder, { recursive: true, force: true })
})

/** The folder of the Project's `main`, which holds its three repositories. */
const mainOf = () => join(dataFolder, 'main')

/** `Atlas` on a real `main` of three repositories: `sources/api`, `sources/front`, `sources/docs`. */
const atlas = Effect.gen(function* () {
  const main = mainOf()
  const locations = ['sources/api', 'sources/front', 'sources/docs']
  for (const location of locations) repository(join(main, location))
  const projects = yield* Projects
  let project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: main })
  for (const location of locations) {
    project = yield* projects.addRepository(project.id, project.version, `./${location}`)
  }
  return project
})

/** A command of the catalogue, of the type given, run at the root unless a base is named. */
const command = (
  projectId: string,
  name: string,
  type: 'serve' | 'test' | 'lint' | 'build',
  line: string,
  folderBase: string | null = null,
) =>
  Effect.gen(function* () {
    return yield* (yield* Commands).save(
      {
        projectId,
        name,
        line,
        type,
        lineWindows: null,
        lineLinux: null,
        folderBase,
        folder: null,
        scope: 'workspace',
        portless: false,
        portlessName: null,
      },
      false,
    )
  })

/** A check of a line of the user's, at the Workspace root after each task, unless told otherwise. */
const draft = (name: string, line: string, changes: Partial<CheckDraft> = {}): CheckDraft => ({
  name,
  commandId: null,
  line,
  where: 'root',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
  ...changes,
})

/** The Journal lines of the Project's checks, in the order they were written. */
const checkLines = Effect.gen(function* () {
  const sql = yield* SqliteClient
  return yield* sql<{ type: string; entity_kind: string; payload: string }>`
    SELECT type, entity_kind, payload FROM domain_events
    WHERE type LIKE 'check.%' ORDER BY sequence`
})

/**
 * A line running `node` itself, reached through `process.execPath` rather than the `PATH`: a line
 * is run and not interpreted, so the code is one quoted word, with single quotes inside it.
 */
const node = (code: string) => `"${process.execPath}" -e "${code}"`

/** A line that prints the folder it runs in. */
const PRINTS_ITS_FOLDER = node('console.log(process.cwd())')

/** A line that prints the files `{files}` handed it, and nothing else. */
const PRINTS_ITS_FILES = `${node("console.log(process.argv.slice(1).join(' '))")} {files}`

/**
 * A build Session of the Project, on a Spec and the revision it pins, with one task: what a
 * launch and the build's own `prepare` write, written here as rows since neither is this suite's.
 */
const aBuild = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const session = yield* (yield* Sessions).create(projectId, 'claude')
    const at = '2026-09-25T08:00:00.000Z'
    yield* sql`INSERT INTO specs
      (id, project_id, key, slug, status, current_revision_id, created_at, updated_at)
      VALUES ('spec-export', ${projectId}, 'ATL-1', 'export', 'in_progress', 'revision-export', ${at}, ${at})`
    yield* sql`INSERT INTO spec_revisions (id, spec_id, number, title, type, created_by, created_at)
      VALUES ('revision-export', 'spec-export', 1, 'Export', 'feature', 'human', ${at})`
    yield* sql`UPDATE sessions SET mission = 'build', spec_id = 'spec-export',
      revision_id = 'revision-export', build_phase = 'execute' WHERE id = ${session.id}`
    yield* sql`INSERT INTO build_tasks (id, session_id, task_id, label, rank, state, updated_at)
      VALUES ('task-export', ${session.id}, 'spec-task-export', 'T1', 'i', 'checking', ${at})`
    return session.id
  })

/** Attempt `number` at the build's task, which the results are written under. */
const anAttempt = (sessionId: string, number: number) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    const id = `attempt-${String(number)}`
    yield* sql`INSERT INTO build_attempts (id, session_id, scope, build_task_id, number, started_at)
      VALUES (${id}, ${sessionId}, 'task', 'task-export', ${number}, '2026-09-25T08:01:00.000Z')`
    return id
  })

/** The checks of `when` asked for one try at T1, in `main`, for the changes given. */
const asked = (
  projectId: string,
  sessionId: string,
  attemptId: string,
  when: CheckWhen,
  changes: CheckRunRequest['changes'] = [],
): CheckRunRequest => ({
  sessionId,
  projectId,
  workspaceId: null,
  when,
  attemptId,
  scope: 'task',
  label: 'T1',
  changes,
})

/** The results written under an attempt, as their rows hold them. */
const resultRows = (attemptId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqliteClient
    return yield* sql<{
      id: string
      check_id: string | null
      name: string
      place: string
      line: string
      run_id: string | null
      verdict: string
      exit_code: number | null
      value: number | null
      detail: string | null
      output_tail: string
    }>`SELECT id, check_id, name, place, line, run_id, verdict, exit_code, value, detail,
      output_tail FROM build_check_results WHERE attempt_id = ${attemptId} ORDER BY ran_at`
  })

test('Defaults come from the catalogue', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      yield* command(project.id, 'lint', 'lint', 'oxlint')
      yield* command(project.id, 'unit', 'test', 'vitest run')
      yield* command(project.id, 'e2e', 'test', 'wdio run')
      yield* command(project.id, 'bundle', 'build', 'vite build')
      yield* command(project.id, 'dev', 'serve', 'vite')
      const checks = yield* ProjectChecks
      const proposed = yield* checks.proposed(project.id)
      // Shown, and nothing saved by being shown: asked twice, it is proposed twice.
      const listedBefore = yield* checks.list(project.id)
      const proposedAgain = yield* checks.proposed(project.id)
      // The user edits one proposal before accepting them all.
      const edited = proposed.map((one): CheckDraft =>
        one.name === 'unit' ? { ...one, when: 'task' } : one,
      )
      const accepted = yield* checks.acceptProposed(project.id, edited)
      return {
        proposed,
        listedBefore,
        proposedAgain,
        accepted,
        listedAfter: yield* checks.list(project.id),
        proposedAfter: yield* checks.proposed(project.id),
      }
    }),
  )

  // From the types (D10-06): a lint after each task in each changed repository, a test after
  // each story, an end-to-end suite and a build at the end at the root; a server never.
  // The catalogue's order is its commands' creation, which one millisecond may not tell apart.
  const byName = <T extends { name: string }>(list: readonly T[]) =>
    [...list].sort((left, right) => left.name.localeCompare(right.name))
  expect(byName(seen.proposed).map(({ name, when, where }) => ({ name, when, where }))).toEqual([
    { name: 'bundle', when: 'end', where: 'root' },
    { name: 'e2e', when: 'end', where: 'root' },
    { name: 'lint', when: 'task', where: 'changed' },
    { name: 'unit', when: 'story', where: 'changed' },
  ])
  expect(seen.listedBefore).toEqual([])
  expect(seen.proposedAgain).toEqual(seen.proposed)

  // Accepted, they are the Project's, in the order proposed, the edit kept.
  expect(seen.listedAfter).toEqual(seen.accepted)
  expect(seen.listedAfter.map(({ name }) => name)).toEqual(seen.proposed.map(({ name }) => name))
  expect(byName(seen.listedAfter).map(({ name, when }) => ({ name, when }))).toEqual([
    { name: 'bundle', when: 'end' },
    { name: 'e2e', when: 'end' },
    { name: 'lint', when: 'task' },
    { name: 'unit', when: 'task' },
  ])
  // Once the Project has a check, nothing is proposed any more.
  expect(seen.proposedAfter).toEqual([])
})

test('A check is saved last, refused with its reason, edited and removed', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const checks = yield* ProjectChecks
      const first = yield* checks.save(project.id, draft('types', 'tsc --noEmit'), null)
      const second = yield* checks.save(project.id, draft('unit', 'vitest run'), null)
      const twice = yield* Effect.flip(
        checks.save(project.id, draft('types', 'tsc --noEmit'), null),
      )
      const nowhere = yield* Effect.flip(
        checks.save(project.id, draft('api', 'vitest run', { where: 'repository' }), null),
      )
      const edited = yield* checks.save(
        project.id,
        draft('types', 'tsc -b', {
          where: 'repository',
          repository: './sources/api',
          expect: { pattern: 'Coverage: ([\\d.]+)', minimum: 70 },
        }),
        first.id,
      )
      yield* checks.remove(second.id)
      const gone = yield* Effect.flip(checks.remove(second.id))
      return {
        first,
        second,
        twice: twice.message,
        nowhere: nowhere.message,
        edited,
        gone: gone.message,
        listed: yield* checks.list(project.id),
        lines: yield* checkLines,
      }
    }),
  )

  // A new check goes last.
  expect(seen.second.rank > seen.first.rank).toBe(true)
  // Refused with the sentence the dialog shows (D10-06), nothing written.
  expect(seen.twice).toBe('A check named “types” already exists.')
  expect(seen.nowhere).toBe('Choose the repository the check runs in.')
  // Edited in place, its rank kept.
  expect(seen.edited).toEqual({
    ...seen.first,
    line: 'tsc -b',
    where: 'repository',
    repository: './sources/api',
    expect: { pattern: 'Coverage: ([\\d.]+)', minimum: 70 },
  })
  expect(seen.listed).toEqual([seen.edited])
  expect(seen.gone).toBe(`no check of this Project has the identifier "${seen.second.id}"`)
  expect(seen.lines.map(({ type, entity_kind }) => [type, entity_kind])).toEqual([
    ['check.created', 'project'],
    ['check.created', 'project'],
    ['check.updated', 'project'],
    ['check.removed', 'project'],
  ])
})

test('A check runs in each repository the task changed', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      yield* (yield* ProjectChecks).save(
        project.id,
        draft('where', PRINTS_ITS_FOLDER, { where: 'changed' }),
        null,
      )
      const sessionId = yield* aBuild(project.id)
      const attemptId = yield* anAttempt(sessionId, 1)
      // The task changed two of the three repositories; the third is named with nothing in it.
      const outcomes = yield* (yield* BuildChecks).run(
        asked(project.id, sessionId, attemptId, 'task', [
          { repository: 'sources/api', files: [{ path: 'src/export.ts', status: 'M' }] },
          { repository: './sources/front', files: [{ path: 'src/export.tsx', status: 'A' }] },
          { repository: 'sources/docs', files: [] },
        ]),
      )
      const commands = yield* Commands
      const runs = []
      for (const outcome of outcomes) {
        runs.push(yield* commands.runOf(project.id, outcome.runId ?? ''))
      }
      return { sessionId, outcomes, runs, rows: yield* resultRows(attemptId) }
    }),
  )

  const main = mainOf()
  // Twice, once in each changed repository, and not in the third.
  expect(seen.outcomes.map(({ place, verdict }) => ({ place, verdict }))).toEqual([
    { place: 'sources/api', verdict: 'green' },
    { place: 'sources/front', verdict: 'green' },
  ])
  expect(seen.runs.map(({ cwd, folder }) => ({ cwd, folder }))).toEqual([
    { cwd: join(main, 'sources', 'api'), folder: './sources/api' },
    { cwd: join(main, 'sources', 'front'), folder: './sources/front' },
  ])
  expect(seen.outcomes.map(({ outputTail }) => outputTail)).toEqual([
    join(main, 'sources', 'api'),
    join(main, 'sources', 'front'),
  ])
  // Runs of the build Session, started by the user and never by the agent (L12).
  expect(seen.runs.map(({ sessionId, startedBy }) => ({ sessionId, startedBy }))).toEqual([
    { sessionId: seen.sessionId, startedBy: 'user' },
    { sessionId: seen.sessionId, startedBy: 'user' },
  ])
  expect(seen.rows.map(({ place, run_id }) => ({ place, run_id }))).toEqual(
    seen.outcomes.map(({ place, runId }) => ({ place, run_id: runId })),
  )
})

test('A value under its minimum is red', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const outcomes = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const checks = yield* ProjectChecks
      const coverage = { pattern: 'Coverage: ([\\d.]+)', minimum: 70 }
      yield* checks.save(
        project.id,
        draft('coverage', node("console.log('Coverage: 64.2%')"), {
          when: 'story',
          expect: coverage,
        }),
        null,
      )
      yield* checks.save(
        project.id,
        draft('coverage again', node("console.log('Coverage: 80%')"), {
          when: 'story',
          expect: coverage,
        }),
        null,
      )
      const sessionId = yield* aBuild(project.id)
      const attemptId = yield* anAttempt(sessionId, 1)
      return yield* (yield* BuildChecks).run(asked(project.id, sessionId, attemptId, 'story'))
    }),
  )

  expect(
    outcomes.map(({ name, verdict, exitCode, value, detail }) => ({
      name,
      verdict,
      exitCode,
      value,
      detail,
    })),
  ).toEqual([
    { name: 'coverage', verdict: 'red', exitCode: 0, value: 64.2, detail: '64.2 < 70' },
    { name: 'coverage again', verdict: 'green', exitCode: 0, value: 80, detail: null },
  ])
})

test('Only the tests the task wrote run', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      yield* (yield* ProjectChecks).save(
        project.id,
        draft('e2e', PRINTS_ITS_FILES, { where: 'changed', files: 'e2e/**/*.e2e.ts' }),
        null,
      )
      const sessionId = yield* aBuild(project.id)
      const builds = yield* BuildChecks
      // The task added one end-to-end test, changed a source file and deleted an old test.
      const wrote = yield* builds.run(
        asked(project.id, sessionId, yield* anAttempt(sessionId, 1), 'task', [
          {
            repository: 'sources/front',
            files: [
              { path: 'e2e/login.e2e.ts', status: 'A' },
              { path: 'src/login.ts', status: 'M' },
              { path: 'e2e/old.e2e.ts', status: 'D' },
            ],
          },
        ]),
      )
      const run = yield* (yield* Commands).runOf(project.id, wrote[0]?.runId ?? '')
      // The next attempt added none.
      const none = yield* builds.run(
        asked(project.id, sessionId, yield* anAttempt(sessionId, 2), 'task', [
          { repository: 'sources/front', files: [{ path: 'src/login.ts', status: 'M' }] },
        ]),
      )
      const sql = yield* SqliteClient
      const [runs] = yield* sql<{ count: number }>`SELECT count(*) AS count FROM command_runs`
      return { wrote, run, none, runs: runs?.count }
    }),
  )

  // The line runs with that file only.
  expect(seen.run.line).toBe(PRINTS_ITS_FILES.replace('{files}', 'e2e/login.e2e.ts'))
  expect(
    seen.wrote.map(({ line, verdict, outputTail }) => ({ line, verdict, outputTail })),
  ).toEqual([{ line: seen.run.line, verdict: 'green', outputTail: 'e2e/login.e2e.ts' }])
  // With none, the check is skipped and nothing runs.
  expect(seen.none.map(({ verdict, runId, detail }) => ({ verdict, runId, detail }))).toEqual([
    { verdict: 'skipped', runId: null, detail: 'no changed file matched e2e/**/*.e2e.ts' },
  ])
  expect(seen.runs).toBe(1)
})

test('A check that exits otherwise than 0, or never starts, is red with what happened', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const outcomes = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const checks = yield* ProjectChecks
      yield* checks.save(
        project.id,
        draft('fails', node("console.log('1 failed');process.exit(2)")),
        null,
      )
      yield* checks.save(project.id, draft('missing', 'hemera-no-such-program --run'), null)
      const sessionId = yield* aBuild(project.id)
      const attemptId = yield* anAttempt(sessionId, 1)
      return yield* (yield* BuildChecks).run(asked(project.id, sessionId, attemptId, 'task'))
    }),
  )

  expect(outcomes[0]).toMatchObject({
    name: 'fails',
    verdict: 'red',
    exitCode: 2,
    detail: 'exited with 2',
    outputTail: '1 failed',
  })
  expect(outcomes[1]).toMatchObject({ name: 'missing', verdict: 'red', exitCode: null })
  expect(outcomes[1]?.detail).toContain('hemera-no-such-program')
})

test('A catalogue command runs its own line in its own folder', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const suite = yield* command(
        project.id,
        'api tests',
        'test',
        PRINTS_ITS_FOLDER,
        './sources/api',
      )
      yield* (yield* ProjectChecks).save(
        project.id,
        draft('api tests', '', { commandId: suite.id, line: null, when: 'end' }),
        null,
      )
      const sessionId = yield* aBuild(project.id)
      const attemptId = yield* anAttempt(sessionId, 1)
      const outcomes = yield* (yield* BuildChecks).run(
        asked(project.id, sessionId, attemptId, 'end'),
      )
      const run = yield* (yield* Commands).runOf(project.id, outcomes[0]?.runId ?? '')
      return { suite, outcomes, run }
    }),
  )

  // At the root, a command runs where the catalogue puts it: its base, under the Workspace (L5).
  const api = join(mainOf(), 'sources', 'api')
  expect(
    seen.outcomes.map(({ place, line, verdict, outputTail }) => ({
      place,
      line,
      verdict,
      outputTail,
    })),
  ).toEqual([{ place: '', line: PRINTS_ITS_FOLDER, verdict: 'green', outputTail: api }])
  expect(seen.run).toMatchObject({ commandId: seen.suite.id, cwd: api, folder: './sources/api' })
})

test('The results survive a restart, each with its Journal line', async () => {
  opened = await openWindow(dataFolder, fakeAgent())
  const ran = await opened.running(
    Effect.gen(function* () {
      const project = yield* atlas
      const checks = yield* ProjectChecks
      yield* checks.save(project.id, draft('passes', node("console.log('ok')")), null)
      yield* checks.save(project.id, draft('fails', node('process.exit(1)')), null)
      const sessionId = yield* aBuild(project.id)
      const attemptId = yield* anAttempt(sessionId, 1)
      const outcomes = yield* (yield* BuildChecks).run(
        asked(project.id, sessionId, attemptId, 'task'),
      )
      return { sessionId, attemptId, outcomes }
    }),
  )
  await opened.close()

  opened = await openWindow(dataFolder, fakeAgent())
  const seen = await opened.running(
    Effect.gen(function* () {
      const sql = yield* SqliteClient
      return {
        rows: yield* resultRows(ran.attemptId),
        lines: yield* sql<{
          entity_kind: string
          entity_id: string
          session_id: string | null
          spec_id: string | null
          revision_id: string | null
          payload: string
        }>`SELECT entity_kind, entity_id, session_id, spec_id, revision_id, payload
          FROM domain_events WHERE type = 'check.ran' ORDER BY sequence`,
      }
    }),
  )

  expect(seen.rows).toEqual(
    ran.outcomes.map((outcome) => ({
      id: outcome.id,
      check_id: outcome.checkId,
      name: outcome.name,
      place: outcome.place,
      line: outcome.line,
      run_id: outcome.runId,
      verdict: outcome.verdict,
      exit_code: outcome.exitCode,
      value: outcome.value,
      detail: outcome.detail,
      output_tail: outcome.outputTail,
    })),
  )
  expect(seen.rows.map(({ name, verdict }) => [name, verdict])).toEqual([
    ['passes', 'green'],
    ['fails', 'red'],
  ])
  // One line per result, about the build Session, correlated as its row is (D10-14).
  expect(
    seen.lines.map((line) => [line.entity_kind, line.entity_id, line.session_id, line.spec_id]),
  ).toEqual(ran.outcomes.map(() => ['session', ran.sessionId, ran.sessionId, 'spec-export']))
  expect(seen.lines.map((line) => line.revision_id)).toEqual(['revision-export', 'revision-export'])
  expect(seen.lines.map((line) => line.payload)).toEqual(
    ran.outcomes.map((outcome) =>
      JSON.stringify({
        checkId: outcome.checkId,
        name: outcome.name,
        place: '',
        verdict: outcome.verdict,
        detail: outcome.detail,
        // The try it judged: the task by its label (D10-14).
        scope: 'task',
        label: 'T1',
      }),
    ),
  )
})
