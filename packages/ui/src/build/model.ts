/**
 * What the build view is handed to draw (lot 22, phase 0; design D10-04, D10-05, D10-12).
 *
 * View types only, kept close to the engine's `BuildView` so that the renderer's mapping stays a
 * mapping: the phase of the build, every contractual task with its state, its dates and its tries,
 * each try with its checks and the files it changed, the blockers the agent raised and the
 * stories. The design system imports nothing of Hemera, so the words of the domain are declared
 * again here as the unions the view draws, and the plain words a reader sees are decided here and
 * nowhere else: a build is "Building", never `execute`; a task is "Working", never `in_progress`.
 *
 * Every time is an ISO string, and nothing here reads a clock: the caller hands the view its
 * `now`, which is what keeps a story the same whenever it is run.
 */

/** Where a build stands (D10-01): its three phases, then accepted or stopped. */
export type BuildPhase = 'prepare' | 'execute' | 'verify' | 'accepted' | 'stopped'

/** Where a contractual task stands in the build (D10-04). */
export type BuildTaskState =
  | 'waiting'
  | 'ready'
  | 'in_progress'
  | 'checking'
  | 'done'
  | 'yours'
  | 'blocked'
  | 'skipped'

/** Who a task is entrusted to: the build's agent, or the user. */
export type BuildExecutor = 'agent' | 'human'

/** What a try is about (D10-07): one task, the checks of a story, or the final checks. */
export type BuildAttemptScope = 'task' | 'story' | 'build'

/** How a try ended: every check green, a red one, or no check to run. Null while it runs. */
export type BuildAttemptResult = 'green' | 'red' | 'unverified'

/** What one check said: green, red, or skipped when its files filter matched nothing. */
export type BuildCheckVerdict = 'green' | 'red' | 'skipped'

/** One check run of a try (D10-06, L4). */
export interface BuildCheckView {
  id: string
  /** The check's name, as the Project's settings call it. */
  name: string
  /** Where it ran: `''` for the Workspace root, or the repository's path under the Workspace. */
  place: string
  /** The line as it ran, `{files}` already replaced. */
  line: string
  verdict: BuildCheckVerdict
  exitCode: number | null
  /** The number read in the output, when the check expects one. */
  value: number | null
  /** Why it is red, in the engine's short words: `64.2 < 70`, `exited with 1`. */
  detail: string | null
  /** The last lines of what it printed. */
  outputTail: string
  /** The run it was, in the Session's commands, when there is one to open. */
  runId: string | null
  ranAt: string
}

/** One file a try changed, in one repository (D10-05, L11). */
export interface BuildFileView {
  /** The repository's path under the Workspace, `''` for a repository at its root. */
  repository: string
  path: string
  /** Git's letter: `A` added, `M` modified, `D` deleted, `R` renamed. */
  status: string
  /** Lines added and removed; null for a binary file. */
  added: number | null
  removed: number | null
}

/** One try of a task, of a story, or of the final checks. */
export interface BuildAttemptView {
  id: string
  scope: BuildAttemptScope
  /** 1-based, per task, per story, per build. */
  number: number
  startedAt: string
  endedAt: string | null
  result: BuildAttemptResult | null
  checks: BuildCheckView[]
  files: BuildFileView[]
}

/** One contractual task of the build, with what Hemera kept about it. */
export interface BuildTaskView {
  /** The build task's own id, which the actions are handed back with. */
  id: string
  /** The contractual task of the Spec it stands for. */
  taskId: string
  /** `T1`…`Tn`, by the task's rank in the Spec (L1). */
  label: string
  title: string
  /** What is true once it is done. */
  result: string
  /** How it is verified, as the Spec writes it. */
  criteria: string
  /** The task's kind, as the Spec types it. */
  type: string
  executor: BuildExecutor
  state: BuildTaskState
  /** The labels of the tasks it waits on. */
  dependsOn: string[]
  /** The stories it realises. */
  storyIds: string[]
  handedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  endedAt: string | null
  updatedAt: string
  /** Why the user skipped it. */
  skipReason: string | null
  /** Whether its dependants were let go on when it was skipped (L6). */
  skipUnblocks?: boolean | undefined
  attempts: BuildAttemptView[]
}

