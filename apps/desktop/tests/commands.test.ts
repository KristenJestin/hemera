/**
 * The commands of a Project, as the panel and the thread read them (D6-11, D6-12).
 *
 * Each suite is named after the scenario of the issue's Spec section that it covers, and nothing
 * here is mocked: the engine is the real one — the Projects, the Sessions and the commands over a
 * database in a temporary folder — and the commands are real children of the machine running the
 * tests, started through the real supervisor. A run that says it failed has to have failed.
 *
 * The children are `node` itself, reached through `process.execPath` rather than through the
 * `PATH`: a line is run and not interpreted, so what the suite writes is split into words as a
 * user's line would be, a quoted word — the path, the code to evaluate — staying one word.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Layer, Result } from 'effect'
import type { Scope } from 'effect'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { NoNotices } from '#engine/agents/notices.ts'
import { Commands, commandsLayer } from '#engine/commands/service.ts'
import { Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import { SqliteClient } from '#engine/storage/database.ts'
import type { Database } from '#engine/storage/database.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** The version the shipped migrations are opened with, as the engine opens them. */
const VERSION = '0.4.0'

/** How long a run is waited for before the suite gives up on it: 5 seconds, 50 ms at a time. */
const TRIES = 100

let folder: string
let root: string

beforeEach(() => {
  folder = join(tmpdir(), `hemera-commands-${String(Date.now())}-${String(Math.random())}`)
  root = join(folder, 'workspace')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** Everything a program of these suites may ask for: the engine, and nothing of the window. */
type Engine = Projects | Sessions | Commands | Journal | Database | SqliteClient

/**
 * One run of this engine, over one database in the suite's folder.
 *
 * The commands stand on the real supervisor and on the real Sessions: a run is a process of this
 * machine, and the entry it writes is a row of the same thread the window draws.
 */
function engine() {
  diagnostics.length = 0
  const sink = Layer.succeed(StderrSink, {
    write: (line: string) =>
      Effect.sync(() => {
        diagnostics.push(line)
      }),
  })
  const processes = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink)),
  )
  const services: Layer.Layer<Engine> = commandsLayer.pipe(
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(folder, 'hemera.sqlite'))),
      ),
    ),
    Layer.provide(processes),
    Layer.provide(sink),
    Layer.provide(heldWordsLayer),
    // Nobody is watching: these suites read the thread and the runs, not what was pushed.
    Layer.provide(NoNotices),
  )
  return <A, E>(program: Effect.Effect<A, E, Engine | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      // The program's scope closes before the services': the runs it holds end first.
      Effect.provide(
        Effect.scoped(
          Effect.gen(function* () {
            yield* openProfile(folder, SHIPPED, VERSION)
            return yield* program
          }),
        ),
        services,
      ),
    )
}

/** The engine's diagnostic lines, as the suite's sink received them. */
const diagnostics: string[] = []

/** A Project on the suite's Workspace and one Session of it, as the window would make them. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: root })
  const session = yield* sessions.create(project.id, 'claude')
  return { projectId: project.id, sessionId: session.id }
})

/** The entries of a Session's thread, oldest first. */
const threadEntries = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const page = yield* sessions.read(sessionId)
    return page.entries
  })

/**
 * Reads until what is being waited for is true, and answers the last thing it read.
 *
 * A real child ends when the kernel says so, and what it printed arrives after that: a suite that
 * read once would read a run that has not finished being a run. Bounded, so a process that never
 * ends fails a test rather than hanging it.
 */
const until = <A, E, R>(read: Effect.Effect<A, E, R>, ready: (seen: A) => boolean) =>
  Effect.gen(function* () {
    let seen = yield* read
    for (let tries = 0; tries < TRIES && !ready(seen); tries += 1) {
      yield* Effect.sleep('50 millis')
      seen = yield* read
    }
    return seen
  })

/** The `command_run` entries of a thread: one per run, whatever state the run reached. */
const runEntries = (sessionId: string) =>
  threadEntries(sessionId).pipe(
    Effect.map((entries) => entries.filter((entry) => entry.kind === 'command_run')),
  )

