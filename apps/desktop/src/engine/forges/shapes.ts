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
 * that is not a flag, which a pattern may narrow; then only the flags it names, each at most once
 * (gh's `--attach`, one file each, as many times as there are files),
 * written apart from its value (`--repo acme/shop`, never `--repo=acme/shop`): a switch, a flag
 * with a value (which a pattern may narrow), or a fixed word such as `--close-source=false`. A
 * required flag must be there, and of flags that are one of a kind exactly one. Nothing else may
 * follow: no other flag, no positional, no `--`.
 *
 * A write names its forge: a gh command its repository with its host (`--repo host/owner/repo`), a
 * bkt command its context (bkt sends a command to its active context otherwise, whatever the
 * repository's host) and its workspace or project. Every owner and repository name is one name of
 * the forge's, never `.` or `..`. The runner also checks that a gh command aims at the host of its
 * call (`aimsAt`), read from the parse of its arguments (`parseCommand`).
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
  /** It may be given more than once. */
  readonly repeat?: boolean
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

/**
 * A file gh uploads into a pull request's description (R7), `<path>#<alt>`, once per file: never a
 * flag. The runner attaches only Hemera's own images (`ForgeSettings.attachable`).
 */
const ATTACH: readonly [string, FlagRule] = [
  '--attach',
  { value: true, pattern: /^(?!-)/, required: false, repeat: true },
]

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
 * A workspace, a project key or a bkt context: one plain word, never a flag, never `.` or `..`
 * (`~` opens a Data Center personal project).
 */
export const SAFE_WORD = /^(?!-)(?!\.{1,2}$)[A-Za-z0-9._~-]+$/

const NUMBER: readonly [string, RegExp] = ['<number>', /^\d+$/]
/** The fields a gh read asks for: names and commas, nothing a shell or `--jq` would read. */
const JSON_FIELDS = /^[A-Za-z]+(,[A-Za-z]+)*$/
/** One owner or repository name: never `.` or `..`, which would walk out of the path, nor a flag. */
const NAME = String.raw`(?!-)(?!\.{1,2}(?:/|$))[A-Za-z0-9._-]+`
/** An owner or repository name, as the shapes accept it: a gh owner, a gh or bkt repository. */
export const REPO_NAME = new RegExp(`^${NAME}$`)
/** A repository's teams or the people with access to it, the first hundred (#502). */
const REVIEWERS = new RegExp(
  String.raw`^repos/${NAME}/${NAME}/(teams|collaborators)\?per_page=100$`,
)
/** A repository read through gh's API: its visibility and the account's permissions (R7). */
const REPO_PATH = new RegExp(String.raw`^repos/${NAME}/${NAME}$`)
/** The lists of a pull request's comments and reviews, read through gh's REST API (R8). */
const COMMENTS_PATH = new RegExp(
  String.raw`^repos/${NAME}/${NAME}/(pulls/\d+/comments|issues/\d+/comments|pulls/\d+/reviews)$`,
)
/**
 * The one GraphQL query Hemera sends (R8): a pull request's review threads, each resolved or not,
 * with the ids of its comments. A query, never a mutation; on one line, which `cmd.exe` would cut
 * at its first newline.
 */
export const THREADS_QUERY =
  'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes { isResolved comments(first: 100) { nodes { databaseId } } } } } } }'
/** What `-f` sends as a string: the one query given whole, the owner, the repository's name. */
const THREADS_STRING = new RegExp(
  String.raw`^(query=${THREADS_QUERY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|owner=${NAME}|name=${NAME})$`,
)
/** What `-F` sends typed: the pull request's number only. */
const THREADS_NUMBER = /^number=\d+$/
const APPROVAL = new RegExp(
  String.raw`^repos/${NAME}/${NAME}/actions/runs/\d+/pending_deployments$`,
)

/** The repository a gh command acts on, always named with its host: `host/owner/repo`. */
const GH_REPO: readonly [string, FlagRule] = [
  '--repo',
  valueFlag(true, new RegExp(String.raw`^(?!-)[A-Za-z0-9.-]+(:\d+)?/${NAME}/${NAME}$`)),
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
  ['--repo', valueFlag(true, REPO_NAME)],
]

export const COMMAND_SHAPES: ReadonlyArray<CommandShape> = [
  // The CLI and its own sign-in: this ticket's reads.
  read('gh', 'version', ['--version']),
  read('gh', 'auth.status', ['auth', 'status', '--hostname', '<host>']),
  read('gh', 'user', ['api', '--hostname', '<host>', 'user', '--jq', '.login']),
  // Who can review the pull requests, for the Reviewers dialog of the delivery rules (#502).
  shape(
    'gh',
    'read',
    'reviewers.list',
    ['api', '--hostname', '<host>', '<path>'],
    [],
    [['<path>', REVIEWERS]],
  ),
  read('bkt', 'version', ['--version']),
  read('bkt', 'auth.status', ['auth', 'status', '--json']),
  // Bitbucket Cloud's signed-in account (R8): its id, what a comment of mine is known by.
  shape('bkt', 'read', 'user', ['api', '/user'], [BKT_CONTEXT]),
  // The pull requests (R6): found before one is created, read for their state, head and
  // approvals. Only the open ones are listed, and only the fields named.
  shape(
    'gh',
    'read',
    'pr.list',
    ['pr', 'list'],
    [
      GH_REPO,
      ['--head', valueFlag(true)],
      ['--base', valueFlag(true)],
      ['--state', valueFlag(true, /^open$/)],
      ['--json', valueFlag(true, JSON_FIELDS)],
    ],
  ),
  shape(
    'gh',
    'read',
    'pr.view',
    ['pr', 'view', '<number>'],
    [GH_REPO, ['--json', valueFlag(true, JSON_FIELDS)]],
    [NUMBER],
  ),
  // bkt's list and view as read in its source at `5068ddc` (#253): to confirm on a real forge.
  shape(
    'bkt',
    'read',
    'pr.list',
    ['pr', 'list'],
    [
      ...BKT_PLACE,
      ['--source', valueFlag(true)],
      ['--target', valueFlag(true)],
      ['--state', valueFlag(true, /^OPEN$/)],
      ['--json', switchFlag(true)],
    ],
  ),
  shape(
    'bkt',
    'read',
    'pr.view',
    ['pr', 'view', '<number>'],
    [...BKT_PLACE, ['--json', switchFlag(true)]],
    [NUMBER],
  ),
  // The comments of a pull request, inline and general, and its reviews (R8): read only, in
  // pages. Hemera never posts, edits, reacts to or resolves anything on a forge.
  shape(
    'gh',
    'read',
    'comments.list',
    ['api', '--hostname', '<host>', '<path>'],
    [
      ['--paginate', switchFlag(true)],
      ['--slurp', switchFlag(true)],
    ],
    [['<path>', COMMENTS_PATH]],
  ),
  shape(
    'gh',
    'read',
    'comments.threads',
    ['api', '--hostname', '<host>', 'graphql'],
    [
      ['-f', { value: true, pattern: THREADS_STRING, required: true, repeat: true }],
      ['-F', valueFlag(true, THREADS_NUMBER)],
    ],
  ),
  // bkt's own list of a pull request's comments, as read in its source at `5068ddc`: Cloud's API
  // comments, or Data Center's from the pull request's activities. To confirm on a real forge.
  shape(
    'bkt',
    'read',
    'comments.list',
    ['pr', 'comments', '<number>'],
    [...BKT_PLACE, ['--json', switchFlag(true)]],
    [NUMBER],
  ),
  // A repository's visibility and whether the account may push, which hosting an image needs (R7).
  shape(
    'gh',
    'read',
    'repo.view',
    ['api', '--hostname', '<host>', '<path>'],
    [],
    [['<path>', REPO_PATH]],
  ),

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
      // The reviewers of the rules, joined by commas (R6).
      ['--reviewer', valueFlag()],
      // The mission's images, uploaded into the description (R7).
      ATTACH,
    ],
  ),
  // Before `pr.edit`: an image attached is an edit of its own (R7), with the description it is
  // shown in when the file names it replaces are written there.
  shape(
    'gh',
    'network-write',
    'pr.attach',
    ['pr', 'edit', '<number>'],
    [
      GH_REPO,
      [ATTACH[0], { ...ATTACH[1], required: true }],
      ['--body-file', valueFlag(false, FROM_INPUT)],
    ],
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
  // bkt takes a pull request's description in `--description` only: as read in its source at
  // `5068ddc` (#253), `pr create` and `pr edit` have no standard input and no file for it, unlike
  // gh's `--body-file -`. So the description travels in the arguments: anyone listing the
  // machine's processes sees it while bkt runs, and the command recorded keeps it, masked like the
  // rest of the command. Through a `.cmd` shim, `cmd.exe` also cuts it at its first newline (cut,
  // never injected: every metacharacter is escaped). Move it to the standard input if bkt gains one.
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
      ['--reviewer', valueFlag()],
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
      ['--repo', valueFlag(true, REPO_NAME)],
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

/** A command read against its shape: the value of each slot and of each flag given. */
export interface ParsedCommand {
  readonly shape: CommandShape
  readonly slots: ReadonlyMap<string, string>
  /** Each flag given, with its value (the last, for one given more than once); a switch with none. */
  readonly flags: ReadonlyMap<string, string | null>
  /** Where each value of a flag stands among the arguments, in their order. */
  readonly positions: ReadonlyMap<string, ReadonlyArray<number>>
}

/**
 * The flags after the words, when they are only flags of the shape, each once, the required ones
 * there; null otherwise.
 */
const flagsOf = (
  owner: CommandShape,
  rest: ReadonlyArray<string>,
): Pick<ParsedCommand, 'flags' | 'positions'> | null => {
  const seen = new Map<string, string | null>()
  const positions = new Map<string, Array<number>>()
  for (let at = 0; at < rest.length; at += 1) {
    const name = rest[at] ?? ''
    const rule = owner.flags.get(name)
    if (rule === undefined || (seen.has(name) && rule.repeat !== true)) return null
    if (!rule.value) {
      seen.set(name, null)
      continue
    }
    at += 1
    const value = rest[at]
    if (value === undefined) return null
    if (rule.pattern !== undefined && !rule.pattern.test(value)) return null
    seen.set(name, value)
    positions.set(name, [...(positions.get(name) ?? []), at])
  }
  const flags = [...owner.flags]
  const groups = new Set(
    flags.flatMap(([, rule]) => (rule.oneOf === undefined ? [] : [rule.oneOf])),
  )
  const complete =
    flags.every(([name, rule]) => !rule.required || seen.has(name)) &&
    [...groups].every(
      (group) =>
        flags.filter(([name, rule]) => rule.oneOf === group && seen.has(name)).length === 1,
    )
  return complete ? { flags: seen, positions } : null
}

/** These arguments of this CLI read against the first shape they match; null when none does. */
export const parseCommand = (cli: ForgeCli, args: ReadonlyArray<string>): ParsedCommand | null => {
  for (const one of COMMAND_SHAPES) {
    if (one.cli !== cli || args.length < one.words.length) continue
    if (!one.words.every((word, at) => fitsWord(one, word, args[at] ?? ''))) continue
    const given = flagsOf(one, args.slice(one.words.length))
    if (given === null) continue
    const slots = new Map(
      one.words.flatMap((word, at) => (SLOT.test(word) ? [[word, args[at] ?? '']] : [])),
    )
    // Where each value stands among all the arguments, the words before the flags counted.
    const positions = new Map(
      [...given.positions].map(([name, found]) => [name, found.map((at) => at + one.words.length)]),
    )
    return { shape: one, slots, flags: given.flags, positions }
  }
  return null
}

/** The shape these arguments of this CLI match, the first in the list; null when none does. */
export const shapeOf = (cli: ForgeCli, args: ReadonlyArray<string>): CommandShape | null =>
  parseCommand(cli, args)?.shape ?? null

/**
 * Whether a command aims at this host only, read from its parse: a gh command names its host in
 * its `<host>` slot (`--hostname <host>`) or in its `--repo host/owner/repo`; a read that names
 * neither (`--version`) reaches no forge, a write must name one. A command no shape matches aims
 * at nothing. A bkt command goes through the context its call carries (the runner compares them).
 */
export const aimsAt = (cli: ForgeCli, args: ReadonlyArray<string>, host: string): boolean => {
  const parsed = parseCommand(cli, args)
  if (parsed === null) return false
  if (cli === 'bkt') return true
  const named = parsed.slots.get('<host>') ?? parsed.flags.get('--repo')?.split('/')[0] ?? null
  if (named === null) return parsed.shape.class === 'read'
  return named.toLowerCase() === host.toLowerCase()
}
