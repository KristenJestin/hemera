/**
 * A build as the domain reasons about it: the phases of a `build` Session, the states Hemera
 * keeps for each contractual task, and the checks a Project runs to judge them (design D10-01,
 * D10-04, D10-06).
 *
 * Hemera owns every state here: the agent signals that it finished a task or that a task
 * contradicts the Spec, and Hemera decides what follows (D10-04). What is here is pure — the
 * rules — and every act on the database, on Git or on a process belongs to the engine.
 */

import type { Command } from './commands.ts'
import { compareRanks } from './rank.ts'
import type { SpecTask, TaskDependency, TaskExecutor, TaskStory } from './spec.ts'

/**
 * Where a `build` Session stands (D10-01): `prepare`, `execute` and `verify` in that order, then
 * `accepted` once the user accepted the result, or `stopped` once the user stopped it or its
 * revision was replaced before its first task started. The last two are closed: the build stays
 * readable and nothing runs in it any more.
 */
export const BUILD_PHASES = ['prepare', 'execute', 'verify', 'accepted', 'stopped'] as const

export type BuildPhase = (typeof BUILD_PHASES)[number]

/** The phases a build works through, in the order of its protocol; the other two close it. */
export type ActiveBuildPhase = Exclude<BuildPhase, 'accepted' | 'stopped'>

/**
 * Where a contractual task stands in a build (D10-04): waiting for its dependencies, ready to be
 * handed, in progress, being checked, done, waiting for the user (`yours`: a human task, or three
 * red attempts), suspended by a blocker, or skipped by the user.
 */
export const TASK_STATES = [
  'waiting',
  'ready',
  'in_progress',
  'checking',
  'done',
  'yours',
  'blocked',
  'skipped',
] as const

export type TaskState = (typeof TASK_STATES)[number]

/** What an attempt is about (D10-07): one task, the checks of a story, or the end checks. */
export const ATTEMPT_SCOPES = ['task', 'story', 'build'] as const

export type AttemptScope = (typeof ATTEMPT_SCOPES)[number]

/**
 * How an attempt ended (D10-07): every check green, a red one, or no check to run — a task with
 * no check is done, not verified. Null while the attempt runs.
 */
export const ATTEMPT_RESULTS = ['green', 'red', 'unverified'] as const

export type AttemptResult = (typeof ATTEMPT_RESULTS)[number]

/** How many red attempts a task gets before it comes back to the user (D10-07). */
export const ATTEMPTS_BEFORE_YOURS = 3

/**
 * Where a check runs (D10-06): at the Workspace root, in one repository of the Project, or in
 * each repository whose task diff is not empty.
 */
export const CHECK_WHERE = ['root', 'repository', 'changed'] as const

export type CheckWhere = (typeof CHECK_WHERE)[number]

/** When a check runs (D10-06): after each task, after each story, or at the end of the build. */
export const CHECK_WHEN = ['task', 'story', 'end'] as const

export type CheckWhen = (typeof CHECK_WHEN)[number]

/** What one check's run says (D10-06): green, red, or skipped when `{files}` matched nothing. */
export const CHECK_VERDICTS = ['green', 'red', 'skipped'] as const

export type CheckVerdict = (typeof CHECK_VERDICTS)[number]

/**
 * A number the check's output has to show (D10-06): the first capture of `pattern`, read as a
 * number, must be at least `minimum`.
 */
export interface CheckExpect {
  readonly pattern: string
  readonly minimum: number
}

/**
 * What a check is before the Project keeps it (D10-06): what the check dialog edits and what
 * `proposeChecks` proposes. A catalogue command (`commandId`) or a line of the user's (`line`),
 * exactly one of the two; where and when it runs; what it is expected to show beyond its exit
 * code; and the filter `{files}` is expanded with, when its line takes the task's files.
 * `repository` is the repository's path as the Project declares it, set only when `where` is
 * `repository`.
 */
export interface CheckDraft {
  readonly name: string
  readonly commandId: string | null
  readonly line: string | null
  readonly where: CheckWhere
  readonly repository: string | null
  readonly when: CheckWhen
  readonly expect: CheckExpect | null
  readonly files: string | null
}

