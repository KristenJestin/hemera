/**
 * The engine the commands suites run on (D6-12, D8-07 to D8-10): the Projects, the Sessions, the
 * Journal and the commands over a database in a temporary folder, on the real supervisor.
 *
 * Nothing is mocked: a run is a real child of the machine running the suites, and the entry it
 * writes is a row of the same thread the window draws. What a suite may change is handed as a
 * layer — the platform, the readiness settings, where a program is looked for — never patched.
 *
 * The children are `node` itself, reached through `process.execPath` rather than through the
 * `PATH`: a line is run and not interpreted, so what a suite writes is split into words as a
 * user's line would be, a quoted word — the path, the code to evaluate — staying one word.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vite-plus/test'
import { Effect, Layer } from 'effect'
import type { Scope } from 'effect'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { NoNotices } from '#engine/agents/notices.ts'
import { type Commands, type RunRequest, commandsLayer } from '#engine/commands/service.ts'
import { Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** The version the shipped migrations are opened with, as the engine opens them. */
const VERSION = '0.4.0'

/** How long a run is waited for before a suite gives up on it: 5 seconds, 50 ms at a time. */
const TRIES = 100

/** The folder of the running test, and the `main` Workspace of its Project inside it. */
export const scratch = { folder: '', root: '' }

beforeEach(() => {
  scratch.folder = join(tmpdir(), `hemera-commands-${String(Date.now())}-${String(Math.random())}`)
  scratch.root = join(scratch.folder, 'workspace')
  mkdirSync(scratch.root, { recursive: true })
})

afterEach(() => {
  rmSync(scratch.folder, { recursive: true, force: true })
})

/** Everything a program of these suites may ask for: the engine, and nothing of the window. */
type Engine = Projects | Sessions | Commands | Journal | Database | SqliteClient

/** The engine's diagnostic lines, as the suite's sink received them. */
export const diagnostics: string[] = []

/**
 * One run of this engine, over one database in the test's folder, with `given` handed to the
 * commands in place of what they would read from the machine.
 */
export function engine(given: Layer.Layer<never> = Layer.empty) {
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
    Layer.provide(given),
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(scratch.folder, 'hemera.sqlite'))),
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
            yield* openProfile(scratch.folder, SHIPPED, VERSION)
            return yield* program
          }),
        ),
        services,
      ),
    )
}

/** A Session of the suite's Project, and the Project it belongs to. */
export interface Opened {
  readonly projectId: string
  readonly sessionId: string
}

/** A Project on the test's `main` and one Session of it, as the window would make them. */
export const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: scratch.root })
  const session = yield* sessions.create(project.id, 'claude')
  return { projectId: project.id, sessionId: session.id } satisfies Opened
})

/**
 * What a suite asks the commands for: a one-off of the Session, in `main`, at its root, started
 * by the user — `run` saying what differs.
 */
export const request = (
  session: Opened,
  run: Partial<RunRequest> & Pick<RunRequest, 'name' | 'line' | 'type'>,
): RunRequest => ({
  sessionId: session.sessionId,
  projectId: session.projectId,
  commandId: null,
  lineWindows: null,
  lineLinux: null,
  scope: 'workspace',
  portless: false,
  portlessName: null,
  folder: null,
  cwd: scratch.root,
  workspaceId: null,
  workspaceName: 'main',
  environment: {},
  startedBy: 'user',
  ...run,
})

/** The entries of a Session's thread, oldest first. */
export const threadEntries = (sessionId: string) =>
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
export const until = <A, E, R>(read: Effect.Effect<A, E, R>, ready: (seen: A) => boolean) =>
  Effect.gen(function* () {
    let seen = yield* read
    for (let tries = 0; tries < TRIES && !ready(seen); tries += 1) {
      yield* Effect.sleep('50 millis')
      seen = yield* read
    }
    return seen
  })

/** The `command_run` entries of a thread: one per run, whatever state the run reached. */
export const runEntries = (sessionId: string) =>
  threadEntries(sessionId).pipe(
    Effect.map((entries) => entries.filter((entry) => entry.kind === 'command_run')),
  )

/** The Journal lines of a Project's runs (D8-16), newest first. */
export const runLines = (projectId: string) =>
  Effect.gen(function* () {
    const journal = yield* Journal
    const read = yield* journal.read({ projectId })
    return read.entries.filter((entry) => entry.type.startsWith('command.run_'))
  })

/** A line that says something on its standard error and ends badly, as a failing tool does. */
export const FAILS_LOUDLY = `"${process.execPath}" -e "process.stderr.write('boom\\n');process.exit(3)"`

/** A line that publishes an address and stays up, as a dev server does. */
export const PUBLISHES_AN_ADDRESS = `"${process.execPath}" -e "console.log('http://localhost:4321');setInterval(()=>{},1000)"`
