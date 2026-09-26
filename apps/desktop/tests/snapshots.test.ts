/**
 * The snapshots of a build, taken with the machine's own `git` (design D10-05).
 *
 * Each suite is named after the scenario of the Spec it covers, or after what it proves. Every
 * repository is made for the suite under the temporary directory, and removed after it.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect } from 'effect'

import { type ChangedFile, changedFiles, snapshotTree } from '#engine/build/snapshots.ts'
import { type Git, GitError, gitLayer } from '#engine/git.ts'

import { git, repository } from './repositories.ts'

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-snapshots-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** A program of the snapshots, over the machine's `git`. */
function asked<A, E>(program: Effect.Effect<A, E, Git>) {
  return Effect.runPromise(Effect.provide(program, gitLayer()))
}

/** The same, for a program expected to fail: its refusal is the answer. */
function refused<A, E>(program: Effect.Effect<A, E, Git>) {
  return asked(Effect.flip(program))
}

/** The files a tree holds, by path. */
function treeFiles(cwd: string, tree: string): string[] {
  return git(cwd, 'ls-tree', '-r', '--name-only', '-z', tree).split('\0').filter(Boolean)
}

/** A repository with a `.gitignore` and one tracked file, committed on `main`. */
function project(path: string): string {
  repository(path)
  writeFileSync(join(path, '.gitignore'), 'secret.env\nnode_modules/\n')
  writeFileSync(join(path, 'tracked.txt'), 'one\ntwo\nthree\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'tracked')
  return path
}

/**
 * Everything of the user's a snapshot could change, read without writing anything: the index
 * file's bytes first, then what Git says of the log, the branch, the index and the working tree.
 */
function observed(cwd: string, index: string) {
  const bytes = readFileSync(index).toString('base64')
  const quiet = (...args: string[]) => git(cwd, '--no-optional-locks', ...args)
  return {
    bytes,
    log: quiet('log', '--all', '--format=%H %s'),
    head: quiet('symbolic-ref', 'HEAD'),
    commit: quiet('rev-parse', 'HEAD'),
    staged: quiet('diff', '--cached', '--binary'),
    status: quiet('status', '--porcelain'),
    refs: quiet('for-each-ref'),
    reflog: quiet('reflog', '--all'),
  }
}

describe('Snapshots leave the repository untouched', () => {
  it('keeps the log, the branch, the index, the status and the refs, and holds every change', async () => {
    const api = project(join(folder, 'api'))
    writeFileSync(join(api, 'staged.txt'), 'staged\n')
    git(api, 'add', 'staged.txt')
    writeFileSync(join(api, 'tracked.txt'), 'one\ntwo\nthree\nfour\n')
    writeFileSync(join(api, 'untracked.txt'), 'loose\n')
    writeFileSync(join(api, 'secret.env'), 'TOKEN=1\n')
    const index = join(api, '.git', 'index')
    const before = observed(api, index)

    const tree = await asked(snapshotTree(api))

    expect(observed(api, index)).toEqual(before)
    // The tree is the working tree as it stands: staged, unstaged and untracked alike.
    expect(treeFiles(api, tree)).toEqual([
      '.gitignore',
      'staged.txt',
      'tracked.txt',
      'untracked.txt',
    ])
    expect(git(api, 'show', `${tree}:tracked.txt`)).toBe('one\ntwo\nthree\nfour')
    expect(git(api, 'cat-file', '-t', tree)).toBe('tree')
  })
})

describe('Two snapshots around a change give exactly its files', () => {
  it('names each file with its status and line counts, and none for a binary', async () => {
    const api = project(join(folder, 'api'))
    writeFileSync(join(api, 'gone.txt'), 'soon gone\n')
    const moved = Array.from({ length: 10 }, (_, line) => `line ${String(line)}`).join('\n')
    writeFileSync(join(api, 'before.txt'), `${moved}\n`)
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'more')

    const files = await asked(
      Effect.gen(function* () {
        const start = yield* snapshotTree(api)
        writeFileSync(join(api, 'tracked.txt'), 'one\n2\nthree\nfour\nfive\n')
        writeFileSync(join(api, 'added.txt'), 'new\n')
        rmSync(join(api, 'gone.txt'))
        rmSync(join(api, 'before.txt'))
        writeFileSync(join(api, 'after.txt'), `${moved}\n`)
        writeFileSync(join(api, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]))
        const end = yield* snapshotTree(api)
        return yield* changedFiles(api, start, end)
      }),
    )

    const byPath = (one: ChangedFile, other: ChangedFile) => one.path.localeCompare(other.path)
    expect([...files].sort(byPath)).toEqual([
      { path: 'added.txt', status: 'A', added: 1, removed: 0 },
      { path: 'after.txt', status: 'R', added: 0, removed: 0 },
      { path: 'gone.txt', status: 'D', added: 0, removed: 1 },
      { path: 'logo.png', status: 'A', added: null, removed: null },
      { path: 'tracked.txt', status: 'M', added: 3, removed: 1 },
    ])
  })

  it('finds nothing between two snapshots of a repository nothing changed in', async () => {
    const api = project(join(folder, 'api'))
    writeFileSync(join(api, 'untracked.txt'), 'loose\n')

    const seen = await asked(
      Effect.gen(function* () {
        const start = yield* snapshotTree(api)
        const end = yield* snapshotTree(api)
        return { same: start === end, files: yield* changedFiles(api, start, end) }
      }),
    )

    expect(seen).toEqual({ same: true, files: [] })
  })
})

