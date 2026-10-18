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
  policyVersion: 2,
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
export function namesGit(word: string): boolean {
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

/**
 * A write a Git command makes to what Git reads as its own (#448), as the line says it: a
 * configuration Git reads at every command, the engine's own included, and whose programs it runs
 * (the repository's, from the run folder, its `-C` folders and `--git-dir`; a file it names; the
 * user's or the system's), the hooks a template puts into the repository's hooks folder, or
 * `unread` when its words do not say.
 */
export type GitSettingsWrite =
  | {
      readonly kind: 'repository' | 'hooks'
      readonly folders: ReadonlyArray<string>
      readonly gitDir: string | null
    }
  | { readonly kind: 'named'; readonly folders: ReadonlyArray<string>; readonly path: string }
  | { readonly kind: 'global' }
  | { readonly kind: 'system' }
  | { readonly kind: 'unread' }
  /** An alias set on the line itself (`-c alias.x=…`): what it runs is not read. */
  | { readonly kind: 'alias'; readonly setting: string }
  /** A subcommand that is none of Git's own: an alias, or a program of that name. */
  | { readonly kind: 'command'; readonly name: string }
  /** Git's configuration set through the line's environment (`GIT_CONFIG_COUNT`…). */
  | { readonly kind: 'environment'; readonly name: string }
  /** A configuration file included on the line (`-c include.path=…`): what it sets is not read. */
  | { readonly kind: 'include'; readonly setting: string }
  /** A setting `git clone -c` saves into the clone's configuration. */
  | { readonly kind: 'clone'; readonly setting: string }

/**
 * The read actions of `git config`, by how many words after them they take at most: a name, and a
 * value pattern or a URL or a default. `--show-*` is none: Git takes `--show-scope` with a write.
 */
const CONFIG_READS: ReadonlyMap<string, number> = new Map([
  ['--get', 2],
  ['--get-all', 2],
  ['--get-regexp', 2],
  ['--get-urlmatch', 2],
  ['--get-color', 2],
  ['--get-colorbool', 2],
  ['--list', 0],
  ['-l', 0],
])
/** The read subcommands of `git config`, as `CONFIG_READS` says them. */
const CONFIG_READ_COMMANDS: ReadonlyMap<string, number> = new Map([
  ['get', 1],
  ['list', 0],
])
/** What makes a `git config` write, whatever else it holds. */
const CONFIG_WRITES = new Set([
  '--add',
  '--replace-all',
  '--unset',
  '--unset-all',
  '--rename-section',
  '--remove-section',
  '--edit',
  '-e',
])
const CONFIG_WRITE_COMMANDS = new Set(['set', 'unset', 'rename-section', 'remove-section', 'edit'])
/** The options of `git config` that take the next word as their value. */
const CONFIG_VALUES = new Set([
  '-f',
  '--file',
  '--blob',
  '-t',
  '--type',
  '--default',
  '--comment',
  '--value',
  '--url',
])

/**
 * Git's own commands, and `lfs`, the one external command judged as Git's: what `git
 * --list-cmds=main` lists for Git 2.55.0 on Linux, with what `git help -a` lists that it did not
 * install there (`gitk`, `gitweb`, `scalar`, `sh-i18n`, `sh-setup`) and the credential helpers Git
 * ships on macOS and Windows. Frozen: a command Git adds later asks until it is listed here. Any
 * other subcommand is an alias, from the user's configuration or the agent's, or another program,
 * and it is not read (#448).
 */
export const GIT_COMMANDS: ReadonlySet<string> = new Set([
  'add',
  'am',
  'annotate',
  'apply',
  'archimport',
  'archive',
  'backfill',
  'bisect',
  'blame',
  'branch',
  'bugreport',
  'bundle',
  'cat-file',
  'check-attr',
  'check-ignore',
  'check-mailmap',
  'check-ref-format',
  'checkout',
  'checkout--worker',
  'checkout-index',
  'cherry',
  'cherry-pick',
  'citool',
  'clean',
  'clone',
  'column',
  'commit',
  'commit-graph',
  'commit-tree',
  'config',
  'count-objects',
  'credential',
  'credential-cache',
  'credential-cache--daemon',
  'credential-libsecret',
  'credential-manager',
  'credential-osxkeychain',
  'credential-store',
  'credential-wincred',
  'cvsexportcommit',
  'cvsimport',
  'cvsserver',
  'daemon',
  'describe',
  'diagnose',
  'diff',
  'diff-files',
  'diff-index',
  'diff-pairs',
  'diff-tree',
  'difftool',
  'difftool--helper',
  'fast-export',
  'fast-import',
  'fetch',
  'fetch-pack',
  'filter-branch',
  'fmt-merge-msg',
  'for-each-ref',
  'for-each-repo',
  'format-patch',
  'format-rev',
  'fsck',
  'fsck-objects',
  'fsmonitor--daemon',
  'gc',
  'get-tar-commit-id',
  'gitk',
  'gitweb',
  'grep',
  'gui',
  'gui--askpass',
  'gui--askyesno',
  'hash-object',
  'help',
  'history',
  'hook',
  'http-backend',
  'http-fetch',
  'http-push',
  'imap-send',
  'index-pack',
  'init',
  'init-db',
  'instaweb',
  'interpret-trailers',
  'last-modified',
  'lfs',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'mailinfo',
  'mailsplit',
  'maintenance',
  'merge',
  'merge-base',
  'merge-file',
  'merge-index',
  'merge-octopus',
  'merge-one-file',
  'merge-ours',
  'merge-recursive',
  'merge-recursive-ours',
  'merge-recursive-theirs',
  'merge-resolve',
  'merge-subtree',
  'merge-tree',
  'mergetool',
  'mktag',
  'mktree',
  'multi-pack-index',
  'mv',
  'name-rev',
  'notes',
  'p4',
  'pack-objects',
  'pack-redundant',
  'pack-refs',
  'patch-id',
  'pickaxe',
  'prune',
  'prune-packed',
  'pull',
  'push',
  'quiltimport',
  'range-diff',
  'read-tree',
  'rebase',
  'receive-pack',
  'reflog',
  'refs',
  'remote',
  'remote-ext',
  'remote-fd',
  'remote-ftp',
  'remote-ftps',
  'remote-http',
  'remote-https',
  'repack',
  'replace',
  'replay',
  'repo',
  'request-pull',
  'rerere',
  'reset',
  'restore',
  'rev-list',
  'rev-parse',
  'revert',
  'rm',
  'scalar',
  'send-email',
  'send-pack',
  'sh-i18n',
  'sh-i18n--envsubst',
  'sh-setup',
  'shell',
  'shortlog',
  'show',
  'show-branch',
  'show-index',
  'show-ref',
  'sparse-checkout',
  'stage',
  'stash',
  'status',
  'stripspace',
  'submodule',
  'submodule--helper',
  'subtree',
  'svn',
  'switch',
  'symbolic-ref',
  'tag',
  'unpack-file',
  'unpack-objects',
  'update-index',
  'update-ref',
  'update-server-info',
  'upload-archive',
  'upload-archive--writer',
  'upload-pack',
  'url-parse',
  'var',
  'verify-commit',
  'verify-pack',
  'verify-tag',
  'version',
  'web--browse',
  'whatchanged',
  'worktree',
  'write-tree',
])

/** The include a setting Git is handed (`-c`, `--config-env`) adds, or null. */
const includeOf = (setting: string): string | null =>
  /^include(?:if)?\./i.test(setting) ? (setting.split('=')[0] ?? setting) : null

/** The alias a setting Git is handed (`-c`, `--config-env`) defines, or null. */
const aliasOf = (setting: string): string | null =>
  /^alias\./i.test(setting) ? (setting.split('=')[0] ?? setting) : null

/** Whether a setting Git is handed (`-c`, `--config-env`) names the template folder. */
const namesTemplates = (setting: string): boolean => /^init\.templatedir=/i.test(setting)

/**
 * The write a Git command's arguments make, null when none: `git config` unless it only reads,
 * or `git init` and `git clone` with a template. `before` are the words before `git`, its
 * environment among them.
 */
function gitSettingsWrite(
  before: ReadonlyArray<string>,
  args: ReadonlyArray<string>,
): GitSettingsWrite | null {
  const folders: string[] = []
  let gitDir: string | null = null
  let templates = before.some((word) => /^GIT_TEMPLATE_DIR=/i.test(word))
  let at = 0
  while (at < args.length) {
    const word = args[at] ?? ''
    const value = args[at + 1]
    if (word === '-C' || word === '--git-dir') {
      if (value === undefined) return { kind: 'unread' }
      if (word === '-C') folders.push(value)
      else gitDir = value
      at += 2
    } else if (word.startsWith('--git-dir=')) {
      gitDir = word.slice('--git-dir='.length)
      at += 1
    } else if (word.startsWith('--config-env=')) {
      templates ||= namesTemplates(word.slice('--config-env='.length))
      at += 1
    } else if (GIT_VALUES.has(word)) {
      if (value === undefined) return { kind: 'unread' }
      if (word === '-c' || word === '--config-env') templates ||= namesTemplates(value)
      at += 2
    } else if (word.startsWith('-')) at += 1
    else break
  }
  if (at >= args.length) return null
  const sub = (args[at] ?? '').toLowerCase()
  const rest = args.slice(at + 1)
  if (sub === 'init' || sub === 'clone') {
    templates ||= rest.some((word) => word === '--template' || word.startsWith('--template='))
    return templates ? { kind: 'hooks', folders, gitDir } : null
  }
  if (sub !== 'config') return null
  let file: GitSettingsWrite = { kind: 'repository', folders, gitDir }
  let reads: number | null = null
  let writes = false
  const positional: string[] = []
  let options = true
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index] ?? ''
    if (!options || !word.startsWith('-')) {
      positional.push(word)
      continue
    }
    if (word === '--') options = false
    else if (word === '--global') file = { kind: 'global' }
    else if (word === '--system') file = { kind: 'system' }
    else if (word.startsWith('--file=')) file = { kind: 'named', folders, path: word.slice(7) }
    else if (CONFIG_WRITES.has(word)) writes = true
    else if (CONFIG_READS.has(word)) reads = reads === null ? (CONFIG_READS.get(word) ?? 0) : -1
    else if (CONFIG_VALUES.has(word)) {
      const value = rest[index + 1]
      if (value === undefined) return { kind: 'unread' }
      if (word === '-f' || word === '--file') file = { kind: 'named', folders, path: value }
      index += 1
    }
  }
  const command = (positional[0] ?? '').toLowerCase()
  if (CONFIG_WRITE_COMMANDS.has(command)) return file
  const named = CONFIG_READ_COMMANDS.get(command)
  const read =
    writes || (named !== undefined && reads !== null)
      ? false
      : named !== undefined
        ? positional.length - 1 <= named
        : reads === null
          ? // `git config <name>` alone gets its value.
            positional.length === 1
          : reads >= 0 && positional.length <= reads
  return read ? null : file
}

