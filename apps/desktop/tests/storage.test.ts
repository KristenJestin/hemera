/**
 * The removal of the tests' temporary folders. Windows answers `EPERM` or `EBUSY` while a file is
 * held for a moment, Linux never does: the hold is simulated by a remover given to the removal.
 */

import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import {
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
  test('still fails, naming the folder, after the retries', () => {
    const folder = temporaryFolder('stuck')
    const { calls, remove } = holding('EPERM', Infinity)
    expect(() => removeWithRetries(folder, remove, () => undefined)).toThrow(basename(folder))
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.length).toBeLessThan(100)
    removeFolders()
    expect(existsSync(folder)).toBe(false)
  })

  test('is not retried when the refusal is not a transient hold', () => {
    const folder = temporaryFolder('refused')
    const { calls, remove } = holding('EACCES', Infinity)
    expect(() => removeWithRetries(folder, remove, () => undefined)).toThrow(/EACCES/)
    expect(calls).toHaveLength(1)
    removeFolders()
  })

  test('does not leave the other folders behind', () => {
    const stuck = temporaryFolder('stuck')
    const other = temporaryFolder('other')
    const remove: Remover = (folder) => {
      if (folder === stuck) throw Object.assign(new Error('EPERM: held'), { code: 'EPERM' })
      removeTree(folder)
    }
    expect(() => removeFoldersWith(remove, () => undefined)).toThrow(basename(stuck))
    expect(existsSync(other)).toBe(false)
    removeFolders()
  })
})
