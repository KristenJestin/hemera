/**
 * A repository's test runner and report in Project settings (#421). The guess is read from the
 * names at the repository's root in the main checkout (`guessedTests`); a value written by hand
 * replaces it, checked on save as the proof run checks it again before reading its report: a
 * format the reader reads from the runner, a path that stays inside the repository, through every
 * link on its way, and one Git ignores, or each run would change the repository's tree and its
 * proof never hold. A report that does not exist yet is accepted: the run writes it.
 */

import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import {
  ROOT_REPOSITORY,
  type TestReporting,
  TestReportingRefused,
  guessedTests,
  testReportingRefusal,
} from '@hemera/core/domain'
import type { TestReportingEdit } from '@hemera/ipc'
import { Effect } from 'effect'

import { Git } from './git.ts'
import { changeRepository, getRepository, testReportingText } from './projects.ts'

/** The runner the files at a folder's root point to; null when none does, or it does not read. */
export const guessIn = (folder: string) => {
  try {
    return guessedTests(readdirSync(folder))
  } catch {
    return null
  }
}

/**
 * Whether a path from a repository's root leads outside it: the deepest part of it that exists,
 * every link on its way followed, is not inside the repository's own real folder. A link that
 * leads nowhere leads outside, since what it will lead to is not known.
 */
export const leadsOutside = (root: string, path: string): boolean => {
  let real: string
  try {
    real = realpathSync.native(root)
  } catch {
    return true
  }
  let at = join(root, path)
  while (lstatSync(at, { throwIfNoEntry: false }) === undefined) {
    const up = dirname(at)
    if (up === at) return true
    at = up
  }
  let resolved: string
  try {
    resolved = realpathSync.native(at)
  } catch {
    return true
  }
  const from = relative(real, resolved)
  return from === '..' || from.startsWith(`..${sep}`) || isAbsolute(from)
}

/** The runner a repository's files point to, with the file whose rule named it. */
export const testGuessOf = (id: string) =>
  Effect.map(getRepository(id), ({ project, repository }) =>
    guessIn(join(project.mainCheckout, repository.path)),
  )

/**
 * Sets a repository's runner and report by hand, or goes back to the guess with null; a value that
 * says what the guess says stores nothing. Refused, with the field and the reason, when the reader
 * cannot read it or its report would be written outside the repository.
 */
export const setTestReporting = (edit: TestReportingEdit) =>
  Effect.gen(function* () {
    const located = yield* getRepository(edit.id)
    const { project, repository } = located
    const folder = join(project.mainCheckout, repository.path)
    const name = repository.path === ROOT_REPOSITORY ? project.name : repository.path
    let kept: TestReporting | null = edit.reporting
    if (kept !== null) {
      const refused = testReportingRefusal(name, kept)
      if (refused !== null) return yield* new TestReportingRefused(refused)
      if (kept.report !== undefined) {
        const path = kept.report.path.trim()
        if (leadsOutside(folder, path)) {
          return yield* new TestReportingRefused({
            field: 'path',
            reason: `${path} leads outside ${name} through a link: the report must be written inside it.`,
          })
        }
        // A report Git does not ignore changes the tree at each run: the proof would never hold.
        const ignored = yield* Git.use((git) => git.ignored(folder, path)).pipe(
          Effect.mapError(
            (failure) =>
              new TestReportingRefused({
                field: 'path',
                reason: `Git cannot say whether it ignores ${path} in ${name}: ${failure.message}`,
              }),
          ),
        )
        if (!ignored) {
          return yield* new TestReportingRefused({
            field: 'path',
            reason: `Git does not ignore ${path} in ${name}: add it to .gitignore, or each run changes the repository.`,
          })
        }
        kept = { runner: kept.runner, report: { format: kept.report.format, path } }
      } else if (guessIn(folder)?.runner === kept.runner) {
        kept = null
      }
    }
    return yield* changeRepository(edit, located, { testReporting: testReportingText(kept) })
  })
