import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { NATIVE_PACKAGE, absent, builtAddons, nativeBuilt } from './available.ts'
import { declaredNames, truncatedNames } from './build-native.ts'

/** The addon is compiled here or it is not: a checkout carries the fork, not the build. */
const hasNative = nativeBuilt()
if (!hasNative) absent('the compiled native addon', 'bun tools/gpuix/build-native.ts')

describe('Démarrage applicatif', () => {
  test.skipIf(!hasNative)('the addon of this host loads and carries the renderer', () => {
    const native = require('@gpuix/native') as Record<string, unknown>
    expect(typeof native['GpuixRenderer']).toBe('function')
    // What the product itself calls: without these the first window paints no text and the
    // application cannot tell a real window from a headless one.
    expect(typeof native['addFonts']).toBe('function')
    expect(typeof native['windowBackend']).toBe('function')
  })

  test.skipIf(!hasNative)('the addon sits beside the bindings that describe it', () => {
    expect(existsSync(join(NATIVE_PACKAGE, 'index.js'))).toBe(true)
    expect(existsSync(join(NATIVE_PACKAGE, 'index.d.ts'))).toBe(true)
  })
})

describe('Paquet incompatible', () => {
  test.skipIf(!hasNative)('the addon file names the platform it was built for', () => {
    for (const addon of builtAddons()) {
      // napi names the file after the target it produced, so an addon built elsewhere is
      // told apart from this host's before anything tries to load it.
      expect(addon).toMatch(/^gpuix-native\.(win32|linux|darwin)-[a-z0-9]+(-[a-z]+)?\.node$/)
    }
  })
})

describe('Types générés', () => {
  test('a generation that drops a declaration is reported by name', () => {
    const tracked = [
      'export declare class GpuixRenderer {',
      '  constructor(width?: number)',
      '  applyBatch(json: string): void',
      '}',
      'export declare class TestGpuixRenderer {',
      '  flush(): void',
      '}',
      'export interface Options {',
    ].join('\n')
    const generated = [
      'export declare class GpuixRenderer {',
      '  constructor(width?: number)',
      '  applyBatch(json: string): void',
      '}',
      'export interface Options {',
    ].join('\n')

    expect(declaredNames(tracked)).toContain('TestGpuixRenderer.flush')
    expect(truncatedNames(tracked, generated)).toEqual([
      'TestGpuixRenderer',
      'TestGpuixRenderer.flush',
    ])
    expect(truncatedNames(tracked, tracked)).toEqual([])
  })
})