/** One check of a Project (D10-06): a draft kept, and `rank` orders the list as the catalogue's. */
export interface ProjectCheck extends CheckDraft {
  readonly id: string
  readonly projectId: string
  readonly rank: string
}

/**
 * The label of every contractual task of a revision, by its id: `T1`, `T2`… in the rank order of
 * the revision. The agent names a task by its label, the briefs list it as `T2 · <title>`, and the
 * build keeps it on its row, so a label never moves once the build is prepared.
 */
export function taskLabels(tasks: readonly Pick<SpecTask, 'id' | 'rank'>[]): Map<string, string> {
  return new Map(
    [...tasks]
      .sort((left, right) => compareRanks(left.rank, right.rank))
      .map((task, index) => [task.id, `T${index + 1}`]),
  )
}

/**
 * A contractual task as the rules of a build read it (D10-03, D10-04): the task of the revision it
 * is (`taskId`, the id the dependencies and the story links name), who carries it out, where it
 * stands, and — once the user skipped it — whether they let its dependants go on.
 */
export interface BuildTask {
  readonly taskId: string
  readonly executor: TaskExecutor
  readonly state: TaskState
  readonly skipUnblocks: boolean
}

/**
 * Whether a task counts as done for the tasks that depend on it (D10-03): a done task does, and a
 * skipped one only when the user said so as they skipped it.
 */
export function satisfied(task: Pick<BuildTask, 'state' | 'skipUnblocks'>): boolean {
  return task.state === 'done' || (task.state === 'skipped' && task.skipUnblocks)
}

function dependenciesMet(
  taskId: string,
  byId: ReadonlyMap<string, BuildTask>,
  dependencies: readonly TaskDependency[],
): boolean {
  return dependencies
    .filter((dependency) => dependency.taskId === taskId)
    .every((dependency) => {
      const needed = byId.get(dependency.dependsOnId)
      return needed !== undefined && satisfied(needed)
    })
}

/** A waiting task whose dependencies are all met, and the state it moves to. */
export interface Promotion {
  readonly taskId: string
  readonly state: 'ready' | 'yours'
}

/**
 * The waiting tasks whose dependencies are all met, and where each goes (D10-02, D10-08): an
 * agent's task becomes `ready`, a human's becomes `yours` — the user's to mark done or skip,
 * never acknowledged by Hemera. At prepare every row starts `waiting` and this sets the first
 * ones; after each change that satisfies a task it sets the next. The graph was validated when
 * the Spec was marked ready: it is acyclic and names only tasks of the revision.
 */
export function promotions(
  tasks: readonly BuildTask[],
  dependencies: readonly TaskDependency[],
): Promotion[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]))
  return tasks
    .filter((task) => task.state === 'waiting' && dependenciesMet(task.taskId, byId, dependencies))
    .map((task) => ({ taskId: task.taskId, state: task.executor === 'human' ? 'yours' : 'ready' }))
}

/** The states a task of the agent's may be handed in: not yet judged, and not held back. */
const HANDABLE: readonly TaskState[] = ['waiting', 'ready', 'in_progress']

/**
 * The ready set (D10-03): every task of the agent's not done, not being checked, not the user's,
 * not blocked and not skipped, whose dependencies are all met, in the order given. A task in
 * progress stays in it until Hemera judges it, so a red attempt is handed again with its failures
 * (D10-07). It reads the graph rather than the stored `ready`: the engine writes `promotions`
 * before it hands the set, and what it hands is then `ready` or already in progress.
 */
export function readySet<T extends BuildTask>(
  tasks: readonly T[],
  dependencies: readonly TaskDependency[],
): T[] {
  const byId = new Map<string, BuildTask>(tasks.map((task) => [task.taskId, task]))
  return tasks.filter(
    (task) =>
      task.executor === 'agent' &&
      HANDABLE.includes(task.state) &&
      dependenciesMet(task.taskId, byId, dependencies),
  )
}

/**
 * Every task that depends on `taskId`, directly or through others (D10-08): what a blocker
 * suspends beside the task itself, in the order they are reached.
 */
