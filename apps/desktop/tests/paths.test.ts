/**
 * Where a tool may act, judged before anything is touched (D6-05).
 *
 * The filesystem is the suite's own temporary folder, and the one door into it — how a path is
 * followed to what it is — is handed over counted, so "nothing was asked" is a number and not a
 * hope: a path an agent names outside the root must reach the human without Hemera having
 * followed it first.
 */

import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { type RefusedPathError, resolveInside } from '#engine/tools/paths.ts'

let folder: string
let root: string

beforeEach(() => {
  folder = join(tmpdir(), `hemera-paths-${String(Date.now())}-${String(Math.random())}`)
  root = join(folder, 'workspace')
  mkdirSync(join(root, 'src'), { recursive: true })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** The filesystem's own answer, and every path it was asked about. */
function counted() {
  const asked: string[] = []
  return {
    asked,
    realpathOf: (path: string) => {
      asked.push(path)
      return realpath(path)
    },
  }
}

/** What `resolveInside` refused with, or null when it accepted. */
async function refusalOf(named: string, realpathOf: (path: string) => Promise<string>) {
  return resolveInside(root, named, realpathOf).then(
    () => null,
    (refusal: RefusedPathError) => refusal,
  )
}

describe('a path that reads as outside the root', () => {
  it('goes to the human without the filesystem being asked about it', async () => {
    const door = counted()
    const refusal = await refusalOf(join(folder, 'elsewhere', 'secret.txt'), door.realpathOf)

    expect(refusal?.why).toBe('outside')
    expect(refusal?.resolved).toBe(join(folder, 'elsewhere', 'secret.txt'))
    // The root is the user's and is followed; what the agent named is not.
    expect(door.asked).toEqual([root])
  })

  it('climbing out with .. is judged the same way', async () => {
    const door = counted()
    const refusal = await refusalOf('../elsewhere/secret.txt', door.realpathOf)

    expect(refusal?.why).toBe('outside')
    expect(door.asked).toEqual([root])
  })
})

describe('a UNC or device path', () => {
  it('goes to the human untouched, the root included', async () => {
    const named = [
      '\\\\hemera-nowhere\\share\\file.txt',
      '\\\\?\\C:\\Windows\\win.ini',
      '\\\\.\\pipe\\hemera',
    ]
    const door = counted()
    const refusals = await Promise.all(named.map((one) => refusalOf(one, door.realpathOf)))

    expect(refusals.map((refusal) => refusal?.why)).toEqual(['outside', 'outside', 'outside'])
    expect(door.asked).toEqual([])
  })
})

describe('a path inside the root', () => {
  it('is followed, and answered with where it really is', async () => {
    const door = counted()
    const settled = await resolveInside(root, 'src/new-file.ts', door.realpathOf)

    expect(settled).toBe(join(realpathSync.native(root), 'src', 'new-file.ts'))
  })

  it('that is a link leading out of the root is outside, where it leads', async () => {
    mkdirSync(join(folder, 'elsewhere'))
    // A junction on Windows, which needs no privilege; a directory link elsewhere.
    symlinkSync(join(folder, 'elsewhere'), join(root, 'out'), 'junction')
    const refusal = await refusalOf('out/secret.txt', realpath)

    expect(refusal?.why).toBe('outside')
    expect(refusal?.resolved).toBe(
      join(realpathSync.native(join(folder, 'elsewhere')), 'secret.txt'),
    )
  })
})
