/**
 * The machine's `git`, as the engine asks it (design D8-03, D8-15).
 *
 * Each suite is named after the scenario of the Spec it covers. Every repository is made for the
 * suite under the temporary directory by the machine's own `git`, and removed after it.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'

import { Git, GitError, GitUnavailableError, gitLayer, spawnGit } from '#engine/git.ts'
import type { GitSpawn } from '#engine/git.ts'

import { git, repository } from './repositories.ts'

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-git-'))
})

afterEach(() => {
  // Every test here writes a repository with the machine's `git`, and Windows hands a folder it
  // has just written back a beat late: the retry agent-tools.test.ts uses.
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}, 60_000)

/**
 * A program of the Git service, over the machine's `git`, the program named, or the spawn a suite
 * hands in when one read of it has to fail.
 */
function asked<A, E>(program: Effect.Effect<A, E, Git>, named?: string, spawn?: GitSpawn) {
  return Effect.runPromise(Effect.provide(program, gitLayer(named, spawn)))
}

describe('Each repository shows its branch, commit and changes', () => {
  it('counts one staged, one modified and one untracked file, on the branch and commit', async () => {
    const api = repository(join(folder, 'sources', 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    writeFileSync(join(api, 'tracked.txt'), 'two\n')
    writeFileSync(join(api, 'staged.txt'), 'new\n')
    git(api, 'add', 'staged.txt')
    writeFileSync(join(api, 'untracked.txt'), 'loose\n')

    const status = await asked(Git.use((one) => one.status(api)))

    expect(status).toEqual({
      branch: 'main',
      commit: git(api, 'rev-parse', 'HEAD'),
      staged: 1,
      unstaged: 1,
      untracked: 1,
    })
  })
})

describe('Git state is observed when shown', () => {
  it('reads the status without writing the index, which a worktree being made needs', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    // The file is the same, its time is not: a plain `git status` refreshes the index and writes
    // it, taking `index.lock` — the lock a `git worktree add` under way is refused by.
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(api, 'tracked.txt'), past, past)
    const before = readFileSync(join(api, '.git', 'index'))

    await asked(Git.use((one) => one.status(api)))

    expect(readFileSync(join(api, '.git', 'index')).equals(before)).toBe(true)
  })
})

describe('A Git error is surfaced as is', () => {
  it("answers Git's own message for a worktree whose .git file is broken", async () => {
    // The folder is written by hand rather than taken from a worktree the machine's Git made: Git
    // is still holding the .git file it wrote there, and writing over it is refused on Windows.
    const broken = join(folder, 'broken')
    mkdirSync(broken)
    writeFileSync(join(broken, '.git'), 'gitdir: /nowhere/hemera\n')

    const refused = await asked(Effect.flip(Git.use((one) => one.status(broken))))

    expect(refused).toBeInstanceOf(GitError)
    expect(refused.message).toMatch(/^fatal: /)
  })
})

describe('A missing git is a named refusal', () => {
  it('refuses with the name of the program that is not on the PATH', async () => {
    const api = repository(join(folder, 'api'))
    const refused = await asked(
      Effect.flip(Git.use((one) => one.revParse(api, 'HEAD'))),
      'git-that-does-not-exist-hemera',
    )

    expect(refused).toBeInstanceOf(GitUnavailableError)
    expect(refused.message).toBe('git-that-does-not-exist-hemera was not found on the PATH')
  })
})

