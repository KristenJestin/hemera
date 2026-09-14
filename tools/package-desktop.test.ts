import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { TARGETS, targetOfHost } from './environment-report.ts'
import {
  SYSTEM_REQUIREMENTS,
  assemblePackage,
  executableNameOf,
  packageNameOf,
} from './package-desktop.ts'

const repository = resolve(import.meta.dir, '..')

/**
 * A package assembled by this run, in a directory of its own.
 *
 * The suite assembles what it checks rather than reading what a previous run left in `dist`:
 * a fresh checkout has no `dist`, and a stale one would be checked instead of the sources.
 */
let assembled: string
let output: string

beforeAll(async () => {
  output = mkdtempSync(join(tmpdir(), 'hemera-package-'))
  assembled = (await assemblePackage(repository, 'prod', output)).directory
}, 300_000)

afterAll(() => {
  rmSync(output, { recursive: true, force: true })
})

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
    const directory = assembled
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

    const document = readFileSync(join(assembled, 'SYSTEM-REQUIREMENTS.md'), 'utf8')
    for (const line of SYSTEM_REQUIREMENTS[targetOfHost()]) {
      expect(document).toContain(line)
    }
  })
})

describe('Aucune mise à jour implicite', () => {
  test('the package says an update is a replacement, and promises no updater', () => {
    const document = readFileSync(join(assembled, 'SYSTEM-REQUIREMENTS.md'), 'utf8')
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
    const executable = join(assembled, executableNameOf(targetOfHost()))
    const bytes = readFileSync(executable).toString('latin1')
    expect(bytes).not.toContain('spikes')
    expect(bytes).not.toContain('gpuix-fork')
  })
})

describe('Copie embarquée', () => {
  test('the package embeds no database it could open as the profile', () => {
    const directory = assembled
    const shipped = readdirSync(directory)
    expect(shipped.some((entry) => entry.endsWith('.db'))).toBe(false)
    expect(shipped.some((entry) => entry.endsWith('.sqlite'))).toBe(false)

    // The profile is resolved per system, never from the folder the package sits in.
    const profile = readFileSync(
      join(repository, 'packages', 'runtime', 'src', 'platform', 'profile.ts'),
      'utf8',
    )
    expect(profile).toContain('LOCALAPPDATA')
    expect(profile).toContain('XDG_DATA_HOME')
    expect(profile).not.toContain('execPath')
    expect(profile).not.toContain('import.meta.dir')
  })
})

describe('Mesure de spike présentée comme preuve', () => {
  test('a report describes the target it was produced on, and no other', () => {
    const report = readFileSync(
      join(repository, 'reports', `environment-${targetOfHost()}.md`),
      'utf8',
    )
    expect(report).toContain(targetOfHost())
    expect(report).toContain('describes this machine only')

    // No measurement of a spike is cited as a verification of this target.
    expect(report).not.toContain('spike')
    expect(report).not.toContain('/spikes/')
  })

  test('nothing of the monorepo reads a spike', () => {
    const found = Bun.spawnSync(['git', 'grep', '-l', 'spikes/'], {
      cwd: repository,
      stdout: 'pipe',
    })
    const files = new TextDecoder()
      .decode(found.stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // The traceability tooling names the rule; it does not read a spike.
      .filter((line) => !line.startsWith('tools/'))
    expect(files).toEqual([])
  })
})
