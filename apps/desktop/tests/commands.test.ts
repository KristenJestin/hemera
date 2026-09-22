/**
 * The commands of a Project, as the panel and the thread read them (D6-11, D6-12).
 *
 * Each suite is named after the scenario of the issue's Spec section that it covers, and nothing
 * here is mocked: the engine is the real one — the Projects, the Sessions and the commands over a
 * database in a temporary folder — and the commands are real children of the machine running the
 * tests, started through the real supervisor. A run that says it failed has to have failed.
 *
 * The children are `node` itself, reached through `process.execPath` rather than through the
 * `PATH`: a line is run and not interpreted, so what the suite writes is one token of code with
 * no space in it, exactly as a user's line would be split.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { Commands, commandsLayer } from '#engine/commands/service.ts'
import { Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'

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
  const sink = Layer.succeed(StderrSink, { write: () => Effect.void })
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
  )
  return <A, E>(program: Effect.Effect<A, E, Engine | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(folder, SHIPPED, VERSION)
            return yield* program
          }),
          services,
        ),
      ),
    )
}

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
const FAILS_LOUDLY = `${process.execPath} -e process.stderr.write('boom\\n');process.exit(3)`

/** A line that publishes an address and stays up, as a dev server does. */
const PUBLISHES_AN_ADDRESS = `${process.execPath} -e console.log('http://localhost:4321');setInterval(()=>{},1000)`

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
          kind: 'check',
          cwd: root,
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
      kind: 'check',
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
            kind: 'app',
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
          kind: saved.kind,
          cwd: root,
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
      kind: 'app',
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
            kind: 'check',
            cwd: root,
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
