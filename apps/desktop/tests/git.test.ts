/**
 * The machine's `git`, as the engine asks it: the spawn, its limits, its refusals, and the reads
 * and the worktree calls the Projects and Workspaces rest on.
 *
 * Every repository is made for the test under the temporary directory by the machine's own `git`.
 * Where a Git that hangs or floods is needed, a stub stands in for it.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { GitCut, GitFailed, GitMissing } from '@hemera/ipc'
import { Effect, Fiber, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  type CallClass,
  Git,
  type GitProgram,
  type GitService,
  type GitSpawn,
  LIMITS,
  gitLayer,
  spawnGit,
} from '../src/engine/git.ts'
import { SideEffectInTransaction, mutate } from '../src/engine/transaction.ts'
import { corrupted, git, remote, repository } from './repositories.ts'
import { on, removeFolders, temporaryFolder } from './storage.ts'

let folder: string
beforeEach(() => {
  folder = temporaryFolder('git')
})
afterEach(removeFolders)

/** A `git` that never answers, writes its process id, or floods: see the fixture. */
const STUB: GitProgram = {
  command: process.execPath,
  leading: [join(import.meta.dirname, 'fixtures', 'git-stub.mjs')],
}

const asked = <A, E>(program: Effect.Effect<A, E, Git>, spawn?: GitSpawn) =>
  Effect.runPromise(Effect.provide(program, gitLayer(spawn)))

/** Whether a process of this machine is still there: signal 0 asks without sending anything. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const stubPid = (where: string) => {
  const file = join(where, 'git-stub.pid')
  return existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0
}

describe('A repository’s status says its branch and whether it is dirty', () => {
  test('a clean repository on its branch', async () => {
    const api = repository(join(folder, 'api'))
    expect(await asked(Git.use((one) => one.status(api)))).toEqual({
      branch: 'trunk',
      commit: git(api, 'rev-parse', 'HEAD'),
      dirty: false,
    })
  })

  test('an untracked file, a staged one or a changed one makes it dirty', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'loose.txt'), 'loose\n')
    expect((await asked(Git.use((one) => one.status(api)))).dirty).toBe(true)
  })

  test('a detached HEAD has no branch, and a repository with no commit has no commit', async () => {
    const api = repository(join(folder, 'api'))
    git(api, 'checkout', '-q', '--detach')
    const empty = join(folder, 'empty')
    repository(join(folder, 'seed'))
    git(folder, 'init', '-q', '-b', 'trunk', empty)

    const [detached, unborn] = await asked(
      Effect.all([Git.use((one) => one.status(api)), Git.use((one) => one.status(empty))]),
    )
    expect(detached.branch).toBeNull()
    expect(detached.commit).toBe(git(api, 'rev-parse', 'HEAD'))
    expect(unborn).toEqual({ branch: 'trunk', commit: null, dirty: false })
  })

  test('the status writes nothing, so it never takes the user’s index lock', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    // The same file with another time: a plain `git status` would refresh the index and write it.
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(api, 'tracked.txt'), past, past)
    const before = readFileSync(join(api, '.git', 'index'))

    await asked(Git.use((one) => one.status(api)))

    expect(readFileSync(join(api, '.git', 'index')).equals(before)).toBe(true)
  })
})

describe('Git’s refusal comes back as Git wrote it', () => {
  test('a corrupted .git is refused with Git’s own message, the arguments and the folder', async () => {
    const broken = corrupted(join(folder, 'broken'))
    const refused = await asked(Effect.flip(Git.use((one) => one.status(broken))))
    expect(refused).toBeInstanceOf(GitFailed)
    expect(refused.message).toMatch(/^fatal: /)
    expect(refused).toMatchObject({ folder: broken })
  })

  test('a missing git is its own refusal, naming the program', async () => {
    const api = repository(join(folder, 'api'))
    const refused = await asked(
      Effect.flip(Git.use((one) => one.status(api))),
      spawnGit({ command: 'git-that-does-not-exist-hemera', leading: [] }),
    )
    expect(refused).toBeInstanceOf(GitMissing)
    expect(refused.message).toBe(
      'Git was not found: git-that-does-not-exist-hemera is not on the PATH.',
    )
  })
})

describe('Every Git call declares its class, and its class sets its limit', () => {
  test('reads are given 30 seconds and work 30 minutes', () => {
    expect(LIMITS).toEqual({ read: 30_000, work: 30 * 60_000 })
  })

  /** The classes a call ran its commands with, recorded by a spawn that answers nothing. */
  const classesOf = async <E>(call: (one: GitService) => Effect.Effect<void, E>) => {
    const seen: CallClass[] = []
    const recording: GitSpawn = (_, args, kind) => {
      seen.push(kind)
      return Effect.succeed(args[0] === 'rev-parse' ? 'abc\n' : '')
    }
    await asked(Git.use(call), recording)
    return seen
  }

  test.each([
    ['status', 'read', (one: GitService) => one.status('/r')],
    ['branches', 'read', (one: GitService) => one.branches('/r')],
    ['remotes', 'read', (one: GitService) => one.remotes('/r')],
    ['fetchBranch', 'read', (one: GitService) => one.fetchBranch('/r', 'origin', 'dev')],
    ['commitOf', 'read', (one: GitService) => one.commitOf('/r', 'refs/heads/dev')],
    ['worktreeAdd', 'work', (one: GitService) => one.worktreeAdd('/r', 'b', '/w', 'abc')],
    ['worktreeAttach', 'work', (one: GitService) => one.worktreeAttach('/r', 'b', '/w')],
    ['worktreeRemove', 'work', (one: GitService) => one.worktreeRemove('/r', '/w')],
    ['worktreePrune', 'work', (one: GitService) => one.worktreePrune('/r')],
    ['worktreeDetach', 'work', (one: GitService) => one.worktreeDetach('/r', '/w', 'abc')],
    ['repositoryOf', 'read', (one: GitService) => one.repositoryOf('/w')],
    ['worktrees', 'read', (one: GitService) => one.worktrees('/r')],
    ['changedFiles', 'read', (one: GitService) => one.changedFiles('/r')],
    ['aheadBehind', 'read', (one: GitService) => one.aheadBehind('/r', 'abc')],
  ] as const)('%s runs as a %s', async (_, kind, call) => {
    expect(await classesOf((one: GitService) => Effect.asVoid(call(one)))).toEqual([kind])
  })
})

