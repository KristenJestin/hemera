import { type CommandType } from './command-types.tsx'

/** Where a service runs: once per Workspace, or once for the Project in its main checkout. */
export type ServiceScope = 'workspace' | 'project'

export interface SettingsCommand {
  id: string
  name: string
  type: CommandType
  /** The line every system runs, unless it has its own. */
  line: string
  lineLinux: string | null
  lineWindows: string | null
  /** The repository it runs under, by path; `.` for the main checkout's root. */
  place: string
  /** The folder under it; null for the repository itself. */
  folder: string | null
  /** For a service. */
  scope: ServiceScope
  check: boolean
  atOpen: boolean
  askBeforeRunning: boolean
  readOnly: boolean
  /** What it may write, relative to its folder. */
  writeGlobs: readonly string[]
}

/** Where a command runs, as a line says it: `api`, `api/e2e`, `root`. */
export function placeOf(command: Pick<SettingsCommand, 'place' | 'folder'>): string {
  const place = command.place === '.' ? 'root' : command.place
  return command.folder === null ? place : `${place}/${command.folder}`
}

/** The globs a command may write, without the empty lines of a field still being typed in. */
export function globsOf(command: Pick<SettingsCommand, 'writeGlobs'>): string[] {
  return command.writeGlobs.filter((glob) => glob.trim() !== '')
}

/** The roles of a command, in words, in the order of the columns. */
export function rolesOf(command: SettingsCommand): string[] {
  return [
    command.check ? 'a check' : null,
    command.type === 'serve'
      ? command.scope === 'project'
        ? 'a service of the main checkout'
        : 'a service of each Workspace'
      : null,
    command.atOpen ? 'runs at each opening' : null,
    command.askBeforeRunning ? 'asks before running' : null,
    command.readOnly
      ? 'writes nothing'
      : globsOf(command).length > 0
        ? `writes ${globsOf(command).join(', ')}`
        : null,
  ].filter((role) => role !== null)
}

/** What the form of a command writes. */
export type CommandDraft = Omit<SettingsCommand, 'id'>

/** A command not written yet: a script, at the root, with no role. */
export const NEW_COMMAND: CommandDraft = {
  name: '',
  type: 'script',
  line: '',
  lineLinux: null,
  lineWindows: null,
  place: '.',
  folder: null,
  scope: 'workspace',
  check: false,
  atOpen: false,
  askBeforeRunning: false,
  readOnly: false,
  writeGlobs: [],
}