describe('A worktree is added, found and removed with the machine’s git', () => {
  it('makes the branch, keeps it after the worktree is removed, and tells a repository apart', async () => {
    const api = repository(join(folder, 'api'))
    const worktree = join(folder, 'login-form', 'api')

    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        const base = yield* one.revParse(api, 'HEAD')
        const before = yield* one.branchExists(api, 'atlas/HEM-7-login-form')
        yield* one.worktreeAdd(api, 'atlas/HEM-7-login-form', worktree, base)
        const added = yield* one.status(worktree)
        const after = yield* one.branchExists(api, 'atlas/HEM-7-login-form')
        const holds = yield* one.isRepository(worktree)
        const plain = yield* one.isRepository(folder)
        yield* one.worktreeRemove(api, worktree)
        const kept = yield* one.branchExists(api, 'atlas/HEM-7-login-form')
        return { base, before, added, after, holds, plain, kept }
      }),
    )

    expect(seen.base).toBe(git(api, 'rev-parse', 'HEAD'))
    expect(seen.before).toBe(false)
    expect(seen.added.branch).toBe('atlas/HEM-7-login-form')
    expect(seen.added.commit).toBe(seen.base)
    expect(seen.after).toBe(true)
    expect(seen.holds).toBe(true)
    expect(seen.plain).toBe(false)
    expect(existsSync(worktree)).toBe(false)
    expect(seen.kept).toBe(true)
  })

  it('refuses a base that does not resolve locally, in the words of Git', async () => {
    const api = repository(join(folder, 'api'))
    const refused = await asked(Effect.flip(Git.use((one) => one.revParse(api, 'a1b2c3'))))

    expect(refused).toBeInstanceOf(GitError)
    expect(refused.message).toMatch(/^fatal: /)
  })
})

describe('A branch name is one Git takes', () => {
  it('takes a name with folders, and refuses a space, a double dot and a trailing slash', async () => {
    const api = repository(join(folder, 'api'))
    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        return yield* Effect.forEach(
          ['atlas/HEM-7-login-form', 'atlas/HEM 7', 'atlas/HEM..7', 'atlas/'],
          (name) => one.checkRefFormat(api, name),
        )
      }),
    )

    expect(seen).toEqual([true, false, false, false])
  })
})

describe('A refused read of HEAD is not a repository without a commit', () => {
  it('keeps Git’s refusal when the first read of a repository with commits fails, once', async () => {
    const api = repository(join(folder, 'api'))
    writeFileSync(join(api, 'tracked.txt'), 'one\n')
    git(api, 'add', 'tracked.txt')
    git(api, 'commit', '-q', '-m', 'tracked')
    // A machine at work: the first read of `HEAD` fails and every read after it answers. The
    // repository has a commit, so a branch stands for it and the failure is a refusal to keep —
    // what the plan reads again and then reports, not a repository to lose (#102).
    let reads = 0
    const once: GitSpawn = (program, cwd, args, limit) => {
      if (!args.includes('--abbrev-ref')) return spawnGit(program, cwd, args, limit)
      reads += 1
      return reads === 1
        ? Effect.fail(new GitError({ args, cwd, stderr: 'fatal: a moment of it, and no more' }))
        : spawnGit(program, cwd, args, limit)
    }

    const refused = await asked(Effect.flip(Git.use((one) => one.head(api))), undefined, once)

    expect(refused).toBeInstanceOf(GitError)
    expect(refused.message).toBe('fatal: a moment of it, and no more')
    // And the read that follows answers what the repository is on: nothing was swallowed.
    const head = await asked(
      Git.use((one) => one.head(api)),
      undefined,
      once,
    )

    expect(head).toEqual({ branch: 'main', commit: git(api, 'rev-parse', 'HEAD'), short: null })
    expect(reads).toBe(2)
  })

  it('answers nothing to start from only where HEAD is on a branch with no ref', async () => {
    const tools = join(folder, 'sources', 'tools')
    mkdirSync(tools, { recursive: true })
    git(tools, 'init', '-q', '-b', 'main')
    const broken = join(folder, 'broken')
    mkdirSync(broken)
    writeFileSync(join(broken, '.git'), 'gitdir: /nowhere/hemera\n')

    const seen = await asked(
      Effect.gen(function* () {
        const one = yield* Git
        return { unborn: yield* one.head(tools), refused: yield* Effect.flip(one.head(broken)) }
      }),
    )

    expect(seen.unborn).toBeNull()
    expect(seen.refused).toBeInstanceOf(GitError)
    expect(seen.refused.message).toMatch(/^fatal: /)
  })
})
