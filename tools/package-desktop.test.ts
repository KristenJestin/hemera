import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { TARGETS, targetOfHost } from './environment-report.ts'
import { SYSTEM_REQUIREMENTS, executableNameOf, packageNameOf } from './package-desktop.ts'

const repository = resolve(import.meta.dir, '..')

/** Every source file of the application, at any depth. */
function sourcesUnder(folder: string): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry)
    return statSync(path).isDirectory() ? sourcesUnder(path) : [path]
  })
}

describe('Installation dans un dossier choisi', () => {
  test('a package is a folder that names its channel and its target', () => {
    expect(packageNameOf('prod', TARGETS['win32-x64'])).toBe('hemera-prod-x86_64-pc-windows-msvc')
    expect(packageNameOf('dev', TARGETS['linux-x64'])).toBe('hemera-dev-x86_64-unknown-linux-gnu')
    expect(executableNameOf(TARGETS['win32-x64'])).toBe('hemera.exe')
    expect(executableNameOf(TARGETS['linux-x64'])).toBe('hemera')
  })

  test('the package assembled on this machine is the one of its target', () => {
    const directory = join(repository, 'dist', packageNameOf('prod', targetOfHost()))
    expect(existsSync(directory)).toBe(true)

    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
      channel: string
      target: string
      executable: string
      sha256: string
      fork: { version: string; head: string }
    }
    expect(manifest.channel).toBe('prod')
    expect(manifest.target).toBe(targetOfHost())
    expect(existsSync(join(directory, manifest.executable))).toBe(true)
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.fork.version).not.toBe('unknown')
  })
})

describe('Dépendance système manquante', () => {
  test('each target ships the list of what it needs, and names what is not known', () => {
    expect(SYSTEM_REQUIREMENTS[TARGETS['linux-x64']].join(' ')).toContain('libxkbcommon')
    expect(SYSTEM_REQUIREMENTS[TARGETS['linux-x64']].join(' ')).toContain('Vulkan')

    // Windows prerequisites are an open point of the lot, written as such.
    expect(SYSTEM_REQUIREMENTS[TARGETS['win32-x64']].join(' ')).toContain('open point')

    const document = readFileSync(
      join(repository, 'dist', packageNameOf('prod', targetOfHost()), 'SYSTEM-REQUIREMENTS.md'),
      'utf8',
    )
    for (const line of SYSTEM_REQUIREMENTS[targetOfHost()]) {
      expect(document).toContain(line)
    }
  })
})

describe('Aucune mise à jour implicite', () => {
  test('the package says an update is a replacement, and promises no updater', () => {
    const document = readFileSync(
      join(repository, 'dist', packageNameOf('prod', targetOfHost()), 'SYSTEM-REQUIREMENTS.md'),
      'utf8',
    )
    expect(document).toContain('Replace the whole package folder')
    expect(document).toContain('no auto-updater')
    expect(document).toContain('downloads nothing and installs')
  })

  test('nothing in the application fetches anything at start-up', () => {
    const sources = [
      ...sourcesUnder(join(repository, 'apps', 'desktop', 'src')),
      ...sourcesUnder(join(repository, 'packages', 'runtime', 'src')),
    ].filter((path) => path.endsWith('.ts') || path.endsWith('.tsx'))

    for (const path of sources) {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('fetch(')
      expect(source).not.toContain('https://')
    }
  })
})

describe('Aucune dépendance aux spikes', () => {
  test('the assembled executable carries no path of a spike', () => {
    const executable = join(
      repository,
      'dist',
      packageNameOf('prod', targetOfHost()),
      executableNameOf(targetOfHost()),
    )
    const bytes = readFileSync(executable).toString('latin1')
    expect(bytes).not.toContain('spikes')
    expect(bytes).not.toContain('gpuix-fork')
  })
})
