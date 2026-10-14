import type { ReactNode } from 'react'

import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { CommandForm } from '../../blocks/project-settings/commands.tsx'
import { typeIcon } from '../../blocks/project-settings/command-types.tsx'
import { NeverForm } from '../../blocks/project-settings/never.tsx'
import { StepForm, placeOfStep, whatOf } from '../../blocks/project-settings/recipe.tsx'
import { RepositoryForm } from '../../blocks/project-settings/repositories.tsx'
import { VariableForm } from '../../blocks/project-settings/variables.tsx'
import {
  REMOTES,
  branchRefusal,
  shellRefusal,
} from '../../blocks/project-settings/project-settings-fixtures.ts'
import { neverRefusal } from '../../blocks/project-settings/agent-settings-fixtures.ts'
import { IconBan, IconGitBranch, IconListNumbers, IconVariable } from '../../icons.ts'
import type { SettingsForm } from './project-settings.tsx'
import type { FixtureState, FormState } from './settings-fixture-state.ts'

type Of<Kind extends FormState['kind']> = Extract<FormState, { readonly kind: Kind }>

function foot(state: FixtureState, what: string | null): ReactNode {
  return (
    <FormFoot
      refused={state.refused}
      remove={what === null ? undefined : `Remove ${what}`}
      onRemove={state.remove}
      save={what === null ? 'Add' : 'Save'}
      onSave={state.save}
      onCancel={state.close}
    />
  )
}

function repositoryForm(state: FixtureState, dialog: Of<'repository'>): SettingsForm {
  const repository = state.repositories.find((one) => one.id === dialog.id)
  return {
    title: dialog.id === null ? 'New repository' : (repository?.path ?? dialog.draft.path),
    icon: <IconGitBranch size="sm" />,
    body: (
      <RepositoryForm
        draft={dialog.draft}
        onChange={(draft) => state.setForm({ ...dialog, draft })}
        remotes={dialog.id === null ? undefined : (REMOTES.get(dialog.id) ?? [])}
        freshness={repository?.freshness}
        unreadable={repository?.unreadable}
        branchError={branchRefusal(dialog.draft.baseBranch)}
        onChooseFolder={() => {}}
      />
    ),
    footer: foot(state, dialog.id === null ? null : (repository?.path ?? null)),
  }
}

function commandForm(state: FixtureState, dialog: Of<'command'>): SettingsForm {
  return {
    title: dialog.id === null ? 'New command' : dialog.draft.name,
    icon: typeIcon(dialog.draft.type),
    body: (
      <CommandForm
        draft={dialog.draft}
        onChange={(draft) => state.setForm({ ...dialog, draft })}
        places={state.places}
        refusalOf={shellRefusal}
      />
    ),
    footer: foot(state, dialog.id === null ? null : dialog.draft.name),
  }
}

function stepForm(state: FixtureState, dialog: Of<'step'>): SettingsForm {
  const position = state.steps.findIndex((one) => one.id === dialog.id) + 1
  const step = state.steps.find((one) => one.id === dialog.id)
  return {
    title: dialog.id === null ? 'New step' : `Step ${String(position)}`,
    icon: <IconListNumbers size="sm" />,
    body: (
      <StepForm
        draft={dialog.draft}
        onChange={(draft) => state.setForm({ ...dialog, draft })}
        places={state.places}
        commands={state.commands.map((one) => ({
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
    footer: foot(state, dialog.id === null ? null : `step ${String(position)}`),
  }
}

function neverForm(state: FixtureState, dialog: Of<'never'>): SettingsForm {
  return {
    title: 'Never run',
    icon: <IconBan size="sm" />,
    body: (
      <NeverForm
        value={dialog.draft}
        onChange={(draft) => state.setForm({ ...dialog, draft })}
        error={state.neverTried ? neverRefusal(dialog.draft, state.neverLines) : undefined}
      />
    ),
    footer: foot(state, null),
  }
}

function variableForm(state: FixtureState, dialog: Of<'variable'>): SettingsForm {
  return {
    title: dialog.key ?? 'New variable',
    icon: <IconVariable size="sm" />,
    body: (
      <VariableForm
        draft={dialog.draft}
        onChange={(draft) => state.setForm({ ...dialog, draft })}
      />
    ),
    footer: foot(state, dialog.key),
  }
}

/** The dialog the state holds: its title, its fields and its foot, or none. */
export function fixtureFormOf(state: FixtureState): SettingsForm | null {
  const { dialog } = state
  if (dialog === null) return null
  switch (dialog.kind) {
    case 'repository':
      return repositoryForm(state, dialog)
    case 'command':
      return commandForm(state, dialog)
    case 'step':
      return stepForm(state, dialog)
    case 'never':
      return neverForm(state, dialog)
    case 'variable':
      return variableForm(state, dialog)
  }
}
