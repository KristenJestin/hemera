/**
 * `searchIn`'s own resume, past a cursor whose file no longer walks (design D6-04).
 *
 * The suite is named after the scenario of the review finding it covers: a cursor names a file
 * and a line, but the workspace can change between two calls — a file deleted, renamed, or newly
 * `.gitignore`d — and a search that cannot find the cursor's own file must still pick up with the
 * rest of the workspace instead of reporting that nothing matches. Nothing here goes through the
 * tool catalogue or the engine: `searchIn` is a plain function over a real temporary folder.
 */

import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

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
