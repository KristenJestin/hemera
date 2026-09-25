import { type ReactNode, useState } from 'react'

import type {
  Command,
  RecipeStep,
  RepositoryState,
  Variable,
  Workspace,
  WorkspacePlan,
  Worktree,
} from '@hemera/ipc'
import {
  Card,
  CleanupDialog,
  CreateWorkspaceDialog,
  PreparationEditor,
  PreparationSteps,
  ProjectSettings,
  RunDetails,
  ServiceList,
  VariablesEditor,
  WorkspaceList,
  WorkspaceRepositories,
  type ProjectSettingsDraft,
  type RepositoryDraft,
  type RepositoryLine,
} from '@hemera/ui'

import {
  type CommandWrite,
  commandLineOf,
  commandWriteOf,
  folderBasePath,
  folderUnderBase,
} from '../project-lines.ts'
import {
  branchOfName,
  branchesKeptOf,
  interruptedOf,
  planLinesOf,
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
  worktreesOf,
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
 * The Workspaces of the Project (D8-02, D8-04, D8-14, D8-15): the list, `main`'s row with what Git
 * says of it, a dedicated one made in its creation dialog from the plan the engine proposed, a
 * folder the user maps, the one opened in its row, and the cleanup of a dedicated one, confirmed
 * in its dialog — which says the branches kept and, when the engine refuses, its reason as it
 * gave it.
 */
function WorkspacesCards({
  workspaces,
  mainStatus,
  shown,
  projectVariables,
  catalogue,
  actions,
  onBrowse,
  onPlan,
  onCreateDedicated,
  onCreate,
  onCleanup,
}: {
  workspaces: readonly Workspace[]
  mainStatus: readonly RepositoryState[] | null
  shown: ShownWorkspace | null
  projectVariables: readonly Variable[]
  catalogue: readonly Command[]
  actions: WorkspaceActions
  onBrowse: () => Promise<string | null>
  onPlan: () => Promise<WorkspacePlan | null>
  onCreateDedicated: (name: string, repositories: readonly Worktree[]) => Promise<string | null>
  onCreate: (path: string, name: string) => Promise<string | null>
  onCleanup: (id: string) => Promise<string | null>
}): ReactNode {
  /** The Workspace whose cleanup is being confirmed, and what the engine refused it with. */
  const [cleaning, setCleaning] = useState<Workspace | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  /** The plan the creation dialog is open on; kept while it closes, so it does not empty. */
  const [plan, setPlan] = useState<WorkspacePlan | null>(null)
  const [creating, setCreating] = useState(false)

  // The plan is asked first, and the dialog opens on it: it takes its rows as it opens.
  const create = () => {
    void onPlan().then((planned) => {
      if (planned === null) return
      setPlan(planned)
      setCreating(true)
    })
  }

  const ask = (id: string) => {
    setRefusal(null)
    setCleaning(workspaces.find((one) => one.id === id) ?? null)
  }

  const selected = shown === null ? null : shown.workspaceId
  const showing = workspaces.find((one) => one.id === selected)

  return (
    <>
      <WorkspaceList
        workspaces={workspaceRowsOf(workspaces, mainStatus)}
        onCreateDedicated={create}
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
      {plan !== null && (
        <CreateWorkspaceDialog
          open={creating}
          onOpenChange={setCreating}
          root={plan.root}
          defaultName={plan.name}
          repositories={planLinesOf(plan)}
          // No Spec to name the branches after: they follow the name (D8-04).
          branchOf={branchOfName(plan.branchPrefix)}
          gitMissing={!plan.gitAvailable}
          onCreate={async (draft) => await onCreateDedicated(draft.name, worktreesOf(draft))}
        />
      )}
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
  onUpdateRepository,
  onRemoveRepository,
  commands,
  portlessInstalled,
  onSaveCommand,
  onRemoveCommand,
  onArchive,
  workspaces,
  mainStatus,
  shown,
  projectVariables,
  workspaceActions,
  onPlanWorkspace,
  onCreateDedicated,
  onCreateWorkspace,
  onCleanupWorkspace,
  recipe,
  onAddRecipeStep,
  onUpdateRecipeStep,
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
  /**
   * Asks the system for a folder, opened on the one given when there is one: the Commands
   * section asks from the folder a command runs from, and the rest of the page asks for no start
   * at all.
   */
  onBrowse: (start?: string) => Promise<string | null>
  onCheckFolder: (path: string) => Promise<string | null>
  onMainPathChange: (path: string) => void
  onAddRepository: (path: string) => Promise<string | null>
  /**
   * Rewrites a declared repository, found by the path it had: its path, its icon and whether a
   * dedicated Workspace takes it (D8-04). Answers the engine's refusal, or null.
   */
  onUpdateRepository: (path: string, next: RepositoryDraft) => Promise<string | null>
  onRemoveRepository: (path: string) => void
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
  /** What Git answered of `main` when the settings opened, or null until it did (D8-15). */
  mainStatus: readonly RepositoryState[] | null
  /** The Workspace opened in the list, and what was read of it; null when none is. */
  shown: ShownWorkspace | null
  /** The Project's own variables, which a Workspace's are over (D8-06). */
  projectVariables: readonly Variable[]
  workspaceActions: WorkspaceActions
  /** Plans a dedicated Workspace with no Spec; null when the engine refused (D8-04). */
  onPlanWorkspace: () => Promise<WorkspacePlan | null>
  /** Creates it from what the dialog kept, then prepares it; answers the refusal, or null. */
  onCreateDedicated: (name: string, repositories: readonly Worktree[]) => Promise<string | null>
  /** Makes a Workspace on a folder the user picked; answers the engine's refusal, or null. */
  onCreateWorkspace: (path: string, name: string) => Promise<string | null>
  /** Cleans a dedicated Workspace up; answers the engine's refusal, or null (D8-14). */
  onCleanupWorkspace: (id: string) => Promise<string | null>
  /** The recipe every dedicated Workspace is prepared with, in its order (D8-05). */
  recipe: readonly RecipeStep[]
  /** Adds a step at the end of the recipe; answers the engine's refusal, or null. */
  onAddRecipeStep: (step: RecipeAdd) => Promise<string | null>
  /** Rewrites a step where it stands; answers the engine's refusal, or null. */
  onUpdateRecipeStep: (id: string, step: RecipeAdd) => Promise<string | null>
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
  /**
   * The picker of the system, opened where a step works and answered from there (recette 2): what
   * comes back is a path relative to that base — the folder a command runs in, the file or the
   * folder a copy takes, the folder a step's own line runs in — and a folder outside that base
   * climbs out, which the field refuses.
   */
  const browseUnderBase = async (base: string | null): Promise<string | null> => {
    const chosen = await onBrowse(folderBasePath(project.mainPath, base))
    return chosen === null ? null : folderUnderBase(project.mainPath, base, chosen)
  }

  return (
    // Wide enough for the navigation beside a section (recette 1).
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
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
        onUpdateRepository={onUpdateRepository}
        commands={commands.map(commandLineOf)}
        onAddCommand={async (line) => await onSaveCommand(commandWriteOf(line), false)}
        onUpdateCommand={async (line) => await onSaveCommand(commandWriteOf(line), true)}
        onRemoveCommand={onRemoveCommand}
        onBrowseCommandFolder={browseUnderBase}
        portlessInstalled={portlessInstalled}
        onArchive={onArchive}
        slotRefusal={workspacesRefusal}
        workspaces={
          <WorkspacesCards
            workspaces={workspaces}
            mainStatus={mainStatus}
            shown={shown}
            projectVariables={projectVariables}
            catalogue={commands}
            actions={workspaceActions}
            onBrowse={onBrowse}
            onPlan={onPlanWorkspace}
            onCreateDedicated={onCreateDedicated}
            onCreate={onCreateWorkspace}
            onCleanup={onCleanupWorkspace}
          />
        }
        preparation={
          <PreparationEditor
            steps={recipeLinesOf(recipe)}
            repositories={repositories.map((one) => one.path)}
            commands={recipeCommandsOf(commands)}
            onBrowse={browseUnderBase}
            onAdd={async (step) => await onAddRecipeStep(recipeAddOf(step))}
            onUpdate={async (id, step) => await onUpdateRecipeStep(id, recipeAddOf(step))}
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
