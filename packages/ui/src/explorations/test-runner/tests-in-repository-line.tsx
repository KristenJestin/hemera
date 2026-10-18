import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconChevronRight,
  IconGitBranch,
  IconPencil,
  IconPlus,
  IconStack2,
  IconTestPipe,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { Section } from '../../blocks/project-settings/parts.tsx'
import { REPOSITORIES } from '../../blocks/project-settings/project-settings-fixtures.ts'
import { baseOf } from '../../blocks/project-settings/repositories-model.ts'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import {
  GuessSentence,
  InSettings,
  type TestRunnerProps,
  TestsFields,
  problemOf,
  useTests,
} from './test-runner-parts.tsx'
import {
  RUNNER_WORDS,
  type Refusal,
  type RepositoryTests,
  type TestsDraft,
  runnerOf,
} from './test-runner-model.ts'
import { repositoryIcon } from './tests-section.tsx'

const RULE = 'border-b border-border last:border-b-0'

const ROW = 'flex min-w-0 items-center gap-3 pr-2 pl-4'

const CELLS = 'flex min-h-control-lg min-w-0 flex-1 items-center gap-4 py-2 pl-1 text-sm'

const PATH = 'flex w-settings-name min-w-0 shrink-0 items-center gap-2 font-mono font-medium'

const BASE = 'flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs text-muted-foreground'

const ICON_ROOM = 'flex size-icon-md shrink-0 items-center justify-center text-muted-foreground'

/** The runner's cell: the one control of the line here, it unfolds the line's tests. */
const TOGGLE =
  'flex h-control-sm w-settings-name shrink-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const CHEVRON = 'ml-auto flex shrink-0 text-muted-foreground chevron-motion aria-expanded:rotate-90'

const HEAD = 'flex h-control-sm min-w-0 items-center gap-3 border-b border-border pr-2 pl-4'

const HEAD_LINE = 'flex min-w-0 flex-1 items-center gap-4 pl-1 text-xs text-muted-foreground'

/** The line unfolded: on the frame's darker ground, its fields under the line they belong to. */
const UNFOLDED = 'flex flex-col gap-3 border-t border-border bg-surface-rim py-3 pr-4 pl-12'

function ColumnsHead(): ReactNode {
  return (
    <div className={HEAD}>
      <span className={ICON_ROOM}>
        <Legend label="Included in new Workspaces">
          <IconStack2 size="sm" />
        </Legend>
      </span>
      <span className={HEAD_LINE}>
        <span className="w-settings-name shrink-0">Path</span>
        <span className="min-w-0 flex-1">Base</span>
        <span className="w-settings-name shrink-0 px-2">Tests</span>
      </span>
    </div>
  )
}

/** What the runner's cell says to a reader: `Tests of web: vitest, guessed`. */
function toggleWords(tests: RepositoryTests): string {
  const runner = runnerOf(tests)
  if (runner === null) return `Tests of ${tests.repository}: no runner found`
  const where = tests.custom === null ? 'guessed' : 'your own value'
  return `Tests of ${tests.repository}: ${RUNNER_WORDS[runner]}, ${where}`
}

interface LineProps {
  tests: RepositoryTests
  /** The fields, when this line is the one unfolded. */
  draft: TestsDraft | null
  refusal: Refusal | undefined
  onToggle: () => void
  onChange: (draft: TestsDraft) => void
  onSave: () => void
  onBack: () => void
}

function RepositoryLine({
  tests,
  draft,
  refusal,
  onToggle,
  onChange,
  onSave,
  onBack,
}: LineProps): ReactNode {
  const folding = useTransition(fold)
  const repository = REPOSITORIES.find((one) => one.path === tests.repository)
  const runner = runnerOf(tests)
  const open = draft !== null
  return (
    <li className={cn(RULE, 'overflow-hidden')}>
      <div className={ROW}>
        <Checkbox
          checked={repository?.includedByDefault ?? true}
          onCheckedChange={() => {}}
          label={<span className="sr-only">Include {tests.repository} in new Workspaces</span>}
        />
        <span className={CELLS}>
          <span className={PATH}>
            <span className={ICON_ROOM}>{repositoryIcon(tests.repository)}</span>
            <span className="truncate">{tests.repository}</span>
          </span>
          <span className={BASE}>
            <IconGitBranch size="sm" aria-hidden="true" />
            <span className="truncate">{repository === undefined ? '' : baseOf(repository)}</span>
          </span>
          <button
            type="button"
            className={TOGGLE}
            aria-expanded={open}
            aria-label={toggleWords(tests)}
            onClick={onToggle}
          >
            {runner === null ? (
              <>
                <span className="flex shrink-0 text-warning">
                  <IconAlertTriangle size="sm" />
                </span>
                <span className="truncate text-xs text-warning-muted-foreground">
                  No runner found
                </span>
              </>
            ) : (
              <>
                <span className="flex shrink-0 text-muted-foreground">
                  <IconTestPipe size="sm" />
                </span>
                <span className="truncate">{RUNNER_WORDS[runner]}</span>
                {tests.custom !== null && (
                  <span className="flex shrink-0 text-muted-foreground">
                    <IconPencil size="sm" />
                  </span>
                )}
              </>
            )}
            <span className={CHEVRON} aria-expanded={open} aria-hidden="true">
              <IconChevronRight size="sm" />
            </span>
          </button>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {draft !== null && (
          <motion.section
            key="tests"
            aria-label={`Tests of ${tests.repository}`}
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <div className={UNFOLDED}>
              <GuessSentence tests={tests} />
              <TestsFields
                repository={tests.repository}
                draft={draft}
                onChange={onChange}
                refusal={refusal}
                across
              />
              <div className="flex items-center gap-2">
                {tests.custom !== null && (
                  <Button size="sm" variant="ghost" onClick={onBack}>
                    <IconArrowBackUp size="sm" />
                    Back to the guess
                  </Button>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={onToggle}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={onSave}>
                    Save
                  </Button>
                </span>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </li>
  )
}

/**
 * Variant C: the runner is a column of Repositories. Its cell unfolds the line in place, the
 * guess's rule over the fields, saved where they are, with no dialog and no section of its own.
 */
export function TestsInRepositoryLine(props: TestRunnerProps): ReactNode {
  const state = useTests(props)
  const { rows, opened, refusal } = state
  const problem = problemOf(rows)
  const sections = SECTIONS.map((one) =>
    one.id === 'repositories' ? { id: one.id, label: one.label, icon: one.icon, problem } : one,
  )
  return (
    <InSettings sections={sections} current="repositories">
      <Section label="Repositories">
        <SectionHead
          title="Repositories"
          count={rows.length}
          actions={
            <Button size="sm" onClick={() => {}}>
              <IconPlus size="sm" />
              Add a repository
            </Button>
          }
        />
        <Frame>
          <ColumnsHead />
          <ul aria-label="Repositories" className="flex flex-col">
            {rows.map((tests) => (
              <RepositoryLine
                key={tests.repository}
                tests={tests}
                draft={opened?.repository === tests.repository ? opened.draft : null}
                refusal={refusal}
                onToggle={() =>
                  opened?.repository === tests.repository
                    ? state.close()
                    : state.open(tests.repository)
                }
                onChange={state.change}
                onSave={state.save}
                onBack={() => state.back(tests.repository)}
              />
            ))}
          </ul>
        </Frame>
      </Section>
    </InSettings>
  )
}
