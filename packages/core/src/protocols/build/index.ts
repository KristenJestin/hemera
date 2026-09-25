/**
 * The `build` protocol (D10-01) and its text side: the briefs Hemera hands a `build` Session's
 * agent — at `prepare`, with each ready set in `execute`, after a pause or a restart, and at
 * `verify` (D10-02, D10-03, D10-09).
 *
 * The inputs are plain data the engine fills from its rows: nothing here reads the database or
 * decides a state. The text is the agent's, so it may use the engine's words — task, attempt,
 * ready — which the user interface never shows.
 */

import type {
  ActiveBuildPhase,
  AttemptResult,
  ChangedFile,
  CheckVerdict,
  TaskState,
} from '../../domain/build.ts'
import type { MissionProtocol, SpecSnapshot, TaskExecutor } from '../../domain/spec.ts'
import { renderSpecMarkdown } from '../define/index.ts'
import { BUILD_MISSION_BRIEF, BUILD_PHASE_BRIEFS } from './briefs.ts'

export { BUILD_MISSION_BRIEF, BUILD_PHASE_BRIEFS } from './briefs.ts'

/**
 * The `build` protocol, v1 (D10-01): `prepare`, then `execute`, then `verify`, each waiting for
 * the one before; `accepted` and `stopped` close the build and are no phase of it.
 */
export const BUILD_PROTOCOL: MissionProtocol<ActiveBuildPhase> = {
  version: 1,
  phases: [
    { id: 'prepare', dependsOn: [], available: true },
    { id: 'execute', dependsOn: ['prepare'], available: true },
    { id: 'verify', dependsOn: ['execute'], available: true },
  ],
}

/** One check's result, as a brief tells it. */
export interface BriefCheck {
  readonly name: string
  /** Where it ran: `''` for the Workspace root, or the repository's path. */
  readonly place: string
  readonly verdict: CheckVerdict
  /** Why it is red: `exited with 1`, `64.2 < 70`…; null otherwise. */
  readonly detail: string | null
  /** The last lines of its output, as kept. */
  readonly outputTail: string
}

/** One file an attempt changed, and the repository it is in (`''` for one at the root). */
export interface BriefFile extends ChangedFile {
  readonly repository: string
}

/** One attempt, as a brief tells it: its number, how it ended, what it changed and its checks. */
export interface BriefAttempt {
  /** 1-based, per task, per story or for the build. */
  readonly number: number
  /**
   * Whether its work is over: a task's try ends when the agent says it finished it, and is then
   * being checked until its result comes; a try not ended is running.
   */
  readonly ended: boolean
  /** Null until it is judged. */
  readonly result: AttemptResult | null
  readonly files: readonly BriefFile[]
  readonly checks: readonly BriefCheck[]
}

/** Where a repository stood when the attempt in progress started: its snapshot tree (D10-05). */
export interface BriefSnapshot {
  readonly repository: string
  readonly tree: string
}

/** One contractual task, with its definition and where it stands in the build. */
export interface BriefTask {
  readonly label: string
  readonly title: string
  readonly result: string
  readonly criteria: string
  readonly type: string
  readonly executor: TaskExecutor
  readonly state: TaskState
  /** The labels of the tasks it depends on. */
  readonly dependsOn: readonly string[]
  /** The titles of the stories it covers. */
  readonly covers: readonly string[]
  /** Oldest first. */
  readonly attempts: readonly BriefAttempt[]
  /** The start of the attempt in progress, per repository; empty when none runs. */
  readonly snapshots: readonly BriefSnapshot[]
  /** Why it was skipped, or why the agent said it contradicts the Spec; null otherwise. */
  readonly reason: string | null
}

/** A red attempt on a story's checks, or on the end checks when `story` is null (D10-07). */
export interface BriefFailure {
  readonly story: string | null
  readonly attempt: BriefAttempt
}

/** A blocker the user dismissed: the task is ready again, to carry out as the Spec says. */
export interface BriefBlocker {
  readonly label: string
  readonly title: string
  readonly reason: string
}

/**
 * What a brief of a build is composed from, by kind:
 *
 * - `prepare`: the pinned revision and the label of each of its tasks, by task id;
 * - `execute`: the ready set, each task with its attempts so a red one carries its failures, the
 *   red attempts of stories and of the build not told yet, and the blockers the user dismissed;
 * - `resume`: the phase the build stands in, the Spec, every task with its state, attempts and
 *   snapshots, the ready set and the failures still to address;
 * - `verify`: the red attempt on the end checks, if any.
 */
