import { MessageChannel } from 'node:worker_threads'

import { Deferred, Effect, Fiber, Schema, Stream } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'
import { describe, expect, test } from 'vite-plus/test'

import {
  AgentsProcessGone,
  BaseUnavailable,
  closedAs,
  DatabaseOpen,
  DEFAULT_PREFERENCES,
  EngineGone,
  EngineRpcs,
  EngineStart,
  type EngineStatus,
  fromMessagePort,
  GitCut,
  GitFailed,
  GitMissing,
  InvalidProjectName,
  LaunchFailed,
  makeClientProtocol,
  makeServerProtocol,
  NotFetchedSince,
  Preferences,
  RemovalRefused,
  RestoreRefused,
  StaleVersion,
  StorageFailed,
  streamClosedAs,
  Unreadable,
  UpToDateBase,
  type Workspace,
} from '../src/index.ts'

const status: EngineStatus = {
  ready: true,
  version: '1.0.0',
  channel: 'dev',
  dataFolder: '/data',
  database: DatabaseOpen.make({
    lastMigration: '20261003184739_profile',
    writtenByVersion: '1.0.0',
    backups: { count: 0, latest: null },
    reconciliation: 'none',
  }),
}

const unused = () => Effect.die('not asked of this engine')

/** The Projects of an engine that refuses a name and cannot read a repository. */
const projectHandlers = {
  'projects.list': unused,
  'projects.get': unused,
  'projects.create': ({ name }: { readonly name: string }) =>
    Effect.fail(new InvalidProjectName({ name, reason: 'it is empty' })),
  'projects.update': unused,
  'projects.detectRepositories': unused,
  'projects.setWorkspacesRoot': unused,
  'projects.setBranchPrefix': unused,
  'projects.changes': () => Stream.die('not asked of this engine'),
  'repositories.add': unused,
  'repositories.remove': unused,
  'repositories.update': unused,
  'repositories.status': () =>
    Effect.succeed(Unreadable.make({ reason: 'fatal: not a git repository: /nowhere' })),
  'repositories.remotes': unused,
  'repositories.setRemote': unused,
  'repositories.setBaseBranch': unused,
  'repositories.upToDateBase': () =>
    Effect.fail(new BaseUnavailable({ remote: 'origin', branch: 'dev', reason: 'offline' })),
  'repositories.changes': () => Stream.die('not asked of this engine'),
}

/** A Workspace with one worktree, made from an up-to-date base read offline, and not prepared. */
const workspace: Workspace = {
  id: 'w1',
  projectId: 'p1',
  name: 'login-form',
  folder: '/workspaces/login-form',
  branch: 'atlas/login-form',
  createdAt: '2026-10-03T00:00:00.000Z',
  preparation: 'pending',
  preparing: false,
  repositories: [
    {
      repositoryId: 'r1',
      path: 'api',
      worktree: '/workspaces/login-form/api',
      base: {
        commit: 'abc',
        ref: 'refs/remotes/origin/dev',
        freshness: NotFetchedSince.make({ since: '2026-10-03T00:00:00.000Z', reason: 'offline' }),
      },
    },
  ],
  steps: [
    {
      id: 's1',
      position: 1,
      kind: 'worktree',
      base: 'api',
      path: null,
      commandId: null,
      line: null,
      state: 'pending',
      failure: null,
    },
  ],
}

/** The Workspaces of an engine that holds one, and refuses to remove it over a file. */
const workspaceHandlers = {
  'workspaces.create': unused,
  'workspaces.get': () => Effect.succeed(workspace),
  'workspaces.list': unused,
  'workspaces.status': unused,
  'workspaces.prepare': unused,
  'workspaces.resume': unused,
  'workspaces.remove': () =>
    Effect.fail(
      new RemovalRefused({
        reason: 'api/notes.txt holds work that is not committed',
        file: 'api/notes.txt',
      }),
    ),
  'workspaces.changes': () => Stream.die('not asked of this engine'),
  'recipe.get': unused,
  'recipe.save': unused,
  'recipe.check': unused,
  'variables.list': unused,
  'variables.set': unused,
  'variables.remove': unused,
  'variables.reveal': unused,
}

/** main's view of an engine that answers its status and then never ends the change stream. */
const engineLink = Effect.gen(function* () {
  const { port1: mainPort, port2: enginePort } = new MessageChannel()
  const server = yield* makeServerProtocol
  server.accept(fromMessagePort(enginePort))
  yield* RpcServer.make(EngineRpcs, { disableFatalDefects: true }).pipe(
    Effect.provide(
      EngineRpcs.toLayer({
        'engine.status': () => Effect.succeed(status),
        'engine.statusChanges': () => Stream.concat(Stream.make(status), Stream.never),
        'preferences.read': () => Effect.succeed(DEFAULT_PREFERENCES),
        'preferences.write': () => Effect.void,
        'profile.backups': () => Effect.succeed({ count: 0, latest: null }),
        'profile.backup': ({ folder }) => Effect.succeed(folder),
        'profile.restore': () => Effect.fail(new RestoreRefused({ sentence: 'Not this one.' })),
        ...projectHandlers,
        ...workspaceHandlers,
      }),
    ),
    Effect.provideService(RpcServer.Protocol, server.protocol),
    Effect.forkScoped,
  )
  const protocol = yield* makeClientProtocol(fromMessagePort(mainPort), 'the engine')
  const client = yield* RpcClient.make(EngineRpcs).pipe(
    Effect.provideService(RpcClient.Protocol, protocol),
  )
  return { client, enginePort }
})

