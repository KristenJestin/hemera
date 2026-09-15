/**
 * A project: a durable logical grouping that exists before its sources do.
 *
 * The project has no physical root of its own. The path belongs to its `main` workspace, which
 * is its main working environment and is never a removable resource. The name `main` says
 * nothing about a Git branch.
 */

/** Name of the workspace carrying the path of a project. */
export const MAIN_WORKSPACE = 'main'

/** Location used when a project declares no repository. */
export const ROOT_REPOSITORY = '.'

export interface Project {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  version: number
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  /** Physical path of the working environment. */
  path: string
  createdAt: number
}

export class InvalidProjectNameError extends Error {
  constructor(reason: string) {
    super(`the project name is refused: ${reason}`)
    this.name = 'InvalidProjectNameError'
  }
}

export class InvalidRepositoryPathError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`the repository location "${path}" is refused: ${reason}`)
    this.name = 'InvalidRepositoryPathError'
  }
}

/** Longest project name kept, so a name never becomes a document of its own. */
export const MAX_PROJECT_NAME_LENGTH = 120

/** The name a project is created with, refusing what cannot be one. */
export function projectName(candidate: string): string {
  const name = candidate.trim()
  if (name.length === 0) throw new InvalidProjectNameError('it is empty')
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    throw new InvalidProjectNameError(`it is longer than ${MAX_PROJECT_NAME_LENGTH} characters`)
  }
  return name
}

/**
 * A repository location, relative to the root of the workspaces.
 *
 * An absolute path, or one climbing out of the root, is refused rather than accepted as a
 * repository of the project.
 */
export function repositoryPath(candidate: string): string {
  const path = candidate.trim().replaceAll('\\', '/')
  if (path.length === 0) throw new InvalidRepositoryPathError(candidate, 'it is empty')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new InvalidRepositoryPathError(candidate, 'it is absolute')
  }

  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        throw new InvalidRepositoryPathError(candidate, 'it resolves outside the workspace root')
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.length === 0 ? ROOT_REPOSITORY : `./${segments.join('/')}`
}

/**
 * The locations a project reads from.
 *
 * An empty list means the root itself, which Hemera uses as it is: no repository is assumed
 * to be there and none is initialised.
 */
export function repositoryLocations(declared: readonly string[]): string[] {
  if (declared.length === 0) return [ROOT_REPOSITORY]
  const locations = declared.map(repositoryPath)
  const unique = [...new Set(locations)]
  if (unique.length !== locations.length) {
    throw new InvalidRepositoryPathError(
      locations.find((path, index) => locations.indexOf(path) !== index) ?? '',
      'it is declared twice',
    )
  }
  return unique
}
