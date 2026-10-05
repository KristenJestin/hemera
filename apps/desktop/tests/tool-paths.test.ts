/**
 * Where a path an agent names leads, judged against its role's place: resolved first (`~`,
 * absolute paths, `..`, symbolic links and junctions followed), and outside when it cannot be
 * resolved with certainty.
 */

import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { resolvePath, shownPath } from '../src/engine/tools/paths.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let work: string
let root: string

beforeEach(() => {
  work = realpathSync.native(temporaryFolder('paths'))
  root = join(work, 'workspace')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(work, 'outside'))
})
afterEach(removeFolders)

const at = (named: string, base = root) => resolvePath(root, base, named, work)

describe('A path inside the place', () => {
  test('is followed, and answered with where it really is', async () => {
    writeFileSync(join(root, 'src', 'a.ts'), '')
    expect(await at('src/a.ts')).toEqual({
      named: 'src/a.ts',
      path: join(root, 'src', 'a.ts'),
      inside: true,
      certain: true,
    })
  })

  test('a file that does not exist yet is judged by its folder', async () => {
    expect(await at('src/new/b.ts')).toMatchObject({
      path: join(root, 'src', 'new', 'b.ts'),
      inside: true,
    })
  })

  test('a child whose name starts with two dots is inside', async () => {
    expect(await at('..notes')).toMatchObject({ inside: true })
  })

  test('an absolute path under the place is inside', async () => {
    expect(await at(join(root, 'src'))).toMatchObject({ inside: true })
  })
})

describe('A path that leaves the place', () => {
  test('climbing out with .. is outside, without the filesystem being asked', async () => {
    expect(await at('../outside/x')).toEqual({
      named: '../outside/x',
      path: join(work, 'outside', 'x'),
      inside: false,
      certain: true,
    })
  })

  test('`~` is the home folder, and shown as such', async () => {
    const found = await at('~/.ssh/config')
    expect(found).toMatchObject({ path: join(work, '.ssh', 'config'), inside: false })
    expect(shownPath(found.path, work)).toBe('~/.ssh/config')
  })

  test('a symbolic link (or a junction) inside the place that leads out of it is outside', async () => {
    symlinkSync(join(work, 'outside'), join(root, 'linked'), 'junction')
    expect(await at('linked/x.txt')).toMatchObject({
      path: join(work, 'outside', 'x.txt'),
      inside: false,
      certain: true,
    })
  })

  test.skipIf(process.platform === 'win32')(
    'a link that leads nowhere is judged by where it points',
    async () => {
      symlinkSync(join(work, 'outside', 'missing.txt'), join(root, 'dangling'))
      expect(await at('dangling')).toMatchObject({
        path: join(work, 'outside', 'missing.txt'),
        inside: false,
      })
    },
  )

  test.skipIf(process.platform === 'win32')(
    'a loop of links cannot be resolved with certainty, and counts as outside',
    async () => {
      symlinkSync(join(root, 'b'), join(root, 'a'))
      symlinkSync(join(root, 'a'), join(root, 'b'))
      expect(await at('a/file')).toMatchObject({ inside: false, certain: false })
    },
  )

  test('a UNC or device path is outside, untouched', async () => {
    expect(await at('\\\\server\\share\\x')).toMatchObject({ inside: false, certain: false })
  })
})
