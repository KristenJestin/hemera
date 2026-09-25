import { branchNameFor, slugify } from '@hemera/core'
import type {
  ChannelArguments,
  Command,
  CommandRun,
  RecipeStep,
  RepositoryState,
  Variable,
  Workspace,
  WorkspacePlan,
  WorkspaceStep,
  Worktree,
} from '@hemera/ipc'
import type {
  PlanRepositoryLine,
  PreparationStepLine,
  RecipeCommand,
  RecipeStepDraft,
  RecipeStepLine,
  RunDetailsProps,
  ServiceLine,
  VariableLine,
  WorkspaceDraft,
  WorkspaceRepositoriesProps,
  WorkspaceRow,
  WorkspaceSummary,
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

/**
 * The Workspaces of a Project as its settings list them: `main` first, the rest in order, and
 * `main`'s row with what Git answered of it when the settings opened (D8-15).
 */
export function workspaceRowsOf(
  workspaces: readonly Workspace[],
  mainStatus: readonly RepositoryState[] | null = null,
): WorkspaceRow[] {
  const summary = mainStatus === null ? undefined : summaryOf(mainStatus)
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
      summary: workspace.main ? summary : undefined,
    }))
}

/** Counts of changes as a row says them: `2 staged, 1 unstaged`, or `clean` when there is none. */
export function changesOf(counts: { staged: number; unstaged: number; untracked: number }): string {
  const said = [
    { count: counts.staged, word: 'staged' },
    { count: counts.unstaged, word: 'unstaged' },
    { count: counts.untracked, word: 'untracked' },
  ]
    .filter((one) => one.count > 0)
    .map((one) => `${String(one.count)} ${one.word}`)
  return said.length === 0 ? 'clean' : said.join(', ')
}

/**
 * What `main`'s row says of Git (D8-15): the first repository Git answered for — its branch, its
 * commit and its changes — which is the root itself for a Project with no declared repository.
 * One repository and not a sum: a branch and a commit belong to one repository, and changes summed
 * over several would be said beside a branch they are not all on. The row opened shows them all.
 * None when Git answered for none of them.
 */
export function summaryOf(status: readonly RepositoryState[]): WorkspaceSummary | undefined {
  for (const one of status) {
    if (one.git.ok) {
      return { branch: one.git.branch, commit: one.git.commit, changes: changesOf(one.git) }
    }
  }
  return undefined
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
): Pick<WorkspaceRepositoriesProps, 'name' | 'repositories' | 'cleanedAt'> {
  return {
    name: workspace.name,
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

/** A copy's or a link's path under its repository, as a label reads: `sources/api/.env`. */
function underBase(base: string, path: string): string {
  return `${base.replace(/^\.\//, '')}/${path.replace(/^\.\//, '')}`
}

/** The steps of a preparation, in their order, a failure's message as it was said (D8-05). */
export function stepLinesOf(steps: readonly WorkspaceStep[]): PreparationStepLine[] {
  return steps
    .toSorted((one, other) => one.position - other.position)
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      // A copy or a link names its path under its base (D8-05 as amended by recette 1); a run
      // names what it runs — a command of the catalogue, or the line it carries itself.
      target:
        step.kind === 'run' || step.base === null ? step.target : underBase(step.base, step.target),
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

/**
 * The recipe as its card lists it (D8-05). The engine keeps a path relative to the root, so every
 * step is read from the root until it keeps a base of its own.
 */
export function recipeLinesOf(steps: readonly RecipeStep[]): RecipeStepLine[] {
  return steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    base: step.base,
    path: step.path,
    commandId: step.commandId,
    line: step.line,
    lineWindows: step.lineWindows,
    lineLinux: step.lineLinux,
  }))
}

/** The commands a `run` step may start: the whole catalogue (D8-05). */
export function recipeCommandsOf(catalogue: readonly Command[]): RecipeCommand[] {
  return catalogue.map((one) => ({ id: one.id, name: one.name, type: one.type }))
}

/**
 * The plan of a dedicated Workspace as its creation dialog takes it (D8-04): each repository of
 * the Project, whether `main` holds one there, its base and its branch.
 */
export function planLinesOf(plan: WorkspacePlan): PlanRepositoryLine[] {
  return plan.repositories.map((one) => ({
    path: one.relativePath,
    holdsRepository: one.holdsRepository,
    branches: one.branches,
    base: one.base,
    detachedCommit: one.detachedCommit,
    branch: one.branch,
    included: one.included,
  }))
}

/**
 * The branch a name makes for a dedicated Workspace with no Spec (D8-04): `<prefix>/<slug>`, the
 * prefix the plan answered and the name as the engine slugs it.
 */
export function branchOfName(prefix: string): (name: string) => string {
  return (name) => branchNameFor(prefix, null, slugify(name))
}

/** The repositories the dialog kept, as the engine creates their worktrees. */
export function worktreesOf(draft: WorkspaceDraft): Worktree[] {
  return draft.repositories.map((one) => ({
    relativePath: one.path,
    branch: one.branch,
    base: one.base,
  }))
}

/** A step of the recipe as the engine adds it, to the Project it is asked for. */
export type RecipeAdd = Omit<ChannelArguments<'recipe.add'>, 'projectId'>

/**
 * A step the card hands over, as the engine adds it: a command of the catalogue, a line the step
 * carries on its own, or a file or a folder under the base it names (D8-05 as amended by recette 1
 * and recette 2).
 *
 * A run of a command keeps no base and no folder of its own: where it runs is the command's
 * business. A line of the step's own keeps both, and the lines it carries.
 */
export function recipeAddOf(draft: RecipeStepDraft): RecipeAdd {
  if (draft.kind === 'run') {
    const own = draft.commandId === null
    return {
      kind: 'run',
      base: own ? draft.base : null,
      path: own ? draft.path : null,
      commandId: draft.commandId,
      line: draft.line,
      lineWindows: draft.lineWindows,
      lineLinux: draft.lineLinux,
    }
  }
  return {
    kind: draft.kind,
    base: draft.base,
    path: draft.path,
    commandId: null,
    line: null,
    lineWindows: null,
    lineLinux: null,
  }
}
