import { type ReactNode, useState } from 'react'

import {
  CommandForm,
  type CommandDraft,
  CommandsSection,
  NEW_COMMAND,
  type SettingsCommand,
  typeIcon,
} from '../../blocks/project-settings/commands.tsx'
import { FormFoot, Section } from '../../blocks/project-settings/parts.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import {
  NEW_STEP,
  RecipeSection,
  type SettingsStep,
  type StepDraft,
  StepForm,
  placeOfStep,
  whatOf,
} from '../../blocks/project-settings/recipe.tsx'
import {
  RepositoriesSection,
  type RepositoryDraft,
  RepositoryForm,
  type SettingsRepository,
} from '../../blocks/project-settings/repositories.tsx'
import { type SettingsRun, ServicesSection } from '../../blocks/project-settings/services.tsx'
import {
  COMMANDS,
  DEFAULT_FOLDER,
  DEFAULT_PREFIX,
  DENSE_COMMANDS,
  DENSE_REPOSITORIES,
  FAILED_RUN,
  LONG_LINE,
  LONG_PATH,
  MAIN_CHECKOUT,
  REMOTES,
  REPOSITORIES,
  RUNS,
  STALE,
  STEPS,
  VALUES,
  VARIABLES,
  branchRefusal,
  shellRefusal,
} from '../../blocks/project-settings/project-settings-fixtures.ts'
import {
  type SettingsVariable,
  type VariableDraft,
  VariableForm,
  VariablesSection,
} from '../../blocks/project-settings/variables.tsx'
import { WorkspacesSection } from '../../blocks/project-settings/workspaces.tsx'
import {
  INSTRUCTIONS,
  LIMITS,
  NEVER_LINES,
  READERS,
  ROLE_MODELS,
  limitRefusal,
  neverRefusal,
} from '../../blocks/project-settings/agent-settings-fixtures.ts'
import { type BudgetLimit, BudgetSection } from '../../blocks/project-settings/budget.tsx'
import { InstructionsSection } from '../../blocks/project-settings/instructions.tsx'
import { type NeverLine, NeverForm, NeverSection } from '../../blocks/project-settings/never.tsx'
import {
  type ProjectRoleModel,
  RoleModelsSection,
} from '../../blocks/project-settings/role-models.tsx'
import {
  IconAdjustments,
  IconBan,
  IconChecklist,
  IconFileText,
  IconGauge,
  IconGitBranch,
  IconListNumbers,
  IconPlayerPlay,
  IconSettings,
  IconStack2,
  IconTerminal,
  IconVariable,
} from '../../icons.ts'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { ProjectSettings, type SettingsForm, type SettingsSection } from './project-settings.tsx'

/**
 * A small machine around the settings of Acme, so a story walks what a user walks: a section
 * chosen, a dialog opened from a line, a draft written, saved or refused. Nothing here is an
 * engine: a story holds the state the renderer's hooks will hold.
 */
export type SectionId =
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'services'
  | 'never'
  | 'models'
  | 'budget'
  | 'instructions'

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'repositories', label: 'Repositories', icon: <IconGitBranch size="sm" /> },
  { id: 'workspaces', label: 'Workspaces', icon: <IconStack2 size="sm" /> },
  { id: 'commands', label: 'Commands', icon: <IconTerminal size="sm" /> },
  { id: 'preparation', label: 'Preparation', icon: <IconListNumbers size="sm" /> },
  { id: 'variables', label: 'Variables', icon: <IconVariable size="sm" /> },
  { id: 'services', label: 'Services', icon: <IconPlayerPlay size="sm" /> },
  { id: 'never', label: 'Never run', icon: <IconBan size="sm" /> },
  { id: 'models', label: 'Models by role', icon: <IconAdjustments size="sm" /> },
  { id: 'budget', label: 'Cap and budget', icon: <IconGauge size="sm" /> },
  { id: 'instructions', label: 'Instructions', icon: <IconFileText size="sm" /> },
]

