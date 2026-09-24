import { type ReactNode, useState } from 'react'

import type { Command, RecipeStep, Variable, Workspace } from '@hemera/ipc'
import {
  Card,
  CleanupDialog,
  PreparationEditor,
  PreparationSteps,
  ProjectSettings,
  RunDetails,
  ServiceList,
  VariablesEditor,
  WorkspaceList,
  WorkspaceRepositories,
  type ProjectSettingsDraft,
  type RepositoryLine,
} from '@hemera/ui'

import { type CommandWrite, commandLineOf, commandWriteOf } from '../project-lines.ts'
import {
  branchesKeptOf,
  interruptedOf,
  projectVariablesOf,
  recipeAddOf,
  recipeCommandsOf,
  recipeLinesOf,
  type RecipeAdd,
  runDetailsOf,
  serviceLinesOf,
  stepLinesOf,
  workspaceCardOf,
  workspaceRowsOf,
  workspaceVariablesOf,
} from '../workspace-details.ts'
import type { ShownWorkspace } from '../workspaces-store.ts'

/** What a Workspace opened in the list is asked through (D8-05, D8-06, D8-08). */
export interface WorkspaceActions {
  /** Opens a Workspace's row in the list, or none. */
  onShow: (id: string | null) => void
  /** Resumes its preparation; the steps then follow through the engine's events (D8-05). */
  onResume: (id: string) => void
  /** Sets a variable of that Workspace over the Project's; answers the refusal, or null. */
  onSetVariable: (workspaceId: string, key: string, value: string) => Promise<string | null>
  onRemoveVariable: (workspaceId: string, key: string) => void
  /** Shows the details of one of its services, or none. */
  onSelectRun: (runId: string | null) => void
  /** Shows the run a step of its preparation started, or none (D8-05). */
  onShowStepRun: (runId: string | null) => void
  /** Stops that one instance of a service, whoever started it (D8-08). */
  onStopService: (runId: string) => void
}

/**
 * One Workspace, in its open row (D8-05, D8-06, D8-08, D8-09, D8-15): what Git says of each of its
 * repositories, its preparation when it has one, its variables over the Project's, its services
 * whoever started them and, for the one asked, what that run ran.
 */
function ShownWorkspaceCards({
  workspace,
  shown,
  projectVariables,
  catalogue,
  actions,
}: {
  workspace: Workspace
  shown: ShownWorkspace
  projectVariables: readonly Variable[]
  catalogue: readonly Command[]
  actions: WorkspaceActions
}): ReactNode {
  const { run } = shown
  // Its details sit under the list it was opened from: the steps, or the services.
  const details =
    run === null ? null : (
      <Card>
        <RunDetails {...runDetailsOf(run)} />
      </Card>
    )
  const ofAStep = run !== null && shown.steps.some((step) => step.runId === run.id)
  return (
    <>
      {/* "Resume" is the preparation's, under its steps and the note that it re-checks them
          first; "Clean up" is the row's. */}
      <WorkspaceRepositories {...workspaceCardOf(workspace, shown.status)} />
      {shown.steps.length > 0 && (
        <PreparationSteps
          steps={stepLinesOf(shown.steps)}
          onResume={() => actions.onResume(workspace.id)}
          interrupted={interruptedOf(workspace)}
          shownRun={run?.id ?? null}
          // Pressed again, the run shown is put away.
          onShowRun={(id) => actions.onShowStepRun(run?.id === id ? null : id)}
        />
      )}
      {ofAStep && details}
      <VariablesEditor
        scope="workspace"
        name={workspace.name}
        variables={workspaceVariablesOf(shown.variables, projectVariables)}
        onSet={async (key, value) => await actions.onSetVariable(workspace.id, key, value)}
        onRemove={(key) => actions.onRemoveVariable(workspace.id, key)}
      />
      <ServiceList
        services={serviceLinesOf(shown.services, catalogue)}
        onStop={actions.onStopService}
        selected={run?.id ?? null}
        onSelect={(id) => actions.onSelectRun(run?.id === id ? null : id)}
      />
      {!ofAStep && details}
    </>
  )
}

