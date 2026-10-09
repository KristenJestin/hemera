import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { BallMark } from '../../blocks/ball/ball-mark.tsx'
import { Button } from '../../components/button/button.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { MentionField } from '../../components/mention-field/mention-field.tsx'
import { type SheetView, SheetStack } from '../../components/sheet/sheet.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconClockPause,
  IconCopy,
  IconEye,
  IconFileText,
  IconHandStop,
  IconInfoCircle,
  IconLink,
  IconListNumbers,
  IconMessages,
  IconMinus,
  IconPencil,
  IconPlus,
  IconStar,
  IconTestPipe,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { CancelMission, STAGE_DOT, TicketLink } from '../coming-back/parts.tsx'
import { Marks, StageTrack } from '../coming-back/proposal-b.tsx'
import type {
  AnswerVersion,
  ColdReadPass,
  Delta,
  Dependency,
  Discussion,
  Finding,
  Freshness,
  InputState,
  PlanningHandlers,
  PlanningState,
  Probe,
  Proof,
  Question,
  Requirement,
  SectionState,
  Severity,
  SpecChange,
  SpecSection,
  Task,
  TicketChange,
  Vision,
} from './model.ts'

/**
 * What both proposals of the Planning page share: the mission frame of "Two lines and a rail"
 * with Planning's head, and the pieces the page is made of — a question, a requirement and its
 * proofs, a Probe's chip and report, the cold read's report, a discussion, a dependency, a refusal.
 * The proposals differ in where these stand and what leads, not in what they are.
 */

/* ------------------------------------------------------------------------------------------ */
/* Marks                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const SECTION_WORDS: Record<SectionState, string> = {
  empty: 'Not written yet',
  written: 'Written',
  being_written: 'Being written',
}

const SECTION_POSE: Record<SectionState, MarkState> = {
  empty: 'todo',
  written: 'done',
  being_written: 'running',
}

/** A section's state as a glyph: a quiet ring, a closed one, the running arc while written. */
export function SectionMark({ state }: { state: SectionState }): ReactNode {
  return (
    <Legend label={SECTION_WORDS[state]}>
      <StatusMark state={SECTION_POSE[state]} size="sm" />
    </Legend>
  )
}

export const INPUT_WORDS: Record<InputState, string> = {
  received: 'Received',
  delivered: 'Delivered to the Planner',
  integrated: 'Integrated in the Spec',
  superseded: 'Replaced by a later answer',
}

const INPUT_DOT: Record<InputState, string> = {
  received: 'size-2 shrink-0 rounded-full border border-muted-foreground',
  delivered: 'size-2 shrink-0 rounded-full bg-info',
  integrated: 'size-2 shrink-0 rounded-full bg-success',
  superseded: 'size-2 shrink-0 rounded-full border border-border',
}

/** Where an input of the user stands: a ring received, a dot delivered, a green dot integrated. */
export function InputDot({ state }: { state: InputState }): ReactNode {
  return (
    <Legend label={INPUT_WORDS[state]}>
      <span aria-hidden="true" className="flex size-icon-sm items-center justify-center">
        <span className={INPUT_DOT[state]} data-input={state} />
      </span>
    </Legend>
  )
}

const SEVERITY_WORDS: Record<Severity, string> = {
  blocking: 'Blocking',
  warning: 'Warning',
  suggestion: 'Suggestion',
}

const SEVERITY_TONE: Record<Severity, string> = {
  blocking: 'flex text-destructive',
  warning: 'flex text-warning',
  suggestion: 'flex text-muted-foreground',
}

const SEVERITY_GLYPH: Record<Severity, ReactNode> = {
  blocking: <IconHandStop size="sm" />,
  warning: <IconAlertTriangle size="sm" />,
  suggestion: <IconInfoCircle size="sm" />,
}

/** How bad a finding is, as a glyph. */
export function SeverityMark({ severity }: { severity: Severity }): ReactNode {
  return (
    <Legend label={SEVERITY_WORDS[severity]}>
      <span aria-hidden="true" className={SEVERITY_TONE[severity]}>
        {SEVERITY_GLYPH[severity]}
      </span>
    </Legend>
  )
}

const DELTA_WORDS: Record<Delta, string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
}

const DELTA_TONE: Record<Delta, string> = {
  added: 'flex text-success',
  modified: 'flex text-info',
  removed: 'flex text-muted-foreground',
}

const DELTA_GLYPH: Record<Delta, ReactNode> = {
  added: <IconPlus size="sm" />,
  modified: <IconPencil size="sm" />,
  removed: <IconMinus size="sm" />,
}

function DeltaMark({ delta }: { delta: Delta }): ReactNode {
  return (
    <Legend label={DELTA_WORDS[delta]}>
      <span aria-hidden="true" className={DELTA_TONE[delta]}>
        {DELTA_GLYPH[delta]}
      </span>
    </Legend>
  )
}

