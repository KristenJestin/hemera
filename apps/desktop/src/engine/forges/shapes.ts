/**
 * The command shapes the forge runner may run (#253), each with its class: a `read`, or a
 * `network-write`. The runner refuses, before spawning, any command whose arguments match no shape
 * here, so what Hemera may write on a forge is this list and nothing else.
 *
 * The network writes are CT-50's: the push (through Git, R6), the pull request operations (create,
 * edit, attach an image, merge) and the actions on the remote (run a workflow or a pipeline, rerun,
 * approve a pending deployment). The later tickets that build them (R6, R7, S2, S4) use these
 * shapes; one that needs another flag adds it to its shape here.
 *
 * Every shape is closed. It is its leading words, each a word or a slot (`<number>`) for one value
 * that is not a flag, which a pattern may narrow; then only the flags it names, each at most once,
 * written apart from its value (`--repo acme/shop`, never `--repo=acme/shop`): a switch, a flag
 * with a value (which a pattern may narrow), or a fixed word such as `--close-source=false`. A
 * required flag must be there, and of flags that are one of a kind exactly one. Nothing else may
 * follow: no other flag, no positional, no `--`.
 *
 * A write names its forge: a gh command its repository with its host (`--repo host/owner/repo`), a
 * bkt command its context (bkt sends a command to its active context otherwise, whatever the
 * repository's host) and its workspace or project. The runner also checks that a gh command aims at
 * the host of its call (`aimsAt`).
 */

import type { ForgeCli } from '@hemera/ipc'

export type ShapeClass = 'read' | 'network-write'

/** A flag a shape allows: whether it takes a value, what that value must match, if it must be there. */
export interface FlagRule {
  readonly value: boolean
  readonly pattern?: RegExp
  readonly required: boolean
  /** Of the flags in this group, exactly one must be there. */
  readonly oneOf?: string
}

export interface CommandShape {
  /** `git` for the push, which Git runs (R6), never this runner. */
  readonly cli: ForgeCli | 'git'
  readonly class: ShapeClass
  /** What the command does, as the records of an effectful action name it. */
  readonly operation: string
  /** Words, and slots written `<name>`. */
  readonly words: ReadonlyArray<string>
  /** What the value of a slot must match, by slot; any value that is not a flag otherwise. */
  readonly patterns: ReadonlyMap<string, RegExp>
  /** The flags allowed after the words, by name. */
  readonly flags: ReadonlyMap<string, FlagRule>
}

const switchFlag = (required = false): FlagRule => ({ value: false, required })
const valueFlag = (required = false, pattern?: RegExp): FlagRule =>
  pattern === undefined ? { value: true, required } : { value: true, required, pattern }

/** A body Hemera writes goes on the standard input, never in a file the CLI would read. */
const FROM_INPUT = /^-$/

const shape = (
  cli: CommandShape['cli'],
  kind: ShapeClass,
  operation: string,
  words: ReadonlyArray<string>,
  flags: ReadonlyArray<readonly [string, FlagRule]> = [],
  patterns: ReadonlyArray<readonly [string, RegExp]> = [],
): CommandShape => ({
  cli,
  class: kind,
  operation,
  words,
  patterns: new Map(patterns),
  flags: new Map(flags),
})

const read = (cli: ForgeCli, operation: string, words: ReadonlyArray<string>) =>
  shape(cli, 'read', operation, words)

/**
 * A workspace, a project key or a bkt context: one plain word, never a flag (`~` opens a Data
 * Center personal project).
 */
export const SAFE_WORD = /^(?!-)[A-Za-z0-9._~-]+$/

const NUMBER: readonly [string, RegExp] = ['<number>', /^\d+$/]
/** One owner or repository name: never `.` or `..`, which would walk out of the path. */
const NAME = String.raw`(?!\.{1,2}(?:/|$))[A-Za-z0-9._-]+`
/** A gh owner or repository name, as the shapes accept it. */
export const GH_NAME = new RegExp(`^${NAME}$`)
const APPROVAL = new RegExp(
  String.raw`^repos/${NAME}/${NAME}/actions/runs/\d+/pending_deployments$`,
)

