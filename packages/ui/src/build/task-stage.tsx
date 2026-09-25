import { type ReactNode, useId } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { TerminalOutput } from '../activity/terminal-output.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { IconFileDiff } from '../icons.ts'
import {
  type BuildAttemptView,
  type BuildCheckView,
  type BuildFileView,
  type BuildTaskState,
  type BuildTaskView,
  lastAttempt,
  placeLabel,
  taskStateLabel,
} from './model.ts'
import { taskTime, took, tryLabel } from './times.ts'

/**
 * The stage of one task of a build (D10-05, D10-12): what the Spec asks of it, and what was done
 * about it — every try, newest first, with its checks and the files it changed.
 *
 * The definition comes first because it is the contract the tries are judged against: the result
 * the task delivers, how it is verified, what it waits on and who does it. The tries follow, the
 * latest open: a try says where it stands (working, checking, green, red, not verified) and how
 * long it took, each check says where it ran and its verdict with the engine's short reason
 * (`64.2 < 70`, `exited with 1`) and folds its output's last lines under its line, and the files
 * it changed are listed per repository with the lines added and removed.
 *
 * What the stage cannot say about the task — that it is the user's, or that the agent says it
 * contradicts the Spec — is handed to it composed, and drawn under its head: those blocks carry
 * the actions, and the stage carries none.
 */

const STAGE = 'flex flex-col gap-6'

const HEAD = 'flex flex-col gap-1'

const TITLE_LINE = 'flex min-w-0 items-baseline gap-2'

const LABEL = 'shrink-0 font-mono text-sm text-muted-foreground'

const TITLE = 'min-w-0 text-lg font-medium'

const SUB = 'text-sm text-muted-foreground'

const SECTION = 'flex flex-col gap-3'

const SECTION_TITLE = 'text-xs font-medium tracking-wide text-muted-foreground'

const DEFINITION = 'flex flex-col gap-2 text-sm'

/** One term and what it says, side by side, the terms on one column. */
const PAIR = 'flex gap-4'

const TERM = 'w-24 shrink-0 text-muted-foreground'

const VALUE = 'min-w-0 flex-1'

const NOTE = 'text-sm text-muted-foreground'

const SKIPPED = 'flex flex-col gap-1 rounded-md border border-border bg-muted px-3 py-2 text-sm'

const TRIES = 'flex flex-col gap-2'

const TRY_LINE = 'flex min-w-0 items-center gap-2'

const TRY_NAME = 'font-medium text-foreground'

const TRY_TIME = 'text-xs text-muted-foreground'

const TRY_BODY = 'flex flex-col gap-4 pt-1'

const CHECKS = 'flex flex-col gap-1'

const CHECK_LINE = 'flex min-w-0 items-center gap-2'

const CHECK_NAME = 'shrink-0 font-medium text-foreground'

const CHECK_PLACE = 'min-w-0 truncate text-xs text-muted-foreground'

const CHECK_RED = 'shrink-0 font-mono text-xs text-destructive-muted-foreground'

const CHECK_QUIET = 'shrink-0 text-xs text-muted-foreground'

const RAN = 'mb-1 truncate font-mono text-xs text-muted-foreground'

const FILES = 'flex flex-col gap-2'

const FILES_HEAD = 'flex items-center gap-1.5 text-sm font-medium text-foreground'

const REPOSITORY = 'flex flex-col gap-1'

const REPOSITORY_NAME = 'text-xs text-muted-foreground'

const FILE = 'flex min-w-0 items-center gap-2 text-sm'

const PATH = 'min-w-0 flex-1 truncate font-mono text-xs'

const ADDED = 'shrink-0 font-mono text-xs text-success-muted-foreground'

const REMOVED = 'shrink-0 font-mono text-xs text-destructive-muted-foreground'

/** A state said as a word and the dot beside it. */
interface Standing {
  word: string
  tone: StatusTone
}

/** The tone a task's state wears on its badge. */
const STATE_TONES: Record<
  BuildTaskState,
  'neutral' | 'info' | 'success' | 'warning' | 'destructive'
> = {
  waiting: 'neutral',
  ready: 'neutral',
  in_progress: 'info',
  checking: 'info',
  done: 'success',
  yours: 'warning',
  blocked: 'destructive',
  skipped: 'neutral',
}

/** A task's state as a badge: "Done, not verified" wears the warning, since nothing judged it. */
export function TaskStateBadge({ task }: { task: BuildTaskView }): ReactNode {
  const said = taskStateLabel(task)
  const tone = said === 'Done, not verified' ? 'warning' : STATE_TONES[task.state]
  return <Badge tone={tone}>{said}</Badge>
}

