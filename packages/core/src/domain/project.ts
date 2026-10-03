/**
 * The rules of a Project and of its repositories: what a name, a repository path, a base branch
 * and a branch prefix may be.
 *
 * A Project is a set of Git repositories worked on together, with its main checkout: the folder
 * on disk where the user's own clones live. The base branch is something else: the branch a
 * repository's work starts from and is delivered to. The two are never confused, and no branch
 * name is written in the code but the one default below.
 *
 * Each rule answers a `Result`: a refusal is a value with its reason, never a throw.
 */

import { Result, Schema } from 'effect'

/** The longest Project name kept, so a name never becomes a document of its own. */
export const MAX_PROJECT_NAME_LENGTH = 120

/** The path of a repository that is the main checkout itself. */
export const ROOT_REPOSITORY = '.'

/**
 * The base branch a repository is given when it is added, until the user chooses another. The
 * one place in the code where a branch is named.
 */
export const DEFAULT_BASE_BRANCH = 'main'

/** What the default branch prefix is when a Project's name leaves nothing to make one of. */
const FALLBACK_PREFIX = 'project'

export class InvalidProjectName extends Schema.TaggedError<InvalidProjectName>()(
  'InvalidProjectName',
  { name: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `This Project name is refused: ${this.reason}.`
  }
}

export class InvalidRepositoryPath extends Schema.TaggedError<InvalidRepositoryPath>()(
  'InvalidRepositoryPath',
  { path: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `“${this.path}” cannot be a repository of this Project: ${this.reason}.`
  }
}

export class InvalidBranchName extends Schema.TaggedError<InvalidBranchName>()(
  'InvalidBranchName',
  { name: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `“${this.name}” is not a branch name Git accepts: ${this.reason}.`
  }
}

/** The name a Project is given, without the spaces around it. */
export function projectName(candidate: string): Result.Result<string, InvalidProjectName> {
  const name = candidate.trim()
  const refused = (reason: string) => Result.fail(new InvalidProjectName({ name, reason }))
  if (name.length === 0) return refused('it is empty')
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return refused(`it is longer than ${MAX_PROJECT_NAME_LENGTH} characters`)
  }
  return Result.succeed(name)
}

/**
 * A repository's path, relative to the main checkout, in one spelling: forward slashes, no `.`
 * segment, no trailing slash, `.` for the main checkout itself. An absolute path, or one that
 * climbs out through `..`, is refused. Where a link leads is the engine's to check: it needs the
 * disk.
 */
export function repositoryPath(candidate: string): Result.Result<string, InvalidRepositoryPath> {
  const path = candidate.trim().replaceAll('\\', '/')
  const refused = (reason: string) =>
    Result.fail(new InvalidRepositoryPath({ path: candidate, reason }))
  if (path.length === 0) return refused('it is empty')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return refused('it is absolute')

  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return refused('it leaves the main checkout')
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return Result.succeed(segments.length === 0 ? ROOT_REPOSITORY : segments.join('/'))
}

/**
 * Why Git would refuse a name as a branch, or null when it accepts it: the rules of
 * `git check-ref-format --branch`, written here so that checking a name needs no Git and no
 * repository. A test holds them to what the machine's own Git says.
 */
export function branchNameRefusal(name: string): string | null {
  if (name === '') return 'it is empty'
  if (name === '@') return 'it is “@” alone'
  if (name === 'HEAD') return 'it is “HEAD”'
  if (name.startsWith('-')) return 'it starts with “-”'
  // oxlint-disable-next-line no-control-regex -- a control character is exactly what is refused
  if (/[\u0000- \u007f]/.test(name)) return 'it holds a space or a control character'
  if (/[~^:?*[\\]/.test(name)) return 'it holds one of ~ ^ : ? * [ \\'
  if (name.includes('..')) return 'it holds “..”'
  if (name.includes('@{')) return 'it holds “@{”'
  if (name.startsWith('/') || name.endsWith('/')) return 'it starts or ends with “/”'
  if (name.includes('//')) return 'it holds “//”'
  if (name.endsWith('.')) return 'it ends with “.”'
  for (const component of name.split('/')) {
    if (component.startsWith('.')) return 'a part of it starts with “.”'
    if (component.endsWith('.lock')) return 'a part of it ends with “.lock”'
  }
  return null
}

const checkedBranch = (
  name: string,
  candidate: string,
): Result.Result<string, InvalidBranchName> => {
  const reason = branchNameRefusal(name)
  return reason === null
    ? Result.succeed(name)
    : Result.fail(new InvalidBranchName({ name: candidate, reason }))
}

/** A base branch, as the user named it: refused unless Git accepts it as a branch name. */
export function branchName(candidate: string): Result.Result<string, InvalidBranchName> {
  return checkedBranch(candidate, candidate)
}

/**
 * A prefix for the branches of a Project's Workspaces, without the spaces around it: what goes in
 * front of `/<name>`, so it is itself a branch name Git accepts, folders included.
 */
export function branchPrefix(candidate: string): Result.Result<string, InvalidBranchName> {
  return checkedBranch(candidate.trim(), candidate)
}

/**
 * The prefix a Project's Workspace branches take until the user chooses one: its name as a slug,
 * lower case, accents dropped, every run of other characters one dash.
 */
export function defaultBranchPrefix(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? FALLBACK_PREFIX : slug
}
