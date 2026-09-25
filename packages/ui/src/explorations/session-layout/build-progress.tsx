import { type ReactNode, useId, useState } from 'react'

import { Disclosure } from '../../activity/disclosure.tsx'
import { TASK_STATE_LABELS } from '../../build/model.ts'
import { StopBuild } from '../../build/stop-build.tsx'
import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { StatusDot, type StatusTone } from '../../components/status-dot/status-dot.tsx'
import {
  IconArrowUp,
  IconCheck,
  IconCircleCheck,
  IconCircleDashed,
  IconHandStop,
  IconPlayerPause,
} from '../../icons.ts'
import {
  type BlockerProgress,
  type BuildProgressView,
  type CriterionProgress,
  PROGRESS_LABELS,
  type Progress,
  type StoryProgress,
} from './model.ts'

/**
 * The build panel of the exploration: the Spec the user wrote, annotated with its progress.
 *
 * Each story and each of its criteria says where it stands — done, in progress, to do, blocked —
 * and the tasks the build split it into are a detail one unfolds under the story. The head says
 * the progress in a plain line ("0 of 2 stories done") and holds the one "Stop build" of the page:
 * the blocker has none of its own, and the composer's Stop stops the agent's turn, not the build.
 *
 * `inPlace` is the variant with no chat beside the build (V4): the blocker is answered where it
 * stands, and a "Tell the agent…" field closes the page.
 */

const PANEL = 'flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface-content'

const HEAD = 'flex flex-col gap-2 border-b border-border px-6 pt-5 pb-4'

const HEAD_LINE = 'flex min-w-0 items-center gap-3'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 truncate text-xl font-medium'

const ACTIONS = 'ml-auto flex shrink-0 items-center gap-2'

const STATE_LINE = 'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'

const STAGE_WORD = 'flex items-center gap-1.5 font-medium text-foreground'

const QUIET = 'text-muted-foreground'

const SCROLL = 'min-h-0 flex-1 overflow-y-auto outline-none focus-ring'

const BODY = 'mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-6'

const REVIEW =
  'flex flex-col gap-1 rounded-lg border border-info/40 bg-info-muted px-4 py-3 text-sm text-info-muted-foreground'

const STORY = 'flex flex-col gap-3'

const STORY_HEAD = 'flex items-center gap-2'

const STORY_KEY = 'font-mono text-xs text-muted-foreground'

const STORY_TITLE = 'text-base font-medium'

const NARRATIVE = 'text-sm text-muted-foreground'

const CRITERIA = 'flex flex-col gap-1.5'

const CRITERION = 'flex items-start gap-2 text-sm'

const CRITERION_WORD = 'ml-auto shrink-0 text-xs text-muted-foreground'

const BLOCKER =
  'ml-6 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive-muted px-4 py-3'

const BLOCKER_LEAD = 'flex items-center gap-2 text-sm font-medium text-destructive-muted-foreground'

const BLOCKER_REASON = 'border-l-2 border-destructive/40 pl-3 text-sm text-foreground'

const TASKS = 'flex flex-col gap-0.5'

const TASK = 'flex items-center gap-2 text-sm text-muted-foreground'

const TELL = 'border-t border-border px-6 py-3'

/** The mark in front of a criterion: its state as a glyph, the word said beside it. */
const MARKS: Record<Progress, ReactNode> = {
  done: <IconCircleCheck size="sm" className="text-success-muted-foreground" aria-hidden="true" />,
  working: <StatusDot status="running" className="m-1" />,
  todo: <IconCircleDashed size="sm" className="text-muted-foreground" aria-hidden="true" />,
  blocked: (
    <IconHandStop size="sm" className="text-destructive-muted-foreground" aria-hidden="true" />
  ),
}

const STORY_TONES: Record<Progress, StatusTone> = {
  done: 'success',
  working: 'running',
  todo: 'pending',
  blocked: 'failure',
}

/** Where a story stands, from its criteria: blocked wins, then in progress, then done. */
function storyProgress(story: StoryProgress): Progress {
  const all = story.criteria.map((criterion) => criterion.progress)
  if (all.includes('blocked')) return 'blocked'
  if (all.every((one) => one === 'done')) return 'done'
  if (all.some((one) => one !== 'todo')) return 'working'
  return 'todo'
}

/** "0 of 2 stories done". */
export function storiesDone(build: BuildProgressView): string {
  const done = build.stories.filter((story) => storyProgress(story) === 'done').length
  return `${String(done)} of ${String(build.stories.length)} stories done`
}

const STAGE_WORDS = {
  building: { word: 'Building', tone: 'running' },
  review: { word: 'Waiting for your review', tone: 'pending' },
} as const

export interface BuildProgressProps {
  build: BuildProgressView
  /** Whether the build is answered in place, with no chat beside it (V4). */
  inPlace?: boolean | undefined
  /** Where the review is written, which the review note names: the chat, or its tab. */
  reviewIn?: string | undefined
  onPause: () => void
  onStop: () => void
  onAccept: () => void
  /** The Spec stands: the blocked criterion goes back to work. */
  onDismissBlocker: () => void
  /** A reply to the agent written on the page (V4). */
  onReply?: ((text: string) => void) | undefined
}

