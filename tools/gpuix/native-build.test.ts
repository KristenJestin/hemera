import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { VENDOR_VERSION, declaredNames, truncatedNames } from './build-native.ts'
import type { NativeBuildRecord } from './build-native.ts'

const repository = resolve(import.meta.dir, '..', '..')
const nativeRoot = join(repository, 'vendor', 'gpuix', VENDOR_VERSION, 'native')

function recordsBuiltHere(): NativeBuildRecord[] {
  if (!existsSync(nativeRoot)) return []
  return readdirSync(nativeRoot)
    .map((directory) => join(nativeRoot, directory, 'build.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as NativeBuildRecord)
}

describe('Démarrage applicatif', () => {
  test('a native addon was produced and loaded for this host', () => {
    const records = recordsBuiltHere()
    expect(records.length).toBeGreaterThan(0)
    const host = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.platform
    const hostRecords = records.filter((record) => record.target.includes(host))
    expect(hostRecords.length).toBeGreaterThan(0)
    for (const record of hostRecords) {
      expect(record.load.ok).toBe(true)
      expect(record.load.exports).toContain('GpuixRenderer')
      expect(record.addon.bytes).toBeGreaterThan(0)
      expect(record.addon.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  test('each build records the system and toolchain that produced it', () => {
    for (const record of recordsBuiltHere()) {
      expect(record.environment.os.platform).not.toBe('')
      expect(record.environment.toolchain.rustc).toMatch(/^rustc \d+\.\d+\.\d+/)
      expect(record.environment.toolchain.cargo).toMatch(/^cargo \d+\.\d+\.\d+/)
      expect(record.environment.toolchain.bun).toMatch(/^\d+\.\d+\.\d+/)
    }
  })

  test('the addon and its bindings are staged next to their record', () => {
    for (const record of recordsBuiltHere()) {
      const directory = join(nativeRoot, `${record.target}-${record.variant}`)
      expect(existsSync(join(directory, record.addon.file))).toBe(true)
      expect(existsSync(join(directory, 'index.js'))).toBe(true)
      expect(existsSync(join(directory, 'index.d.ts'))).toBe(true)
    }
  })
})

describe('Paquet incompatible', () => {
  test('the recorded target names the platform the addon was built for', () => {
    for (const record of recordsBuiltHere()) {
      expect(record.target).toMatch(/^(x86_64|aarch64)-/)
      expect(record.addon.file).toContain('.node')
    }
  })
})

describe('Types générés', () => {
  test('the product surface survives generation in every built variant', () => {
    for (const record of recordsBuiltHere()) {
      const lost = record.truncatedNames.filter(
        (name) => name === 'GpuixRenderer' || name.startsWith('GpuixRenderer.'),
      )
      expect(lost).toEqual([])
    }
  })

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