/**
 * The Workspaces of the Project (D8-02, D8-14): the list, a new one on a folder the user picks,
 * the one opened in its row, and the cleanup of a dedicated one, confirmed in its dialog — which says
 * the branches kept and, when the engine refuses, its reason as it gave it.
 */
function WorkspacesCards({
  workspaces,
  shown,
  projectVariables,
  catalogue,
  actions,
  onBrowse,
  onCreate,
  onCleanup,
}: {
  workspaces: readonly Workspace[]
  shown: ShownWorkspace | null
  projectVariables: readonly Variable[]
  catalogue: readonly Command[]
  actions: WorkspaceActions
  onBrowse: () => Promise<string | null>
  onCreate: (path: string, name: string) => Promise<string | null>
  onCleanup: (id: string) => Promise<string | null>
}): ReactNode {
  /** The Workspace whose cleanup is being confirmed, and what the engine refused it with. */
  const [cleaning, setCleaning] = useState<Workspace | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const ask = (id: string) => {
    setRefusal(null)
    setCleaning(workspaces.find((one) => one.id === id) ?? null)
  }

  const selected = shown === null ? null : shown.workspaceId
  const showing = workspaces.find((one) => one.id === selected)

  return (
    <>
      <WorkspaceList
        workspaces={workspaceRowsOf(workspaces)}
        // A dedicated Workspace from the settings is wired with its creation dialog next.
        onCreateDedicated={() => undefined}
        onBrowse={onBrowse}
        onMapFolder={onCreate}
        onCleanup={ask}
        expanded={selected}
        onExpandedChange={actions.onShow}
        renderDetails={(id) =>
          shown !== null && showing !== undefined && showing.id === id ? (
            <ShownWorkspaceCards
              workspace={showing}
              shown={shown}
              projectVariables={projectVariables}
              catalogue={catalogue}
              actions={actions}
            />
          ) : null
        }
      />
      {cleaning !== null && (
        <CleanupDialog
          open
          onOpenChange={(open) => {
            if (!open) setCleaning(null)
          }}
          name={cleaning.name}
          branches={branchesKeptOf(cleaning)}
          refusal={refusal}
          onConfirm={() => {
            void onCleanup(cleaning.id).then((said) => {
              if (said === null) setCleaning(null)
              else setRefusal(said)
            })
          }}
        />
      )}
    </>
  )
}

