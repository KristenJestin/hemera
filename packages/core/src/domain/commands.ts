/**
 * The rules of a Project's command catalogue and of the runs it starts.
 *
 * A catalogue command is a name, a type, a line (with a line of its own for Windows or Linux when
 * the systems differ) and a place: one of the Project's repositories or its root, and a folder
 * under it. Hemera runs a line without a shell: it is split into words, the first word is the
 * program, and a line that holds shell syntax is refused rather than run wrong.
 *
 * Each rule answers a `Result`: a refusal is a value with its reason, never a throw.
 */

import { Result, Schema } from 'effect'

import { defaultBranchPrefix } from './project.ts'

/** What a command is for. `typecheck` and `e2e` are the checks' own types. */
export const COMMAND_TYPES = [
  'serve',
  'test',
  'lint',
  'typecheck',
  'build',
  'e2e',
  'configure',
  'debug',
  'script',
] as const
export type CommandType = (typeof COMMAND_TYPES)[number]

/** Where a `serve` command runs: once per Workspace, or once for the Project in its main checkout. */
export const COMMAND_SCOPES = ['workspace', 'project'] as const
export type CommandScope = (typeof COMMAND_SCOPES)[number]

/**
 * Where a run stands. `waiting_for_permission` is a command marked "ask before running" that the
 * user has not allowed yet; `interrupted` is a run a previous engine left running.
 */
export const RUN_STATES = [
  'waiting_for_permission',
  'starting',
  'running',
  'ready',
  'done',
  'failed',
  'stopped',
  'interrupted',
] as const
export type RunState = (typeof RUN_STATES)[number]

/** The states of a run that has not ended. */
export const LIVE_RUN_STATES: ReadonlyArray<RunState> = [
  'waiting_for_permission',
  'starting',
  'running',
  'ready',
]

/** Who started a run: the user, a rule of Hemera the user recorded, or an agent's session. */
export const RUN_STARTERS = ['user', 'hemera', 'agent'] as const
export type RunStarter = (typeof RUN_STARTERS)[number]

