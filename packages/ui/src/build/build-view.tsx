import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { IconCheck, IconFileDescription, IconPlayerPause, IconPlayerPlay } from '../icons.ts'
import { AgentText } from '../message/agent-text.tsx'
import { BlockerBlock } from './blocker-block.tsx'
import {
  type BuildStoryState,
  type BuildTaskState,
  type BuildTaskView,
  type BuildViewData,
  PHASE_LABELS,
  TASK_STATE_LABELS,
  TASK_STATE_ORDER,
  lastAttempt,
  openBlockerOf,
} from './model.ts'
import { StopBuild } from './stop-build.tsx'
import { BuildTries, TaskStage } from './task-stage.tsx'
import { ago, taskTime, tryLabel } from './times.ts'
import { YoursBlock } from './yours-block.tsx'

/**
 * The build view (D10-12): what a `build` Session shows at its centre, the larger part of the
 * page, while the chat stands narrow beside it.
 *
 * A head that says where the build stands in plain words — Getting ready, Building, Final checks,
 * Accepted, Stopped, or Paused — how many tasks are done, where the stories stand, and what can be
 * done with it: Pause or Resume, Accept once the final checks are green and nothing waits for the
 * user (D10-11), Stop build, and "Spec", which opens the frozen Spec beside it, read only. Under
 * it the agent's approach (D10-02), and a waiting line while the agent has not written it.
 *
 * Then the tasks, grouped by state — what needs the user first (Yours, Blocked), then what moves
 * (Working, Checking), what waits (Ready, Waiting), and what is over (Done, Skipped) — each row
 * its label, its title and the one time its state says. A row puts its task on the stage beside
 * the list: its definition, its tries, their checks and the files they changed; and on top of it,
 * when the task needs the user, the block that answers it. The final checks are an entry of their
 * own once the build is in them.
 *
 * Everything is handed over and every act is reported: the view holds what is on the stage and
 * nothing else. It never reads a clock: `now` is its caller's.
 */

const VIEW = 'flex h-full min-h-0 min-w-0 flex-col bg-surface-content'

const HEAD = 'flex flex-col gap-2 border-b border-border px-6 pt-5 pb-4'

const HEAD_LINE = 'flex min-w-0 items-center gap-3'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 truncate text-xl font-medium'

const ACTIONS = 'ml-auto flex shrink-0 items-center gap-2'

const STATE_LINE = 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm'

const PHASE = 'flex items-center gap-1.5 font-medium text-foreground'

const QUIET = 'text-muted-foreground'

const STORIES = 'flex flex-wrap items-center gap-1'

/** The one sentence of a build that is paused, over, or stopped, under its head. */
const BAND = 'border-b px-6 py-2 text-sm'

const BANDS = {
  paused: 'border-warning/40 bg-warning-muted text-warning-muted-foreground',
  accepted: 'border-success/40 bg-success-muted text-success-muted-foreground',
  stopped: 'border-border bg-muted text-muted-foreground',
} as const

const APPROACH = 'border-b border-border px-5 py-2'

const APPROACH_LINE = 'flex items-center gap-2 text-sm'

const APPROACH_BODY = 'max-h-48 overflow-y-auto pr-2'

const WAITING = 'flex items-center gap-2 px-1 py-0.5 text-sm text-muted-foreground'

const BODY = 'flex min-h-0 flex-1'

const LIST = 'flex w-build-list shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-3'

const GROUP = 'flex flex-col gap-0.5'

const GROUP_HEAD = 'flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground'

const ROW =
  'relative flex h-control-sm w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-muted-foreground outline-none focus-ring hover:bg-accent hover:text-foreground'

const ROW_CURRENT =
  'bg-accent text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary'

/** The rows that need the user, tinted as the rail tints what is to review or in conflict. */
const ROW_TINTS: Partial<Record<BuildTaskState, string>> = {
  yours: 'bg-warning/15',
  blocked: 'bg-destructive/15',
}

const ROW_LABEL = 'shrink-0 font-mono text-xs'

const ROW_TITLE = 'min-w-0 flex-1 truncate'

const ROW_TIME = 'shrink-0 text-xs text-muted-foreground'

const STAGE = 'min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6 outline-none focus-ring'

const HINT = 'text-sm text-muted-foreground'

const WAITS = 'text-sm text-muted-foreground'

/** The entry of the final checks, which stands among the tasks' ids. */
export const FINAL_CHECKS_ENTRY = 'final-checks'

/** A state said as a word and the dot beside it. */
interface Standing {
  word: string
  tone: StatusTone
}

const STORY_WORDS: Record<
  BuildStoryState,
  { word: string; tone: 'neutral' | 'info' | 'success' | 'destructive' }
