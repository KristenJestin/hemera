/**
 * What the Workspace surfaces are handed (D8-01, D8-04, D8-05, D8-15).
 *
 * The design system is a leaf: these are its own shapes, not the domain's, and the application
 * maps one onto the other. Nothing here is read from Git or the disk: what Git says arrives
 * already said, and a refusal arrives as the sentence to show.
 */

/** Where a Workspace stands: `main` is `ready` from its creation (D8-01). */
export type WorkspaceState = 'preparing' | 'ready' | 'failed' | 'cleaned'

/** What one step of a preparation does: a worktree per repository, then the Project's recipe. */
export type StepKind = 'worktree' | 'copy' | 'link' | 'run'

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** What Git says about one repository of a Workspace, read when shown, never stored (D8-15). */
export type GitState =
  | {
      readonly ok: true
      readonly branch: string
      readonly commit: string
      readonly staged: number
      readonly unstaged: number
      readonly untracked: number
    }
  | {
      readonly ok: false
      /** Git's own message, as it is. */
      readonly error: string
    }

export interface WorkspaceRepositoryLine {
  /** Relative to the Workspace, as the Project declares it: `./sources/api`. */
  readonly path: string
  /** Null while Git is being asked. */
  readonly git: GitState | null
}

export interface PreparationStepLine {
  readonly id: string
  readonly kind: StepKind
  /** What the step works on: `./sources/api`, `.env in repositories`, `CLAUDE.md at root`, `install`. */
  readonly target: string
  readonly state: StepState
  /** The failure as Git or the disk said it, or why the step was skipped. */
  readonly message?: string | undefined
  /** The run a `run` step started, once it started one: what its details are read from. */
  readonly runId?: string | undefined
}

/** One repository of the plan a dedicated Workspace is created from (D8-04). */
export interface PlanRepositoryLine {
  /** Relative to the Workspace, as the Project declares it. */
  readonly path: string
  /** Whether `main` holds a repository there; one that does not gets no worktree. */
  readonly holdsRepository: boolean
  /** The repository's local branches in `main`, in Git's own order: what its base is chosen from. */
  readonly branches: readonly string[]
  /**
   * What the new branch starts from: the branch `main` is checked out on, or the commit it is on
   * when it is on none of them; null when there is nothing to start from.
   */
  readonly base: string | null
  /** The short hash of that commit, only when `main` is on none of its branches (D8-04). */
  readonly detachedCommit: string | null
  /** The branch the worktree is created on: `<branch_prefix>/<key>-<slug>`. */
  readonly branch: string
  /** Whether the repository is in the Workspace unless the user leaves it out. */
  readonly included: boolean
}

/** What the creation dialog hands over: the name, and the included repositories only. */
export interface WorkspaceDraft {
  readonly name: string
  readonly repositories: readonly {
    readonly path: string
    readonly base: string
    readonly branch: string
  }[]
}

/**
 * What Git says of a Workspace's own folder, summed up by the caller for its row: the branch, the
 * commit and the changes, already said (D8-15).
 */
export interface WorkspaceSummary {
  readonly branch: string
  readonly commit: string
  /** The changes, already said: `clean`, `2 unstaged`. */
  readonly changes: string
}

/** One Workspace of a Project, as its settings list it (D8-02). */
export interface WorkspaceRow {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly state: WorkspaceState
  /** Whether it is the Project's own folder, which is never cleaned up. */
  readonly main: boolean
  /**
   * Whether Hemera made it, with its worktrees — for a Spec or from the settings: the only kind
   * that is cleaned up (D8-14). A folder the user mapped is theirs, and Hemera removes nothing
   * from it.
   */
  readonly dedicated: boolean
  /** The key of the Spec it was made for, when it was made for one. */
  readonly specKey?: string | undefined
  /** What Git says of its folder, shown on its row: `main`'s, which the caller reads. */
  readonly summary?: WorkspaceSummary | undefined
}