/** Where a try stands, in a word and a dot. */
function standing(attempt: BuildAttemptView): Standing {
  if (attempt.result === 'green') return { word: 'Green', tone: 'success' }
  if (attempt.result === 'red') return { word: 'Red', tone: 'failure' }
  if (attempt.result === 'unverified') return { word: 'Not verified', tone: 'cancelled' }
  if (attempt.endedAt === null) return { word: 'Working', tone: 'running' }
  return { word: 'Checking', tone: 'running' }
}

const VERDICTS: Record<BuildCheckView['verdict'], Standing> = {
  green: { word: 'Green', tone: 'success' },
  red: { word: 'Red', tone: 'failure' },
  skipped: { word: 'Skipped', tone: 'cancelled' },
}

/**
 * One check of a try: its verdict, its name, where it ran and why it is red, on one line; the
 * line it ran and the last lines it printed under it, folded unless it is the red one to read.
 */
function CheckResult({ check, open }: { check: BuildCheckView; open: boolean }): ReactNode {
  const { word, tone } = VERDICTS[check.verdict]
  const place = placeLabel(check.place)
  return (
    <li>
      <Disclosure
        defaultOpen={open}
        summary={
          <span className={CHECK_LINE}>
            <StatusDot status={tone} label={word} />
            <span className={CHECK_NAME}>{check.name}</span>
            <span className={CHECK_PLACE}>{place}</span>
            {check.detail !== null && (
              <span className={check.verdict === 'red' ? CHECK_RED : CHECK_QUIET}>
                {check.detail}
              </span>
            )}
          </span>
        }
      >
        <p className={RAN}>{check.line}</p>
        {check.outputTail === '' ? (
          <p className={NOTE}>It printed nothing.</p>
        ) : (
          <TerminalOutput
            terminalId={`${check.name} on ${place}`}
            output={check.outputTail}
            released
            plain
          />
        )}
      </Disclosure>
    </li>
  )
}

/** What a file's letter means, for whatever reads the page rather than looks at it. */
const STATUS_WORDS = new Map([
  ['A', 'Added'],
  ['M', 'Modified'],
  ['D', 'Deleted'],
  ['R', 'Renamed'],
])

const STATUS_TONES = new Map<string, 'success' | 'info' | 'destructive'>([
  ['A', 'success'],
  ['M', 'info'],
  ['D', 'destructive'],
])

/** The repositories a try changed, in the order the files name them, each with its files. */
function byRepository(files: readonly BuildFileView[]): [string, BuildFileView[]][] {
  const groups = new Map<string, BuildFileView[]>()
  for (const file of files) {
    const group = groups.get(file.repository)
    if (group === undefined) groups.set(file.repository, [file])
    else group.push(file)
  }
  return [...groups]
}