/** The repository a gh command acts on, always named with its host: `host/owner/repo`. */
const GH_REPO: readonly [string, FlagRule] = [
  '--repo',
  valueFlag(true, new RegExp(String.raw`^[A-Za-z0-9.-]+(:\d+)?/${NAME}/${NAME}$`)),
]
/** The bkt context a command goes through: the one of the repository's host. */
const BKT_CONTEXT: readonly [string, FlagRule] = ['--context', valueFlag(true, SAFE_WORD)]
/**
 * Where a bkt command acts: its context, its workspace (Cloud) or project (Data Center), one of the
 * two, and its repository.
 */
const BKT_PLACE: ReadonlyArray<readonly [string, FlagRule]> = [
  BKT_CONTEXT,
  ['--workspace', { value: true, pattern: SAFE_WORD, required: false, oneOf: 'place' }],
  ['--project', { value: true, pattern: SAFE_WORD, required: false, oneOf: 'place' }],
  ['--repo', valueFlag(true)],
]

export const COMMAND_SHAPES: ReadonlyArray<CommandShape> = [
  // The CLI and its own sign-in: this ticket's reads.
  read('gh', 'version', ['--version']),
  read('gh', 'auth.status', ['auth', 'status', '--hostname', '<host>']),
  read('gh', 'user', ['api', '--hostname', '<host>', 'user', '--jq', '.login']),
  read('bkt', 'version', ['--version']),
  read('bkt', 'auth.status', ['auth', 'status', '--json']),

  // CT-50's network writes. The push is Git's own (R6).
  shape('git', 'network-write', 'push', ['push']),
  // Pull requests (R6, R7, S2).
  shape(
    'gh',
    'network-write',
    'pr.create',
    ['pr', 'create'],
    [
      GH_REPO,
      ['--base', valueFlag(true)],
      ['--head', valueFlag(true)],
      ['--title', valueFlag(true)],
      ['--body-file', valueFlag(true, FROM_INPUT)],
      ['--draft', switchFlag()],
    ],
  ),
  // Before `pr.edit`: an image attached is an edit of its own (R7).
  shape(
    'gh',
    'network-write',
    'pr.attach',
    ['pr', 'edit', '<number>'],
    [GH_REPO, ['--attach', valueFlag(true)]],
    [NUMBER],
  ),
  shape(
    'gh',
    'network-write',
    'pr.edit',
    ['pr', 'edit', '<number>'],
    [
      GH_REPO,
      ['--title', valueFlag()],
      ['--body-file', valueFlag(false, FROM_INPUT)],
      ['--base', valueFlag()],
    ],
    [NUMBER],
  ),
  shape(
    'gh',
    'network-write',
    'pr.merge',
    ['pr', 'merge', '<number>'],
    [
      GH_REPO,
      ['--squash', switchFlag()],
      ['--merge', switchFlag()],
      ['--rebase', switchFlag()],
      ['--match-head-commit', valueFlag(false, /^[0-9a-f]{7,40}$/)],
      ['--subject', valueFlag()],
      ['--body-file', valueFlag(false, FROM_INPUT)],
    ],
    [NUMBER],
  ),
  shape(
    'bkt',
    'network-write',
    'pr.create',
    ['pr', 'create'],
    [
      ...BKT_PLACE,
      ['--source', valueFlag(true)],
      ['--target', valueFlag(true)],
      ['--title', valueFlag(true)],
      ['--description', valueFlag()],
      ['--draft', switchFlag()],
    ],
  ),
  shape(
    'bkt',
    'network-write',
    'pr.edit',
    ['pr', 'edit', '<number>'],
    [...BKT_PLACE, ['--title', valueFlag()], ['--description', valueFlag()]],
    [NUMBER],
  ),
  // bkt closes the source branch on merge unless told: deleting a branch is not CT-50's.
  shape(
    'bkt',
    'network-write',
    'pr.merge',
    ['pr', 'merge', '<number>'],
    [
      ...BKT_PLACE,
      ['--strategy', valueFlag()],
      ['--message', valueFlag()],
      ['--close-source=false', switchFlag(true)],
    ],
    [NUMBER],
  ),
  // The actions on the remote (S4).
  shape(
    'gh',
    'network-write',
    'workflow.run',
    ['workflow', 'run', '<workflow>'],
    [GH_REPO, ['--ref', valueFlag()]],
  ),
  shape(
    'gh',
    'network-write',
    'run.rerun',
    ['run', 'rerun', '<number>'],
    [GH_REPO, ['--failed', switchFlag()]],
    [NUMBER],
  ),
  shape(
    'gh',
    'network-write',
    'deployment.approve',
    ['api', '--hostname', '<host>', '--method', 'POST', '<path>', '--input', '-'],
    [],
    [['<path>', APPROVAL]],
  ),
  // A rerun on Bitbucket Cloud is a new run.
  shape(
    'bkt',
    'network-write',
    'pipeline.run',
    ['pipeline', 'run'],
    [
      BKT_CONTEXT,
      ['--workspace', valueFlag(true, SAFE_WORD)],
      ['--repo', valueFlag(true)],
      ['--ref', valueFlag(true)],
      ['--selector-type', valueFlag()],
      ['--selector-pattern', valueFlag()],
    ],
  ),
]

