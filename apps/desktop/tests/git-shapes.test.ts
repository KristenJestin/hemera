/**
 * What shapes the engine's own Git in a checkout (#457): the files read, what is kept of each, the
 * includes followed, the rules of reading (no link as a last name, no pipe waited on, a cap), the
 * changes between two fingerprints, and what a fingerprint costs.
 *
 * Every repository is made for the test under the temporary directory by the machine's own `git`;
 * the home folder is a temporary one too, never the user's.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  SHAPE_CAP,
  type ShapeHome,
  includesOf,
  shapeChanges,
  shapesOf,
} from '../src/engine/git-shapes.ts'
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
})
