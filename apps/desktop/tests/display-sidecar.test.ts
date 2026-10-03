/** The display hint main paints the first frame from, before the engine has answered. */

import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vite-plus/test'

import { SIDECAR_FILE, readSidecar, writeSidecar } from '../src/main/display-sidecar.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

afterEach(removeFolders)

describe('The display hint', () => {
  test('a data folder without one has nothing to go on', () => {
    expect(readSidecar(temporaryFolder('sidecar'))).toBeNull()
  })

  test('what was written is what the next start reads, and no temporary file is left', () => {
    const data = temporaryFolder('sidecar')
    writeSidecar(data, { theme: 'dark' }, () => undefined)
    expect(readSidecar(data)).toEqual({ theme: 'dark' })
    writeSidecar(data, { theme: 'light' }, () => undefined)
    expect(readSidecar(data)).toEqual({ theme: 'light' })
    expect(readdirSync(data)).toEqual([SIDECAR_FILE])
  })

  test.each([['not JSON'], ['{"theme":"sepia"}'], ['[]']])(
    'a hint that reads %s is no hint',
    (written) => {
      const data = temporaryFolder('sidecar')
      writeFileSync(join(data, SIDECAR_FILE), written)
      expect(readSidecar(data)).toBeNull()
    },
  )

  test('a hint that cannot be written is logged, not thrown', () => {
    const lines: string[] = []
    writeSidecar(join(temporaryFolder('sidecar'), 'missing'), { theme: 'dark' }, (line) =>
      lines.push(line),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^display-1\.json: the hint of the next start could not be written/)
  })
})