/** A line that says something on its standard error and ends badly, as a failing tool does. */
const FAILS_LOUDLY = `"${process.execPath}" -e "process.stderr.write('boom\\n');process.exit(3)"`

/** A line that publishes an address and stays up, as a dev server does. */
const PUBLISHES_AN_ADDRESS = `"${process.execPath}" -e "console.log('http://localhost:4321');setInterval(()=>{},1000)"`

describe('A one-off command shows and is not promoted', () => {
  it('keeps what it said on standard error, its exit code, and one entry of the thread', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          // A one-off: a line the agent wrote, which the catalogue never hears about.
          commandId: null,
          name: 'boom',
          line: FAILS_LOUDLY,
          type: 'test',
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'agent',
        })
        const settled = yield* until(
          Effect.gen(function* () {
            return {
              run: yield* commands.output(session.sessionId, started.id),
              entries: yield* runEntries(session.sessionId),
            }
          }),
          // The run has ended, what it printed has arrived, and the thread has been told: the
          // three are one moment, and reading them apart would read a run mid-death.
          (read) =>
            read.run.state !== 'running' &&
            read.run.output.includes('boom') &&
            read.entries.some((entry) => entry.state !== 'running'),
        )
        return {
          settled,
          catalogue: yield* commands.list(session.projectId),
        }
      }),
    )

    // What a failing tool says on standard error is what the agent came for: an exit code with
    // nothing under it would be a failure nobody can account for.
    expect(seen.settled.run.output).toContain('boom')
    // It is the run's output and nothing else: the engine's diagnostic log does not copy it.
    expect(diagnostics.some((line) => line.includes('boom'))).toBe(false)
    expect(seen.settled.run.exitCode).toBe(3)
    expect(seen.settled.run.state).toBe('failed')
    // A one-off is run, not remembered: the catalogue is the user's and nothing promotes into it.
    expect(seen.catalogue).toHaveLength(0)

    // One entry for the run, started and ended: the thread shows a block that changed state
    // rather than the same command twice.
    expect(seen.settled.entries).toHaveLength(1)
    const entry = seen.settled.entries[0]
    expect(entry?.kind).toBe('command_run')
    expect(entry?.role).toBe('hemera')
    expect(entry?.body).toBe('boom')
    expect(entry?.state).toBe('failed')
    // What the block on screen is drawn from: the run, as it ended, and the fact that a line
    // the agent wrote is not a command of the catalogue.
    expect(JSON.parse(entry?.payload ?? '{}')).toMatchObject({
      runId: seen.settled.run.id,
      name: 'boom',
      type: 'test',
      state: 'failed',
      cwd: root,
      url: null,
      exitCode: 3,
      startedBy: 'agent',
      oneOff: true,
    })
  })
})

describe('The agent starts the app and the user opens it', () => {
  it('reads the address from the output, and the thread entry carries it', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const saved = yield* commands.save(
          {
            projectId: session.projectId,
            name: 'dev',
            line: PUBLISHES_AN_ADDRESS,
            type: 'serve',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folder: null,
          },
          false,
        )
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          commandId: saved.id,
          name: saved.name,
          line: saved.line,
          type: saved.type,
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'agent',
        })
        // The address is the first one the output names, and it is named while the app runs.
        const published = yield* until(
          commands.output(session.sessionId, started.id),
          (view) => view.url !== null,
        )
        // The user closes it, which is what rewrites the entry with what the run had become.
        const ended = yield* commands.stop(session.sessionId, started.id)
        return { published, ended, entries: yield* runEntries(session.sessionId) }
      }),
    )

    expect(seen.published.url).toBe('http://localhost:4321')
    expect(seen.ended.state).toBe('stopped')

    expect(seen.entries).toHaveLength(1)
    const entry = seen.entries[0]
    expect(entry?.body).toBe('dev')
    expect(entry?.state).toBe('stopped')
    // The address the user opens is in the block, and the block says this run has a name in the
    // catalogue: a command of the Project can be run again by name, a one-off cannot.
    expect(JSON.parse(entry?.payload ?? '{}')).toMatchObject({
      name: 'dev',
      type: 'serve',
      state: 'stopped',
      url: 'http://localhost:4321',
      oneOff: false,
    })
  })
})

