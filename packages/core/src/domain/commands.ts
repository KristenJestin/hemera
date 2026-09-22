/**
 * The commands of a Project, and the one process each of them becomes (design D6-12).
 *
 * A command is a name the agent asks for and a line that runs: `app` for what stays up and
 * publishes an address, `check` for what verifies and ends with an exit code, `utility` for
 * everything else. The folder is optional and means the Workspace root when it is absent, or
 * one of the Project's repositories when it is there — never a path outside both.
 *
 * Two of the rules live here because they are rules and not plumbing: an `app` command that is
 * already running is returned rather than started again, and the address a reader sees is the
 * first one the output names. Everything else about a command — starting it, keeping its output,
 * stopping its tree — belongs to the engine, which owns the process.
 */

/** What a command is for, which decides whether a second run starts a second process. */
export const COMMAND_KINDS = ['app', 'check', 'utility'] as const

export type CommandKind = (typeof COMMAND_KINDS)[number]

/**
 * A command of the catalogue, as the Project settings hold it and as the agent reads it.
 *
 * `folder` is the path the command runs in: null is the Workspace root, and anything else is
 * one of the Project's repositories, stored as the Project stores them — relative to the root.
 */
export interface Command {
  readonly id: string
  readonly projectId: string
  readonly name: string
  /** The line that runs, as the user typed it. */
  readonly line: string
  readonly kind: CommandKind
  readonly folder: string | null
  readonly createdAt: number
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

export class UnknownCommandKindError extends Error {
  constructor(candidate: string) {
    super(`a command is app, check or utility, and ${candidate} is none of them`)
    this.name = 'UnknownCommandKindError'
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

/** The kind of a command, refusing a word the catalogue has never heard of. */
export function commandKind(candidate: string): CommandKind {
  const kind = COMMAND_KINDS.find((known) => known === candidate)
  if (kind === undefined) throw new UnknownCommandKindError(candidate)
  return kind
}

/**
 * Whether a run of this command starts a process, or hands back the one already running.
 *
 * True for an `app` command that is running and for nothing else: a `check` or a `utility` run
 * twice is two runs, because a check that was not run again would answer from a memory nobody
 * asked it for. That is the whole of the rule, and the engine owns both halves of it.
 */
export function joinsRunningRun(kind: CommandKind, running: boolean): boolean {
  return kind === 'app' && running
}

/** The first address a chunk of output names, and null when it names none yet. */
const ADDRESS = /https?:\/\/localhost:(\d{2,5})\b/

export function addressIn(output: string): string | null {
  const found = ADDRESS.exec(output)
  return found === null ? null : found[0]
}
