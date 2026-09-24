/**
 * A Workspace as the domain reasons about it: its name, its branches, its preparation and the
 * variables it runs with (design D8-01, D8-02, D8-04, D8-05, D8-06).
 *
 * There is one kind of Workspace (D8-01): `main`, one the user made on a folder of their own, and
 * one dedicated to a Spec are the same thing, the last holding one worktree per repository. What
 * is here is pure — the rules a creation, a preparation and a run apply — and every act on the
 * disk, on Git or on a process belongs to the engine, which asks these rules before it acts.
 *
 * A preparation is a list of steps, each with its own state, written as it changes (D8-05): the
 * worktrees first, in the repositories' order, then the Project's recipe in its order. A failure
 * stops the list and keeps what was done; a resume re-checks what was done against the disk
 * before it carries on, and never reruns a command that already ran.
 */

import { MAIN_WORKSPACE } from './project.ts'

/** Where a Workspace stands: being prepared, ready to work in, stopped by a step, or cleaned. */
export const WORKSPACE_STATES = ['preparing', 'ready', 'failed', 'cleaned'] as const

export type WorkspaceState = (typeof WORKSPACE_STATES)[number]

/** What a step of a preparation does: a worktree, or one of the three kinds of a recipe. */
export const STEP_KINDS = ['worktree', 'copy', 'link', 'run'] as const

export type StepKind = (typeof STEP_KINDS)[number]

/** Where a step stands; `skipped` is a step that had nothing to do, and counts as done. */
export const STEP_STATES = ['pending', 'running', 'done', 'failed', 'skipped'] as const

export type StepState = (typeof STEP_STATES)[number]

/** What a step of a Project's recipe does (D8-05): copy a file, link one, or run a command. */
export const RECIPE_KINDS = ['copy', 'link', 'run'] as const

export type RecipeKind = (typeof RECIPE_KINDS)[number]

/**
 * One step of a Project's recipe (D8-05 as amended by recette 1).
 *
 * `base` is where a copy or a link applies: one of the Project's repositories as the Project
 * declares it, or null for the Workspace root — several repositories are several steps. `path` is
 * relative to that base, a file or a folder, for a copy and a link, and null for a run;
 * `commandId` is the catalogue command a run starts, and null otherwise. `rank` orders the recipe
 * as a repository's rank orders the repositories.
 */
export interface RecipeStep {
  readonly id: string
  readonly kind: RecipeKind
  readonly base: string | null
  readonly path: string | null
  readonly commandId: string | null
  readonly rank: string
}

/**
 * One step of a Workspace as the domain reasons about it: what it is, what it targets, where it
 * stands.
 */
export interface WorkspaceStep {
  readonly id: string
  /** Its place in the preparation, counting from one. */
  readonly position: number
  readonly kind: StepKind
  /**
   * The relative path of the worktree, the recipe's path relative to its base, or the name of the
   * command it runs.
   */
  readonly target: string
  /** The repository a copy or a link applies under, and null for the root, a worktree or a run. */
  readonly base: string | null
  readonly commandId: string | null
  readonly state: StepState
  /** What refused it, as it was said — Git's own words, the system's — and null otherwise. */
  readonly message: string | null
  /** The run a `run` step started, and null until it started one. */
  readonly runId: string | null
}

export class InvalidWorkspaceNameError extends Error {
  constructor(reason: string) {
    super(`the Workspace name is refused: ${reason}`)
    this.name = 'InvalidWorkspaceNameError'
  }
}

export class InvalidVariableKeyError extends Error {
  constructor(candidate: string) {
    super(
      `a variable is named in capitals, digits and underscores, not starting with a digit, and "${candidate}" is not`,
    )
    this.name = 'InvalidVariableKeyError'
  }
}

/**
 * The name a Workspace is created with (D8-02), which is also the folder it lives in under the
 * Project's root of Workspaces: so it is one folder name, never a path, and never `main`, which
 * every Project already has.
 */
export function workspaceName(candidate: string): string {
  const name = candidate.trim()
  if (name.length === 0) throw new InvalidWorkspaceNameError('it is empty')
  if (name.includes('/') || name.includes('\\')) {
    throw new InvalidWorkspaceNameError('it is a folder name, not a path')
  }
  if (name === '.' || name.includes('..')) {
    throw new InvalidWorkspaceNameError('it would leave the folder of the Workspaces')
  }
  if (name === MAIN_WORKSPACE) {
    throw new InvalidWorkspaceNameError(`${MAIN_WORKSPACE} is the Project's own Workspace`)
  }
  return name
}

