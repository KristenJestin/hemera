/**
 * The commands of a Project, and the one process each of them becomes (design D6-12, D8-07).
 *
 * A command is a name the agent asks for and a line that runs, typed by what it is for: `serve`
 * for what stays up and publishes an address, and `test`, `lint`, `build`, `configure`, `debug`
 * and `script` for what ends with an exit code. It runs in a folder under a base: the Workspace
 * root, or one of the Project's repositories — never a path outside its base. A command may carry
 * a line of its own for Windows and for Linux; the machine runs its own when it is set and the
 * default line otherwise (D8-07). `scope` says whether a `serve` command runs once per Workspace
 * or once for the whole Project.
 *
 * The rules live here because they are rules and not plumbing: a `serve` command that is already
 * running is returned rather than started again, the line a machine runs is its own variant when
 * it has one, the address a reader sees is the first one the output names — a loopback address or
 * a `*.localhost` name such as Portless prints (D8-09) — and the name a Portless command runs
 * under (D8-10). Everything else about a command — starting it, keeping its output, stopping its
 * tree — belongs to the engine, which owns the process.
 */

import { slugify } from './workspace.ts'

/**
 * What a command is for (D8-07): the design system draws each with the icon it fixes, and the
 * type decides whether a second run starts a second process.
 */
export const COMMAND_TYPES = [
  'serve',
  'test',
  'lint',
  'build',
  'configure',
  'debug',
  'script',
] as const

export type CommandType = (typeof COMMAND_TYPES)[number]

/**
 * Where a `serve` command runs (D8-07): once per Workspace, or once for the Project, in `main`.
 * Meaningless for the other types, which run where they are asked.
 */
export const COMMAND_SCOPES = ['workspace', 'project'] as const

export type CommandScope = (typeof COMMAND_SCOPES)[number]

/**
 * A command of the catalogue, as the Project settings hold it and as the agent reads it.
 *
 * Where it runs is a base and a folder under it (D8-07 as amended by recette 1): `folderBase` is
 * one of the Project's repositories as the Project declares it, relative to the Workspace root,
 * and null for the root itself; `folder` is relative to that base, and null for the base itself.
 * A run resolves `<Workspace>/<base>/<folder>`, so a command of a repository follows its
 * repository into every Workspace.
 */
export interface Command {
  readonly id: string
  readonly projectId: string
  readonly name: string
  /**
   * The line that runs, as the user typed it: the one line when the command has the same on every
   * system, and — beside the two below — the one a system with no line of its own runs, macOS
   * among them (recette 2).
   */
  readonly line: string
  /** The line Windows runs, null when it runs `line` instead (D8-07 as amended by recette 2). */
  readonly lineWindows: string | null
  /** The line Linux runs, null when it runs `line` instead (D8-07 as amended by recette 2). */
  readonly lineLinux: string | null
  readonly type: CommandType
  /** The repository it runs under, as the Project declares it, and null for the Workspace root. */
  readonly folderBase: string | null
  /** The folder under that base, relative to it, and null for the base itself. */
  readonly folder: string | null
  /** Once per Workspace or once for the Project: what a `serve` run joins (D8-07). */
  readonly scope: CommandScope
  /** Whether the line runs through Portless, which names its address (D8-10). */
  readonly portless: boolean
  /**
   * The name Portless serves it under, and null for the Project's name as a slug (D8-10 as
   * amended by recette 1). `portless` itself puts the Workspace's branch in front in a worktree
   * (recette 2), so one name reads the same run everywhere.
   */
  readonly portlessName: string | null
  readonly createdAt: number
}

/** A Portless name that is no single word of a command line (D8-10). */
export class InvalidPortlessNameError extends Error {
  readonly candidate: string

  constructor(candidate: string) {
    super(`a Portless name is one word, without spaces or quotes, and "${candidate}" is not`)
    this.name = 'InvalidPortlessNameError'
    this.candidate = candidate
  }
}

/**
 * The Portless name a command is saved with (D8-10 as amended): null for none — nothing, or only
 * spaces — and otherwise one word, since it is given to `portless` as one argument of its line.
 */
