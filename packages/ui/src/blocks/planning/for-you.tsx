import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { NeedCard } from '../need/need-card.tsx'
import type { NeedsYouListProps } from '../need/needs-you-list.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import {
  IconCheck,
  IconClockPause,
  IconEye,
  IconFlask,
  IconHelpCircle,
  IconShieldLock,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { type Attention, findingsToSettle } from './attention.ts'
import { TicketCard, TriageCard } from './planning-cards.tsx'
import { SeverityMark } from './planning-marks.tsx'
import { leftToAnswer, targetId } from './planning-progress.ts'
import {
  type Finding,
  type PlanningData,
  type PlanningHandlers,
  type PlanningNeed,
  type Question,
  toLookAt,
} from './planning-types.ts'
import { PrototypeLine } from './prototypes.tsx'
import { QuestionCard } from './question-card.tsx'
import { Fold, LINE, QUIET, Unfolding } from './rail-fold.tsx'
import { SendButton } from './sending.tsx'

/**
 * For you, under the Planning page's stage card: what waits for the user, the agents blocked
 * first — the mission's needs, the questions, the findings to settle — one line per kind that
 * unfolds to one line per item, each item to the whole of it.
 */

const waits = (question: Question): boolean =>
  question.state === 'open' || question.state === 'waiting'

/** A question summarised: its id and its text on one line, the dot of what it waits for. */
function QuestionLine({ question, onOpen }: { question: Question; onOpen: () => void }): ReactNode {
  const someone = question.state === 'waiting'
  return (
    <button type="button" aria-expanded={false} className={LINE} onClick={onOpen}>
      <span className="w-icon-sm shrink-0 font-mono text-xs text-muted-foreground">
        {question.id}
      </span>
      <span className="min-w-0 flex-1 truncate">{question.text}</span>
      {someone ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <IconClockPause size="sm" />
          Waits on someone
        </span>
      ) : (
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
      )}
    </button>
  )
}

export interface QuestionsToAnswerProps {
  data: PlanningData
  mentionables: readonly Mentionable[]
  handlers: PlanningHandlers
}

/**
 * The questions that wait, one list in the order they were asked: one open at a time, the others
 * one line each. Answered, a question folds to its line where it stands, and the next to answer
 * opens right under it with the focus: what the user looked at stays where it was, and nothing
 * scrolls. A question asked while the page is open joins the list where it was asked.
 */
