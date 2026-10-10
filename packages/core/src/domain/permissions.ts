/**
 * Hemera's local rules on a call: the versioned policy, the effective action a line would run,
 * the refusals (a deletion of `.git`, what no agent of a mission may run, a Project's "never"
 * list), and the narrow local allows. Pure: the engine resolves paths and programs, and calls
 * these in its order of decision.
 *
 * Only the refusals refuse. Everything here that is not certain is left to the next step of the
 * order, which asks when nothing else allows.
 */

import { Predicate, Schema } from 'effect'

import { wordsOf } from './commands.ts'
import { type PlaceContext, placesNamed } from './places.ts'

// ---------------------------------------------------------------------------------------------
// The policy.

/**
 * The policy every decision records: its version, and its one level as data. #38 applies the
 * thresholds to the judge's scores (risk 0–3, approval and user-requested 0–1): always ask from
 * `alwaysAskRisk`; ask from `askRisk` or `askApproval` unless the user asked for the call
 * (`userRequestedLifts`); otherwise allow. No level refuses; invalid scores always ask. There is
 * no other level and no setting.
 */
export const PERMISSION_POLICY = {
  policyVersion: 1,
  level: 'normal',
  alwaysAskRisk: 2.5,
  askRisk: 1.5,
  askApproval: 0.75,
  userRequestedLifts: 0.85,
} as const

/** Who decided a call: the local rules here; the judge, an agent's own judge and the user later. */
export const DECIDERS = ['rules', 'judge', 'agent-judge', 'user'] as const
export type Decider = (typeof DECIDERS)[number]

// ---------------------------------------------------------------------------------------------
// The words of a line.

/** A program's name without its folder, its case, or an executable extension. */
export function programName(program: string): string {
  const base = program.replaceAll('\\', '/').split('/').at(-1) ?? ''
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|com|ps1)$/, '')
}

/** `NAME=value`, as `env` and a shell read it before a program. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The wrappers that start another program with the words after them, and the options of each
 * that take a value (so the value is not taken for the program).
 */
const WRAPPER_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['env', new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])],
  ['command', new Set<string>()],
  ['time', new Set(['-f', '--format', '-o', '--output'])],
  [
    'sudo',
    new Set([
      '-u',
      '--user',
      '-g',
      '--group',
      '-C',
      '--close-from',
      '-D',
      '--chdir',
      '-h',
      '--host',
      '-p',
      '--prompt',
      '-r',
      '--role',
      '-t',
      '--type',
      '-U',
      '--other-user',
      '-T',
      '--command-timeout',
    ]),
  ],
  ['npx', new Set(['-p', '--package', '--cache', '--registry', '--userconfig'])],
  ['nohup', new Set<string>()],
  ['exec', new Set(['-a'])],
])

/** The subcommands of a package manager that start a program named after them. */
const RUNS_A_PROGRAM: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['pnpm', new Set(['exec', 'dlx'])],
  ['yarn', new Set(['exec', 'dlx', 'run'])],
  ['bunx', new Set<string>()],
])

/** The options of a package manager's run that take a value. */
const PACKAGE_VALUES = new Set(['-p', '--package', '-C', '--dir', '--filter', '-F', '--cwd'])

/**
 * The program a command really starts, once the wrappers it names are unwrapped, and its
 * arguments: `env A=1 npx gh pr merge 1` is `gh pr merge 1`. Answers null when a wrapper hands
 * its program a way this does not read (`env -S`, `npx -c`).
 */
export function unwrapped(words: ReadonlyArray<string>): ReadonlyArray<string> | null {
  let at = 0
  for (let rounds = 0; rounds < 16; rounds += 1) {
    while (ASSIGNMENT.test(words[at] ?? '')) at += 1
    const name = programName(words[at] ?? '')
    const values = WRAPPER_VALUES.get(name)
    if (values !== undefined) {
      at += 1
      while (at < words.length) {
        const word = words[at] ?? ''
        if (word === '--') {
          at += 1
          break
        }
        if (name === 'env' && /^(?:-S|--split-string)/.test(word)) return null
        if (name === 'npx' && /^(?:-c|--call)(?:=|$)/.test(word)) return null
        if (ASSIGNMENT.test(word) && name === 'env') at += 1
        else if (values.has(word)) at += 2
        else if (word.startsWith('-')) at += 1
        else break
      }
      continue
    }
    const runs = RUNS_A_PROGRAM.get(name)
    if (runs !== undefined) {
      let next = at + 1
      while (next < words.length && (words[next] ?? '').startsWith('-')) {
        next += PACKAGE_VALUES.has(words[next] ?? '') ? 2 : 1
      }
      const sub = (words[next] ?? '').toLowerCase()
      // `yarn <bin>` runs a binary or a script of that name, `bunx <bin>` runs the binary.
      if (runs.has(sub)) at = next + 1
      else if (name === 'yarn' || name === 'bunx') at = next
      else return words.slice(at)
      while ((words[at] ?? '').startsWith('-')) {
        at += PACKAGE_VALUES.has(words[at] ?? '') ? 2 : 1
      }
      if (words[at] === '--') at += 1
      // `yarn` with nothing after it installs; `yarn run` with nothing lists the scripts.
      if (at >= words.length) return words.slice(0, next + 1)
      continue
    }
    return words.slice(at)
  }
  return null
}

