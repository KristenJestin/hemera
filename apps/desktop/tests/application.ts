/**
 * One run of the application over one scripted agent, and what a suite reads it through.
 *
 * A run is the engine's own layers — the Projects, the Sessions and the runtime — over a real
 * database in a temporary folder, with the fake provider behind the supervisor's port and the
 * machine's discovery answered by a layer: no binary, no model, no account, and no child process.
 *
 * Called twice on the same folder, `application()` is a second run of the application: the layers
 * are built again, the database is opened again and the agent answering is a new one. The clock is
 * the suite's, so the grace an agent is given to answer a cancel is a duration a test decides.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Fiber, Layer } from 'effect'
import type { Scope } from 'effect'
import * as TestClock from 'effect/testing/TestClock'

import type { AgentProvider, SessionEntry } from '@hemera/core'
import { MachineEnvironment, discoveryLayer } from '#engine/agents/discovery.ts'
import {
  fakeSupervisor,
  fakeSupervisorService,
  type FakeAgent,
  type FakeStep,
} from '#engine/agents/fake.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { AgentNotices, CHUNK_FLUSH, NoNotices, runtimeLayer } from '#engine/agents/runtime.ts'
import type { AgentRuntime, Notice } from '#engine/agents/runtime.ts'
import {
  type HostProcesses,
  ProcessSupervisor,
  type ProcessSupervisorService,
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { agentDirectoriesLayer } from '#engine/agents/bare.ts'
import { type HeldWords, heldWordsLayer } from '#engine/agents/held.ts'
import { type Commands, commandsLayer } from '#engine/commands/service.ts'
import { type Context as AgentContext, contextLayer } from '#engine/context/service.ts'
import { type Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { preferencesLayer } from '#engine/preferences.ts'
import type { Preferences } from '#engine/preferences.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer, type ThreadWrite } from '#engine/sessions.ts'
import { NoSpecNotices, type SpecNotices } from '#engine/specs/notices.ts'
import { type Specs, specsLayer } from '#engine/specs/specs.ts'
import { DatabaseError, databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'
import { toolAccessLayer } from '#engine/tools/access.ts'
import type { ToolAccess } from '#engine/tools/access.ts'
import { toolCatalogueLayer } from '#engine/tools/catalogue.ts'
import { type ToolPermissions, toolPermissionsLayer } from '#engine/tools/permissions.ts'
import { ToolServer, toolServerLayer } from '#engine/tools/server.ts'
import { gitLayer } from '#engine/git.ts'
import { type Variables, variablesLayer } from '#engine/workspaces/variables.ts'

export const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** The version the shipped migrations are opened with, as the application opens them. */
export const VERSION = '0.4.0'

/**
 * A machine that has every agent, signed in, at a path nothing has to be installed at.
 *
 * Signed in because a Session runs an agent that is: an agent nobody signed in is refused before
 * a process is started (D5-21), and what these suites are about is the turn. The adapters answer
 * from a `node_modules` this machine pretends to have, which is where a real one would find them
 * — never the `PATH`.
 */
/**
 * The same machine, holding none of the agents' bare means: a start that cannot happen, as it
 * cannot on a machine where the agent was never installed (D6-02).
 */
export const bareMachine = Layer.succeed(MachineEnvironment, {
  home: '/home/ana',
  env: {},
  locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
  bundled: (packageName: string) =>
    Effect.succeed(join('/opt/hemera/node_modules', packageName, 'dist', 'index.js')),
  readVersion: () => Effect.succeed('1.0.0'),
  holds: () => Effect.succeed(false),
  read: () => Effect.succeed(undefined),
})

export const machine = Layer.succeed(MachineEnvironment, {
  home: '/home/ana',
  env: {},
  locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
  bundled: (packageName: string) =>
    Effect.succeed(join('/opt/hemera/node_modules', packageName, 'dist', 'index.js')),
  readVersion: () => Effect.succeed('1.0.0'),
  holds: () => Effect.succeed(true),
  read: () => Effect.succeed(undefined),
})

