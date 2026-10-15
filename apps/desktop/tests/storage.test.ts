/**
 * The removal of the tests' temporary folders. Windows answers `EPERM` or `EBUSY` while a file is
 * held for a moment, Linux never does: the hold is simulated by a remover given to the removal.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { commandsEngine } from './commands-engine.ts'
import {
  endChild,
  holdFile,
  readyWithin,
  removeFolders,
  removeTree,
  removeFoldersWith,
  removeWithRetries,
  temporaryFolder,
  type Remover,
} from './storage.ts'

/** A remover refusing with `code` for its first `refusals` calls, then removing for real. */
const holding = (code: string, refusals: number) => {
  const calls: string[] = []
  const remove: Remover = (folder) => {
    calls.push(folder)
    if (calls.length <= refusals) throw Object.assign(new Error(`${code}: held`), { code })
    removeTree(folder)
  }
  return { calls, remove }
}

describe('A temporary folder held for a moment', () => {
  test('a temporary folder held for a moment is still removed', () => {
    const folder = temporaryFolder('held')
    const { calls, remove } = holding('EPERM', 3)
    const waits: number[] = []
    removeFoldersWith(remove, (millis) => waits.push(millis))
    expect(existsSync(folder)).toBe(false)
    expect(calls).toEqual([folder, folder, folder, folder])
    expect(waits).toHaveLength(3)
  })

  test.each(['EBUSY', 'ENOTEMPTY'])('is retried on %s too', (code) => {
    const folder = temporaryFolder('held')
    removeFoldersWith(holding(code, 1).remove, () => undefined)
    expect(existsSync(folder)).toBe(false)
  })

  test('each wait is longer than the one before', () => {
    const folder = temporaryFolder('held')
    const waits: number[] = []
    removeWithRetries(folder, holding('EPERM', 4).remove, (millis) => waits.push(millis))
    expect(waits).toEqual([...waits].sort((a, b) => a - b))
    expect(new Set(waits).size).toBe(waits.length)
  })
})

describe('A temporary folder held for good', () => {
  test('still fails, naming the folder, after the retries', async () => {
    const folder = temporaryFolder('stuck')
    const { calls, remove } = holding('EPERM', Infinity)
    expect(() => removeWithRetries(folder, remove, () => undefined)).toThrow(basename(folder))
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.length).toBeLessThan(100)
    await removeFolders()
    expect(existsSync(folder)).toBe(false)
  })

  test('is not retried when the refusal is not a transient hold', async () => {
    const folder = temporaryFolder('refused')
    const { calls, remove } = holding('EACCES', Infinity)
    expect(() => removeWithRetries(folder, remove, () => undefined)).toThrow(/EACCES/)
    expect(calls).toHaveLength(1)
    await removeFolders()
  })

  test('does not leave the other folders behind', async () => {
    const stuck = temporaryFolder('stuck')
    const other = temporaryFolder('other')
    const remove: Remover = (folder) => {
      if (folder === stuck) throw Object.assign(new Error('EPERM: held'), { code: 'EPERM' })
      removeTree(folder)
    }
    expect(() => removeFoldersWith(remove, () => undefined)).toThrow(basename(stuck))
    expect(existsSync(other)).toBe(false)
    await removeFolders()
  })
})

describe('A folder an engine still stands in when its test ends', () => {
  test('an engine its test left running is closed before its data folder is removed', async () => {
    const data = temporaryFolder('left-running')
    let closedOnItsFolder: boolean | null = null
    const { promise: started, resolve } = Promise.withResolvers<void>()
    // What a test that timed out leaves: its engine still running, its promise awaited by no one.
    const abandoned = commandsEngine(data)(() =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            closedOnItsFolder = existsSync(data)
          }),
        )
        resolve()
        return yield* Effect.never
      }),
    )
    abandoned.catch(() => undefined)
    await started
    await removeFolders()
    expect(closedOnItsFolder).toBe(true)
    expect(existsSync(data)).toBe(false)
  })
})

describe('A child a test starts says it is ready within a bound (#417)', () => {
  test('a child that never says it is ready fails within the bound, naming what it wrote on its errors', async () => {
    const child = spawn(process.execPath, [
      '-e',
      "process.stderr.write('stuck on something\\n'); setInterval(() => {}, 1000)",
    ])
    const began = performance.now()
    await expect(readyWithin(child, 500)).rejects.toThrow(
      /not ready after 500 ms[\s\S]*stuck on something/,
    )
    expect(performance.now() - began).toBeLessThan(5_000)
    await endChild(child)
  })

  test('a child that ends before it is ready fails at once', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(3)'])
    await expect(readyWithin(child, 20_000)).rejects.toThrow(/ended \(3\) before it was ready/)
  })

  test('a held file is held until its holder ends: Windows opens it for no one else', async () => {
    const file = join(temporaryFolder('held-file'), 'held.txt')
    writeFileSync(file, 'before\n')
    const holder = await holdFile(file)
    if (process.platform === 'win32') expect(() => readFileSync(file)).toThrow(/EBUSY/)
    await endChild(holder)
    expect(readFileSync(file, 'utf8')).toBe('before\n')
    await removeFolders()
  })
})
