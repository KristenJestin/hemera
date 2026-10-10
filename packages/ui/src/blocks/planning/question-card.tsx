import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { MentionField } from '../../components/mention-field/mention-field.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconClockPause, IconCopy, IconMessages, IconStar } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { InputDot } from './planning-marks.tsx'
import { NotSent, SendButton, useSending } from './sending.tsx'
import {
  type AnswerVersion,
  type PlanningHandlers,
  type ProposedAnswer,
  type Question,
  latest,
} from './planning-types.ts'

const OPTION =
  'flex w-full min-w-0 items-start gap-2 rounded-md border border-border px-3 py-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion aria-pressed:border-primary aria-pressed:bg-muted aria-disabled:opacity-50 aria-busy:opacity-100'

const LETTER = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

const QUIET = 'text-xs text-muted-foreground'

const ID = 'shrink-0 font-mono text-xs leading-5 text-muted-foreground'

const BOX = 'flex flex-col gap-2 rounded-md border border-border px-3 py-2'

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
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 items-start gap-2 px-3 py-2 text-sm text-muted-foreground"
    >
      <span className={ID}>{question.id}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 break-words">{question.text}</span>
        <span className="text-xs break-words">{why}</span>
      </div>
      {discussed && (
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
      <span className={ID}>{question.id}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 break-words">{question.text}</span>
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

/**
 * The options, the recommended one starred; a press answers at once. While the answer is on its
 * way, the option pressed works and the others wait: a second press sends nothing.
 */
function Options({
  question,
  onAnswer,
}: {
  question: Question
  onAnswer: (optionId: string) => Promise<void>
}): ReactNode {
  const chosen = latest(question)?.optionId ?? null
  const answering = useSending()
  const [pressed, setPressed] = useState<string | null>(null)
  return (
    <ul aria-label={`Options of ${question.id}`} className="flex flex-col gap-1.5">
      {question.options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={OPTION}
            aria-pressed={chosen === option.id}
            aria-busy={answering.busy && pressed === option.id}
            aria-disabled={answering.busy}
            aria-label={`${option.id} ${option.label}${option.id === question.recommended ? ', recommended' : ''}`}
            onClick={() =>
              // A press while an answer is on its way sends nothing: `send` keeps to one.
              answering.send(() => {
                setPressed(option.id)
                return onAnswer(option.id)
              })
            }
          >
            <span className={LETTER}>{option.id}</span>
            <span className="min-w-0 flex-1 font-medium break-words">{option.label}</span>
            {answering.busy && pressed === option.id && (
              <span className="flex shrink-0 pt-0.5">
                <Loading size="sm" label="Sending" />
              </span>
            )}
            {option.id === question.recommended && (
              <span
                aria-hidden="true"
                className="flex shrink-0 pt-0.5 text-primary"
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
  | 'onAnswer'
  | 'onWaitOnSomeone'
  | 'onCopyDraft'
  | 'onAcceptProposed'
  | 'onDismissProposed'
  | 'onDiscuss'
> {
  question: Question
  /** Whether a discussion on it exists already: Discuss then opens it. */
  discussed: boolean
  /** An answered question as one line, its answer and its dot, until Change opens it again. */
  foldAnswered: boolean
  /** What the user's own words can mention. */
  mentionables: readonly Mentionable[]
}

/**
 * A question of the Planner: its options with the recommended one and why, answered by a press
 * that leaves at once (no Send), or in the user's own words through the mention field; "I'm
 * waiting on someone" with an optional note, and the Planner's drafted message with Copy; an
 * answer proposed from the ticket with Accept, Edit and Dismiss; the answer's state as a dot, a
 * changed answer said as a change. A retired question stays, with its reason.
 */
export function QuestionCard({
  question,
  discussed,
  foldAnswered,
  mentionables,
  onAnswer,
  onWaitOnSomeone,
  onCopyDraft,
  onAcceptProposed,
  onDismissProposed,
  onDiscuss,
}: QuestionCardProps): ReactNode {
  const [ownWords, setOwnWords] = useState(false)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const [changing, setChanging] = useState(false)
  const answering = useSending()
  const waiting = useSending()
  // Answered before the page opened: one line. Answered here: the card stays in place, answered.
  const [answeredBefore] = useState(question.state === 'answered')
  const answer = latest(question)
  if (RETIRED.has(question.state)) {
    return <RetiredQuestion question={question} discussed={discussed} onDiscuss={onDiscuss} />
  }
  if (foldAnswered && answeredBefore && answer !== undefined && !changing) {
    return <AnsweredLine question={question} answer={answer} onChange={() => setChanging(true)} />
  }
  const proposal = question.proposals[0]
  const submit = (): void => {
    const said = text.trim()
    if (said === '') return
    answering.send(
      () =>
        editing === null ? onAnswer(question.id, { text: said }) : onAcceptProposed(editing, said),
      () => {
        setText('')
        setEditing(null)
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
  return (
    <article
      aria-label={`${question.id} · ${question.text}`}
      className="flex min-w-0 flex-col gap-3 px-3 py-3"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className={ID}>{question.id}</span>
        <h3 className="min-w-0 flex-1 text-sm font-medium break-words">{question.text}</h3>
        {question.state === 'waiting' && (
          <Legend label="Waiting on someone">
            <span aria-hidden="true" className="flex text-muted-foreground">
              <IconClockPause size="sm" />
            </span>
          </Legend>
        )}
        {answer !== undefined && <InputDot state={answer.inputState} />}
      </div>
      <Options question={question} onAnswer={(optionId) => onAnswer(question.id, { optionId })} />
      <p className={cn(QUIET, 'break-words')}>
        <span className="font-medium text-foreground">Recommended {question.recommended}</span>
        {question.recommendedReason === '' ? '' : ` · ${question.recommendedReason}`}
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
          onEdit={() => {
            setEditing(proposal.id)
            setText(proposal.text)
            setOwnWords(true)
          }}
          onDismiss={() => onDismissProposed(proposal.id)}
        />
      )}
      <Unfold open={ownWords}>
        <div className="flex flex-col gap-1">
          <MentionField
            label={`Your answer to ${question.id}`}
            placeholder="In your own words…"
            value={text}
            onValueChange={(value) => setText(value)}
            mentionables={mentionables}
            onSubmit={submit}
            disabled={answering.busy}
          />
          <NotSent refusal={answering.refusal} />
        </div>
      </Unfold>
      <Unfold open={noting}>
        <Input
          label="Who, or what, it waits on"
          placeholder="Optional"
          size="sm"
          value={note}
          onValueChange={setNote}
          onKeyDown={(event) => {
            if (event.key === 'Enter') wait()
          }}
          action={
            <Button
              variant="secondary"
              size="sm"
              state={waiting.busy ? 'loading' : 'idle'}
              onClick={wait}
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
          aria-expanded={ownWords}
          onClick={() => {
            setEditing(null)
            setOwnWords(!ownWords)
          }}
        >
          In my own words
        </Button>
        {question.state === 'open' && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={noting}
            onClick={() => setNoting(!noting)}
          >
            <IconClockPause size="sm" />
            I’m waiting on someone
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDiscuss({ kind: 'question', id: question.id })}
        >
          <IconMessages size="sm" />
          {discussed ? 'Open the discussion' : 'Discuss'}
        </Button>
      </div>
    </article>
  )
}
