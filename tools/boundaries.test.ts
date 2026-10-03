import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { analyze, importsOf, refusalsOf } from './boundaries.ts'

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

  test('a module whose name only starts like Electron is not refused', () => {
    expect(refusalsOf('packages/ipc/src/link.ts', "import x from 'electron-store'\n")).toEqual([])
  })
})
