import type {
  ChannelArguments,
  Command,
  CommandRun,
  RecipeStep,
  RepositoryState,
  Variable,
  Workspace,
  WorkspaceStep,
} from '@hemera/ipc'
import type {
  PreparationStepLine,
  RecipeCommand,
  RecipeStepDraft,
  RecipeStepLine,
  RunDetailsProps,
  ServiceLine,
  VariableLine,
  WorkspaceCardProps,
  WorkspaceRow,
} from '@hemera/ui'

import { whenOf } from './journal-lines.ts'

/**
 * What the Workspaces cards of a Project's settings draw from the engine's views (D8-02, D8-05,
 * D8-06, D8-08, D8-09, D8-14, D8-15).
 *
 * Each function says a view in the words a component of the design system takes, and decides
 * nothing: a state, a conflict, a readiness and a refusal are the engine's, and arrive here said.
 * Kept apart from the page, which imports the components, so a test reads it without a DOM.
 */

/** The Workspaces of a Project as its settings list them: `main` first, the rest in order. */
export function workspaceRowsOf(workspaces: readonly Workspace[]): WorkspaceRow[] {
  return workspaces
    .toSorted((one, other) => Number(other.main) - Number(one.main))
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      state: workspace.state,
      main: workspace.main,
      // The engine's own word: made by Hemera, the only kind cleaned up (D8-14).
      dedicated: workspace.dedicated,
    }))
}

/**
 * One Workspace as its card draws it, with what Git answered when it was last asked (D8-15).
 *
 * Until Git has answered, the worktrees the Workspace was made with are listed as being read;
 * once it has, its answer is the list, the root itself for a Workspace with no repository. A
 * cleaned-up Workspace lists none: its worktrees are gone, and Git has nothing to say of them.
 */
export function workspaceCardOf(
  workspace: Workspace,
  status: readonly RepositoryState[] | null,
  now: number = Date.now(),
): Pick<
  WorkspaceCardProps,
  'name' | 'path' | 'state' | 'main' | 'dedicated' | 'repositories' | 'cleanedAt'
> {
  return {
    name: workspace.name,
    path: workspace.path,
    state: workspace.state,
    main: workspace.main,
    dedicated: workspace.dedicated,
    repositories:
      workspace.state === 'cleaned'
        ? []
        : status === null
          ? workspace.repositories.map((one) => ({ path: one.relativePath, git: null }))
          : status.map((one) => ({ path: one.relativePath, git: one.git })),
    cleanedAt:
      workspace.cleanedAt === null
        ? undefined
        : `Cleaned up ${whenOf(Date.parse(workspace.cleanedAt), now)}.`,
  }
}

/**
 * Whether a Workspace's preparation was interrupted (D8-05): it says it is being prepared, and no
 * preparation of it runs in the engine — Hemera was closed while it ran. It is resumed as a
 * failed one is.
 */
export function interruptedOf(workspace: Workspace): boolean {
  return workspace.state === 'preparing' && !workspace.live
}

/** The branches a cleanup keeps, one per branch however many worktrees are on it (D8-14). */
export function branchesKeptOf(workspace: Workspace): string[] {
  return [...new Set(workspace.repositories.map((one) => one.branch))]
}

/** Where a copy or a link of the recipe lands, as the Preparation card says it. */
const LANDS: Record<'root' | 'repositories', string> = {
  root: 'at the root',
  repositories: 'in each repository',
}

/** The steps of a preparation, in their order, a failure's message as it was said (D8-05). */
export function stepLinesOf(steps: readonly WorkspaceStep[]): PreparationStepLine[] {
  return steps
    .toSorted((one, other) => one.position - other.position)
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      target:
        (step.kind === 'copy' || step.kind === 'link') && step.scope !== null
          ? `${step.target} ${LANDS[step.scope]}`
          : step.target,
      state: step.state,
      message: step.message ?? undefined,
      // The run a `run` step started, whose details the step offers (D8-05, Decided 11).
      runId: step.runId ?? undefined,
    }))
}