/** The sections later slices add to the same frame: fourteen in all. */
export const LATER_SECTIONS: readonly SettingsSection[] = [
  { id: 'tickets', label: 'Tickets and Specs', icon: <IconStack2 size="sm" /> },
  { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
  { id: 'documentation', label: 'Documentation recipes', icon: <IconStack2 size="sm" /> },
  { id: 'delivery', label: 'Delivery rules', icon: <IconSettings size="sm" /> },
]

/** What a dialog is writing, and the draft it holds. */
export type FormState =
  | { readonly kind: 'repository'; readonly id: string | null; readonly draft: RepositoryDraft }
  | { readonly kind: 'command'; readonly id: string | null; readonly draft: CommandDraft }
  | { readonly kind: 'step'; readonly id: string | null; readonly draft: StepDraft }
  | { readonly kind: 'variable'; readonly key: string | null; readonly draft: VariableDraft }
  | { readonly kind: 'never'; readonly id: null; readonly draft: string }

/** How a story opens a dialog as it starts: what it writes, by id, or a new one. */
export type FormOpener = {
  readonly kind: 'repository' | 'command' | 'step' | 'variable' | 'never'
  readonly id: string | null
}

export interface SettingsFixtureProps {
  section?: SectionId | undefined
  /** Five repositories, twenty commands, a dozen sections. */
  dense?: boolean | undefined
  /** A Project just added: one repository, nothing else written yet. */
  empty?: boolean | undefined
  /** What every section holds is on its way. */
  loading?: boolean | undefined
  /** Why the Project could not be read. */
  error?: string | undefined
  /** A long path and a long line in every field that holds one. */
  long?: boolean | undefined
  /** A dialog open as the story starts. */
  form?: FormOpener | undefined
  /** Whether every save is refused, as one meeting a newer version is. */
  refuse?: boolean | undefined
  /** What runs in the main checkout, when the story says. */
  runs?: readonly SettingsRun[] | undefined
  /** The Project the settings are of: Acme, or Hemera itself. */
  project?: 'acme' | 'hemera' | undefined
  /** Asks the setup agent again: its button at the header's end. */
  onSetUp?: (() => void) | undefined
  /** What waits above the section: a setup left for later. */
  banner?: ReactNode
}

function draftOfRepository(repository: SettingsRepository): RepositoryDraft {
  return {
    path: repository.path,
    icon: repository.icon,
    includedByDefault: repository.includedByDefault,
    remote: repository.remote,
    baseBranch: repository.baseBranch,
  }
}

function draftOfCommand({ id: _id, ...draft }: SettingsCommand): CommandDraft {
  return draft
}

function draftOfStep({ id: _id, problem: _problem, ...draft }: SettingsStep): StepDraft {
  return draft
}

export function SettingsFixture({
  section = 'repositories',
  dense = false,
  empty = false,
  loading = false,
  error,
  long = false,
  form: opener,
  refuse = false,
  runs: givenRuns,
  project = 'acme',
  onSetUp,
  banner,
}: SettingsFixtureProps): ReactNode {
  const name = project === 'hemera' ? 'Hemera' : 'Acme'
  const firstRepositories = (): SettingsRepository[] => {
    if (project === 'hemera') {
      return [
        {
          id: 'hemera',
          path: '.',
          includedByDefault: true,
          remote: 'origin',
          baseBranch: 'dev',
          freshness: { kind: 'fetched', when: '08:47' },
        },
      ]
    }
    if (empty)
      return REPOSITORIES.slice(0, 1).map((one) => ({
        id: one.id,
        path: one.path,
        includedByDefault: one.includedByDefault,
        remote: one.remote,
        baseBranch: one.baseBranch,
        freshness: { kind: 'never' },
      }))
    if (long) {
      return [
        ...REPOSITORIES,
        {
          id: 'long',
          path: 'services/platform-api-and-background-workers',
          includedByDefault: true,
          remote: 'upstream-platform-team',
          baseBranch: 'release/2026-10-platform-consolidation',
          freshness: { kind: 'fetched', when: 'yesterday' },
        },
      ]
    }
    return [...(dense ? DENSE_REPOSITORIES : REPOSITORIES)]
  }
  const [current, setCurrent] = useState<string>(section)
  const [repositories, setRepositories] = useState<SettingsRepository[]>(firstRepositories)
  const [folder, setFolder] = useState<string | null>(long ? LONG_PATH : null)
  const [prefix, setPrefix] = useState<string | null>(null)
  const [commands, setCommands] = useState<SettingsCommand[]>(() => {
    if (empty) return []
    const base = dense ? [...DENSE_COMMANDS] : [...COMMANDS]
    return long ? base.map((one) => (one.id === 'test' ? { ...one, line: LONG_LINE } : one)) : base
  })
  const [steps, setSteps] = useState<SettingsStep[]>(() => (empty ? [] : [...STEPS]))
  const [variables, setVariables] = useState<SettingsVariable[]>(() =>
    empty ? [] : [...VARIABLES],
  )
  const [runs, setRuns] = useState<SettingsRun[]>(() =>
    givenRuns !== undefined
      ? [...givenRuns]
      : empty
        ? []
        : dense
          ? [...RUNS, FAILED_RUN]
          : [...RUNS],
  )
  const [neverLines, setNeverLines] = useState<NeverLine[]>(() => (empty ? [] : [...NEVER_LINES]))
  const [roles, setRoles] = useState<ProjectRoleModel[]>(() =>
    empty ? ROLE_MODELS.map((one) => ({ ...one, override: null })) : [...ROLE_MODELS],
  )
  const [limits, setLimits] = useState<BudgetLimit[]>(() =>
    empty ? LIMITS.map((one) => ({ ...one, value: null })) : [...LIMITS],
  )
  const [neverTried, setNeverTried] = useState(false)
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const [dialog, setForm] = useState<FormState | null>(() => {
    if (opener === undefined) return null
    return openerToForm(opener)
  })

  function openerToForm(open: FormOpener): FormState | null {
    switch (open.kind) {
      case 'repository': {
        const repository = firstRepositories().find((one) => one.id === open.id)
        return {
          kind: 'repository',
          id: open.id,
          draft:
            repository === undefined
              ? { path: '', includedByDefault: true, remote: null, baseBranch: 'main' }
              : draftOfRepository(repository),
        }
      }
      case 'command': {
        const found = (dense ? DENSE_COMMANDS : COMMANDS).find((one) => one.id === open.id)
        return {
          kind: 'command',
          id: open.id,
          draft: found === undefined ? NEW_COMMAND : draftOfCommand(found),
        }
      }
      case 'step': {
        const found = STEPS.find((one) => one.id === open.id)
        return {
          kind: 'step',
          id: open.id,
          draft: found === undefined ? NEW_STEP : draftOfStep(found),
        }
      }
      case 'variable':
        return {
          kind: 'variable',
          key: open.id,
          draft: { key: open.id ?? '', value: open.id === null ? '' : (VALUES.get(open.id) ?? '') },
        }
      case 'never':
        return { kind: 'never', id: null, draft: '' }
    }
  }

  const open = (next: FormState): void => {
    setRefused(undefined)
    setNeverTried(false)
    setForm(next)
  }
  const close = (): void => {
    setRefused(undefined)
    setForm(null)
  }
  const places = repositories.map((one) => one.path).filter((path) => path !== '.')

  /** Saves the dialog's draft, or says why the save is refused. */
  const save = (): void => {
    if (dialog === null) return
    if (refuse) {
      setRefused(STALE)
      return
    }
    if (dialog.kind === 'command') {
      if (shellRefusal(dialog.draft.line) !== undefined) return
      const saved: SettingsCommand = {
        ...dialog.draft,
        id: dialog.id ?? `c${String(commands.length + 1)}`,
      }
      setCommands((before) =>
        dialog.id === null
          ? [...before, saved]
          : before.map((one) => (one.id === dialog.id ? saved : one)),
      )
    }
    if (dialog.kind === 'repository') {
      if (branchRefusal(dialog.draft.baseBranch) !== undefined) return
      const draft = dialog.draft
      setRepositories((before) =>
        dialog.id === null
          ? [...before, { id: draft.path, ...draft, freshness: { kind: 'never' } }]
          : before.map((one) => (one.id === dialog.id ? { ...one, ...draft } : one)),
      )
    }
    if (dialog.kind === 'step') {
      const saved: SettingsStep = {
        ...dialog.draft,
        id: dialog.id ?? `s${String(steps.length + 1)}`,
      }
      setSteps((before) =>
        dialog.id === null
          ? [...before, saved]
          : before.map((one) => (one.id === dialog.id ? saved : one)),
      )
    }
    if (dialog.kind === 'never') {
      setNeverTried(true)
      if (neverRefusal(dialog.draft, neverLines) !== undefined) return
      const line = dialog.draft.trim()
      setNeverLines((before) => [...before, { id: `n${String(before.length + 1)}`, line }])
    }
    if (dialog.kind === 'variable') {
      const draft = dialog.draft
      setVariables((before) =>
        dialog.key === null
          ? [...before, { key: draft.key }]
          : before.map((one) => (one.key === dialog.key ? { key: draft.key } : one)),
      )
    }
    close()
  }

  /** Removes what the dialog writes. */
  const remove = (): void => {
    if (dialog === null) return
    if (dialog.kind === 'command')
      setCommands((before) => before.filter((one) => one.id !== dialog.id))
    if (dialog.kind === 'repository') {
      setRepositories((before) => before.filter((one) => one.id !== dialog.id))
    }
    if (dialog.kind === 'step') setSteps((before) => before.filter((one) => one.id !== dialog.id))
    if (dialog.kind === 'variable') {
      setVariables((before) => before.filter((one) => one.key !== dialog.key))
    }
    close()
  }

  const content = ((): SettingsForm | null => {
    if (dialog === null) return null
    const foot = (what: string | null): ReactNode => (
      <FormFoot
        refused={refused}
        remove={what === null ? undefined : `Remove ${what}`}
        onRemove={remove}
        save={what === null ? 'Add' : 'Save'}
        onSave={save}
        onCancel={close}
      />
    )
    switch (dialog.kind) {
      case 'repository': {
        const repository = repositories.find((one) => one.id === dialog.id)
        return {
          title: dialog.id === null ? 'New repository' : (repository?.path ?? dialog.draft.path),
          icon: <IconGitBranch size="sm" />,
          body: (
            <RepositoryForm
              draft={dialog.draft}
              onChange={(draft) => setForm({ ...dialog, draft })}
              remotes={dialog.id === null ? undefined : (REMOTES.get(dialog.id) ?? [])}
              freshness={repository?.freshness}
              unreadable={repository?.unreadable}
              branchError={branchRefusal(dialog.draft.baseBranch)}
              onChooseFolder={() => {}}
            />
          ),
          footer: foot(dialog.id === null ? null : (repository?.path ?? null)),
        }
      }
      case 'command':
        return {
          title: dialog.id === null ? 'New command' : dialog.draft.name,
          icon: typeIcon(dialog.draft.type),
          body: (
            <CommandForm
              draft={dialog.draft}
              onChange={(draft) => setForm({ ...dialog, draft })}
              places={places}
              refusalOf={shellRefusal}
            />
          ),
          footer: foot(dialog.id === null ? null : dialog.draft.name),
        }
      case 'step': {
        const position = steps.findIndex((one) => one.id === dialog.id) + 1
        const step = steps.find((one) => one.id === dialog.id)
        return {
          title: dialog.id === null ? 'New step' : `Step ${String(position)}`,
          icon: <IconListNumbers size="sm" />,
          body: (
            <StepForm
              draft={dialog.draft}
              onChange={(draft) => setForm({ ...dialog, draft })}
              places={places}
              commands={commands.map((one) => ({
                id: one.id,
                name: one.name,
                type: one.type,
                line: one.line,
              }))}
              pathError={
                step?.problem !== undefined &&
                step.path === dialog.draft.path &&
                step.place === dialog.draft.place
                  ? `${placeOfStep(step)}/${whatOf(step)} is ${step.problem}.`
                  : undefined
              }
              refusalOf={shellRefusal}
            />
          ),
          footer: foot(dialog.id === null ? null : `step ${String(position)}`),
        }
      }
      case 'never':
        return {
          title: 'Never run',
          icon: <IconBan size="sm" />,
          body: (
            <NeverForm
              value={dialog.draft}
              onChange={(draft) => setForm({ ...dialog, draft })}
              error={neverTried ? neverRefusal(dialog.draft, neverLines) : undefined}
            />
          ),
          footer: foot(null),
        }
      case 'variable':
        return {
          title: dialog.key ?? 'New variable',
          icon: <IconVariable size="sm" />,
          body: (
            <VariableForm
              draft={dialog.draft}
              onChange={(draft) => setForm({ ...dialog, draft })}
            />
          ),
          footer: foot(dialog.key),
        }
    }
  })()

  const unreadable = repositories.filter((one) => one.unreadable !== undefined)
  const problems = new Map<string, string | undefined>(
    Object.entries({
      repositories:
        unreadable.length === 0
          ? undefined
          : `${unreadable.map((one) => one.path).join(', ')} cannot be read`,
      preparation: steps.some((one) => one.problem !== undefined)
        ? 'a source is missing'
        : undefined,
      services: runs.some((one) => one.kind === 'live' && one.state === 'failed')
        ? 'a service failed'
        : undefined,
    }),
  )
  const sections = [...SECTIONS, ...(dense ? LATER_SECTIONS : [])].map((one) => ({
    id: one.id,
    label: one.label,
    icon: one.icon,
    problem: problems.get(one.id),
  }))

  const body = ((): ReactNode => {
    switch (current) {
      case 'repositories':
        return (
          <RepositoriesSection
            repositories={repositories}
            loading={loading}
            onInclude={(id, included) =>
              setRepositories((before) =>
                before.map((one) =>
                  one.id === id ? { ...one, includedByDefault: included } : one,
                ),
              )
            }
            onOpen={(id) => {
              const repository = repositories.find((one) => one.id === id)
              if (repository !== undefined) {
                open({ kind: 'repository', id, draft: draftOfRepository(repository) })
              }
            }}
            onAdd={() =>
              open({
                kind: 'repository',
                id: null,
                draft: { path: '', includedByDefault: true, remote: null, baseBranch: 'main' },
              })
            }
          />
        )
      case 'workspaces':
        return (
          <WorkspacesSection
            loading={loading}
            folder={folder}
            defaultFolder={project === 'hemera' ? '~/hemera-workspaces/hemera' : DEFAULT_FOLDER}
            onFolder={setFolder}
            onChooseFolder={() => {}}
            prefix={prefix}
            defaultPrefix={project === 'hemera' ? 'hemera/' : DEFAULT_PREFIX}
            onPrefix={setPrefix}
            example={project === 'hemera' ? 'HEM-58' : 'ACME-12'}
            prefixError={prefix === null ? undefined : branchRefusal(`${prefix}ACME-12`)}
          />
        )
      case 'commands':
        return (
          <CommandsSection
            commands={commands}
            loading={loading}
            onOpen={(id) => {
              const found = commands.find((one) => one.id === id)
              if (found !== undefined) open({ kind: 'command', id, draft: draftOfCommand(found) })
            }}
            onAdd={() => open({ kind: 'command', id: null, draft: NEW_COMMAND })}
          />
        )
      case 'preparation':
        return (
          <RecipeSection
            steps={steps}
            loading={loading}
            onOpen={(id) => {
              const found = steps.find((one) => one.id === id)
              if (found !== undefined) open({ kind: 'step', id, draft: draftOfStep(found) })
            }}
            onAdd={() => open({ kind: 'step', id: null, draft: NEW_STEP })}
            onReorder={(ids) =>
              setSteps((before) => ids.flatMap((id) => before.filter((one) => one.id === id)))
            }
          />
        )
      case 'variables':
        return (
          <VariablesSection
            variables={variables}
            loading={loading}
            onReveal={(key) =>
              setVariables((before) =>
                before.map((one) =>
                  one.key === key ? { ...one, value: VALUES.get(key) ?? '' } : one,
                ),
              )
            }
            onHide={(key) =>
              setVariables((before) =>
                before.map((one) => (one.key === key ? { key: one.key } : one)),
              )
            }
            onEdit={(key) =>
              open({ kind: 'variable', key, draft: { key, value: VALUES.get(key) ?? '' } })
            }
            onRemove={(key) => setVariables((before) => before.filter((one) => one.key !== key))}
            onAdd={() => open({ kind: 'variable', key: null, draft: { key: '', value: '' } })}
          />
        )
      case 'services':
        return (
          <ServicesSection
            runs={runs}
            commands={commands.map((one) => ({ id: one.id, name: one.name, type: one.type }))}
            loading={loading}
            onRun={() => {}}
            onStart={(id) =>
              setRuns((before) =>
                before.map((one) =>
                  one.id === id
                    ? {
                        ...one,
                        kind: 'live',
                        state: 'running',
                        startedAt: Date.now(),
                        endedAt: null,
                      }
                    : one,
                ),
              )
            }
            onAllow={(id) =>
              setRuns((before) =>
                before.map((one) =>
                  one.id === id
                    ? {
                        ...one,
                        kind: 'live',
                        state: 'running',
                        startedAt: Date.now(),
                        endedAt: null,
                      }
                    : one,
                ),
              )
            }
            onDecline={(id) => setRuns((before) => before.filter((one) => one.id !== id))}
            onRestart={() => {}}
            onStop={() => {}}
            onCopyUrl={() => {}}
            onOpenUrl={() => {}}
            onDetails={() => {}}
          />
        )
      case 'never':
        return (
          <NeverSection
            lines={neverLines}
            loading={loading}
            onAdd={() => open({ kind: 'never', id: null, draft: '' })}
            onRemove={(id) => setNeverLines((before) => before.filter((one) => one.id !== id))}
          />
        )
      case 'models':
        return (
          <RoleModelsSection
            roles={roles}
            agents={AGENTS}
            loading={loading}
            onChange={(role, choice) =>
              setRoles((before) =>
                before.map((one) => (one.role === role ? { ...one, override: choice } : one)),
              )
            }
            onFavourite={() => {}}
            onHide={() => {}}
          />
        )
      case 'budget':
        return (
          <BudgetSection
            limits={limits}
            refusalOf={limitRefusal}
            loading={loading}
            onLimit={(id, value) =>
              setLimits((before) => before.map((one) => (one.id === id ? { ...one, value } : one)))
            }
          />
        )
      case 'instructions':
        return (
          <InstructionsSection
            repositories={
              empty
                ? [{ repository: 'api', files: [] }]
                : project === 'hemera'
                  ? [{ repository: '.', files: ['AGENTS.md', 'CLAUDE.md'] }]
                  : INSTRUCTIONS
            }
            agents={READERS}
            loading={loading}
            onOpen={() => {}}
          />
        )
      default: {
        const later = sections.find((one) => one.id === current)
        return (
          <Section label={later?.label ?? current}>
            <SectionHead title={later?.label ?? current} />
          </Section>
        )
      }
    }
  })()

  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={[
          { id: 'project', label: name, onPress: () => {} },
          { id: 'settings', label: 'Settings', icon: <IconSettings size="sm" /> },
        ]}
        controls={<SystemControls />}
      />
      <ProjectSettings
        onSetUp={onSetUp}
        banner={banner}
        name={name}
        mainCheckout={project === 'hemera' ? '~/work/hemera' : long ? LONG_PATH : MAIN_CHECKOUT}
        sections={sections}
        current={current}
        onSection={setCurrent}
        error={error}
        onRetry={() => {}}
        form={content}
        onCloseForm={close}
      >
        {body}
      </ProjectSettings>
    </main>
  )
}
