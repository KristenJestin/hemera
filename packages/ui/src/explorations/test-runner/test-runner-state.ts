import { useState } from 'react'

import {
  type Opened,
  type RepositoryTests,
  type TestsDraft,
  draftOf,
  refusalOf,
  savedOf,
} from './test-runner-model.ts'

/**
 * The state a story of the test runner holds, as the renderer's hooks will hold it: the tests of
 * each repository, the one opened and its draft, and the refusal of the last save.
 */

export interface TestRunnerProps {
  /** The tests of each repository, as Hemera holds them when the story opens. */
  tests: readonly RepositoryTests[]
  /** The repository opened when the story opens, and what is already written in its fields. */
  open?: Opened | undefined
}

/** The repository's tests, by its path; every story names one of its own. */
export function testsOf(rows: readonly RepositoryTests[], repository: string): RepositoryTests {
  return rows.find((one) => one.repository === repository) ?? rows[0] ?? GUESS_NONE
}

const GUESS_NONE: RepositoryTests = { repository: '', guess: null, custom: null }

/**
 * A small machine around the tests of Acme, so a story walks what a user walks: a repository
 * opened, a value written, saved or refused, and back to the guess.
 */
export function useTests({ tests, open }: TestRunnerProps) {
  const [rows, setRows] = useState(tests)
  const [opened, setOpened] = useState<{ repository: string; draft: TestsDraft } | null>(() =>
    open === undefined
      ? null
      : {
          repository: open.repository,
          draft: open.draft ?? draftOf(testsOf(tests, open.repository)),
        },
  )
  // A refusal is said once a save was tried, and follows the fields from then on.
  const [tried, setTried] = useState(false)
  const refusal = tried && opened !== null ? refusalOf(opened.repository, opened.draft) : undefined
  return {
    rows,
    opened,
    refusal,
    open: (repository: string) => {
      setOpened({ repository, draft: draftOf(testsOf(rows, repository)) })
      setTried(false)
    },
    change: (draft: TestsDraft) => {
      if (opened !== null) setOpened({ ...opened, draft })
    },
    close: () => setOpened(null),
    save: () => {
      if (opened === null) return
      setTried(true)
      if (refusalOf(opened.repository, opened.draft) !== undefined) return
      setRows((before) =>
        before.map((one) =>
          one.repository === opened.repository ? savedOf(one, opened.draft) : one,
        ),
      )
      setOpened(null)
    },
    back: (repository: string) => {
      const guessed = { ...testsOf(rows, repository), custom: null }
      setRows((before) => before.map((one) => (one.repository === repository ? guessed : one)))
      if (opened?.repository === repository) setOpened({ repository, draft: draftOf(guessed) })
      setTried(false)
    },
  }
}

/** The repositories whose runner no rule found, as a section's problem in the list. */
export function problemOf(rows: readonly RepositoryTests[]): string | undefined {
  const none = rows.filter((one) => one.guess === null && one.custom === null)
  return none.length === 0
    ? undefined
    : `no runner found for ${none.map((one) => one.repository).join(', ')}`
}