/** One push the engine made, as the window would have received it. */
export interface Pushed {
  readonly sessionId: string
  readonly entry: SessionEntry | null
  readonly what: Notice | null
}

/**
 * The window, as a suite reads it: everything the runtime pushed, in the order it pushed it.
 *
 * `NoNotices` is what a suite that only reads the thread needs; this is what a suite about the
 * page needs, because an entry the window is never told about is one it can only draw by asking
 * for the thread again, and a turn does not work that way (D5-12).
 */
export function watching() {
  const pushed: Pushed[] = []
  return {
    pushed,
    layer: Layer.succeed(AgentNotices, {
      wrote: (sessionId: string, entry: SessionEntry) => {
        pushed.push({ sessionId, entry, what: null })
      },
      changed: (sessionId: string, what: Notice) => {
        pushed.push({ sessionId, entry: null, what })
      },
      // A run is pushed as the run it is and not as an entry: the suites that watch the window
      // read the thread, and the Commands panel has suites of its own.
      ran: () => undefined,
      // A Workspace change is about a Project: the suites about Workspaces read it of their own.
      workspace: () => undefined,
    }),
  }
}

/**
 * The tools of an engine whose suite never calls one.
 *
 * The runtime is handed an address to configure its agent with and nothing listens on it: what
 * these suites are about is the turn, and a real socket per test is a port taken for nothing. The
 * tokens themselves are real — `toolAccessLayer` is the engine's own — because a Session that
 * lets go of its agent lets go of its token, and that is a thing a suite reads.
 */
const server = Layer.succeed(ToolServer, {
  origin: 'http://127.0.0.1:1',
  forAgent: () => 'http://127.0.0.1:1/mcp',
  gaveUp: () => Effect.void,
})

/**
 * A storage that fails when a suite says so, and the diagnostic the engine writes to.
 *
 * A write of the thread is a transaction on a file, and a file can refuse one — a full disk, a
 * database another process holds. What a suite arms here is the next write that matches, failed
 * once as the database would fail it; every other write goes through. What the runtime puts in the
 * diagnostic is kept in `diagnosed`, which is how a suite sees a failure that was not its caller's.
 */
export function failing() {
  const armed: ((entry: ThreadWrite) => boolean)[] = []
  const diagnosed: string[] = []
  return {
    diagnosed,
    /** The next write of the thread that matches fails, once. */
    nextWrite: (matches: (entry: ThreadWrite) => boolean) => {
      armed.push(matches)
    },
    sessions: Layer.effect(
      Sessions,
      Effect.gen(function* () {
        const real = yield* Sessions
        return {
          ...real,
          write: (id: string, entry: ThreadWrite) => {
            const at = armed.findIndex((matches) => matches(entry))
            if (at === -1) return real.write(id, entry)
            armed.splice(at, 1)
            return Effect.fail(
              new DatabaseError({ doing: 'writing the entry', cause: 'disk full' }),
            )
          },
        }
      }),
    ).pipe(Layer.provide(sessionsLayer)),
    sink: Layer.succeed(StderrSink, {
      write: (line: string) =>
        Effect.sync(() => {
          diagnosed.push(line)
        }),
    }),
  }
}

