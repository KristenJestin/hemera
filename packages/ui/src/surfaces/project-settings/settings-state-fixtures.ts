import { useState } from 'react'

import { type BudgetLimit } from '../../blocks/project-settings/budget.tsx'
import {
  type CommandDraft,
  NEW_COMMAND,
  type SettingsCommand,
} from '../../blocks/project-settings/commands-model.ts'
import {
  NEW_STEP,
  type SettingsStep,
  type StepDraft,
} from '../../blocks/project-settings/recipe-model.ts'
import type { NeverLine } from '../../blocks/project-settings/never.tsx'
import type { ProjectRoleModel } from '../../blocks/project-settings/role-models.tsx'
import type { RepositoryDraft } from '../../blocks/project-settings/repositories.tsx'
import type { SettingsRepository } from '../../blocks/project-settings/repositories-model.ts'
import type { SettingsRun } from '../../blocks/project-settings/services.tsx'
import type { SettingsVariable, VariableDraft } from '../../blocks/project-settings/variables.tsx'
import {
  COMMANDS,
  DENSE_COMMANDS,
  DENSE_REPOSITORIES,
  FAILED_RUN,
  LONG_LINE,
  LONG_PATH,
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
  LIMITS,
  NEVER_LINES,
  ROLE_MODELS,
  neverRefusal,
} from '../../blocks/project-settings/agent-settings-fixtures.ts'
import type { SetUpAction } from './project-settings.tsx'
import type { SectionId } from './settings-sections.tsx'

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
  /** The setup's launch at the header's end, as the story has it. */
  setUp?: SetUpAction | undefined
}

export function draftOfRepository(repository: SettingsRepository): RepositoryDraft {
  return {
    path: repository.path,
    icon: repository.icon,
    includedByDefault: repository.includedByDefault,
    remote: repository.remote,
    baseBranch: repository.baseBranch,
  }
}

export function draftOfCommand({ id: _id, ...draft }: SettingsCommand): CommandDraft {
  return draft
}

export function draftOfStep({ id: _id, problem: _problem, ...draft }: SettingsStep): StepDraft {
  return draft
}

/**
 * The state of the settings a story holds, and what saves, removes, opens and closes a dialog on
 * it: what the renderer's hooks will hold, with nothing behind them.
 */
export function useFixtureState({
  section = 'repositories',
  dense = false,
  empty = false,
  long = false,
  form: opener,
  refuse = false,
  runs: givenRuns,
  project = 'acme',
}: SettingsFixtureProps) {
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
  return {
    current,
    setCurrent,
    repositories,
    setRepositories,
    folder,
    setFolder,
    prefix,
    setPrefix,
    commands,
    setCommands,
    steps,
    setSteps,
    variables,
    setVariables,
    runs,
    setRuns,
    neverLines,
    setNeverLines,
    roles,
    setRoles,
    limits,
    setLimits,
    neverTried,
    refused,
    dialog,
    setForm,
    places,
    open,
    close,
    save,
    remove,
  }
}

export type FixtureState = ReturnType<typeof useFixtureState>