/** A command the catalogue cannot hold, and what is wrong with it. */
export class InvalidCommand extends Schema.TaggedError<InvalidCommand>()('InvalidCommand', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This command is refused: ${this.reason}.`
  }
}

/**
 * A line that holds shell syntax. Hemera runs a line without a shell, so the token would not mean
 * what it says: it is named, and the line refused.
 */
export class ShellSyntax extends Schema.TaggedError<ShellSyntax>()('ShellSyntax', {
  token: Schema.String,
}) {
  override get message(): string {
    return `Hemera runs a command without a shell, and “${this.token}” is shell syntax: put it in a script of the repository and run the script.`
  }
}

/**
 * The words of a line, a word in double or single quotes kept whole and its quotes dropped. A
 * backslash is a character like another: it is how a Windows path is written.
 */
export function wordsOf(line: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const character of line) {
    if (quote !== null) {
      if (character === quote) quote = null
      else word += character
    } else if (character === '"' || character === "'") {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += character
      started = true
    }
  }
  if (started) words.push(word)
  return words
}

/** A redirection: `<`, `>`, `>>`, with the stream it names and the one it joins (`2>&1`). */
const REDIRECTION = /^\d*(?:<<?|>>?)(?:&\d*-?)?/

/**
 * The shell syntax a token at `at` starts, outside single quotes, or null. Inside double quotes a
 * shell still reads every one of these.
 */
function syntaxAt(line: string, at: number, wordStart: boolean): string | null {
  const rest = line.slice(at)
  const character = rest[0] ?? ''
  if (character === '\n' || character === '\r') return 'a newline'
  if (character === '|') return rest.startsWith('||') ? '||' : '|'
  if (character === '&') return rest.startsWith('&&') ? '&&' : '&'
  if (character === ';') return ';'
  if (character === '`') return '`'
  if (character === '<' || character === '>' || (wordStart && /^\d+[<>]/.test(rest))) {
    return REDIRECTION.exec(rest)?.[0] ?? character
  }
  if (character === '$') {
    if (rest.startsWith('$(')) return '$('
    if (rest.startsWith('${')) return '${'
    return /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(rest)?.[0] ?? null
  }
  if (character === '%') return /^%[A-Za-z_][A-Za-z0-9_]*%/.exec(rest)?.[0] ?? null
  return null
}

/** The glob a token at `at` starts, outside any quotes, or null. */
function globAt(line: string, at: number, wordStart: boolean): string | null {
  const character = line[at]
  if (character === '*' || character === '?') return character
  if (character === '~' && wordStart) return '~'
  if (character === '[') {
    const close = line.indexOf(']', at + 1)
    const space = line.slice(at + 1).search(/\s/)
    if (close !== -1 && (space === -1 || close < at + 1 + space)) return '[…]'
  }
  return null
}

/**
 * The first shell syntax in a line, as it is written, or null when there is none: outside single
 * quotes, a pipe, a list, a background `&`, a redirection, a substitution, a variable or a
 * newline; outside any quotes, a glob or a leading `~`. Inside single quotes everything is literal.
 */
export function shellSyntaxIn(line: string): string | null {
  let quote: '"' | "'" | null = null
  let wordStart = true
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at] ?? ''
    if (quote === "'") {
      if (character === "'") quote = null
      wordStart = false
      continue
    }
    const syntax = syntaxAt(line, at, wordStart && quote === null)
    if (syntax !== null) return syntax
    if (quote === null) {
      const glob = globAt(line, at, wordStart)
      if (glob !== null) return glob
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : (quote ?? character)
      wordStart = false
      continue
    }
    wordStart = quote === null && /\s/.test(character)
  }
  return null
}

/** A line Hemera can run without a shell, kept as it was written; refused naming the token. */
export function checkedLine(line: string): Result.Result<string, ShellSyntax> {
  const token = shellSyntaxIn(line)
  return token === null ? Result.succeed(line) : Result.fail(new ShellSyntax({ token }))
}

/** What a line is carried as: the line every system runs, and the ones Windows or Linux run. */
export interface CarriedLine {
  readonly line: string
  readonly lineWindows: string | null
  readonly lineLinux: string | null
}

/** The line this system runs: its own when it has one, the default otherwise (macOS among them). */
export function lineFor(carried: CarriedLine, platform: string): string {
  if (platform === 'win32') return carried.lineWindows ?? carried.line
  if (platform === 'linux') return carried.lineLinux ?? carried.line
  return carried.line
}

/** Whether every `open` in a glob is closed by a later `close`, in order. */
const closed = (glob: string, open: string, close: string): boolean => {
  let depth = 0
  for (const character of glob) {
    if (character === open) depth += 1
    if (character === close && depth > 0) depth -= 1
  }
  return depth === 0
}

/**
 * A glob of the files a command may write, relative to its folder, in one spelling: forward
 * slashes and no leading `./`. Refused when it is empty, absolute, leaves the folder, or leaves a
 * bracket or a brace open.
 */
export function writeGlob(candidate: string): Result.Result<string, InvalidCommand> {
  const glob = candidate.trim().replaceAll('\\', '/')
  const refused = (reason: string) =>
    Result.fail(new InvalidCommand({ reason: `the write glob “${candidate}”: ${reason}` }))
  if (glob === '') return refused('it is empty')
  if (glob.startsWith('/') || /^[a-zA-Z]:/.test(glob)) return refused('it is absolute')
  const segments = glob.split('/').filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) return refused('it leaves the folder of the command')
  const kept = segments.join('/')
  if (!closed(kept, '[', ']')) return refused('a “[” is never closed')
  if (!closed(kept, '{', '}')) return refused('a “{” is never closed')
  if (kept === '') return refused('it is empty')
  return Result.succeed(kept)
}

/**
 * An address of this machine, with a port: its name, a loopback address, or every interface; or
 * a `<name>.localhost` host, whose port is optional.
 */
const ADDRESS =
  /https?:\/\/(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}\b|[a-zA-Z0-9][a-zA-Z0-9.-]*\.localhost(?::\d{2,5})?\b)/

/** The colour and cursor codes a terminal program writes around its text. */
// oxlint-disable-next-line no-control-regex -- the escape character is what is matched
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** The first address a piece of output names, its ANSI codes removed, or null. */
export function addressIn(output: string): string | null {
  return ADDRESS.exec(output.replace(ANSI, ''))?.[0] ?? null
}

/** The port an address names, or null when it names none. */
export function portOf(url: string): number | null {
  const found = /^https?:\/\/(?:\[[^\]]*\]|[^/:]+):(\d+)/.exec(url)
  return found === null ? null : Number(found[1])
}

/** The Portless name a command is saved with: null for none, otherwise one word. */
export function portlessName(
  candidate: string | null,
): Result.Result<string | null, InvalidCommand> {
  const name = candidate?.trim() ?? ''
  if (name === '') return Result.succeed(null)
  if (/[\s"']/.test(name)) {
    return Result.fail(
      new InvalidCommand({ reason: `the Portless name “${name}” is not one word` }),
    )
  }
  return Result.succeed(name)
}

/** The name a Portless service runs under: its own, or the Project's name as a slug. */
export function portlessNameFor(name: string | null, projectName: string): string {
  return name ?? defaultBranchPrefix(projectName)
}

/** Whether one of a line's words is the program `portless` itself, by a path or as a shim. */
export function runsPortless(line: string): boolean {
  return wordsOf(line)
    .map((word) => word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1))
    .some((program) => /^portless(?:\.(?:cmd|exe|ps1|bat))?$/i.test(program))
}
