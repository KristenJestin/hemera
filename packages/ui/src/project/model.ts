import type { ProjectTone } from '../shell/model.ts'

/**
 * What the Project surfaces are handed, which is the least a Dialog and a settings page need.
 *
 * The design system is a leaf: these are its own shapes, not the domain's, and the application
 * is what maps one onto the other. Nothing here validates anything — a name and a path are
 * refused by the domain, and what comes back is a message this folder shows.
 */
export interface ProjectDraft {
  name: string
  tone: ProjectTone
  /** The folder of the `main` Workspace, as the system's own picker wrote it. */
  mainPath: string
}

/**
 * One declared repository, with what the disk says about it right now.
 *
 * `branch` is read at the moment the list is drawn and never stored, so a line says `git ·
 * develop` today and `git · main` tomorrow without anything being written down.
 */
export interface RepositoryLine {
  /** Relative to the folder of `main`, as the domain accepted it. */
  path: string
  branch: string | null
  /** Whether the folder is there at all: a path may be declared before its sources arrive. */
  exists: boolean
}