> = {
  open: { word: 'open', tone: 'neutral' },
  checking: { word: 'checking', tone: 'info' },
  green: { word: 'verified', tone: 'success' },
  red: { word: 'red', tone: 'destructive' },
}

/** How a finished try of the final checks is said on its row. */
const RESULT_WORDS = { green: 'green', red: 'red', unverified: 'not verified' } as const

/** Where the build stands, as a dot and a word: paused wins over the phase it paused in. */
function phaseOf(build: BuildViewData): Standing {
  if (build.pausedAt !== null && !closed(build)) return { word: 'Paused', tone: 'pending' }
  const tones: Record<BuildViewData['phase'], StatusTone> = {
    prepare: 'running',
    execute: 'running',
    verify: 'running',
    accepted: 'success',
    stopped: 'cancelled',
  }
  return { word: PHASE_LABELS[build.phase], tone: tones[build.phase] }
}

/** Whether the build is over: accepted or stopped, readable, and nothing runs in it any more. */
function closed(build: BuildViewData): boolean {
  return build.phase === 'accepted' || build.phase === 'stopped'
}

/** The tasks that wait on `label`, directly or through another. */
export function dependantsOf(label: string, tasks: readonly BuildTaskView[]): string[] {
  const found: string[] = []
  const walk = (of: string) => {
    for (const task of tasks) {
      if (task.dependsOn.includes(of) && !found.includes(task.label)) {
        found.push(task.label)
        walk(task.label)
      }
    }
  }
  walk(label)
  return found
}

/**
 * What is on the stage when nothing was chosen: what needs the user, then the final checks once
 * the build is in them, then what is being worked on.
 */
function firstShown(build: BuildViewData): string | null {
  const needs = build.tasks.find(
    (task) =>
      task.state === 'yours' ||
      (task.state === 'blocked' && openBlockerOf(task, build.blockers) !== undefined),
  )
  if (needs !== undefined && !closed(build)) return needs.id
  if (build.phase === 'verify' || build.endAttempts.length > 0) return FINAL_CHECKS_ENTRY
  const moving = build.tasks.find(
    (task) => task.state === 'in_progress' || task.state === 'checking',
  )
  return moving?.id ?? build.tasks[0]?.id ?? null
}

