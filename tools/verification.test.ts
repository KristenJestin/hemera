import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

// The tests that write a deliberate error into the sources live in this one file, so they run one
// after the other: a zod import left in packages/core by one would be a second error in the
// type check of the other, and its output would no longer name only its own.

const repository = resolve(import.meta.dirname, '..')

// A bound is ten times what the slowest of these runs took alone on a busy machine, never the
// time it takes on an idle one (#355): the type check of one small package, and the lint of one file.
const TYPECHECK_BOUND = 60_000
const LINT_BOUND = 30_000

interface Manifest {
  name: string
  scripts: Record<string, string>
}

// SAFETY: a manifest of this repository, read for the name and the scripts it declares.
const readManifest = (folder: string) =>
  JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as Manifest

// The folders `pnpm-workspace.yaml` lists with a glob (`apps/*`, `packages/*`).
const workspacePackages = () =>
  ['apps', 'packages'].flatMap((parent) =>
    readdirSync(join(repository, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name))
      .filter((folder) => existsSync(join(repository, folder, 'package.json'))),
  )

describe('Vérification unique', () => {
  test('one command chains the four verifications and stops at the first failure', () => {
    const manifest = readManifest(repository)
    expect(manifest.scripts.check).toBe(
      'pnpm typecheck && pnpm lint && pnpm fmt:check && pnpm test',
    )
  })

  test('the root type check reaches every package of the workspace', () => {
    // The chain is a single `vp run` over the workspace, so the test reads it instead of running
    // it: the type check of every package, with the root alone left out.
    const root = readManifest(repository)
    expect(root.scripts.typecheck).toBe(`vp run --filter !${root.name} typecheck`)
    const unreached = workspacePackages().filter(
      (folder) => readManifest(join(repository, folder)).scripts.typecheck === undefined,
    )
    expect(unreached).toEqual([])
  })

  test(
    'a type error in a package fails its type check, naming the package and the file',
    () => {
      // The root `typecheck` runs every package; the error is written into the smallest one and
      // only that one is checked, which a type error there reaches just the same.
      const path = join(repository, 'packages', 'core', 'src', 'deliberate-type-error.ts')
      writeFileSync(path, "export const broken: number = 'not a number'\n")
      try {
        // One command string, not a command and its arguments: a shell concatenates them
        // anyway, and Node warns about what it cannot escape on the way.
        const result = spawnSync('pnpm --filter @hemera/core typecheck', {
          cwd: repository,
          encoding: 'utf8',
          shell: true,
        })
        const output = `${result.stdout}${result.stderr}`
        expect(result.status).not.toBe(0)
        // pnpm prints the folder with the separators of the system.
        expect(output).toMatch(/packages[\\/]core/)
        expect(output).toContain('deliberate-type-error.ts')
      } finally {
        rmSync(path, { force: true })
      }
      // 1 to 3 s for this package alone, 12 s for the largest of the library packages: the bound is
      // ten times the slowest of the former.
    },
    TYPECHECK_BOUND,
  )
})

describe('zod is forbidden', () => {
  test('the root lint starts with the lint of the sources', () => {
    // The chain of `lint` also runs the repository's own checks, so the test reads it instead of
    // running it: the sources are linted first, and what fails there fails `pnpm lint`.
    expect(readManifest(repository).scripts.lint).toMatch(/^vp lint && /)
  })

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
        // Only the file with the error, through the lint `pnpm lint` starts with. One command
        // string, not a command and its arguments: a shell concatenates them anyway. The JSON
        // report is the one that always carries the help line.
        const report = spawnSync(
          `pnpm exec vp lint --format json ${folder}/deliberate-zod-import.ts`,
          { cwd: repository, encoding: 'utf8', shell: true },
        )
        expect(report.status).not.toBe(0)
        expect(report.stdout).toContain('deliberate-zod-import.ts')
        expect(report.stdout).toContain('no-restricted-imports')
        expect(report.stdout).toContain('"help": "No zod in Hemera: validate with Effect `Schema`')
      } finally {
        rmSync(path, { force: true })
      }
    },
    LINT_BOUND,
  )
})