export function QuestionsToAnswer({
  data,
  mentionables,
  handlers,
}: QuestionsToAnswerProps): ReactNode {
  // The question open as the list is drawn: the first to answer. It stays open once put on hold.
  const [chosen, setChosen] = useState<string | null>(
    () => data.questions.find((question) => question.state === 'open')?.id ?? null,
  )
  // The questions answered here stay in place, folded, until the page is drawn again.
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<string>>(new Set())
  // The question an answer opened.
  const [brought, setBrought] = useState<string | null>(null)
  const folding = useTransition(fold)
  const listed = data.questions.filter(
    (question) => waits(question) || answeredHere.has(question.id),
  )
  const toAnswer = (question: Question): boolean =>
    question.state === 'open' && !answeredHere.has(question.id)
  // The question open: the one chosen while it is listed, else the first to answer, which is then
  // kept as chosen so that it stays open once put on hold.
  const kept = listed.some((question) => question.id === chosen)
  const first = listed.find(toAnswer)?.id ?? null
  if (!kept && first !== null) setChosen(first)
  const current = kept ? chosen : first

  const answer: PlanningHandlers['onAnswer'] = (id, given) => {
    const at = listed.findIndex((question) => question.id === id)
    const next =
      [...listed.slice(at + 1), ...listed.slice(0, Math.max(at, 0))].find(
        (other) => other.id !== id && toAnswer(other),
      )?.id ?? null
    setAnsweredHere(new Set(answeredHere).add(id))
    setBrought(next)
    setChosen(next)
    return handlers.onAnswer(id, given)
  }

  // The question an answer opened takes the focus where it stands, right under the line the answered
  // one folded to, which the user was looking at: the page does not scroll.
  useEffect(() => {
    if (brought === null) return
    document
      .getElementById(targetId({ kind: 'question', id: brought }))
      ?.focus({ preventScroll: true })
  }, [brought])

  return (
    <ul aria-label="Questions to answer" className="flex flex-col divide-y divide-border">
      {listed.map((question) => {
        const { id } = question
        const whole = id === current || answeredHere.has(id) || question.state === 'answered'
        return (
          <li key={id}>
            {whole ? (
              <motion.div
                initial={id === current && brought === id ? collapse : false}
                animate={expand}
                transition={folding}
                className="overflow-hidden"
              >
                <QuestionCard
                  question={question}
                  discussed={data.discussions.some(
                    (discussion) =>
                      discussion.item.kind === 'question' && discussion.item.id === id,
                  )}
                  mentionables={mentionables}
                  onAnswer={answer}
                  onWaitOnSomeone={handlers.onWaitOnSomeone}
                  onCopyDraft={handlers.onCopyDraft}
                  onAcceptProposed={handlers.onAcceptProposed}
                  onDismissProposed={handlers.onDismissProposed}
                  onDiscuss={handlers.onDiscuss}
                />
              </motion.div>
            ) : (
              <QuestionLine question={question} onOpen={() => setChosen(id)} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A finding summarised: its severity, its first line and where it is in the Spec. Unfolded, the
 * whole of it, what became of it, and Dismiss while it is open.
 */
export function FindingLine({
  finding,
  onDismiss,
}: {
  finding: Finding
  onDismiss: ((id: string) => Promise<void>) | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${finding.id} · ${finding.text}`}
        className={cn(LINE, 'items-start')}
        onClick={() => setOpen(!open)}
      >
        <span className="flex pt-0.5">
          <SeverityMark severity={finding.severity} />
        </span>
        <span className={cn('min-w-0 flex-1', open ? 'break-words' : 'truncate')}>
          {finding.text}
        </span>
        <span className={cn(QUIET, 'pt-0.5 font-mono')}>{finding.where.join(' · ')}</span>
      </button>
      <Unfolding open={open}>
        <div className="flex items-center gap-2 px-4 pb-2 pl-10">
          {finding.fate === 'fixed' && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <IconCheck size="sm" />
              <span className="break-words">Fixed by the Planner: {finding.fixedWhat}</span>
            </span>
          )}
          {finding.fate === 'asked' && (
            <span className="text-xs text-muted-foreground">Asked as {finding.questionId}</span>
          )}
          {finding.fate === 'dismissed' && (
            <span className="text-xs text-muted-foreground">Dismissed</span>
          )}
          {finding.fate === 'open' && onDismiss !== undefined && (
            <SendButton
              variant="secondary"
              size="sm"
              aria-label={`Dismiss ${finding.id}`}
              onSend={() => onDismiss(finding.id)}
            >
              Dismiss
            </SendButton>
          )}
        </div>
      </Unfolding>
    </li>
  )
}

/** A need summarised: who asks and what — the command of a permission; unfolded, its card. */
function NeedLine({ need, on }: { need: PlanningNeed; on: NeedsYouListProps['on'] }): ReactNode {
  const [open, setOpen] = useState(false)
  const { ask } = need.need
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          ask.kind === 'permission'
            ? `${need.who} asks to run ${ask.command}`
            : `${need.who}: ${need.need.title}`
        }
        className={LINE}
        onClick={() => setOpen(!open)}
      >
        <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{need.who}</span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            ask.kind === 'permission' && 'font-mono text-xs',
          )}
        >
          {ask.kind === 'permission' ? ask.command : need.need.title}
        </span>
        <span className={QUIET}>{need.need.when}</span>
      </button>
      <Unfolding open={open}>
        <div className="px-3 pb-3">
          <NeedCard {...need.need} {...on(need.id)} />
        </div>
      </Unfolding>
    </li>
  )
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

export interface ForYouProps {
  attention: Attention
  data: PlanningData
  /** The mission's needs that wait: most often the permissions its agents ask for. */
  needs: readonly PlanningNeed[]
  /** Every answer a need's card gives, with the need it answers. */
  onNeed: NeedsYouListProps['on']
  mentionables: readonly Mentionable[]
  handlers: PlanningHandlers
}

/**
 * What waits for the user, the agents blocked first: the needs, the questions, the findings to
 * settle, the Prototypers' results to look at, each kind one line until the user opens it — but the questions, which stand open
 * because answering them is the work of the page. The Planner's triage and a change of the
 * ticket, rare and urgent, stand whole above them. "Nothing waits for you" when nothing does,
 * "Only Freeze is left" when only Freeze is, a line that starts where a framed line would.
 */
export function ForYou({
  attention,
  data,
  needs,
  onNeed,
  mentionables,
  handlers,
}: ForYouProps): ReactNode {
  const findings = findingsToSettle(data)
  const asked = data.questions.some(waits)
  const pass = data.passes.at(-1)
  const permissions = needs.every((need) => need.need.ask.kind === 'permission')
  const prototypes = data.prototypes.filter(toLookAt)
  const lines = needs.length > 0 || asked || findings.length > 0 || prototypes.length > 0
  const empty = !lines && data.triage === null && data.ticket === null
  return (
    <section aria-label="For you" className="flex flex-col gap-3">
      <SectionHead
        title="For you"
        count={attention.waiting > 0 ? attention.waiting : undefined}
        calls
      />
      {data.triage !== null && (
        <TriageCard
          triage={data.triage}
          onKeepPlanning={handlers.onKeepPlanning}
          onOpenMission={handlers.onOpenMission}
          onAskInChat={handlers.onAskInChat}
        />
      )}
      {data.ticket !== null && (
        <TicketCard ticket={data.ticket} onSeen={handlers.onSeenTicketChange} />
      )}
      {empty && (
        <p className="flex min-h-control-md items-center gap-2 px-6 py-1.5 text-sm text-muted-foreground">
          <IconCheck size="sm" />
          {attention.ready ? 'Only Freeze is left' : 'Nothing waits for you'}
        </p>
      )}
      {lines && (
        <Frame>
          <div className="flex flex-col divide-y divide-border">
            {needs.length > 0 && (
              <Fold
                glyph={permissions ? <IconShieldLock size="sm" /> : <IconHelpCircle size="sm" />}
                title={permissions ? 'Permissions' : 'Needs'}
                detail={`${String(needs.length)} · ${[...new Set(needs.map((one) => one.who))].join(', ')}`}
              >
                <ul
                  aria-label={permissions ? 'Permissions' : 'Needs'}
                  className="flex flex-col pb-1"
                >
                  {needs.map((need) => (
                    <NeedLine key={need.id} need={need} on={onNeed} />
                  ))}
                </ul>
              </Fold>
            )}
            {asked && (
              <Fold
                glyph={<IconHelpCircle size="sm" />}
                title="Questions"
                detail={leftToAnswer(data) ?? ''}
                initiallyOpen
              >
                <div className="border-t border-border">
                  <QuestionsToAnswer data={data} mentionables={mentionables} handlers={handlers} />
                </div>
              </Fold>
            )}
            {findings.length > 0 && pass !== undefined && (
              <Fold
                glyph={<IconEye size="sm" />}
                title={`Cold read ${pass.label}`}
                detail={plural(findings.length, 'finding to settle', 'findings to settle')}
              >
                <ul aria-label="Findings to settle" className="flex flex-col pb-1">
                  {findings.map((finding) => (
                    <FindingLine
                      key={finding.id}
                      finding={finding}
                      onDismiss={handlers.onDismissFinding}
                    />
                  ))}
                </ul>
              </Fold>
            )}
            {prototypes.length > 0 && (
              <Fold
                glyph={<IconFlask size="sm" />}
                title={prototypes.length === 1 ? 'A prototype to look at' : 'Prototypes to look at'}
                detail={`${String(prototypes.length)} · ${prototypes.map((one) => one.label).join(', ')}`}
              >
                <ul aria-label="Prototypes to look at" className="flex flex-col pb-1">
                  {prototypes.map((prototype) => (
                    <PrototypeLine
                      key={prototype.id}
                      prototype={prototype}
                      onJudge={handlers.onJudgePrototype}
                    />
                  ))}
                </ul>
              </Fold>
            )}
          </div>
        </Frame>
      )}
    </section>
  )
}