describe('An ignored file never appears in a snapshot', () => {
  it('leaves an ignored file and an ignored folder out of the tree and of the diff', async () => {
    const api = project(join(folder, 'api'))

    const seen = await asked(
      Effect.gen(function* () {
        const start = yield* snapshotTree(api)
        writeFileSync(join(api, 'secret.env'), 'TOKEN=1\n')
        mkdirSync(join(api, 'node_modules', 'left-pad'), { recursive: true })
        writeFileSync(join(api, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1\n')
        writeFileSync(join(api, 'kept.txt'), 'kept\n')
        const end = yield* snapshotTree(api)
        return { tree: end, files: yield* changedFiles(api, start, end) }
      }),
    )

    expect(treeFiles(api, seen.tree)).toEqual(['.gitignore', 'kept.txt', 'tracked.txt'])
    expect(seen.files).toEqual([{ path: 'kept.txt', status: 'A', added: 1, removed: 0 }])
  })
})

describe('A linked worktree is snapshotted through its own index', () => {
  it('keeps what only the worktree’s index says, and writes neither index', async () => {
    const api = project(join(folder, 'api'))
    const worktree = join(folder, 'login-form')
    git(api, 'worktree', 'add', '-q', '-b', 'login-form', worktree)
    // What only the worktree's own index knows: a file it does not check out. Snapshotted
    // through the main repository's index instead, it would be recorded as deleted.
    git(worktree, 'update-index', '--skip-worktree', 'tracked.txt')
    rmSync(join(worktree, 'tracked.txt'))
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')
    const own = git(worktree, 'rev-parse', '--git-path', 'index')
    const main = join(api, '.git', 'index')
    const before = { worktree: observed(worktree, own), main: observed(api, main) }

    const tree = await asked(snapshotTree(worktree))

    expect(treeFiles(worktree, tree)).toEqual(['.gitignore', 'form.txt', 'tracked.txt'])
    expect({ worktree: observed(worktree, own), main: observed(api, main) }).toEqual(before)
  })
})

describe('A repository with no commit and no index yet is snapshotted', () => {
  it('writes the tree of its files, and leaves it with no index, no commit and no ref', async () => {
    const fresh = join(folder, 'fresh')
    mkdirSync(fresh)
    git(fresh, 'init', '-q', '-b', 'main')
    writeFileSync(join(fresh, 'first.txt'), 'first\n')

    const seen = await asked(
      Effect.gen(function* () {
        const tree = yield* snapshotTree(fresh)
        return { tree, files: yield* changedFiles(fresh, EMPTY_TREE, tree) }
      }),
    )

    expect(treeFiles(fresh, seen.tree)).toEqual(['first.txt'])
    expect(seen.files).toEqual([{ path: 'first.txt', status: 'A', added: 1, removed: 0 }])
    expect(existsSync(join(fresh, '.git', 'index'))).toBe(false)
    expect(git(fresh, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main')
    expect(git(fresh, 'for-each-ref')).toBe('')
  })
})

/** The tree of nothing, which every Git knows by this id. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

describe('Paths are handed to Git as they are', () => {
  it('snapshots a folder and files whose names a shell would split or expand', async () => {
    const odd = project(join(folder, 'my repo (atlas) $HOME & co'))
    const names = ['a file with spaces.txt', 'été & co.md', "it's; $PATH.txt"]

    const files = await asked(
      Effect.gen(function* () {
        const start = yield* snapshotTree(odd)
        for (const name of names) writeFileSync(join(odd, name), `${name}\n`)
        const end = yield* snapshotTree(odd)
        return yield* changedFiles(odd, start, end)
      }),
    )

    expect(files.map((file) => file.path).sort()).toEqual([...names].sort())
    expect(files.every((file) => file.status === 'A' && file.added === 1)).toBe(true)
  })
})

describe('A refused snapshot leaves nothing behind', () => {
  it('answers Git’s refusal of a broken index, removes its folder and leaves the index as it was', async () => {
    const api = project(join(folder, 'api'))
    const index = join(api, '.git', 'index')
    writeFileSync(index, 'not an index')
    // The temporary directory is this suite's own for the time of the snapshot, so what is left
    // in it is what the snapshot left.
    const temporary = join(folder, 'temporary')
    mkdirSync(temporary)
    const previous = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }
    Object.assign(process.env, { TMPDIR: temporary, TMP: temporary, TEMP: temporary })

    try {
      const refusal = await refused(snapshotTree(api))

      expect(refusal).toBeInstanceOf(GitError)
      expect(refusal.message).toMatch(/index/)
      expect(readdirSync(temporary)).toEqual([])
      expect(readFileSync(index, 'utf8')).toBe('not an index')
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('answers Git’s refusal of a folder that is not a repository', async () => {
    const plain = join(folder, 'plain')
    mkdirSync(plain)

    const refusal = await refused(snapshotTree(plain))

    expect(refusal).toBeInstanceOf(GitError)
    expect(refusal.message).toMatch(/^fatal: /)
  })
})