export function BuildProgress({
  build,
  inPlace = false,
  reviewIn = 'the chat',
  onPause,
  onStop,
  onAccept,
  onDismissBlocker,
  onReply,
}: BuildProgressProps): ReactNode {
  const stage = STAGE_WORDS[build.stage]
  const [told, setTold] = useState('')
  return (
    <section aria-label={`Build of ${build.specKey}`} className={PANEL}>
      <header className={HEAD}>
        <div className={HEAD_LINE}>
          <span className={KEY}>{build.specKey}</span>
          <h2 className={TITLE}>{build.specTitle}</h2>
          <div className={ACTIONS}>
            {build.stage === 'review' ? (
              <Button variant="primary" size="sm" onClick={onAccept}>
                <IconCheck size="sm" />
                Accept
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onPause}>
                <IconPlayerPause size="sm" />
                Pause
              </Button>
            )}
            <StopBuild specKey={build.specKey} onStop={onStop} />
          </div>
        </div>
        <p className={STATE_LINE}>
          <span className={STAGE_WORD}>
            <StatusDot status={stage.tone} />
            {stage.word}
          </span>
          <span className={QUIET}>{storiesDone(build)}</span>
          {build.stage === 'review' && <span className={QUIET}>final checks green</span>}
        </p>
      </header>
      <div
        role="region"
        aria-label={`Progress of ${build.specKey}`}
        tabIndex={0}
        className={SCROLL}
      >
        <div className={BODY}>
          {build.stage === 'review' && (
            <div className={REVIEW}>
              <p className="font-medium">Every story is done. Your review is next.</p>
              <p>
                {`Write what to change in ${reviewIn}, as you would say it: bullets, pasted screenshots. The agent restates each point for you to confirm before it goes back to work.`}
              </p>
            </div>
          )}
          {build.stories.map((story) => (
            <ProgressStory
              key={story.id}
              story={story}
              blocked={build.blocker?.criterionId}
              blocker={
                build.blocker !== undefined && (
                  <Blocker
                    blocker={build.blocker}
                    inPlace={inPlace}
                    onDismissBlocker={onDismissBlocker}
                    onReply={onReply}
                  />
                )
              }
            />
          ))}
        </div>
      </div>
      {inPlace && (
        <div className={TELL}>
          <Input
            label="Tell the agent"
            placeholder="Tell the agent…"
            value={told}
            onValueChange={setTold}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onReply?.(told)
                  setTold('')
                }}
              >
                <IconArrowUp size="sm" />
                Send
              </Button>
            }
          />
        </div>
      )}
    </section>
  )
}

/** The blocker under the criterion it stands on: the agent's reason, and "The Spec stands". */
function Blocker({
  blocker,
  inPlace,
  onDismissBlocker,
  onReply,
}: {
  blocker: BlockerProgress
  inPlace: boolean
  onDismissBlocker: () => void
  onReply: ((text: string) => void) | undefined
}): ReactNode {
  const [reply, setReply] = useState('')
  return (
    <div role="group" aria-label="Blocker" className={BLOCKER}>
      <p className={BLOCKER_LEAD}>
        <IconHandStop size="sm" aria-hidden="true" />
        The agent says the Spec cannot be met here
        <span className="font-normal text-muted-foreground">{blocker.raised}</span>
      </p>
      <blockquote className={BLOCKER_REASON}>{blocker.reason}</blockquote>
      {inPlace && (
        <Input
          label="Reply"
          placeholder="Which one, or something else…"
          value={reply}
          onValueChange={setReply}
          action={
            <Button variant="secondary" size="sm" onClick={() => onReply?.(reply)}>
              Reply
            </Button>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onDismissBlocker}>
          The Spec stands
        </Button>
      </div>
    </div>
  )
}

/**
 * One story of the Spec with its progress: its criteria, each marked, what stands on the blocked
 * one, and its tasks folded under it.
 */
export function ProgressStory({
  story,
  blocked,
  blocker,
}: {
  story: StoryProgress
  /** The criterion a blocker stands on, if any. */
  blocked: string | undefined
  /** What is drawn under that criterion. */
  blocker: ReactNode
}): ReactNode {
  const named = useId()
  const progress = storyProgress(story)
  return (
    <article aria-labelledby={named} className={STORY}>
      <header className={STORY_HEAD}>
        <StatusDot status={STORY_TONES[progress]} />
        <span className={STORY_KEY}>{story.key}</span>
        <h3 id={named} className={STORY_TITLE}>
          {story.title}
        </h3>
        <span className={CRITERION_WORD}>{PROGRESS_LABELS[progress]}</span>
      </header>
      <p className={NARRATIVE}>{story.narrative}</p>
      <ul aria-label={`Criteria of ${story.key}`} className={CRITERIA}>
        {story.criteria.map((criterion) => (
          <li key={criterion.id} className="flex flex-col gap-2">
            <Criterion criterion={criterion} />
            {blocked === criterion.id && blocker}
          </li>
        ))}
      </ul>
      <Disclosure
        summary={
          <span className="text-sm text-muted-foreground">{`Tasks · ${String(story.tasks.length)}`}</span>
        }
      >
        <ul aria-label={`Tasks of ${story.key}`} className={TASKS}>
          {story.tasks.map((task) => (
            <li key={task.label} className={TASK}>
              <span className="font-mono text-xs">{task.label}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
              <span className="text-xs">{TASK_STATE_LABELS[task.state]}</span>
            </li>
          ))}
        </ul>
      </Disclosure>
    </article>
  )
}

function Criterion({ criterion }: { criterion: CriterionProgress }): ReactNode {
  return (
    <p className={CRITERION}>
      <span className="mt-0.5 flex shrink-0">{MARKS[criterion.progress]}</span>
      <span className="min-w-0 flex-1">{criterion.text}</span>
      <span className={CRITERION_WORD}>{PROGRESS_LABELS[criterion.progress]}</span>
    </p>
  )
}
