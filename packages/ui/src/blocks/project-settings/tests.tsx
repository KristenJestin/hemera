// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import { markIcon } from '../../components/project-mark/mark-icons.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconChevronRight,
  IconFileText,
  IconFolder,
  IconPencil,
  IconTestPipe,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Section, SectionRefusal } from './parts.tsx'
import {
  RUNNERS,
  RUNNER_WORDS,
  type RepositoryTests,
  type TestsDraft,
  type TestsRefusal,
  hemeraReportWords,
  reportChoices,
  reportWords,
  runnerInUse,
  testsWords,
} from './tests-model.ts'

/**
 * The Tests of a Project's settings (#421), as #469 drew them (variant A): a line per repository,
 * the runner in use, a pencil when it is your own, the rule's file and the report; the line opens
 * the dialog where a value is written, and Back to the guess sits at its end.
 */

const ROW = 'flex min-w-0 items-center gap-1 pr-2 pl-2'

const RULE = 'border-b border-border last:border-b-0'

const OPEN =
  'flex min-h-control-lg min-w-0 flex-1 items-center gap-4 rounded-md py-2 pr-3 pl-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const PATH = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-mono font-medium'

const RUNNER = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2'

const QUIET = 'min-w-0 flex-1 truncate text-xs text-muted-foreground'

const ICON_ROOM = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

const ROOM = 'flex size-icon-md shrink-0 items-center justify-center'

const HEAD = 'flex h-control-sm min-w-0 items-center gap-1 border-b border-border pr-2 pl-2'

const HEAD_LINE = 'flex min-w-0 flex-1 items-center gap-4 pr-3 pl-2 text-xs text-muted-foreground'

const TRAILING = 'flex size-control-sm shrink-0 items-center justify-center'

/** The head of the columns; the column of a value written by hand is named by its glyph. */
function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={HEAD_LINE}>
        <span className="w-settings-name shrink-0 pl-6">Repository</span>
        <span className="w-settings-name shrink-0 pl-6">Runner</span>
        <span className={ROOM}>
          <Legend label="Your own value, in place of the guess">
            <span className="flex">
              <IconPencil size="sm" />
            </span>
          </Legend>
        </span>
        <span className="min-w-0 flex-1">From · Report</span>
        <span className="flex size-icon-sm shrink-0" />
      </span>
      <span className={TRAILING} />
    </div>
  )
}

/** Where the value in use comes from, and its report, in the quiet tone. */
function originOf(tests: RepositoryTests): ReactNode {
  if (tests.custom !== null) return reportWords(tests)
  return (
    <>
      <span className="font-mono">{tests.guess?.from}</span> · {reportWords(tests)}
    </>
  )
}

function TestsLine({
  tests,
  onOpen,
  onBack,
}: {
  tests: RepositoryTests
  onOpen: () => void
  onBack: () => void
}): ReactNode {
  const runner = runnerInUse(tests)
  return (
    <li className={RULE}>
      <div className={ROW}>
        <button type="button" className={OPEN} aria-label={testsWords(tests)} onClick={onOpen}>
          <span className={PATH}>
            <span className={ICON_ROOM}>
              {tests.icon === undefined ? <IconFolder size="sm" /> : markIcon(tests.icon)}
            </span>
            <span className="truncate">{tests.repository}</span>
          </span>
          {runner === null ? (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-warning-muted-foreground">
              <span className="flex shrink-0 text-warning">
                <IconAlertTriangle size="sm" aria-hidden="true" />
              </span>
              No runner found
            </span>
          ) : (
            <>
              <span className={RUNNER}>
                <span className={ICON_ROOM}>
                  <IconTestPipe size="sm" />
                </span>
                <span className="truncate">{RUNNER_WORDS[runner]}</span>
              </span>
              <span className={ROOM}>
                {tests.custom !== null && (
                  <span className="flex text-muted-foreground">
                    <IconPencil size="sm" />
                  </span>
                )}
              </span>
              <span className={QUIET}>{originOf(tests)}</span>
            </>
          )}
          <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
            <IconChevronRight size="sm" />
          </span>
        </button>
        <span className={TRAILING}>
          {tests.custom !== null && (
            <Tooltip label="Back to the guess">
              <IconButton
                size="sm"
                variant="ghost"
                icon={<IconArrowBackUp size="sm" />}
                aria-label={`Back to the guess for ${tests.repository}`}
                onClick={onBack}
              />
            </Tooltip>
          )}
        </span>
      </div>
    </li>
  )
}

