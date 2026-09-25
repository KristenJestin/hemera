import type { CommandScope, CommandType } from '../activity/command-type.ts'
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
  /**
   * Where dedicated Workspaces are made (D8-02). Null means Hemera's own folder, under the
   * Profile.
   */
  workspacesRoot: string | null
  /**
   * What a dedicated branch starts with (D8-04): `<prefix>/<KEY>-<slug>`. Null means the
   * Project's name as a slug.
   */
  branchPrefix: string | null
}

/**
 * What the settings of a Project hold beyond what it was created with: the prefix of its Spec
 * keys, pre-filled from the name when the Project was made and editable here afterwards
 * (lot 19, Decided 2). A new prefix renames no key already given.
 */
export interface ProjectSettingsDraft extends ProjectDraft {
  /** `ATL`: what the keys of the Project's Specs start with, `ATL-7`. */
  specPrefix: string
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
  /**
   * Whether a dedicated Workspace takes a worktree of it unless told otherwise (D8-04). The
   * creation dialog still lets the user leave it out, or take one that is not.
   */
  includedByDefault: boolean
  /**
   * What the row is drawn with, chosen in its dialog among a short fixed set; null draws the
   * folder, or the branch when the folder holds a repository.
   */
  icon: RepositoryIcon | null
}

/**
 * The icons a repository may be given, in the order its dialog offers them (recette 1 of lot 20).
 *
 * A key and not an icon: the application stores the word, and the design system alone knows
 * which glyph of the catalogue it is.
 */
export const REPOSITORY_ICONS = [
  'folder',
  'server',
  'browser',
  'database',
  'package',
  'book',
  'mobile',
  'terminal',
] as const

export type RepositoryIcon = (typeof REPOSITORY_ICONS)[number]

/** What a repository's dialog hands back: where it is, how it is drawn, whether it is taken. */
export interface RepositoryDraft {
  path: string
  icon: RepositoryIcon | null
  includedByDefault: boolean
}

/**
 * One command of a Project's catalogue, which is what its Sessions may run (design D6-12, D8-07).
 *
 * A command is named once and run by name: the agent asks for `check`, and what runs is the line
 * the reader wrote, in the folder they wrote it for.
 */
export interface CommandLine {
  /** What the command is called, which is what the agent asks for. */
  id: string
  /** The name the reader gave it, shown everywhere the catalogue is read. */
  name: string
  /** The default line, run in the folder below on a system with no line of its own. */
  command: string
  /** What Windows runs instead of the default line, or null. */
  lineWindows: string | null
  /** What Linux runs instead of the default line, or null. */
  lineLinux: string | null
  /** What the command is for, which is how it is drawn everywhere (D8-07). */
  type: CommandType
  /** Where a `serve` runs: once per Workspace, or once for the Project in `main`. */
  scope: CommandScope
  /** Whether a `serve` goes through Portless at launch (D8-10). */
  portless: boolean
  /** The name Portless serves it under, when it goes through Portless; null otherwise. */
  portlessName: string | null
  /**
   * What the folder is relative to: the path of one of the Project's repositories, as declared,
   * or null for the Workspace root. It follows the Workspace the run is in.
   */
  folderBase: string | null
  /** The folder it runs in, relative to its base; empty for the base itself. */
  folder: string
}

/** Where a check runs (D10-06): at the root, in one repository, or in each repository changed. */
export type CheckWhere = 'root' | 'repository' | 'changed'

/** When a check runs (D10-06): after each task, after each story, or at the end of the build. */
export type CheckWhen = 'task' | 'story' | 'end'

/**
 * A number a check's output has to show (D10-06, L4): the first capture of `pattern`, read as a
 * number, must be at least `minimum` — and the check must still exit 0.
 */
export interface CheckExpect {
  pattern: string
  minimum: number
}

/**
 * One check of a Project's build (D10-06): what Hemera runs to judge the agent's work. A command
 * of the catalogue or a line of the user's — exactly one of the two — where and when it runs, what
 * number its output has to show beyond its exit code, and the files its `{files}` stands for.
 */
export interface CheckLine {
  id: string
  /** What the check is called, unique in the Project. */
  name: string
  /** The catalogue command it runs, by id; null for a line of the user's. */
  commandId: string | null
  /** The line it runs; null for a catalogue command. */
  line: string | null
  where: CheckWhere
  /** The repository's path as the Project declares it, when `where` is `repository`. */
  repository: string | null
  when: CheckWhen
  expect: CheckExpect | null
  /** The filter `{files}` is expanded with: the task's changed files that match it. */
  files: string | null
}