export function portlessName(candidate: string | null): string | null {
  const name = candidate?.trim() ?? ''
  if (name === '') return null
  if (/[\s"']/.test(name)) throw new InvalidPortlessNameError(candidate ?? '')
  return name
}

/**
 * Whether a line runs `portless` itself (D8-10 as amended): one of its words is the program
 * `portless` — bare, by a path, or as a Windows shim — so Hemera runs the line as written.
 */
export function runsPortless(line: string): boolean {
  return line
    .split(/\s+/)
    .map((word) => word.replace(/^["']|["']$/g, ''))
    .map((word) => word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1))
    .some((program) => /^portless(?:\.(?:cmd|exe|ps1|bat))?$/i.test(program))
}

/**
 * The name a Portless command runs under (D8-10 as amended by recette 2): its own name when it
 * has one, the Project's name as a slug otherwise. The Workspace is never in it: `portless`
 * itself puts the branch in front in a worktree (D8-04), so one name reads the same run in
 * `main` and in every dedicated Workspace, and an address written down once stays true.
 */
export function portlessNameFor(asked: {
  readonly name: string | null
  readonly projectName: string
}): string {
  return asked.name ?? (slugify(asked.projectName) || 'hemera')
}

/** A folder of a command that is absolute, or leaves the base it is relative to. */
export class InvalidCommandFolderError extends Error {
  readonly folder: string

  constructor(folder: string, reason: string) {
    super(`the folder ${folder} of a command is refused: ${reason}`)
    this.name = 'InvalidCommandFolderError'
    this.folder = folder
  }
}

export class EmptyCommandNameError extends Error {
  constructor() {
    super('a command keeps a name: an empty name is refused')
    this.name = 'EmptyCommandNameError'
  }
}

export class EmptyCommandLineError extends Error {
  constructor() {
    super('a command is a line to run: an empty line is refused')
    this.name = 'EmptyCommandLineError'
  }
}

export class UnknownCommandTypeError extends Error {
  constructor(candidate: string) {
    super(`a command is serve, test, lint, build, configure, debug or script; ${candidate} is none`)
    this.name = 'UnknownCommandTypeError'
  }
}

export class UnknownCommandScopeError extends Error {
  constructor(candidate: string) {
    super(`a command runs once per workspace or once per project, and ${candidate} is neither`)
    this.name = 'UnknownCommandScopeError'
  }
}

export class DuplicateCommandNameError extends Error {
  constructor(name: string) {
    super(`a command named ${name} is already in this Project: it is refused, not replaced`)
    this.name = 'DuplicateCommandNameError'
  }
}

/** The name of a command, refusing what carries nothing. */
export function commandName(candidate: string): string {
  const name = candidate.trim()
  if (name.length === 0) throw new EmptyCommandNameError()
  return name
}

/** The line of a command, kept as it was written: it is run, not interpreted. */
export function commandLine(candidate: string): string {
  const line = candidate.trim()
  if (line.length === 0) throw new EmptyCommandLineError()
  return line
}

/** The type of a command, refusing a word the catalogue has never heard of. */
export function commandType(candidate: string): CommandType {
  const type = COMMAND_TYPES.find((known) => known === candidate)
  if (type === undefined) throw new UnknownCommandTypeError(candidate)
  return type
}

/** The scope of a command, refusing a word the catalogue has never heard of. */
export function commandScope(candidate: string): CommandScope {
  const scope = COMMAND_SCOPES.find((known) => known === candidate)
  if (scope === undefined) throw new UnknownCommandScopeError(candidate)
  return scope
}

/** The segments of a relative path, refusing one that is absolute or climbs out of its start. */
function relativeSegments(candidate: string): string[] {
  const path = candidate.trim().replaceAll('\\', '/')
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new InvalidCommandFolderError(candidate, 'it is absolute')
  }
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        throw new InvalidCommandFolderError(candidate, 'it climbs out of its base')
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments
}

/**
 * The folder of a command, relative to its base (D8-07 as amended): null for the base itself —
 * nothing, `.` or `./` — and `./<segments>` otherwise; one that is absolute or climbs out of its
 * base is refused.
 */
export function commandFolder(candidate: string | null): string | null {
  if (candidate === null) return null
  const segments = relativeSegments(candidate)
  return segments.length === 0 ? null : `./${segments.join('/')}`
}

/**
 * Where a command runs, relative to the Workspace root (D8-07 as amended): its folder under its
 * base, and null for the root itself — `./web` and `./src` are `./web/src`, the base alone is the
 * base, and a base of `.` is the root.
 */
export function commandPlace(command: Pick<Command, 'folderBase' | 'folder'>): string | null {
  const segments = [command.folderBase, command.folder].flatMap((part) =>
    part === null ? [] : relativeSegments(part),
  )
  return segments.length === 0 ? null : `./${segments.join('/')}`
}

/** The line a command runs here: one place says it, for a command and for a step alike (recette 2). */
export { lineFor } from './lines.ts'

/**
 * Whether a run of this command starts a process, or hands back the one already running.
 *
 * True for a `serve` command that is running and for nothing else (D8-07): a `test` or a
 * `script` run twice is two runs, because a test that was not run again would answer from a
 * memory nobody asked it for. Which running run is "the" one — the Workspace's or the
 * Project's — is the scope's, and the engine asks it before asking this.
 */
export function joinsRunningRun(type: CommandType, running: boolean): boolean {
  return type === 'serve' && running
}

/**
 * Whether a command runs in `main` whichever Workspace asks for it (D8-07): a `serve` scoped to
 * the Project is one instance for all, and its place is `main`. The scope means nothing for the
 * other types, which run where they are asked.
 */
export function runsInMain(command: Pick<Command, 'type' | 'scope'>): boolean {
  return command.type === 'serve' && command.scope === 'project'
}

/**
 * An address of this machine: its name, its loopback addresses, or every interface, with a
 * port; or a `<name>.localhost` host — what Portless prints — whose port is optional (D8-09).
 */
const ADDRESS =
  /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}\b|[a-zA-Z0-9][a-zA-Z0-9.-]*\.localhost(?::\d{2,5})?\b)/

/**
 * The colour and cursor codes a terminal program writes around its text.
 *
 * A dev server paints its address — Vite prints the port in bold — and a code in the middle of
 * the address is an address nobody would recognise.
 */
// oxlint-disable-next-line no-control-regex -- the escape character is what is being matched
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** The first address a chunk of output names, and null when it names none yet. */
export function addressIn(output: string): string | null {
  const found = ADDRESS.exec(output.replace(ANSI, ''))
  return found === null ? null : found[0]
}

/** The port an address names, and null when it names none — a Portless name without one. */
export function portOf(url: string): number | null {
  const found = /^https?:\/\/(?:\[[^\]]*\]|[^/:]+):(\d+)/.exec(url)
  return found === null ? null : Number(found[1])
}
