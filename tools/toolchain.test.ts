import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')

function runInRepository(command: string[]): { code: number; output: string } {
  const result = Bun.spawnSync(command, { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
  const decoder = new TextDecoder()
  return {
    code: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  }
}

function fileWith(content: string, name: string): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-toolchain-'))
  const path = join(directory, name)
  writeFileSync(path, content)
  return { directory, path }
}

describe('Installation du produit', () => {
  test('the root holds the only lockfile of the monorepo', () => {
    expect(existsSync(join(repository, 'bun.lock'))).toBe(true)
    for (const workspace of ['apps/desktop', 'packages/core', 'packages/runtime', 'packages/ui']) {
      expect(existsSync(join(repository, workspace, 'bun.lock'))).toBe(false)
      expect(existsSync(join(repository, workspace, 'bun.lockb'))).toBe(false)
      expect(existsSync(join(repository, workspace, 'package-lock.json'))).toBe(false)
    }
  })

  test('internal dependencies are declared with the workspace protocol', () => {
    const desktop = JSON.parse(
      readFileSync(join(repository, 'apps', 'desktop', 'package.json'), 'utf8'),
    )
    for (const internal of ['@hemera/core', '@hemera/runtime', '@hemera/ui']) {
      expect(desktop.dependencies[internal]).toBe('workspace:*')
    }
    const runtime = JSON.parse(
      readFileSync(join(repository, 'packages', 'runtime', 'package.json'), 'utf8'),
    )
    expect(runtime.dependencies['@hemera/core']).toBe('workspace:*')
  })

  test('every workspace package declares an explicit export surface', () => {
    for (const workspace of ['packages/core', 'packages/runtime', 'packages/ui']) {
      const manifest = JSON.parse(readFileSync(join(repository, workspace, 'package.json'), 'utf8'))
      expect(manifest.private).toBe(true)
      expect(manifest.exports['.']).toBe('./src/index.ts')
      // A subpath is a declared export, never a reach into the private src.
      for (const [subpath, target] of Object.entries(manifest.exports as Record<string, string>)) {
        expect(subpath.startsWith('.')).toBe(true)
        expect(target.startsWith('./src/')).toBe(true)
      }
    }
  })

  test('tool versions are pinned exactly', () => {
    const root = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
    expect(root.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/)
    for (const [name, range] of Object.entries(root.devDependencies as Record<string, string>)) {
      expect(`${name}@${range}`).toMatch(/@\d+\.\d+\.\d+$/)
    }
  })
})

describe('Lint et format en vérification', () => {
  test('a lint gap fails the root verification', () => {
    const { directory, path } = fileWith('const value: any = 1\nexport default value\n', 'gap.ts')
    try {
      const result = runInRepository(['./node_modules/.bin/oxlint', '-c', '.oxlintrc.json', path])
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('no-explicit-any')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('a format gap fails the root verification', () => {
    const { directory, path } = fileWith('export const value =    1;\n', 'gap.ts')
    try {
      const result = runInRepository([
        './node_modules/.bin/oxfmt',
        '--check',
        '-c',
        '.oxfmtrc.json',
        path,
      ])
      expect(result.code).not.toBe(0)
      expect(result.output).toContain('Format issues found')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('neither ESLint nor Prettier is installed', () => {
    const lock = readFileSync(join(repository, 'bun.lock'), 'utf8')
    expect(lock).not.toMatch(/"(eslint|prettier)@/)
    for (const banned of ['eslint', 'prettier']) {
      expect(existsSync(join(repository, 'node_modules', banned))).toBe(false)
      expect(existsSync(join(repository, `.${banned}rc`))).toBe(false)
      expect(existsSync(join(repository, `.${banned}rc.json`))).toBe(false)
    }
  })

  test('the format check runs in continuous integration', () => {
    const workflow = readFileSync(join(repository, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(workflow).toContain('bun run fmt:check')
    expect(workflow).toContain('bun run lint')
  })
})
