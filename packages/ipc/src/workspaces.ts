/**
 * Workspaces, the preparation recipe and the variables, as they cross the links.
 *
 * A Workspace is a Project's isolated folder: one Git worktree per repository it took, prepared by
 * the Project's recipe and run with the Project's and its own variables. "Workspace" here is the
 * product's, never a pnpm workspace.
 */

import {
  InvalidBranchName,
  InvalidRepositoryPath,
  InvalidTemplate,
  InvalidVariableKey,
  InvalidWorkspaceName,
  MaskedText,
  PREPARATION_STATES,
  RECIPE_KINDS,
  STEP_KINDS,
  STEP_STATES,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StaleVersion, StorageFailed } from './profile.ts'
import {
  BaseFreshness,
  BaseUnavailable,
  GitCut,
  GitFailed,
  GitMissing,
  UnknownProject,
  UnknownRepository,
} from './projects.ts'

export { InvalidTemplate, InvalidVariableKey, InvalidWorkspaceName }

export const StepKind = Schema.Literals(STEP_KINDS)
export const StepState = Schema.Literals(STEP_STATES)
export const PreparationState = Schema.Literals(PREPARATION_STATES)
export const RecipeKind = Schema.Literals(RECIPE_KINDS)

/**
 * The commit a worktree was made from: the up-to-date base it was read from (its ref and how
 * fresh it was), or a commit the caller gave, with neither.
 */
export const WorkspaceBase = Schema.Struct({
  commit: Schema.String,
  ref: Schema.NullOr(Schema.String),
  freshness: Schema.NullOr(BaseFreshness),
})
export type WorkspaceBase = typeof WorkspaceBase.Type

/** A repository of a Workspace: its worktree, as it was made. */
export const WorkspaceRepository = Schema.Struct({
  repositoryId: Schema.String,
  /** The repository's path in the main checkout when the Workspace was made. */
  path: Schema.String,
  /** The worktree's folder, absolute. */
  worktree: Schema.String,
  base: WorkspaceBase,
})
export type WorkspaceRepository = typeof WorkspaceRepository.Type

/** What a failed step did, and the end of what it printed or of what refused it. */
/** A step that failed: what it was doing, and the end of what it printed, masked. */
export const StepFailure = Schema.Struct({ doing: Schema.String, output: MaskedText })
export type StepFailure = typeof StepFailure.Type

/** A step of a Workspace's preparation, where it stands now. */
export const PreparationStep = Schema.Struct({
  id: Schema.String,
  /** Its place in the preparation, counting from one. */
  position: Schema.Number,
  kind: StepKind,
  /** The repository path it applies under, or null for the Workspace's root. */
  base: Schema.NullOr(Schema.String),
  /** What a copy or a link places, or the folder a run runs in, under its base. */
  path: Schema.NullOr(Schema.String),
  commandId: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.String),
  state: StepState,
  failure: Schema.NullOr(StepFailure),
})
export type PreparationStep = typeof PreparationStep.Type

export const Workspace = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  /** Its folder, absolute. */
  folder: Schema.String,
  /** The branch its worktrees were made on, or null for worktrees on a detached HEAD. */
  branch: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  preparation: PreparationState,
  /** Whether its preparation runs in the engine now. */
  preparing: Schema.Boolean,
  repositories: Schema.Array(WorkspaceRepository),
  steps: Schema.Array(PreparationStep),
})
export type Workspace = typeof Workspace.Type

/** Worktrees on a new branch, `<branch prefix>/<name>`, each from its repository's up-to-date base. */
export const NewBranch = Schema.TaggedStruct('NewBranch', {})

/**
 * Worktrees on a detached HEAD, in a folder of the caller's: each repository at the commit given
 * for it, by its identifier.
 */
export const DetachedAt = Schema.TaggedStruct('DetachedAt', {
  folder: Schema.String,
  commits: Schema.Record(Schema.String, Schema.String),
})

export const WorkspaceMode = Schema.Union([NewBranch, DetachedAt])
export type WorkspaceMode = typeof WorkspaceMode.Type

export const NewWorkspace = Schema.Struct({
  projectId: Schema.String,
  name: Schema.String,
  /** The repositories that get a worktree, by identifier: the caller's choice. */
  repositories: Schema.Array(Schema.String),
  mode: WorkspaceMode,
})
export type NewWorkspace = typeof NewWorkspace.Type

/**
 * Git read the worktree: its branch (null when detached), the files a removal would lose, and how
 * far it is from its base, null in the main checkout when its base was never fetched.
 */
