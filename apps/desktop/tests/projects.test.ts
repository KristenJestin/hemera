/**
 * What can be done to a Project and its repositories, and what is refused.
 *
 * Each test runs on a data folder and on repositories made for it under the temporary directory,
 * migrated by the migrations the application ships; the repositories are made by the machine's
 * own `git`.
 */

import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_BASE_BRANCH } from '@hemera/core/domain'
import {
  GitMissing,
  InvalidBranchName,
  InvalidFolder,
  InvalidProjectName,
  InvalidRepositoryPath,
  type Project,
  Readable,
  type RepositoryStatus,
  Unreadable,
  StaleVersion,
  UnknownProject,
  UnknownRemote,
  UnknownRepository,
} from '@hemera/ipc'
import { Effect, Fiber, Layer, Match, Stream } from 'effect'
import type { Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { type GitProgram, type GitSpawn, gitLayer, spawnGit } from '../src/engine/git.ts'
import { readEvents } from '../src/engine/journal.ts'
import { openProfile } from '../src/engine/migrate.ts'
import {
  addRepository,
  createProject,
  detectRepositories,
  getProject,
  listProjects,
  projectChanges,
  removeRepository,
  setBaseBranch,
  setBranchPrefix,
  setRemote,
  setWorkspacesRoot,
  updateProject,
  updateRepository,
} from '../src/engine/projects.ts'
import {
  type ProjectServices,
  repositoryChanges,
  repositoryRemotes,
  repositoryStatus,
  repositoryStatusesLayer,
} from '../src/engine/repositories.ts'
import { corrupted, git, remote, repository } from './repositories.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(async () => {
  data = temporaryFolder('projects')
  work = realpathSync.native(temporaryFolder('projects-work'))
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

/** A `git` that never answers: see the fixture. */
const STUB: GitProgram = {
  command: process.execPath,
  leading: [join(import.meta.dirname, 'fixtures', 'git-stub.mjs')],
}

/** Whether a process of this machine is still there: signal 0 asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A program on the data folder, with the machine's Git or the spawn named. */
const run = <A, E>(
  program: Effect.Effect<A, E, ProjectServices | Scope.Scope>,
  spawn?: GitSpawn,
): Promise<A> =>
  on(data, program.pipe(Effect.provide(Layer.merge(gitLayer(spawn), repositoryStatusesLayer))))

const refusal = <A, E>(program: Effect.Effect<A, E, ProjectServices | Scope.Scope>) =>
  run(Effect.flip(program))

/** A main checkout holding the repositories named, each a real one. */
const checkout = (...repositories: string[]) => {
  const main = join(work, 'atlas')
  mkdirSync(main, { recursive: true })
  for (const path of repositories) repository(join(main, path))
  return main
}

const atlas = (mainCheckout: string, repositories: ReadonlyArray<string> = []) =>
  createProject({ name: 'Atlas', mainCheckout, repositories })

const readability = (status: RepositoryStatus) =>
  Match.value(status).pipe(
    Match.tagsExhaustive({ Readable: () => 'readable', Unreadable: () => 'unreadable' }),
  )

const types = (project: Project) =>
  readEvents({}).pipe(
    Effect.map(({ events }) =>
      events
        .filter((event) => event.entityKind === 'project' || event.entityKind === 'repository')
        .filter(
          (event) => event.entityId === project.id || event.payload['projectId'] === project.id,
        )
        .map((event) => event.type),
    ),
  )

describe('Repositories are detected in the main checkout and its direct subfolders', () => {
  test('a folder holding three repositories in subfolders proposes all three', async () => {
    const main = checkout('api', 'front', 'shared')
    mkdirSync(join(main, 'docs'))
    mkdirSync(join(main, 'deep', 'nested'), { recursive: true })
    repository(join(main, 'deep', 'nested', 'too-deep'))

    const project = await run(
      Effect.gen(function* () {
        const found = yield* detectRepositories(main)
        expect(found).toEqual(['api', 'front', 'shared'])
        return yield* atlas(main, found)
      }),
    )
    expect(project.repositories.map((one) => one.path)).toEqual(['api', 'front', 'shared'])
    expect(project.mainCheckout).toBe(main)
  })

  test('a main checkout that is itself a repository is proposed as itself', async () => {
    const main = repository(join(work, 'solo'))
    expect(await run(detectRepositories(main))).toEqual(['.'])
  })

  test('a folder with no repository is accepted, and a repository is added by hand', async () => {
    const main = checkout()
    const project = await run(
      Effect.gen(function* () {
        expect(yield* detectRepositories(main)).toEqual([])
        const empty = yield* atlas(main)
        expect(empty.repositories).toEqual([])
        return yield* addRepository({ projectId: empty.id, version: empty.version, path: 'later' })
      }),
    )
    expect(project.repositories.map((one) => one.path)).toEqual(['later'])
  })

  test('a folder that does not exist, or a relative one, is refused', async () => {
    expect(await refusal(detectRepositories(join(work, 'nowhere')))).toBeInstanceOf(InvalidFolder)
    expect(await refusal(detectRepositories('relative'))).toBeInstanceOf(InvalidFolder)
  })
})

describe('A repository path never leaves the main checkout', () => {
  test.each(['../elsewhere', 'api/../../elsewhere', '/tmp/x'])(
    '%s is refused, and nothing is written',
    async (path) => {
      const main = checkout()
      const [refused, after] = await run(
        Effect.gen(function* () {
          const empty = yield* atlas(main)
          const refusing = yield* Effect.flip(
            addRepository({ projectId: empty.id, version: empty.version, path }),
          )
          return [refusing, yield* getProject(empty.id)] as const
        }),
      )
      expect(refused).toBeInstanceOf(InvalidRepositoryPath)
      expect(after.repositories).toEqual([])
      expect(after.version).toBe(1)
    },
  )

  test('a path that leaves through a link is refused', async () => {
    const main = checkout()
    const outside = repository(join(work, 'outside'))
    // A junction on Windows, which needs no privilege; a directory link elsewhere.
    symlinkSync(outside, join(main, 'linked'), 'junction')
    const refused = await refusal(
      Effect.gen(function* () {
        const empty = yield* atlas(main)
        return yield* addRepository({ projectId: empty.id, version: empty.version, path: 'linked' })
      }),
    )
    expect(refused).toBeInstanceOf(InvalidRepositoryPath)
    expect(refused.message).toContain('leaves the main checkout')
  })

  test('the same repository twice is refused, whichever way it was written', async () => {
    const main = checkout('api')
    const refused = await refusal(
      Effect.gen(function* () {
        const one = yield* atlas(main, ['api'])
        return yield* addRepository({ projectId: one.id, version: one.version, path: './api/' })
      }),
    )
    expect(refused).toBeInstanceOf(InvalidRepositoryPath)
  })
})

describe('A repository Git cannot read stays visible with Git’s reason', () => {
  test('a corrupted .git is listed, and its status is Git’s own message', async () => {
    const main = checkout('api', 'front')
    corrupted(join(main, 'broken'))
    const [project, statuses] = await run(
      Effect.gen(function* () {
        const found = yield* detectRepositories(main)
        const made = yield* atlas(main, found)
        const read = yield* Effect.forEach(made.repositories, (one) => repositoryStatus(one.id))
        return [yield* getProject(made.id), read] as const
      }),
    )
    expect(project.repositories.map((one) => one.path)).toEqual(['api', 'broken', 'front'])
    expect(statuses[0]).toEqual(
      Readable.make({
        branch: 'trunk',
        commit: git(join(main, 'api'), 'rev-parse', 'HEAD'),
        dirty: false,
      }),
    )
    expect(statuses.map(readability)).toEqual(['readable', 'unreadable', 'readable'])
    expect(statuses[1]).toMatchObject({ reason: expect.stringMatching(/^fatal: /) })
  })

  test('a change of readability is told once, with Git’s reason, and again when it is back', async () => {
    const main = checkout('api')
    const changes = await run(
      Effect.gen(function* () {
        const project = yield* atlas(main, ['api'])
        const id = project.repositories[0]?.id ?? ''
        const heard = yield* Effect.forkChild(Stream.runCollect(Stream.take(repositoryChanges, 2)))
        yield* Effect.sleep(10)
        yield* repositoryStatus(id)
        rmSync(join(main, 'api'), { recursive: true, force: true })
        corrupted(join(main, 'api'))
        yield* repositoryStatus(id)
        yield* repositoryStatus(id)
        rmSync(join(main, 'api'), { recursive: true, force: true })
        repository(join(main, 'api'))
        yield* repositoryStatus(id)
        const journal = yield* readEvents({ entity: { kind: 'repository', id } })
        return {
          heard: yield* Fiber.join(heard),
          journal: journal.events.map((event) => event.type),
        }
      }),
    )
    expect(changes.journal).toEqual([
      'repository.added',
      'repository.status_changed',
      'repository.status_changed',
    ])
    expect(changes.heard.map((change) => readability(change.status))).toEqual([
      'unreadable',
      'readable',
    ])
  })

  test('a Git read that hangs is cut at 30 seconds, waited for, and shown as the reason', async () => {
    const main = checkout('api')
    const project = await run(atlas(main, ['api']))
    const api = join(main, 'api')
    const pidOf = () => {
      try {
        return Number(readFileSync(join(api, 'git-stub.pid'), 'utf8'))
      } catch {
        return 0
      }
    }

    const status = await run(
      Effect.gen(function* () {
        const reading = yield* Effect.forkChild(repositoryStatus(project.repositories[0]?.id ?? ''))
        while (pidOf() === 0) yield* TestClock.withLive(Effect.sleep(10))
        yield* TestClock.adjust('30 seconds')
        return yield* Fiber.join(reading)
      }).pipe(Effect.provide(TestClock.layer())),
      spawnGit(STUB),
    )

    expect(status).toEqual(Unreadable.make({ reason: 'Git did not answer within 30 seconds.' }))
    expect(alive(pidOf())).toBe(false)
  })

  test('a missing git is its own refusal, never a repository said unreadable', async () => {
    const main = checkout('api')
    const project = await run(atlas(main, ['api']))
    const missing = await run(
      Effect.flip(repositoryStatus(project.repositories[0]?.id ?? '')),
      spawnGit({ command: 'git-that-does-not-exist-hemera', leading: [] }),
    )
    expect(missing).toBeInstanceOf(GitMissing)
  })
})

describe('A repository is added with its remote and its base branch', () => {
  test('one remote is chosen, origin among several, and none when there is none', async () => {
    const main = checkout('single', 'several', 'others', 'none')
    remote(join(main, 'single'), join(work, 'single.git'), 'upstream')
    remote(join(main, 'several'), join(work, 'several-a.git'), 'mirror')
    remote(join(main, 'several'), join(work, 'several-b.git'), 'origin')
    remote(join(main, 'others'), join(work, 'others-a.git'), 'mirror')
    remote(join(main, 'others'), join(work, 'others-b.git'), 'upstream')

    const project = await run(atlas(main, ['single', 'several', 'others', 'none']))

    expect(project.repositories.map((one) => [one.path, one.remote, one.baseBranch])).toEqual([
      ['single', 'upstream', DEFAULT_BASE_BRANCH],
      ['several', 'origin', DEFAULT_BASE_BRANCH],
      ['others', null, DEFAULT_BASE_BRANCH],
      ['none', null, DEFAULT_BASE_BRANCH],
    ])
  })

  test('the remotes are listed, and only one of them can be chosen', async () => {
    const main = checkout('api')
    const bare = remote(join(main, 'api'), join(work, 'api.git'))
    const [remotes, chosen, refused, cleared] = await run(
      Effect.gen(function* () {
        const project = yield* atlas(main, ['api'])
        const id = project.repositories[0]?.id ?? ''
        const listed = yield* repositoryRemotes(id)
        const unknown = yield* Effect.flip(
          setRemote({ id, version: project.version, remote: 'nowhere' }),
        )
        const origin = yield* setRemote({ id, version: project.version, remote: 'origin' })
        const none = yield* setRemote({ id, version: origin.version, remote: null })
        return [listed, origin, unknown, none] as const
      }),
    )
    expect(remotes).toEqual([{ name: 'origin', fetchUrl: bare, pushUrl: bare }])
    expect(chosen.repositories[0]?.remote).toBe('origin')
    expect(refused).toBeInstanceOf(UnknownRemote)
    expect(cleared.repositories[0]?.remote).toBeNull()
  })

  test('a base branch Git would refuse is refused, and one it accepts is kept', async () => {
    const main = checkout('api')
    const [refused, kept] = await run(
      Effect.gen(function* () {
        const project = yield* atlas(main, ['api'])
        const id = project.repositories[0]?.id ?? ''
        const bad = yield* Effect.flip(
          setBaseBranch({ id, version: project.version, branch: 'feature..x' }),
        )
        return [bad, yield* setBaseBranch({ id, version: project.version, branch: 'dev' })]
      }),
    )
    expect(refused).toBeInstanceOf(InvalidBranchName)
    expect(kept.repositories[0]?.baseBranch).toBe('dev')
  })
})

describe('A repository is renamed, left out by default, and removed', () => {
  test('the new path is checked like an added one, and the rest is kept', async () => {
    const main = checkout('api', 'front')
    const [renamed, refused, removed, journal] = await run(
      Effect.gen(function* () {
        const project = yield* atlas(main, ['api', 'front'])
        const [api, front] = project.repositories
        const based = yield* setBaseBranch({
          id: api?.id ?? '',
          version: project.version,
          branch: 'dev',
        })
        const moved = yield* updateRepository({
          id: api?.id ?? '',
          version: based.version,
          path: 'services/api',
          includedByDefault: false,
        })
        const taken = yield* Effect.flip(
          updateRepository({ id: front?.id ?? '', version: moved.version, path: 'services/api' }),
        )
        const gone = yield* removeRepository({ id: front?.id ?? '', version: moved.version })
        return [moved, taken, gone, yield* types(project)] as const
      }),
    )
    expect(renamed.repositories[0]).toMatchObject({
      path: 'services/api',
      includedByDefault: false,
      baseBranch: 'dev',
    })
    expect(refused).toBeInstanceOf(InvalidRepositoryPath)
    expect(removed.repositories.map((one) => one.path)).toEqual(['services/api'])
    expect(journal).toEqual([
      'project.created',
      'repository.added',
      'repository.added',
      'repository.updated',
      'repository.updated',
      'repository.removed',
    ])
  })

  test('a repository that is no longer there is refused as such', async () => {
    const refused = await refusal(removeRepository({ id: 'nobody', version: 1 }))
    expect(refused).toBeInstanceOf(UnknownRepository)
  })
})

describe('A Project is edited against the version it was read at', () => {
  test('the name changes freely and the identifier never does', async () => {
    const main = checkout()
    const [before, after, listed] = await run(
      Effect.gen(function* () {
        const made = yield* atlas(main)
        const renamed = yield* updateProject({
          id: made.id,
          version: made.version,
          name: 'Atlas II',
        })
        return [made, renamed, yield* listProjects] as const
      }),
    )
    expect(after.id).toBe(before.id)
    expect(after.name).toBe('Atlas II')
    expect(after.version).toBe(2)
    expect(listed.map((one) => one.name)).toEqual(['Atlas II'])
  })

  test('an edit made against an older version is refused, and the first one stands', async () => {
    const main = checkout()
    const [refused, kept] = await run(
      Effect.gen(function* () {
        const one = yield* atlas(main)
        yield* updateProject({ id: one.id, version: one.version, name: 'Atlas II' })
        const late = yield* Effect.flip(
          updateProject({ id: one.id, version: one.version, name: 'Atlas III' }),
        )
        return [late, yield* getProject(one.id)] as const
      }),
    )
    expect(refused).toBeInstanceOf(StaleVersion)
    expect(kept.name).toBe('Atlas II')
  })

  test('a Project that does not exist is refused as such', async () => {
    expect(await refusal(getProject('nobody'))).toBeInstanceOf(UnknownProject)
    expect(await refusal(updateProject({ id: 'nobody', version: 1, name: 'x' }))).toBeInstanceOf(
      UnknownProject,
    )
  })

  test('an empty name, or a main checkout that is not absolute, is refused', async () => {
    const main = checkout()
    expect(
      await refusal(createProject({ name: '  ', mainCheckout: main, repositories: [] })),
    ).toBeInstanceOf(InvalidProjectName)
    expect(
      await refusal(createProject({ name: 'Atlas', mainCheckout: 'atlas', repositories: [] })),
    ).toBeInstanceOf(InvalidFolder)
  })

  test('a main checkout reached through a link is kept as the disk spells it', async () => {
    const main = checkout()
    const link = join(work, 'through-a-link')
    symlinkSync(main, link, 'junction')
    const project = await run(
      createProject({ name: 'Atlas', mainCheckout: link, repositories: [] }),
    )
    expect(project.mainCheckout).toBe(main)
  })
})

describe('The Workspaces folder and the branch prefix are the Project’s', () => {
  test('both start at their default, are set, and are cleared back to it', async () => {
    const main = checkout()
    const trees = join(work, 'trees')
    const [fresh, set, cleared] = await run(
      Effect.gen(function* () {
        const one = yield* atlas(main)
        const rooted = yield* setWorkspacesRoot({ id: one.id, version: one.version, path: trees })
        const prefixed = yield* setBranchPrefix({
          id: rooted.id,
          version: rooted.version,
          prefix: ' team/atlas ',
        })
        const unrooted = yield* setWorkspacesRoot({
          id: prefixed.id,
          version: prefixed.version,
          path: null,
        })
        const back = yield* setBranchPrefix({
          id: unrooted.id,
          version: unrooted.version,
          prefix: null,
        })
        return [one, prefixed, back] as const
      }),
    )
    expect([fresh.workspacesRoot, fresh.branchPrefix]).toEqual([null, null])
    expect([set.workspacesRoot, set.branchPrefix]).toEqual([trees, 'team/atlas'])
    expect([cleared.workspacesRoot, cleared.branchPrefix]).toEqual([null, null])
  })

  test.each([
    ['relative', 'trees', 'it is not an absolute path'],
    ['the main checkout itself', '', 'it is inside the main checkout'],
    ['inside the main checkout', '.worktrees', 'it is inside the main checkout'],
  ])('a Workspaces folder %s is refused, naming why', async (_, below, reason) => {
    const main = checkout()
    const path = below === 'trees' ? below : join(main, below)
    const refused = await refusal(
      Effect.gen(function* () {
        const one = yield* atlas(main)
        return yield* setWorkspacesRoot({ id: one.id, version: one.version, path })
      }),
    )
    expect(refused).toBeInstanceOf(InvalidFolder)
    expect(refused.message).toContain(reason)
  })

  test('a prefix Git would refuse is refused', async () => {
    const main = checkout()
    const refused = await refusal(
      Effect.gen(function* () {
        const one = yield* atlas(main)
        return yield* setBranchPrefix({ id: one.id, version: one.version, prefix: 'my team' })
      }),
    )
    expect(refused).toBeInstanceOf(InvalidBranchName)
  })
})

describe('Every change of a Project is told to whoever follows them', () => {
  test('a rename and an added repository each arrive as the Project they made', async () => {
    const main = checkout('api')
    const heard = await run(
      Effect.gen(function* () {
        const one = yield* atlas(main)
        const following = yield* Effect.forkChild(Stream.runCollect(Stream.take(projectChanges, 2)))
        yield* Effect.sleep(10)
        const renamed = yield* updateProject({ id: one.id, version: one.version, name: 'Atlas II' })
        yield* addRepository({ projectId: one.id, version: renamed.version, path: 'api' })
        return yield* Fiber.join(following)
      }),
    )
    expect(heard.map((project) => [project.name, project.repositories.length])).toEqual([
      ['Atlas II', 0],
      ['Atlas II', 1],
    ])
  })
})