export function dependantsOf(taskId: string, dependencies: readonly TaskDependency[]): string[] {
  const reached: string[] = []
  const queue = [taskId]
  for (let at = 0; at < queue.length; at++) {
    for (const dependency of dependencies) {
      const dependant = dependency.taskId
      if (
        dependency.dependsOnId === queue[at] &&
        dependant !== taskId &&
        !reached.includes(dependant)
      ) {
        reached.push(dependant)
        queue.push(dependant)
      }
    }
  }
  return reached
}

/**
 * Whether every task covering a story is done (D10-07), which is when its `story` checks run. A
 * skipped task leaves its story unchecked: the story is not whole, and its checks would judge work
 * that was not done.
 */
export function storyDone(
  storyId: string,
  taskStories: readonly TaskStory[],
  tasks: readonly BuildTask[],
): boolean {
  const covering = new Set(
    taskStories.filter((link) => link.storyId === storyId).map((link) => link.taskId),
  )
  const states = tasks.filter((task) => covering.has(task.taskId)).map((task) => task.state)
  return states.length > 0 && states.every((state) => state === 'done')
}

/** Whether no task is left to work on (D10-07): each is done or skipped, and `verify` may start. */
export function tasksSettled(tasks: readonly BuildTask[]): boolean {
  return tasks.every((task) => task.state === 'done' || task.state === 'skipped')
}

/**
 * How an attempt ended, from its checks' verdicts (D10-06, D10-07): red when one is, green when
 * one is green and none red, and unverified when nothing was judged — no check, or every one
 * skipped because `{files}` matched nothing.
 */
export function attemptResult(verdicts: readonly CheckVerdict[]): AttemptResult {
  if (verdicts.includes('red')) return 'red'
  return verdicts.includes('green') ? 'green' : 'unverified'
}

/**
 * Where a task goes once its attempt `number` (1-based) ended (D10-07): done unless red; a red
 * one goes back in progress to be handed again with its failures, and the third comes back to
 * the user.
 */
export function stateAfterAttempt(result: AttemptResult, number: number): TaskState {
  if (result !== 'red') return 'done'
  return number >= ATTEMPTS_BEFORE_YOURS ? 'yours' : 'in_progress'
}

/**
 * Where one check runs (D10-06): `''` for the Workspace root, its one repository as the Project
 * declares it, or each repository in `changed` — those whose diff is not empty. A catalogue
 * command at the root runs where the catalogue puts it; the engine resolves that.
 */
export function checkPlaces(
  check: Pick<CheckDraft, 'where' | 'repository'>,
  changed: readonly string[],
): string[] {
  switch (check.where) {
    case 'root':
      return ['']
    case 'repository':
      return [check.repository ?? '']
    case 'changed':
      return [...changed]
  }
}

/** What Hemera judges one check's run to be (D10-06): its verdict, the number it read, and why. */
export interface CheckJudgement {
  readonly verdict: Exclude<CheckVerdict, 'skipped'>
  readonly value: number | null
  readonly detail: string | null
}

/**
 * The number an output shows for a pattern: the first capture of the pattern's first match, the
 * pattern read line by line (`^` and `$` at each line). The capture is read as a decimal number
 * with an optional sign, an optional `%` after it, and a dot or a comma as the decimal separator —
 * `64.2` and `64,2` both read 64.2 — and no thousands separator; anything else is no number.
 */
function numberIn(output: string, pattern: string): number | null {
  const captured = new RegExp(pattern, 'm').exec(output)?.[1]?.trim().replace(/\s*%$/, '')
  if (captured === undefined || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(captured)) return null
  return Number(captured.replace(',', '.'))
}

/**
 * The verdict of one check's run (D10-06): green when it exited 0 and, with an `expect`, the
 * number its output shows is at least the minimum. An error is never masked: a run that did not
 * exit 0 is red whatever it printed. The detail says why a run is red — `exited with 1`,
 * `no number matched /<pattern>/`, `64.2 < 70` — and the value is the number read, when read.
 */
