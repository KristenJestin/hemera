/**
 * How a command line becomes a process, without a shell (design D6-12).
 *
 * A line is split into its words, a quoted word staying one word, and the first word is the
 * program. On POSIX that is the whole story: the words are spawned as they are. On Windows a
 * program is often a `.cmd` or `.bat` shim — `npm`, `pnpm`, everything under `node_modules/.bin`
 * — which only `cmd.exe` can run, and which Node refuses to spawn directly. Such a line goes to
 * `cmd.exe /d /s /c` as one quoted line whose every word is escaped, so `cmd.exe` runs the shim
 * with the words it was given and reads nothing in them as its own syntax: never `shell: true`.
 *
 * The escaping is the one `cross-spawn` has used for years (MIT), reduced to what is needed here.
 */

import { existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, normalize } from 'node:path'

/** What is started for a line: a program, its arguments, and how Windows must receive them. */
export interface Invocation {
  readonly command: string
  readonly args: readonly string[]
  /** True when the arguments are one line already quoted for `cmd.exe`, to pass as they are. */
  readonly verbatim: boolean
}

/** Where a program is looked for: the process's environment, and the folder the line runs in. */
export interface Lookup {
  readonly cwd: string
  readonly path: string
  readonly pathExt: string
  readonly comspec: string
}

/**
 * The words of a line, a word in double or single quotes kept whole and its quotes dropped.
 *
 * A backslash is a character like another: it is how a Windows path is written, and a line of
 * the catalogue is written for the machine it runs on.
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

/** The characters `cmd.exe` reads as its own syntax, each escaped with a caret. */
const META = /([()\][%!^"`<>&|;, *?])/g

/** A shim npm writes: it hands its arguments on once more, so they are escaped twice. */
const NPM_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i

function escapeCommand(command: string): string {
  return command.replace(META, '^$1')
}

function escapeArgument(argument: string, twice: boolean): string {
  // Backslashes before a quote are doubled and the quote escaped, backslashes at the end are
  // doubled: the rules by which a Windows program splits its command line back into words.
  let escaped = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1')
  escaped = `"${escaped}"`.replace(META, '^$1')
  return twice ? escaped.replace(META, '^$1') : escaped
}

/**
 * The file a program name leads to on Windows, as `cmd.exe` would find it, and null for none.
 *
 * A name with a folder in it is looked for from the folder the line runs in; a bare name along
 * the `PATH`. A name without an extension is tried with each of `PATHEXT`.
 */
function resolveOnWindows(program: string, lookup: Lookup): string | null {
  const extensions = lookup.pathExt
    .split(';')
    .filter((one) => one.length > 0)
    .map((one) => one.toLowerCase())
  const named = extname(program).toLowerCase()
  const tries = named !== '' && extensions.includes(named) ? [''] : ['', ...extensions]
  const folders = /[\\/]/.test(program)
    ? [isAbsolute(program) ? '' : lookup.cwd]
    : lookup.path.split(';').filter((one) => one.length > 0)
  for (const folder of folders) {
    for (const extension of tries) {
      const candidate = folder === '' ? `${program}${extension}` : join(folder, program + extension)
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return null
}

/** How a line is started on this platform, and null for a line with nothing to run. */
export function invocationOf(line: string, platform: string, lookup: Lookup): Invocation | null {
  const [program, ...args] = wordsOf(line)
  if (program === undefined) return null
  if (platform !== 'win32') return { command: program, args, verbatim: false }
  const resolved = resolveOnWindows(program, lookup)
  const extension = resolved === null ? '' : extname(resolved).toLowerCase()
  if (resolved === null || (extension !== '.cmd' && extension !== '.bat')) {
    return { command: program, args, verbatim: false }
  }
  const twice = NPM_SHIM.test(resolved)
  const quoted = [
    escapeCommand(normalize(resolved)),
    ...args.map((one) => escapeArgument(one, twice)),
  ].join(' ')
  return { command: lookup.comspec, args: ['/d', '/s', '/c', `"${quoted}"`], verbatim: true }
}

/** Where this process looks for a program, for a line run in `cwd`. */
export function hostLookup(cwd: string): Lookup {
  return {
    cwd,
    path: process.env['PATH'] ?? '',
    pathExt: process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD',
    comspec: process.env['ComSpec'] ?? 'cmd.exe',
  }
}
