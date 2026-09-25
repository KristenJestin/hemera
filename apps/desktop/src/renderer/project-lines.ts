import type { CheckDraft, Command, Project, ProjectCheck } from '@hemera/ipc'
import type { CheckLine, CommandLine, RepositoryLine } from '@hemera/ui'

/**
 * What the Commands, Repositories and Build sections of a Project's settings draw from the
 * engine's views, and what they hand back to it (D6-12, D8-04, D8-07, D8-10, D10-06, recette 1).
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