export function evaluateExpect(
  output: string,
  exitCode: number | null,
  expect: CheckExpect | null,
): CheckJudgement {
  const value = expect === null ? null : numberIn(output, expect.pattern)
  if (exitCode !== 0) {
    const detail = exitCode === null ? 'ended without an exit code' : `exited with ${exitCode}`
    return { verdict: 'red', value, detail }
  }
  if (expect === null) return { verdict: 'green', value, detail: null }
  if (value === null) {
    return { verdict: 'red', value, detail: `no number matched /${expect.pattern}/` }
  }
  if (value < expect.minimum) {
    return { verdict: 'red', value, detail: `${value} < ${expect.minimum}` }
  }
  return { verdict: 'green', value, detail: null }
}

/**
 * Whether a path matches a glob (D10-06): `*` any characters but `/`, `?` one of them, `**` any
 * folders — `**\/` none or several whole folders, and elsewhere anything at all — and `{a,b}`
 * either of its comma-separated parts, which may nest and hold wildcards. The glob matches the
 * whole path, from its start: `*.ts` matches `a.ts` and not `src/a.ts`, which `**\/*.ts` does.
 */
export function globMatcher(glob: string): (path: string) => boolean {
  let source = ''
  let depth = 0
  for (let at = 0; at < glob.length; at++) {
    const character = glob.charAt(at)
    if (character === '*' && glob.charAt(at + 1) === '*') {
      const folders = glob.charAt(at + 2) === '/'
      source += folders ? '(?:.*/)?' : '.*'
      at += folders ? 2 : 1
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else if (character === '{') {
      source += '(?:'
      depth++
    } else if (character === '}' && depth > 0) {
      source += ')'
      depth--
    } else if (character === ',' && depth > 0) {
      source += '|'
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  const expression = new RegExp(`^${source}${')'.repeat(depth)}$`)
  return (path) => expression.test(path)
}

/** What `{files}` in a check's line is replaced with. */
export const FILES_PLACEHOLDER = '{files}'

/** One file an attempt changed in one repository, as Git's diff of its two snapshots says. */
export interface ChangedFile {
  /** Relative to the repository, `/`-separated; the new path of a renamed file. */
  readonly path: string
  /** Git's status letter: `A` added, `M` modified, `D` deleted, `R` renamed… */
  readonly status: string
  /** Lines added and removed; null for a binary file. */
  readonly added: number | null
  readonly removed: number | null
}

/**
 * One file as one word of a command line. Hemera runs a line without a shell, split into words
 * where it has spaces and a quoted part kept whole: a path of plain characters is written as it
 * is, any other is quoted, a double quote in it written between single quotes.
 */
function asWord(path: string): string {
  if (/^[\w./@+=:-]+$/.test(path)) return path
  return path
    .split('"')
    .map((part) => `"${part}"`)
    .join(`'"'`)
}

/**
 * The line a check runs, or null when it is skipped (D10-06). With `{files}` or a filter, the
 * line runs only when the task changed a file matching the filter — every file, with no filter —
 * and `{files}` is replaced by those files, deleted ones left out, each one word; with none
 * matching the check is skipped. `changed` are relative to the place the line runs in, which is
 * what the filter matches. A line with neither is returned as it is.
 */
export function expandFiles(
  line: string,
  changed: readonly Pick<ChangedFile, 'path' | 'status'>[],
  filter: string | null,
): string | null {
  if (!line.includes(FILES_PLACEHOLDER) && filter === null) return line
  const matches = filter === null ? () => true : globMatcher(filter)
  const files = changed
    .filter((file) => !file.status.startsWith('D') && matches(file.path))
    .map((file) => asWord(file.path))
  if (files.length === 0) return null
  return line.replaceAll(FILES_PLACEHOLDER, files.join(' '))
}

/** A command named like an end-to-end suite. */
const END_TO_END = /\be2e\b|end[\s_-]?to[\s_-]?end/i

/** A command named like a type check. */
const TYPE_CHECK = /type[\s_-]?check|\btsc\b/i

/**
 * When and where a catalogue command is proposed to run as a check, from its type and its name
 * (D10-06), or null for a command proposed as none: an end-to-end `test` and a `build` at the
 * end, a `lint` or anything named like a type check after each task, any other `test` after each
 * story. A command that never ends — a `serve` — is never a check.
 */
function proposedFor(
  command: Pick<Command, 'name' | 'type'>,
): Pick<CheckDraft, 'when' | 'where'> | null {
  if (command.type === 'serve') return null
  if (command.type === 'test' && END_TO_END.test(command.name)) {
    return { when: 'end', where: 'root' }
  }
  if (command.type === 'lint' || TYPE_CHECK.test(command.name)) {
    return { when: 'task', where: 'changed' }
  }
  if (command.type === 'test') return { when: 'story', where: 'changed' }
  if (command.type === 'build') return { when: 'end', where: 'root' }
  return null
}

/**
 * The checks proposed to a Project that has none, from its catalogue (D10-06), in the catalogue's
 * order; nothing is kept until the user accepts them. Each runs its command by id and expects
 * exit code 0. A command of one repository runs where the catalogue puts it, not in each changed
 * repository: its line is written for its own.
 */
export function proposeChecks(
  commands: readonly Pick<Command, 'id' | 'name' | 'type' | 'folderBase'>[],
): CheckDraft[] {
  return commands.flatMap((command) => {
    const proposed = proposedFor(command)
    if (proposed === null) return []
    const where =
      command.folderBase !== null && proposed.where === 'changed' ? 'root' : proposed.where
    return [
      {
        name: command.name,
        commandId: command.id,
        line: null,
        where,
        repository: null,
        when: proposed.when,
        expect: null,
        files: null,
      },
    ]
  })
}

/** How many capture groups a pattern has, or null when it is no regular expression. */
function groupsIn(pattern: string): number | null {
  try {
    const valid = new RegExp(pattern, 'm')
    // An alternative that matches the empty text makes every group of the pattern appear, unset.
    return (new RegExp(`${valid.source}|`).exec('')?.length ?? 1) - 1
  } catch {
    return null
  }
}

/** Why a pattern cannot read a number, or null when it can. */
function patternProblem(pattern: string): string | null {
  if (pattern.trim() === '') return 'Write the pattern the number is read with.'
  const groups = groupsIn(pattern)
  if (groups === null) return 'The pattern is not a valid regular expression.'
  return groups === 0
    ? 'Put the number to read between parentheses in the pattern, as in Coverage: ([0-9.]+)%.'
    : null
}

/** Why a files filter cannot be used, or null when it can. */
function filterProblem(filter: string): string | null {
  if (filter.trim() === '') return 'Write the files filter, as in e2e/**/*.e2e.ts, or remove it.'
  let depth = 0
  for (const character of filter) {
    if (character === '{') depth++
    if (character === '}' && depth > 0) depth--
  }
  return depth > 0 ? 'The files filter opens a { it does not close.' : null
}

/**
 * Why a check cannot be saved, as the sentence the check dialog shows, or null when it can be
 * (D10-06). `taken` are the names of the Project's other checks: two checks never share one.
 */
export function checkProblem(draft: CheckDraft, taken: readonly string[]): string | null {
  const name = draft.name.trim()
  if (name === '') return 'Give the check a name.'
  if (taken.includes(name)) return `A check named “${name}” already exists.`
  const line = draft.line?.trim() ?? ''
  if (draft.commandId !== null && line !== '') {
    return 'A check runs a command of the catalogue or a line, not both.'
  }
  if (draft.commandId === null && line === '') {
    return 'Choose a command of the catalogue or write a line to run.'
  }
  if (draft.where === 'repository' && draft.repository === null) {
    return 'Choose the repository the check runs in.'
  }
  if (draft.where !== 'repository' && draft.repository !== null) {
    return 'Only a check that runs in one repository names a repository.'
  }
  if (draft.expect !== null) {
    const problem = patternProblem(draft.expect.pattern)
    if (problem !== null) return problem
    if (!Number.isFinite(draft.expect.minimum)) return 'The minimum must be a number.'
  }
  return draft.files === null ? null : filterProblem(draft.files)
}
