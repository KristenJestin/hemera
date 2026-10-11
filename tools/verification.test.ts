import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

// The tests that write a deliberate error into the sources live in this one file, so they run one
// after the other: a zod import left in packages/core by one stops the workspace's type check
// before it reaches apps/desktop, and the other no longer finds its own error.

const repository = resolve(import.meta.dirname, '..')

describe('Vérification unique', () => {
  test('one command chains the four verifications and stops at the first failure', () => {
    // SAFETY: this repository's own root manifest, read for the script it declares.
    const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(manifest.scripts.check).toBe(
      'pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test',
    )
  })

  test('a type error in a package fails it, naming the package and the file', () => {
    // The whole chain cannot run from inside itself — `check` ends in `test`. Its first link
    // is what a type error reaches, and the chain is `&&`: what fails here fails `pnpm check`.
    const path = join(repository, 'apps', 'desktop', 'src', 'main', 'deliberate-type-error.ts')
    writeFileSync(path, "export const broken: number = 'not a number'\n")
    try {
      // One command string, not a command and its arguments: a shell concatenates them
      // anyway, and Node warns about what it cannot escape on the way.
      const result = spawnSync('pnpm typecheck', {
        cwd: repository,
        encoding: 'utf8',
        shell: true,
      })
      const output = `${result.stdout}${result.stderr}`
      expect(result.status).not.toBe(0)
      expect(output).toContain('apps/desktop')
      expect(output).toContain('deliberate-type-error.ts')
    } finally {
      rmSync(path, { force: true })
    }
    // A type check of the workspace, on a runner that has just started: seconds, not the five
    // the suite allows a test by default.
  }, 60_000)
})

describe('zod is forbidden', () => {
  test.each([
    ['apps/desktop/src/main', "import { z } from 'zod'"],
    ['packages/core/src', "import { z } from 'zod'"],
    ['packages/core/src', "import { z } from 'zod/v4'"],
  ])(
    'an import of zod in %s fails the lint and points to Effect Schema',
    (folder, line) => {
      const path = join(repository, folder, 'deliberate-zod-import.ts')
      writeFileSync(path, `${line}\n\nexport const name = z.string()\n`)
      try {
        // One command string, not a command and its arguments: a shell concatenates them anyway.
        const result = spawnSync('pnpm lint', { cwd: repository, encoding: 'utf8', shell: true })
        const output = `${result.stdout}${result.stderr}`
        expect(result.status).not.toBe(0)
        expect(output).toContain('deliberate-zod-import.ts')
        expect(output).toContain('no-restricted-imports')
        // The report format chosen on CI drops the help line; the JSON report always carries it.
        const report = spawnSync(
          `pnpm exec vp lint --format json ${folder}/deliberate-zod-import.ts`,
          { cwd: repository, encoding: 'utf8', shell: true },
        )
        expect(report.stdout).toContain('"help": "No zod in Hemera: validate with Effect `Schema`')
      } finally {
        rmSync(path, { force: true })
      }
    },
    60_000,
  )
})