export type BuildBriefInput =
  | {
      readonly kind: 'prepare'
      readonly snapshot: SpecSnapshot
      readonly labels: ReadonlyMap<string, string>
    }
  | {
      readonly kind: 'execute'
      readonly ready: readonly BriefTask[]
      readonly failures: readonly BriefFailure[]
      readonly dismissed: readonly BriefBlocker[]
    }
  | {
      readonly kind: 'resume'
      readonly phase: Exclude<ActiveBuildPhase, 'prepare'>
      readonly snapshot: SpecSnapshot
      readonly labels: ReadonlyMap<string, string>
      readonly tasks: readonly BriefTask[]
      readonly ready: readonly BriefTask[]
      readonly failures: readonly BriefFailure[]
    }
  | {
      readonly kind: 'verify'
      readonly failures: readonly BriefFailure[]
    }

/** A text in a code fence longer than any run of backticks in it. */
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}\n${text.trimEnd()}\n${fence}`
}

function placeOf(place: string): string {
  return place === '' ? 'the Workspace root' : place
}

/** The red checks of an attempt: each one's name, where it ran, why, and its output's end. */
function redChecks(attempt: BriefAttempt): string[] {
  return attempt.checks
    .filter((check) => check.verdict === 'red')
    .flatMap((check) => [
      `- ${check.name}, in ${placeOf(check.place)}: ${check.detail ?? 'red'}`,
      fenced(check.outputTail),
    ])
}

/** The verdict of each check of an attempt, on one line. */
function verdicts(attempt: BriefAttempt): string {
  if (attempt.checks.length === 0) return 'no check'
  return attempt.checks
    .map((check) => `${check.name} ${check.verdict} in ${placeOf(check.place)}`)
    .join('; ')
}

/** The files an attempt changed, per repository, with the lines added and removed. */
function filesChanged(attempt: BriefAttempt): string {
  if (attempt.files.length === 0) return 'none'
  return attempt.files
    .map((file) => {
      const lines = file.added === null ? 'binary' : `+${file.added} -${file.removed ?? 0}`
      return `${placeOf(file.repository)}: ${file.path} (${file.status} ${lines})`
    })
    .join('; ')
}

/**
 * A task's whole definition, and the failures of its last ended attempt when it was red — the
 * attempt that follows may already be open, and it is those failures it is there to address.
 */
function definition(task: BriefTask): string {
  const facts = [`Type: ${task.type}`]
  if (task.dependsOn.length > 0) facts.push(`Depends on: ${task.dependsOn.join(', ')}`)
  if (task.covers.length > 0) facts.push(`Covers: ${task.covers.join(', ')}`)
  const lines = [
    `## ${task.label} · ${task.title}`,
    facts.join(' · '),
    `Result: ${task.result}`,
    `Criteria: ${task.criteria}`,
  ]
  const last = task.attempts.findLast((attempt) => attempt.result !== null)
  if (last?.result === 'red') {
    lines.push(
      '',
      `Attempt ${last.number} was red. Address these failures, then call task_finished again:`,
      ...redChecks(last),
    )
  }
  return lines.join('\n')
}

function readyText(ready: readonly BriefTask[]): string {
  if (ready.length === 0) {
    return '# Tasks handed now\n\nNo task is ready for you now: wait for the next message.'
  }
  const labels = ready.map((task) => task.label).join(', ')
  return [
    `# Tasks handed now\n\nEvery task ready now, handed at once: ${labels}.`,
    ...ready.map(definition),
  ].join('\n\n')
}

function failuresText(failures: readonly BriefFailure[]): string {
  const parts = failures.map(({ story, attempt }) => {
    const whose = story === null ? 'The end checks' : `The checks of the story "${story}"`
    return [
      `## ${whose}: attempt ${attempt.number} was red`,
      'Fix them without changing the Spec; no task changes state.',
      ...redChecks(attempt),
    ].join('\n')
  })
  return ['# Failures to address', ...parts].join('\n\n')
}

function dismissedText(dismissed: readonly BriefBlocker[]): string {
  const lines = dismissed.map(
    (blocker) =>
      `- ${blocker.label} · ${blocker.title}: you said "${blocker.reason}". The user dismissed it: carry the task out as the Spec says.`,
  )
  return ['# Blockers the user dismissed', ...lines].join('\n')
}

