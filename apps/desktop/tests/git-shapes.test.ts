/**
 * What shapes the engine's own Git in a checkout (#457): the files read, what is kept of each, the
 * includes followed, the rules of reading (no link as a last name, no pipe waited on, a cap), the
 * changes between two fingerprints, and what a fingerprint costs.
 *
 * Every repository is made for the test under the temporary directory by the machine's own `git`;
 * the home folder is a temporary one too, never the user's.
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  type BigIntStats,
  chmodSync,
  lstatSync,
  readdirSync,
  renameSync,
  readFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  SHAPE_CAP,
  type ShapeHome,
  type ShapeStat,
  type StatOf,
  includesOf,
  shapeChanges,
  shapesOf,
} from '../src/engine/git-shapes.ts'
import { readOwnSync } from '../src/engine/tools/judged.ts'
import { git, repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let work: string
let home: ShapeHome

beforeEach(() => {
  work = realpathSync.native(temporaryFolder('git-shapes'))
  const folder = join(work, 'home')
  mkdirSync(folder)
  home = { home: folder, configHome: join(folder, '.config') }
})
afterEach(removeFolders)

const paths = (checkouts: ReadonlyArray<string>) => [...shapesOf(checkouts, home).keys()]

describe('What shapes the engine’s Git in a checkout is fingerprinted (#457)', () => {
  test('the configs, every worktree’s config.worktree, commondir and gitdir, the hooks, info/attributes and info/exclude, and the home configs', () => {
    const main = repository(join(work, 'acme'))
    git(main, 'worktree', 'add', '-q', join(work, 'acme-wt'), '-b', 'side')
    const common = join(main, '.git')
    writeFileSync(join(common, 'config.worktree'), '[core]\n')
    writeFileSync(join(common, 'worktrees', 'acme-wt', 'config.worktree'), '[core]\n')
    mkdirSync(join(common, 'info'), { recursive: true })
    writeFileSync(join(common, 'info', 'attributes'), '*.bin binary\n')
    writeFileSync(join(common, 'info', 'exclude'), 'dist\n')
    writeFileSync(join(common, 'hooks', 'pre-commit'), '#!/bin/sh\n')
    writeFileSync(join(home.home, '.gitconfig'), '[user]\n\tname = t\n')
    mkdirSync(join(home.configHome, 'git'), { recursive: true })
    writeFileSync(join(home.configHome, 'git', 'config'), '[core]\n')
    writeFileSync(join(home.configHome, 'git', 'attributes'), '*.md text\n')

    const seen = paths([join(work, 'acme-wt')])

    expect(seen).toEqual(
      expect.arrayContaining([
        join(work, 'acme-wt', '.git'),
        join(common, 'config'),
        join(common, 'config.worktree'),
        join(common, 'worktrees', 'acme-wt', 'config.worktree'),
        join(common, 'worktrees', 'acme-wt', 'commondir'),
        join(common, 'worktrees', 'acme-wt', 'gitdir'),
        join(common, 'hooks', 'pre-commit'),
        join(common, 'info', 'attributes'),
        join(common, 'info', 'exclude'),
        join(home.home, '.gitconfig'),
        join(home.configHome, 'git', 'config'),
        join(home.configHome, 'git', 'attributes'),
      ]),
    )
    // What the engine's own Git writes is never part of it.
    for (const own of ['index', 'HEAD', 'ORIG_HEAD', 'FETCH_HEAD', 'packed-refs', 'logs', 'refs']) {
      expect(seen.some((path) => path.startsWith(join(common, own)))).toBe(false)
    }
  })

  test('the main checkout reaches the same repository: its config and its worktrees’ files', () => {
    const main = repository(join(work, 'acme'))
    git(main, 'worktree', 'add', '-q', join(work, 'acme-wt'), '-b', 'side')
    const seen = paths([main])
    expect(seen).toEqual(
      expect.arrayContaining([
        join(main, '.git', 'config'),
        join(main, '.git', 'worktrees', 'acme-wt', 'gitdir'),
        join(work, 'acme-wt', '.git'),
      ]),
    )
  })

  test('a file an include.path or an includeIf names is followed, relative to its file or under ~, and a loop ends', () => {
    const main = repository(join(work, 'acme'))
    writeFileSync(
      join(main, '.git', 'config'),
      '[include]\n\tpath = ../shared.gitconfig\n[includeIf "gitdir:**"]\n\tpath = ~/more.gitconfig\n',
    )
    writeFileSync(join(main, 'shared.gitconfig'), '[include]\n\tpath = deeper.gitconfig\n')
    writeFileSync(join(main, 'deeper.gitconfig'), '[include]\n\tpath = shared.gitconfig\n')
    writeFileSync(join(home.home, 'more.gitconfig'), '[core]\n')
    const seen = paths([main])
    expect(seen).toEqual(
      expect.arrayContaining([
        join(main, 'shared.gitconfig'),
        join(main, 'deeper.gitconfig'),
        join(home.home, 'more.gitconfig'),
      ]),
    )
  })

  test('a link is fingerprinted by where it leads, its content hashed and never kept as text', () => {
    const main = repository(join(work, 'acme'))
    writeFileSync(join(work, 'real.gitconfig'), '[core]\n\thooksPath = h\n')
    symlinkSync(join(work, 'real.gitconfig'), join(home.home, '.gitconfig'))
    const before = shapesOf([main], home)
    const shape = before.get(join(home.home, '.gitconfig'))
    expect(shape?.kind).toBe('link')
    expect(shape?.text).toBeNull()
    writeFileSync(join(work, 'real.gitconfig'), '[core]\n\thooksPath = elsewhere\n')
    const after = shapesOf([main], home)
    expect(shapeChanges(before, after).map((one) => one.path)).toEqual([
      join(home.home, '.gitconfig'),
    ])
  })

  test.skipIf(process.platform === 'win32')(
    'a pipe in place of the config is never waited on: it is fingerprinted as not a file',
    () => {
      const main = repository(join(work, 'acme'))
      rmSync(join(main, '.git', 'config'))
      execFileSync('mkfifo', [join(main, '.git', 'config')])
      const shape = shapesOf([main], home).get(join(main, '.git', 'config'))
      expect(shape?.kind).toBe('other')
    },
  )

  test('a file over the cap is fingerprinted by its size and times, never read whole', () => {
    const main = repository(join(work, 'acme'))
    writeFileSync(join(main, '.git', 'config'), Buffer.alloc(SHAPE_CAP + 1, 0x20))
    const shape = shapesOf([main], home).get(join(main, '.git', 'config'))
    expect(shape?.kind).toBe('over')
    expect(shape?.text).toBeNull()
  })

  test.skipIf(process.platform === 'win32')('a hook’s mode is part of it', () => {
    const main = repository(join(work, 'acme'))
    const hook = join(main, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\n')
    chmodSync(hook, 0o644)
    const before = shapesOf([main], home)
    chmodSync(hook, 0o755)
    expect(shapeChanges(before, shapesOf([main], home)).map((one) => one.path)).toEqual([hook])
  })
})

/** Adds a submodule, cloned from a repository on the same disk, and commits it. */
const submodule = (main: string, from: string, path: string) => {
  git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', from, path)
  git(
    main,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'update',
    '-q',
    '--init',
    '--recursive',
  )
  git(main, 'commit', '-q', '-m', path)
}

