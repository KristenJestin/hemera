/**
 * The window's side of its link, as React sees it: promises and subscriptions, never Effect.
 * Main is played by a server over a Node port.
 */

import { MessageChannel } from 'node:worker_threads'

import {
  DatabaseOpen,
  DEFAULT_PREFERENCES,
  EngineGone,
  fromMessagePort,
  makeServerProtocol,
  WindowRpcs,
  type EngineStatus,
  type EnvironmentReport,
} from '@hemera/ipc'
import { Deferred, Effect, Stream } from 'effect'
import { RpcServer } from 'effect/rpc'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { ENGINE_START_LIMIT, watchEngine, type EngineState } from '../src/renderer/engine-start.ts'
import { linkOver, type Link } from '../src/renderer/link.ts'

const status: EngineStatus = {
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
  database: DatabaseOpen.make({
    lastMigration: null,
    writtenByVersion: '1.0.0',
    backups: { count: 0, latest: null },
    reconciliation: 'none',
  }),
}
const report: EnvironmentReport = {
  version: '1.0.0',
  channel: 'dev',
  platform: 'linux',
  osVersion: 'test',
  distribution: null,
  session: null,
  displays: [],
  versions: { electron: '44', chrome: '140', node: '24' },
  dataFolder: '/data',
  notVerified: [],
  producedAt: '2026-10-03T00:00:00.000Z',
}

const unused = () => Effect.die('the window’s link is not asked for Projects here')

/** The Projects and their Workspaces, which no test of the window's link asks for. */
const noProjects = {
  'projects.list': unused,
  'projects.get': unused,
  'projects.create': unused,
  'projects.update': unused,
  'projects.detectRepositories': unused,
  'projects.setWorkspacesRoot': unused,
  'projects.setBranchPrefix': unused,
  'projects.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'repositories.add': unused,
  'repositories.remove': unused,
  'repositories.update': unused,
  'repositories.status': unused,
  'repositories.remotes': unused,
  'repositories.setRemote': unused,
  'repositories.setBaseBranch': unused,
  'repositories.upToDateBase': unused,
  'repositories.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'workspaces.create': unused,
  'workspaces.get': unused,
  'workspaces.list': unused,
  'workspaces.status': unused,
  'workspaces.prepare': unused,
  'workspaces.resume': unused,
  'workspaces.remove': unused,
  'workspaces.changes': () => Stream.die('the window’s link is not asked for Projects here'),
  'recipe.get': unused,
  'recipe.save': unused,
  'recipe.check': unused,
  'variables.list': unused,
  'variables.set': unused,
  'variables.remove': unused,
  'variables.reveal': unused,
  'catalogue.list': unused,
  'catalogue.save': unused,
  'catalogue.remove': unused,
  'catalogue.checkLine': unused,
  'runs.list': unused,
  'runs.start': unused,
  'runs.stop': unused,
  'runs.restart': unused,
  'runs.output': unused,
  'runs.changes': () => Stream.die('the window’s link is not asked for Projects here'),
}

/** A main that answers as told, and says when the window stopped listening. */
const main = async (engine: 'answers' | 'gone') => {
  const stopped = Deferred.makeUnsafe<void>()
  const { port1: windowPort, port2: mainPort } = new MessageChannel()
  const handlers = WindowRpcs.toLayer({
    'engine.status': () =>
      engine === 'answers' ? Effect.succeed(status) : Effect.fail(new EngineGone()),
    'engine.statusChanges': () =>
      engine === 'answers'
        ? Stream.concat(Stream.make(status), Stream.never).pipe(
            Stream.ensuring(Deferred.succeed(stopped, undefined)),
          )
        : Stream.fail(new EngineGone()),
    'preferences.read': () => Effect.succeed(DEFAULT_PREFERENCES),
    'preferences.write': () => Effect.void,
    'profile.backups': () => Effect.succeed({ count: 0, latest: null }),
    'profile.backup': ({ folder }) => Effect.succeed(folder),
    'profile.restore': () => Effect.void,
    'environment.report': () => Effect.succeed(report),
    'application.relaunch': () => Effect.void,
    ...noProjects,
  })
  const program = Effect.gen(function* () {
    const server = yield* makeServerProtocol
    server.accept(fromMessagePort(mainPort))
    yield* RpcServer.make(WindowRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    yield* Effect.never
  })
  const fiber = Effect.runFork(Effect.scoped(program))
  const link = linkOver(fromMessagePort(windowPort))
  cleanups.push(() => {
    link.close()
    fiber.interruptUnsafe()
  })
  return { link, stopped: Effect.runPromise(Deferred.await(stopped)) }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.useRealTimers()
})

describe('The window’s link, for components and hooks', () => {
  test('a call resolves with its value', async () => {
    const { link } = await main('answers')
    await expect(link.engineStatus()).resolves.toEqual(status)
  })

  test('a call rejects with the decoded typed error, as its class', async () => {
    const { link } = await main('gone')
    const failure = await link.engineStatus().catch((error: Error) => error)
    expect(failure).toBeInstanceOf(EngineGone)
  })

  test('unsubscribing from a stream interrupts it in main', async () => {
    const { link, stopped } = await main('answers')
    const statuses: EngineStatus[] = []
    const unsubscribe = await new Promise<() => void>((resolve) => {
      const stop = link.onEngineStatus(
        (next) => {
          statuses.push(next)
          resolve(stop)
        },
        () => undefined,
      )
    })
    unsubscribe()
    await stopped
    expect(statuses).toEqual([status])
  })
})

/** A link whose engine does what the test says, when it says. */
const scripted = () => {
  let answer: ((status: EngineStatus) => void) | undefined
  let end: ((error: EngineGone) => void) | undefined
  const link: Link = {
    engineStatus: () => new Promise((resolve) => (answer = resolve)),
    onEngineStatus: (_, onEnd) => {
      end = onEnd
      return () => undefined
    },
    environmentReport: async () => report,
    relaunch: async () => undefined,
    close: () => undefined,
  }
  return {
    link,
    answers: () => answer?.(status),
    dies: () => end?.(new EngineGone()),
  }
}

describe('The window waits for the engine to start', () => {
  test('the engine’s first answer makes it ready', async () => {
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    engine.answers()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', status }))
  })

  test('no answer within the limit says so, with the diagnostic folder, and cancels nothing', async () => {
    vi.useFakeTimers()
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    await vi.advanceTimersByTimeAsync(ENGINE_START_LIMIT)
    expect(states.at(-1)).toEqual({ kind: 'late', dataFolder: '/data' })
    engine.answers()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'ready', status }))
  })

  test('the limit is thirty seconds', () => {
    expect(ENGINE_START_LIMIT).toBe(30_000)
  })

  test('an engine that dies says it stopped', async () => {
    const engine = scripted()
    const states: EngineState[] = []
    watchEngine(engine.link, (state) => states.push(state))
    engine.answers()
    engine.dies()
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'stopped' }))
  })
})