/** The settings of the active Project (design D4-07): composed, and bound to its callbacks. */
export function ProjectSettingsPage({
  project,
  subtitle,
  repositories,
  folders,
  onSave,
  onBrowse,
  onCheckFolder,
  onMainPathChange,
  onAddRepository,
  onRemoveRepository,
  onToggleIncluded,
  commands,
  portlessInstalled,
  onSaveCommand,
  onRemoveCommand,
  onArchive,
  workspaces,
  shown,
  projectVariables,
  workspaceActions,
  onCreateWorkspace,
  onCleanupWorkspace,
  recipe,
  onAddRecipeStep,
  onRemoveRecipeStep,
  onMoveRecipeStep,
  onSetProjectVariable,
  onRemoveProjectVariable,
  workspacesRefusal,
}: {
  project: ProjectSettingsDraft
  subtitle?: string
  repositories: RepositoryLine[]
  folders: RepositoryLine[]
  onSave: (draft: ProjectSettingsDraft) => Promise<string | null>
  onBrowse: () => Promise<string | null>
  onCheckFolder: (path: string) => Promise<string | null>
  onMainPathChange: (path: string) => void
  onAddRepository: (path: string) => Promise<string | null>
  onRemoveRepository: (path: string) => void
  /** Says whether a repository is in every dedicated Workspace unless left out (D8-04). */
  onToggleIncluded: (path: string, included: boolean) => void
  /** The catalogue of the Project, as the engine answered it (D6-12). */
  commands: readonly Command[]
  /** Whether `portless` is on this machine, as the engine answered it once (D8-10). */
  portlessInstalled: boolean
  /**
   * Writes a command: a new one, or the one of the same name when `existing` is true. The
   * folder is null for its base. Answers the engine's refusal, or null.
   */
  onSaveCommand: (command: CommandWrite, existing: boolean) => Promise<string | null>
  onRemoveCommand: (name: string) => void
  onArchive: () => void
  /** The Workspaces of the Project, as the engine listed them (D8-02). */
  workspaces: readonly Workspace[]
  /** The Workspace shown under the list, and what was read of it; null when none is. */
  shown: ShownWorkspace | null
  /** The Project's own variables, which a Workspace's are over (D8-06). */
  projectVariables: readonly Variable[]
  workspaceActions: WorkspaceActions
  /** Makes a Workspace on a folder the user picked; answers the engine's refusal, or null. */
  onCreateWorkspace: (path: string, name: string) => Promise<string | null>
  /** Cleans a dedicated Workspace up; answers the engine's refusal, or null (D8-14). */
  onCleanupWorkspace: (id: string) => Promise<string | null>
  /** The recipe every dedicated Workspace is prepared with, in its order (D8-05). */
  recipe: readonly RecipeStep[]
  /** Adds a step at the end of the recipe; answers the engine's refusal, or null. */
  onAddRecipeStep: (step: RecipeAdd) => Promise<string | null>
  onRemoveRecipeStep: (id: string) => void
  onMoveRecipeStep: (id: string, direction: 'up' | 'down') => void
  /** Sets one of the Project's own variables; answers the engine's refusal, or null (D8-06). */
  onSetProjectVariable: (key: string, value: string) => Promise<string | null>
  onRemoveProjectVariable: (key: string) => void
  /**
   * What the engine last refused about the Workspaces, the recipe or the variables, in its words:
   * a read that failed, or an act whose card has no place of its own to say it. Null once the
   * next act began.
   */
  workspacesRefusal: string | null
}): ReactNode {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <ProjectSettings
        project={project}
        subtitle={subtitle}
        repositories={repositories}
        folders={folders}
        onSave={onSave}
        onBrowse={onBrowse}
        onCheckFolder={onCheckFolder}
        onMainPathChange={onMainPathChange}
        onAddRepository={onAddRepository}
        onRemoveRepository={onRemoveRepository}
        onUpdateRepository={async (path, next) => {
          // Only the inclusion is written for now: a new path or an icon waits for the engine.
          const current = repositories.find((one) => one.path === path)
          if (next.path !== path || next.icon !== (current?.icon ?? null)) {
            return 'Changing the path or the icon of a repository is not available yet.'
          }
          if (current?.includedByDefault !== next.includedByDefault) {
            onToggleIncluded(path, next.includedByDefault)
          }
          return null
        }}
        commands={commands.map(commandLineOf)}
        onAddCommand={async (line) => await onSaveCommand(commandWriteOf(line), false)}
        onUpdateCommand={async (line) => await onSaveCommand(commandWriteOf(line), true)}
        onRemoveCommand={onRemoveCommand}
        portlessInstalled={portlessInstalled}
        onArchive={onArchive}
        slotRefusal={workspacesRefusal}
        workspaces={
          <WorkspacesCards
            workspaces={workspaces}
            shown={shown}
            projectVariables={projectVariables}
            catalogue={commands}
            actions={workspaceActions}
            onBrowse={onBrowse}
            onCreate={onCreateWorkspace}
            onCleanup={onCleanupWorkspace}
          />
        }
        preparation={
          <PreparationEditor
            steps={recipeLinesOf(recipe)}
            repositories={repositories.map((one) => one.path)}
            commands={recipeCommandsOf(commands)}
            onAdd={async (step) => await onAddRecipeStep(recipeAddOf(step))}
            // The engine has no way yet to rewrite a step where it stands.
            onUpdate={async () =>
              await Promise.resolve('A step cannot be edited yet: remove it and add it again.')
            }
            onRemove={onRemoveRecipeStep}
            onMove={onMoveRecipeStep}
          />
        }
        variables={
          <VariablesEditor
            scope="project"
            name={project.name}
            variables={projectVariablesOf(projectVariables)}
            onSet={onSetProjectVariable}
            onRemove={onRemoveProjectVariable}
          />
        }
      />
    </div>
  )
}
