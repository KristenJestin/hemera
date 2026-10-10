/**
 * The runs: a catalogue command or a free line started in a place, its output and exit kept, a
 * service's address read and asked until it answers, a stop that ends the whole tree, and what a
 * stopped engine left running ended at the next start.
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MASK, maskText } from '@hemera/core/domain'
import { NewBranch, type CommandDraft, type Project, type Run, ShellSyntax } from '@hemera/ipc'
import { Effect, Fiber, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { saveCommand } from '../src/engine/catalogue.ts'
import { prepareWorkspace } from '../src/engine/preparation.ts'
import { getProject } from '../src/engine/projects.ts'
import { saveRecipe } from '../src/engine/recipe.ts'
import {
  listRuns,
  restartRun,
  runChanges,
  runOutput,
  startRun,
  stopRun,
  type RunAsked,
} from '../src/engine/runs.ts'
import { commandRuns, supervisedProcesses } from '../src/engine/storage/schema.ts'
import { Database } from '../src/engine/storage/database.ts'
import { setVariable } from '../src/engine/variables.ts'
import { createWorkspace } from '../src/engine/workspaces.ts'
import {
  FAILS_LOUDLY,
  SERVES,
  STAYS_UP,
  TREE_OF_THREE,
  WRITES_ITS_PID,
  alive,
  commandsEngine,
  nodeLine,
  script,
  until,
} from './commands-engine.ts'
import { endChild, on, removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDiskConcurrently, opened } from './workspace-engine.ts'

let data: string
let main: string
let pids: string
const strays: ChildProcess[] = []

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('runs'))
  pids = join(realpathSync.native(temporaryFolder('runs-pids')), 'pids.txt')
  // The checkout and the migrated data folder do not wait for each other.
  const checkout = atlasOnDiskConcurrently(realpathSync.native(temporaryFolder('runs-work')))
  await Promise.all([checkout, opened(data)])
  main = await checkout
})

afterEach(async () => {
  await Promise.all(strays.splice(0).map(endChild))
  removeFolders()
})

/** The pids written into the suite's file so far. */
const pidsWritten = (): number[] =>
  existsSync(pids) ? readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(Number) : []

const service = (line: string): CommandDraft => ({
  name: 'web',
  type: 'serve',
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

/** A free line of the user in Atlas's main checkout. */
const freeLine = (project: Project, line: string): RunAsked => ({
  projectId: project.id,
  workspaceId: null,
  commandId: null,
  line,
  folder: null,
  startedBy: 'user',
  sessionId: null,
})

const ended = (run: Run) =>
  !['waiting_for_permission', 'starting', 'running', 'ready'].includes(run.state)

const listedRun = (project: Project, id: string) =>
  listRuns(project.id, null).pipe(Effect.map((runs) => runs.find((one) => one.id === id)))

describe('A run keeps what it printed and how it ended', () => {
  test('a line that fails keeps both outputs and its exit code, in the main checkout', async () => {
    const outcome = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const started = yield* startRun(freeLine(project, nodeLine(script(FAILS_LOUDLY))))
          const run = yield* until(
            listedRun(project, started.id),
            (seen) => seen !== undefined && ended(seen),
          )
          return { run, output: yield* runOutput(started.id) }
        }),
      ),
    )
    expect(outcome.run).toMatchObject({
      state: 'failed',
      exitCode: 3,
      startedBy: 'user',
      folder: main,
    })
    expect(outcome.output.output).toContain('checking\n')
    expect(outcome.output.output).toContain('boom\n')
  })
})

describe('Shell syntax is refused when run, naming its token', () => {
  test.each([
    ['&&', 'node a.js && node b.js'],
    ['|', 'node a.js | more'],
    ['>', 'node a.js > out.txt'],
    ['$HOME', 'node a.js $HOME'],
    ['*', 'node src/*.js'],
  ])('%s', async (token, line) => {
    const refusal = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.flip(Effect.flatMap(atlas(main), (project) => startRun(freeLine(project, line)))),
      ),
    )
    expect(refusal).toBeInstanceOf(ShellSyntax)
    expect(refusal).toMatchObject({ token })
  })

  test('the same token in single quotes runs, and a glob in double quotes reaches the program whole', async () => {
    const echo = script('console.log(JSON.stringify(process.argv.slice(2)))\n')
    const output = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const started = yield* startRun(
            freeLine(project, `${nodeLine(echo)} 'a && b' "src/*.ts"`),
          )
          yield* until(listedRun(project, started.id), (seen) => seen !== undefined && ended(seen))
          return yield* runOutput(started.id)
        }),
      ),
    )
    expect(output.output).toContain('["a && b","src/*.ts"]')
  })
})