describe('The engine link', () => {
  test('a dead engine fails a pending call and a later one with EngineGone', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client, enginePort } = yield* engineLink
          expect(yield* client['engine.status']()).toEqual(status)
          const heard = yield* Deferred.make<void>()
          const changes = yield* Effect.forkChild(
            Stream.runCollect(
              client['engine.statusChanges']().pipe(
                streamClosedAs(() => new EngineGone()),
                Stream.tap(() => Deferred.succeed(heard, undefined)),
              ),
            ),
          )
          yield* Deferred.await(heard)
          enginePort.close()
          const pending = yield* Effect.flip(Fiber.join(changes))
          expect(pending).toBeInstanceOf(EngineGone)
          const later = yield* Effect.flip(
            client['engine.status']().pipe(closedAs(() => new EngineGone())),
          )
          expect(later).toBeInstanceOf(EngineGone)
        }),
      ),
    ))

  test('the start message crosses the link through the JSON codec and back', () => {
    const codec = Schema.toCodecJson(EngineStart)
    const start = {
      dataFolder: '/data',
      channel: 'beta' as const,
      version: '1.0.0-beta.1',
      migrations: '/app/drizzle',
    }
    const sent = JSON.parse(JSON.stringify(Schema.encodeSync(codec)(start)))
    expect(Schema.decodeUnknownSync(codec)(sent)).toEqual(start)
    expect(() => Schema.decodeUnknownSync(codec)({ ...sent, channel: 'nightly' })).toThrow()
  })
})

describe('The Projects on the engine link', () => {
  test('a refusal and an unreadable repository arrive as themselves', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* engineLink
          const refused = yield* Effect.flip(
            client['projects.create']({ name: ' ', mainCheckout: '/atlas', repositories: [] }),
          )
          expect(refused).toBeInstanceOf(InvalidProjectName)
          expect(refused.message).toBe('This Project name is refused: it is empty.')
          expect(yield* client['repositories.status']({ id: 'r1' })).toEqual(
            Unreadable.make({ reason: 'fatal: not a git repository: /nowhere' }),
          )
          const unavailable = yield* Effect.flip(client['repositories.upToDateBase']({ id: 'r1' }))
          expect(unavailable).toBeInstanceOf(BaseUnavailable)
          expect(unavailable).toMatchObject({ remote: 'origin', branch: 'dev' })
        }),
      ),
    ))

  test('an up-to-date base crosses the JSON codec with its freshness', () => {
    const codec = Schema.toCodecJson(UpToDateBase)
    const base = {
      commit: 'abc',
      ref: 'refs/remotes/origin/dev',
      freshness: NotFetchedSince.make({ since: '2026-10-03T00:00:00.000Z', reason: 'offline' }),
    }
    const sent = JSON.parse(JSON.stringify(Schema.encodeSync(codec)(base)))
    expect(Schema.decodeUnknownSync(codec)(sent)).toEqual(base)
  })
})

describe('The Workspaces on the engine link', () => {
  test('a Workspace and a refused removal arrive as themselves', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* engineLink
          expect(yield* client['workspaces.get']({ id: 'w1' })).toEqual(workspace)
          const refused = yield* Effect.flip(client['workspaces.remove']({ id: 'w1' }))
          expect(refused).toBeInstanceOf(RemovalRefused)
          expect(refused).toMatchObject({ file: 'api/notes.txt' })
          expect(refused.message).toBe(
            'This Workspace was not removed: api/notes.txt holds work that is not committed.',
          )
        }),
      ),
    ))
})

describe('Errors that can reach a screen', () => {
  test.each([
    [new EngineGone(), 'Hemera’s engine stopped.'],
    [new AgentsProcessGone(), 'An agent’s process stopped.'],
    [
      new LaunchFailed({ reason: 'the program is missing' }),
      'An agent’s process could not be started: the program is missing',
    ],
    [
      new StorageFailed({ sentence: 'The data folder refused while writing the preferences.' }),
      'The data folder refused while writing the preferences.',
    ],
    [
      new RestoreRefused({ sentence: 'This folder is not a backup of Hemera.' }),
      'This folder is not a backup of Hemera.',
    ],
    [
      new GitFailed({ args: ['status'], folder: '/r', stderr: 'fatal: not a git repository\n' }),
      'fatal: not a git repository',
    ],
    [new GitMissing({ program: 'git' }), 'Git was not found: git is not on the PATH.'],
    [
      new GitCut({ args: ['status'], folder: '/r', limit: 'time', seconds: 30 }),
      'Git did not answer within 30 seconds.',
    ],
    [
      new StaleVersion({ entity: 'Project', id: 'p1', expected: 1 }),
      'This Project changed elsewhere; reopen it and try again.',
    ],
    [
      new BaseUnavailable({ remote: 'origin', branch: 'dev', reason: 'offline' }),
      'origin/dev was never fetched and cannot be now: offline',
    ],
  ])('%s says what happened in a sentence', (error, sentence) => {
    expect(error.message).toBe(sentence)
    expect(error.message).not.toMatch(/[{}]|\n\s+at /)
  })
})

describe('The preferences', () => {
  test('the theme is the system’s, light or dark, and nothing else', () => {
    const decode = Schema.decodeUnknownSync(Preferences)
    for (const theme of ['system', 'light', 'dark']) expect(decode({ theme })).toEqual({ theme })
    expect(() => decode({ theme: 'sepia' })).toThrow()
  })

  test('a refused restore reaches the caller as itself', () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* engineLink
          const refused = yield* Effect.flip(client['profile.restore']({ folder: '/backup' }))
          expect(refused).toBeInstanceOf(RestoreRefused)
          expect(refused.message).toBe('Not this one.')
        }),
      ),
    ))
})