/** The Project's own variables, as its editor lists them (D8-06). */
export function projectVariablesOf(variables: readonly Variable[]): VariableLine[] {
  return variables.map((one) => ({ key: one.key, value: one.value }))
}

/**
 * A Workspace's variables over the Project's (D8-06): its own lines first, each naming the
 * Project's value it overrides, then the Project's lines it lets through, `inherited`.
 */
export function workspaceVariablesOf(
  own: readonly Variable[],
  project: readonly Variable[],
): VariableLine[] {
  const set = new Set(own.map((one) => one.key))
  return [
    ...own.map((one) => ({
      key: one.key,
      value: one.value,
      overrides: project.find((other) => other.key === one.key)?.value,
    })),
    ...project
      .filter((one) => !set.has(one.key))
      .map((one) => ({ key: one.key, value: one.value, inherited: true })),
  ]
}

/** How a run's state reads on a service's row, which knows running, stopped and failed. */
function serviceStateOf(run: CommandRun): ServiceLine['state'] {
  if (run.state === 'running' || run.state === 'failed') return run.state
  return 'stopped'
}

/**
 * The services of a Workspace as its list draws them (D8-08, D8-09, D8-10): each run whoever
 * started it, in its folder, with its readiness, and a port conflict on both sides — the holder
 * named on the run that came second, and that run named on the holder (Decided 12). Portless is
 * the command's, read off the catalogue the run came from.
 */
export function serviceLinesOf(
  services: readonly CommandRun[],
  catalogue: readonly Command[],
): ServiceLine[] {
  return services.map((run) => ({
    id: run.id,
    name: run.name,
    workspace: run.workspaceName,
    folder: run.cwd,
    scope: run.scope,
    state: serviceStateOf(run),
    url: run.url ?? undefined,
    readiness: run.readiness ?? undefined,
    portConflict:
      run.portConflict === null
        ? undefined
        : {
            port: run.portConflict.port,
            holderRun: run.portConflict.name,
            holderWorkspace: run.portConflict.workspaceName,
          },
    heldAgainst: run.heldAgainst.map((one) => ({
      port: one.port,
      run: one.name,
      workspace: one.workspaceName,
    })),
    portless: catalogue.find((one) => one.id === run.commandId)?.portless ?? false,
    startedBy: run.startedBy,
  }))
}

/** What a run ran, as its details show it (D8-06, D8-07). */
export function runDetailsOf(run: CommandRun): Omit<RunDetailsProps, 'className'> {
  return {
    name: run.name,
    type: run.type,
    workspace: run.workspaceName,
    folder: run.cwd,
    line: run.line,
    environment: run.environment,
    output: run.output,
    state: run.state,
    exitCode: run.exitCode ?? undefined,
    url: run.url ?? undefined,
    readiness: run.readiness ?? undefined,
    startedBy: run.startedBy,
  }
}

/** The recipe as its card lists it, a run named by its command in the catalogue (D8-05). */
export function recipeLinesOf(
  steps: readonly RecipeStep[],
  catalogue: readonly Command[],
): RecipeStepLine[] {
  return steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    path: step.path ?? undefined,
    scope: step.scope,
    commandName: catalogue.find((one) => one.id === step.commandId)?.name,
  }))
}

/** The commands a `run` step may start: the whole catalogue (D8-05). */
export function recipeCommandsOf(catalogue: readonly Command[]): RecipeCommand[] {
  return catalogue.map((one) => ({ id: one.id, name: one.name, type: one.type }))
}

/** A step of the recipe as the engine adds it, to the Project it is asked for. */
export type RecipeAdd = Omit<ChannelArguments<'recipe.add'>, 'projectId'>

/** A step the card hands over, as the engine adds it: a file and where, or a command. */
export function recipeAddOf(draft: RecipeStepDraft): RecipeAdd {
  if (draft.kind === 'run') {
    return { kind: 'run', path: null, scope: 'root', commandId: draft.commandId }
  }
  return { kind: draft.kind, path: draft.path, scope: draft.scope, commandId: null }
}