/** Where every task stands, for an agent that starts over: evidence, attempts, and the rest. */
function standingText(tasks: readonly BriefTask[]): string {
  const parts = ['# Where the build stands']
  const done = tasks.filter((task) => task.state === 'done')
  if (done.length > 0) {
    parts.push(
      [
        '## Done',
        ...done.map((task) => {
          const last = task.attempts.at(-1)
          if (last === undefined) return `- ${task.label} · ${task.title}: done by the user`
          const verified = last.result === 'unverified' ? 'done, not verified' : 'done'
          return [
            `- ${task.label} · ${task.title}: ${verified}, attempt ${last.number}`,
            `  Files changed: ${filesChanged(last)}`,
            `  Checks: ${verdicts(last)}`,
          ].join('\n')
        }),
      ].join('\n'),
    )
  }
  const working = tasks.filter((task) => task.state === 'in_progress' || task.state === 'checking')
  if (working.length > 0) {
    parts.push(
      [
        '## In progress',
        ...working.map((task) => {
          const tries = task.attempts.map((attempt) =>
            attempt.result === null
              ? `  Attempt ${attempt.number}: ${attempt.ended ? 'finished, being checked by Hemera' : 'running'}`
              : `  Attempt ${attempt.number}: ${attempt.result}; files changed: ${filesChanged(attempt)}; checks: ${verdicts(attempt)}`,
          )
          const trees = task.snapshots.map(
            (snapshot) =>
              `  Recorded state of ${placeOf(snapshot.repository)} at the start of the attempt in progress: tree ${snapshot.tree}`,
          )
          const checking =
            task.state === 'checking' ? ' — you called task_finished; Hemera is checking it' : ''
          return [`- ${task.label} · ${task.title}${checking}`, ...tries, ...trees].join('\n')
        }),
      ].join('\n'),
    )
  }
  const others: readonly (readonly [TaskState, string])[] = [
    ['yours', 'The user’s'],
    ['blocked', 'Blocked'],
    ['skipped', 'Skipped'],
  ]
  for (const [state, heading] of others) {
    const held = tasks.filter((task) => task.state === state)
    if (held.length === 0) continue
    const lines = held.map((task) => {
      const why =
        state === 'yours'
          ? task.executor === 'human'
            ? 'carried out by a human'
            : 'three red attempts, handed to the user'
          : (task.reason ?? '')
      return `- ${task.label} · ${task.title}${why === '' ? '' : `: ${why}`}`
    })
    parts.push([`## ${heading}`, ...lines].join('\n'))
  }
  return parts.join('\n\n')
}

/** What an agent that starts over must do before anything else (D10-09). */
const INSPECT_FIRST = `# Before you continue

Your previous work may have been interrupted — by a pause, a restart or a crash — possibly in the middle of a write. Inspect the real state of the Workspace before redoing anything: run \`git status\`, and read the files the tasks in progress touch; \`git diff <tree>\` in a repository shows what changed since a recorded state. Never assume a write happened, nor that it did not: what you do not find is not done, and what you find is not to be done twice.`

/**
 * The brief of a build (D10-02, D10-03, D10-07, D10-09), handed to its agent as a delivery:
 *
 * - `prepare`: the mission, the `prepare` brief and the Spec with the task labels;
 * - `execute`: the `execute` brief, then the whole ready set with each task's definition and the
 *   failures of its red attempt, the failures of stories and of the build, and the blockers the
 *   user dismissed;
 * - `resume`: the mission, the brief of the phase the build stands in and the Spec, where every
 *   task stands with its evidence, the instruction to inspect the real state first, then the
 *   ready set and the failures still to address;
 * - `verify`: the `verify` brief and the failures of the end checks.
 */
export function composeBuildBrief(input: BuildBriefInput): string {
  switch (input.kind) {
    case 'prepare':
      return [
        BUILD_MISSION_BRIEF,
        BUILD_PHASE_BRIEFS.prepare,
        `# The Spec\n\n${renderSpecMarkdown(input.snapshot, input.labels)}`,
      ].join('\n\n')
    case 'execute': {
      const parts = [BUILD_PHASE_BRIEFS.execute, readyText(input.ready)]
      if (input.failures.length > 0) parts.push(failuresText(input.failures))
      if (input.dismissed.length > 0) parts.push(dismissedText(input.dismissed))
      return parts.join('\n\n')
    }
    case 'resume': {
      const parts = [
        BUILD_MISSION_BRIEF,
        BUILD_PHASE_BRIEFS[input.phase],
        `# The Spec\n\n${renderSpecMarkdown(input.snapshot, input.labels)}`,
        standingText(input.tasks),
        INSPECT_FIRST,
      ]
      if (input.phase === 'execute') parts.push(readyText(input.ready))
      if (input.failures.length > 0) parts.push(failuresText(input.failures))
      return parts.join('\n\n')
    }
    case 'verify': {
      const parts = [BUILD_PHASE_BRIEFS.verify]
      if (input.failures.length > 0) parts.push(failuresText(input.failures))
      return parts.join('\n\n')
    }
  }
}
