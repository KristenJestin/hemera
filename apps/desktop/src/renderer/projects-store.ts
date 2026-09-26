import type { Project, RepositoryIcon } from '@hemera/ipc'

/**
 * The Projects of the data folder, as the window holds them (design D4-11).
 *
 * One store for what is on screen, and the engine is the authority on all of it. Every act here
 * asks a use case and replaces the list with what came back rather than editing what it had:
 * the engine returns the Project it wrote, version and all, and a page that patched its own
 * copy would be a page holding a version the database has already moved past.
 *
 * Nothing here decides anything. What a name may be, what a path may be, and whether a version
 * is still current are the engine's to refuse; this carries the refusal to whoever asked, in
 * the words it came in.
 *
 * The same shape as the shell store beside it: a snapshot, a subscription and a few acts, so
 * `useSyncExternalStore` sees a value that only changes when something did.
 */
export interface ProjectsState {
  /** What is on screen, newest last, archived ones left out. */
  projects: Project[]
  /** Whether the first read has come back, so a page can tell empty from not yet asked. */
  loaded: boolean
  /** What the last act was refused with, in the engine's own words, or null. */
  refusal: string | null
}

const listeners = new Set<() => void>()

let state: ProjectsState = { projects: [], loaded: false, refusal: null }

export function subscribeToProjects(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function projectsSnapshot(): ProjectsState {
  return state
}

function replace(next: ProjectsState): void {
  state = next
  for (const listener of listeners) listener()
}

/**
 * Runs a use case and puts what it answered on screen.
 *
 * A refusal is not an exception here: it is what the engine said, kept as it was said so the
 * page can show it. What it is never allowed to do is leave the list looking like the change
 * went through — so on a refusal the list is left exactly as it was.
 */
async function acting(act: () => Promise<Project[]>): Promise<boolean> {
  try {
    replace({ projects: await act(), loaded: true, refusal: null })
    return true
  } catch (cause) {
    replace({ ...state, loaded: true, refusal: message(cause) })
    return false
  }
}

/** What a refusal says, without the shape of whatever carried it. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Everything that is not archived, which is what the bar lists. */
export async function loadProjects(): Promise<boolean> {
  return await acting(async () => await window.hemera.invoke('projects.list', {}))
}

export async function createProject(asked: {
  name: string
  tone: Project['tone']
  mainPath: string
}): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.create', asked)
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function renameProject(
  project: Project,
  change: { name?: string; tone?: Project['tone']; specPrefix?: string },
): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.update', {
      id: project.id,
      version: project.version,
      ...change,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function moveMainWorkspace(project: Project, path: string): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.moveMain', {
      id: project.id,
      version: project.version,
      path,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function archiveProject(project: Project): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.archive', { id: project.id, version: project.version })
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function restoreProject(project: Project): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.restore', { id: project.id, version: project.version })
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function addRepository(project: Project, relativePath: string): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('repositories.add', {
      id: project.id,
      version: project.version,
      relativePath,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

export async function removeRepository(project: Project, relativePath: string): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('repositories.remove', {
      id: project.id,
      version: project.version,
      relativePath,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

/**
 * Where the Project's dedicated Workspaces are made (D8-02): a folder, or a blank for Hemera's
 * own, which the channel carries as the default (Decided 17).
 */
export async function setWorkspacesRoot(project: Project, path: string | null): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.setWorkspacesRoot', {
      id: project.id,
      version: project.version,
      path,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

/** What their branches start with (D8-04): a prefix, or a blank for the Project's slug. */
export async function setBranchPrefix(project: Project, prefix: string | null): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.setBranchPrefix', {
      id: project.id,
      version: project.version,
      prefix,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

/** Whether a repository gets a worktree in every dedicated Workspace unless left out (D8-04). */
export async function setRepositoryIncluded(
  project: Project,
  relativePath: string,
  included: boolean,
): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('projects.setRepositoryIncluded', {
      id: project.id,
      version: project.version,
      path: relativePath,
      included,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

/**
 * Rewrites a declared repository at once (recette 1, item 11): its path, its icon, and whether a
 * dedicated Workspace takes it by default. The engine moves the commands and the recipe steps that
 * named its old path along with it; a path it refuses is its sentence, kept as `refusal`.
 */
export async function updateRepository(
  project: Project,
  relativePath: string,
  next: { path: string; icon: RepositoryIcon | null; included: boolean },
): Promise<boolean> {
  return await acting(async () => {
    await window.hemera.invoke('repositories.update', {
      id: project.id,
      version: project.version,
      relativePath,
      newPath: next.path,
      icon: next.icon,
      included: next.included,
    })
    return await window.hemera.invoke('projects.list', {})
  })
}

/** What was archived, which only the settings ask for. */
export async function archivedProjects(): Promise<Project[]> {
  const all = await window.hemera.invoke('projects.list', { includeArchived: true })
  return all.filter((project) => project.archivedAt !== null)
}

/** Clears the last refusal, once whoever showed it has shown it. */
export function forgetRefusal(): void {
  if (state.refusal === null) return
  replace({ ...state, refusal: null })
}
