import { cn } from 'cn'
import { type ReactNode, useId, useState } from 'react'

import { Disclosure } from '../activity/disclosure.tsx'
import { Button } from '../components/button/button.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { IconCheck, IconFileDescription, IconPlayerPause, IconPlayerPlay } from '../icons.ts'
import { AgentText } from '../message/agent-text.tsx'
import type { StoryView } from '../spec/model.ts'
import { BlockerBlock } from './blocker-block.tsx'
import {
  type BuildBlockerView,
  type BuildStoryProgress,
  type BuildStoryRow,
  type BuildTaskView,
  type BuildViewData,
  PHASE_LABELS,
  STORY_PROGRESS_LABELS,
  lastAttempt,
  openBlockerOf,
  storyRowsOf,
  taskStateLabel,
} from './model.ts'
import { StopBuild } from './stop-build.tsx'
import { BuildTries, TaskStage } from './task-stage.tsx'
import { ago, taskTime, tryLabel } from './times.ts'
import { YoursBlock } from './yours-block.tsx'

/**
 * The build view: the Spec annotated with the build's progress (issue #116).
 *
 * The head is the Spec, where the build stands in words, and the one Stop build there is: the panel
 * is the only place a build is answered from, so its Stop is the only one, and a blocker carries
 * none of its own. Under it the stories of the Spec, in the Spec's own order, each with the words
 * it was written with, the criteria it is judged on, and where it stands — said by the tasks the
 * build split it into, and by nothing else. Those tasks are one unfold away, and a task unfolds the
 * stage 5a drew: its tries, the checks each try ran and their result, and the files it changed.
 * The checks of the whole Spec come last, when the build reaches them.
 *
 * The chat says what is being done, the panel says what the Spec is now (D10-02): nothing here is
 * read from the chat — the story, its criteria and its progress are the frozen Spec's and the
 * build's own.
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

const BODY =
  'flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 outline-none focus-ring'

const STORIES = 'flex flex-col gap-6'

/** One story of the Spec, and under it what the build made of it. */
const STORY = 'flex min-w-0 flex-col gap-2'

const STORY_HEAD = 'flex min-w-0 items-center gap-2'

const STORY_KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const STORY_TITLE = 'min-w-0 text-base font-medium'

/** Where the story stands, pushed to the end of its line. */
const STORY_WORD = 'ml-auto shrink-0 text-xs text-muted-foreground'

const NARRATIVE = 'text-sm text-muted-foreground'

const CRITERIA = 'flex list-disc flex-col gap-0.5 pl-5 text-sm'

/** The line that unfolds a story's tasks, and the tasks' owns. */
const TASKS = 'text-sm text-muted-foreground'

const TASK = 'flex min-w-0 flex-1 items-center gap-2'

const TASK_LABEL = 'shrink-0 font-mono text-xs'

const TASK_TITLE = 'min-w-0 flex-1 truncate'

const TASK_META = 'shrink-0 text-xs text-muted-foreground'

/** Where a story stands, as the one dot its line wears. */
const PROGRESS_TONES: Record<BuildStoryProgress, StatusTone> = {
  todo: 'pending',
  in_progress: 'running',
  done: 'success',
  blocked: 'failure',
}

const HINT = 'text-sm text-muted-foreground'

const WAITS = 'text-sm text-muted-foreground'

/** A state said as a word and the dot beside it. */
interface Standing {
  word: string
  tone: StatusTone
}

