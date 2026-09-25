import type { CheckDraft, Command, Project, ProjectCheck } from '@hemera/ipc'
import type { CheckLine, CommandLine, RepositoryLine } from '@hemera/ui'

/**
 * What the Commands, Repositories and Build sections of a Project's settings draw from the
 * engine's views, and what they hand back to it (D6-12, D8-04, D8-07, D8-10, D10-06, recette 1
 * and 2).
 *
 * Both ways, and nothing lost on the way: a command read and saved unchanged is written as it was
 * read. Kept apart from the page, which imports the components, so a test reads it without a DOM.
 */

/**
 * A command of the catalogue, as its row and its dialog draw it: its base, its folder under it
 * without the leading `./` the engine keeps, and the name Portless serves it under.
 */
export function commandLineOf(command: Command): CommandLine {
  return {
    id: command.name,
    name: command.name,
    command: command.line,
    lineWindows: command.lineWindows,
    lineLinux: command.lineLinux,
    type: command.type,
    scope: command.scope,
    portless: command.portless,
    portlessName: command.portlessName,
    folderBase: command.folderBase,
    folder: command.folder?.replace(/^\.\//, '') ?? '',
  }
}

/** What the engine writes a command from: every field the dialog edits (D8-07, D8-10). */
export type CommandWrite = Pick<
  Command,
  | 'name'
  | 'line'
  | 'lineWindows'
  | 'lineLinux'
  | 'type'
  | 'folderBase'
  | 'folder'
  | 'scope'
  | 'portless'
  | 'portlessName'
>

/** A row as the engine writes it: the base itself is no folder at all, and is null. */
export function commandWriteOf(line: CommandLine): CommandWrite {
  return {
    name: line.name,
    line: line.command,
    lineWindows: line.lineWindows,
    lineLinux: line.lineLinux,
    type: line.type,
    folderBase: line.folderBase,
    folder: line.folder === '' ? null : line.folder,
    scope: line.scope,
    portless: line.portless,
    portlessName: line.portlessName,
  }
}

/**
 * The segments of a path, whichever separator its system writes and whatever `.` it carries.
 *
 * The engine compares paths with the tools of the system; the renderer has no disk to ask, and a
 * command's folder is written by hand here. Segments are all it needs, and pure string work is
 * what it can do.
 */
function segmentsOf(path: string): string[] {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
}

/** Whether a path is one Windows writes: a drive letter, or the two backslashes a share starts with. */
function windowsPath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

/**
 * What the folder picker answered, written relative to the folder a command runs from (recette 2
 * of lot 20): `src` under a base of `./sources/web`, `.` for that folder itself.
 *
 * `main` is the folder of the main Workspace, which is what a base is relative to; `base` is null
 * for the Workspace root and one of the Project's repositories otherwise, as the dialog names it.
 * Both sides are read the way their system writes them: on Windows a path is compared without its
 * case, where `D:` and `d:` are one drive and a capital does not make two folders of one.
 *
 * A folder outside the base answers the `..` that would reach it, which is not a folder a command
 * may run in: the field refuses it, in the words of the schema the engine shares.
 */
export function folderUnderBase(mainPath: string, base: string | null, chosen: string): string {
  const under = segmentsOf(base === null ? mainPath : `${mainPath}/${base}`)
  const picked = segmentsOf(chosen)
  const folded = windowsPath(mainPath) || windowsPath(chosen)
  const same = (one: string, other: string): boolean =>
    folded ? one.toLowerCase() === other.toLowerCase() : one === other
  let shared = 0
  while (
    shared < under.length &&
    shared < picked.length &&
    same(under[shared] ?? '', picked[shared] ?? '')
  ) {
    shared += 1
  }
  const up = under.slice(shared).map(() => '..')
  const joined = [...up, ...picked.slice(shared)].join('/')
  return joined === '' ? '.' : joined
}

/**
 * The folder a command runs from, as its own system writes it: the folder of the main Workspace,
 * or one of the Project's repositories under it (recette 2).
 *
 * `mainPath` is the folder of the main Workspace, which a base is relative to; `base` is null for
 * the Workspace root and one of the Project's repositories otherwise, as the dialog names it. It
 * is the folder the field's own answer is relative to, and the one the system's picker opens on,
 * joined the way the main folder is written: a Windows path keeps its backslashes, a POSIX one
 * its slash.
 */
export function folderBasePath(mainPath: string, base: string | null): string {
  const under = segmentsOf(base ?? '')
  if (under.length === 0) return mainPath
  return [mainPath, ...under].join(windowsPath(mainPath) ? '\\' : '/')
}

/** What the disk says of one declared location, as `repositories.status` answers it. */
export interface LocationFound {
  readonly path: string
  readonly git: string | null
  readonly exists: boolean
}

/**
 * The declared repositories as their section lists them: what the disk says of each, and what the
 * Project says — whether a dedicated Workspace takes it (D8-04) and the icon it wears.
 */
export function repositoryLinesOf(
  found: readonly LocationFound[],
  project: Pick<Project, 'included' | 'repositoryIcons'>,
): RepositoryLine[] {
  return found.map((one) => ({
    path: one.path,
    branch: one.git,
    exists: one.exists,
    includedByDefault: project.included.includes(one.path),
    icon: project.repositoryIcons[one.path] ?? null,
  }))
}

/**
 * The catalogue as the Build section and its check dialog pick from it (D10-06): the rows of the
 * Commands section, known by the command's id, which is what a check runs a command by — where the
 * Commands section knows a command by its name, which is what the agent asks for.
 */
export function checkCommandsOf(catalogue: readonly Command[]): CommandLine[] {
  return catalogue.map((command) => ({ ...commandLineOf(command), id: command.id }))
}

/** A check the Project saved, on its row and in its dialog. */
export function checkLineOf(check: ProjectCheck): CheckLine {
  return {
    id: check.id,
    name: check.name,
    commandId: check.commandId,
    line: check.line,
    where: check.where,
    repository: check.repository,
    when: check.when,
    expect: check.expect === null ? null : { ...check.expect },
    files: check.files,
  }
}

/**
 * The checks proposed from the catalogue, each on a row of its own: a proposal has no id until it
 * is saved, so it is known by its place in the list while the section edits it.
 */
export function proposedLinesOf(drafts: readonly CheckDraft[]): CheckLine[] {
  return drafts.map((draft, at) => ({
    ...draft,
    id: `proposed-${String(at)}`,
    expect: draft.expect === null ? null : { ...draft.expect },
  }))
}

/** What the engine writes a check from: everything the dialog edits, and not the row's id. */
export function checkDraftOf(line: CheckLine): CheckDraft {
  return {
    name: line.name,
    commandId: line.commandId,
    line: line.line,
    where: line.where,
    repository: line.repository,
    when: line.when,
    expect: line.expect === null ? null : { ...line.expect },
    files: line.files,
  }
}