/** What a line would run, read as far as it can be. */
export interface EffectiveAction {
  /** Each program the line would start, unwrapped, with its arguments. */
  readonly programs: ReadonlyArray<ReadonlyArray<string>>
  /**
   * Every run of words a refusal reads: each command as written, each command of the strings it
   * hands to a shell, and, when a string does not read, its words split crudely.
   */
  readonly sequences: ReadonlyArray<ReadonlyArray<string>>
  /** Null when every word read; otherwise what did not. */
  readonly unreadable: string | null
}

/**
 * The words of a command, a word holding several (a shell's string) split again on spaces,
 * quotes and operators: only for a refusal to find a program wherever it hides. It allows nothing.
 */
function wordsWithin(words: ReadonlyArray<string>): string[] {
  return words.flatMap((word) => word.split(/[\s"'`;&|()]+/).filter((part) => part.length > 0))
}

/**
 * The effective action of a line's words: the shell strings it hands on (`sh -c`, `bash -lc`,
 * `cmd /c`, `powershell -Command`, nested, `sudo sh -c`), and the wrappers `npx`, `pnpm exec`,
 * `pnpm dlx`, `yarn`, `env`, `command`, `time` unwrapped, repeatedly.
 */
export function effectiveAction(
  words: ReadonlyArray<string>,
  context: PlaceContext,
): EffectiveAction {
  const named = placesNamed(words, context)
  const programs: Array<ReadonlyArray<string>> = []
  let unreadable = named.unreadable
  for (const command of named.commands) {
    const program = unwrapped(command)
    if (program === null) unreadable ??= 'a wrapper this does not read'
    else if (program.length > 0) programs.push(program)
  }
  const sequences: Array<ReadonlyArray<string>> = [...named.commands]
  if (unreadable !== null) sequences.push(wordsWithin(words))
  return { programs, sequences, unreadable }
}

// ---------------------------------------------------------------------------------------------
// The refusals.

/** What deletes, on POSIX, in `cmd.exe` and in PowerShell, by its own name or an alias. */
const DELETERS = new Set([
  'rm',
  'unlink',
  'rmdir',
  'rd',
  'del',
  'erase',
  'remove-item',
  'ri',
  'shred',
])

/** Whether a word names `.git` or anything under it, however it is spelled. */
function namesGit(word: string): boolean {
  return word.replaceAll('\\', '/').toLowerCase().split('/').includes('.git')
}

/**
 * Whether a line deletes something that touches a `.git` folder, wherever it hides: behind a
 * wrapper, inside a shell's string, in any spelling of the path or of the program.
 */
export function deletesGit(words: ReadonlyArray<string>): boolean {
  const all = wordsWithin(words)
  return all.some((word, at) => DELETERS.has(programName(word)) && all.slice(at + 1).some(namesGit))
}

/** Git's options before its subcommand that take a value. */
const GIT_VALUES = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--exec-path',
  '--super-prefix',
  '--list-cmds',
])

/** A Git command's subcommand and what follows it, past Git's own options. */
function gitSubcommand(args: ReadonlyArray<string>) {
  let at = 0
  while (at < args.length) {
    const word = args[at] ?? ''
    if (GIT_VALUES.has(word)) at += 2
    else if (word.startsWith('-')) at += 1
    else break
  }
  return { sub: (args[at] ?? '').toLowerCase(), rest: args.slice(at + 1) }
}

/** What a mission's agent may not do with Git, and why; null when it may. */
function gitRefusal(args: ReadonlyArray<string>, mayCommit: boolean): string | null {
  const { sub, rest } = gitSubcommand(args)
  const refused = (what: string) => `no agent of a mission may run git ${what}`
  switch (sub) {
    case 'push':
    case 'merge':
    case 'rebase':
    case 'reset':
    case 'switch':
      return refused(sub)
    case 'tag':
      return rest.some((word) => word === '--list' || word === '-l') ? null : refused('tag')
    case 'checkout':
      // A restore of files written as `git checkout -- <paths>` changes no branch.
      return rest[0] === '--' && rest.length > 1 ? null : refused('checkout')
    case 'branch':
      return rest.some((word) => word === '--delete' || /^-[A-Za-z]*[dD][A-Za-z]*$/.test(word))
        ? refused('branch -d')
        : null
    case 'commit':
      return mayCommit ? null : 'no agent of a mission may run git commit in this Project'
    default:
      return null
  }
}

/**
 * The reads of each forge CLI, by subcommand: anything else of the CLI is refused. `api` is a
 * read only with `GET` and no field.
 */
export const FORGE_READS: Readonly<Record<'gh' | 'glab' | 'bkt', ReadonlyArray<string>>> = {
  gh: [
    'pr view',
    'pr list',
    'pr diff',
    'pr checks',
    'pr status',
    'issue view',
    'issue list',
    'run view',
    'run list',
    'repo view',
    'auth status',
    'api',
  ],
  glab: [
    'mr view',
    'mr list',
    'mr diff',
    'issue view',
    'issue list',
    'ci view',
    'ci list',
    'ci status',
    'repo view',
    'auth status',
    'api',
  ],
  bkt: [
    'pr view',
    'pr list',
    'pr diff',
    'pr checks',
    'pr status',
    'issue view',
    'issue list',
    'repo view',
    'auth status',
    'api',
  ],
}

/** The options of `api` that send fields or a body, which make it a write. */
const API_FIELDS = /^(?:-f|-F|--field|--raw-field|--input|-d|--data)(?:=|$)|^-[fF].+/

/** Whether `api …` reads: no method other than `GET`, and no field. */
function apiReads(rest: ReadonlyArray<string>): boolean {
  for (const [at, word] of rest.entries()) {
    if (API_FIELDS.test(word)) return false
    const method =
      word === '-X' || word === '--method' ? rest[at + 1] : /^(?:-X|--method=)(.+)$/.exec(word)?.[1]
    if (method !== undefined && method.toUpperCase() !== 'GET') return false
  }
  return true
}

/** Whether a forge CLI's arguments are one of its reads. */
function forgeReads(cli: keyof typeof FORGE_READS, args: ReadonlyArray<string>): boolean {
  const words = args.filter((word) => !word.startsWith('-'))
  const [first = '', second = ''] = words.map((word) => word.toLowerCase())
  if (first === 'api') return apiReads(args.slice(args.indexOf(words[0] ?? '') + 1))
  return FORGE_READS[cli].includes(`${first} ${second}`)
}

/** The package publications, as the program and the arguments that make one. */
function publishes(name: string, args: ReadonlyArray<string>): boolean {
  const lowered = args.map((word) => word.toLowerCase())
  switch (name) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
    case 'cargo':
    case 'poetry':
    case 'flit':
    case 'hatch':
    case 'uv':
      return lowered.includes('publish')
    case 'twine':
      return lowered.includes('upload')
    case 'gem':
      return lowered.includes('push')
    case 'dotnet':
    case 'nuget':
      return lowered.includes('push')
    default:
      return false
  }
}

