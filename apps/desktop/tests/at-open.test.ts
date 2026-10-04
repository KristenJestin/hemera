/**
 * The commands run at each opening of Hemera: once per Project, in its main checkout, once the
 * window is shown and never before; a command that cannot start is logged and the next one runs;
 * and a command marked "ask before running" waits for the user's permission.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandDraft, Project } from '@hemera/ipc'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AskBeforeRunning, type PermissionAsk } from '../src/engine/ask-before-running.ts'
import { saveCommand } from '../src/engine/catalogue.ts'
import { listRuns, startRun } from '../src/engine/runs.ts'
import {
  FAILS_LOUDLY,
  WRITES_ITS_PID,
  alive,
  commandsEngine,
  nodeLine,
  script,
  until,
} from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, opened } from './workspace-engine.ts'

let data: string
let main: string
let pids: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('at-open'))
  main = atlasOnDisk(realpathSync.native(temporaryFolder('at-open-work')))
  pids = join(realpathSync.native(temporaryFolder('at-open-pids')), 'pids.txt')
  await opened(data)
})
afterEach(removeFolders)

const pidsWritten = (): number[] =>
  existsSync(pids) ? readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(Number) : []

const atOpen = (name: string, line: string, change: Partial<CommandDraft> = {}): CommandDraft => ({
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
  atOpen: true,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
  ...change,
})

/** A Project with the commands given saved in its catalogue. */
const withCommandsOn = (project: Project, ...commands: ReadonlyArray<CommandDraft>) =>
  Effect.gen(function* () {
    for (const command of commands) {
      yield* saveCommand({ projectId: project.id, id: null, command })
    }
    return project
  })

/** Atlas with the commands given saved in its catalogue. */
const withCommands = (...commands: ReadonlyArray<CommandDraft>) =>
  Effect.flatMap(atlas(main), (project) => withCommandsOn(project, ...commands))

const mainRuns = (project: Project) => listRuns(project.id, null)

describe('Commands marked "at open" run once the window is shown', () => {
  test('never before; once in the main checkout; and an unmarked command is left alone', async () => {
    const outcome = await commandsEngine(data)(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(
          withCommands(
            atOpen('db', nodeLine(script(WRITES_ITS_PID), pids)),
            atOpen('lint', nodeLine(script(WRITES_ITS_PID), pids), { atOpen: false }),
          ),
        )
        yield* Effect.sleep('300 millis')
        const before = yield* profile.use(mainRuns(project))
        // The window answers at once, even though the command stays up.
        yield* profile.windowShown
        yield* profile.windowShown
        yield* until(Effect.sync(pidsWritten), (written) => written.length === 1)
        yield* Effect.sleep('300 millis')
        return { before, after: yield* profile.use(mainRuns(project)) }
      }),
    )
    expect(outcome.before).toEqual([])
    expect(outcome.after.map((run) => [run.name, run.startedBy, run.folder])).toEqual([
      ['db', 'hemera', main],
    ])
    expect(pidsWritten()).toHaveLength(1)
  })

  test('a run of it still going is stopped first and started again', async () => {
    const runs = await commandsEngine(data)(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(atlas(main))
        const db = yield* profile.use(
          saveCommand({
            projectId: project.id,
            id: null,
            command: atOpen('db', nodeLine(script(WRITES_ITS_PID), pids)),
          }),
        )
        yield* profile.use(
          startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: db.id,
            line: null,
            folder: null,
            startedBy: 'user',
            sessionId: null,
          }),
        )
        yield* until(Effect.sync(pidsWritten), (written) => written.length === 1)
        yield* profile.windowShown
        return yield* profile.use(
          until(mainRuns(project), (seen) => seen.length === 2 && seen[0]?.state === 'running'),
        )
      }),
    )
    expect(runs.map((run) => [run.startedBy, run.state])).toEqual([
      ['hemera', 'running'],
      ['user', 'stopped'],
    ])
    const [first, second] = pidsWritten()
    expect(alive(first ?? 0)).toBe(false)
    expect(second).not.toBe(first)
  })

  test('one that cannot start is logged with its Project, and the next one runs', async () => {
    const outcome = await commandsEngine(data)(({ profile, lines }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(
          withCommands(
            atOpen('missing', '"no-such-program-for-hemera" --serve'),
            atOpen('fails', nodeLine(script(FAILS_LOUDLY))),
            atOpen('db', nodeLine(script(WRITES_ITS_PID), pids)),
          ),
        )
        yield* profile.windowShown
        const runs = yield* profile.use(
          until(mainRuns(project), (seen) =>
            seen.some((run) => run.name === 'db' && run.state === 'running'),
          ),
        )
        yield* until(
          Effect.sync(() => lines),
          (said) => said.some((line) => line.includes('at open')),
        )
        return { runs, lines }
      }),
    )
    const states = Object.fromEntries(outcome.runs.map((run) => [run.name, run.state]))
    expect(states).toMatchObject({ missing: 'failed', db: 'running' })
    expect(outcome.lines.some((line) => line.includes('Atlas: missing was not run at open'))).toBe(
      true,
    )
  })
})

describe('An "at open" command marked "ask before running"', () => {
  const asking = (project: Project) =>
    withCommandsOn(
      project,
      atOpen('seed', nodeLine(script(WRITES_ITS_PID), pids), { askBeforeRunning: true }),
    )

  test('waits for permission and never runs while no one can be asked', async () => {
    const outcome = await commandsEngine(data)(({ profile, lines }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(Effect.flatMap(atlas(main), asking))
        yield* profile.windowShown
        yield* profile.use(until(mainRuns(project), (seen) => seen.length === 1))
        yield* Effect.sleep('500 millis')
        return { runs: yield* profile.use(mainRuns(project)), lines }
      }),
    )
    expect(outcome.runs.map((run) => run.state)).toEqual(['waiting_for_permission'])
    expect(pidsWritten()).toEqual([])
    expect(
      outcome.lines.some(
        (line) => line.includes('seed of Project') && line.includes('does not run'),
      ),
    ).toBe(true)
  })

  test('runs once when the port allows it once, asked at Project level', async () => {
    const asked: PermissionAsk[] = []
    const allowsOnce = Layer.succeed(AskBeforeRunning, {
      decide: (question) =>
        Effect.sync(() => {
          asked.push(question)
          return asked.length === 1 ? 'allowed' : 'denied'
        }),
    })
    const outcome = await commandsEngine(data, { askBeforeRunning: allowsOnce })(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(Effect.flatMap(atlas(main), asking))
        yield* profile.windowShown
        const runs = yield* profile.use(
          until(mainRuns(project), (seen) => seen[0]?.state === 'running'),
        )
        yield* until(Effect.sync(pidsWritten), (written) => written.length === 1)
        return runs
      }),
    )
    expect(outcome.map((run) => run.state)).toEqual(['running'])
    expect(pidsWritten()).toHaveLength(1)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ name: 'seed', level: 'project', startedBy: 'hemera' })
  })
})
