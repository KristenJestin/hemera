import {
  CommandsSection,
  NEW_COMMAND,
  NEW_STEP,
  RecipeSection,
  RepositoriesSection,
  ServicesSection,
  VariablesSection,
  WorkspacesSection,
  type RepositoryDraft,
  type SettingsForm,
  type SettingsRepository,
  type SettingsRun,
  type SettingsStep,
} from '@hemera/ui'
import type { Command, Project, RecipeStep, Repository } from '@hemera/ipc'
import type { ReactNode } from 'react'

import { type AgentSectionId, isAgentSection } from './agent-sections.tsx'
import type { Settings, SettingsData } from './settings-data.ts'
import { commandFormOf, commandRowOf, stepDraftOf } from './settings-model.ts'
import type { SectionId, SettingsTools, Writing } from './settings-types.ts'
import { Workspaces } from './settings-workspaces.tsx'
import { type TicketSectionId, isTicketSection } from './ticket-sections.tsx'

/** What the sections of the page need of the page: what it read, and what it can ask for. */
export interface SectionContext {
  readonly data: SettingsData
  readonly settings: Settings | null
  readonly tools: SettingsTools
  readonly project: Project | null
  readonly repositories: ReadonlyArray<Repository>
  readonly catalogue: ReadonlyArray<Command>
  readonly recipe: ReadonlyArray<RecipeStep>
  readonly rows: ReadonlyArray<SettingsRepository>
  /** The steps as shown: in the order they are being moved to, if they are. */
  readonly steps: ReadonlyArray<SettingsStep>
  readonly runs: ReadonlyArray<SettingsRun>
  /** The agent and permission sections, drawn by their own hooks. */
  readonly agentSection:
    | ((id: AgentSectionId, show: (form: SettingsForm | null) => void) => ReactNode)
    | undefined
  /** The ticket and resource sections, drawn by their own hooks. */
  readonly ticketSection:
    | ((id: TicketSectionId, show: (form: SettingsForm | null) => void) => ReactNode)
    | undefined
  /** Shows a dialog an agent or ticket section draws over the page. */
  readonly showForm: (form: SettingsForm | null) => void
  /** A change made on a line: what refuses it is said by the section's glyph in the list. */
  readonly act: <A>(section: SectionId, change: (() => Promise<A>) | null) => void
  readonly open: (writing: Writing) => void
  readonly openRepository: (id: string) => void
  readonly reorder: (ids: string[]) => void
}

const NEW_REPOSITORY: RepositoryDraft = {
  path: '',
  includedByDefault: true,
  remote: null,
  baseBranch: 'main',
}

function repositoriesBody({ rows, project, settings, act, open, openRepository }: SectionContext) {
  return (
    <RepositoriesSection
      repositories={rows}
      loading={project === null}
      onInclude={(id, included) =>
        act('repositories', settings && (() => settings.include(id, included)))
      }
      onOpen={openRepository}
      onAdd={() => open({ kind: 'repository', id: null, draft: NEW_REPOSITORY })}
    />
  )
}

function workspacesBody({ project, settings, tools }: SectionContext) {
  return project === null ? (
    <WorkspacesSection
      loading
      folder={null}
      defaultFolder=""
      onFolder={() => undefined}
      onChooseFolder={() => undefined}
      prefix={null}
      defaultPrefix=""
      onPrefix={() => undefined}
      example=""
    />
  ) : (
    <Workspaces key={project.id} project={project} settings={settings} tools={tools} />
  )
}

function commandsBody(context: SectionContext) {
  const { catalogue, repositories, data, project, open, agentSection, showForm } = context
  // The commands never run stand under the catalogue: they are commands too.
  return (
    <>
      <CommandsSection
        commands={catalogue.map((one) => commandRowOf(one, repositories))}
        loading={data.catalogue.kind !== 'ready' || project === null}
        onOpen={(id) => {
          const found = catalogue.find((one) => one.id === id)
          if (found !== undefined) {
            open({ kind: 'command', id, draft: commandFormOf(found, repositories) })
          }
        }}
        onAdd={() => open({ kind: 'command', id: null, draft: NEW_COMMAND })}
      />
      {agentSection?.('never', showForm)}
    </>
  )
}

function preparationBody({
  steps,
  data,
  project,
  recipe,
  repositories,
  open,
  reorder,
}: SectionContext) {
  return (
    <RecipeSection
      steps={steps}
      loading={data.recipe.kind !== 'ready' || project === null}
      onOpen={(id) => {
        const found = recipe.find((one) => one.id === id)
        if (found !== undefined) {
          open({ kind: 'step', id, draft: stepDraftOf(found, repositories) })
        }
      }}
      onAdd={() => open({ kind: 'step', id: null, draft: NEW_STEP })}
      onReorder={reorder}
    />
  )
}

function variablesBody({ data, settings, act, open }: SectionContext) {
  return (
    <VariablesSection
      variables={(data.variables.kind === 'ready' ? data.variables.value : []).map((one) => ({
        key: one.key,
        value: data.revealed.get(one.key),
        revealing: data.revealing.has(one.key),
      }))}
      loading={data.variables.kind !== 'ready'}
      onReveal={(key) => act('variables', settings && (() => settings.reveal(key)))}
      onHide={(key) => settings?.hide(key)}
      onEdit={(key) => {
        // Editing a value is asking to see it: it is read now, for the form.
        act(
          'variables',
          settings &&
            (() =>
              settings
                .reveal(key)
                .then((value) => open({ kind: 'variable', key, draft: { key, value } }))),
        )
      }}
      onRemove={(key) => act('variables', settings && (() => settings.removeVariable(key)))}
      onAdd={() => open({ kind: 'variable', key: null, draft: { key: '', value: '' } })}
    />
  )
}

function servicesBody({ runs, catalogue, data, settings, tools, act }: SectionContext) {
  return (
    <ServicesSection
      runs={runs}
      commands={catalogue.map((one) => ({ id: one.id, name: one.name, type: one.type }))}
      loading={data.runs.kind !== 'ready' || data.catalogue.kind !== 'ready'}
      onRun={(commandId) => act('services', settings && (() => settings.run(commandId)))}
      onStart={(id) => act('services', settings && (() => settings.start(id)))}
      onDecline={(id) => act('services', settings && (() => settings.stopLine(id)))}
      onRestart={(id) => act('services', settings && (() => settings.restart(id)))}
      onStop={(id) => act('services', settings && (() => settings.stopLine(id)))}
      onCopyUrl={(id) => {
        const run = runs.find((one) => one.id === id)
        if (run?.kind === 'live' && run.url !== undefined) tools.copy(run.url)
      }}
      onOpenUrl={(id) => {
        const run = runs.find((one) => one.id === id)
        if (run?.kind === 'live' && run.url !== undefined) tools.open(run.url)
      }}
    />
  )
}

/** The body of the section shown: its lines, and the dialogs they open. */
export function sectionBody(current: SectionId, context: SectionContext): ReactNode {
  if (isAgentSection(current)) return context.agentSection?.(current, context.showForm) ?? null
  if (isTicketSection(current)) return context.ticketSection?.(current, context.showForm) ?? null
  switch (current) {
    case 'repositories':
      return repositoriesBody(context)
    case 'workspaces':
      return workspacesBody(context)
    case 'commands':
      return commandsBody(context)
    case 'preparation':
      return preparationBody(context)
    case 'variables':
      return variablesBody(context)
    case 'services':
      return servicesBody(context)
  }
}