/** Where the build stands, as a dot and a word: paused wins over the phase it paused in. */
function phaseOf(build: BuildViewData): Standing {
  if (build.pausedAt !== null && !closed(build)) return { word: 'Paused', tone: 'pending' }
  // Everything is done and green, and nothing moves until the user accepts: the build is not
  // building any more, it is waiting for the review it is owed (issue #116).
  if (build.canAccept && !closed(build)) {
    return { word: 'Waiting for your review', tone: 'success' }
  }
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
 * What the view unfolds when nothing was chosen: what needs the user, then what is being worked
 * on, then the first task of the build. Nothing once the build is in its final checks — the
 * checks of the whole Spec are drawn under the stories, and they are the news then.
 */
function firstShown(build: BuildViewData): string | null {
  if (closed(build)) return null
  const needs = build.tasks.find(
    (task) =>
      task.state === 'yours' ||
      (task.state === 'blocked' && openBlockerOf(task, build.blockers) !== undefined),
  )
  if (needs !== undefined) return needs.id
  const moving = build.tasks.find(
    (task) => task.state === 'in_progress' || task.state === 'checking',
  )
  if (moving !== undefined) return moving.id
  if (build.phase === 'verify' || build.endAttempts.length > 0) return null
  return build.tasks[0]?.id ?? null
}

/** The one line under the title: the phase in words, the stories done, the final checks. */
function StateLine({
  build,
  stories,
  now,
}: {
  build: BuildViewData
  stories: readonly BuildStoryRow[]
  now: string
}): ReactNode {
  const { word, tone } = phaseOf(build)
  const done = stories.filter((story) => story.progress === 'done').length
  const final = lastAttempt(build.endAttempts)
  return (
    <div className={STATE_LINE}>
      <span className={PHASE}>
        <StatusDot status={tone} />
        {word}
      </span>
      {stories.length > 0 && (
        <span className={QUIET}>{`${String(done)} of ${String(stories.length)} stories done`}</span>
      )}
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

/** The agent's approach, or the line that waits for it (D10-02). */
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
   * The stories of the frozen Spec, which the build's stories take their words from: what each
   * story was written to be, and the criteria it is judged on.
   */
  stories?: readonly StoryView[] | undefined
  /**
   * The task that is unfolded, by its build task id; for a caller that keeps it. Left out, the
   * view holds it, and opens on what needs the user first; `null` says nothing is unfolded.
   */
  selected?: string | null | undefined
  onSelect?: ((id: string | null) => void) | undefined
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
  stories = [],
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
  const [unfolded, setUnfolded] = useState<readonly string[]>([])
  const shown = selected ?? chosen
  const over = closed(build)
  const paused = build.pausedAt !== null
  const storyIds = useId()
  const rows = storyRowsOf(build, stories)
  const finals = build.phase === 'verify' || build.endAttempts.length > 0

  // The story of the task that is unfolded is unfolded too: a stage nobody can see is a stage
  // that was asked for and never shown. Folding the story folds what was unfolded in it.
  const held = rows.find((story) => story.tasks.some((one) => one.id === shown))
  if (held !== undefined && !unfolded.includes(held.id)) {
    setUnfolded((was) => [...was, held.id])
  }

  const choose = (id: string | null) => {
    setChosen(id)
    onSelect?.(id)
  }

  const unfold = (id: string, open: boolean) => {
    setUnfolded((was) => (open ? [...was, id] : was.filter((one) => one !== id)))
  }

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
    // A blocker of its own stands on the story, above the tasks: it says what it holds.
    if (openBlockerOf(on, build.blockers) !== undefined) return null
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

  /** The blockers still standing on the tasks of a story, each with the task it holds. */
  function blockersOf(story: BuildStoryRow): { task: BuildTaskView; blocker: BuildBlockerView }[] {
    return build.blockers
      .filter((blocker) => blocker.dismissedAt === null)
      .flatMap((blocker) => {
        const on = story.tasks.find((one) => one.id === blocker.taskId)
        return on === undefined ? [] : [{ task: on, blocker }]
      })
  }

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
        <StateLine build={build} stories={rows} now={now} />
      </header>
      <Band build={build} />
      <Approach build={build} />
      <div className={BODY} role="region" tabIndex={0} aria-label={`The build of ${build.specKey}`}>
        {rows.length === 0 && <p className={HINT}>No story of the Spec is being built yet.</p>}
        {rows.length > 0 && (
          <ol aria-label={`Stories of ${build.specKey}`} className={STORIES}>
            {rows.map((story) => {
              const open = unfolded.includes(story.id)
              const heading = `${storyIds}-${story.id}`
              return (
                <li key={story.id} className="flex">
                  <article aria-labelledby={heading} className={STORY}>
                    <div className={STORY_HEAD}>
                      <StatusDot status={PROGRESS_TONES[story.progress]} />
                      <span className={STORY_KEY}>{story.key}</span>
                      <h2 id={heading} className={STORY_TITLE}>
                        {story.title}
                      </h2>
                      <span className={STORY_WORD}>{STORY_PROGRESS_LABELS[story.progress]}</span>
                    </div>
                    {story.narrative !== '' && <p className={NARRATIVE}>{story.narrative}</p>}
                    {story.criteria.length > 0 && (
                      <ul aria-label={`Criteria of ${story.key}`} className={CRITERIA}>
                        {story.criteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    )}
                    {blockersOf(story).map(({ task: blocked, blocker }) => (
                      <BlockerBlock
                        key={blocker.id}
                        blocker={blocker}
                        now={now}
                        suspended={dependantsOf(blocked.label, build.tasks)}
                        onDismiss={() => onDismissBlocker(blocker.id)}
                      />
                    ))}
                    {story.tasks.length > 0 && (
                      <Disclosure
                        open={open}
                        onOpenChange={(next) => {
                          unfold(story.id, next)
                          if (!next && story.tasks.some((one) => one.id === shown)) choose(null)
                        }}
                        summary={
                          <span className={TASKS}>{`Tasks · ${String(story.tasks.length)}`}</span>
                        }
                      >
                        <ul className="flex flex-col">
                          {story.tasks.map((one) => (
                            <li key={one.id}>
                              <Disclosure
                                open={shown === one.id}
                                onOpenChange={(next) => choose(next ? one.id : null)}
                                summary={
                                  <span className={TASK}>
                                    <span className={TASK_LABEL}>{one.label}</span>
                                    <span className="sr-only">{', '}</span>
                                    <span className={TASK_TITLE}>{one.title}</span>
                                    <span className="sr-only">{', '}</span>
                                    <span className={TASK_META}>
                                      {`${taskStateLabel(one)}, ${taskTime(one, now)}`}
                                    </span>
                                  </span>
                                }
                              >
                                <TaskStage task={one} now={now} attention={attentionOf(one)} />
                              </Disclosure>
                            </li>
                          ))}
                        </ul>
                      </Disclosure>
                    )}
                  </article>
                </li>
              )
            })}
          </ol>
        )}
        {finals && <FinalChecks build={build} now={now} />}
      </div>
    </div>
  )
}

/** The final checks of the whole Spec (D10-07): their tries, as a task's are drawn. */
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
