// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { IconArrowBackUp, IconGitBranch, IconPencil } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { REMOTES, REPOSITORIES } from '../../blocks/project-settings/project-settings-fixtures.ts'
import {
  RepositoriesSection,
  RepositoryForm,
  type RepositoryDraft,
} from '../../blocks/project-settings/repositories.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import { GuessSentence, InSettings, TestsFields } from './test-runner-parts.tsx'
import { type TestRunnerProps, problemOf, testsOf, useTests } from './test-runner-state.ts'
import type { Refusal, RepositoryTests, TestsDraft } from './test-runner-model.ts'

/** What a repository's own form holds, from Acme's fixtures. */
function repositoryDraft(path: string): RepositoryDraft {
  const repository = REPOSITORIES.find((one) => one.path === path)
  return {
    path,
    icon: repository?.icon,
    includedByDefault: repository?.includedByDefault ?? true,
    remote: repository?.remote ?? null,
    baseBranch: repository?.baseBranch ?? 'develop',
  }
}

const PART = 'flex flex-col gap-3 border-t border-border pt-4'

interface TestsPartProps {
  tests: RepositoryTests
  draft: TestsDraft
  onChange: (draft: TestsDraft) => void
  refusal: Refusal | undefined
  /** Whether the fields are shown: a value of its own, or Set my own pressed. */
  own: boolean
  onOwn: () => void
  onBack: () => void
}

/**
 * The tests, as one more part of a repository's form: the guess in a sentence and Set my own, or
 * the fields of the value written by hand and Back to the guess.
 */
function TestsPart({
  tests,
  draft,
  onChange,
  refusal,
  own,
  onOwn,
  onBack,
}: TestsPartProps): ReactNode {
  const title = useId()
  const folding = useTransition(fold)
  return (
    <div role="group" aria-labelledby={title} className={PART}>
      <div className="flex min-h-control-sm items-center gap-3">
        <span id={title} className="text-sm font-medium">
          Tests
        </span>
        <span className="ml-auto flex">
          {own && tests.custom !== null && (
            <Button size="sm" variant="ghost" onClick={onBack}>
              <IconArrowBackUp size="sm" />
              Back to the guess
            </Button>
          )}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {own ? (
          <motion.div
            key="fields"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <TestsFields
              repository={tests.repository}
              draft={draft}
              onChange={onChange}
              refusal={refusal}
            />
          </motion.div>
        ) : (
          <motion.div
            key="guess"
            className="flex min-w-0 items-center gap-3 overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <GuessSentence tests={tests} />
            <span className="ml-auto flex shrink-0">
              <Button size="sm" onClick={onOwn}>
                <IconPencil size="sm" />
                Set my own
              </Button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Variant B: no section of its own. The tests are the last part of a repository's dialog, opened
 * from its line in Repositories; a repository with no runner found marks Repositories in the list.
 */
export function TestsInRepositoryDialog(props: TestRunnerProps): ReactNode {
  const state = useTests(props)
  const { rows, opened, refusal } = state
  const [pressed, setPressed] = useState(props.open?.draft !== undefined)
  const [repository, setRepository] = useState(() =>
    repositoryDraft(props.open?.repository ?? 'api'),
  )
  const problem = problemOf(rows)
  const sections = SECTIONS.map((one) =>
    one.id === 'repositories' ? { id: one.id, label: one.label, icon: one.icon, problem } : one,
  )
  const tests = opened === null ? null : testsOf(rows, opened.repository)
  return (
    <InSettings
      sections={sections}
      current="repositories"
      onCloseForm={state.close}
      form={
        opened === null || tests === null
          ? null
          : {
              title: opened.repository,
              icon: <IconGitBranch size="sm" />,
              body: (
                <>
                  <RepositoryForm
                    draft={repository}
                    onChange={setRepository}
                    remotes={REMOTES.get(opened.repository) ?? []}
                    onChooseFolder={() => {}}
                  />
                  <TestsPart
                    tests={tests}
                    draft={opened.draft}
                    onChange={state.change}
                    refusal={refusal}
                    own={pressed || tests.custom !== null}
                    onOwn={() => setPressed(true)}
                    onBack={() => {
                      setPressed(false)
                      state.back(opened.repository)
                    }}
                  />
                </>
              ),
              footer: (
                <FormFoot
                  remove={`Remove ${opened.repository}`}
                  onRemove={() => {}}
                  onSave={state.save}
                  onCancel={state.close}
                />
              ),
            }
      }
    >
      <RepositoriesSection
        repositories={REPOSITORIES}
        onInclude={() => {}}
        onOpen={(id) => {
          setPressed(false)
          setRepository(repositoryDraft(id))
          state.open(id)
        }}
        onAdd={() => {}}
      />
    </InSettings>
  )
}
