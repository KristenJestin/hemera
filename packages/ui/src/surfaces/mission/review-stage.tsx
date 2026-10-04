import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame, FrameFooter, FrameHeader } from '../../components/frame/frame.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconChevronRight,
  IconGitBranch,
  IconGitCompare,
  IconMessages,
  IconPlus,
  IconTerminal,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * The page of the Review stage: what the base of a mission in Review shows, and where its views
 * open from.
 *
 * Two columns. On the left, what the user does here: their remarks from the live test, each a
 * row with its state as a mark and a field to add one, with Fix offered only while a remark
 * waits; the requirements of the Spec with their tasks under them, each task a row that opens
 * its task; the proofs, red then green. On the right, what the stage shows: the services the
 * live test runs on, as live chips with Stop and Restart; the rounds, each a row that opens its
 * round; the checks per repository; the changes per repository, which open the diff. A service is
 * its live chip and nothing else: its URL and its Stop and Restart are the chip's glance.
 *
 * Every row that goes somewhere is a row, pressed where it stands: nothing on this page is a
 * button to a view for its own sake. What the base keeps while a view is over it is here too: the
 * requirement folded or open, the task last pressed, the page's scroll.
 */
export type RemarkState = 'pending' | 'inRound' | 'addressed' | 'resolved'

export interface Remark {
  id: string
  text: string
  state: RemarkState
  /** The round it went into, once it has. */
  round?: number | undefined
}

export interface ReviewTask {
  id: string
  title: string
  state: MarkState
  repositories: readonly string[]
}

export interface Requirement {
  id: string
  title: string
  proven: boolean
  tasks: readonly ReviewTask[]
}

export interface Proof {
  id: string
  /** The test that proves it, as a path. */
  test: string
  state: 'green' | 'red'
}

export interface Round {
  n: number
  points: number
  state: 'grilling' | 'building' | 'closed'
}

export interface Service {
  name: string
  state: LiveState
  startedAt: number
  /** When it ended; null while it runs. */
  endedAt: number | null
  /** The service's address, said in its glance. */
  url?: string | undefined
  /** The line it was started with, said in its glance: `pnpm dev`. */
  line: string
}

export interface Check {
  repository: string
  name: string
  state: MarkState
  /** After what it ran: `after R7`, `final`. */
  after: string
}

export interface Change {
  repository: string
  files: number
  added: number
  deleted: number
  /** Whether the repository was changed outside Hemera since. */
  outside?: boolean | undefined
}

export interface ReviewStageProps {
  remarks: readonly Remark[]
  onAddRemark: (text: string) => void
  /** Starts the next round on the remarks that wait; the number is the round it would be. */
  nextRound: number
  onFix: () => void
  requirements: readonly Requirement[]
  /** The task last pressed, which the base keeps. */
  chosenTask?: string | undefined
  onOpenTask: (id: string) => void
  proofs: readonly Proof[]
  services: readonly Service[]
  /** What a service's glance offers: Stop and Restart live there, not on the row. */
  onService: (name: string, action: 'stop' | 'restart') => void
  rounds: readonly Round[]
  onOpenRound: (n: number) => void
  checks: readonly Check[]
  changes: readonly Change[]
  onOpenDiff: () => void
}

const PAGE = 'grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-5'

const LEFT = 'flex min-w-0 flex-col gap-6 lg:col-span-3'

const RIGHT = 'flex min-w-0 flex-col gap-6 lg:col-span-2'

const ROWS = 'flex flex-col'

const ROW = 'flex min-h-control-md w-full min-w-0 items-center gap-3 px-4 py-1.5 text-left text-sm'

const PRESSABLE = 'outline-none hover:bg-muted focus-ring hover-motion'

const RULE = 'border-b border-border last:border-b-0'

const ID = 'shrink-0 font-mono text-xs text-muted-foreground'

const TEXT = 'min-w-0 flex-1 truncate'

const QUIET = 'shrink-0 text-xs text-muted-foreground'

const MONO = 'shrink-0 font-mono text-xs text-muted-foreground'

const EMPTY = 'px-4 py-3 text-sm text-muted-foreground'

const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion aria-expanded:rotate-90'

const COUNT = 'text-sm font-medium text-muted-foreground tabular-nums'

const LINK =
  'text-sm text-primary-muted-foreground outline-none hover:text-primary focus-ring rounded-sm'

