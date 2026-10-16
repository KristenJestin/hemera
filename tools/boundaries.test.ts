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

  test('the judged open reads, and the fingerprint of a file is read without handing its content', () => {
    const read = "import { open, readFile } from 'node:fs/promises'\n"
    expect(readRefusalsOf('apps/desktop/src/engine/tools/judged.ts', read)).toEqual([])
    const fingerprint = "import { type FileHandle, open } from 'node:fs/promises'\n"
    expect(readRefusalsOf('apps/desktop/src/engine/tools/read.ts', fingerprint)).toEqual([])
    expect(readRefusalsOf('apps/desktop/src/engine/tools/read.ts', read)).toHaveLength(1)
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

  test('a raw read planted in a file tool of the repository fails the check', () => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-boundaries-'))
    try {
      const tools = join(root, 'apps', 'desktop', 'src', 'engine', 'tools')
      mkdirSync(tools, { recursive: true })
      writeFileSync(join(tools, 'planted.ts'), "import { readFile } from 'node:fs/promises'\n")
      expect(analyze(root)).toMatchObject([
        { file: 'apps/desktop/src/engine/tools/planted.ts', found: 'readFile' },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
