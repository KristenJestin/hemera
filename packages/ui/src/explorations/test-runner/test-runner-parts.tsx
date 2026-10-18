// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Input } from '../../components/field/field.tsx'
import { Select } from '../../components/select/select.tsx'
import { IconAlertTriangle, IconFileText, IconSettings, IconTestPipe } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { MAIN_CHECKOUT } from '../../blocks/project-settings/project-settings-fixtures.ts'
import {
  ProjectSettings,
  type SettingsForm,
  type SettingsSection,
} from '../../surfaces/project-settings/project-settings.tsx'
import {
  type Opened,
  RUNNERS,
  RUNNER_WORDS,
  type Refusal,
  type RepositoryTests,
  type TestsDraft,
  draftOf,
  hemeraReportWords,
  refusalOf,
  reportChoices,
  savedOf,
} from './test-runner-model.ts'

/**
 * What the three variants share: the settings page around them, the state a story holds, the
 * sentence of a guess and the fields a value is written in.
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

export interface InSettingsProps {
  sections: readonly SettingsSection[]
  current: string
  form?: SettingsForm | null | undefined
  onCloseForm?: (() => void) | undefined
  children: ReactNode
}

/** Acme's settings around a variant, under the window's header, as the surface draws them. */
export function InSettings({
  sections,
  current,
  form = null,
  onCloseForm = () => {},
  children,
}: InSettingsProps): ReactNode {
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[
          { id: 'project', label: 'Acme', onPress: () => {} },
          { id: 'settings', label: 'Settings', icon: <IconSettings size="sm" /> },
        ]}
        controls={<SystemControls />}
      />
      <ProjectSettings
        name="Acme"
        mainCheckout={MAIN_CHECKOUT}
        sections={sections}
        current={current}
        onSection={() => {}}
        onRetry={() => {}}
        form={form}
        onCloseForm={onCloseForm}
      >
        {children}
      </ProjectSettings>
    </main>
  )
}

const RULE = 'font-mono text-xs'

/** The guess in a sentence: the runner, the file whose rule named it, and its report. */
export function GuessSentence({ tests }: { tests: RepositoryTests }): ReactNode {
  const { guess } = tests
  if (guess === null) {
    // In the text's own colour: the warning's ink is too faint on the rim's ground.
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="flex shrink-0 text-warning">
          <IconAlertTriangle size="sm" aria-hidden="true" />
        </span>
        No runner found
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-start gap-1.5 text-sm text-muted-foreground">
      <span className="flex h-control-text shrink-0 items-center">
        <IconTestPipe size="sm" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="font-medium text-foreground">{RUNNER_WORDS[guess.runner]}</span>, guessed
        from <span className={RULE}>{guess.from}</span> · {hemeraReportWords(guess.runner)}
      </span>
    </span>
  )
}

const REFUSED = 'text-xs text-destructive-muted-foreground'

/** A refusal under a select, which has no error of its own. */
function Refused({ refusal, field }: { refusal: Refusal | undefined; field: Refusal['field'] }) {
  if (refusal?.field !== field) return null
  return (
    <p role="alert" className={REFUSED}>
      {refusal.words}
    </p>
  )
}

export interface TestsFieldsProps {
  repository: string
  draft: TestsDraft
  onChange: (draft: TestsDraft) => void
  refusal: Refusal | undefined
  /** Side by side, in a line that unfolds; one under the other, in a dialog. */
  across?: boolean | undefined
}

/**
 * The fields of a value written by hand: the runner, the report it writes, and, for a report at a
 * path, that path from the root of the repository. The path unfolds when a file is chosen.
 */
export function TestsFields({
  repository,
  draft,
  onChange,
  refusal,
  across = false,
}: TestsFieldsProps): ReactNode {
  const folding = useTransition(fold)
  const atPath = draft.report !== 'hemera'
  const path = (
    <Input
      label="Report path"
      description={across ? undefined : `From the root of ${repository}; written by the run.`}
      icon={<IconFileText size="sm" />}
      placeholder="reports/junit.xml"
      value={draft.path}
      onValueChange={(next) => onChange({ ...draft, path: next })}
      error={refusal?.field === 'path' ? refusal.words : undefined}
    />
  )
  return (
    <div className={across ? 'grid grid-cols-3 items-start gap-3' : 'flex flex-col gap-4'}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium" aria-hidden="true">
          Runner
        </span>
        <Select
          label="Runner"
          className="w-full"
          value={draft.runner}
          placeholder="Choose a runner"
          mark={<IconTestPipe size="sm" />}
          onValueChange={(runner) => onChange({ ...draft, runner })}
          items={RUNNERS.map((runner) => ({ value: runner, label: RUNNER_WORDS[runner] }))}
        />
        <Refused refusal={refusal} field="runner" />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium" aria-hidden="true">
          Report
        </span>
        <Select
          label="Report"
          className="w-full"
          value={draft.report}
          onValueChange={(report) => onChange({ ...draft, report })}
          items={reportChoices(draft.runner)}
        />
        <Refused refusal={refusal} field="report" />
      </div>
      {across ? (
        // In a line the path keeps its column, so nothing beside it moves when it comes.
        <div className="min-w-0">{atPath && path}</div>
      ) : (
        <AnimatePresence initial={false}>
          {atPath && (
            <motion.div
              key="path"
              className="-mt-4 overflow-hidden"
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={folding}
            >
              <div className="pt-4">{path}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
