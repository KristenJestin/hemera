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

import type { SessionEntry } from '@hemera/core'
import { MachineEnvironment, discoveryLayer } from '#engine/agents/discovery.ts'
import { fakeSupervisor, type FakeAgent, type FakeStep } from '#engine/agents/fake.ts'
import { clockLayer, poolLayer } from '#engine/agents/pool.ts'
import { AgentNotices, NoNotices, runtimeLayer } from '#engine/agents/runtime.ts'
import type { AgentRuntime, Notice } from '#engine/agents/runtime.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** The version the shipped migrations are opened with, as the application opens them. */
const VERSION = '0.4.0'

/**
 * A machine that has every agent, signed in, at a path nothing has to be installed at.
 *
 * Signed in because a Session runs an agent that is: an agent nobody signed in is refused before
 * a process is started (D5-21), and what these suites are about is the turn. The adapters answer
 * from a `node_modules` this machine pretends to have, which is where a real one would find them
 * — never the `PATH`.
 */
export const machine = Layer.succeed(MachineEnvironment, {
  home: '/home/ana',
  env: {},
  node: '/usr/bin/node',
  locate: (command: string) => Effect.succeed(join('/usr/local/bin', command)),
  bundled: (packageName: string) =>
    Effect.succeed(join('/opt/hemera/node_modules', packageName, 'dist', 'index.js')),
  readVersion: () => Effect.succeed('1.0.0'),
  holds: () => Effect.succeed(true),
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
    }),
  }
}

/** A run of the application over one scripted agent, on one data folder. */
export function application(
  dataFolder: string,
  notices: Layer.Layer<AgentNotices> = NoNotices,
  environment: Layer.Layer<MachineEnvironment> = machine,
) {
  return (agent: FakeAgent) => {
    // The runtime is built on the very same services the suite reads with — `provideMerge` hands
    // them up rather than hiding them, so one database is opened and one thread is written.
    const services: Layer.Layer<
      Projects | Sessions | AgentRuntime | Database | SqliteClient | TestClock.TestClock
    > = runtimeLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
          Layer.provideMerge(databaseLayer(join(dataFolder, 'hemera.sqlite'))),
        ),
      ),
      Layer.provide(discoveryLayer.pipe(Layer.provide(environment))),
      Layer.provide(fakeSupervisor(agent)),
      Layer.provide(notices),
      // The pool reads the clock the suite moves, because it is the engine's own clock: five
      // idle minutes are a `TestClock.adjust` here rather than five minutes of waiting (D5-05).
      Layer.provide(poolLayer.pipe(Layer.provide(clockLayer))),
      Layer.provideMerge(TestClock.layer()),
    )
    return <A, E>(
      program: Effect.Effect<
        A,
        E,
        | Projects
        | Sessions
        | AgentRuntime
        | Database
        | SqliteClient
        | TestClock.TestClock
        | Scope.Scope
      >,
    ) =>
      Effect.runPromise(
        Effect.scoped(
          Effect.provide(
            Effect.gen(function* () {
              mkdirSync(dataFolder, { recursive: true })
              yield* openProfile(dataFolder, SHIPPED, VERSION)
              return yield* program
            }),
            services,
          ),
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