/** The one line under the title: the phase, the tasks done, the stories. */
function StateLine({ build, now }: { build: BuildViewData; now: string }): ReactNode {
  const { word, tone } = phaseOf(build)
  const done = build.tasks.filter((task) => task.state === 'done').length
  const final = lastAttempt(build.endAttempts)
  return (
    <div className={STATE_LINE}>
      <span className={PHASE}>
        <StatusDot status={tone} />
        {word}
      </span>
      <span className={QUIET}>{`${String(done)} of ${String(build.tasks.length)} tasks done`}</span>
      {build.phase === 'verify' && final !== undefined && (
        <span className={QUIET}>
          {final.result === 'green'
            ? 'final checks green'
            : `final checks on ${tryLabel(final.number).toLowerCase()}`}
        </span>
      )}
      {build.pausedAt !== null && !closed(build) && (
        <span className={QUIET}>{`since ${ago(build.pausedAt, now)}`}</span>
      )}
      {build.stories.length > 0 && (
        <ul aria-label="Stories" className={STORIES}>
          {build.stories.map((story) => {
            const said = STORY_WORDS[story.state]
            return (
              <li key={story.id}>
                <Badge tone={said.tone}>
                  <span aria-hidden="true">{`${story.key} · ${said.word}`}</span>
                  <span className="sr-only">{`${story.key} ${story.title}: ${said.word}`}</span>
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The sentence of a build that is paused, accepted or stopped. */
function Band({ build }: { build: BuildViewData }): ReactNode {
  if (build.phase === 'accepted') {
    return (
      <p role="status" className={cn(BAND, BANDS.accepted)}>
        Accepted. The branch and the files stay in the Workspace; delivering them comes next.
      </p>
    )
  }
  if (build.phase === 'stopped') {
    return (
      <p role="status" className={cn(BAND, BANDS.stopped)}>
        {`Stopped. ${build.detail ?? ''} The build stays readable; nothing runs in it any more.`}
      </p>
    )
  }
  if (build.pausedAt !== null) {
    return (
      <p role="status" className={cn(BAND, BANDS.paused)}>
        Paused. The agent finished what it was doing; nothing new starts until you resume.
      </p>
    )
  }
  return null
}

/** The agent's approach, or the line that waits for it (D10-02, L2). */
function Approach({ build }: { build: BuildViewData }): ReactNode {
  if (build.note === null) {
    return (
      <div className={APPROACH}>
        <p className={WAITING}>
          {closed(build) ? (
            'The agent wrote no approach.'
          ) : (
            <>
              <StatusDot status="running" />
              Waiting for the agent's approach: no task starts before it.
            </>
          )}
        </p>
      </div>
    )
  }
  const started = build.tasks.some((task) => task.startedAt !== null)
  return (
    <div className={APPROACH}>
      <Disclosure defaultOpen={!started} summary={<span className={APPROACH_LINE}>Approach</span>}>
        <div className={APPROACH_BODY}>
          <AgentText text={build.note} />
        </div>
      </Disclosure>
    </div>
  )
}

export interface BuildViewProps {
  build: BuildViewData
  /** The caller's now, which every time of the view is said from. */
  now: string
  /**
   * The task on the stage, by its build task id, or `FINAL_CHECKS_ENTRY`; for a caller that keeps it.
   * Left out, the view holds it, and opens on what needs the user first.
   */
  selected?: string | undefined
  onSelect?: ((id: string) => void) | undefined
  /** Whether the frozen Spec is open beside the view, which its button says. */
  specOpen?: boolean | undefined
  /** Opens or closes the frozen Spec beside the view. */
  onToggleSpec: () => void
  onPause: () => void
  onResume: () => void
  onAccept: () => void
  onStop: () => void
  /** A task that was the user's is done. */
  onTaskDone: (taskId: string) => void
  /** A task that was the user's is skipped, with the reason and whether its dependants go on. */
  onTaskSkip: (taskId: string, reason: string, unblock: boolean) => void
  /** The Spec stands: the blocked task goes back to ready. */
  onDismissBlocker: (blockerId: string) => void
}

export function BuildView({
  build,
  now,
  selected,
  onSelect,
  specOpen = false,
  onToggleSpec,
  onPause,
  onResume,
  onAccept,
  onStop,
  onTaskDone,
  onTaskSkip,
  onDismissBlocker,
}: BuildViewProps): ReactNode {
  const [chosen, setChosen] = useState<string | null>(() => firstShown(build))
  const shown = selected ?? chosen
  const over = closed(build)
  const paused = build.pausedAt !== null
  const list = useRef<HTMLDivElement>(null)
  const stageSaid = useId()

  const choose = (id: string) => {
    setChosen(id)
    onSelect?.(id)
  }

  /** Moves the keyboard to another row, without choosing it: Enter does that. */
  function walk(event: KeyboardEvent<HTMLDivElement>): void {
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-row]') ?? [])]
    const at = rows.findIndex((row) => row === document.activeElement)
    if (at === -1) return
    const last = rows.length - 1
    const moves = new Map([
      ['ArrowDown', Math.min(at + 1, last)],
      ['ArrowUp', Math.max(at - 1, 0)],
      ['Home', 0],
      ['End', last],
    ])
    const next = moves.get(event.key)
    if (next === undefined) return
    event.preventDefault()
    rows[next]?.focus()
  }

  const groups = TASK_STATE_ORDER.map((state) => ({
    state,
    tasks: build.tasks.filter((task) => task.state === state),
  })).filter((group) => group.tasks.length > 0)
  const finals = build.phase === 'verify' || build.endAttempts.length > 0
  // One stop of the tab order: the row on the stage, or the first one when none is.
  const ids = [...groups.flatMap((group) => group.tasks.map((task) => task.id))]
  if (finals) ids.push(FINAL_CHECKS_ENTRY)
  const stop = shown !== null && ids.includes(shown) ? shown : ids[0]

  const task = build.tasks.find((one) => one.id === shown)

  /** What stands on top of a task's stage when it needs the user. */
  function attentionOf(on: BuildTaskView): ReactNode {
    if (over) return null
    if (on.state === 'yours') {
      return (
        <YoursBlock
          task={on}
          dependants={dependantsOf(on.label, build.tasks)}
          onDone={() => onTaskDone(on.id)}
          onSkip={(reason, unblock) => onTaskSkip(on.id, reason, unblock)}
        />
      )
    }
    if (on.state !== 'blocked') return null
    const blocker = openBlockerOf(on, build.blockers)
    if (blocker !== undefined) {
      return (
        <BlockerBlock
          blocker={blocker}
          specKey={build.specKey}
          now={now}
          suspended={dependantsOf(on.label, build.tasks)}
          onDismiss={() => onDismissBlocker(blocker.id)}
          onStop={onStop}
        />
      )
    }
    const holding = build.blockers
      .filter((one) => one.dismissedAt === null)
      .filter((one) => dependantsOf(one.label, build.tasks).includes(on.label))
      .map((one) => one.label)
    return (
      <p className={WAITS}>
        {`Waits on ${holding.join(', ')}, which the agent says contradicts the Spec.`}
      </p>
    )
  }

  const row = (id: string, content: ReactNode, name: string, state?: BuildTaskState) => {
    const on = id === shown
    return (
      <li key={id} className="flex">
        <button
          type="button"
          data-row
          tabIndex={id === stop ? 0 : -1}
          aria-current={on ? 'true' : undefined}
          aria-label={name}
          className={cn(ROW, state !== undefined && ROW_TINTS[state], on && ROW_CURRENT)}
          onClick={() => choose(id)}
        >
          {content}
        </button>
      </li>
    )
  }

  const final = lastAttempt(build.endAttempts)

  return (
    <div className={VIEW}>
      <header className={HEAD}>
        <div className={HEAD_LINE}>
          <span className={KEY}>{build.specKey}</span>
          <h1 className={TITLE}>{build.specTitle}</h1>
          <div className={ACTIONS}>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={specOpen}
              // What the page gives the keyboard back to once the Spec it opened is closed.
              data-spec-toggle
              onClick={onToggleSpec}
            >
              <IconFileDescription size="sm" />
              Spec
            </Button>
            {!over && build.canAccept && (
              <Button variant="primary" size="sm" onClick={onAccept}>
                <IconCheck size="sm" />
                Accept
              </Button>
            )}
            {!over && !build.canAccept && paused && (
              <Button variant="primary" size="sm" onClick={onResume}>
                <IconPlayerPlay size="sm" />
                Resume
              </Button>
            )}
            {!over && !build.canAccept && !paused && (
              <Button variant="secondary" size="sm" onClick={onPause}>
                <IconPlayerPause size="sm" />
                Pause
              </Button>
            )}
            {!over && <StopBuild specKey={build.specKey} onStop={onStop} />}
          </div>
        </div>
        <StateLine build={build} now={now} />
      </header>
      <Band build={build} />
      <Approach build={build} />
      <div className={BODY}>
        <div ref={list} role="navigation" aria-label="Tasks" className={LIST} onKeyDown={walk}>
          {groups.map((group) => (
            <div
              key={group.state}
              role="group"
              aria-label={`${TASK_STATE_LABELS[group.state]}, ${String(group.tasks.length)}`}
              className={GROUP}
            >
              <p aria-hidden="true" className={GROUP_HEAD}>
                {`${TASK_STATE_LABELS[group.state]} · ${String(group.tasks.length)}`}
              </p>
              <ul className="flex flex-col">
                {group.tasks.map((one) =>
                  row(
                    one.id,
                    <>
                      <span className={ROW_LABEL}>{one.label}</span>
                      <span className={ROW_TITLE}>{one.title}</span>
                      <span className={ROW_TIME}>{taskTime(one, now)}</span>
                    </>,
                    `${one.label} ${one.title}, ${taskTime(one, now)}`,
                    one.state,
                  ),
                )}
              </ul>
            </div>
          ))}
          {finals && (
            <div role="group" aria-label="Final checks" className={GROUP}>
              <p aria-hidden="true" className={GROUP_HEAD}>
                Final checks
              </p>
              <ul className="flex flex-col">
                {row(
                  FINAL_CHECKS_ENTRY,
                  <>
                    <span className={ROW_TITLE}>The whole Spec</span>
                    <span className={ROW_TIME}>
                      {final === undefined
                        ? 'not run yet'
                        : final.result === null
                          ? tryLabel(final.number).toLowerCase()
                          : RESULT_WORDS[final.result]}
                    </span>
                  </>,
                  'Final checks of the whole Spec',
                )}
              </ul>
            </div>
          )}
        </div>
        <div role="region" aria-labelledby={stageSaid} tabIndex={0} className={STAGE}>
          <span id={stageSaid} className="sr-only">
            {task !== undefined
              ? `Stage of ${task.label}`
              : shown === FINAL_CHECKS_ENTRY
                ? 'Stage of the final checks'
                : 'Stage'}
          </span>
          {task !== undefined ? (
            <TaskStage task={task} now={now} attention={attentionOf(task)} />
          ) : shown === FINAL_CHECKS_ENTRY ? (
            <FinalChecks build={build} now={now} />
          ) : (
            <p className={HINT}>
              Pick a task to see its tries, their checks and the files they changed.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** The final checks of the whole Spec (D10-07, L7): their tries, as a task's are drawn. */
function FinalChecks({ build, now }: { build: BuildViewData; now: string }): ReactNode {
  return (
    <section aria-label="Final checks" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Final checks</h2>
        <p className="text-sm text-muted-foreground">
          Run once every task is done, on the whole Workspace. A red one hands the agent its
          failures; three red tries come back to you.
        </p>
      </header>
      {build.endAttempts.length === 0 ? (
        <p className={HINT}>They run once every task is done.</p>
      ) : (
        <BuildTries
          attempts={build.endAttempts}
          now={now}
          of="the final checks"
          unchecked="No final check is configured: nothing judged the whole Spec."
        />
      )}
    </section>
  )
}