/** The files a try changed, per repository, with the lines added and removed (D10-05). */
function FilesChanged({ files }: { files: readonly BuildFileView[] }): ReactNode {
  const said = useId()
  return (
    <div className={FILES}>
      <h4 id={said} className={FILES_HEAD}>
        <IconFileDiff size="sm" aria-hidden="true" />
        {`Files changed · ${String(files.length)}`}
      </h4>
      {byRepository(files).map(([repository, changed]) => (
        <div key={repository} className={REPOSITORY}>
          <p className={REPOSITORY_NAME}>{placeLabel(repository)}</p>
          <ul aria-label={`Files changed in ${placeLabel(repository)}`} className="flex flex-col">
            {changed.map((file) => (
              <li key={file.path} className={FILE}>
                <Badge tone={STATUS_TONES.get(file.status) ?? 'neutral'}>
                  <span aria-hidden="true">{file.status.slice(0, 1)}</span>
                  <span className="sr-only">{STATUS_WORDS.get(file.status.slice(0, 1))}</span>
                </Badge>
                <span className={PATH}>{file.path}</span>
                {file.added === null || file.removed === null ? (
                  <span className={CHECK_QUIET}>binary</span>
                ) : (
                  <>
                    <span className={ADDED}>{`+${String(file.added)}`}</span>
                    <span className={REMOVED}>{`−${String(file.removed)}`}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export interface BuildTriesProps {
  /** The tries, in any order: they are drawn newest first. */
  attempts: readonly BuildAttemptView[]
  now: string
  /** What the tries are of, for the names of their lists: `T2`, `the final checks`. */
  of: string
  /** What an ended try with no check says. */
  unchecked?: string | undefined
}

/**
 * Tries, newest first, the newest open: its checks, then the files it changed. Also the final
 * checks' tries, which have no files.
 */
export function BuildTries({
  attempts,
  now,
  of,
  unchecked = 'No check is configured: nothing judged this try.',
}: BuildTriesProps): ReactNode {
  const newest = lastAttempt(attempts)
  const ordered = attempts.toSorted((one, other) => other.number - one.number)
  return (
    <ol aria-label={`Tries of ${of}`} className={TRIES}>
      {ordered.map((attempt) => {
        const { word, tone } = standing(attempt)
        const latest = attempt === newest
        const time =
          attempt.endedAt === null
            ? `for ${took(attempt.startedAt, now)}`
            : `took ${took(attempt.startedAt, attempt.endedAt)}`
        return (
          <li key={attempt.id}>
            <Disclosure
              defaultOpen={latest}
              summary={
                <span className={TRY_LINE}>
                  <span className={TRY_NAME}>{tryLabel(attempt.number)}</span>
                  <StatusDot status={tone} label={word} />
                  <span className={TRY_TIME}>{`${word} · ${time}`}</span>
                </span>
              }
            >
              <div className={TRY_BODY}>
                {attempt.checks.length === 0 ? (
                  <p className={NOTE}>
                    {attempt.endedAt === null
                      ? 'The checks run once the agent says it finished.'
                      : attempt.result === 'unverified'
                        ? unchecked
                        : 'No check has answered yet.'}
                  </p>
                ) : (
                  <ul
                    aria-label={`Checks of ${tryLabel(attempt.number).toLowerCase()}`}
                    className={CHECKS}
                  >
                    {attempt.checks.map((check) => (
                      <CheckResult
                        key={check.id}
                        check={check}
                        open={latest && check.verdict === 'red'}
                      />
                    ))}
                  </ul>
                )}
                {attempt.files.length > 0 && <FilesChanged files={attempt.files} />}
              </div>
            </Disclosure>
          </li>
        )
      })}
    </ol>
  )
}

export interface TaskStageProps {
  task: BuildTaskView
  /** The caller's now, which every time of the stage is said from. */
  now: string
  /**
   * What stands under the head when the task needs the user: its `YoursBlock`, its
   * `BlockerBlock`, or why it waits on a blocked one.
   */
  attention?: ReactNode
}

export function TaskStage({ task, now, attention }: TaskStageProps): ReactNode {
  const heading = useId()
  const human = task.executor === 'human'
  // A human task that is the user's now is said whole by the block on top of it — what it
  // delivers, how it is checked, and that the agent does not do it — so the stage says it once.
  const saidOnTop = human && task.state === 'yours' && attention !== undefined
  return (
    <section aria-labelledby={heading} className={STAGE}>
      <header className={HEAD}>
        <div className={TITLE_LINE}>
          <span className={LABEL}>{task.label}</span>
          <h2 id={heading} className={TITLE}>
            {task.title}
          </h2>
          <TaskStateBadge task={task} />
        </div>
        <p className={SUB}>
          {task.attempts.length > 0 && task.state !== 'done'
            ? `${tryLabel(lastAttempt(task.attempts)?.number ?? 1)} · ${taskTime(task, now)}`
            : taskTime(task, now)}
        </p>
      </header>

      {attention}

      {task.state === 'skipped' && (
        <div className={SKIPPED}>
          <p>{`Skipped: ${task.skipReason ?? 'no reason given'}`}</p>
          <p className="text-muted-foreground">
            {task.skipUnblocks === true
              ? 'The tasks that depend on it go on without it.'
              : 'The tasks that depend on it wait.'}
          </p>
        </div>
      )}

      {!saidOnTop && (
        <>
          <div className={SECTION}>
            <h3 className={SECTION_TITLE}>What the Spec asks</h3>
            <dl className={DEFINITION}>
              {[
                ['Result', task.result],
                ['Criteria', task.criteria],
                ['Depends on', task.dependsOn.length === 0 ? 'Nothing' : task.dependsOn.join(', ')],
                ['Done by', human ? 'You' : 'The agent'],
              ].map(([term, value]) => (
                <div key={term} className={PAIR}>
                  <dt className={TERM}>{term}</dt>
                  <dd className={VALUE}>{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={SECTION}>
            <h3 className={SECTION_TITLE}>Tries</h3>
            {task.attempts.length === 0 ? (
              <p className={NOTE}>
                {human
                  ? 'Yours to do: the agent does not work on it and no check runs.'
                  : 'Not started yet.'}
              </p>
            ) : (
              <BuildTries attempts={task.attempts} now={now} of={task.label} />
            )}
          </div>
        </>
      )}
    </section>
  )
}
