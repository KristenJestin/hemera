/**
 * How the words of a line become a process, without a shell.
 *
 * The first word is the program and the rest are its arguments. On POSIX the words are spawned as
 * they are. On Windows a program is often a `.cmd` or `.bat` shim (`npm`, `pnpm`, everything under
 * `node_modules/.bin`), which only `cmd.exe` can run and which Node refuses to spawn directly. Such
 * a line goes to `cmd.exe /d /s /c` as one quoted line whose every word is escaped, so `cmd.exe`
 * runs the shim with the words it was given and reads nothing in them as its own syntax. Never
 * `shell: true`.
 *
 * The escaping is the one `cross-spawn` has used for years (MIT), reduced to what is needed here.
 */

import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, normalize } from 'node:path'

/** What is started for a line: a program, its arguments, and how Windows must receive them. */
export interface Invocation {
  readonly program: string
  readonly args: ReadonlyArray<string>
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

/** The characters `cmd.exe` reads as its own syntax, each escaped with a caret. */
const META = /([()\][%!^"`<>&|;, *?])/g

/** A shim npm writes: it hands its arguments on once more, so they are escaped twice. */
const NPM_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i

function escapeProgram(program: string): string {
  return program.replace(META, '^$1')
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
 * The file a program name leads to on Windows, as `cmd.exe` would find it, or null. A name with a
 * folder in it is looked for from the folder the line runs in, a bare name along the `PATH`; a
 * name without an extension is tried with each of `PATHEXT`.
 */
function resolveOnWindows(program: string, lookup: Lookup): string | null {
  const extensions = lookup.pathExt
    .split(';')
    .filter((one) => one.length > 0)
    .map((one) => one.toLowerCase())
  const named = extname(program).toLowerCase()
  // A name without an extension is never run as it is: `pnpm` beside `pnpm.cmd` is a script for
  // another shell, and `cmd.exe` runs the shim.
  const tries =
    named !== '' && extensions.includes(named)
      ? ['']
      : named === ''
        ? extensions
        : ['', ...extensions]
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

/** Whether a file is there and this process may execute it. */
function executable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * Where a program is along the `PATH`, or null: on POSIX the first file of that name that may be
 * executed, on Windows the file `cmd.exe` would run for that name.
 */
export function findOnPath(program: string, lookup: Lookup, platform: string): string | null {
  if (platform === 'win32') return resolveOnWindows(program, lookup)
  for (const folder of lookup.path.split(':')) {
    if (folder !== '' && executable(join(folder, program))) return join(folder, program)
  }
  return null
}

/** How the words of a line are started on this platform, or null when there is no word. */
export function invocationOf(
  words: ReadonlyArray<string>,
  platform: string,
  lookup: Lookup,
): Invocation | null {
  const [program, ...args] = words
  if (program === undefined) return null
  if (platform !== 'win32') return { program, args, verbatim: false }
  const resolved = resolveOnWindows(program, lookup)
  const extension = resolved === null ? '' : extname(resolved).toLowerCase()
  if (resolved === null || (extension !== '.cmd' && extension !== '.bat')) {
    return { program, args, verbatim: false }
  }
  const twice = NPM_SHIM.test(resolved)
  const quoted = [
    escapeProgram(normalize(resolved)),
    ...args.map((one) => escapeArgument(one, twice)),
  ].join(' ')
  return { program: lookup.comspec, args: ['/d', '/s', '/c', `"${quoted}"`], verbatim: true }
}

/** Where this process looks for a program, for a line run in `cwd`. */
export function hostLookup(cwd: string, environment: NodeJS.ProcessEnv = process.env): Lookup {
  return {
    cwd,
    path: environment['PATH'] ?? environment['Path'] ?? '',
    pathExt: environment['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD',
    comspec: environment['ComSpec'] ?? 'cmd.exe',
  }
}