/**
 * What a Git command's own options set before its subcommand that is not read: an alias, or an
 * included configuration file, whose settings may be any.
 */
function settingsSet(args: ReadonlyArray<string>): GitSettingsWrite[] {
  const set: GitSettingsWrite[] = []
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at] ?? ''
    const setting =
      word === '-c' || word === '--config-env'
        ? args[at + 1]
        : word.startsWith('--config-env=')
          ? word.slice('--config-env='.length)
          : undefined
    const alias = setting === undefined ? null : aliasOf(setting)
    if (alias !== null) set.push({ kind: 'alias', setting: alias })
    const included = setting === undefined ? null : includeOf(setting)
    if (included !== null) set.push({ kind: 'include', setting: included })
    if (GIT_VALUES.has(word)) at += 1
    else if (!word.startsWith('-')) break
  }
  return set
}

/**
 * The variables through which Git's configuration reaches a command from its environment: the
 * settings themselves, and another file to read as the user's or the system's.
 */
const CONFIG_ENVIRONMENT = /GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM)\b/gi

/** What `git clone -c` saves into the clone's own configuration. */
function cloneSettings(rest: ReadonlyArray<string>): GitSettingsWrite[] {
  const saved: GitSettingsWrite[] = []
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? ''
    if (word === '-c' || word === '--config') {
      saved.push({ kind: 'clone', setting: rest[at + 1] ?? '' })
      at += 1
    } else if (word.startsWith('--config=')) {
      saved.push({ kind: 'clone', setting: word.slice('--config='.length) })
    }
  }
  return saved
}