describe('A run is written in the Journal under whoever started it', () => {
  it('names the human for a run of the panel, and the tool for a run of the agent', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const run = (startedBy: 'agent' | 'user') =>
          commands.run({
            sessionId: session.sessionId,
            projectId: session.projectId,
            commandId: null,
            name: startedBy,
            line: `${process.execPath} -e 0`,
            type: 'test',
            cwd: root,
            workspaceId: null,
            environment: {},
            startedBy,
          })
        yield* run('user')
        yield* run('agent')
        const journal = yield* Journal
        const read = yield* journal.read({ projectId: session.projectId })
        return read.entries.filter((entry) => entry.type === 'command.started')
      }),
    )

    const byName = (name: string) =>
      seen.find((entry) => JSON.stringify(entry.payload).includes(`"name":"${name}"`))
    expect(byName('user')?.author).toBe('human')
    expect(byName('agent')?.author).toBe('mcp')
  })
})

describe('A stopped run ends once', () => {
  it('ends stopped, with one event for its end, however the platform reports the death', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          commandId: null,
          name: 'server',
          line: PUBLISHES_AN_ADDRESS,
          type: 'serve',
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'user',
        })
        const ended = yield* commands.stop(session.sessionId, started.id)
        // Anything the watcher would still write arrives now, not after the suite has read.
        yield* Effect.sleep('200 millis')
        const journal = yield* Journal
        const read = yield* journal.read({ projectId: session.projectId })
        return {
          ended,
          row: (yield* commands.recent(session.sessionId))[0],
          ends: read.entries.filter(
            (entry) => entry.type.startsWith('command.') && entry.type !== 'command.started',
          ),
        }
      }),
    )

    expect(seen.ended.state).toBe('stopped')
    expect(seen.row?.state).toBe('stopped')
    expect(seen.ends.map((entry) => entry.type)).toEqual(['command.stopped'])
  })
})

describe('A run whose end cannot be recorded', () => {
  it('still ends: a stop returns, and the diagnostic log says the row was not written', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          commandId: null,
          name: 'server',
          line: PUBLISHES_AN_ADDRESS,
          type: 'serve',
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'user',
        })
        // The database refuses every later write of a run, as a locked or full one would.
        const sql = yield* SqliteClient
        yield* sql.unsafe(
          "CREATE TRIGGER refuse_runs BEFORE UPDATE ON command_runs BEGIN SELECT RAISE(ABORT, 'disk full'); END",
        )
        const stopped = yield* commands
          .stop(session.sessionId, started.id)
          .pipe(Effect.timeout('10 seconds'), Effect.result)
        return { stopped, lines: [...diagnostics] }
      }),
    )

    expect(Result.isSuccess(seen.stopped)).toBe(true)
    expect(seen.lines.some((line) => line.includes('was not recorded'))).toBe(true)
  })
})

describe('A run that ended is left as it ended', () => {
  it('keeps its end and what it printed when its Session is swept afterwards', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          commandId: null,
          name: 'boom',
          line: FAILS_LOUDLY,
          type: 'test',
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'agent',
        })
        // Ended and written: the row says so, which is when the run is no longer held in memory.
        yield* until(commands.recent(session.sessionId), (rows) => rows[0]?.state === 'failed')
        yield* commands.stopped(session.sessionId)
        const journal = yield* Journal
        const read = yield* journal.read({ projectId: session.projectId })
        return {
          read: yield* commands.output(session.sessionId, started.id),
          stops: read.entries.filter((entry) => entry.type === 'command.stopped'),
        }
      }),
    )

    expect(seen.read.state).toBe('failed')
    expect(seen.read.exitCode).toBe(3)
    expect(seen.read.output).toContain('boom')
    expect(seen.stops).toHaveLength(0)
  })
})

