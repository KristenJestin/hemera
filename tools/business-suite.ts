#!/usr/bin/env bun
/**
 * Keeps the business suite runnable without a graphical session and without a credential.
 *
 * The root `test` command is what a machine with no GPU, no window server and no provider key
 * runs. A test that opens a window, reaches a provider or migrates the profile the user works
 * in does not belong to it: it belongs to `test:system`, which is run where those things exist.
 *
 *   bun tools/business-suite.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Packages whose `tests` folder the root command runs. */
const PACKAGES = ['apps/desktop', 'packages/core', 'packages/runtime', 'packages/ui']

/** What a business test may never reach. */
const FORBIDDEN = [
  { pattern: '@gpuix/react', reason: 'it would need the renderer, so a graphical session' },
  { pattern: 'createTestRoot', reason: 'it would open a window' },
  { pattern: 'captureScreenshot', reason: 'it would need a GPU' },
  { pattern: 'api.anthropic.com', reason: 'it would call a provider' },
  { pattern: 'api.openai.com', reason: 'it would call a provider' },
  { pattern: 'ANTHROPIC_API_KEY', reason: 'it would need a credential' },
]

export interface SuiteViolation {
  file: string
  problem: string
}

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((entry) => {
    const path = join(folder, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

/** The command a package answers `test` with. */
function testScriptOf(repositoryRoot: string, workspace: string): string {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, workspace, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> }
  return manifest.scripts?.test ?? ''
}

export function suiteViolations(repositoryRoot: string): SuiteViolation[] {
  const violations: SuiteViolation[] = []

  for (const workspace of PACKAGES) {
    const script = testScriptOf(repositoryRoot, workspace)
    // A bare folder name is a substring filter: `tests` also matches `system-tests`.
    if (!script.includes('./tests')) {
      violations.push({
        file: join(workspace, 'package.json'),
        problem: `its test command is "${script}", which does not name ./tests as a path`,
      })
    }

    for (const path of filesUnder(join(repositoryRoot, workspace, 'tests'))) {
      if (!path.endsWith('.ts') && !path.endsWith('.tsx')) continue
      const file = relative(repositoryRoot, path).replaceAll('\\', '/')
      // A type-only import is erased before the process runs: it loads nothing.
      const source = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('import type'))
        .join('\n')

      for (const { pattern, reason } of FORBIDDEN) {
        if (source.includes(pattern)) {
          violations.push({ file, problem: `it names ${pattern}: ${reason}` })
        }
      }

      // A test that opens a profile opens a temporary one, never the profile of the user.
      if (source.includes('openProfile(') && !source.includes('mkdtempSync')) {
        violations.push({
          file,
          problem: 'it opens a profile without creating a temporary directory for it',
        })
      }
    }
  }

  return violations
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, '..')
  const violations = suiteViolations(repositoryRoot)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.file}: ${violation.problem}`)
    }
    console.error(`\n${violations.length} test(s) keep the business suite off a headless machine`)
    process.exit(1)
  }
  console.log('the business suite needs no GPU, no window and no credential')
}