/**
 * What no agent role of a mission may run, read at every word of every command the line holds:
 * a write to a remote or to the history, a forge CLI's write, a package publication, and
 * `git commit` unless the Project gives its agents that right. The refusal says which.
 */
export function missionRefusal(
  sequences: ReadonlyArray<ReadonlyArray<string>>,
  mayCommit: boolean,
): string | null {
  for (const words of sequences) {
    for (const [at, word] of words.entries()) {
      const name = programName(word)
      const args = words.slice(at + 1)
      if (name === 'git') {
        const refused = gitRefusal(args, mayCommit)
        if (refused !== null) return refused
      } else if (name === 'gh' || name === 'glab' || name === 'bkt') {
        if (!forgeReads(name, args)) return `no agent of a mission may run ${name} beyond its reads`
      } else if (publishes(name, args)) {
        return `no agent of a mission may publish a package (${name})`
      }
    }
  }
  return null
}

/**
 * What the Chat always asks the user before, whatever the judge says (#43, open question 65): a
 * push, a forge CLI's write, a package publication, read at every word of every command the line
 * holds, so through any wrapper. The reason says which; null when none.
 */
export function chatMustAsk(sequences: ReadonlyArray<ReadonlyArray<string>>): string | null {
  for (const words of sequences) {
    for (const [at, word] of words.entries()) {
      const name = programName(word)
      const args = words.slice(at + 1)
      if (name === 'git' && gitSubcommand(args).sub === 'push') {
        return 'the Chat always asks before git push'
      }
      if ((name === 'gh' || name === 'glab' || name === 'bkt') && !forgeReads(name, args)) {
        return `the Chat always asks before ${name} writes to the forge`
      }
      if (publishes(name, args)) return `the Chat always asks before publishing a package (${name})`
    }
  }
  return null
}

