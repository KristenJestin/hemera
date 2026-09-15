import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  inspectPackage,
  localesProblems,
  refusedEntries,
  unpackedFolderOf,
} from './package-desktop.ts'

const repository = resolve(import.meta.dirname, '..')
const unpacked = join(repository, 'dist', 'package', unpackedFolderOf())

describe('Locales réduites', () => {
  test('one locale is what a package speaking one language carries', () => {
    expect(localesProblems(['en-US.pak'])).toEqual([])
  })

  test('a locale of a language the application does not speak is reported', () => {
    const problems = localesProblems(['en-US.pak', 'fr.pak', 'de.pak'])
    expect(problems.map((problem) => problem.entry).toSorted()).toEqual(['de.pak', 'fr.pak'])
  })

  test('an empty locales folder is reported rather than taken for a small package', () => {
    // Electron refuses to start on one, so emptying it by hand trades 47 MB for a crash.
    expect(localesProblems([])[0]?.problem).toContain('will not start')
  })
})

describe('Paquet sans les sources', () => {
  test.each(['legacy/packages/ui/dist/tokens.js', 'spikes/proto-motion/index.html'])(
    '%p in a package is reported as belonging to the sources',
    (entry) => {
      expect(refusedEntries([entry])).toHaveLength(1)
    },
  )

  test('a development node_modules is reported wherever it sits', () => {
    expect(refusedEntries(['resources/app/node_modules/vite-plus/index.js'])).toHaveLength(1)
  })

  test('what a package is made of is not mistaken for a source', () => {
    expect(
      refusedEntries([
        'Hemera.exe',
        'locales/en-US.pak',
        'resources/app.asar',
        'chrome_100_percent.pak',
      ]),
    ).toEqual([])
  })

  test.runIf(existsSync(unpacked))(
    'the package built on this machine carries what it should and nothing else',
    () => {
      expect(inspectPackage(unpacked)).toEqual([])
      expect(readdirSync(join(unpacked, 'locales'))).toEqual(['en-US.pak'])
    },
  )

  test('each target names the folder its unpacked application lands in', () => {
    expect(unpackedFolderOf('win32')).toBe('win-unpacked')
    expect(unpackedFolderOf('linux')).toBe('linux-unpacked')
  })
})