describe('A Git read that hangs is cut at its limit and waited for', () => {
  test('cut at 30 seconds of the clock, not before, and gone when the refusal arrives', async () => {
    const api = repository(join(folder, 'api'))
    const program = Effect.gen(function* () {
      const reading = yield* Effect.forkChild(Effect.flip(Git.use((one) => one.status(api))))
      while (stubPid(api) === 0) yield* TestClock.withLive(Effect.sleep(10))
      yield* TestClock.adjust('29 seconds')
      const early = reading.pollUnsafe()
      yield* TestClock.adjust('1 second')
      return { early, refused: yield* Fiber.join(reading) }
    })

    const { early, refused } = await Effect.runPromise(
      program.pipe(Effect.provide(gitLayer(spawnGit(STUB))), Effect.provide(TestClock.layer())),
    )

    expect(early).toBeUndefined()
    expect(refused).toBeInstanceOf(GitCut)
    expect(refused.message).toBe('Git did not answer within 30 seconds.')
    expect(alive(stubPid(api))).toBe(false)
  })

  test('an interrupted Git has exited when the interruption returns, so its folder can go', async () => {
    const standing = join(folder, 'standing')
    repository(standing)
    const running = Effect.runFork(spawnGit(STUB)(standing, ['status'], 'read'))
    await expect.poll(() => stubPid(standing)).toBeGreaterThan(0)
    const pid = stubPid(standing)

    await Effect.runPromise(Fiber.interrupt(running))

    expect(alive(pid)).toBe(false)
    // On Windows, a folder a live process stands in cannot be removed (EPERM).
    expect(() => rmSync(standing, { recursive: true })).not.toThrow()
  })

  test('an answer longer than 32 MB is cut', async () => {
    const refused = await Effect.runPromise(Effect.flip(spawnGit(STUB)(folder, ['flood'], 'read')))
    expect(refused).toBeInstanceOf(GitCut)
    expect(refused).toMatchObject({ limit: 'output' })
  })

  test('Git is never left waiting on a prompt for credentials', async () => {
    expect(await Effect.runPromise(spawnGit(STUB)(folder, ['environment'], 'read'))).toBe('0')
  })
})

