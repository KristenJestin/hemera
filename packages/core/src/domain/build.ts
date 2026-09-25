/**
 * A build as the domain reasons about it: the phases of a `build` Session, the states Hemera
 * keeps for each contractual task, and the checks a Project runs to judge them (design D10-01,
 * D10-04, D10-06).
 *
 * Hemera owns every state here: the agent signals that it finished a task or that a task
 * contradicts the Spec, and Hemera decides what follows (D10-04). What is here is pure — the
 * rules — and every act on the database, on Git or on a process belongs to the engine.
 */

/**
 * Where a `build` Session stands (D10-01): `prepare`, `execute` and `verify` in that order, then
 * `accepted` once the user accepted the result, or `stopped` once the user stopped it or its
 * revision was replaced before its first task started. The last two are closed: the build stays
 * readable and nothing runs in it any more.
 */
export const BUILD_PHASES = ['prepare', 'execute', 'verify', 'accepted', 'stopped'] as const

export type BuildPhase = (typeof BUILD_PHASES)[number]

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
 * One check of a Project (D10-06): a catalogue command (`commandId`) or a line of the user's
 * (`line`), exactly one of the two; where and when it runs; what it is expected to show beyond
 * its exit code; and the filter `{files}` is expanded with, when its line takes the task's files.
 * `repository` is the repository's path as the Project declares it, set only when `where` is
 * `repository`. `rank` orders the list as the catalogue's ranks order theirs.
 */
export interface ProjectCheck {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly commandId: string | null
  readonly line: string | null
  readonly where: CheckWhere
  readonly repository: string | null
  readonly when: CheckWhen
  readonly expect: CheckExpect | null
  readonly files: string | null
  readonly rank: string
}
