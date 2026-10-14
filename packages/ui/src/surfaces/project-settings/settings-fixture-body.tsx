import type { ReactNode } from 'react'

import { BudgetSection } from '../../blocks/project-settings/budget.tsx'
import { CommandsSection } from '../../blocks/project-settings/commands.tsx'
import { NEW_COMMAND } from '../../blocks/project-settings/commands-model.ts'
import { InstructionsSection } from '../../blocks/project-settings/instructions.tsx'
import { NeverSection } from '../../blocks/project-settings/never.tsx'
import { Section } from '../../blocks/project-settings/parts.tsx'
import { NEW_STEP, RecipeSection } from '../../blocks/project-settings/recipe.tsx'
import { RepositoriesSection } from '../../blocks/project-settings/repositories.tsx'
import { RoleModelsSection } from '../../blocks/project-settings/role-models.tsx'
import { ServicesSection } from '../../blocks/project-settings/services.tsx'
import { VariablesSection } from '../../blocks/project-settings/variables.tsx'
import { WorkspacesSection } from '../../blocks/project-settings/workspaces.tsx'
import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import {
  DEFAULT_FOLDER,
  DEFAULT_PREFIX,
  VALUES,
  branchRefusal,
} from '../../blocks/project-settings/project-settings-fixtures.ts'
import {
  INSTRUCTIONS,
  READERS,
  limitRefusal,
} from '../../blocks/project-settings/agent-settings-fixtures.ts'
import { draftOfCommand, draftOfRepository, draftOfStep } from './settings-fixture-state.ts'
import type { FixtureState, SettingsFixtureProps } from './settings-fixture-state.ts'
import type { SettingsSection } from './project-settings.tsx'

type Fixture = Pick<SettingsFixtureProps, 'loading' | 'empty' | 'project'>

function repositoriesBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <RepositoriesSection
      repositories={state.repositories}
      loading={loading}
      onInclude={(id, included) =>
        state.setRepositories((before) =>
          before.map((one) => (one.id === id ? { ...one, includedByDefault: included } : one)),
        )
      }
      onOpen={(id) => {
        const repository = state.repositories.find((one) => one.id === id)
        if (repository !== undefined) {
          state.open({ kind: 'repository', id, draft: draftOfRepository(repository) })
        }
      }}
      onAdd={() =>
        state.open({
          kind: 'repository',
          id: null,
          draft: { path: '', includedByDefault: true, remote: null, baseBranch: 'main' },
        })
      }
    />
  )
}

function workspacesBody(state: FixtureState, { loading, project }: Fixture): ReactNode {
  const { prefix } = state
  return (
    <WorkspacesSection
      loading={loading}
      folder={state.folder}
      defaultFolder={project === 'hemera' ? '~/hemera-workspaces/hemera' : DEFAULT_FOLDER}
      onFolder={state.setFolder}
      onChooseFolder={() => {}}
      prefix={prefix}
      defaultPrefix={project === 'hemera' ? 'hemera/' : DEFAULT_PREFIX}
      onPrefix={state.setPrefix}
      example={project === 'hemera' ? 'HEM-58' : 'ACME-12'}
      prefixError={prefix === null ? undefined : branchRefusal(`${prefix}ACME-12`)}
    />
  )
}

function commandsBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <>
      <CommandsSection
        commands={state.commands}
        loading={loading}
        onOpen={(id) => {
          const found = state.commands.find((one) => one.id === id)
          if (found !== undefined) {
            state.open({ kind: 'command', id, draft: draftOfCommand(found) })
          }
        }}
        onAdd={() => state.open({ kind: 'command', id: null, draft: NEW_COMMAND })}
      />
      <NeverSection
        lines={state.neverLines}
        loading={loading}
        onAdd={() => state.open({ kind: 'never', id: null, draft: '' })}
        onRemove={(id) => state.setNeverLines((before) => before.filter((one) => one.id !== id))}
      />
    </>
  )
}

function preparationBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <RecipeSection
      steps={state.steps}
      loading={loading}
      onOpen={(id) => {
        const found = state.steps.find((one) => one.id === id)
        if (found !== undefined) state.open({ kind: 'step', id, draft: draftOfStep(found) })
      }}
      onAdd={() => state.open({ kind: 'step', id: null, draft: NEW_STEP })}
      onReorder={(ids) =>
        state.setSteps((before) => ids.flatMap((id) => before.filter((one) => one.id === id)))
      }
    />
  )
}

function variablesBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <VariablesSection
      variables={state.variables}
      loading={loading}
      onReveal={(key) =>
        state.setVariables((before) =>
          before.map((one) => (one.key === key ? { ...one, value: VALUES.get(key) ?? '' } : one)),
        )
      }
      onHide={(key) =>
        state.setVariables((before) =>
          before.map((one) => (one.key === key ? { key: one.key } : one)),
        )
      }
      onEdit={(key) =>
        state.open({ kind: 'variable', key, draft: { key, value: VALUES.get(key) ?? '' } })
      }
      onRemove={(key) => state.setVariables((before) => before.filter((one) => one.key !== key))}
      onAdd={() => state.open({ kind: 'variable', key: null, draft: { key: '', value: '' } })}
    />
  )
}

function servicesBody(state: FixtureState, { loading }: Fixture): ReactNode {
  const startRun = (id: string): void =>
    state.setRuns((before) =>
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
  return (
    <ServicesSection
      runs={state.runs}
      commands={state.commands.map((one) => ({ id: one.id, name: one.name, type: one.type }))}
      loading={loading}
      onRun={() => {}}
      onStart={startRun}
      onAllow={startRun}
      onDecline={(id) => state.setRuns((before) => before.filter((one) => one.id !== id))}
      onRestart={() => {}}
      onStop={() => {}}
      onCopyUrl={() => {}}
      onOpenUrl={() => {}}
      onDetails={() => {}}
    />
  )
}

function modelsBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <RoleModelsSection
      roles={state.roles}
      agents={AGENTS}
      loading={loading}
      onChange={(role, choice) =>
        state.setRoles((before) =>
          before.map((one) => (one.role === role ? { ...one, override: choice } : one)),
        )
      }
      onFavourite={() => {}}
      onHide={() => {}}
    />
  )
}

function budgetBody(state: FixtureState, { loading }: Fixture): ReactNode {
  return (
    <BudgetSection
      limits={state.limits}
      refusalOf={limitRefusal}
      loading={loading}
      onLimit={(id, value) =>
        state.setLimits((before) => before.map((one) => (one.id === id ? { ...one, value } : one)))
      }
    />
  )
}

function instructionsBody({ loading, empty, project }: Fixture): ReactNode {
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
}

/** The body of the section chosen, held by the state: a later section is only its heading. */
export function fixtureBodyOf(
  state: FixtureState,
  fixture: Fixture,
  sections: readonly SettingsSection[],
): ReactNode {
  switch (state.current) {
    case 'repositories':
      return repositoriesBody(state, fixture)
    case 'workspaces':
      return workspacesBody(state, fixture)
    case 'commands':
      return commandsBody(state, fixture)
    case 'preparation':
      return preparationBody(state, fixture)
    case 'variables':
      return variablesBody(state, fixture)
    case 'services':
      return servicesBody(state, fixture)
    case 'models':
      return modelsBody(state, fixture)
    case 'budget':
      return budgetBody(state, fixture)
    case 'instructions':
      return instructionsBody(fixture)
    default: {
      const later = sections.find((one) => one.id === state.current)
      return (
        <Section label={later?.label ?? state.current}>
          <SectionHead title={later?.label ?? state.current} />
        </Section>
      )
    }
  }
}
