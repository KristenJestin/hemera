import { cn } from 'cn'
// react-doctor-disable-next-line use-lazy-motion -- a desktop bundle read from disk, not a page load: `m` would need a LazyMotion around every window and story
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { MentionField } from '../../components/mention-field/mention-field.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconCheck, IconClockPause, IconCopy, IconMessages, IconStar } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { InputDot } from './planning-marks.tsx'
import { type AnswerStep, INPUT_SHORT, answerStepOf } from './answer-step.ts'
import { targetId } from './planning-progress.ts'
import { NotSent, SendButton, type Sending, useSending } from './sending.tsx'
import {
  type AnswerVersion,
  type PlanningHandlers,
  type ProposedAnswer,
  type Question,
  latest,
} from './planning-types.ts'

/**
 * An option: a quiet frame until the user chooses it, then the primary's frame and fill, its check
 * in the room of its letter, and the others dimmed. Nothing else wears a frame or a fill: the
 * recommendation is a star and a line.
 */
const OPTION =
  'flex w-full min-w-0 items-start gap-2 rounded-md border border-border px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-pressed:border-primary aria-pressed:bg-primary-muted data-dimmed:text-muted-foreground'

/** The option's letter, and its check once chosen, in a room of one width: the label never shifts. */
const LETTER =
  'flex w-icon-sm shrink-0 justify-center font-mono text-xs leading-5 text-muted-foreground'

const QUIET = 'text-xs text-muted-foreground'

const ID = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

const BOX = 'flex flex-col gap-2 rounded-md border border-border px-3 py-2'

/** Where the answer shown stands: on its way, or a step of its input. */
type StepShown = 'sending' | AnswerStep

const STEP_WORDS: Record<StepShown, string> = { sending: 'Sending', ...INPUT_SHORT }

const RETIRED: ReadonlySet<Question['state']> = new Set(['withdrawn', 'replaced', 'moot'])

/** Why a retired question no longer asks anything, in words. */
const RETIRED_WORDS: Partial<Record<Question['state'], (question: Question) => string>> = {
  withdrawn: (question) => `Withdrawn: ${question.retiredReason ?? ''}`,
  replaced: (question) => `Replaced by ${question.replacedBy ?? ''}`,
  moot: (question) => `Moot: ${question.mootDecision ?? ''}`,
}

/** How an answer reads in one line: its option's letter, or the user's words quoted. */
const answerWords = (answer: AnswerVersion): string => answer.optionId ?? `“${answer.text ?? ''}”`

/** A changed answer, said as the change it is: "Now B, before A". */
function ChangedAnswer({ question }: { question: Question }): ReactNode {
  const now = question.answers.at(-1)
  const before = question.answers.at(-2)
  if (now === undefined || before === undefined) return null
  return (
    <p className={QUIET}>
      Now {answerWords(now)}, before {answerWords(before)}
    </p>
  )
}

/**
 * A question the Planner withdrew, replaced or made moot: readable, with its reason, and the
 * discussion held on it read again from it.
 */
function RetiredQuestion({
  question,
  discussed,
  onDiscuss,
}: {
  question: Question
  discussed: boolean
  onDiscuss: QuestionCardProps['onDiscuss']
}): ReactNode {
  const why = RETIRED_WORDS[question.state]?.(question) ?? ''
  return (
    <article
      id={targetId({ kind: 'question', id: question.id })}
      tabIndex={-1}
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground outline-none focus-ring"
    >
      <span className={ID}>{question.id}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 break-words">{question.text}</span>
        <span className="text-xs break-words">{why}</span>
      </div>
      {discussed && onDiscuss !== undefined && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDiscuss({ kind: 'question', id: question.id })}
        >
          <IconMessages size="sm" />
          Open the discussion
        </Button>
      )}
    </article>
  )
}

/**
 * An answered question, folded: the question on its own row, the whole width; under it, the
 * answer in a quiet panel with where it stands (its dot and a word) beneath it, and Change at the
 * panel's end, where no step moves it. It folds to it the moment the user answers.
 */
