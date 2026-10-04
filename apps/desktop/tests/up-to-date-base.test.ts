/**
 * The up-to-date base: the base branch fetched from the repository's remote now, then the commit
 * of its tracking ref; the last tracking ref known when the fetch fails; the local branch of a
 * repository without a remote.
 *
 * The remote is a bare repository on the same disk, or a local server that asks for credentials:
 * nothing here reaches a network.
 */

import { readFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, relative } from 'node:path'

import { DEFAULT_BASE_BRANCH } from '@hemera/core/domain'
import { BaseUnavailable, LocalBranch, type UpToDateBase } from '@hemera/ipc'
import { Effect, Layer, Match } from 'effect'
import type { Scope } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { gitLayer } from '../src/engine/git.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { createProject, getProject, setBaseBranch } from '../src/engine/projects.ts'
import {
  type ProjectServices,
  repositoryStatusesLayer,
  upToDateBase,
} from '../src/engine/repositories.ts'
import { commitOnRemote, git, remote, repository } from './repositories.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(async () => {
  data = temporaryFolder('base')
  work = temporaryFolder('base-work')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const run = <A, E>(program: Effect.Effect<A, E, ProjectServices | Scope.Scope>): Promise<A> =>
  on(data, program.pipe(Effect.provide(Layer.merge(gitLayer(), repositoryStatusesLayer))))

/**
 * A Project of one repository, `api`, on the default base branch: with a bare repository as its
 * remote when one is named, and made ready by `before` before it is added.
 */
const withApi = async (bare?: string, before: (api: string) => void = () => {}) => {
  const main = join(work, 'atlas')
  const api = repository(join(main, 'api'), DEFAULT_BASE_BRANCH)
  if (bare !== undefined) remote(api, bare)
  before(api)
  const project = await run(
    createProject({ name: 'Atlas', mainCheckout: main, repositories: ['api'] }),
  )
  return { api, project, id: project.repositories[0]?.id ?? '' }
}

/** What the user has of a repository: its local branches and its checkout. */
const usersState = (api: string) => ({
  branches: git(api, 'for-each-ref', 'refs/heads'),
  status: git(api, 'status', '--porcelain=v2', '--branch'),
})

const freshness = (base: UpToDateBase) =>
  Match.value(base.freshness).pipe(
    Match.tagsExhaustive({
      FetchedNow: () => 'fetched now',
      NotFetchedSince: ({ since }) => `not fetched since ${since ?? 'never'}`,
      LocalBranch: () => 'local branch',
    }),
  )

describe('The base is fetched now, into its tracking ref only', () => {
  test('a new commit on the remote’s base is seen, and the user’s branches and checkout are unchanged', async () => {
    const bare = join(work, 'api.git')
    const { api, project, id } = await withApi(bare)
    const theirs = commitOnRemote(bare, DEFAULT_BASE_BRANCH, work)
    const before = usersState(api)

    const [base, after] = await run(
      Effect.gen(function* () {
        const read = yield* upToDateBase(id)
        return [read, (yield* getProject(project.id)).repositories[0]] as const
      }),
    )

    expect(base.commit).toBe(theirs)
    expect(base.ref).toBe(`refs/remotes/origin/${DEFAULT_BASE_BRANCH}`)
    expect(freshness(base)).toBe('fetched now')
    expect(after?.lastFetchedAt).not.toBeNull()
    expect(usersState(api)).toEqual(before)
    expect(git(api, 'rev-parse', 'HEAD')).not.toBe(theirs)
  })

  test('the base is the repository’s own: a repository that integrates on dev starts from dev', async () => {
    const bare = join(work, 'api.git')
    const { api, project, id } = await withApi(bare)
    git(api, 'branch', 'dev')
    git(api, 'push', '-q', 'origin', 'dev')
    const theirs = commitOnRemote(bare, 'dev', work)

    const base = await run(
      Effect.gen(function* () {
        yield* setBaseBranch({ id, version: project.version, branch: 'dev' })
        return yield* upToDateBase(id)
      }),
    )

    expect(base).toMatchObject({ commit: theirs, ref: 'refs/remotes/origin/dev' })
  })
})

