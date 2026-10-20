/**
 * The capture key (#425, #447): thirty-two random bytes in a file of the data folder, written
 * whole or not at all, readable by its owner only, and never overwritten once whole.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { CAPTURE_KEY_FILE, captureKey } from '../src/engine/planning/capture-key.ts'

let data: string

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'hemera-capture-key-'))
})

afterEach(() => {
  rmSync(data, { recursive: true, force: true })
})

const keyOf = (folder: string, write?: Parameters<typeof captureKey>[1]) =>
  Effect.runSync(captureKey(folder, write))

/** A write that gets as far as `bytes` of the file, then dies as a crashed process would. */
const crashingAfter =
  (bytes: number) =>
  (file: string, whole: Uint8Array): void => {
    writeFileSync(file, whole.subarray(0, bytes), { flag: 'wx' })
    throw new Error('the process died')
  }

describe('the capture key', () => {
  test('the first use makes a key of thirty-two bytes and leaves nothing else in the folder', () => {
    const key = keyOf(data)
    expect(key).toHaveLength(32)
    expect(readFileSync(join(data, CAPTURE_KEY_FILE))).toEqual(key)
    expect(readdirSync(data)).toEqual([CAPTURE_KEY_FILE])
  })

  test.skipIf(process.platform === 'win32')('the key file is readable by its owner only', () => {
    keyOf(data)
    expect(statSync(join(data, CAPTURE_KEY_FILE)).mode & 0o777).toBe(0o600)
  })

  test('a first write that dies half way leaves no key file, and the next start makes a whole one', () => {
    expect(() => keyOf(data, crashingAfter(10))).toThrow('the process died')
    expect(readdirSync(data)).not.toContain(CAPTURE_KEY_FILE)

    const key = keyOf(data)
    expect(key).toHaveLength(32)
    expect(readFileSync(join(data, CAPTURE_KEY_FILE))).toEqual(key)
  })

  test('a write that dies before its first byte leaves no key file either', () => {
    expect(() => keyOf(data, crashingAfter(0))).toThrow('the process died')
    expect(readdirSync(data)).not.toContain(CAPTURE_KEY_FILE)
  })

  test('a whole key is read back and never overwritten', () => {
    const first = keyOf(data)
    expect(keyOf(data)).toEqual(first)
    expect(readFileSync(join(data, CAPTURE_KEY_FILE))).toEqual(first)
    expect(readdirSync(data)).toEqual([CAPTURE_KEY_FILE])
  })

  test('a key another start put in place while this one was writing is kept, and is the one read', () => {
    const theirs = Buffer.alloc(32, 7)
    const racing = (file: string, whole: Uint8Array): void => {
      writeFileSync(file, whole, { flag: 'wx' })
      // The other start finishes first, between this one's write and its putting in place.
      writeFileSync(join(data, CAPTURE_KEY_FILE), theirs, { flag: 'wx' })
    }
    expect(keyOf(data, racing)).toEqual(theirs)
    expect(readFileSync(join(data, CAPTURE_KEY_FILE))).toEqual(theirs)
    expect(readdirSync(data)).toEqual([CAPTURE_KEY_FILE])
  })

  test('a key file cut short by an older start is refused with its own wording and left as it is', () => {
    const file = join(data, CAPTURE_KEY_FILE)
    writeFileSync(file, Buffer.alloc(10, 1))
    expect(() => keyOf(data)).toThrow(`${file} is not a capture key`)
    expect(readFileSync(file)).toEqual(Buffer.alloc(10, 1))
  })

  test('a data folder that does not exist fails and creates nothing', () => {
    const missing = join(data, 'absent', 'deeper')
    expect(() => keyOf(missing)).toThrow()
    expect(readdirSync(data)).toEqual([])
    mkdirSync(missing, { recursive: true })
    expect(keyOf(missing)).toHaveLength(32)
  })
})
