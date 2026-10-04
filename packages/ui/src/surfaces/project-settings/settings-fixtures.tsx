import { type ReactNode, useState } from 'react'

import {
  CommandForm,
  type CommandDraft,
  CommandsSection,
  NEW_COMMAND,
  type SettingsCommand,
  typeIcon,
} from '../../blocks/project-settings/commands.tsx'
import { Section, SheetFoot } from '../../blocks/project-settings/parts.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
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
  IconChecklist,
  IconGitBranch,
  IconListNumbers,
  IconPlayerPlay,
  IconSettings,
  IconStack2,
  IconTerminal,
  IconVariable,
} from '../../icons.ts'
import type { SheetView } from '../../components/sheet/sheet.tsx'
import { ContentHeader } from '../../shell/content-header.tsx'
import { SystemControls } from '../../shell/shell-fixtures.tsx'
import { ProjectSettings, type SettingsSection } from './project-settings.tsx'

/**
 * A small machine around the settings of Acme, so a story walks what a user walks: a section
 * chosen, a sheet opened from a line, a draft written, saved or refused. Nothing here is an
 * engine: a story holds the state the renderer's hooks will hold.
 */
export type SectionId =
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'services'

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'repositories', label: 'Repositories', icon: <IconGitBranch size="sm" /> },
  { id: 'workspaces', label: 'Workspaces', icon: <IconStack2 size="sm" /> },
  { id: 'commands', label: 'Commands', icon: <IconTerminal size="sm" /> },
  { id: 'preparation', label: 'Preparation', icon: <IconListNumbers size="sm" /> },
  { id: 'variables', label: 'Variables', icon: <IconVariable size="sm" /> },
  { id: 'services', label: 'Services', icon: <IconPlayerPlay size="sm" /> },
]