export const WorktreeRead = Schema.TaggedStruct('WorktreeRead', {
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.String),
  changed: Schema.Array(Schema.String),
  ahead: Schema.NullOr(Schema.Number),
  behind: Schema.NullOr(Schema.Number),
})

/** Git could not read it; the reason is Git's own. */
export const WorktreeUnreadable = Schema.TaggedStruct('WorktreeUnreadable', {
  reason: Schema.String,
})

/** Its worktree is not made yet: the step that makes it, where it stands. */
export const WorktreeNotMade = Schema.TaggedStruct('WorktreeNotMade', { step: StepState })

export const WorktreeState = Schema.Union([WorktreeRead, WorktreeUnreadable, WorktreeNotMade])
export type WorktreeState = typeof WorktreeState.Type

/** A repository of a Workspace, or of the main checkout, as Git reads it now; stored nowhere. */
export const WorkspaceRepositoryStatus = Schema.Struct({
  repositoryId: Schema.String,
  path: Schema.String,
  state: WorktreeState,
})
export type WorkspaceRepositoryStatus = typeof WorkspaceRepositoryStatus.Type

/** A Workspace as a committed change left it, or null once it was removed. */
export const WorkspaceChange = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  workspace: Schema.NullOr(Workspace),
})
export type WorkspaceChange = typeof WorkspaceChange.Type

/** A step of the recipe, as the settings write it. */
export const RecipeStepDraft = Schema.Struct({
  kind: RecipeKind,
  /** The repository it applies under, or null for the main checkout's root. */
  repositoryId: Schema.NullOr(Schema.String),
  /** What a copy or a link places, or the folder a run runs in, under its repository. */
  path: Schema.NullOr(Schema.String),
  /** The catalogue command a run starts, or null for a line of its own. */
  commandId: Schema.NullOr(Schema.String),
  /** The line a run of its own runs, or null for a catalogue command. */
  line: Schema.NullOr(Schema.String),
})
export type RecipeStepDraft = typeof RecipeStepDraft.Type

export const RecipeStep = Schema.Struct({
  ...RecipeStepDraft.fields,
  id: Schema.String,
  position: Schema.Number,
})
export type RecipeStep = typeof RecipeStep.Type

/** The whole recipe, written at the Project's version. */
export const RecipeEdit = Schema.Struct({
  projectId: Schema.String,
  version: Schema.Number,
  steps: Schema.Array(RecipeStepDraft),
})
export type RecipeEdit = typeof RecipeEdit.Type

/** What is wrong with one step of a recipe, by its position counting from one, or nothing. */
export const RecipeCheck = Schema.Struct({
  position: Schema.Number,
  problem: Schema.NullOr(Schema.String),
})
export type RecipeCheck = typeof RecipeCheck.Type

/** Where a variable is set: the Project's (`workspaceId` null) or one Workspace's. */
const scope = { projectId: Schema.String, workspaceId: Schema.NullOr(Schema.String) }
export const VariableScope = Schema.Struct(scope)
export type VariableScope = typeof VariableScope.Type

/** A variable as it is listed: its name, and a mask in place of its value. */
export const MaskedVariable = Schema.Struct({ key: Schema.String, value: Schema.String })
export type MaskedVariable = typeof MaskedVariable.Type

export const VariableEdit = Schema.Struct({ ...scope, key: Schema.String, value: Schema.String })
export type VariableEdit = typeof VariableEdit.Type

export const VariableKey = Schema.Struct({ ...scope, key: Schema.String })
export type VariableKey = typeof VariableKey.Type

export class UnknownWorkspace extends Schema.TaggedError<UnknownWorkspace>()('UnknownWorkspace', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This Workspace no longer exists.'
  }
}

/** A Workspace that cannot be made as asked, and why; nothing was made or written. */
export class WorkspaceRefused extends Schema.TaggedError<WorkspaceRefused>()('WorkspaceRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This Workspace cannot be made: ${this.reason}.`
  }
}

/** A preparation of this Workspace already runs: a second one is refused, not interleaved. */
export class PreparationRunning extends Schema.TaggedError<PreparationRunning>()(
  'PreparationRunning',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This Workspace is already being prepared.'
  }
}

/**
 * A removal refused before anything was removed: work that would be lost (the file is named), a
 * file a program holds open, or a preparation under way.
 */
export class RemovalRefused extends Schema.TaggedError<RemovalRefused>()('RemovalRefused', {
  reason: Schema.String,
  /** The file that refused it, relative to its worktree, when one did. */
  file: Schema.NullOr(Schema.String),
}) {
  override get message(): string {
    return `This Workspace was not removed: ${this.reason}.`
  }
}