describe('Offline, the last tracking ref known is used, with the date of the last fetch', () => {
  test('a remote that cannot be reached gives the last commit fetched, not fetched since then', async () => {
    const bare = join(work, 'api.git')
    const { project, id } = await withApi(bare)

    const [online, fetchedAt, offline] = await run(
      Effect.gen(function* () {
        const read = yield* upToDateBase(id)
        const at = (yield* getProject(project.id)).repositories[0]?.lastFetchedAt
        commitOnRemote(bare, DEFAULT_BASE_BRANCH, work)
        renameSync(bare, `${bare}.unplugged`)
        return [read, at, yield* upToDateBase(id)] as const
      }),
    )

    expect(freshness(online)).toBe('fetched now')
    expect(offline.commit).toBe(online.commit)
    expect(offline.ref).toBe(online.ref)
    expect(freshness(offline)).toBe(`not fetched since ${fetchedAt ?? '?'}`)
  })

  test('a remote that asks for credentials fails at once, without waiting on a prompt', async () => {
    const server = createServer((_, response) => {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="hemera"' })
      response.end()
    })
    await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
    // SAFETY: a server listening on a TCP port answers its address as an `AddressInfo`.
    const { port } = server.address() as AddressInfo
    const { api, id } = await withApi(undefined, (folder) => {
      git(folder, 'remote', 'add', 'origin', `http://127.0.0.1:${String(port)}/api.git`)
      git(folder, 'update-ref', `refs/remotes/origin/${DEFAULT_BASE_BRANCH}`, 'HEAD')
    })

    const started = Date.now()
    const base = await run(upToDateBase(id)).finally(() => server.close())

    expect(Date.now() - started).toBeLessThan(10_000)
    expect(freshness(base)).toBe('not fetched since never')
    expect(base.commit).toBe(git(api, 'rev-parse', 'HEAD'))
  })

  test('a tracking ref that does not exist and cannot be fetched names the remote and the branch', async () => {
    const { id } = await withApi(undefined, (folder) =>
      git(folder, 'remote', 'add', 'origin', join(work, 'nowhere.git')),
    )

    const refused = await run(Effect.flip(upToDateBase(id)))

    expect(refused).toBeInstanceOf(BaseUnavailable)
    expect(refused).toMatchObject({ remote: 'origin', branch: DEFAULT_BASE_BRANCH })
  })
})

describe('A repository without a remote takes its local base branch', () => {
  test('the commit of the local branch, said to be one', async () => {
    const { api, id } = await withApi()
    const base = await run(upToDateBase(id))
    expect(base).toEqual({
      commit: git(api, 'rev-parse', 'HEAD'),
      ref: `refs/heads/${DEFAULT_BASE_BRANCH}`,
      freshness: LocalBranch.make({}),
    })
  })

  test('a local base branch that does not exist is refused as such', async () => {
    const { project, id } = await withApi()
    const refused = await run(
      Effect.flip(
        Effect.andThen(
          setBaseBranch({ id, version: project.version, branch: 'dev' }),
          upToDateBase(id),
        ),
      ),
    )
    expect(refused).toBeInstanceOf(BaseUnavailable)
    expect(refused).toMatchObject({ remote: null, branch: 'dev' })
  })
})

describe('The code names no base branch but its one default', () => {
  /**
   * Every source file of the packages and of the engine, relative to the repository's root. The
   * stories of the design system and their fixtures are left out: they are example data, and a
   * repository of the catalogue is on `main` as a real one would be.
   */
  const ROOT = join(import.meta.dirname, '..', '..', '..')
  const sources = (folder: string): string[] =>
    readdirSync(folder).flatMap((entry) => {
      const path = join(folder, entry)
      if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sources(path)
      return /\.tsx?$/.test(entry) && !/(\.stories|-fixtures)\.tsx?$/.test(entry) ? [path] : []
    })

  test('no quoted “main” outside the constant, but the engine’s name for the main process', () => {
    const found = [
      ...readdirSync(join(ROOT, 'packages')).flatMap((name) =>
        sources(join(ROOT, 'packages', name, 'src')),
      ),
      ...sources(join(ROOT, 'apps', 'desktop', 'src', 'engine')),
    ].flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => /['"`]main['"`]/.test(line))
        .map((line) => `${relative(ROOT, path).replaceAll('\\', '/')}: ${line.trim()}`),
    )

    expect(found).toEqual([
      "packages/core/src/domain/project.ts: export const DEFAULT_BASE_BRANCH = 'main'",
      "packages/core/src/domain/workspace.ts: export const MAIN_CHECKOUT_NAME = 'main'",
      "apps/desktop/src/engine/index.ts: makeClientProtocol(fromMessagePortMain(hostPort), 'main'),",
    ])
  })
})