/** The agent saying a task contradicts the Spec (D10-08). */
export interface BuildBlockerView {
  id: string
  /** The build task it is raised on. */
  taskId: string
  label: string
  reason: string
  raisedAt: string
  dismissedAt: string | null
}

/** Where a story stands, derived from the evidence of its tasks. */
export type BuildStoryState = 'open' | 'checking' | 'green' | 'red'

export interface BuildStoryView {
  id: string
  /** `S1`, `S2`, as the Spec keys it. */
  key: string
  title: string
  /** The labels of the tasks that cover it. */
  labels: string[]
  state: BuildStoryState
  attempts: BuildAttemptView[]
}

/** Everything the build view draws, as the engine answers `build.read`. */
export interface BuildViewData {
  sessionId: string
  specId: string
  specKey: string
  specTitle: string
  phase: BuildPhase
  /** When the user paused it; null while it runs. */
  pausedAt: string | null
  /** Why it stopped, in the engine's words, once it is stopped. */
  detail: string | null
  /** The agent's approach note, once it wrote one (D10-02). */
  note: string | null
  tasks: BuildTaskView[]
  blockers: BuildBlockerView[]
  stories: BuildStoryView[]
  /** The tries of the final checks, in `verify`. */
  endAttempts: BuildAttemptView[]
  /** Whether Accept is offered: verify is green and nothing waits for the user (D10-11). */
  canAccept: boolean
}

/** How many red tries a task gets before it comes back to the user (D10-07). */
export const TRIES = 3

/** The phase in plain words. */
export const PHASE_LABELS: Record<BuildPhase, string> = {
  prepare: 'Getting ready',
  execute: 'Building',
  verify: 'Final checks',
  accepted: 'Accepted',
  stopped: 'Stopped',
}

/** A task's state in plain words. */
export const TASK_STATE_LABELS: Record<BuildTaskState, string> = {
  waiting: 'Waiting',
  ready: 'Ready',
  in_progress: 'Working',
  checking: 'Checking',
  done: 'Done',
  yours: 'Yours',
  blocked: 'Blocked',
  skipped: 'Skipped',
}

/**
 * The order the view lists the states in: what needs the user first, then what moves, then what
 * waits, then what is over.
 */
export const TASK_STATE_ORDER: readonly BuildTaskState[] = [
  'yours',
  'blocked',
  'in_progress',
  'checking',
  'ready',
  'waiting',
  'done',
  'skipped',
]

/** The last try of a task, or of anything that has tries. */
export function lastAttempt(attempts: readonly BuildAttemptView[]): BuildAttemptView | undefined {
  return attempts.reduce<BuildAttemptView | undefined>(
    (last, one) => (last === undefined || one.number > last.number ? one : last),
    undefined,
  )
}

/**
 * A task's state in the words the view says it in: "Done, not verified" for a task done by a
 * try no check judged.
 */
export function taskStateLabel(task: BuildTaskView): string {
  if (task.state === 'done' && lastAttempt(task.attempts)?.result === 'unverified') {
    return 'Done, not verified'
  }
  return TASK_STATE_LABELS[task.state]
}

/** The blocker still standing on a task, if the agent raised one and nobody dismissed it. */
export function openBlockerOf(
  task: BuildTaskView,
  blockers: readonly BuildBlockerView[],
): BuildBlockerView | undefined {
  return blockers.find((one) => one.taskId === task.id && one.dismissedAt === null)
}

/** Where a check ran, in words: the Workspace root, or the repository's path. */
export function placeLabel(place: string): string {
  return place === '' ? 'Workspace root' : place
}