const SLOT = /^<[a-z]+>$/

const fitsWord = (owner: CommandShape, word: string, arg: string): boolean => {
  if (!SLOT.test(word)) return word === arg
  return !arg.startsWith('-') && (owner.patterns.get(word)?.test(arg) ?? true)
}

/** Whether what follows the words is only flags of the shape, each once, the required ones there. */
const fitsFlags = (owner: CommandShape, rest: ReadonlyArray<string>): boolean => {
  const seen = new Set<string>()
  for (let at = 0; at < rest.length; at += 1) {
    const name = rest[at] ?? ''
    const rule = owner.flags.get(name)
    if (rule === undefined || seen.has(name)) return false
    seen.add(name)
    if (!rule.value) continue
    at += 1
    const value = rest[at]
    if (value === undefined) return false
    if (rule.pattern !== undefined && !rule.pattern.test(value)) return false
  }
  const flags = [...owner.flags]
  const groups = new Set(
    flags.flatMap(([, rule]) => (rule.oneOf === undefined ? [] : [rule.oneOf])),
  )
  return (
    flags.every(([name, rule]) => !rule.required || seen.has(name)) &&
    [...groups].every(
      (group) =>
        flags.filter(([name, rule]) => rule.oneOf === group && seen.has(name)).length === 1,
    )
  )
}

/** The shape these arguments of this CLI match, the first in the list; null when none does. */
export const shapeOf = (cli: ForgeCli, args: ReadonlyArray<string>): CommandShape | null =>
  COMMAND_SHAPES.find(
    (one) =>
      one.cli === cli &&
      args.length >= one.words.length &&
      one.words.every((word, at) => fitsWord(one, word, args[at] ?? '')) &&
      fitsFlags(one, args.slice(one.words.length)),
  ) ?? null

/** The value that follows a flag among the arguments, or null. */
const valueAfter = (args: ReadonlyArray<string>, flag: string): string | null => {
  const at = args.indexOf(flag)
  return at < 0 ? null : (args[at + 1] ?? null)
}

/**
 * Whether a command aims at this host only. A gh command names its host in `--hostname`, or in its
 * `--repo host/owner/repo`; one that names neither (`--version`) reaches no forge. A bkt command
 * goes through the context the port chose for the host.
 */
export const aimsAt = (cli: ForgeCli, args: ReadonlyArray<string>, host: string): boolean => {
  if (cli === 'bkt') return true
  const named = valueAfter(args, '--hostname') ?? valueAfter(args, '--repo')?.split('/')[0] ?? null
  return named === null || named.toLowerCase() === host.toLowerCase()
}