/** A repository with a submodule of its own, `deep`. */
const withDeep = (path: string) => {
  const outer = repository(path)
  submodule(outer, repository(join(work, 'deep')), 'deep')
  return outer
}

describe('A submodule’s own Git folder is part of what shapes Git (#470)', () => {
  test('a submodule’s Git folder under .git/modules, and one nested in it: its config, its hooks, its info, and the .git file of each checkout', () => {
    const main = repository(join(work, 'acme'))
    submodule(main, withDeep(join(work, 'shared')), 'shared')
    const modules = join(main, '.git', 'modules')
    const seen = paths([main])
    expect(seen).toEqual(
      expect.arrayContaining([
        join(modules, 'shared', 'config'),
        join(modules, 'shared', 'hooks', 'pre-commit.sample'),
        join(modules, 'shared', 'info', 'exclude'),
        join(modules, 'shared', 'modules', 'deep', 'config'),
        join(main, 'shared', '.git'),
        join(main, 'shared', 'deep', '.git'),
      ]),
    )
  })

  test('a submodule’s Git folder that is a link (a junction on Windows) to a folder outside is read where it leads', () => {
    const main = repository(join(work, 'acme'))
    submodule(main, repository(join(work, 'shared')), 'shared')
    const outside = join(work, 'kept')
    renameSync(join(main, '.git', 'modules', 'shared'), outside)
    symlinkSync(
      outside,
      join(main, '.git', 'modules', 'shared'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(paths([main])).toEqual(
      expect.arrayContaining([
        join(outside, 'config'),
        join(outside, 'hooks', 'pre-commit.sample'),
      ]),
    )
  })

  test('a submodule’s Git folder whose checkout is not there (not initialised) is still read', () => {
    const main = repository(join(work, 'acme'))
    submodule(main, repository(join(work, 'shared')), 'shared')
    git(main, 'submodule', 'deinit', '-q', '-f', 'shared')
    expect(paths([main])).toContain(join(main, '.git', 'modules', 'shared', 'config'))
  })

  test.each([
    ['version 2', [], false],
    [
      'version 3, an entry with extended flags before it',
      ['update-index', '--index-version', '3'],
      true,
    ],
    [
      'version 4, an entry with extended flags before it',
      ['update-index', '--index-version', '4'],
      true,
    ],
    ['a split index', ['update-index', '--split-index'], false],
  ])(
    'a repository the index holds as a submodule, its .git folder inside the checkout, is read: an index of %s',
    (_, args, extended) => {
      const main = repository(join(work, 'acme'))
      writeFileSync(join(main, 'a.txt'), 'a\n')
      repository(join(main, 'vendor'))
      // An entry added with --intent-to-add carries extended flags: two bytes more before its name.
      git(main, 'add', ...(extended ? ['--intent-to-add'] : []), 'a.txt')
      git(main, 'add', 'vendor')
      if (args.length > 0) git(main, ...args)
      // Another entry after it, so a split index keeps the submodule in its shared part.
      writeFileSync(join(main, 'b.txt'), 'b\n')
      git(main, 'add', 'b.txt')
      expect(paths([main])).toEqual(
        expect.arrayContaining([
          join(main, 'vendor', '.git', 'config'),
          join(main, 'vendor', '.git', 'hooks', 'pre-commit.sample'),
        ]),
      )
    },
  )

  test('a repository whose objects are named by sha256 has its submodules read from its index', () => {
    const main = join(work, 'acme')
    mkdirSync(main)
    git(main, 'init', '-q', '--object-format=sha256', '-b', 'trunk')
    const vendor = join(main, 'vendor')
    mkdirSync(vendor)
    git(vendor, 'init', '-q', '--object-format=sha256', '-b', 'trunk')
    git(vendor, 'commit', '-q', '--allow-empty', '-m', 'base')
    git(main, 'add', 'vendor')
    expect(paths([main])).toContain(join(vendor, '.git', 'config'))
  })
})

describe('An index that cannot be read for its submodules is said, never read as naming none (#474)', () => {
  /** Acme with a file and an embedded repository in its index, and the path of that index. */
  const indexed = () => {
    const main = repository(join(work, 'acme'))
    writeFileSync(join(main, 'a.txt'), 'a\n')
    repository(join(main, 'vendor'))
    git(main, 'add', 'a.txt', 'vendor')
    return { main, index: join(main, '.git', 'index') }
  }

  /** Every path's stat as it is, but the index's, changed by `as`. */
  const statsWith =
    (index: string, as: (real: BigIntStats) => Partial<ShapeStat>) =>
    (path: string): ShapeStat => {
      const real = lstatSync(path, { bigint: true })
      const stat: ShapeStat = {
        isSymbolicLink: () => real.isSymbolicLink(),
        isDirectory: () => real.isDirectory(),
        isFile: () => real.isFile(),
        size: real.size,
        ino: real.ino,
        dev: real.dev,
        mode: real.mode,
        mtimeNs: real.mtimeNs,
        ctimeNs: real.ctimeNs,
      }
      return path === index ? { ...stat, ...as(real) } : stat
    }

  /** What the fingerprint says of the index: present only when it could not be read. */
  const saidOf = (main: string, statOf?: StatOf) =>
    shapesOf([main], home, [], statOf).get(join(main, '.git', 'index'))

  test('an index past the read cap (about 600,000 files) is said, its stat alone read', () => {
    const { main, index } = indexed()
    const said = saidOf(
      main,
      statsWith(index, () => ({ size: 64n * 1024n * 1024n + 1n })),
    )
    expect(said?.kind).toBe('other')
    expect(said?.text).toContain('larger than')
  })

  test('a linked index is said, and the index it leads to is read for its submodules, as Git follows it (#500)', () => {
    const { main, index } = indexed()
    renameSync(index, join(work, 'index'))
    symlinkSync(join(work, 'index'), index)
    expect(saidOf(main)?.text).toContain('a link')
    expect(paths([main])).toContain(join(main, 'vendor', '.git', 'config'))
  })

  test('a linked index leading to one it cannot read is said apart from one it reads (#500)', () => {
    const { main, index } = indexed()
    renameSync(index, join(work, 'index'))
    symlinkSync(join(work, 'index'), index)
    const read = saidOf(main)
    writeFileSync(join(work, 'index'), 'not an index\n')
    const unread = saidOf(main)
    expect(unread?.text).toContain('does not know')
    expect(unread?.digest).not.toBe(read?.digest)
    expect(paths([main])).not.toContain(join(main, 'vendor', '.git', 'config'))
  })

  test.each([
    ['cut in half', (bytes: Buffer) => bytes.subarray(0, Math.floor(bytes.length / 2))],
    ['empty', () => Buffer.alloc(0)],
    [
      'of an unknown version',
      (bytes: Buffer) =>
        Buffer.concat([bytes.subarray(0, 4), Buffer.from([0, 0, 0, 9]), bytes.subarray(8)]),
    ],
    ['not an index at all', () => Buffer.from('not an index\n')],
  ])('an index %s is said', (_, written) => {
    const { main, index } = indexed()
    writeFileSync(index, written(readFileSync(index)))
    expect(saidOf(main)?.text).toContain('does not know')
  })

  test('a split index whose shared part is gone is said', () => {
    const { main } = indexed()
    git(main, 'update-index', '--split-index')
    for (const name of readdirSync(join(main, '.git'))) {
      if (name.startsWith('sharedindex.')) rmSync(join(main, '.git', name))
    }
    expect(saidOf(main)?.text).toContain('shared')
  })

  test('a folder in place of the index is said', () => {
    const { main, index } = indexed()
    rmSync(index)
    mkdirSync(index)
    expect(saidOf(main)?.text).toContain('not a regular file, never opened')
  })

  test.skipIf(process.platform === 'win32')(
    'a pipe in place of the index is said, never waited on',
    () => {
      const { main, index } = indexed()
      rmSync(index)
      execFileSync('mkfifo', [index])
      expect(saidOf(main)?.text).toContain('not a regular file, never opened')
    },
  )

  test('a locked index, its stat refused (a sharing violation on Windows), is said', () => {
    const { main, index } = indexed()
    const locked: StatOf = (path) => {
      if (path === index) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
      return lstatSync(path, { bigint: true })
    }
    expect(saidOf(main, locked)?.text).toContain('EBUSY')
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'a read of the index that failed once (its access refused, as a lock would) is tried again at the next fingerprint, its stat unchanged (#500)',
    () => {
      const { main, index } = indexed()
      // The index's stat as it stood seconds ago, the same at every fingerprint: settled.
      const real = lstatSync(index, { bigint: true })
      const frozen = statsWith(index, () => ({
        mode: real.mode,
        mtimeNs: real.mtimeNs - 10_000_000_000n,
        ctimeNs: real.ctimeNs - 10_000_000_000n,
      }))
      chmodSync(index, 0o000)
      const locked = saidOf(main, frozen)
      chmodSync(index, 0o644)
      expect(locked?.text).toContain('EACCES')
      expect(saidOf(main, frozen)).toBeUndefined()
    },
  )

  /**
   * Every path's stat as it is, but the index's: `breaks` times, right after its stat is taken for
   * a read, a folder is put in its place, so the read that follows fails; at the next stat, Git's
   * new index is renamed over it, written whole beside it (a new stat). `stats` counts the index's.
   */
  const replacing = (index: string, breaks: number) => {
    const fresh = readFileSync(index)
    const seen = { stats: 0, breaks }
    const statOf: StatOf = (path) => {
      if (path !== index) return lstatSync(path, { bigint: true })
      seen.stats += 1
      const broken = lstatSync(index).isDirectory()
      if (broken) {
        rmSync(index, { recursive: true })
        writeFileSync(`${index}.lock`, fresh)
        renameSync(`${index}.lock`, index)
      }
      const stat = lstatSync(index, { bigint: true })
      if (!broken && seen.breaks > 0) {
        seen.breaks -= 1
        rmSync(index)
        mkdirSync(index)
      }
      return stat
    }
    return { seen, statOf }
  }

  /** Acme's index as is, or as a link to one outside: the index, and the file read for it. */
  const indexes = [
    ['an index', () => ({ ...indexed(), linked: false })],
    [
      'a linked index',
      () => {
        const { main, index } = indexed()
        const target = join(work, 'index')
        renameSync(index, target)
        symlinkSync(target, index)
        return { main, index: target, linked: true }
      },
    ],
  ] as const

  describe.each(indexes)('%s Git replaces while it is read (#533)', (_, made) => {
    test.each([1, 3])(
      'replaced at %i reads in a row, it is read again, its stat taken once after each failure, and not said',
      (breaks) => {
        const { main, index, linked } = made()
        const { seen, statOf } = replacing(index, breaks)
        const shapes = shapesOf([main], home, [], statOf)
        expect(seen.breaks).toBe(0)
        // A stat before each read, and one after each failure: the recheck is taken once per failure.
        expect(seen.stats).toBe(1 + 2 * breaks)
        const said = shapes.get(join(main, '.git', 'index'))
        if (linked) expect(said?.text).toContain('This index is a link')
        else expect(said).toBeUndefined()
        expect([...shapes.keys()]).toContain(join(main, 'vendor', '.git', 'config'))
      },
    )

    test('replaced at every read, it is read four times, then said: the rereads end', () => {
      const { main, index } = made()
      const { seen, statOf } = replacing(index, Number.POSITIVE_INFINITY)
      const shapes = shapesOf([main], home, [], statOf)
      // Four reads, each after its stat, and one stat after each failure but the last.
      expect(seen.stats).toBe(7)
      expect(shapes.get(join(main, '.git', 'index'))?.text).toContain('could not read this index')
      expect([...shapes.keys()]).not.toContain(join(main, 'vendor', '.git', 'config'))
    })

    test('failing to read at a stat that stays the same, it is said, read once', () => {
      const { main, index } = made()
      writeFileSync(index, 'not an index\n')
      let stats = 0
      const counted: StatOf = (path) => {
        if (path === index) stats += 1
        return lstatSync(path, { bigint: true })
      }
      expect(saidOf(main, counted)?.text).toContain('does not know')
      expect(stats).toBe(2)
    })
  })

  test('a split index whose shared part Git prunes while it rewrites the index is read again, not said (#538)', () => {
    const { main, index } = indexed()
    git(main, 'update-index', '--split-index')
    const shared = readdirSync(join(main, '.git')).filter((name) => name.startsWith('sharedindex.'))
    const kept = shared.map(
      (name) => [join(main, '.git', name), readFileSync(join(main, '.git', name))] as const,
    )
    const fresh = readFileSync(index)
    let stats = 0
    // Right after the index's first stat, its shared part is pruned, so the read that follows
    // fails there; at the next stat, Git's new index is renamed over it, its shared part written.
    const pruning: StatOf = (path) => {
      if (path !== index) return lstatSync(path, { bigint: true })
      stats += 1
      if (stats === 2) {
        for (const [named, bytes] of kept) writeFileSync(named, bytes)
        writeFileSync(`${index}.lock`, fresh)
        renameSync(`${index}.lock`, index)
      }
      const stat = lstatSync(index, { bigint: true })
      if (stats === 1) for (const [named] of kept) rmSync(named)
      return stat
    }
    const shapes = shapesOf([main], home, [], pruning)
    expect(shapes.get(index)).toBeUndefined()
    expect([...shapes.keys()]).toContain(join(main, 'vendor', '.git', 'config'))
    expect(stats).toBe(3)
  })

  test('an index Git removes after a read that failed is read again: none, as Git reads no index (#533)', () => {
    const { main, index } = indexed()
    let stats = 0
    const removing: StatOf = (path) => {
      if (path !== index) return lstatSync(path, { bigint: true })
      stats += 1
      if (stats === 2) rmSync(index, { recursive: true })
      const stat = lstatSync(index, { bigint: true })
      if (stats === 1) {
        rmSync(index)
        mkdirSync(index)
      }
      return stat
    }
    expect(saidOf(main, removing)).toBeUndefined()
    expect(stats).toBe(3)
  })

  test('an unreadable index is said the same way each time, so it asks once', () => {
    const { main, index } = indexed()
    writeFileSync(index, 'not an index\n')
    const before = shapesOf([main], home)
    writeFileSync(index, 'still not an index, longer\n')
    expect(shapeChanges(before, shapesOf([main], home))).toEqual([])
  })

  test('an index that reads, or none at all as in a repository just made, is not said: Git reads no submodule from a missing one', () => {
    const { main } = indexed()
    expect(saidOf(main)).toBeUndefined()
    const made = join(work, 'made')
    mkdirSync(made)
    git(made, 'init', '-q')
    expect(saidOf(made)).toBeUndefined()
  })
})

/**
 * A measure, not a test (#538, removed before merge): while another process renames a new index
 * over the one read, as Git does, how often a read fails, and whether the index's stat has changed
 * by the time the failure is seen. It never fails the suite; its line `PROBE538` is read on CI.
 */
describe('Probe: an index read while another process renames over it (#538)', () => {
  const RENAMER = `
    const { writeFileSync, renameSync, readFileSync } = require('node:fs')
    const { spawnSync } = require('node:child_process')
    const [index, mode, ms] = process.argv.slice(1)
    const bytes = readFileSync(index)
    const until = Date.now() + Number(ms)
    let renames = 0
    process.stdout.write('ready\\n')
    while (Date.now() < until) {
      if (mode === 'git') spawnSync('git', ['update-index', '--force-write-index'], { cwd: require('node:path').dirname(require('node:path').dirname(index)) })
      else { writeFileSync(index + '.lock', bytes); renameSync(index + '.lock', index) }
      renames += 1
    }
    process.stdout.write('renames ' + renames + '\\n')
  `
  const keyOf = (path: string): string | null => {
    try {
      const stat = lstatSync(path, { bigint: true })
      return [stat.size, stat.mtimeNs, stat.ctimeNs, stat.ino, stat.dev, stat.mode].join(':')
    } catch (cause) {
      return `error:${cause instanceof Error && 'code' in cause ? String(cause.code) : '?'}`
    }
  }

  test.each(['node', 'git'])(
    'renamed over by %s',
    async (mode) => {
      const main = repository(join(work, 'acme'))
      writeFileSync(join(main, 'a.txt'), 'a\n')
      git(main, 'add', 'a.txt')
      const index = join(main, '.git', 'index')
      const ms = 4000
      const child = spawn(process.execPath, ['-e', RENAMER, index, mode, String(ms)])
      let out = ''
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      await new Promise<void>((done) => {
        const ready = () => (out.includes('ready') ? done() : setTimeout(ready, 5))
        ready()
      })
      const tally = {
        platform: process.platform,
        mode,
        reads: 0,
        changed: 0,
        statError: 0,
        unchanged: 0,
        /** For an unchanged recheck: how long until the stat changed, by bucket. */
        laterChange: { under1ms: 0, under10ms: 0, under100ms: 0, never: 0 },
        maxLaterMs: 0,
        /** For an unchanged recheck: whether reading again at once succeeded. */
        readAgainOk: 0,
        readAgainFailed: 0,
      }
      const failures = new Map<string, number>()
      const end = Date.now() + ms
      while (Date.now() < end) {
        const before = keyOf(index)
        tally.reads += 1
        try {
          readOwnSync(index, 64 * 1024 * 1024)
          continue
        } catch (cause) {
          const code =
            cause instanceof Error && 'code' in cause ? String(cause.code) : String(cause)
          failures.set(code, (failures.get(code) ?? 0) + 1)
        }
        const recheck = keyOf(index)
        if (recheck?.startsWith('error:') === true) tally.statError += 1
        else if (recheck !== before) tally.changed += 1
        else {
          tally.unchanged += 1
          try {
            readOwnSync(index, 64 * 1024 * 1024)
            tally.readAgainOk += 1
          } catch {
            tally.readAgainFailed += 1
          }
          const from = performance.now()
          let waited = -1
          while (performance.now() - from < 100) {
            if (keyOf(index) !== before) {
              waited = performance.now() - from
              break
            }
          }
          if (waited < 0) tally.laterChange.never += 1
          else if (waited < 1) tally.laterChange.under1ms += 1
          else if (waited < 10) tally.laterChange.under10ms += 1
          else tally.laterChange.under100ms += 1
          tally.maxLaterMs = Math.max(tally.maxLaterMs, waited)
        }
      }
      await new Promise((done) => {
        if (child.exitCode !== null) done(null)
        else child.on('exit', done)
      })
      // oxlint-disable-next-line no-console
      console.log(
        `PROBE538 ${JSON.stringify({ ...tally, failures: Object.fromEntries(failures), child: out.trim().split('\n').at(-1) })}`,
      )
    },
    60_000,
  )
})

describe('Two fingerprints compare by their net change (#457)', () => {
  test('a file changed then put back is no change; one added, one removed and one changed are each said', () => {
    const main = repository(join(work, 'acme'))
    const config = join(main, '.git', 'config')
    const hooks = join(main, '.git', 'hooks')
    writeFileSync(join(hooks, 'gone'), 'x')
    const before = shapesOf([main], home)
    writeFileSync(join(hooks, 'post-merge'), 'y')
    rmSync(join(hooks, 'gone'))
    git(main, 'config', 'core.hooksPath', 'h')
    git(main, 'config', 'core.hooksPath', 'i')
    writeFileSync(join(main, '.git', 'info-unrelated'), 'z')
    const after = shapesOf([main], home)
    expect(
      shapeChanges(before, after).map((one) => [one.path, one.was === null, one.now === null]),
    ).toEqual([
      [config, false, false],
      [join(hooks, 'gone'), false, true],
      [join(hooks, 'post-merge'), true, false],
    ])
    git(main, 'config', '--unset', 'core.hooksPath')
    writeFileSync(join(hooks, 'gone'), 'x')
    rmSync(join(hooks, 'post-merge'))
    expect(shapeChanges(before, shapesOf([main], home))).toEqual([])
  })
})

describe('The includes of a Git configuration are read as Git reads them (#457)', () => {
  test.each([
    ['[include]\n\tpath = a', ['a']],
    ['[Include]\n\tPATH = "b c"', ['b c']],
    ['[includeIf "gitdir:~/x/"]\npath = d', ['d']],
    ['[include] path = e', ['e']],
    ['[include]\n path = f # a comment\n path = g ; another', ['f', 'g']],
    ['[include]\n path = "h\\"i"', ['h"i']],
    ['[include]\n path = j\\\nk', ['jk']],
    ['[core]\n path = no\n[include "x"]\n path = no', []],
    ['[core] ; [include]\n path = no', []],
    ['[include]\n path', []],
    [
      '[includeIf "onbranch:main"]\n\tpath = l\n[INCLUDEIF "hasconfig:remote.*.url:x"]\n\tpath = m',
      ['l', 'm'],
    ],
  ])('%j names %j', (text, named) => {
    expect(includesOf(text)).toEqual(named)
  })
})

/**
 * Every file's times pinned long ago, as a tool that sets them back leaves them: Linux cannot set a
 * ctime back, NTFS can set its ChangeTime.
 */
const restored: StatOf = (path) => {
  const real = lstatSync(path, { bigint: true })
  return {
    isSymbolicLink: () => real.isSymbolicLink(),
    isDirectory: () => real.isDirectory(),
    isFile: () => real.isFile(),
    size: real.size,
    ino: real.ino,
    dev: real.dev,
    mode: real.mode,
    mtimeNs: 1n,
    ctimeNs: 1n,
  }
}

describe('What a fingerprint costs (#457)', () => {
  test('it grows with the hooks and the config’s size, not faster: 10,000 hooks and a 1 MiB config', () => {
    const timed = (hooks: number, configBytes: number) => {
      const main = repository(join(work, `acme-${String(hooks)}`))
      const folder = join(main, '.git', 'hooks')
      for (let at = 0; at < hooks; at += 1) {
        writeFileSync(join(folder, `hook-${String(at)}`), `#!/bin/sh\necho ${String(at)}\n`)
      }
      const line = '\tname = value\n'
      writeFileSync(
        join(main, '.git', 'config'),
        `[core]\n${line.repeat(Math.ceil(configBytes / line.length))}`,
      )
      shapesOf([main], home)
      const began = performance.now()
      shapesOf([main], home)
      return performance.now() - began
    }
    const small = timed(1_000, 100 * 1024)
    const large = timed(10_000, 1024 * 1024)
    // Ten times as much to read: linear is about ten times as long. A margin for a loaded machine.
    expect(large / small).toBeLessThan(30)
  }, 120_000)

  test('a file rewritten in the same second at the same size is hashed again, not trusted on its stat', () => {
    const main = repository(join(work, 'acme'))
    const hook = join(main, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nexit 0\n')
    const before = shapesOf([main], home).get(hook)
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    expect(shapesOf([main], home).get(hook)?.digest).not.toBe(before?.digest)
  })

  test('a config rewritten with every stat field restored is still seen: only a hooks folder trusts its stat', () => {
    const main = repository(join(work, 'acme'))
    const config = join(main, '.git', 'config')
    const hook = join(main, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\nexit 0\n')
    const before = shapesOf([main], home, [], restored)
    const text = readFileSync(config, 'utf8')
    // The same size, written in place.
    writeFileSync(config, text.replace('bare = false', 'bare = fals2'))
    writeFileSync(hook, '#!/bin/sh\nexit 1\n')
    const after = shapesOf([main], home, [], restored)
    expect(after.get(config)?.digest).not.toBe(before.get(config)?.digest)
    // The hooks folder is trusted on its stat: restored whole, its rewrite goes unseen.
    expect(after.get(hook)?.digest).toBe(before.get(hook)?.digest)
  })

  test('a file a config includes from a hooks folder, trusted there on its stat, still has its own includes followed', async () => {
    const main = repository(join(work, 'acme'))
    const nested = join(work, 'nested')
    writeFileSync(nested, '[core]\n\tname = value\n')
    // Written with forward slashes: a backslash in a config value is an escape, `\a` none Git reads.
    writeFileSync(
      join(main, '.git', 'hooks', 'shared.cfg'),
      `[include]\n\tpath = ${nested.replaceAll('\\', '/')}\n`,
    )
    git(main, 'config', 'include.path', 'hooks/shared.cfg')
    await new Promise((resolved) => setTimeout(resolved, 2_500))
    shapesOf([main], home)
    expect(paths([main])).toContain(nested)
  }, 30_000)

  test('files unchanged for seconds are trusted on their stat: none of 300 hooks is hashed again', () => {
    const main = repository(join(work, 'acme'))
    const folder = join(main, '.git', 'hooks')
    const hooks = Array.from({ length: 300 }, (_, at) => join(folder, `hook-${String(at)}`))
    const write = (word: string) => {
      for (const hook of hooks) writeFileSync(hook, `#!/bin/sh\necho ${word}\n`)
    }
    write('first')
    const before = shapesOf([main], home, [], restored)
    // The same size, rewritten in place, behind a stat that says nothing changed: a hook the
    // fingerprint reads again shows its new digest, one it trusts on its stat keeps the old.
    write('other')
    const after = shapesOf([main], home, [], restored)
    const hashedAgain = hooks.filter((hook) => after.get(hook)?.digest !== before.get(hook)?.digest)
    expect(hashedAgain).toEqual([])
    // Not a fingerprint that saw nothing: the hooks are there, each hashed the first time.
    expect(hooks.filter((hook) => before.get(hook)?.digest.startsWith('file:'))).toEqual(hooks)
  })
})