/** The sections later slices add to the same frame: a dozen in all. */
export const LATER_SECTIONS: readonly SettingsSection[] = [
  { id: 'agents', label: 'Agents and permissions', icon: <IconSettings size="sm" /> },
  { id: 'tickets', label: 'Tickets and Specs', icon: <IconStack2 size="sm" /> },
  { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
  { id: 'documentation', label: 'Documentation recipes', icon: <IconStack2 size="sm" /> },
  { id: 'delivery', label: 'Delivery rules', icon: <IconSettings size="sm" /> },
  { id: 'never', label: 'Never run', icon: <IconSettings size="sm" /> },
]

/** What a sheet is writing, and the draft it holds. */
export type SheetState =
  | { readonly kind: 'repository'; readonly id: string | null; readonly draft: RepositoryDraft }
  | { readonly kind: 'command'; readonly id: string | null; readonly draft: CommandDraft }
  | { readonly kind: 'step'; readonly id: string | null; readonly draft: StepDraft }
  | { readonly kind: 'variable'; readonly key: string | null; readonly draft: VariableDraft }

/** How a story opens a sheet as it starts: what it writes, by id, or a new one. */
export type SheetOpener = {
  readonly kind: 'repository' | 'command' | 'step' | 'variable'
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
  /** A sheet open as the story starts. */
  sheet?: SheetOpener | undefined
  /** Whether every save is refused, as one meeting a newer version is. */
  refuse?: boolean | undefined
  /** What runs in the main checkout, when the story says. */
  runs?: readonly SettingsRun[] | undefined
  /** The Project the settings are of: Acme, or Hemera itself. */
  project?: 'acme' | 'hemera' | undefined
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
  sheet: opener,
  refuse = false,
  runs: givenRuns,
  project = 'acme',
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
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const [sheet, setSheet] = useState<SheetState | null>(() => {
    if (opener === undefined) return null
    return openerToSheet(opener)
  })

  function openerToSheet(open: SheetOpener): SheetState | null {
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
    }
  }

  const open = (next: SheetState): void => {
    setRefused(undefined)
    setSheet(next)
  }
  const close = (): void => {
    setRefused(undefined)
    setSheet(null)
  }
  const places = repositories.map((one) => one.path).filter((path) => path !== '.')

  /** Saves the sheet's draft, or says why the save is refused. */
  const save = (): void => {
    if (sheet === null) return
    if (refuse) {
      setRefused(STALE)
      return
    }
    if (sheet.kind === 'command') {
      if (shellRefusal(sheet.draft.line) !== undefined) return
      const saved: SettingsCommand = {
        ...sheet.draft,
        id: sheet.id ?? `c${String(commands.length + 1)}`,
      }
      setCommands((before) =>
        sheet.id === null
          ? [...before, saved]
          : before.map((one) => (one.id === sheet.id ? saved : one)),
      )
    }
    if (sheet.kind === 'repository') {
      if (branchRefusal(sheet.draft.baseBranch) !== undefined) return
      const draft = sheet.draft
      setRepositories((before) =>
        sheet.id === null
          ? [...before, { id: draft.path, ...draft, freshness: { kind: 'never' } }]
          : before.map((one) => (one.id === sheet.id ? { ...one, ...draft } : one)),
      )
    }
    if (sheet.kind === 'step') {
      const saved: SettingsStep = { ...sheet.draft, id: sheet.id ?? `s${String(steps.length + 1)}` }
      setSteps((before) =>
        sheet.id === null
          ? [...before, saved]
          : before.map((one) => (one.id === sheet.id ? saved : one)),
      )
    }
    if (sheet.kind === 'variable') {
      const draft = sheet.draft
      setVariables((before) =>
        sheet.key === null
          ? [...before, { key: draft.key }]
          : before.map((one) => (one.key === sheet.key ? { key: draft.key } : one)),
      )
    }
    close()
  }

  /** Removes what the sheet writes. */
  const remove = (): void => {
    if (sheet === null) return
    if (sheet.kind === 'command')
      setCommands((before) => before.filter((one) => one.id !== sheet.id))
    if (sheet.kind === 'repository') {
      setRepositories((before) => before.filter((one) => one.id !== sheet.id))
    }
    if (sheet.kind === 'step') setSteps((before) => before.filter((one) => one.id !== sheet.id))
    if (sheet.kind === 'variable') {
      setVariables((before) => before.filter((one) => one.key !== sheet.key))
    }
    close()
  }

  const content = ((): SheetView | null => {
    if (sheet === null) return null
    const foot = (what: string | null): ReactNode => (
      <SheetFoot
        refused={refused}
        remove={what === null ? undefined : `Remove ${what}`}
        onRemove={remove}
        save={what === null ? 'Add' : 'Save'}
        onSave={save}
        onCancel={close}
      />
    )
    switch (sheet.kind) {
      case 'repository': {
        const repository = repositories.find((one) => one.id === sheet.id)
        return {
          id: 'sheet',
          width: 'narrow',
          form: true,
          title: sheet.id === null ? 'New repository' : (repository?.path ?? sheet.draft.path),
          icon: <IconGitBranch size="sm" />,
          body: (
            <RepositoryForm
              draft={sheet.draft}
              onChange={(draft) => setSheet({ ...sheet, draft })}
              remotes={sheet.id === null ? undefined : (REMOTES.get(sheet.id) ?? [])}
              freshness={repository?.freshness}
              unreadable={repository?.unreadable}
              branchError={branchRefusal(sheet.draft.baseBranch)}
              onChooseFolder={() => {}}
            />
          ),
          footer: foot(sheet.id === null ? null : (repository?.path ?? null)),
        }
      }
      case 'command':
        return {
          id: 'sheet',
          width: 'narrow',
          form: true,
          title: sheet.id === null ? 'New command' : sheet.draft.name,
          icon: typeIcon(sheet.draft.type),
          body: (
            <CommandForm
              draft={sheet.draft}
              onChange={(draft) => setSheet({ ...sheet, draft })}
              places={places}
              refusalOf={shellRefusal}
            />
          ),
          footer: foot(sheet.id === null ? null : sheet.draft.name),
        }
      case 'step': {
        const position = steps.findIndex((one) => one.id === sheet.id) + 1
        const step = steps.find((one) => one.id === sheet.id)
        return {
          id: 'sheet',
          width: 'narrow',
          form: true,
          title: sheet.id === null ? 'New step' : `Step ${String(position)}`,
          icon: <IconListNumbers size="sm" />,
          body: (
            <StepForm
              draft={sheet.draft}
              onChange={(draft) => setSheet({ ...sheet, draft })}
              places={places}
              commands={commands.map((one) => ({
                id: one.id,
                name: one.name,
                type: one.type,
                line: one.line,
              }))}
              pathError={
                step?.problem !== undefined &&
                step.path === sheet.draft.path &&
                step.place === sheet.draft.place
                  ? `${placeOfStep(step)}/${whatOf(step)} is ${step.problem}.`
                  : undefined
              }
              refusalOf={shellRefusal}
            />
          ),
          footer: foot(sheet.id === null ? null : `step ${String(position)}`),
        }
      }
      case 'variable':
        return {
          id: 'sheet',
          width: 'narrow',
          form: true,
          title: sheet.key ?? 'New variable',
          icon: <IconVariable size="sm" />,
          body: (
            <VariableForm draft={sheet.draft} onChange={(draft) => setSheet({ ...sheet, draft })} />
          ),
          footer: foot(sheet.key),
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
            defaultPrefix={DEFAULT_PREFIX}
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
        name={name}
        mainCheckout={project === 'hemera' ? '~/work/hemera' : long ? LONG_PATH : MAIN_CHECKOUT}
        sections={sections}
        current={current}
        onSection={setCurrent}
        error={error}
        onRetry={() => {}}
        sheet={content}
        onCloseSheet={close}
      >
        {body}
      </ProjectSettings>
    </main>
  )
}