/** A step the recipe cannot hold, and why. */
export class InvalidRecipeStep extends Schema.TaggedError<InvalidRecipeStep>()(
  'InvalidRecipeStep',
  { position: Schema.Number, reason: Schema.String },
) {
  override get message(): string {
    return `Step ${String(this.position)} of the recipe is refused: ${this.reason}.`
  }
}

/** No variable of that name is set there. */
export class UnknownVariable extends Schema.TaggedError<UnknownVariable>()('UnknownVariable', {
  key: Schema.String,
}) {
  override get message(): string {
    return `No variable named “${this.key}” is set here.`
  }
}

const always = [StorageFailed, EngineGone] as const
const git = [GitFailed, GitMissing, GitCut] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const workspaceId = { id: Schema.String }

/**
 * The Workspaces: made, read, observed, prepared and removed. `prepare` and `resume` answer at
 * once, the preparation running on in the engine; `changes` is each Workspace as a committed
 * change left it, its steps included, for as long as the caller listens.
 */
export const WorkspacesRpcs = RpcGroup.make(
  Rpc.make('workspaces.create', {
    payload: NewWorkspace,
    success: Workspace,
    error: failing(
      ...always,
      ...git,
      UnknownProject,
      UnknownRepository,
      InvalidWorkspaceName,
      InvalidBranchName,
      WorkspaceRefused,
      BaseUnavailable,
    ),
  }),
  Rpc.make('workspaces.get', {
    payload: workspaceId,
    success: Workspace,
    error: failing(...always, UnknownWorkspace),
  }),
  Rpc.make('workspaces.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(Workspace),
    error: failing(...always),
  }),
  /** Each repository of a Workspace, or of the main checkout for `workspaceId` null. */
  Rpc.make('workspaces.status', {
    payload: VariableScope,
    success: Schema.Array(WorkspaceRepositoryStatus),
    error: failing(...always, UnknownProject, UnknownWorkspace, GitMissing),
  }),
  Rpc.make('workspaces.prepare', {
    payload: workspaceId,
    success: Workspace,
    error: failing(...always, UnknownWorkspace, PreparationRunning),
  }),
  Rpc.make('workspaces.resume', {
    payload: workspaceId,
    success: Workspace,
    error: failing(...always, UnknownWorkspace, PreparationRunning),
  }),
  Rpc.make('workspaces.remove', {
    payload: workspaceId,
    success: Schema.Void,
    error: failing(...always, ...git, UnknownProject, UnknownWorkspace, RemovalRefused),
  }),
  Rpc.make('workspaces.changes', {
    success: WorkspaceChange,
    error: failing(...always),
    stream: true,
  }),
)

/** A Project's preparation recipe: read, written whole at the Project's version, and checked. */
export const RecipeRpcs = RpcGroup.make(
  Rpc.make('recipe.get', {
    payload: { projectId: Schema.String },
    success: Schema.Array(RecipeStep),
    error: failing(...always, UnknownProject),
  }),
  Rpc.make('recipe.save', {
    payload: RecipeEdit,
    success: Schema.Array(RecipeStep),
    error: failing(
      ...always,
      UnknownProject,
      StaleVersion,
      InvalidRecipeStep,
      InvalidRepositoryPath,
      InvalidTemplate,
    ),
  }),
  /** What `save` would refuse of each step, without writing anything. */
  Rpc.make('recipe.check', {
    payload: { projectId: Schema.String, steps: Schema.Array(RecipeStepDraft) },
    success: Schema.Array(RecipeCheck),
    error: failing(...always, UnknownProject),
  }),
)

/**
 * The environment variables of a Project and of its Workspaces. A list answers names with a mask;
 * `reveal` answers one value, on an explicit request.
 */
export const VariablesRpcs = RpcGroup.make(
  Rpc.make('variables.list', {
    payload: VariableScope,
    success: Schema.Array(MaskedVariable),
    error: failing(...always, UnknownProject, UnknownWorkspace),
  }),
  Rpc.make('variables.set', {
    payload: VariableEdit,
    success: MaskedVariable,
    error: failing(
      ...always,
      UnknownProject,
      UnknownWorkspace,
      InvalidVariableKey,
      InvalidTemplate,
    ),
  }),
  Rpc.make('variables.remove', {
    payload: VariableKey,
    success: Schema.Void,
    error: failing(...always, UnknownProject, UnknownWorkspace, UnknownVariable),
  }),
  Rpc.make('variables.reveal', {
    payload: VariableKey,
    success: Schema.String,
    error: failing(...always, UnknownProject, UnknownWorkspace, UnknownVariable),
  }),
)
