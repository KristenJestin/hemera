/**
 * A file the engine reads on its own behalf, by a name it chose (#434, #439): opened without
 * following a link at its last name and without waiting on a pipe, read only when the open handle
 * is a regular file under the reader's cap, so a pipe, a device or a link planted there is refused
 * with its reason at once, never a read that blocks the engine.
 *
 * On Windows there is no pipe in a folder to plant, nor `/dev/zero`: those cases are skipped there,
 * and the cap and the proof of the real path are checked on both platforms.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  NOT_A_FILE,
  OVER_CAP,
  type OwnRead,
  THROUGH_A_LINK,
  openOwn,
  readOwnSync,
} from '../src/engine/tools/judged.ts'
import { lineIdentity } from '../src/engine/permissions/identity.ts'
import { fingerprintOf } from '../src/engine/tools/read.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let work: string

beforeEach(() => {
  work = realpathSync.native(temporaryFolder('own-reads'))
})
afterEach(removeFolders)

const POSIX = process.platform !== 'win32'

/** What a read throws, as its message; null when it read. */
const refusal = (read: () => OwnRead): string | null => {
  try {
    read()
    return null
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause)
  }
}

describe('A file the engine reads on its own behalf is never waited on (#434)', () => {
  test.skipIf(!POSIX)('a pipe is refused at once, as not a regular file', async () => {
    const pipe = join(work, 'export.test.mjs')
    execFileSync('mkfifo', [pipe])
    expect(refusal(() => readOwnSync(pipe, 1024))).toBe(NOT_A_FILE)
    await expect(openOwn(pipe, 1024)).rejects.toThrow(NOT_A_FILE)
  })

  test.skipIf(!POSIX)('a link to /dev/zero is refused, never followed', async () => {
    const link = join(work, 'export.test.mjs')
    symlinkSync('/dev/zero', link)
    expect(refusal(() => readOwnSync(link, 1024))).toBe(THROUGH_A_LINK)
    await expect(openOwn(link, 1024)).rejects.toThrow(THROUGH_A_LINK)
  })

  test('a link at the last name is refused without a real path, on every system', async (context) => {
    const outside = join(work, 'outside.txt')
    writeFileSync(outside, 'never read\n')
    const link = join(work, 'package.json')
    try {
      symlinkSync(outside, link, 'file')
    } catch {
      context.skip()
    }
    expect(refusal(() => readOwnSync(link, 1024))).toBe(THROUGH_A_LINK)
  })

  test('a file over the cap is refused, and one at the cap is read', async () => {
    const file = join(work, 'index')
    writeFileSync(file, 'x'.repeat(1025))
    expect(refusal(() => readOwnSync(file, 1024))).toBe(OVER_CAP)
    await expect(openOwn(file, 1024)).rejects.toThrow(OVER_CAP)
    writeFileSync(file, 'x'.repeat(1024))
    expect(readOwnSync(file, 1024).bytes.length).toBe(1024)
  })

  test('an ordinary file is read whole, with the times of the file read', async () => {
    const file = join(work, 'export.test.mjs')
    writeFileSync(file, 'test("exports", () => {})\n')
    const read = readOwnSync(file, 1024)
    expect(read.bytes.toString('utf8')).toBe('test("exports", () => {})\n')
    expect(read.stats.isFile()).toBe(true)
    const handle = await openOwn(file, 1024)
    try {
      expect((await handle.readFile()).toString('utf8')).toBe('test("exports", () => {})\n')
    } finally {
      await handle.close()
    }
  })

  test('a file proven at its real path is refused once a folder on its way leads elsewhere', async () => {
    const git = join(work, 'acme', '.git')
    const outside = join(work, 'outside')
    mkdirSync(git, { recursive: true })
    mkdirSync(outside)
    writeFileSync(join(git, 'index'), 'the index')
    writeFileSync(join(outside, 'index'), 'another file')
    const real = join(git, 'index')
    expect(readOwnSync(real, 1024, real).bytes.toString('utf8')).toBe('the index')
    renameSync(git, join(work, 'acme', 'moved'))
    symlinkSync(outside, git, 'junction')
    expect(refusal(() => readOwnSync(real, 1024, real))).toBe(THROUGH_A_LINK)
    // The asynchronous open proves its handle at the path it is given, as the real one.
    await expect(openOwn(real, 1024)).rejects.toThrow(THROUGH_A_LINK)
  })
})

describe('A command’s identity keeps the fingerprint of its script (#439)', () => {
  test('a script named through a link is fingerprinted at its real path', async (context) => {
    const root = join(work, 'acme')
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'run.mjs'), 'console.log("ran")\n')
    try {
      symlinkSync(join(root, 'scripts', 'run.mjs'), join(root, 'run.mjs'), 'file')
    } catch {
      context.skip()
    }
    const identity = await lineIdentity({
      tool: 'commands_run',
      root,
      folder: '.',
      repository: null,
      catalogue: null,
      line: 'node run.mjs',
      platform: process.platform,
    })
    expect(identity.script).toBe(fingerprintOf(Buffer.from('console.log("ran")\n', 'utf8')))
  })
})
