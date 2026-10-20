/**
 * The Tests of a Project's settings (#421), as the window draws and writes them: each repository's
 * guess, read from the engine with the file whose rule made it, beside the value written by hand
 * its Project holds; a draft turned into the value the engine checks and stores; and where the
 * engine's refusal is said. No Effect here.
 */

import type { TestGuess, TestReporting } from '@hemera/core/domain'
import { type Repository, TestReportingRefused } from '@hemera/ipc'
import {
  RUNNERS,
  type RepositoryTests,
  type TestsCustom,
  type TestsDraft,
  type TestsRefusal,
  type TestsRunner,
} from '@hemera/ui'

/** A runner the section knows: every runner of the engine but `unknown`. */
const runnerOf = (runner: TestReporting['runner']): TestsRunner | null =>
  RUNNERS.find((one) => one === runner) ?? null

const customOf = (reporting: TestReporting | null): TestsCustom | null => {
  const runner = reporting === null ? null : runnerOf(reporting.runner)
  if (reporting === null || runner === null) return null
  return { runner, report: reporting.report ?? null }
}

/**
 * The lines of the section, a repository each, in the Project's order; null while the guesses are
 * on their way.
 */
export function testsRowsOf(
  repositories: ReadonlyArray<Repository>,
  guesses: ReadonlyMap<string, TestGuess | null> | null,
): RepositoryTests[] | null {
  if (guesses === null) return null
  return repositories.map((repository) => {
    const guessed = guesses.get(repository.id) ?? null
    const runner = guessed === null ? null : runnerOf(guessed.runner)
    return {
      repository: repository.path,
      guess: guessed === null || runner === null ? null : { runner, from: guessed.from },
      custom: customOf(repository.testReporting),
    }
  })
}

/** The value a draft whose runner is chosen writes: Hemera's own report, or one at a path. */
export function reportingOfDraft(
  draft: TestsDraft & { readonly runner: TestsRunner },
): TestReporting {
  if (draft.report === 'hemera') return { runner: draft.runner }
  return { runner: draft.runner, report: { format: draft.report, path: draft.path } }
}

/** Where a refusal of the dialog is said: under its field, or at the foot. */
export interface TestsSaid {
  readonly field: TestsRefusal | undefined
  readonly foot: string | undefined
}

/** Where a refusal of the dialog is said: under its field for the engine's check, else at the foot. */
export function testsRefusalOf(failure: Error): TestsSaid {
  if (failure instanceof TestReportingRefused) {
    return { field: { field: failure.field, words: failure.reason }, foot: undefined }
  }
  return { field: undefined, foot: failure.message }
}