/** A run of the application over one scripted agent, on one data folder. */
export function application(
  dataFolder: string,
  notices: Layer.Layer<AgentNotices> = NoNotices,
  environment: Layer.Layer<MachineEnvironment> = machine,
  // The one fake, unless the suite is about an agent that was started twice: a fake that was
  // stopped is dead, so a suite about a restart hands over its own supervisor and says which
  // fake each start answers with.
  supervisor?: Layer.Layer<ProcessSupervisor>,
  // A storage that never fails, unless the suite is about one that does.
  storage: ReturnType<typeof failing> = failing(),
) {
  return (agent: FakeAgent) => {
    // The runtime is built on the very same services the suite reads with — `provideMerge` hands
    // them up rather than hiding them, so one database is opened and one thread is written.
    const services: Layer.Layer<
      | Projects
      | Sessions
      | Specs
      | Preferences
      | AgentRuntime
      | ToolAccess
      | Database
      | SqliteClient
      | TestClock.TestClock
      | HeldWords
      | AgentContext
    > = runtimeLayer.pipe(
      Layer.provideMerge(toolAccessLayer),
      Layer.provideMerge(contextLayer),
      Layer.provide(
        Layer.mergeAll(server, commandsLayer, toolPermissionsLayer, gitLayer(), variablesLayer),
      ),
      Layer.provideMerge(
        Layer.mergeAll(
          projectsLayer,
          storage.sessions,
          preferencesLayer,
          specsLayer.pipe(Layer.provide(NoSpecNotices)),
        ).pipe(Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite')))),
      ),
      Layer.provide(discoveryLayer.pipe(Layer.provide(environment))),
      Layer.provide(supervisor ?? fakeSupervisor(agent)),
      Layer.provide(notices),
      Layer.provide(storage.sink),
      // The pool reads the clock the suite moves, because it is the engine's own clock: five
      // idle minutes are a `TestClock.adjust` here rather than five minutes of waiting (D5-05).
      Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
      Layer.provideMerge(TestClock.layer()),
      Layer.provideMerge(heldWordsLayer),
      Layer.provide(agentDirectoriesLayer(dataFolder)),
    )
    return <A, E>(
      program: Effect.Effect<
        A,
        E,
        | Projects
        | Sessions
        | Specs
        | Preferences
        | AgentRuntime
        | ToolAccess
        | Database
        | SqliteClient
        | TestClock.TestClock
        | HeldWords
        | AgentContext
        | Scope.Scope
      >,
    ) =>
      Effect.runPromise(
        // The program's scope closes inside the services': what it holds — the agents, the fibers
        // draining them, their death watchers — ends before the database closes, never after.
        Effect.provide(
          Effect.scoped(
            Effect.gen(function* () {
              mkdirSync(dataFolder, { recursive: true })
              yield* openProfile(dataFolder, SHIPPED, VERSION)
              return yield* program
            }),
          ),
          services,
        ),
      )
  }
}

/** A Project on a real folder, and a Session in it whose agent is Claude. */
export const aSession = (workingDirectory: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const project = yield* projects.create({
      name: 'Atlas',
      tone: 'primary',
      mainPath: workingDirectory,
    })
    return yield* sessions.create(project.id, 'claude')
  })

/** The thread of a Session, oldest first, as the engine reads it. */
export const threadOf = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const page = yield* sessions.read(sessionId)
    return page.entries
  })

/** A pause in real time: what a suite waits on here is a stream, not the clock. */
export const pause = (milliseconds: number) =>
  Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))

/**
 * Waits until the thread holds what the suite is waiting for.
 *
 * Looking again rather than being told: the entries are written by the fiber that drains the
 * agent's events, and looking again is what a reader of the window does.
 *
 * The clock moves with the looking, because that is what happens in the application: what an
 * agent streamed is written by a timer of its own (Decided 10 of #17), and a suite whose clock
 * never moves would wait for a flush that cannot come. Real time passes between two looks as
 * well, so a write that is on its way has landed by the time the thread is read again.
 */
export const heldInThread = (
  sessionId: string,
  ready: (entries: readonly SessionEntry[]) => boolean,
) =>
  Effect.gen(function* () {
    for (let look = 0; look < 400; look++) {
      const entries = yield* threadOf(sessionId)
      if (ready(entries)) return entries
      yield* pause(5)
      yield* TestClock.adjust(CHUNK_FLUSH)
    }
    return yield* Effect.die('the thread never held what the suite waited for')
  })

/** How many requests are waiting for an answer right now. */
export const waiting = (entries: readonly SessionEntry[]) =>
  entries.filter((entry) => entry.kind === 'permission_request' && entry.state === 'pending').length

