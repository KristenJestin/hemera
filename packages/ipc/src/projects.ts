/**
 * Projects and their repositories, as they cross the links: the records, what Git says of a
 * repository, and the refusals a screen is shown.
 *
 * The main checkout is a Project's folder on disk. The base branch is the branch a repository's
 * work starts from and is delivered to. The two are different things and keep different names.
 */

import { InvalidBranchName, InvalidProjectName, InvalidRepositoryPath } from '@hemera/core/domain'
import { Schema } from 'effect'

export { InvalidBranchName, InvalidProjectName, InvalidRepositoryPath }

/** A repository of a Project, and what it was told to start from and deliver to. */
export const Repository = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** Relative to the main checkout, with forward slashes; `.` is the main checkout itself. */
  path: Schema.String,
  /** Whether a Workspace takes this repository unless it is left out. */
  includedByDefault: Schema.Boolean,
  /** The remote its base is fetched from, or null when it has none. */
  remote: Schema.NullOr(Schema.String),
  baseBranch: Schema.String,
  /** When its base was last fetched, or null when it never was. */
  lastFetchedAt: Schema.NullOr(Schema.String),
})
export type Repository = typeof Repository.Type

export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The folder of the user's own clones, absolute. */
  mainCheckout: Schema.String,
  /** Where its Workspaces are created, or null for Hemera's own folder. */
  workspacesRoot: Schema.NullOr(Schema.String),
  /** What its Workspace branches start with, or null for its name as a slug. */
  branchPrefix: Schema.NullOr(Schema.String),
  version: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** In the order they were added. */
  repositories: Schema.Array(Repository),
})
export type Project = typeof Project.Type

/** A Project to create: its name, its main checkout, and the repositories it starts with. */
export const NewProject = Schema.Struct({
  name: Schema.String,
  mainCheckout: Schema.String,
  /** Paths relative to the main checkout, as `projects.detectRepositories` proposes them. */
  repositories: Schema.Array(Schema.String),
})
export type NewProject = typeof NewProject.Type

/** Every edit names the version of the Project it was made from. */
const edit = { id: Schema.String, version: Schema.Number }

/** A change of a Project's name or main checkout: only what it names changes. */
export const ProjectEdit = Schema.Struct({
  ...edit,
  name: Schema.optionalKey(Schema.String),
  mainCheckout: Schema.optionalKey(Schema.String),
})
export type ProjectEdit = typeof ProjectEdit.Type

/** The Workspaces folder chosen, or null for Hemera's own. */
export const WorkspacesRootEdit = Schema.Struct({ ...edit, path: Schema.NullOr(Schema.String) })
export type WorkspacesRootEdit = typeof WorkspacesRootEdit.Type

/** The branch prefix chosen, or null for the Project's name as a slug. */
export const BranchPrefixEdit = Schema.Struct({ ...edit, prefix: Schema.NullOr(Schema.String) })
export type BranchPrefixEdit = typeof BranchPrefixEdit.Type

/** A repository added to a Project, at the version of the Project it was added to. */
export const NewRepository = Schema.Struct({
  projectId: Schema.String,
  version: Schema.Number,
  path: Schema.String,
})
export type NewRepository = typeof NewRepository.Type

/**
 * An edit of a repository: `id` is the repository's, `version` its Project's, since a repository
 * is part of its Project's record.
 */
export const RepositoryEdit = Schema.Struct({
  ...edit,
  path: Schema.optionalKey(Schema.String),
  includedByDefault: Schema.optionalKey(Schema.Boolean),
})
export type RepositoryEdit = typeof RepositoryEdit.Type

export const RepositoryRemoval = Schema.Struct(edit)
export type RepositoryRemoval = typeof RepositoryRemoval.Type

/** The remote chosen for a repository, or null for none. */
export const RemoteEdit = Schema.Struct({ ...edit, remote: Schema.NullOr(Schema.String) })
export type RemoteEdit = typeof RemoteEdit.Type

export const BaseBranchEdit = Schema.Struct({ ...edit, branch: Schema.String })
export type BaseBranchEdit = typeof BaseBranchEdit.Type

/** A remote of a repository, as `git remote -v` lists it. */
export const Remote = Schema.Struct({
  name: Schema.String,
  fetchUrl: Schema.String,
  pushUrl: Schema.String,
})
export type Remote = typeof Remote.Type

/** Git read the repository: the branch checked out, or none when HEAD is detached. */
export const Readable = Schema.TaggedStruct('Readable', {
  branch: Schema.NullOr(Schema.String),
  /** The commit checked out, or null in a repository with no commit yet. */
  commit: Schema.NullOr(Schema.String),
  dirty: Schema.Boolean,
})