/**
 * Every write a line's commands would make to what Git reads as its own, through any wrapper or
 * shell, read at every word as the refusals read them, and every Git command it runs that does not
 * read (an alias set on the line, a subcommand that is none of Git's own), read on the programs the
 * line starts: each always asks, as a sensitive place does. A `git config` is a read only when it
 * says so and holds no write form; anything else asks.
 */
export function gitSettingsWrites(action: EffectiveAction): ReadonlyArray<GitSettingsWrite> {
  const writes: GitSettingsWrite[] = []
  for (const words of action.sequences) {
    for (const [at, word] of words.entries()) {
      if (programName(word) !== 'git') continue
      const args = words.slice(at + 1)
      writes.push(...settingsSet(args))
      const { sub, at: subAt } = gitSubcommandAt(args)
      if (sub === 'clone') writes.push(...cloneSettings(args.slice(subAt + 1)))
      const write = gitSettingsWrite(words.slice(0, at), args)
      if (write !== null) writes.push(write)
    }
  }
  // Git's configuration set through the environment, anywhere on a line that runs git.
  if (action.sequences.some((words) => words.some((word) => programName(word) === 'git'))) {
    const named = action.sequences.flatMap((words) =>
      words.flatMap((word) => [...word.matchAll(CONFIG_ENVIRONMENT)].map((found) => found[0])),
    )
    for (const name of new Set(named)) writes.push({ kind: 'environment', name })
  }
  for (const [program = '', ...args] of action.programs) {
    if (programName(program) !== 'git') continue
    const { sub, at } = gitSubcommandAt(args)
    if (at < args.length && !GIT_COMMANDS.has(sub)) writes.push({ kind: 'command', name: sub })
  }
  return writes
}

/** Where a Git command's subcommand is, past Git's own options, and the subcommand as written. */
function gitSubcommandAt(args: ReadonlyArray<string>) {
  let at = 0
  while (at < args.length) {
    const word = args[at] ?? ''
    if (GIT_VALUES.has(word)) at += 2
    else if (word.startsWith('-')) at += 1
    else break
  }
  return { sub: args[at] ?? '', at }
}

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

/** Whether a word is a long option, written whole or by a prefix of at least `least` characters. */
const longOption = (word: string, option: string, least: number) =>
  word.length >= least && option.startsWith(word.split('=')[0] ?? '')

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
      if (!mayCommit) return 'no agent of a mission may run git commit in this Project'
      // An agent's commit never rewrites the last one, nor skips the repository's hooks; Git takes
      // a long option by any prefix that is not ambiguous.
      if (rest.some((word) => longOption(word, '--amend', 4))) return refused('commit --amend')
      if (rest.some((word) => longOption(word, '--no-verify', 6) || /^-[A-Za-z]*n/.test(word))) {
        return refused('commit --no-verify')
      }
      return null
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