/** The package managers whose `run` starts a script of the folder's `package.json`. */
const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])

/** The scripts npm runs by a command of their own name, without `run`. */
const NPM_SCRIPT_COMMANDS = new Set(['test', 't', 'tst', 'start', 'stop', 'restart'])

/**
 * The script a package manager's words may start, by its name: `npm run x`, `npm test`,
 * `pnpm run x`, `pnpm x`, `yarn x`, `yarn run x`, `bun run x`. Null when they name none. Whether
 * the folder has such a script is the caller's to say.
 */
function scriptNamed(manager: string, args: ReadonlyArray<string>): string | null {
  const words = args.filter((word) => !word.startsWith('-'))
  const [first, second] = words
  if (first === undefined) return null
  if (first === 'run' || first === 'run-script') return second ?? null
  if (manager === 'npm') return NPM_SCRIPT_COMMANDS.has(first) ? first : null
  return manager === 'bun' ? null : first
}

/** How deep scripts calling scripts are read. */
const SCRIPTS_READ_DEPTH = 8

/**
 * What the Chat always asks before, read on a line and on the `package.json` scripts it runs, as
 * deep as they call one another (with their `pre` and `post` scripts): `pnpm run release` whose
 * script pushes asks as `git push` does. `scriptOf` answers a script of the folder the line runs
 * in, by its name, or null. A script read under another folder (`pnpm -C web run x`, a workspace
 * filter), a Makefile target or a shell script is not read: the rest of the order judges it.
 */
export function chatMustAskThroughScripts(
  line: string,
  context: PlaceContext,
  scriptOf: (name: string) => string | null,
): string | null {
  /** The reason, and the innermost script it was read in (null for the line itself). */
  const read = (
    words: ReadonlyArray<string>,
    depth: number,
  ): { readonly reason: string; readonly script: string | null } | null => {
    const { sequences } = effectiveAction(words, context)
    const reason = chatMustAsk(sequences)
    if (reason !== null) return { reason, script: null }
    if (depth >= SCRIPTS_READ_DEPTH) return null
    for (const sequence of sequences) {
      for (const [at, word] of sequence.entries()) {
        const manager = programName(word)
        if (!SCRIPT_RUNNERS.has(manager)) continue
        const name = scriptNamed(manager, sequence.slice(at + 1))
        if (name === null) continue
        for (const each of [`pre${name}`, name, `post${name}`]) {
          const script = scriptOf(each)
          const found = script === null ? null : read(['sh', '-c', script], depth + 1)
          if (found !== null) return { reason: found.reason, script: found.script ?? each }
        }
      }
    }
    return null
  }
  const found = read(wordsOf(line), 0)
  if (found === null) return null
  return found.script === null ? found.reason : `${found.reason}, in the script ${found.script}`
}

// ---------------------------------------------------------------------------------------------
// The "never" list.

/** A program and its leading arguments: `make deploy`, `terraform apply`. */
export const NeverProgram = Schema.TaggedStruct('Program', {
  words: Schema.Array(Schema.String.check(Schema.isNonEmpty())).check(Schema.isNonEmpty()),
})
/** A command of the Project's catalogue, by its id. */
export const NeverCommand = Schema.TaggedStruct('Command', { commandId: Schema.String })

/** One entry of a Project's "never" list. */
export const NeverEntry = Schema.Union([NeverProgram, NeverCommand])
export type NeverEntry = typeof NeverEntry.Type

/** What an entry is shown as in a refusal. */
export function neverSaid(entry: NeverEntry, commandName: (id: string) => string): string {
  return Predicate.isTagged(entry, 'Program') ? entry.words.join(' ') : commandName(entry.commandId)
}