/** Changed since the user last read the Spec: a dot in the info tone. */
export function ChangedMark(): ReactNode {
  return (
    <Legend label="Changed since your last read">
      <span aria-hidden="true" className="flex size-icon-sm items-center justify-center">
        <span className="size-1.5 rounded-full bg-info" />
      </span>
    </Legend>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* The mission frame, in Planning                                                               */
/* ------------------------------------------------------------------------------------------ */

const HEADER = 'flex shrink-0 flex-col gap-2 px-8 pt-5 pb-3'

const LINE = 'flex min-h-control-md min-w-0 items-center gap-3'

const MISSION_KEY = 'shrink-0 font-mono text-sm text-muted-foreground'

const MISSION_TITLE = 'min-w-0 truncate text-xl font-semibold tracking-tight'

const END = 'ml-auto flex shrink-0 items-center gap-2'

const META = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'

const META_LINK =
  'flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-ring'

/** Clipped: a sheet on its way in is not a reason for the page to scroll. */
const BODY = 'relative flex min-h-0 flex-1 flex-col overflow-hidden'

const BASE = 'flex min-h-0 flex-1 flex-col overflow-auto'

/** The head's action in Planning and in Ready: Freeze when offered, Return to Planning once frozen. */
export function StageAction({
  state,
  onFreeze,
  onReturnToPlanning,
}: {
  state: PlanningState
  onFreeze: () => void
  onReturnToPlanning: () => void
}): ReactNode {
  if (state.mission.frozen) {
    return (
      <Button variant="secondary" size="sm" onClick={onReturnToPlanning}>
        <IconArrowBackUp size="sm" />
        Return to Planning
      </Button>
    )
  }
  // Freeze is not there before everything is settled: hidden, never refused in red.
  if (!state.readiness.ready) return null
  return (
    <Button variant="primary" size="sm" onClick={onFreeze}>
      Freeze
    </Button>
  )
}

/** What the Planner does now, after Hemera's face; a silent turn said in words. */
export function NowLine({ state }: { state: PlanningState }): ReactNode {
  const ball = state.now !== null ? 'agent' : state.mission.ball
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <BallMark ball={ball} legend face />
      <span className="truncate" data-now="">
        {state.now ?? state.silent ?? (state.mission.frozen ? 'Frozen' : 'Your turn')}
      </span>
    </span>
  )
}

export interface PlanningFrameProps {
  state: PlanningState
  handlers: PlanningHandlers
  /** What the head's third line adds at its end: the chips of what goes on. */
  going?: ReactNode
  /** What stands right under the head, before the base: what the mission needs. */
  under?: ReactNode
  base: ReactNode
  views: readonly SheetView[]
  shown: string | null
  onShow: (id: string | null) => void
  onOpenSpec: () => void
}

/**
 * The mission frame of "Two lines and a rail", in Planning: the key, the title, Freeze when it is
 * offered and Cancel; the stage track; the ball with the Planner's Now line, the marks, the type,
 * the ticket and the Spec. Under it what the mission needs, then the page, and the views over it.
 */
export function PlanningFrame({
  state,
  handlers,
  going,
  under,
  base,
  views,
  shown,
  onShow,
  onOpenSpec,
}: PlanningFrameProps): ReactNode {
  const { mission } = state
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={HEADER}>
        <div className={LINE}>
          <span className={MISSION_KEY}>{mission.key}</span>
          <h1 className={MISSION_TITLE}>{mission.title}</h1>
          <div className={END}>
            <StageAction
              state={state}
              onFreeze={handlers.onFreeze}
              onReturnToPlanning={handlers.onReturnToPlanning}
            />
            <CancelMission missionKey={mission.key} onCancel={handlers.onCancel} />
          </div>
        </div>
        <StageTrack mission={mission} />
        <div className={META}>
          <NowLine state={state} />
          <Marks marks={mission.marks} />
          <span className="capitalize">{mission.type}</span>
          {mission.ticket !== undefined && <TicketLink ticket={mission.ticket} />}
          <button type="button" className={META_LINK} onClick={onOpenSpec}>
            <IconFileText size="sm" />
            <span className="truncate">Spec</span>
          </button>
          {going}
        </div>
      </div>
      {under}
      <div className={BODY}>
        <div
          className={BASE}
          data-base=""
          inert={shown !== null ? true : undefined}
          aria-hidden={shown !== null ? true : undefined}
        >
          {base}
        </div>
        <SheetStack
          views={views}
          open={shown === null ? [] : [shown]}
          shown={shown}
          onShow={onShow}
          onClose={() => onShow(null)}
          scrimLabel="Back to the page"
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* A question                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const OPTION =
  'flex w-full min-w-0 items-start gap-2 rounded-md border border-border px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-pressed:border-primary aria-pressed:bg-muted'

const LETTER = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

const QUIET = 'text-xs text-muted-foreground'

const QUESTION_ID = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

/** The latest answer of a question, the one that counts. */
export function latest(question: Question): AnswerVersion | undefined {
  return question.answers.at(-1)
}

/** A changed answer, said as the change it is: "Now B, before A". */
function ChangedAnswer({ question }: { question: Question }): ReactNode {
  if (question.answers.length < 2) return null
  const now = question.answers.at(-1)
  const before = question.answers.at(-2)
  if (now === undefined || before === undefined) return null
  const words = (answer: AnswerVersion): string => answer.optionId ?? `“${answer.text ?? ''}”`
  return (
    <p className={QUIET}>
      Now {words(now)}, before {words(before)}
    </p>
  )
}

function RetiredQuestion({ question }: { question: Question }): ReactNode {
  const why = {
    withdrawn: `Withdrawn: ${question.retiredReason ?? ''}`,
    replaced: `Replaced by ${question.replacedBy ?? ''}`,
    moot: `Moot: ${question.mootDecision ?? ''}`,
  }[question.state === 'withdrawn' || question.state === 'replaced' ? question.state : 'moot']
  return (
    <div className="flex min-w-0 items-start gap-2 px-4 py-2 text-sm text-muted-foreground">
      <span className={QUESTION_ID}>{question.id}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2">{question.text}</span>
        <span className="text-xs">{why}</span>
      </div>
    </div>
  )
}

/** A question answered before the page opened, as one line: its answer, its dot, and Change. */
function AnsweredLine({
  question,
  answer,
  onChange,
}: {
  question: Question
  answer: AnswerVersion
  onChange: () => void
}): ReactNode {
  const option = question.options.find((candidate) => candidate.id === answer.optionId)
  return (
    <article
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 items-start gap-2 px-3 py-2.5 text-sm"
    >
      <span className={QUESTION_ID}>{question.id}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2">{question.text}</span>
        <span className="truncate text-xs text-muted-foreground">
          {option !== undefined ? `${option.id} · ${option.label}` : `“${answer.text ?? ''}”`}
        </span>
        <ChangedAnswer question={question} />
      </div>
      <InputDot state={answer.inputState} />
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Change the answer to ${question.id}`}
        onClick={onChange}
      >
        Change
      </Button>
    </article>
  )
}

/** The options, the recommended one starred; a press answers at once. */
function Options({
  question,
  compact,
  onAnswer,
}: {
  question: Question
  compact: boolean
  onAnswer: (optionId: string) => void
}): ReactNode {
  const chosen = latest(question)?.optionId ?? null
  return (
    <ul aria-label={`Options of ${question.id}`} className="flex flex-col gap-1.5">
      {question.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={OPTION}
            aria-pressed={chosen === option.id}
            onClick={() => onAnswer(option.id)}
          >
            <span className={LETTER}>{option.id}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{option.label}</span>
              {!compact && <span className={QUIET}>{option.detail}</span>}
            </span>
            {option.id === question.recommended && (
              <span className="flex shrink-0 pt-0.5 text-primary" data-recommended="">
                <IconStar size="sm" aria-hidden="true" />
                <span className="sr-only">, recommended</span>
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Waiting on someone: the note, and the Planner's drafted message with Copy, never Send. */
function WaitingBox({ question, onCopy }: { question: Question; onCopy: () => void }): ReactNode {
  const draft = question.drafts.at(-1)
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconClockPause size="sm" />
        {question.waitingNote ?? 'Waiting on someone'}
      </p>
      {draft !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="max-w-measure text-sm whitespace-pre-line">{draft.text}</p>
          <div>
            <Button variant="secondary" size="sm" onClick={onCopy}>
              <IconCopy size="sm" />
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The answer in the user's own words, through the mention field, unfolding under the options. */
function OwnWords({
  question,
  open,
  onAnswer,
}: {
  question: Question
  open: boolean
  onAnswer: (text: string) => void
}): ReactNode {
  const folding = useTransition(fold)
  const [text, setText] = useState('')
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="own"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <MentionField
            label={`Your answer to ${question.id}`}
            placeholder="In your own words…"
            value={text}
            onValueChange={(value) => setText(value)}
            mentionables={MENTIONABLES}
            onSubmit={() => {
              if (text.trim() === '') return
              onAnswer(text.trim())
              setText('')
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface QuestionCardProps {
  question: Question
  /** Compact: the options by their labels and no why, for a rail. */
  compact?: boolean | undefined
  /** What stands under the question: its discussion, in place. */
  thread?: ReactNode
  handlers: Pick<PlanningHandlers, 'onAnswer' | 'onWaitOnSomeone' | 'onCopyDraft' | 'onDiscuss'>
  /** Whether a discussion on it exists already: Discuss then opens it. */
  discussed?: boolean | undefined
  /** An answered question as one line, its answer and its dot, until Change opens it again. */
  foldAnswered?: boolean | undefined
}

/**
 * A question of the Planner: its options with the recommended one and why, answered by a press
 * that leaves at once (no Send), or in the user's own words through the mention field; "I'm
 * waiting on someone", its note and the Planner's drafted message with Copy; the answer's state
 * as a dot, a changed answer said as a change. A retired question stays, with its reason.
 */
export function QuestionCard({
  question,
  compact = false,
  thread,
  handlers,
  discussed = false,
  foldAnswered = false,
}: QuestionCardProps): ReactNode {
  const [ownWords, setOwnWords] = useState(false)
  const [changing, setChanging] = useState(false)
  // Answered before the page opened: one line. Answered here: the card stays in place, answered.
  const [answeredBefore] = useState(question.state === 'answered')
  const answer = latest(question)
  if (RETIRED.has(question.state)) return <RetiredQuestion question={question} />
  if (foldAnswered && answeredBefore && answer !== undefined && !changing) {
    return <AnsweredLine question={question} answer={answer} onChange={() => setChanging(true)} />
  }
  return (
    <article
      aria-label={`${question.id} · ${question.text}`}
      className={cn('flex min-w-0 flex-col gap-3', compact ? 'px-3 py-3' : 'px-4 py-4')}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={QUESTION_ID}>{question.id}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-medium">{question.text}</h3>
          {!compact && (
            <p className="max-w-measure text-sm text-muted-foreground">{question.why}</p>
          )}
        </div>
        {question.state === 'waiting' && (
          <Legend label="Waiting on someone">
            <span aria-hidden="true" className="flex text-muted-foreground">
              <IconClockPause size="sm" />
            </span>
          </Legend>
        )}
        {answer !== undefined && <InputDot state={answer.inputState} />}
      </div>
      <Options
        question={question}
        compact={compact}
        onAnswer={(optionId) => handlers.onAnswer(question.id, { optionId })}
      />
      <p className={cn(QUIET, 'max-w-measure')}>
        <span className="font-medium text-foreground">Recommended {question.recommended}</span>
        {' · '}
        {question.recommendedReason}
      </p>
      {answer !== undefined && answer.text !== null && (
        <blockquote className="max-w-measure border-l-2 border-border pl-3 text-sm">
          {answer.text}
        </blockquote>
      )}
      <ChangedAnswer question={question} />
      {question.state === 'waiting' && (
        <WaitingBox question={question} onCopy={() => handlers.onCopyDraft(question.id)} />
      )}
      <OwnWords
        question={question}
        open={ownWords}
        onAnswer={(text) => {
          handlers.onAnswer(question.id, { text })
          setOwnWords(false)
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={ownWords}
          onClick={() => setOwnWords(!ownWords)}
        >
          In my own words
        </Button>
        {question.state === 'open' && (
          <Button variant="ghost" size="sm" onClick={() => handlers.onWaitOnSomeone(question.id)}>
            <IconClockPause size="sm" />
            I’m waiting on someone
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handlers.onDiscuss({ kind: 'question', id: question.id })}
        >
          <IconMessages size="sm" />
          {discussed ? 'Open the discussion' : 'Discuss'}
        </Button>
      </div>
      {thread}
    </article>
  )
}

const RETIRED: ReadonlySet<Question['state']> = new Set(['withdrawn', 'replaced', 'moot'])

/* ------------------------------------------------------------------------------------------ */
/* The Spec read                                                                                */
/* ------------------------------------------------------------------------------------------ */

const PROSE = 'flex max-w-measure flex-col gap-3 text-sm leading-6'

/** A section's Markdown, as the page reads it: paragraphs and lists. Nothing to edit. */
export function Prose({ body }: { body: string }): ReactNode {
  const blocks = body.split('\n\n').filter((block) => block.trim() !== '')
  return (
    <div className={PROSE}>
      {blocks.map((block) =>
        block.startsWith('- ') ? (
          <ul key={block} className="flex list-disc flex-col gap-1 pl-5">
            {block.split('\n').map((line) => (
              <li key={line}>{line.replace(/^- /, '')}</li>
            ))}
          </ul>
        ) : (
          <p key={block}>{block}</p>
        ),
      )}
    </div>
  )
}

const CHANGED = 'border-l-2 border-info pl-3'

const PRE =
  'max-w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap'

function ProofBlock({ proof }: { proof: Proof }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {proof.mode === 'automated' ? <IconTestPipe size="sm" /> : <IconCheck size="sm" />}
        <span className="font-medium text-foreground">
          {proof.mode === 'automated' ? 'Proof' : 'Verified by hand'}
        </span>
        {proof.test !== undefined && <span className="truncate font-mono">{proof.test}</span>}
        {proof.command !== undefined && <span className="truncate font-mono">{proof.command}</span>}
        {proof.fromProbe !== undefined && (
          <span className="ml-auto shrink-0">From Probe {proof.fromProbe}</span>
        )}
      </div>
      <ol className="flex list-decimal flex-col gap-0.5 pl-5">
        {proof.actions.map((action) => (
          <li key={action}>{action}</li>
        ))}
      </ol>
      <p>
        <span className="text-muted-foreground">Starting from </span>
        {proof.startingData}
      </p>
      <p>
        <span className="text-muted-foreground">Expected </span>
        {proof.expected}
      </p>
      {proof.seenToday && proof.observed !== undefined && (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground">Seen today</span>
          <pre className={PRE}>
            {proof.observed.split('\n').map((line) => (
              <span
                key={line}
                className={cn('block', line === proof.keyLine && 'text-destructive')}
              >
                {line}
              </span>
            ))}
          </pre>
        </div>
      )}
    </div>
  )
}

export function RequirementCard({
  requirement,
  changed,
}: {
  requirement: Requirement
  changed: boolean
}): ReactNode {
  return (
    <li
      aria-label={`${requirement.id} · ${requirement.text}`}
      className={cn('flex min-w-0 flex-col gap-3 px-4 py-3', changed && CHANGED)}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={QUESTION_ID}>{requirement.id}</span>
        <DeltaMark delta={requirement.delta} />
        <p
          className={cn(
            'max-w-measure min-w-0 flex-1 text-sm',
            requirement.delta === 'removed' && 'text-muted-foreground line-through',
          )}
        >
          {requirement.text}
        </p>
        {changed && <ChangedMark />}
        <span className="shrink-0 text-xs text-muted-foreground">{requirement.domain}</span>
      </div>
      {requirement.living !== undefined && (
        <p className="max-w-measure pl-8 text-xs text-muted-foreground">
          Changes <span className="font-mono">{requirement.living.ref}</span>
          {requirement.living.proposed ? ', itself still proposed' : ''}: “{requirement.living.text}
          ”
        </p>
      )}
      {requirement.scenarios.length > 0 && (
        <ul aria-label={`Scenarios of ${requirement.id}`} className="flex flex-col gap-3 pl-8">
          {requirement.scenarios.map((scenario) => (
            <li key={scenario.id} className="flex min-w-0 flex-col gap-2">
              <p className="max-w-measure text-sm">
                <span className="mr-2 font-mono text-xs text-muted-foreground">{scenario.id}</span>
                <span className="font-medium">WHEN</span> {scenario.when}{' '}
                <span className="font-medium">THEN</span> {scenario.then}
              </p>
              {scenario.proof !== null && <ProofBlock proof={scenario.proof} />}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const TASK = 'flex min-w-0 flex-col gap-1 border-b border-border px-4 py-2 last:border-b-0'

/** The tasks, folded by default: the Planner's translation for the Builder, read-only. */
export function TasksFold({
  tasks,
  changed,
}: {
  tasks: readonly Task[]
  changed: ReadonlySet<string>
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  if (tasks.length === 0) return null
  return (
    <section aria-label="Tasks" className="flex flex-col gap-2">
      <button
        type="button"
        className="flex h-control-sm w-fit items-center gap-2 rounded-md text-sm font-semibold outline-none hover:tinted focus-ring hover-motion"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconListNumbers size="sm" />
        Tasks
        <span className="font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="tasks"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Frame>
              <ul aria-label="Task list" className="flex flex-col">
                {tasks.map((task) => (
                  <li key={task.id} className={cn(TASK, changed.has(task.id) && CHANGED)}>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <span className={QUESTION_ID}>{task.id}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                      {task.dependsOn.length > 0 && (
                        <span className={QUIET}>after {task.dependsOn.join(', ')}</span>
                      )}
                    </div>
                    <p className="pl-8 text-xs text-muted-foreground">{task.result}</p>
                    <p className="truncate pl-8 font-mono text-xs text-muted-foreground">
                      {task.targets
                        .map(
                          (target) =>
                            `${target.intent === 'create' ? '+' : '~'} ${target.repository}/${target.path}`,
                        )
                        .join('   ')}
                    </p>
                  </li>
                ))}
              </ul>
            </Frame>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** The eight sections of the rail, Requirements fourth, in the Spec's order. */
export function railOf(
  state: PlanningState,
): { name: string; title: string; state: SectionState }[] {
  const prose = state.sections.map((section) => ({
    name: section.name,
    title: section.title,
    state: section.state,
  }))
  return [
    ...prose.slice(0, 3),
    { name: 'requirements', title: 'Requirements', state: state.requirementsState },
    ...prose.slice(3),
  ]
}

/** Whether an item of the Spec changed since the last read: a section's name, `R2`, `T3`. */
export function changedSet(changes: readonly SpecChange[]): ReadonlySet<string> {
  return new Set(changes.map((change) => change.item.split('.')[0] ?? change.item))
}

function SectionBody({ section }: { section: SpecSection }): ReactNode {
  if (section.state === 'being_written') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loading size="sm" label={`Hemera writes ${section.title}`} />
        Hemera writes it…
      </div>
    )
  }
  if (section.state === 'empty') {
    return <p className="text-sm text-muted-foreground">Not written yet.</p>
  }
  return <Prose body={section.body} />
}

/**
 * The Spec as it is read: the seven prose sections and the requirements, in order, each with its
 * state; what changed since the last read wears a line in the info tone; the tasks folded at the
 * end. Nothing to edit: the Planner writes, the user reads and answers.
 */
export function SpecRead({
  state,
  showChanges,
}: {
  state: PlanningState
  /** Whether what changed since the last read is marked in the text. */
  showChanges: boolean
}): ReactNode {
  const changed = showChanges ? changedSet(state.changes) : new Set<string>()
  const byName = new Map(state.sections.map((section) => [section.name, section]))
  return (
    <div className="flex min-w-0 flex-col gap-8">
      {railOf(state).map((entry) => {
        const section = byName.get(entry.name)
        return (
          <section
            key={entry.name}
            id={`spec-${entry.name}`}
            aria-label={entry.title}
            className={cn('flex min-w-0 flex-col gap-3', changed.has(entry.name) && CHANGED)}
          >
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <SectionMark state={entry.state} />
              {entry.title}
              {changed.has(entry.name) && <ChangedMark />}
            </h2>
            {section !== undefined ? (
              <SectionBody section={section} />
            ) : entry.state === 'being_written' && state.requirements.length === 0 ? (
              <SectionBody
                section={{ name: entry.name, title: entry.title, body: '', state: entry.state }}
              />
            ) : state.requirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not written yet.</p>
            ) : (
              <Frame>
                <ul aria-label="Requirements" className="flex flex-col divide-y divide-border">
                  {state.requirements.map((requirement) => (
                    <RequirementCard
                      key={requirement.id}
                      requirement={requirement}
                      changed={changed.has(requirement.id)}
                    />
                  ))}
                </ul>
              </Frame>
            )}
          </section>
        )
      })}
      <TasksFold tasks={state.tasks} changed={changed} />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* What goes on: Probes and the cold read                                                       */
/* ------------------------------------------------------------------------------------------ */

function probeLive(probe: Probe): LiveState {
  if (probe.stuck) return 'stuck'
  if (probe.state === 'done') return 'finished'
  if (probe.state === 'failed') return 'failed'
  if (probe.state === 'interrupted') return 'stopped'
  return 'running'
}

/** A Probe as its LiveChip: no × and no stop; pressed once it has ended, its report opens. */
export function ProbeChip({
  probe,
  onOpen,
}: {
  probe: Probe
  onOpen: (id: string) => void
}): ReactNode {
  const live = probeLive(probe)
  const name = `Probe ${probe.label} · ${probe.question}`
  return (
    <LiveChip
      name={name}
      icon={<IconTestPipe size="sm" />}
      state={live}
      startedAt={probe.startedAt}
      endedAt={probe.endedAt}
      onPress={() => onOpen(probe.id)}
      glance={
        live === 'running' || live === 'stuck'
          ? { kind: 'probe', type: 'Probe', step: probe.step, onDetails: () => onOpen(probe.id) }
          : undefined
      }
    />
  )
}

const PASS_LIVE: Record<ColdReadPass['state'], LiveState> = {
  waiting_for_slot: 'running',
  running: 'running',
  done: 'finished',
  failed: 'failed',
}

/** The cold read's pass as its LiveChip, while it waits for a slot, runs, or once it failed. */
export function ColdReadChip({ pass }: { pass: ColdReadPass }): ReactNode {
  const live: LiveState = pass.stuck ? 'stuck' : PASS_LIVE[pass.state]
  return (
    <LiveChip
      name={`Cold read ${pass.label}`}
      icon={<IconEye size="sm" />}
      state={live}
      startedAt={pass.startedAt}
      endedAt={pass.endedAt}
    />
  )
}

const OUTCOME_WORDS: Record<NonNullable<Probe['outcome']>, string> = {
  reproduced: 'Reproduced',
  not_reproduced: 'Not reproduced',
  answered: 'Answered',
  inconclusive: 'Inconclusive',
}

const PROBE_POSE: Record<Probe['state'], MarkState> = {
  preparing: 'running',
  running: 'running',
  done: 'done',
  failed: 'failed',
  interrupted: 'skipped',
}

/** A Probe's report, opened over the page. */
export function ProbeReport({ probe }: { probe: Probe }): ReactNode {
  return (
    <div className="flex max-w-measure flex-col gap-4 px-6 py-5 text-sm">
      <p className="flex items-center gap-2">
        <StatusMark state={PROBE_POSE[probe.state]} size="sm" />
        <span className="font-medium">
          {probe.outcome !== null ? OUTCOME_WORDS[probe.outcome] : 'Still running'}
        </span>
        {probe.scenario !== null && (
          <span className="font-mono text-xs text-muted-foreground">for {probe.scenario}</span>
        )}
      </p>
      <p className="font-medium">{probe.question}</p>
      {probe.failure !== undefined && <p className="text-destructive">{probe.failure}</p>}
      {probe.report !== undefined && (
        <>
          <p>{probe.report.answer}</p>
          <div className="flex flex-col gap-1">
            <span className={QUIET}>What it did</span>
            <ol className="flex list-decimal flex-col gap-0.5 pl-5">
              {probe.report.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ol>
          </div>
          {probe.report.command !== undefined && <pre className={PRE}>{probe.report.command}</pre>}
          {probe.report.observed !== undefined && (
            <pre className={PRE}>
              {probe.report.observed.split('\n').map((line) => (
                <span
                  key={line}
                  className={cn('block', line === probe.report?.keyLine && 'text-destructive')}
                >
                  {line}
                </span>
              ))}
            </pre>
          )}
          {probe.report.evidence.length > 0 && (
            <p className={QUIET}>Evidence kept: {probe.report.evidence.join(', ')}</p>
          )}
        </>
      )}
      {probe.report === undefined && probe.step !== undefined && (
        <p className={QUIET}>{probe.step}</p>
      )}
    </div>
  )
}

const FINDING = 'flex min-w-0 items-start gap-2 border-b border-border px-4 py-2.5 last:border-b-0'

function FindingRow({
  finding,
  onDismiss,
}: {
  finding: Finding
  onDismiss: (id: string) => void
}): ReactNode {
  return (
    <li
      className={cn(FINDING, finding.fate === 'dismissed' && 'text-muted-foreground')}
      data-fate={finding.fate}
    >
      <span className="flex pt-0.5">
        <SeverityMark severity={finding.severity} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="max-w-measure text-sm">{finding.text}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-mono">{finding.where.join(' · ')}</span>
          {finding.fate === 'asked' && <span>Asked as {finding.questionId}</span>}
          {finding.fate === 'fixed' && (
            <span className="flex items-center gap-1">
              <IconCheck size="sm" />
              Fixed by the Planner: {finding.fixedWhat}
            </span>
          )}
          {finding.fate === 'dismissed' && <span>Dismissed</span>}
        </p>
      </div>
      {(finding.fate === 'open' || (finding.fate === 'fixed' && finding.tasksOnly)) && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Dismiss ${finding.id}`}
          onClick={() => onDismiss(finding.id)}
        >
          Dismiss
        </Button>
      )}
    </li>
  )
}