/** Git could not read the repository; the reason is Git's own message. */
export const Unreadable = Schema.TaggedStruct('Unreadable', { reason: Schema.String })

export const RepositoryStatus = Schema.Union([Readable, Unreadable])
export type RepositoryStatus = typeof RepositoryStatus.Type

/** The base was fetched from the remote just now. */
export const FetchedNow = Schema.TaggedStruct('FetchedNow', { at: Schema.String })

/**
 * The fetch failed (offline, a remote that refused, credentials it would have asked for): the
 * last tracking ref known is used. `since` is the last fetch that succeeded, or null for never.
 */
export const NotFetchedSince = Schema.TaggedStruct('NotFetchedSince', {
  since: Schema.NullOr(Schema.String),
  reason: Schema.String,
})

/** The repository has no remote: its local base branch is used. */
export const LocalBranch = Schema.TaggedStruct('LocalBranch', {})

export const BaseFreshness = Schema.Union([FetchedNow, NotFetchedSince, LocalBranch])
export type BaseFreshness = typeof BaseFreshness.Type

/** The commit a piece of work starts from, the ref it was read from, and how fresh it is. */
export const UpToDateBase = Schema.Struct({
  commit: Schema.String,
  ref: Schema.String,
  freshness: BaseFreshness,
})
export type UpToDateBase = typeof UpToDateBase.Type

/** A repository's status changed since it was last read. */
export const RepositoryStatusChange = Schema.Struct({
  repositoryId: Schema.String,
  projectId: Schema.String,
  status: RepositoryStatus,
})
export type RepositoryStatusChange = typeof RepositoryStatusChange.Type

/** Git refused: its standard error as it wrote it, with what it was asked and where. */
export class GitFailed extends Schema.TaggedError<GitFailed>()('GitFailed', {
  args: Schema.Array(Schema.String),
  folder: Schema.String,
  stderr: Schema.String,
}) {
  override get message(): string {
    const said = this.stderr.trim()
    return said === '' ? `git ${this.args.join(' ')} failed in ${this.folder}` : said
  }
}

/** The program Hemera runs as Git is not on the PATH. */
export class GitMissing extends Schema.TaggedError<GitMissing>()('GitMissing', {
  program: Schema.String,
}) {
  override get message(): string {
    return `Git was not found: ${this.program} is not on the PATH.`
  }
}

/** Hemera stopped a Git command that ran past its limit, or printed past it. */
export class GitCut extends Schema.TaggedError<GitCut>()('GitCut', {
  args: Schema.Array(Schema.String),
  folder: Schema.String,
  /** What ran out: the time, or the room for its output. */
  limit: Schema.Literals(['time', 'output']),
  seconds: Schema.Number,
}) {
  override get message(): string {
    return this.limit === 'time'
      ? `Git did not answer within ${String(this.seconds)} seconds.`
      : 'Git printed more than Hemera reads of one answer.'
  }
}

export class UnknownProject extends Schema.TaggedError<UnknownProject>()('UnknownProject', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This Project no longer exists.'
  }
}

export class UnknownRepository extends Schema.TaggedError<UnknownRepository>()(
  'UnknownRepository',
  { id: Schema.String },
) {
  override get message(): string {
    return 'This repository is no longer part of its Project.'
  }
}

/** A remote chosen for a repository that has no remote of that name. */
export class UnknownRemote extends Schema.TaggedError<UnknownRemote>()('UnknownRemote', {
  name: Schema.String,
}) {
  override get message(): string {
    return `This repository has no remote named “${this.name}”.`
  }
}

/** A folder a Project cannot have: a main checkout that is not absolute, or a bad Workspaces root. */
export class InvalidFolder extends Schema.TaggedError<InvalidFolder>()('InvalidFolder', {
  path: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `“${this.path}” is refused: ${this.reason}.`
  }
}

/**
 * Neither the remote nor the last tracking ref known gives the base: the branch was never fetched
 * and cannot be now, or the local branch of a repository without a remote does not exist.
 */
export class BaseUnavailable extends Schema.TaggedError<BaseUnavailable>()('BaseUnavailable', {
  remote: Schema.NullOr(Schema.String),
  branch: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return this.remote === null
      ? `The branch ${this.branch} does not exist in this repository.`
      : `${this.remote}/${this.branch} was never fetched and cannot be now: ${this.reason}`
  }
}