describe('A .cmd shim runs through cmd.exe on Windows', () => {
  test.runIf(process.platform === 'win32')(
    'with its arguments as they were written, cmd.exe syntax included',
    async () => {
      const echo = script("console.log(process.argv.slice(2).join('|'))\n")
      // A shim as npm writes one: a batch file that hands its arguments on to a program.
      writeFileSync(join(main, 'echo-args.cmd'), `@"${process.execPath}" "${echo}" %*\r\n`)
      const output = await commandsEngine(data)(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const project = yield* atlas(main)
            const started = yield* startRun(
              freeLine(project, `.\\echo-args.cmd "two words" 'a&b' plain`),
            )
            yield* until(
              listedRun(project, started.id),
              (seen) => seen !== undefined && ended(seen),
            )
            return yield* runOutput(started.id)
          }),
        ),
      )
      expect(output.output).toContain('two words|a&b|plain')
    },
  )
})

describe('Stop ends the whole tree', () => {
  test('a child, its grandchild and its great-grandchild are gone after a stop, and the run is stopped', async () => {
    const tree = script(TREE_OF_THREE)
    const stopped = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const started = yield* startRun(freeLine(project, nodeLine(tree, pids, '3')))
          yield* until(Effect.sync(pidsWritten), (written) => written.length === 3)
          return yield* stopRun(started.id)
        }),
      ),
    )
    expect(stopped.state).toBe('stopped')
    const tree3 = pidsWritten()
    expect(tree3).toHaveLength(3)
    const gone = await Effect.runPromise(
      until(
        Effect.sync(() => tree3.filter(alive)),
        (left) => left.length === 0,
      ),
    )
    expect(gone).toEqual([])
  })
})

describe('A service', () => {
  test('its URL is read through colour codes and it is ready once the URL answers', async () => {
    const run = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const web = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: service(nodeLine(script(SERVES), pids)),
          })
          const started = yield* startRun({
            ...freeLine(project, ''),
            line: null,
            commandId: web.id,
          })
          return yield* until(listedRun(project, started.id), (seen) => seen?.state === 'ready')
        }),
      ),
    )
    expect(run?.state).toBe('ready')
    expect(run?.url).toMatch(/^http:\/\/localhost:\d+$/)
  })

  test('a second start in the same scope joins it; a restart gives a new process', async () => {
    const outcome = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const web = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: service(nodeLine(script(SERVES), pids)),
          })
          const asked = { ...freeLine(project, ''), line: null, commandId: web.id }
          const first = yield* startRun(asked)
          yield* until(listedRun(project, first.id), (seen) => seen?.state === 'ready')
          const second = yield* startRun(asked)
          const restarted = yield* restartRun(first.id)
          yield* until(listedRun(project, restarted.id), (seen) => seen?.state === 'ready')
          const old = yield* listedRun(project, first.id)
          return { first, second, restarted, old }
        }),
      ),
    )
    expect(outcome.second.id).toBe(outcome.first.id)
    expect(outcome.restarted.id).not.toBe(outcome.first.id)
    expect(outcome.old?.state).toBe('stopped')
    const [before, after] = pidsWritten()
    expect(pidsWritten()).toHaveLength(2)
    expect(after).not.toBe(before)
    expect(alive(before ?? 0)).toBe(false)
  })

  test('a port another run of the Project holds is reported as a conflict, naming it', async () => {
    const conflict = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const web = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: service(nodeLine(script(SERVES), pids)),
          })
          const first = yield* startRun({ ...freeLine(project, ''), line: null, commandId: web.id })
          const ready = yield* until(
            listedRun(project, first.id),
            (seen) => seen?.state === 'ready',
          )
          const claims = script(`console.log('ready on ' + process.argv[2])\n${STAYS_UP}`)
          const other = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: { ...service(nodeLine(claims, ready?.url ?? '')), name: 'admin' },
          })
          const second = yield* startRun({
            ...freeLine(project, ''),
            line: null,
            commandId: other.id,
          })
          const seen = yield* until(listedRun(project, second.id), (run) => run?.url !== null)
          return { seen, first }
        }),
      ),
    )
    expect(conflict.seen?.portConflict).toMatchObject({ runId: conflict.first.id, name: 'web' })
  })
})