/** What a remark's mark says, in words, beside the state the mark draws. */
function remarkLegend(remark: Remark): string {
  if (remark.state === 'pending') return 'Not sent yet'
  if (remark.state === 'inRound') return `In round ${String(remark.round ?? '')}`.trim()
  if (remark.state === 'addressed') return 'Addressed, waiting for you to resolve'
  return 'Resolved'
}

const REMARK_MARK: Record<RemarkState, MarkState> = {
  pending: 'todo',
  inRound: 'running',
  addressed: 'waiting',
  resolved: 'done',
}

const ROUND_MARK: Record<Round['state'], MarkState> = {
  grilling: 'waiting',
  building: 'running',
  closed: 'done',
}

const ROUND_LEGEND: Record<Round['state'], string> = {
  grilling: 'Questions wait for you',
  building: 'Building the round',
  closed: 'Closed',
}

export function ReviewStage({
  remarks,
  onAddRemark,
  nextRound,
  onFix,
  requirements,
  chosenTask,
  onOpenTask,
  proofs,
  services,
  onService,
  rounds,
  onOpenRound,
  checks,
  changes,
  onOpenDiff,
}: ReviewStageProps): ReactNode {
  const [draft, setDraft] = useState('')
  const pending = remarks.filter((remark) => remark.state === 'pending').length
  return (
    <div className={PAGE} data-stage="review">
      <div className={LEFT}>
        <Frame
          header={
            <FrameHeader
              title="Your remarks"
              action={
                remarks.length > 0 ? <span className={COUNT}>{remarks.length}</span> : undefined
              }
            />
          }
          footer={
            <FrameFooter>
              <Input
                label="Add a remark"
                icon={<IconPlus size="sm" />}
                placeholder="A remark from your live test…"
                value={draft}
                onValueChange={setDraft}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || draft.trim() === '') return
                  event.preventDefault()
                  onAddRemark(draft.trim())
                  setDraft('')
                }}
                className="min-w-0 flex-1"
                action={
                  pending > 0 ? (
                    <Button variant="primary" onClick={onFix}>
                      Fix · round {nextRound}
                    </Button>
                  ) : undefined
                }
              />
            </FrameFooter>
          }
        >
          {remarks.length === 0 ? (
            <p className={EMPTY}>No remark yet.</p>
          ) : (
            <ul aria-label="Your remarks" className={ROWS}>
              {remarks.map((remark) => (
                <li key={remark.id} className={cn(RULE, ROW)}>
                  <Legend label={remarkLegend(remark)}>
                    <StatusMark state={REMARK_MARK[remark.state]} size="sm" />
                  </Legend>
                  <span className={ID}>{remark.id}</span>
                  <span className={TEXT}>{remark.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Frame>

        <Frame
          header={
            <FrameHeader
              title="Requirements"
              description={`${String(requirements.filter((one) => one.proven).length)} of ${String(requirements.length)} proven`}
            />
          }
        >
          <ul aria-label="Requirements" className={ROWS}>
            {requirements.map((requirement) => (
              <RequirementRow
                key={requirement.id}
                requirement={requirement}
                chosenTask={chosenTask}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        </Frame>

        <Frame header={<FrameHeader title="Proofs" />}>
          <ul aria-label="Proofs" className={ROWS}>
            {proofs.map((proof) => (
              <li key={proof.id} className={cn(RULE, ROW)}>
                <StatusMark state={proof.state === 'green' ? 'done' : 'failed'} size="sm" legend />
                <span className={ID}>{proof.id}</span>
                <span className={cn(TEXT, 'font-mono text-xs')}>{proof.test}</span>
              </li>
            ))}
          </ul>
        </Frame>
      </div>

      <div className={RIGHT}>
        <Frame header={<FrameHeader title="Services" />}>
          {services.length === 0 ? (
            <p className={EMPTY}>None running.</p>
          ) : (
            <ul aria-label="Services" className="flex flex-wrap gap-1.5 px-4 py-3">
              {services.map((service) => (
                <li key={service.name} className="flex">
                  <LiveChip
                    name={service.name}
                    icon={<IconTerminal size="sm" />}
                    state={service.state}
                    startedAt={service.startedAt}
                    endedAt={service.endedAt}
                    glance={{
                      kind: 'service',
                      type: `Service · ${service.line}`,
                      url: service.url,
                      onRestart: () => onService(service.name, 'restart'),
                      onStop: () => onService(service.name, 'stop'),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </Frame>

        <Frame header={<FrameHeader title="Rounds" />}>
          {rounds.length === 0 ? (
            <p className={EMPTY}>No round yet.</p>
          ) : (
            <ul aria-label="Rounds" className={ROWS}>
              {rounds.map((round) => (
                <li key={round.n} className={RULE}>
                  <button
                    type="button"
                    className={cn(ROW, PRESSABLE)}
                    onClick={() => onOpenRound(round.n)}
                  >
                    <Legend label={ROUND_LEGEND[round.state]}>
                      <StatusMark state={ROUND_MARK[round.state]} size="sm" />
                    </Legend>
                    <span className="flex shrink-0 text-muted-foreground">
                      <IconMessages size="sm" />
                    </span>
                    <span className={TEXT}>Round {round.n}</span>
                    <span className={QUIET}>{round.points} points</span>
                    <span className={CHEVRON} aria-hidden="true">
                      <IconChevronRight size="sm" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Frame>

        <Frame header={<FrameHeader title="Checks" />}>
          <ul aria-label="Checks" className={ROWS}>
            {checks.map((check) => (
              <li key={`${check.repository}:${check.name}`} className={cn(RULE, ROW)}>
                <StatusMark state={check.state} size="sm" legend />
                <span className={MONO}>{check.repository}</span>
                <span className={TEXT}>{check.name}</span>
                <span className={QUIET}>{check.after}</span>
              </li>
            ))}
          </ul>
        </Frame>

        <Frame
          header={
            <FrameHeader
              title="Changes"
              action={
                <button
                  type="button"
                  className={cn(LINK, 'flex items-center gap-1')}
                  onClick={onOpenDiff}
                >
                  <IconGitCompare size="sm" />
                  Diff
                </button>
              }
            />
          }
        >
          <ul aria-label="Changes" className={ROWS}>
            {changes.map((change) => (
              <li key={change.repository} className={RULE}>
                <button type="button" className={cn(ROW, PRESSABLE)} onClick={onOpenDiff}>
                  <span className="flex shrink-0 text-muted-foreground">
                    <IconGitBranch size="sm" />
                  </span>
                  <span className={cn(TEXT, 'font-mono text-xs')}>{change.repository}</span>
                  {change.outside === true && (
                    <Legend label="Changed outside Hemera">
                      <StatusMark state="waiting" size="sm" />
                    </Legend>
                  )}
                  <span className={QUIET}>{change.files} files</span>
                  <span className="shrink-0 font-mono text-xs text-success-muted-foreground tabular-nums">
                    +{change.added}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-destructive-muted-foreground tabular-nums">
                    −{change.deleted}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Frame>
      </div>
    </div>
  )
}

/** A requirement and, open, its tasks under it; a task is a row that opens its task. */
function RequirementRow({
  requirement,
  chosenTask,
  onOpenTask,
}: {
  requirement: Requirement
  chosenTask: string | undefined
  onOpenTask: (id: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(() =>
    requirement.tasks.some((task) => task.state !== 'done' && task.state !== 'todo'),
  )
  const done = requirement.tasks.filter((task) => task.state === 'done').length
  return (
    <li className={RULE}>
      <button
        type="button"
        className={cn(ROW, PRESSABLE)}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={CHEVRON} aria-expanded={open} aria-hidden="true">
          <IconChevronRight size="sm" />
        </span>
        <span className={ID}>{requirement.id}</span>
        <span className={cn(TEXT, 'font-medium')}>{requirement.title}</span>
        <span className={QUIET}>
          {done}/{requirement.tasks.length}
        </span>
        <Legend label={requirement.proven ? 'Proven' : 'Not proven yet'}>
          <StatusMark state={requirement.proven ? 'done' : 'todo'} size="sm" />
        </Legend>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="tasks"
            aria-label={`Tasks of ${requirement.id}`}
            className="flex flex-col overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            {requirement.tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={cn(ROW, PRESSABLE, 'pl-10')}
                  aria-current={chosenTask === task.id ? 'true' : undefined}
                  data-task={task.id}
                  onClick={() => onOpenTask(task.id)}
                >
                  <StatusMark state={task.state} size="sm" legend />
                  <span className={ID}>{task.id}</span>
                  <span className={cn(TEXT, chosenTask === task.id && 'font-medium')}>
                    {task.title}
                  </span>
                  <span className={MONO}>{task.repositories.join(' · ')}</span>
                  <span className={CHEVRON} aria-hidden="true">
                    <IconChevronRight size="sm" />
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  )
}
