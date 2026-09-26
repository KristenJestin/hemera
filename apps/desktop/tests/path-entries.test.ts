/**
 * The entries a path field offers, one folder at a time, and never above its base (#109).
 *
 * The filesystem is the suite's own temporary folder: a base with a folder and a file in it, and
 * a sibling of the base that nothing typed under the base may reach.
 */

import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { PathOutsideBaseError, entriesUnder } from '#engine/paths.ts'

let folder: string
let base: string

beforeEach(() => {
  folder = join(tmpdir(), `hemera-entries-${String(Date.now())}-${String(Math.random())}`)
  base = join(folder, 'api')
  mkdirSync(join(base, 'src', 'core'), { recursive: true })
  mkdirSync(join(base, 'docs'), { recursive: true })
  writeFileSync(join(base, 'package.json'), '{}')
  writeFileSync(join(base, 'src', 'index.ts'), '')
  mkdirSync(join(folder, 'secret'), { recursive: true })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

async function refusalOf(relative: string): Promise<PathOutsideBaseError> {
  return await Effect.runPromise(Effect.flip(entriesUnder(base, relative, ['folder'])))
}

describe('The entries of a folder under its base', () => {
  test('the base itself lists its folders, and its files only when they are asked for', async () => {
    await expect(Effect.runPromise(entriesUnder(base, '', ['folder']))).resolves.toEqual([
      { name: 'docs', kind: 'folder' },
      { name: 'src', kind: 'folder' },
    ])
    await expect(Effect.runPromise(entriesUnder(base, '', ['folder', 'file']))).resolves.toEqual([
      { name: 'docs', kind: 'folder' },
      { name: 'src', kind: 'folder' },
      { name: 'package.json', kind: 'file' },
    ])
  })

  test('a folder under the base lists the level under it, written with either slash', async () => {
    const expected = [
      { name: 'core', kind: 'folder' },
      { name: 'index.ts', kind: 'file' },
    ]
    await expect(Effect.runPromise(entriesUnder(base, 'src', ['folder', 'file']))).resolves.toEqual(
      expected,
    )
    await expect(
      Effect.runPromise(entriesUnder(base, './src/', ['folder', 'file'])),
    ).resolves.toEqual(expected)
  })

  test('a folder that is not there yet offers nothing, and is not refused', async () => {
    await expect(Effect.runPromise(entriesUnder(base, 'src/later', ['folder']))).resolves.toEqual(
      [],
    )
  })
})

describe('The listing refuses what is not under its base', () => {
  test('`..` is refused, alone or inside a path', async () => {
    for (const relative of ['..', '../secret', 'src/../..', 'src\\..\\..\\secret']) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time, each named
      const refused = await refusalOf(relative)
      expect(refused, relative).toBeInstanceOf(PathOutsideBaseError)
      expect(refused.message, relative).toContain('climbs above')
    }
  })

  test('an absolute path is refused, on either system', async () => {
    for (const relative of [join(folder, 'secret'), '/etc', 'C:\\Windows', 'C:Windows']) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time, each named
      const refused = await refusalOf(relative)
      expect(refused.message, relative).toContain('is absolute')
    }
  })

  test('a link under the base that leads out of it is refused', async () => {
    const link = join(base, 'escape')
    try {
      symlinkSync(join(folder, 'secret'), link, 'junction')
    } catch {
      // A machine that may not make links has nothing to refuse here.
      return
    }
    const refused = await refusalOf('escape')
    expect(refused.message).toContain('leads outside')
  })
})