describe('A pnpm service, through its shim on Windows', () => {
  /**
   * A dev server that forks workers, started by `pnpm dev` as a user writes it: on Windows `pnpm`
   * is a `.cmd` shim that only `cmd.exe` runs, so this is the line through `cmd.exe /d /s /c`.
   */
  const FORKS_WORKERS = `
import cluster from 'node:cluster'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
appendFileSync(process.env.PIDS, String(process.pid) + '\\n')
if (cluster.isPrimary) {
  let up = 0
  for (let i = 0; i < 2; i += 1) {
    cluster.fork().on('listening', (address) => {
      up += 1
      if (up === 2) console.log('Local: http://localhost:' + address.port + '/')
    })
  }
} else {
  createServer((_, response) => response.end('ok')).listen(Number(process.env.PORT_ASKED ?? 0))
}
`

  test('is started, its URL read, and stopped with its whole tree, workers included', async () => {
    writeFileSync(join(main, 'server.mjs'), FORKS_WORKERS)
    writeFileSync(
      join(main, 'package.json'),
      JSON.stringify({
        name: 'atlas',
        private: true,
        packageManager: JSON.parse(
          readFileSync(join(import.meta.dirname, '..', '..', '..', 'package.json'), 'utf8'),
        ).packageManager,
        scripts: { dev: 'node server.mjs' },
      }),
    )
    const outcome = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          yield* setVariable({ projectId: project.id, workspaceId: null, key: 'PIDS', value: pids })
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'PORT_ASKED',
            value: '0',
          })
          const web = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: service('pnpm dev'),
          })
          const started = yield* startRun({
            ...freeLine(project, ''),
            line: null,
            commandId: web.id,
          })
          const ready = yield* until(
            listedRun(project, started.id),
            (seen) => seen?.url != null || (seen !== undefined && ended(seen)),
            25_000,
          )
          const written = yield* until(Effect.sync(pidsWritten), (seen) => seen.length === 3)
          const stopped = yield* stopRun(started.id)
          return { ready, written, stopped, output: yield* runOutput(started.id) }
        }),
      ),
    )
    // What it printed first: a shim that did not run says why there.
    expect(outcome.output.output).toContain('Local: http://localhost:')
    expect(outcome.ready?.url).toMatch(/^http:\/\/localhost:\d+$/)
    expect(outcome.written).toHaveLength(3)
    expect(outcome.stopped.state).toBe('stopped')
    const left = await Effect.runPromise(
      until(
        Effect.sync(() => outcome.written.filter(alive)),
        (still) => still.length === 0,
      ),
    )
    expect(left).toEqual([])
  })
})

describe('A service run through Portless', () => {
  test('is refused naming portless when it is not on the PATH, and starts nothing', async () => {
    const outcome = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* atlas(main)
          const empty = temporaryFolder('no-portless')
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'PATH',
            value: empty,
          })
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'Path',
            value: empty,
          })
          const web = yield* saveCommand({
            projectId: project.id,
            id: null,
            command: { ...service(nodeLine(script(WRITES_ITS_PID), pids)), portless: true },
          })
          const started = yield* startRun({
            ...freeLine(project, ''),
            line: null,
            commandId: web.id,
          })
          const run = yield* until(
            listedRun(project, started.id),
            (seen) => seen !== undefined && ended(seen),
          )
          return { run, output: yield* runOutput(started.id) }
        }),
      ),
    )
    expect(outcome.run?.state).toBe('failed')
    expect(outcome.output.output).toContain('portless was not found on the PATH')
    expect(pidsWritten()).toEqual([])
  })
})

