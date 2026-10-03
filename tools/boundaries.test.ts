import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { analyze, importsOf, refusalsOf, storageRefusalsOf } from './boundaries.ts'

const repository = resolve(import.meta.dirname, '..')

describe('The shared packages stay free of Electron', () => {
  test('no shared package of the repository imports Electron or React', () => {
    expect(analyze(repository)).toEqual([])
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