/** The one entry of a kind the thread holds, or a failure that says how many it held. */
export const entryOf = (entries: readonly SessionEntry[], kind: SessionEntry['kind']) => {
  const found = entries.filter((entry) => entry.kind === kind)
  const only = found[0]
  if (found.length !== 1 || only === undefined) {
    throw new Error(`the thread holds ${found.length} entries of kind ${kind}, not one`)
  }
  return only
}

/** The options of a permission request, as the block draws them. */
export const optionsOf = (entry: SessionEntry): readonly { id: string }[] => {
  // SAFETY: the payload of this kind of entry is what the runtime wrote for it, and what is read
  // here is the one field it wrote there — a payload of another shape would be a failure of the
  // suite that made it rather than of this reader.
  const payload = JSON.parse(entry.payload ?? '{}') as { options?: { id: string }[] }
  return payload.options ?? []
}

/** Three options, in the order an agent of its own mind would send them. */
export const ASKED: Extract<FakeStep, { does: 'asks' }>['call'] = {
  id: 'call-1',
  title: 'Write outside the workspace',
  options: [
    { id: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { id: 'allow-always', name: 'Always allow', kind: 'allow_always' },
    { id: 'reject-once', name: 'Reject', kind: 'reject_once' },
  ],
}

/** A promise a suite holds, so a turn can be caught in the middle of itself. */
export function held() {
  let carryOn: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    carryOn = resolve
  })
  return { promise, carryOn: () => carryOn() }
}

/**
 * A turn held open after the step it is told to hold after.
 *
 * The agent waits behind the gate before every step, so a suite that holds from the first one has
 * nothing in the thread to look at: the first step is let through, the next one is not.
 */
export function gated(after: number) {
  const gate = held()
  let seen = 0
  return {
    ...gate,
    between: () => {
      seen += 1
      return seen > after ? gate.promise : Promise.resolve()
    },
  }
}

/** Joins a fiber the way a suite does when it only wants the turn to be over. */
export const joined = <A, E>(fiber: Fiber.Fiber<A, E>) => Fiber.join(fiber)

/** Everything a suite of the tools reads, beside what `application` hands it. */
export type ToolEngine =
  | Projects
  | Sessions
  | Specs
  | Preferences
  | AgentRuntime
  | ToolAccess
  | ToolServer
  | ToolPermissions
  | Commands
  | AgentContext
  | Journal
  | Database
  | SqliteClient
  | HeldWords
  | Variables

/**
 * One supervisor for an agent that is the fake and commands that are real (D5-04, D6-11, D6-12).
 *
 * The agent is the one thing started as a script or with `acp` — the two ways an adapter starts
 * one — and everything else is a line of the Project's catalogue or of the agent's, started for
 * real on this machine: a run that says it ended has ended, and a tree that says it was stopped
 * was stopped.
 */
export const besideTheAgent = (
  agents: readonly FakeAgent[],
): Layer.Layer<ProcessSupervisor, never, HostProcesses | StderrSink> =>
  Layer.effect(
    ProcessSupervisor,
    Effect.gen(function* () {
      const real = yield* ProcessSupervisor
      // Each start is handed the next agent, and the last one stays: a fake that was stopped is
      // dead, so a suite about two Sessions hands over two.
      let started = 0
      const fake = fakeSupervisorService(() => {
        const next = agents[Math.min(started, agents.length - 1)]
        started += 1
        if (next === undefined) throw new Error('the suite handed over no agent')
        return next
      })
      return {
        start: (command, args, options) =>
          options.script === true || args[0] === 'acp'
            ? fake.start(command, args, options)
            : real.start(command, args, options),
      } satisfies ProcessSupervisorService
    }),
  ).pipe(Layer.provide(processSupervisorLayer))