describe('Git is never asked inside a database transaction', () => {
  test('a Git call inside a mutation is refused as a defect, and the transaction rolled back', async () => {
    const api = repository(join(folder, 'api'))
    const data = temporaryFolder('git-data')
    const refused = await on(
      data,
      mutate('trying', () =>
        Git.use((one) => one.status(api)).pipe(Effect.as({ result: null, events: [] })),
      ).pipe(
        Effect.catchDefect((defect) => Effect.succeed(defect)),
        Effect.provide(gitLayer()),
      ),
    )
    expect(refused).toBeInstanceOf(SideEffectInTransaction)
  })
})

describe('The remotes of a repository, its branches and its refs', () => {
  test('each remote with its URLs, and none for a repository without', async () => {
    const api = repository(join(folder, 'api'))
    const lone = repository(join(folder, 'lone'))
    const bare = remote(api, join(folder, 'remote.git'))
    git(api, 'remote', 'add', 'upstream', 'https://example.invalid/upstream.git')
    git(api, 'remote', 'set-url', '--push', 'upstream', 'https://example.invalid/push.git')

    const [remotes, none] = await asked(
      Effect.all([Git.use((one) => one.remotes(api)), Git.use((one) => one.remotes(lone))]),
    )
    expect(remotes).toEqual([
      { name: 'origin', fetchUrl: bare, pushUrl: bare },
      {
        name: 'upstream',
        fetchUrl: 'https://example.invalid/upstream.git',
        pushUrl: 'https://example.invalid/push.git',
      },
    ])
    expect(none).toEqual([])
  })

  test('the local branches and what HEAD is on', async () => {
    const api = repository(join(folder, 'api'))
    git(api, 'branch', 'dev')
    const seen = await asked(Git.use((one) => one.branches(api)))
    expect(seen).toEqual({
      branches: ['dev', 'trunk'],
      head: { branch: 'trunk', commit: git(api, 'rev-parse', 'HEAD') },
    })
  })

  test('the commit of a ref, and none for a ref that does not exist', async () => {
    const api = repository(join(folder, 'api'))
    const [found, missing] = await asked(
      Effect.all([
        Git.use((one) => one.commitOf(api, 'refs/heads/trunk')),
        Git.use((one) => one.commitOf(api, 'refs/heads/nothing')),
      ]),
    )
    expect(found).toEqual(Option.some(git(api, 'rev-parse', 'HEAD')))
    expect(missing).toEqual(Option.none())
  })
})

describe('A worktree is added, attached and removed with the machine’s git', () => {
  test('the branch is made, kept after the worktree goes, and attached again', async () => {
    const api = repository(join(folder, 'api'))
    const tree = join(folder, 'trees', 'api')
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        const base = git(api, 'rev-parse', 'HEAD')
        yield* one.worktreeAdd(api, 'atlas/login', tree, base)
        const added = yield* one.status(tree)
        yield* one.worktreeRemove(api, tree)
        const kept = (yield* one.branches(api)).branches
        yield* one.worktreeAttach(api, 'atlas/login', tree)
        const attached = yield* one.status(tree)
        rmSync(tree, { recursive: true, force: true })
        yield* one.worktreePrune(api)
        return { added, kept, attached, listed: git(api, 'worktree', 'list') }
      }),
    )
    expect(seen.added.branch).toBe('atlas/login')
    expect(seen.kept).toContain('atlas/login')
    expect(seen.attached.branch).toBe('atlas/login')
    expect(seen.listed).not.toContain('trees')
  })
})