/** A line on its way, in the shape it most likely takes. */
function TestsLineSkeleton(): ReactNode {
  return (
    <li aria-hidden="true" className={RULE} data-row-skeleton="">
      <div className={ROW}>
        <span className={OPEN}>
          <span className={PATH}>
            <span className={ICON_ROOM}>
              <Skeleton shape="block">
                <IconFolder size="sm" />
              </Skeleton>
            </span>
            <Skeleton>api</Skeleton>
          </span>
          <span className={RUNNER}>
            <span className={ICON_ROOM} />
            <Skeleton>pytest</Skeleton>
          </span>
          <span className={ROOM} />
          <span className={QUIET}>
            <Skeleton>pyproject.toml · JUnit XML report asked by Hemera</Skeleton>
          </span>
        </span>
        <span className={TRAILING} />
      </div>
    </li>
  )
}

export interface TestsSectionProps {
  /** Null: the guesses are on their way. */
  tests: readonly RepositoryTests[] | null
  /** Why the guesses could not be read, in words. */
  error?: string | undefined
  onOpen: (repository: string) => void
  /** Removes the value written by hand: the guess is back. */
  onBack: (repository: string) => void
}

/** Tests, a section of its own beside Repositories: a line per repository. */
export function TestsSection({ tests, error, onOpen, onBack }: TestsSectionProps): ReactNode {
  return (
    <Section label="Tests">
      <SectionHead title="Tests" count={tests === null ? undefined : tests.length} />
      <SectionRefusal error={error} />
      {(tests === null || tests.length > 0) && (
        <Frame>
          <ColumnsHead />
          <ul aria-label="Tests" className="flex flex-col">
            {tests === null
              ? ['a', 'b', 'c'].map((key) => <TestsLineSkeleton key={key} />)
              : tests.map((one) => (
                  <TestsLine
                    key={one.repository}
                    tests={one}
                    onOpen={() => onOpen(one.repository)}
                    onBack={() => onBack(one.repository)}
                  />
                ))}
          </ul>
        </Frame>
      )}
    </Section>
  )
}

/** The guess in a sentence: the runner, the file whose rule named it, and its report. */
function GuessSentence({ tests }: { tests: RepositoryTests }): ReactNode {
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
        from <span className="font-mono text-xs">{guess.from}</span> ·{' '}
        {hemeraReportWords(guess.runner)}
      </span>
    </span>
  )
}

const REFUSED = 'text-xs text-destructive-muted-foreground'

/** A refusal under a select, which has no error of its own. */
function Refused({
  refusal,
  field,
}: {
  refusal: TestsRefusal | undefined
  field: TestsRefusal['field']
}): ReactNode {
  if (refusal?.field !== field) return null
  return (
    <p role="alert" className={REFUSED}>
      {refusal.words}
    </p>
  )
}

export interface TestsFormProps {
  tests: RepositoryTests
  draft: TestsDraft
  onChange: (draft: TestsDraft) => void
  /** What the last save refused, under its field. */
  refusal: TestsRefusal | undefined
}

/**
 * The dialog's body: the guess and its rule at the top, then the runner, the report it writes and,
 * for a report at a path, that path from the root of the repository, which unfolds when a file is
 * chosen.
 */
export function TestsForm({ tests, draft, onChange, refusal }: TestsFormProps): ReactNode {
  const folding = useTransition(fold)
  const atPath = draft.report !== 'hemera'
  return (
    <>
      <div className="flex min-h-control-md items-center rounded-md bg-surface-rim px-3 py-2">
        <GuessSentence tests={tests} />
      </div>
      <div className="flex flex-col gap-4">
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
        <div className="min-w-0">
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
                <div className="pt-4">
                  <Input
                    label="Report path"
                    description={`From the root of ${tests.repository}; written by the run.`}
                    icon={<IconFileText size="sm" />}
                    placeholder="reports/junit.xml"
                    value={draft.path}
                    onValueChange={(next) => onChange({ ...draft, path: next })}
                    error={refusal?.field === 'path' ? refusal.words : undefined}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
