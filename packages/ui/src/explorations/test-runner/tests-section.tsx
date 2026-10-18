import type { ReactNode } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { markIcon } from '../../components/project-mark/mark-icons.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconChevronRight,
  IconFolder,
  IconPencil,
  IconTestPipe,
} from '../../icons.ts'
import { FormFoot, Section } from '../../blocks/project-settings/parts.tsx'
import { REPOSITORIES } from '../../blocks/project-settings/project-settings-fixtures.ts'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import {
  GuessSentence,
  InSettings,
  type TestRunnerProps,
  TestsFields,
  problemOf,
  testsOf,
  useTests,
} from './test-runner-parts.tsx'
import {
  RUNNER_WORDS,
  type RepositoryTests,
  reportWords,
  runnerOf,
  testsWords,
} from './test-runner-model.ts'

/** The icon a repository wears in Acme's fixtures, or a folder. */
export function repositoryIcon(repository: string): ReactNode {
  const icon = REPOSITORIES.find((one) => one.path === repository)?.icon
  return icon === undefined ? <IconFolder size="sm" /> : markIcon(icon)
}

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
  const runner = runnerOf(tests)
  return (
    <li className={RULE}>
      <div className={ROW}>
        <button type="button" className={OPEN} aria-label={testsWords(tests)} onClick={onOpen}>
          <span className={PATH}>
            <span className={ICON_ROOM}>{repositoryIcon(tests.repository)}</span>
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

/**
 * Variant A: Tests, a section of its own beside Repositories. A line per repository: the runner
 * in use, a pencil when it is your own, the rule's file or your report path; the line opens the
 * dialog where a value is written, and Back to the guess sits at its end.
 */
export function TestsSection(props: TestRunnerProps): ReactNode {
  const state = useTests(props)
  const { rows, opened, refusal } = state
  const sections = [
    SECTIONS[0],
    {
      id: 'tests',
      label: 'Tests',
      icon: <IconTestPipe size="sm" />,
      problem: problemOf(rows),
    },
    ...SECTIONS.slice(1),
  ].filter((one) => one !== undefined)
  const open = opened === null ? null : testsOf(rows, opened.repository)
  return (
    <InSettings
      sections={sections}
      current="tests"
      onCloseForm={state.close}
      form={
        opened === null || open === null
          ? null
          : {
              title: `Tests of ${opened.repository}`,
              icon: <IconTestPipe size="sm" />,
              body: (
                <>
                  <div className="flex min-h-control-md items-center rounded-md bg-surface-rim px-3 py-2">
                    <GuessSentence tests={open} />
                  </div>
                  <TestsFields
                    repository={opened.repository}
                    draft={opened.draft}
                    onChange={state.change}
                    refusal={refusal}
                  />
                </>
              ),
              footer: <FormFoot onSave={state.save} onCancel={state.close} />,
            }
      }
    >
      <Section label="Tests">
        <SectionHead title="Tests" count={rows.length} />
        <Frame>
          <ColumnsHead />
          <ul aria-label="Tests" className="flex flex-col">
            {rows.map((tests) => (
              <TestsLine
                key={tests.repository}
                tests={tests}
                onOpen={() => state.open(tests.repository)}
                onBack={() => state.back(tests.repository)}
              />
            ))}
          </ul>
        </Frame>
      </Section>
    </InSettings>
  )
}
