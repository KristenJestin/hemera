import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  analyze,
  askedRefusalsOf,
  importsOf,
  readRefusalsOf,
  refusalsOf,
  storageRefusalsOf,
} from './boundaries.ts'

const repository = resolve(import.meta.dirname, '..')

describe('The shared packages stay free of Electron', () => {
  test('no shared package of the repository imports Electron or React', () => {
    expect(analyze(repository)).toEqual([])
  })

  // A symbolic link to nothing is listed and then cannot be read, as a file removed between the
  // listing and the reading: the walk goes on instead of failing with ENOENT.
  test.skipIf(process.platform === 'win32')('a source file that is gone is not source', () => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
    try {
      mkdirSync(join(root, 'packages', 'ipc', 'src'), { recursive: true })
      symlinkSync(join(root, 'nothing.ts'), join(root, 'packages', 'ipc', 'src', 'gone.ts'))
      expect(analyze(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('every way of naming a module is read', () => {
    const source = [
      "import { app } from 'electron/main'",
      "import type { MessagePortMain } from 'electron'",
      "export { x } from './local.ts'",
      "const lazy = await import('react')",
      "const old = require('node:fs')",
    ].join('\n')
    expect(importsOf(source)).toEqual([
      'electron/main',
      'electron',
      './local.ts',
      'react',
      'node:fs',
    ])
  })

  test.each([
    ['Electron', "import { ipcMain } from 'electron/main'\n"],
    ['Electron, even for its types', "import type { WebContents } from 'electron'\n"],
    ['React', "import { useState } from 'react'\n"],
  ])('a shared package that imports %s is refused', (_, source) => {
    expect(refusalsOf('packages/ipc/src/link.ts', source)).toHaveLength(1)
  })

  test('the design system may import React, and still never Electron', () => {
    expect(refusalsOf('packages/ui/src/components/button/button.tsx', "import 'react'\n")).toEqual(
      [],
    )
    expect(refusalsOf('packages/ui/src/motion.ts', "import 'electron'\n")).toHaveLength(1)
  })

  test('a package whose folder only starts like the design system is not it', () => {
    expect(refusalsOf('packages/uikit/src/x.ts', "import 'react'\n")).toHaveLength(1)
  })

  test('a module whose name only starts like Electron is not refused', () => {
    expect(refusalsOf('packages/ipc/src/link.ts', "import x from 'electron-store'\n")).toEqual([])
  })
})

describe('The storage layer stays in the engine', () => {
  test.each([
    ['node:sqlite', "import { DatabaseSync } from 'node:sqlite'\n"],
    ['Drizzle', "import { eq } from 'drizzle-orm'\n"],
    [
      'Drizzle, through one of its entry points',
      "import { migrate } from 'drizzle-orm/migrator'\n",
    ],
    ['the Effect SQLite client', "import { SqliteClient } from '@effect/sql-sqlite-node'\n"],
  ])('a file outside the engine that imports %s is refused', (_, source) => {
    expect(storageRefusalsOf('apps/desktop/src/main/index.ts', source)).toHaveLength(1)
    expect(storageRefusalsOf('packages/ipc/src/engine.ts', source)).toHaveLength(1)
  })

  test('the engine itself may import it', () => {
    const source = "import { eq } from 'drizzle-orm'\nimport 'node:sqlite'\n"
    expect(storageRefusalsOf('apps/desktop/src/engine/storage/database.ts', source)).toEqual([])
  })

  test('a folder that only starts like the engine is not the engine', () => {
    const source = "import { eq } from 'drizzle-orm'\n"
    expect(storageRefusalsOf('apps/desktop/src/engine-old/x.ts', source)).toHaveLength(1)
  })
})

describe('A file tool reads a file for an agent through the judged open only (#392)', () => {
  const TOOL = 'apps/desktop/src/engine/tools/new-tool.ts'

  test.each([
    ['readFile from node:fs/promises', "import { readFile } from 'node:fs/promises'\n"],
    ['readFileSync from node:fs', "import { readFileSync, statSync } from 'node:fs'\n"],
    ['a read stream', "import { createReadStream } from 'fs'\n"],
    ['an open renamed', "import { open as openFile } from 'node:fs/promises'\n"],
    ['the whole module', "import * as fs from 'node:fs'\n"],
    ['its default', "import fs from 'node:fs'\n"],
    ['a require', "const { readFileSync } = require('node:fs')\n"],
  ])('a planted raw read in a file tool is refused: %s', (_, source) => {
    expect(readRefusalsOf(TOOL, source)).toHaveLength(1)
  })

  test('what reads no content is not refused: a stat, a listing, a type', () => {
    const source = [
      "import { type BigIntStats, type Dirent, constants } from 'node:fs'",
      "import { lstat, readdir, realpath, stat } from 'node:fs/promises'",
      "import type { FileHandle } from 'node:fs/promises'",
    ].join('\n')
    expect(readRefusalsOf(TOOL, source)).toEqual([])
  })

  test('the judged open reads', () => {
    const read = "import { open, readFile } from 'node:fs/promises'\n"
    expect(readRefusalsOf('apps/desktop/src/engine/tools/judged.ts', read)).toEqual([])
  })

  test('outside the file tools, a read is not this rule’s', () => {
    const source = "import { readFile } from 'node:fs/promises'\n"
    expect(readRefusalsOf('apps/desktop/src/engine/storage/database.ts', source)).toEqual([])
  })

  test('the exception for a judged call’s own file is made by the gate only', () => {
    const source = 'const withholding = yield* Withholding.asked(judged)\n'
    expect(askedRefusalsOf('apps/desktop/src/engine/tools/gate.ts', source)).toEqual([])
    expect(askedRefusalsOf(TOOL, source)).toHaveLength(1)
    expect(askedRefusalsOf('apps/desktop/src/engine/building/new-tool.ts', source)).toHaveLength(1)
  })

  /** The refusals of a repository whose one file tool holds `source`. */
  const plantedIn = (source: string) => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
    try {
      const tools = join(root, 'apps', 'desktop', 'src', 'engine', 'tools')
      mkdirSync(tools, { recursive: true })
      writeFileSync(join(tools, 'planted.ts'), source)
      return analyze(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  test.each([
    ['a named read', "import { readFile } from 'node:fs/promises'\n", 'readFile'],
    ['a synchronous read', "import { readFileSync } from 'fs'\n", 'readFileSync'],
    ['the promises of node:fs', "import { promises } from 'node:fs'\n", 'promises'],
    ['the promises renamed', "import { promises as files } from 'node:fs'\n", 'promises'],
    ['the default of node:fs/promises', "import files from 'node:fs/promises'\n", 'node:fs'],
    ['the whole module', "import * as fs from 'node:fs'\n", 'node:fs'],
    ['a require', "const fs = require('node:fs')\n", 'node:fs'],
    ['a require taken apart', "const { promises } = require('node:fs')\n", 'promises'],
    ['a dynamic import', "const fs = await import('node:fs/promises')\n", 'node:fs'],
    ['a dynamic import in backticks', 'const fs = await import(`node:fs`)\n', 'node:fs'],
  ])(
    'a raw read planted in a file tool of the repository fails the check: %s',
    (_, source, found) => {
      expect(plantedIn(source)).toMatchObject([
        { file: 'apps/desktop/src/engine/tools/planted.ts', found },
      ])
    },
  )

  test('the exception for a judged call’s file planted in a file tool fails the check', () => {
    expect(plantedIn('const withholding = Withholding.asked(judged)\n')).toMatchObject([
      { file: 'apps/desktop/src/engine/tools/planted.ts', found: 'Withholding.asked' },
    ])
  })
})

describe('The engine reads a file of a place on its own behalf through the judged open only (#434, #439)', () => {
  /** The refusals of a repository whose file `file` (under the engine) holds `source`. */
  const plantedAt = (file: string, source: string) => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
    try {
      const path = join(root, 'apps', 'desktop', 'src', 'engine', file)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, source)
      return analyze(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  test.each([
    [
      'building/proof-runner.ts',
      "import { existsSync, readFileSync } from 'node:fs'\n",
      'readFileSync',
    ],
    ['building/snapshots.ts', "import { copyFileSync, statSync } from 'node:fs'\n", 'copyFileSync'],
    ['building/snapshots.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
    ['building/documenter.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
    ['review/diffs.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
    ['permissions/order.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
    ['sessions/instructions.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
    ['delivery-rules.ts', "import { readFileSync } from 'node:fs'\n", 'readFileSync'],
  ])('a raw read planted in %s fails the check', (file, source, found) => {
    expect(plantedAt(file, source)).toMatchObject([
      { file: `apps/desktop/src/engine/${file}`, found },
    ])
  })

  test('a copy is a read: planted in a file tool, it fails the check', () => {
    expect(
      plantedAt('tools/planted.ts', "import { copyFile } from 'node:fs/promises'\n"),
    ).toMatchObject([{ file: 'apps/desktop/src/engine/tools/planted.ts', found: 'copyFile' }])
  })

  test('what reads no content is not refused there: a stat, a write, a removal', () => {
    const source =
      "import { lstatSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'\n"
    expect(plantedAt('building/snapshots.ts', source)).toEqual([])
  })

  test('the fingerprint of a file is read through the judged open too: no file tool reads by itself', () => {
    const fingerprint = "import { type FileHandle, open } from 'node:fs/promises'\n"
    expect(readRefusalsOf('apps/desktop/src/engine/tools/read.ts', fingerprint)).toHaveLength(1)
  })
})
