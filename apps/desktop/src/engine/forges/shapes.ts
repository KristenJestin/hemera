/**
 * The command shapes the forge runner may run (#253), each with its class: a `read`, or a
 * `network-write`. The runner refuses, before spawning, any command whose arguments match no shape
 * here, so what Hemera may write on a forge is this list and nothing else.
 *
 * The network writes are CT-50's: the push (through Git, R6), the pull request operations (create,
 * edit, attach an image, merge) and the actions on the remote (run a workflow or a pipeline, rerun,
 * approve a pending deployment). The later tickets that build them (R6, R7, S2, S4) give their shape
 * its exact words; their slot is here so that a write cannot be added anywhere else.
 *
 * A shape is its leading words, each a word or a slot (`<host>`) for one value that is not a flag,
 * which a pattern may narrow. A closed shape is matched whole: nothing may follow its words. An open shape lets flags follow, for a
 * command that has no write behind a flag of its own (`gh api` has one, `--method`, so every `api`
 * shape is closed).
 */

import type { ForgeCli } from '@hemera/ipc'

export type ShapeClass = 'read' | 'network-write'

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
  /** Whether arguments may follow the words. */
  readonly open: boolean
}

const shape = (
  cli: CommandShape['cli'],
  kind: ShapeClass,
  operation: string,
  words: ReadonlyArray<string>,
  options: { readonly open: boolean; readonly patterns?: ReadonlyMap<string, RegExp> },
): CommandShape => ({
  cli,
  class: kind,
  operation,
  words,
  patterns: options.patterns ?? new Map(),
  open: options.open,
})

const read = (cli: ForgeCli, operation: string, words: ReadonlyArray<string>) =>
  shape(cli, 'read', operation, words, { open: false })

const write = (cli: ForgeCli | 'git', operation: string, words: ReadonlyArray<string>) =>
  shape(cli, 'network-write', operation, words, { open: true })

export const COMMAND_SHAPES: ReadonlyArray<CommandShape> = [
  // The CLI and its own sign-in: this ticket's reads.
  read('gh', 'version', ['--version']),
  read('gh', 'auth.status', ['auth', 'status', '--hostname', '<host>']),
  read('gh', 'user', ['api', '--hostname', '<host>', 'user', '--jq', '.login']),
  read('bkt', 'version', ['--version']),
  read('bkt', 'auth.status', ['auth', 'status', '--json']),

  // CT-50's network writes. The push is Git's own (R6).
  write('git', 'push', ['push']),
  // Pull requests (R6, R7, S2): the text goes on the standard input, never in an argument.
  write('gh', 'pr.create', ['pr', 'create']),
  // Before `pr.edit`, which would match it too: an image attached is an edit of its own (R7).
  shape(
    'gh',
    'network-write',
    'pr.attach',
    ['pr', 'edit', '<number>', '--repo', '<repository>', '--attach', '<file>'],
    { open: false, patterns: new Map([['<number>', /^\d+$/]]) },
  ),
  write('gh', 'pr.edit', ['pr', 'edit']),
  write('gh', 'pr.merge', ['pr', 'merge']),
  write('bkt', 'pr.create', ['pr', 'create']),
  write('bkt', 'pr.edit', ['pr', 'edit']),
  write('bkt', 'pr.merge', ['pr', 'merge']),
  // The actions on the remote (S4).
  write('gh', 'workflow.run', ['workflow', 'run']),
  write('gh', 'run.rerun', ['run', 'rerun']),
  shape(
    'gh',
    'network-write',
    'deployment.approve',
    ['api', '--hostname', '<host>', '--method', 'POST', '<path>', '--input', '-'],
    {
      open: false,
      patterns: new Map([
        ['<path>', /^repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/pending_deployments$/],
      ]),
    },
  ),
  // A rerun on Bitbucket Cloud is a new run.
  write('bkt', 'pipeline.run', ['pipeline', 'run']),
]

const SLOT = /^<[a-z]+>$/

const matches = (owner: CommandShape, word: string, arg: string): boolean => {
  if (!SLOT.test(word)) return word === arg
  return !arg.startsWith('-') && (owner.patterns.get(word)?.test(arg) ?? true)
}

/** The shape these arguments of this CLI match, the first in the list; null when none does. */
export const shapeOf = (cli: ForgeCli, args: ReadonlyArray<string>): CommandShape | null =>
  COMMAND_SHAPES.find(
    (one) =>
      one.cli === cli &&
      args.length >= one.words.length &&
      (one.open || args.length === one.words.length) &&
      one.words.every((word, at) => matches(one, word, args[at] ?? '')),
  ) ?? null