/**
 * A text as a slug: lowercase ASCII letters and digits, one dash between words, none at the ends.
 * An accented letter keeps its letter (`é` is `e`); anything else separates words.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The prefix of a Project's branches when it sets none: its name as a slug (D8-04). */
export function defaultBranchPrefix(projectName: string): string {
  const slug = slugify(projectName)
  return slug === '' ? 'hemera' : slug
}

/** The branch a dedicated Workspace is created on: `<prefix>/<key>-<slug>` (D8-04). */
export function branchNameFor(prefix: string, key: string, slug: string): string {
  return `${prefix}/${key}-${slug}`
}

/**
 * The steps a Workspace is prepared with (D8-05): one worktree per included repository, in the
 * repositories' order, then the Project's recipe in its order, every one of them `pending`.
 *
 * A run step's target is the name of its command, so the list reads as the user wrote it; a
 * command gone from the catalogue since leaves its step with an empty name, and the engine is
 * the one that refuses to run it.
 */
export function stepsFor(
  worktrees: readonly string[],
  recipe: readonly RecipeStep[],
  commandNames: ReadonlyMap<string, string>,
): Omit<WorkspaceStep, 'id'>[] {
  const targets: Pick<WorkspaceStep, 'kind' | 'target' | 'base' | 'commandId'>[] = [
    ...worktrees.map((path) => ({
      kind: 'worktree' as const,
      target: path,
      base: null,
      commandId: null,
    })),
    ...recipe.map((step) => ({
      kind: step.kind,
      target:
        step.kind === 'run' ? (commandNames.get(step.commandId ?? '') ?? '') : (step.path ?? ''),
      base: step.kind === 'run' ? null : step.base,
      commandId: step.commandId,
    })),
  ]
  return targets.map((step, index) => ({
    position: index + 1,
    kind: step.kind,
    target: step.target,
    base: step.base,
    commandId: step.commandId,
    state: 'pending',
    message: null,
    runId: null,
  }))
}

/**
 * The steps of a preparation as a resume finds them (D8-05, "Resume").
 *
 * A `done` step whose result is no longer there — `present` answers that from the disk — is
 * `pending` again; the `failed` one is retried, and one left `running` by an engine that stopped
 * is started again. Everything else is kept: a `done` run is not run twice, and a `skipped` step
 * had nothing to do.
 */
export function resumedSteps(
  steps: readonly WorkspaceStep[],
  present: (step: WorkspaceStep) => boolean,
): WorkspaceStep[] {
  return steps.map((step) => {
    const redone =
      step.state === 'failed' ||
      step.state === 'running' ||
      (step.state === 'done' && !present(step))
    return redone ? { ...step, state: 'pending', message: null } : step
  })
}

/** The step a preparation carries on with: the first one still `pending`, or null when none is. */
export function nextPending(steps: readonly WorkspaceStep[]): WorkspaceStep | null {
  const pending = steps.filter((step) => step.state === 'pending')
  return pending.reduce<WorkspaceStep | null>(
    (first, step) => (first === null || step.position < first.position ? step : first),
    null,
  )
}

/**
 * Where a Workspace stands from its steps (D8-05): `ready` when every step is done or skipped —
 * no step at all included, a Workspace on a folder of the user's — `failed` when one failed, and
 * `preparing` otherwise.
 */
export function workspaceStateOf(steps: readonly WorkspaceStep[]): WorkspaceState {
  if (steps.every((step) => step.state === 'done' || step.state === 'skipped')) return 'ready'
  if (steps.some((step) => step.state === 'failed')) return 'failed'
  return 'preparing'
}

/** Variables as a map or as a plain record: both are what a Project or a Workspace sets. */
export type Variables = ReadonlyMap<string, string> | Readonly<Record<string, string>>

function pairsOf(variables: Variables): [string, string][] {
  return variables instanceof Map ? [...variables.entries()] : Object.entries(variables)
}

/**
 * The environment a run, a step or an agent of a Workspace is given (D8-06): the process's own,
 * then the Project's variables over it, then the Workspace's over those. A variable the process
 * holds with no value is not a variable, and is left out.
 */
export function mergedEnvironment(
  process: Readonly<Record<string, string | undefined>>,
  project: Variables,
  workspace: Variables,
): Record<string, string> {
  const merged = new Map<string, string>()
  for (const [key, value] of Object.entries(process)) {
    if (value !== undefined) merged.set(key, value)
  }
  for (const [key, value] of [...pairsOf(project), ...pairsOf(workspace)]) merged.set(key, value)
  return Object.fromEntries(merged)
}

/** The name of a variable, as a shell would take it: capitals, digits and underscores (D8-06). */
export function variableKey(candidate: string): string {
  const key = candidate.trim()
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new InvalidVariableKeyError(candidate)
  return key
}