/**
 * A run of the whole engine over one fake agent that reaches Hemera's tools (design D6-11).
 *
 * `application` hands its runtime an address nothing listens on; this one is the composition the
 * engine process builds — the tool server on a port of the loopback interface, the catalogue
 * behind it, the commands on the real supervisor, the context over the Workspace — so a scripted
 * agent calls a tool over MCP with the token it was handed, and what a scenario reads is what the
 * user and the agent would each read. The clock is the machine's: a command takes the time it
 * takes, and the flush of an answer happens when it happens. `written` receives the engine's
 * diagnostic lines, which is where a refused access is told.
 */
export function toolApplication(
  dataFolder: string,
  written: string[] = [],
  environment: Layer.Layer<MachineEnvironment> = machine,
  // A storage that never fails, unless the suite is about one that does; its diagnostic is not
  // the one read here, which is `written`.
  storage: ReturnType<typeof failing> = failing(),
  // Nobody hears of a Spec changing, unless the suite is about the window that does.
  specNotices: Layer.Layer<SpecNotices> = NoSpecNotices,
) {
  return (agent: FakeAgent, ...others: readonly FakeAgent[]) => {
    const lines = Layer.succeed(StderrSink, {
      write: (line: string) =>
        Effect.sync(() => {
          written.push(line)
        }),
    })
    const tools = toolServerLayer.pipe(
      Layer.provideMerge(toolCatalogueLayer),
      Layer.provideMerge(toolAccessLayer),
      Layer.provideMerge(toolPermissionsLayer),
      Layer.provideMerge(commandsLayer),
      Layer.provide(variablesLayer),
    )
    const services: Layer.Layer<ToolEngine> = runtimeLayer.pipe(
      Layer.provideMerge(tools),
      Layer.provideMerge(contextLayer.pipe(Layer.provide(gitLayer()))),
      Layer.provideMerge(variablesLayer),
      Layer.provideMerge(journalLayer),
      Layer.provideMerge(
        Layer.mergeAll(
          projectsLayer,
          storage.sessions,
          preferencesLayer,
          specsLayer.pipe(Layer.provide(specNotices)),
        ).pipe(Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite')))),
      ),
      Layer.provide(discoveryLayer.pipe(Layer.provide(environment))),
      Layer.provide(
        besideTheAgent([agent, ...others]).pipe(
          Layer.provide(Layer.mergeAll(hostProcessesLayer, lines)),
        ),
      ),
      Layer.provide(NoNotices),
      Layer.provide(lines),
      Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
      Layer.provideMerge(heldWordsLayer),
      Layer.provide(agentDirectoriesLayer(dataFolder)),
    )
    return <A, E>(program: Effect.Effect<A, E, ToolEngine | Scope.Scope>) =>
      Effect.runPromise(
        // The program's scope closes inside the services': what it holds — the agents, the fibers
        // draining them, their death watchers — ends before the database closes, never after.
        Effect.provide(
          Effect.scoped(
            Effect.gen(function* () {
              mkdirSync(dataFolder, { recursive: true })
              yield* openProfile(dataFolder, SHIPPED, VERSION)
              return yield* program
            }),
          ),
          services,
        ),
      )
  }
}

/** A Project on a real folder, and a Session in it on the agent named. */
export const aSessionOn = (workingDirectory: string, provider: AgentProvider) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const sessions = yield* Sessions
    const project = yield* projects.create({
      name: 'Atlas',
      tone: 'primary',
      mainPath: workingDirectory,
    })
    return yield* sessions.create(project.id, provider)
  })

/**
 * Reads until what is waited for is true, in real time, and answers the last thing it read.
 *
 * A real process ends when the machine says so and a real server answers when it answers: what
 * `heldInThread` does with the suite's clock, this does with the machine's. Bounded, so something
 * that never happens fails a test rather than hanging it.
 */
export const until = <A, E, R>(read: Effect.Effect<A, E, R>, ready: (seen: A) => boolean) =>
  Effect.gen(function* () {
    let seen = yield* read
    for (let tries = 0; tries < 200 && !ready(seen); tries += 1) {
      yield* pause(25)
      seen = yield* read
    }
    return seen
  })