function AnsweredLine({
  question,
  answer,
  step,
  onChange,
}: {
  question: Question
  answer: Pick<AnswerVersion, 'optionId' | 'text'>
  step: StepShown
  onChange: () => void
}): ReactNode {
  const option = question.options.find((candidate) => candidate.id === answer.optionId)
  return (
    <article
      id={targetId({ kind: 'question', id: question.id })}
      tabIndex={-1}
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 items-start gap-2 rounded-md px-3 py-2.5 text-sm outline-none focus-ring"
    >
      <span className={ID}>{question.id}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="break-words">{question.text}</span>
        <div className="flex min-w-0 items-center gap-3 rounded-md bg-muted px-3 py-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate">
              {option !== undefined ? `${option.id} · ${option.label}` : `“${answer.text ?? ''}”`}
            </span>
            <span className="flex items-center gap-1.5">
              <InputDot state={step === 'sending' ? 'received' : step} />
              <span role="status" className={QUIET}>
                {STEP_WORDS[step]}
              </span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Change the answer to ${question.id}`}
            onClick={onChange}
          >
            Change
          </Button>
        </div>
        <ChangedAnswer question={question} />
      </div>
    </article>
  )
}

/**
 * The options, the recommended one starred; a press answers at once, and the option pressed is
 * filled at once, before the engine has it. While it is on its way a second press sends nothing.
 */
function Options({
  question,
  chosen,
  answering,
  onPress,
}: {
  question: Question
  /** The option shown as chosen: the one pressed, else the latest answer's. */
  chosen: string | null
  answering: Sending
  onPress: (optionId: string) => void
}): ReactNode {
  return (
    <ul aria-label={`Options of ${question.id}`} className="flex flex-col gap-1.5">
      {question.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={OPTION}
            aria-pressed={chosen === option.id}
            aria-busy={answering.busy && chosen === option.id}
            aria-disabled={answering.busy}
            data-dimmed={chosen !== null && chosen !== option.id ? '' : undefined}
            aria-label={`${option.id} ${option.label}${option.id === question.recommended ? ', recommended' : ''}`}
            onClick={() => onPress(option.id)}
          >
            {chosen === option.id ? (
              <span
                aria-hidden="true"
                className="flex w-icon-sm shrink-0 justify-center pt-0.5 text-primary"
                data-chosen=""
              >
                <IconCheck size="sm" />
              </span>
            ) : (
              <span className={LETTER}>{option.id}</span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium break-words">{option.label}</span>
              {option.detail !== '' && (
                <span className="text-xs break-words text-muted-foreground">{option.detail}</span>
              )}
            </span>
            {option.id === question.recommended && (
              <span
                aria-hidden="true"
                className="flex shrink-0 pt-0.5 text-muted-foreground"
                data-recommended=""
              >
                <IconStar size="sm" />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Something that unfolds under the question, pushing what follows smoothly. */
function Unfold({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="unfolded"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Waiting on someone: the note, and the Planner's drafted message with Copy, never Send. */
function WaitingBox({
  question,
  onCopy,
}: {
  question: Question
  onCopy: (text: string) => void
}): ReactNode {
  const draft = question.drafts.at(-1)
  return (
    <div className={BOX}>
      <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
        <span className="flex shrink-0 pt-0.5">
          <IconClockPause size="sm" />
        </span>
        <span className="min-w-0 break-words">{question.waitingNote ?? 'Waiting on someone'}</span>
      </p>
      {draft !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="text-sm break-words whitespace-pre-line">{draft.text}</p>
          <div>
            <Button variant="secondary" size="sm" onClick={() => onCopy(draft.text)}>
              <IconCopy size="sm" />
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** An answer the Planner proposed from the ticket: the comment, the answer, Accept, Edit, Dismiss. */
function Proposed({
  proposal,
  onAccept,
  onEdit,
  onDismiss,
}: {
  proposal: ProposedAnswer
  onAccept: () => Promise<void>
  onEdit: () => void
  onDismiss: () => Promise<void>
}): ReactNode {
  return (
    <div role="group" aria-label="Proposed from the ticket" className={BOX}>
      <p className={QUIET}>
        From the ticket{proposal.author === null ? '' : ` · ${proposal.author}`}
      </p>
      <blockquote className="border-l-2 border-border pl-3 text-xs break-words text-muted-foreground">
        {proposal.comment}
      </blockquote>
      <p className="text-sm break-words">{proposal.text}</p>
      <div className="flex flex-wrap gap-1">
        <SendButton variant="secondary" size="sm" onSend={onAccept}>
          Accept
        </SendButton>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <SendButton variant="ghost" size="sm" onSend={onDismiss}>
          Dismiss
        </SendButton>
      </div>
    </div>
  )
}

export interface QuestionCardProps extends Pick<
  PlanningHandlers,
  'onAnswer' | 'onWaitOnSomeone' | 'onCopyDraft' | 'onAcceptProposed' | 'onDismissProposed'
> {
  /** Opens the question's discussion; a page that talks to agents otherwise offers no Discuss. */
  onDiscuss?: PlanningHandlers['onDiscuss'] | undefined
  question: Question
  /** Whether a discussion on it exists already: Discuss then opens it. */
  discussed: boolean
  /** What the user's own words can mention. */
  mentionables: readonly Mentionable[]
}

/** What the open card holds beside the question: the user's words, the note, and their sending. */
interface Drafts {
  readonly ownWords: boolean
  readonly toggleOwnWords: () => void
  readonly text: string
  readonly setText: (text: string) => void
  /** Opens the words with a proposal's text in them: sent, they accept that proposal. */
  readonly edit: (proposal: ProposedAnswer) => void
  readonly noting: boolean
  readonly toggleNoting: () => void
  readonly note: string
  readonly setNote: (note: string) => void
  readonly answering: Sending
  readonly waiting: Sending
  readonly submit: () => void
  readonly wait: () => void
}

type DraftHandlers = Pick<QuestionCardProps, 'onAnswer' | 'onWaitOnSomeone' | 'onAcceptProposed'>

function useDrafts(
  question: Question,
  { onAnswer, onWaitOnSomeone, onAcceptProposed }: DraftHandlers,
): Drafts {
  const [ownWords, setOwnWords] = useState(false)
  const [text, setText] = useState('')
  // The proposal whose words are being edited: read when the answer is sent, never drawn.
  const editing = useRef<string | null>(null)
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const answering = useSending()
  const waiting = useSending()
  const submit = (): void => {
    const said = text.trim()
    if (said === '') return
    answering.send(
      () => {
        const edited = editing.current
        return edited === null
          ? onAnswer(question.id, { text: said })
          : onAcceptProposed(edited, said)
      },
      () => {
        setText('')
        editing.current = null
        setOwnWords(false)
      },
    )
  }
  const wait = (): void => {
    waiting.send(
      () => onWaitOnSomeone(question.id, note.trim() === '' ? null : note.trim()),
      () => {
        setNoting(false)
        setNote('')
      },
    )
  }
  return {
    ownWords,
    toggleOwnWords: () => {
      editing.current = null
      setOwnWords(!ownWords)
    },
    text,
    setText,
    edit: (proposal) => {
      editing.current = proposal.id
      setText(proposal.text)
      setOwnWords(true)
    },
    noting,
    toggleNoting: () => setNoting(!noting),
    note,
    setNote,
    answering,
    waiting,
    submit,
    wait,
  }
}

interface OpenQuestionProps extends Pick<
  QuestionCardProps,
  | 'question'
  | 'discussed'
  | 'mentionables'
  | 'onCopyDraft'
  | 'onAcceptProposed'
  | 'onDismissProposed'
  | 'onDiscuss'
> {
  /** Where the answer shown stands. */
  step: StepShown
  /** The option shown as chosen: the one pressed, or the answer's. */
  chosen: string | null
  /** The answer in words, when the user gave their own. */
  answer: AnswerVersion | undefined
  choosing: Sending
  drafts: Drafts
  onPress: (optionId: string) => void
}

/** The card of a question still to answer, or being changed: all that can be done to it. */
function OpenQuestion({
  question,
  discussed,
  mentionables,
  onCopyDraft,
  onAcceptProposed,
  onDismissProposed,
  onDiscuss,
  step,
  chosen,
  answer,
  choosing,
  drafts,
  onPress,
}: OpenQuestionProps): ReactNode {
  const proposal = question.proposals[0]
  return (
    <article
      id={targetId({ kind: 'question', id: question.id })}
      tabIndex={-1}
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 flex-col gap-3 rounded-md px-3 py-3 outline-none focus-ring"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={ID}>{question.id}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="text-sm font-medium break-words">{question.text}</h3>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <InputDot state={step === 'sending' ? 'received' : step} />
              <span role="status" className={QUIET}>
                {STEP_WORDS[step]}
              </span>
            </span>
            {question.state === 'waiting' && (
              <Legend label="Waiting on someone">
                <span aria-hidden="true" className="flex text-muted-foreground">
                  <IconClockPause size="sm" />
                </span>
              </Legend>
            )}
          </span>
        </div>
      </div>
      {question.why !== '' && <p className={cn(QUIET, 'break-words')}>{question.why}</p>}
      <Options question={question} chosen={chosen} answering={choosing} onPress={onPress} />
      <NotSent refusal={choosing.refusal} />
      <p className={cn(QUIET, 'flex min-w-0 items-start gap-1.5 break-words')}>
        <span aria-hidden="true" className="flex shrink-0 pt-0.5">
          <IconStar size="sm" />
        </span>
        <span className="min-w-0">
          <span className="font-medium text-foreground">Recommended {question.recommended}</span>
          {question.recommendedReason === '' ? '' : ` · ${question.recommendedReason}`}
        </span>
      </p>
      {answer !== undefined && answer.text !== null && (
        <blockquote className="border-l-2 border-border pl-3 text-sm break-words">
          {answer.text}
        </blockquote>
      )}
      <ChangedAnswer question={question} />
      {question.state === 'waiting' && <WaitingBox question={question} onCopy={onCopyDraft} />}
      {proposal !== undefined && (
        <Proposed
          proposal={proposal}
          onAccept={() => onAcceptProposed(proposal.id, null)}
          onEdit={() => drafts.edit(proposal)}
          onDismiss={() => onDismissProposed(proposal.id)}
        />
      )}
      <Unfold open={drafts.ownWords}>
        <div className="flex flex-col gap-1">
          <MentionField
            label={`Your answer to ${question.id}`}
            placeholder="In your own words…"
            value={drafts.text}
            onValueChange={(value) => drafts.setText(value)}
            mentionables={mentionables}
            onSubmit={drafts.submit}
            disabled={drafts.answering.busy}
          />
          <NotSent refusal={drafts.answering.refusal} />
        </div>
      </Unfold>
      <Unfold open={drafts.noting}>
        <Input
          label="Who, or what, it waits on"
          placeholder="Optional"
          size="sm"
          value={drafts.note}
          onValueChange={drafts.setNote}
          onKeyDown={(event) => {
            if (event.key === 'Enter') drafts.wait()
          }}
          action={
            <Button
              variant="secondary"
              size="sm"
              state={drafts.waiting.busy ? 'loading' : 'idle'}
              onClick={drafts.wait}
            >
              Wait
            </Button>
          }
        />
      </Unfold>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={drafts.ownWords}
          onClick={drafts.toggleOwnWords}
        >
          In my own words
        </Button>
        {question.state === 'open' && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={drafts.noting}
            onClick={drafts.toggleNoting}
          >
            <IconClockPause size="sm" />
            I’m waiting on someone
          </Button>
        )}
        {onDiscuss !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDiscuss({ kind: 'question', id: question.id })}
          >
            <IconMessages size="sm" />
            {discussed ? 'Open the discussion' : 'Discuss'}
          </Button>
        )}
      </div>
    </article>
  )
}

/**
 * A question of the Planner: its options with the recommended one starred and why, answered by a
 * press that leaves at once (no Send) and fills the option at once, or in the user's own words
 * through the mention field; "I'm waiting on someone" with an optional note, and the Planner's
 * drafted message with Copy; an answer proposed from the ticket with Accept, Edit and Dismiss.
 * Answered, the card folds at once: the question, then its answer and Change; its dot and a word say
 * where the answer stands — Sending, Sent, With the Planner, Taken into account. A changed answer
 * is said as a change; a retired question stays, with its reason. Open or folded, the question
 * has its row to itself: the dot and its word, and the waiting clock, sit under it. Everything but a press on its
 * way and Change is drawn from the question: a card is the same live and after a restart.
 */
export function QuestionCard({
  question,
  discussed,
  mentionables,
  onAnswer,
  onWaitOnSomeone,
  onCopyDraft,
  onAcceptProposed,
  onDismissProposed,
  onDiscuss,
}: QuestionCardProps): ReactNode {
  // Change opens a folded card again until the next answer comes: the count of answers then.
  const [changingAt, setChangingAt] = useState<number | null>(null)
  // The option pressed, shown at once, until the answer it sent comes back with the question.
  const [pressed, setPressed] = useState<{ optionId: string; after: number } | null>(null)
  const folding = useTransition(fold)
  const choosing = useSending()
  const drafts = useDrafts(question, { onAnswer, onWaitOnSomeone, onAcceptProposed })
  const answer = latest(question)
  const count = question.answers.length
  const pressing =
    pressed !== null && pressed.after === count && choosing.refusal === undefined
      ? pressed.optionId
      : null
  if (RETIRED.has(question.state)) {
    return <RetiredQuestion question={question} discussed={discussed} onDiscuss={onDiscuss} />
  }
  // Answered, it folds at once to its line — on the press, before the engine has it — and stays
  // folded while the answer goes on its way. Apart from a press on its way and Change, what it
  // shows comes from the question alone: the same card live and after a restart.
  const folded =
    pressing !== null ||
    (question.state === 'answered' && answer !== undefined && changingAt !== count)
  const step: StepShown =
    pressing === null ? answerStepOf(question) : choosing.busy ? 'sending' : 'received'
  const press = (optionId: string): void => {
    // A press while an answer is on its way sends nothing: `send` keeps to one.
    choosing.send(() => {
      setPressed({ optionId, after: count })
      return onAnswer(question.id, { optionId })
    })
  }
  // Answered, the card folds to its line: the card collapses as the line comes, on `fold`.
  return (
    <AnimatePresence initial={false}>
      {folded ? (
        <motion.div
          key="line"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <AnsweredLine
            question={question}
            answer={
              pressing === null && answer !== undefined
                ? answer
                : { optionId: pressing, text: null }
            }
            step={step}
            onChange={() => setChangingAt(count)}
          />
        </motion.div>
      ) : (
        <motion.div
          key="card"
          className="overflow-hidden"
          initial={collapse}
          animate={expand}
          exit={collapse}
          transition={folding}
        >
          <OpenQuestion
            question={question}
            discussed={discussed}
            mentionables={mentionables}
            onCopyDraft={onCopyDraft}
            onAcceptProposed={onAcceptProposed}
            onDismissProposed={onDismissProposed}
            onDiscuss={onDiscuss}
            step={step}
            chosen={pressing ?? answer?.optionId ?? null}
            answer={answer}
            choosing={choosing}
            drafts={drafts}
            onPress={press}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