/**
 * The entry of a "never" list a call matches, or null: its effective action begins with the
 * entry's program and arguments (at any word, so through any wrapper), or it runs the listed
 * catalogue command.
 */
export function neverMatch(
  entries: ReadonlyArray<NeverEntry>,
  sequences: ReadonlyArray<ReadonlyArray<string>>,
  commandId: string | null,
  platform: string,
): NeverEntry | null {
  const fold = (word: string) => (platform === 'win32' ? word.toLowerCase() : word)
  for (const entry of entries) {
    if (!Predicate.isTagged(entry, 'Program')) {
      if (entry.commandId === commandId) return entry
      continue
    }
    const [program = '', ...leading] = entry.words
    const wanted = programName(program)
    const begins = sequences.some((words) =>
      words.some(
        (word, at) =>
          programName(word) === wanted &&
          leading.every((argument, index) => fold(words[at + 1 + index] ?? '') === fold(argument)),
      ),
    )
    if (begins) return entry
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// The local allows.

const LISTERS = new Set(['ls', 'dir'])
/** `ls` flags that only change how a listing is shown. */
const LISTING_FLAGS = /^-[aAlhR1tSrdFGinp]+$/
/** A plain relative path: no expansion, no operator, no way up. */
const PLAIN_PATH = /^[A-Za-z0-9._@+/\\-]+$/

/** A command after the runner has resolved its program. */
export interface ResolvedCommand {
  /** The first word of the line, as written. */
  readonly program: string
  /** The words after it, as the runner splits them: no shell reads them. */
  readonly args: ReadonlyArray<string>
  /** True when the line goes through a shell (a Windows shim through `cmd.exe`). */
  readonly shell: boolean
  /** The file the runner starts for `program`, found along the `PATH`; null when none is. */
  readonly resolved: string | null
}

/**
 * Whether a line is a plain listing: `ls` or `dir` found on the `PATH` as itself, with only
 * display flags and plain relative paths that never go up, and no shell.
 */
export function plainListing(command: ResolvedCommand): boolean {
  if (command.shell || command.resolved === null) return false
  const name = programName(command.program)
  const written = command.program.replaceAll('\\', '/')
  return (
    LISTERS.has(name) &&
    programName(command.resolved) === name &&
    // A bare name found on the PATH, or the very file it resolved to: never `./ls`.
    (!written.includes('/') || written === command.resolved.replaceAll('\\', '/')) &&
    command.args.every(
      (arg) =>
        LISTING_FLAGS.test(arg) ||
        (PLAIN_PATH.test(arg) &&
          !arg.startsWith('-') &&
          !arg.startsWith('/') &&
          !arg.startsWith('\\') &&
          !/^[A-Za-z]:/.test(arg) &&
          !arg.replaceAll('\\', '/').split('/').includes('..')),
    )
  )
}

/** The Git subcommands that only read the repository. */
const GIT_READS = new Set(['rev-parse', 'status', 'log', 'diff', 'show'])
/**
 * What makes one of them write, run something or read outside the repository: a file written by
 * `--output`, a diff or a conversion program the configuration names, files compared outside the
 * repository, and an order file read from anywhere (`-O`).
 */
const GIT_READ_WRITES = /^(?:(?:--output|--ext-diff|--textconv|--no-index)(?:=|$)|-O)/
/** Shell syntax in a word: no shell reads it, but a word that holds some is not understood. */
const SHELL_SYNTAX = /[|&;<>$`\n\r]/

/**
 * Whether a line is a Git command that only reads: `git` found on the `PATH` as itself, no shell,
 * no option of Git's own before the subcommand (`-c`, `-C`, `--git-dir`… change what it runs or
 * where), one of `rev-parse`, `status`, `log`, `diff` or `show`, and nothing after it that writes
 * a file or runs a program.
 */
export function readOnlyGit(command: ResolvedCommand): boolean {
  if (command.shell || command.resolved === null) return false
  const written = command.program.replaceAll('\\', '/')
  const [sub = '', ...rest] = command.args
  return (
    programName(command.program) === 'git' &&
    programName(command.resolved) === 'git' &&
    (!written.includes('/') || written === command.resolved.replaceAll('\\', '/')) &&
    GIT_READS.has(sub) &&
    rest.every((word) => !GIT_READ_WRITES.test(word) && !SHELL_SYNTAX.test(word))
  )
}

/** The programs that read code given as a string: running one is going through a shell. */
const SHELLS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
])

/** Whether a line's program is a shell. */
export const runsAShell = (program: string): boolean => SHELLS.has(programName(program))