describe('The runs of a place, and their changes', () => {
  test('a run is listed with its place and told as it changes', async () => {
    const outcome = await commandsEngine(data)(({ profile }) =>
      Effect.gen(function* () {
        const project = yield* profile.use(atlas(main))
        const told = yield* profile.follow(runChanges).pipe(
          Stream.filter((run) => run.state === 'done'),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        yield* Effect.sleep('50 millis')
        const started = yield* profile.use(
          startRun(freeLine(project, nodeLine(script('console.log("hi")\n')))),
        )
        const [done] = yield* Fiber.join(told)
        const listed = yield* profile.use(listRuns(project.id, null))
        return { started, done, listed }
      }),
    )
    expect(outcome.done?.id).toBe(outcome.started.id)
    expect(outcome.listed.map((run) => [run.id, run.workspaceId, run.state])).toEqual([
      [outcome.started.id, null, 'done'],
    ])
  })
})

describe('What a stopped engine left running', () => {
  test("a run still alive is ended at start and marked interrupted; a pid now another program's is not touched", async () => {
    const stays = script(STAYS_UP)
    const ours = spawn(process.execPath, [stays], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
    })
    const theirs = spawn(process.execPath, [script(STAYS_UP)], { stdio: 'ignore' })
    strays.push(ours, theirs)
    const project = await commandsEngine(data)(({ profile }) => profile.use(atlas(main)))
    await on(
      data,
      Effect.gen(function* () {
        const database = yield* Database
        const row = (id: string) => ({
          id,
          projectId: project.id,
          workspaceId: null,
          commandId: null,
          name: 'node',
          type: 'script',
          line: 'node stays.mjs',
          folder: main,
          startedBy: 'user',
          state: 'running',
          output: maskText('', []),
          dropped: 0,
          startedAt: new Date().toISOString(),
        })
        yield* database.insert(commandRuns).values([row('left-1'), row('left-2')])
        const registered = (id: string, pid: number, owner: string) => ({
          id,
          pid,
          program: process.execPath,
          args: JSON.stringify([stays]),
          ownerKind: 'run',
          ownerId: owner,
          engine: 'a-previous-engine',
          startedAt: new Date().toISOString(),
        })
        yield* database
          .insert(supervisedProcesses)
          .values([
            registered('p1', ours.pid ?? 0, 'left-1'),
            registered('p2', theirs.pid ?? 0, 'left-2'),
          ])
      }).pipe(Effect.orDie),
    )

    const runs = await commandsEngine(data)(({ profile }) =>
      profile.use(listRuns(project.id, null)),
    )
    expect(runs.map((run) => run.state)).toEqual(['interrupted', 'interrupted'])
    const left = await Effect.runPromise(
      until(
        Effect.sync(() => alive(ours.pid ?? 0)),
        (still) => !still,
      ),
    )
    expect(left).toBe(false)
    expect(alive(theirs.pid ?? 0)).toBe(true)
  })
})

describe('The RecipeRunner runs the recipe’s run steps', () => {
  test("a step's line runs in its folder with the variables, and its outcome is the step's state", async () => {
    const prints = script(
      'console.log("ACME_REGION=" + process.env.ACME_REGION + " in " + process.cwd())\nprocess.exit(Number(process.argv[2]))\n',
    )
    const workspace = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const created = yield* atlas(main)
          const api = created.repositories.find((one) => one.path === 'api')?.id ?? null
          yield* saveRecipe({
            projectId: created.id,
            version: created.version,
            steps: [
              {
                kind: 'run',
                repositoryId: api,
                path: null,
                commandId: null,
                line: nodeLine(prints, '0'),
              },
              {
                kind: 'run',
                repositoryId: null,
                path: null,
                commandId: null,
                line: nodeLine(prints, '4'),
              },
            ],
          })
          const project = yield* getProject(created.id)
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'ACME_REGION',
            value: 'quartz-violet-3100',
          })
          const made = yield* createWorkspace({
            projectId: project.id,
            name: 'login-form',
            repositories: project.repositories.map((one) => one.id),
            mode: NewBranch.make({}),
          })
          const prepared = yield* prepareWorkspace(made.id)
          const runs = yield* listRuns(project.id, made.id)
          return { prepared, runs }
        }),
      ),
    )
    const steps = workspace.prepared.steps.filter((step) => step.kind === 'run')
    expect(steps.map((step) => step.state)).toEqual(['done', 'failed'])
    // A variable's value is a known secret, masked wherever it shows, a port included.
    expect(steps[1]?.failure?.output).toContain(`ACME_REGION=${MASK}`)
    expect(steps[1]?.failure?.output).not.toContain('quartz-violet-3100')
    expect(workspace.runs.map((run) => [run.startedBy, run.state, run.exitCode])).toEqual([
      ['hemera', 'failed', 4],
      ['hemera', 'done', 0],
    ])
    expect(workspace.runs[1]?.folder).toBe(join(workspace.prepared.folder, 'api'))
  })
})
