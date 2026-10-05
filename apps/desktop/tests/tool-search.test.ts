/**
 * `search`, bounded and resumable: it stops at its match limit or its scan budget and says which,
 * hands back a cursor that resumes where it stopped (even past a file that has gone since), names
 * the files it passed over, respects `.gitignore`, and keeps to the files a glob names.
 */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SEARCH_MATCH_LIMIT, SEARCH_SCAN_BYTES } from '@hemera/core/domain'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { globMatcher, searchIn } from '../src/engine/tools/search.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let root: string

beforeEach(() => {
  root = temporaryFolder('search')
})
afterEach(removeFolders)

describe('A search resumed past a file that is gone continues where it can', () => {
  test('a cursor naming a deleted file resumes at the next file in walk order, from its first line', async () => {
    for (const name of ['a.ts', 'b.ts', 'c.ts']) writeFileSync(join(root, name), 'needle\n')
    unlinkSync(join(root, 'b.ts'))

    const result = await searchIn({ root, query: 'needle', cursor: 'b.ts:1' })

    expect(result.hits).toEqual([{ path: 'c.ts', line: 1, text: 'needle' }])
    expect(result.stoppedBy).toBeNull()
    expect(result.cursor).toBeNull()
  })
})

describe('A search is bounded and says so, however large what it walks', () => {
  test('stops at the match limit, says so, and offers a cursor', async () => {
    writeFileSync(join(root, 'many.txt'), 'needle\n'.repeat(SEARCH_MATCH_LIMIT + 5))
    const first = await searchIn({ root, query: 'needle' })
    expect(first.hits).toHaveLength(SEARCH_MATCH_LIMIT)
    expect(first.stoppedBy).toBe('matches')
    const second = await searchIn({ root, query: 'needle', cursor: first.cursor })
    expect(second.hits).toHaveLength(5)
    expect(second.stoppedBy).toBeNull()
  })

  test('stops inside a file larger than its budget, and the cursor continues in that file', async () => {
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

  test('holds its budget on a file with no newline, and goes on past it', async () => {
    writeFileSync(join(root, 'bundle.min.js'), `${'x'.repeat(3 * SEARCH_SCAN_BYTES)}needle`)
    writeFileSync(join(root, 'next.ts'), 'needle\n')

    const first = await searchIn({ root, query: 'needle' })
    expect(first.stoppedBy).toBe('scanned')
    expect(first.hits).toEqual([])
    expect(first.cursor).toBe('bundle.min.js:1')

    const second = await searchIn({ root, query: 'needle', cursor: first.cursor })
    expect(second.hits).toEqual([{ path: 'next.ts', line: 1, text: 'needle' }])
  })

  test('resumes past thousands of files without reading them again', async () => {
    const folder = join(root, 'many')
    mkdirSync(folder)
    const names = Array.from(
      { length: 2000 },
      (_, index) => `f${String(index).padStart(5, '0')}.txt`,
    )
    for (let first = 0; first < names.length; first += 64) {
      // oxlint-disable-next-line no-await-in-loop -- a batch at a time: all at once opens more files than the system allows
      await Promise.all(
        names.slice(first, first + 64).map((name) => writeFile(join(folder, name), 'needle\n')),
      )
    }
    writeFileSync(join(folder, 'z.txt'), 'needle\n')

    const result = await searchIn({ root, query: 'needle', cursor: 'many/f01999.txt:1' })

    expect(result.hits).toEqual([{ path: 'many/z.txt', line: 1, text: 'needle' }])
  }, 60_000)

  test('stops when its caller gave up on it', async () => {
    writeFileSync(join(root, 'a.txt'), 'needle\n')
    const abort = new AbortController()
    abort.abort()
    const ended = await searchIn({ root, query: 'needle', signal: abort.signal }).then(
      () => 'answered',
      () => 'stopped',
    )
    expect(ended).toBe('stopped')
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

describe('A search keeps to what it is asked', () => {
  test('`.gitignore` is respected, `.git` and `node_modules` are never walked', async () => {
    writeFileSync(join(root, '.gitignore'), 'dist/\n*.log\n')
    for (const folder of ['dist', 'src', '.git', 'node_modules']) mkdirSync(join(root, folder))
    for (const file of ['dist/a.js', 'src/a.ts', '.git/HEAD', 'node_modules/x.js', 'run.log'])
      writeFileSync(join(root, file), 'needle\n')

    const result = await searchIn({ root, query: 'NEEDLE' })

    expect(result.hits.map((hit) => hit.path)).toEqual(['src/a.ts'])
  })

  test('a glob keeps the files whose path it matches', async () => {
    mkdirSync(join(root, 'src', 'deep'), { recursive: true })
    for (const file of ['src/a.ts', 'src/deep/b.ts', 'src/c.js', 'd.ts'])
      writeFileSync(join(root, file), 'needle\n')

    const nested = await searchIn({ root, query: 'needle', glob: 'src/**/*.ts' })
    const anywhere = await searchIn({ root, query: 'needle', glob: '*.ts' })

    expect(nested.hits.map((hit) => hit.path)).toEqual(['src/a.ts', 'src/deep/b.ts'])
    expect(anywhere.hits.map((hit) => hit.path)).toEqual(['d.ts', 'src/a.ts', 'src/deep/b.ts'])
    expect(globMatcher('?.ts').test('a.ts')).toBe(true)
    expect(globMatcher('?.ts').test('ab.ts')).toBe(false)
  })
})
