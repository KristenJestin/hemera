/**
 * The Tests of a Project's settings (#421), as #469 drew them: each repository's runner and report,
 * guessed by the engine from its files with the rule that made it, or written by hand in the
 * dialog a line opens. A value is checked by the engine on save and its refusal said under the
 * field it concerns; Back to the guess removes it at once. The guesses are read by the route, so
 * a repository with no runner found marks the section in the list wherever the page stands. A
 * dialog's draft is held outside React's state, so its body and its foot read it in the same
 * render. No Effect here.
 */

import type { TestGuess } from '@hemera/core/domain'
import type { Project } from '@hemera/ipc'
import {
  FormFoot,
  type RepositoryTests,
  type SettingsForm,
  type TestsDraft,
  type TestsRefusal,
  TestsForm,
  TestsSection,
  draftOfTests,
  unchosen,
} from '@hemera/ui'
import { IconTestPipe } from '@hemera/ui/icons'
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { Link } from './link.ts'
import { reportingOfDraft, testsRefusalOf, testsRowsOf } from './tests-settings-model.ts'
import { type ProviderStore, providerStore } from './ticket-providers-model.ts'

/** What the route reads of the Tests: the lines, null on their way, and why they were not read. */
export interface TestsRead {
  readonly rows: RepositoryTests[] | null
  readonly error: string | undefined
}

/**
 * Each repository's guess, read again whenever the Project changes; the last one read stays shown
 * while the next is on its way.
 */
export function useTests(link: Link, engineReady: boolean, project: Project | null): TestsRead {
  const [read, setRead] = useState<{
    guesses: ReadonlyMap<string, TestGuess | null> | null
    error: string | undefined
  }>({ guesses: null, error: undefined })
  const repositories = project?.repositories
  useEffect(() => {
    if (!engineReady || repositories === undefined) return undefined
    let live = true
    Promise.all(
      repositories.map((one) => link.testGuess(one.id).then((guess) => [one.id, guess] as const)),
    ).then(
      (pairs) => {
        if (live) setRead({ guesses: new Map(pairs), error: undefined })
      },
      (failure: Error) => {
        if (live) setRead({ guesses: new Map(), error: failure.message })
      },
    )
    return () => {
      live = false
    }
  }, [link, engineReady, repositories])
  return { rows: testsRowsOf(repositories ?? [], read.guesses), error: read.error }
}

/** What the dialog holds: the repository, its draft, and what the last save was refused. */
interface Edit {
  readonly tests: RepositoryTests
  readonly draft: TestsDraft
  readonly refusal: TestsRefusal | undefined
  readonly foot: string | undefined
  readonly saving: boolean
}

function useStored<T extends object>(store: ProviderStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

function Body({ edit }: { edit: ProviderStore<Edit> }): ReactNode {
  const mine = useStored(edit)
  return (
    <TestsForm
      tests={mine.tests}
      draft={mine.draft}
      onChange={(draft) => edit.set({ draft })}
      refusal={mine.refusal}
    />
  )
}

function Foot({
  edit,
  onSave,
  onCancel,
}: {
  edit: ProviderStore<Edit>
  onSave: () => void
  onCancel: () => void
}): ReactNode {
  const mine = useStored(edit)
  return <FormFoot refused={mine.foot} saving={mine.saving} onSave={onSave} onCancel={onCancel} />
}

export interface TestsPartProps {
  link: Link
  project: Project | null
  tests: TestsRead
  /** Shows a dialog over the page, or closes it with null. */
  show: (form: SettingsForm | null) => void
}

const EMPTY: RepositoryTests = { repository: '', guess: null, custom: null }

/** The Tests section and its dialog, written to the engine. */
export function TestsPart({ link, project, tests, show }: TestsPartProps): ReactNode {
  const [edit] = useState(() =>
    providerStore<Edit>({
      tests: EMPTY,
      draft: draftOfTests(EMPTY),
      refusal: undefined,
      foot: undefined,
      saving: false,
    }),
  )
  /** Why the last Back to the guess was refused, in words. */
  const [refused, setRefused] = useState<string | undefined>(undefined)
  // A save is written on the Project's version as it stands then, not as the dialog opened.
  const latest = useRef(project)
  useEffect(() => {
    latest.current = project
  }, [project])
  const idOf = (path: string) =>
    latest.current?.repositories.find((one) => one.path === path)?.id ?? null

  const save = (): void => {
    const { tests: row, draft, saving } = edit.get()
    const id = idOf(row.repository)
    const version = latest.current?.version
    if (saving || id === null || version === undefined) return
    const missing = unchosen(row.repository, draft)
    if (missing !== undefined || draft.runner === null) {
      edit.set({ refusal: missing, foot: undefined })
      return
    }
    edit.set({ saving: true, refusal: undefined, foot: undefined })
    const reporting = reportingOfDraft({ ...draft, runner: draft.runner })
    link.setTestReporting({ id, version, reporting }).then(
      () => {
        edit.set({ saving: false })
        show(null)
      },
      (failure: Error) => {
        const said = testsRefusalOf(failure)
        edit.set({ saving: false, refusal: said.field, foot: said.foot })
      },
    )
  }

  const open = (repository: string): void => {
    const row = tests.rows?.find((one) => one.repository === repository)
    if (row === undefined) return
    edit.set({
      tests: row,
      draft: draftOfTests(row),
      refusal: undefined,
      foot: undefined,
      saving: false,
    })
    show({
      title: `Tests of ${repository}`,
      icon: <IconTestPipe size="sm" />,
      body: <Body edit={edit} />,
      footer: <Foot edit={edit} onSave={save} onCancel={() => show(null)} />,
    })
  }

  const back = (repository: string): void => {
    const id = idOf(repository)
    const version = latest.current?.version
    if (id === null || version === undefined) return
    setRefused(undefined)
    link
      .setTestReporting({ id, version, reporting: null })
      .catch((failure: Error) => setRefused(failure.message))
  }

  return (
    <TestsSection tests={tests.rows} error={refused ?? tests.error} onOpen={open} onBack={back} />
  )
}