describe('A Workspace’s worktrees are read with the machine’s git', () => {
  test('a detached worktree is at the commit asked, and listed until it is removed', async () => {
    const api = repository(join(folder, 'api'))
    const first = git(api, 'rev-parse', 'HEAD')
    git(api, 'commit', '-q', '--allow-empty', '-m', 'second')
    const tree = join(folder, 'probe', 'api')
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        yield* one.worktreeDetach(api, tree, first)
        const status = yield* one.status(tree)
        const listed = yield* one.worktrees(api)
        yield* one.worktreeRemove(api, tree)
        return { status, listed, after: yield* one.worktrees(api) }
      }),
    )
    expect(seen.status).toEqual({ branch: null, commit: first, dirty: false })
    expect(seen.listed).toHaveLength(2)
    expect(seen.listed.some((path) => path.endsWith('api') && path.includes('probe'))).toBe(true)
    expect(seen.after).toHaveLength(1)
  })

  test('a Probe’s worktree is removed by force, what it holds with it, and pruned', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    const tree = join(folder, 'probes', 'ACME-12', '1', 'api')
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        yield* one.worktreeDetach(api, tree, git(api, 'rev-parse', 'HEAD'))
        writeFileSync(join(tree, 'tracked.txt'), 'two\n')
        writeFileSync(join(tree, 'fixture.csv'), 'name\nÉloïse\n')
        yield* one.worktreeRemoveForced(api, tree)
        yield* one.worktreePrune(api)
        return yield* one.worktrees(api)
      }),
    )
    expect(existsSync(tree)).toBe(false)
    expect(seen).toHaveLength(1)
  })

  test('a worktree’s repository is read by Git, its .git absolute or relative', async () => {
    const api = repository(join(folder, 'api'))
    const absolute = join(folder, 'probes', 'ACME-12', '3', 'api')
    const relative = join(folder, 'probes', 'ACME-12', '4', 'api')
    git(api, 'worktree', 'add', '--quiet', '--detach', absolute, 'HEAD')
    git(api, '-c', 'worktree.useRelativePaths=true', 'worktree', 'add', '-q', '--detach', relative)
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        return [yield* one.repositoryOf(absolute), yield* one.repositoryOf(relative)]
      }),
    )
    expect(readFileSync(join(relative, '.git'), 'utf8')).toMatch(/^gitdir: \.\.\//)
    expect(seen).toEqual([api, api])
  })

  test('a worktree’s new and modified files against its commit, committed or not, ignored ones left out', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    writeFileSync(join(api, '.gitignore'), '*.log\n')
    writeFileSync(join(api, 'gone.txt'), 'gone\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'tracked')
    const commit = git(api, 'rev-parse', 'HEAD')
    const tree = join(folder, 'probes', 'ACME-12', '2', 'api')
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        yield* one.worktreeDetach(api, tree, commit)
        writeFileSync(join(tree, 'tracked.txt'), 'two\n')
        mkdirSync(join(tree, 'tests', 'fixtures'), { recursive: true })
        writeFileSync(join(tree, 'tests', 'fixtures', 'names.csv'), 'name\n')
        writeFileSync(join(tree, 'run.log'), 'ignored\n')
        rmSync(join(tree, 'gone.txt'))
        writeFileSync(join(tree, 'committed.txt'), 'kept\n')
        git(tree, 'add', 'committed.txt')
        git(tree, 'commit', '-q', '-m', 'committed')
        const changes = yield* one.worktreeChanges(tree, commit)
        const patch = yield* one.fileDiff(tree, commit, 'tracked.txt')
        return { changes, patch }
      }),
    )
    expect([...seen.changes].toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'committed.txt', status: 'new' },
      { path: 'tests/fixtures/names.csv', status: 'new' },
      { path: 'tracked.txt', status: 'modified' },
    ])
    expect(seen.patch).toContain('-one')
    expect(seen.patch).toContain('+two')
  })

  test('the files changed are named, tracked and untracked', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    writeFileSync(join(api, 'tracked.txt'), 'two\n')
    writeFileSync(join(api, 'new file.txt'), 'new\n')
    const changed = await asked(Git.use((one) => one.changedFiles(api)))
    expect([...changed].toSorted()).toEqual(['new file.txt', 'tracked.txt'])
  })

  test('ahead and behind are counted against the base commit', async () => {
    const api = repository(join(folder, 'api'))
    const base = git(api, 'rev-parse', 'HEAD')
    git(api, 'commit', '-q', '--allow-empty', '-m', 'mine')
    git(api, 'commit', '-q', '--allow-empty', '-m', 'mine again')
    const counted = await asked(Git.use((one) => one.aheadBehind(api, base)))
    expect(counted).toEqual({ ahead: 2, behind: 0 })
  })
})