describe('A running app is shared by the Sessions of its Project', () => {
  it('is joined, read and stopped from another Session, and from no other Project', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const first = yield* opened
        const sessions = yield* Sessions
        const projects = yield* Projects
        const second = yield* sessions.create(first.projectId, 'claude')
        const elsewhere = yield* projects.create({
          name: 'Other',
          tone: 'primary',
          mainPath: folder,
        })
        const stranger = yield* sessions.create(elsewhere.id, 'claude')
        const commands = yield* Commands
        const run = (sessionId: string) =>
          commands.run({
            sessionId,
            projectId: first.projectId,
            commandId: null,
            name: 'dev',
            line: PUBLISHES_AN_ADDRESS,
            type: 'serve',
            cwd: root,
            workspaceId: null,
            environment: {},
            startedBy: 'agent',
          })
        const started = yield* run(first.sessionId)
        const joined = yield* run(second.id)
        const read = yield* commands.output(second.id, started.id)
        const refused = yield* commands.output(stranger.id, started.id).pipe(Effect.flip)
        const stopped = yield* commands.stop(second.id, started.id)
        return { started, joined, read, refused, stopped }
      }),
    )

    expect(seen.joined.joined).toBe(true)
    expect(seen.joined.id).toBe(seen.started.id)
    expect(seen.read.id).toBe(seen.started.id)
    expect(seen.refused.message).toContain(seen.started.id)
    expect(seen.stopped.state).toBe('stopped')
  })
})

/** A program that prints the arguments it was given, one `|` between two of them. */
const PRINTS_ITS_ARGUMENTS = `-e "console.log(process.argv.slice(1).join('|'))"`

/** Starts one line as a `check` of the suite's Session and reads it once it has ended. */
const ranToTheEnd = (line: string) =>
  Effect.gen(function* () {
    const session = yield* opened
    const commands = yield* Commands
    const started = yield* commands.run({
      sessionId: session.sessionId,
      projectId: session.projectId,
      commandId: null,
      name: 'arguments',
      line,
      type: 'test',
      cwd: root,
      workspaceId: null,
      environment: {},
      startedBy: 'user',
    })
    return yield* until(
      commands.output(session.sessionId, started.id),
      (view) => view.state !== 'running',
    )
  })

describe('A line is split into words, a quoted one staying whole', () => {
  it('hands the program a quoted argument as one argument', async () => {
    const seen = await engine()(
      ranToTheEnd(`"${process.execPath}" ${PRINTS_ITS_ARGUMENTS} "two words" plain`),
    )

    expect(seen.state).toBe('exited')
    expect(seen.output).toContain('two words|plain')
  })

  it.runIf(process.platform === 'win32')(
    'runs a .cmd shim through cmd.exe, with its arguments as they were written',
    async () => {
      // A shim as npm writes one: a batch file that hands its arguments on to a program.
      writeFileSync(
        join(root, 'echo-args.cmd'),
        `@"${process.execPath}" ${PRINTS_ITS_ARGUMENTS} %*\r\n`,
      )
      const before = process.env['PATH']
      process.env['PATH'] = `${root};${before ?? ''}`
      try {
        const seen = await engine()(ranToTheEnd('echo-args "two words" "a&b" plain'))

        expect(seen.state).toBe('exited')
        expect(seen.output).toContain('two words|a&b|plain')
      } finally {
        process.env['PATH'] = before
      }
    },
  )
})

describe('A run keeps the first address it names', () => {
  it('does not move to an address printed later', async () => {
    const seen = await engine()(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const started = yield* commands.run({
          sessionId: session.sessionId,
          projectId: session.projectId,
          commandId: null,
          name: 'two',
          line: `"${process.execPath}" -e "console.log('http://127.0.0.1:4000');console.log('http://localhost:5000')"`,
          type: 'test',
          cwd: root,
          workspaceId: null,
          environment: {},
          startedBy: 'user',
        })
        return yield* until(
          commands.output(session.sessionId, started.id),
          (view) => view.state !== 'running',
        )
      }),
    )

    expect(seen.output).toContain('localhost:5000')
    expect(seen.url).toBe('http://127.0.0.1:4000')
  })
})
