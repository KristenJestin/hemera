/**
 * `searchIn`'s own resume, past a cursor whose file no longer walks (design D6-04).
 *
 * The suite is named after the scenario of the review finding it covers: a cursor names a file
 * and a line, but the workspace can change between two calls — a file deleted, renamed, or newly
 * `.gitignore`d — and a search that cannot find the cursor's own file must still pick up with the
 * rest of the workspace instead of reporting that nothing matches. Nothing here goes through the
 * tool catalogue or the engine: `searchIn` is a plain function over a real temporary folder.
 */

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { SEARCH_SCAN_BYTES } from '@hemera/core'

import { searchIn } from '#engine/tools/search.ts'

describe('A search resumed past a file that is gone continues where it can', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hemera-search-'))
    writeFileSync(join(root, 'a.ts'), 'needle\n')
    writeFileSync(join(root, 'b.ts'), 'needle\n')
    writeFileSync(join(root, 'c.ts'), 'needle\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('a cursor naming a deleted file resumes at the next file in walk order, from its first line', async () => {
    // `b.ts:1` is the cursor `b.ts` itself would have handed back after its own single line.
    unlinkSync(join(root, 'b.ts'))

    const result = await searchIn({ root, query: 'needle', cursor: 'b.ts:1' })

    // Only `c.ts` follows `b.ts` in the sorted, depth-first order: `a.ts` comes before the
    // cursor and is skipped, `b.ts` is gone, and `c.ts` is read from line 0, not from line 1.
    expect(result.hits).toEqual([{ path: 'c.ts', line: 1, text: 'needle' }])
    expect(result.stoppedBy).toBeNull()
    expect(result.cursor).toBeNull()
  })
})

describe('A search is bounded and says so, however large what it walks', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'hemera-search-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('stops inside a file larger than its budget, and the cursor continues in that file', async () => {
    // Twelve thousand lines of 128 bytes: 1.5 MiB, half again the budget of one call.
    const filler = `${'x'.repeat(127)}\n`
    writeFileSync(join(root, 'big.txt'), `${filler.repeat(12_000)}needle at the end\n`)

    const first = await searchIn({ root, query: 'needle' })
    expect(first.hits).toEqual([])
    expect(first.stoppedBy).toBe('scanned')
    expect(first.scanned).toBeLessThan(SEARCH_SCAN_BYTES + 128 * 1024)
    expect(first.cursor).toMatch(/^big\.txt:\d+$/)

    const second = await searchIn({ root, query: 'needle', cursor: first.cursor })
    expect(second.hits).toEqual([{ path: 'big.txt', line: 12_001, text: 'needle at the end' }])
    expect(second.stoppedBy).toBeNull()
  })

  test('resumes past ten thousand files without walking them one call deep each', async () => {
    const folder = join(root, 'many')
    mkdirSync(folder)
    for (let index = 0; index < 12_000; index += 1) {
      writeFileSync(join(folder, `f${String(index).padStart(5, '0')}.txt`), 'hay\n')
    }
    writeFileSync(join(folder, 'z.txt'), 'needle\n')

    const result = await searchIn({ root, query: 'needle', cursor: 'many/f11998.txt:1' })

    expect(result.hits).toEqual([{ path: 'many/z.txt', line: 1, text: 'needle' }])
  })

  test('names a file it passed over, and why', async () => {
    writeFileSync(join(root, 'image.bin'), Buffer.from([0x6e, 0x65, 0x00, 0x01, 0x02]))
    writeFileSync(join(root, 'text.txt'), 'needle\n')

    const result = await searchIn({ root, query: 'needle' })

    expect(result.hits).toHaveLength(1)
    expect(result.skipped).toEqual([{ path: 'image.bin', reason: 'binary' }])
    expect(result.skippedCount).toBe(1)
  })
})