/** "The cold read read an earlier text", and what changed since, folded. */
function FreshnessLine({ freshness }: { freshness: Freshness }): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  if (freshness.current) return null
  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-xs text-muted-foreground">
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 rounded-sm outline-none hover:text-foreground focus-ring"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <IconAlertTriangle size="sm" />
        The cold read read an earlier text · {freshness.changes.length} changes since
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="changes"
            aria-label="Changed since the cold read"
            className="flex flex-col gap-0.5 overflow-hidden pl-6"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            {freshness.changes.map((change) => (
              <li key={change.item} className="truncate">
                <span className="font-mono">{change.item}</span> · {change.after ?? 'removed'}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

const SEVERITIES: readonly Severity[] = ['blocking', 'warning', 'suggestion']

/**
 * The cold read's report: its pass's chip while it runs or once it failed, the text it read against
 * the Spec now, its findings by severity with what became of each, Dismiss, and "Run another cold
 * read", the user's only way to launch one.
 */
export function ColdReadReport({
  passes,
  freshness,
  onDismiss,
  onRunAgain,
}: {
  passes: readonly ColdReadPass[]
  freshness: Freshness
  onDismiss: (id: string) => void
  onRunAgain: () => void
}): ReactNode {
  const pass = passes.at(-1)
  if (pass === undefined) return null
  const busy = pass.state === 'running' || pass.state === 'waiting_for_slot'
  const findings = SEVERITIES.flatMap((severity) =>
    pass.findings.filter((finding) => finding.severity === severity),
  )
  return (
    <section aria-label="Cold read">
      <Frame
        header={
          <FrameHeader
            icon={<IconEye size="md" />}
            title="Cold read"
            description={
              busy
                ? 'A fresh reader goes through the Spec'
                : pass.state === 'failed'
                  ? undefined
                  : `${String(pass.findings.filter((finding) => finding.fate === 'open').length)} to settle`
            }
            action={
              busy ? (
                <ColdReadChip pass={pass} />
              ) : (
                <Button variant="link" size="sm" onClick={onRunAgain}>
                  Run another cold read
                </Button>
              )
            }
          />
        }
      >
        {pass.state === 'failed' ? (
          <p className="px-4 py-3 text-sm text-destructive">The cold read failed: {pass.failure}</p>
        ) : busy ? (
          <ul aria-label="Findings" aria-busy="true" className="flex flex-col">
            {[0, 1].map((row) => (
              <li key={row} className={FINDING}>
                <span className="h-4 w-full rounded-sm bg-skeleton motion-safe:animate-breathe" />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <FreshnessLine freshness={freshness} />
            {findings.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nothing found.</p>
            ) : (
              <ul aria-label="Findings" className="flex flex-col border-t border-border">
                {findings.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} onDismiss={onDismiss} />
                ))}
              </ul>
            )}
          </>
        )}
      </Frame>
    </section>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* A discussion                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/**
 * A discussion: the conversation at a reading measure, the agent's proposed decision with Accept,
 * a decision the user writes, and Close without a decision. Only the user closes it.
 */
export function DiscussionThread({
  discussion,
  handlers,
}: {
  discussion: Discussion
  handlers: Pick<PlanningHandlers, 'onSay' | 'onAcceptProposal' | 'onCloseDiscussion'>
}): ReactNode {
  const [text, setText] = useState('')
  const [deciding, setDeciding] = useState(false)
  return (
    <section
      aria-label={`Discussion ${discussion.label}`}
      className="flex max-w-measure min-w-0 flex-col gap-3"
    >
      <ol aria-label={`Messages of ${discussion.label}`} className="flex flex-col gap-3">
        {discussion.messages
          .filter((message) => !(message.proposal && message.text === discussion.proposal?.text))
          .map((message) => (
            <li
              key={`${message.at} ${message.text}`}
              className={cn(
                'flex flex-col gap-1 text-sm',
                message.author === 'user' && 'items-end',
              )}
            >
              <span className={QUIET}>
                {message.author === 'user' ? 'You' : 'Hemera'} · {message.at}
              </span>
              <p
                className={cn(
                  'max-w-full rounded-lg px-3 py-2',
                  message.author === 'user' ? 'bg-muted' : 'border border-border',
                )}
              >
                {message.text}
              </p>
            </li>
          ))}
      </ol>
      {discussion.state === 'closed' ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCheck size="sm" />
          {discussion.outcome === 'decision'
            ? `Closed on a decision: ${discussion.decision ?? ''}`
            : 'Closed without a decision'}
        </p>
      ) : (
        <>
          {discussion.proposal !== null && (
            <div className="flex flex-col gap-2 rounded-lg border border-primary px-3 py-2">
              <span className={QUIET}>Proposed decision</span>
              <p className="text-sm font-medium">{discussion.proposal.text}</p>
              <div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handlers.onAcceptProposal(discussion.id)}
                >
                  Accept
                </Button>
              </div>
            </div>
          )}
          {discussion.waitsOn === 'agent' && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loading size="sm" label="Hemera answers" />
              Hemera answers…
            </p>
          )}
          <MentionField
            label={
              deciding
                ? `Your decision on ${discussion.label}`
                : `Your message in ${discussion.label}`
            }
            placeholder={deciding ? 'The decision, as it goes in Decisions…' : 'Reply…'}
            value={text}
            onValueChange={(value) => setText(value)}
            mentionables={MENTIONABLES}
            onSubmit={() => {
              const said = text.trim()
              if (said === '') return
              if (deciding) handlers.onCloseDiscussion(discussion.id, said)
              else handlers.onSay(discussion.id, said)
              setText('')
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={deciding}
              onClick={() => setDeciding(!deciding)}
            >
              Write a decision
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlers.onCloseDiscussion(discussion.id, null)}
            >
              Close without a decision
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Dependencies, refusal, changes, the ticket, the vision                                       */
/* ------------------------------------------------------------------------------------------ */

const ROW = 'flex min-w-0 items-start gap-2 border-b border-border px-4 py-2.5 last:border-b-0'

/** The dependencies the Planner proposed, which only the user accepts or rejects. */
export function DependencyRows({
  dependencies,
  onDecide,
}: {
  dependencies: readonly Dependency[]
  onDecide: (id: string, accept: boolean) => void
}): ReactNode {
  const shown = dependencies.filter((dependency) => dependency.state !== 'rejected')
  if (shown.length === 0) return null
  return (
    <ul aria-label="Dependencies" className="flex flex-col">
      {shown.map((dependency) => (
        <li key={dependency.id} className={ROW}>
          <span className="flex pt-1.5">
            <span aria-hidden="true" className={STAGE_DOT[dependency.dependsOnStage]} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <p className="flex min-w-0 items-center gap-2">
              <IconLink size="sm" />
              <span className="font-mono text-xs">{dependency.dependsOnKey}</span>
              <span className="truncate">{dependency.dependsOnTitle}</span>
            </p>
            <p className="text-xs text-muted-foreground">{dependency.reason}</p>
          </div>
          {dependency.state === 'proposed' ? (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Accept the dependency on ${dependency.dependsOnKey}`}
                onClick={() => onDecide(dependency.id, true)}
              >
                Accept
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Reject the dependency on ${dependency.dependsOnKey}`}
                onClick={() => onDecide(dependency.id, false)}
              >
                Reject
              </Button>
            </div>
          ) : (
            <Legend label="Accepted">
              <span aria-hidden="true" className="flex pt-0.5 text-success">
                <IconCheck size="sm" />
              </span>
            </Legend>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Freeze pressed and refused: every reason in words, each naming what blocks it. */
export function FreezeRefusal({ reasons }: { reasons: readonly string[] }): ReactNode {
  return (
    <section aria-label="Freeze refused">
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-warning">
                <IconHandStop size="md" />
              </span>
            }
            title="Not frozen"
            description="The Spec stays in Planning until these are settled."
          />
        }
      >
        <ul aria-label="Why Freeze was refused" className="flex flex-col">
          {reasons.map((reason) => (
            <li key={reason} className={ROW}>
              <span className="flex pt-0.5">
                <StatusMark state="waiting" size="sm" />
              </span>
              <span className="text-sm">{reason}</span>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/** What changed since the last read, item by item, before and after, and Mark as read. */
export function ChangesList({
  changes,
  onMarkRead,
}: {
  changes: readonly SpecChange[]
  onMarkRead: () => void
}): ReactNode {
  return (
    <section aria-label="Since your last read">
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-info">
                <IconPencil size="md" />
              </span>
            }
            title="Since your last read"
            description={`${String(changes.length)} changes`}
            action={
              <Button variant="link" size="sm" onClick={onMarkRead}>
                Mark as read
              </Button>
            }
          />
        }
      >
        <ul aria-label="Changes" className="flex flex-col">
          {changes.map((change) => (
            <li key={change.item} className={cn(ROW, 'flex-col gap-1')}>
              <span className="flex w-full items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{change.item}</span>
                <span className="ml-auto">{change.at}</span>
              </span>
              {change.before !== null && (
                <del className="max-w-measure text-sm text-muted-foreground">{change.before}</del>
              )}
              {change.after !== null ? (
                <ins className="max-w-measure text-sm no-underline">{change.after}</ins>
              ) : (
                <span className="text-sm text-muted-foreground">Removed</span>
              )}
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/** The ticket changed after the freeze: its difference. */
export function TicketDifference({ change }: { change: TicketChange }): ReactNode {
  return (
    <section aria-label="What changed on the ticket">
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-warning">
                <IconAlertTriangle size="md" />
              </span>
            }
            title={`${change.ticket} changed after the freeze`}
            description={change.when}
          />
        }
      >
        <div className="flex max-w-measure flex-col gap-2 px-4 py-3 text-sm">
          <del className="text-muted-foreground">{change.before}</del>
          <ins className="no-underline">{change.after}</ins>
        </div>
      </Frame>
    </section>
  )
}

/** The user's vision, given at any time: what was given, where it stands, and the field. */
export function VisionField({
  visions,
  onGive,
}: {
  visions: readonly Vision[]
  onGive: (text: string) => void
}): ReactNode {
  const [text, setText] = useState('')
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {visions.length > 0 && (
        <ul aria-label="Your vision so far" className="flex flex-col gap-2">
          {visions.map((vision) => (
            <li key={vision.at} className="flex items-start gap-2 text-sm">
              <span className="flex pt-0.5">
                <InputDot state={vision.inputState} />
              </span>
              <span className="min-w-0 flex-1">{vision.text}</span>
              <span className={QUIET}>{vision.at}</span>
            </li>
          ))}
        </ul>
      )}
      <MentionField
        label="Your vision"
        placeholder="What you see for it, at any time…"
        value={text}
        onValueChange={(value) => setText(value)}
        mentionables={MENTIONABLES}
        onSubmit={() => {
          if (text.trim() === '') return
          onGive(text.trim())
          setText('')
        }}
      />
    </div>
  )
}
