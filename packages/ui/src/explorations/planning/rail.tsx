import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { DependenciesCard, VisionCard } from '../../blocks/planning/planning-cards.tsx'
import { SeverityMark } from '../../blocks/planning/planning-marks.tsx'
import { type StepState, targetId } from '../../blocks/planning/planning-progress.ts'
import type {
  Finding,
  PlanningData,
  PlanningHandlers,
  Question,
} from '../../blocks/planning/planning-types.ts'
import { ProbeChip } from '../../blocks/planning/probes.tsx'
import { QuestionCard } from '../../blocks/planning/question-card.tsx'
import { SendButton } from '../../blocks/planning/sending.tsx'
import { NeedCard, type PermissionChoice } from '../../blocks/need/need-card.tsx'
import { Face } from '../../components/face/face.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { type MarkState, StatusMark } from '../../components/status-mark/status-mark.tsx'
import {
  IconCheck,
  IconChevronRight,
  IconClockPause,
  IconEye,
  IconHelpCircle,
  IconLink,
  IconListCheck,
  IconMessages,
  IconShieldLock,
  IconTestPipe,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { type Attention, findingsToSettle } from './attention.ts'
import type { PermissionAsk } from './fixtures.ts'

/**
 * The pieces of the Planning page's rail as #193 proposes it: the Planning card that says what
 * happens (the face, one line, what runs, the four steps), the For you band that lists what waits
 * for the user — one line per kind, unfolded on demand — and the rest, one quiet line each.
 */

/** Everything the rail can do: the page's own handlers, and a permission answered. */
export interface RailHandlers extends PlanningHandlers {
  onPermission: (id: string, choice: PermissionChoice) => void
}

const STEP_MARK: Record<StepState, MarkState> = {
  todo: 'todo',
  running: 'running',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
}

/** A line that opens what it summarises: the whole width, its chevron turning as it opens. */
const LINE =
  'flex min-h-control-md w-full min-w-0 items-center gap-2 px-4 py-1.5 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const CHEVRON = 'flex shrink-0 text-muted-foreground chevron-motion data-open:rotate-90'

const QUIET = 'shrink-0 text-xs text-muted-foreground tabular-nums'

/** A body that grows from its line and folds back into it, pushing what is under it. */
function Unfolding({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  const folding = useTransition(fold)
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="body"
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

/**
 * One kind of thing, summarised in one line — its glyph, its name and how many — that unfolds to
 * its own lines.
 */
function Fold({
  glyph,
  title,
  detail,
  initiallyOpen = false,
  children,
}: {
  glyph: ReactNode
  title: string
  detail: string
  initiallyOpen?: boolean | undefined
  children: ReactNode
}): ReactNode {
  const [open, setOpen] = useState(initiallyOpen)
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <span className="flex shrink-0 text-muted-foreground">{glyph}</span>
        <span className="shrink-0 font-medium">{title}</span>
        <span className="min-w-0 truncate text-muted-foreground">{detail}</span>
      </button>
      <Unfolding open={open}>{children}</Unfolding>
    </div>
  )
}

export interface PlanningCardProps {
  attention: Attention
  data: PlanningData
  onOpenProbe: (id: string) => void
}

/**
 * Where Planning stands and what happens now, at the top of the rail: Hemera's face, which takes
 * the expression of what happens and holds still in it; the one line that says it, with what the
 * Planner does next while it works; the chips of what runs; and the four steps, one line each.
 * Nothing in it leads elsewhere: what waits for the user is right under it.
 */
export function PlanningCard({ attention, data, onOpenProbe }: PlanningCardProps): ReactNode {
  const pass = data.passes.at(-1)
  const reading =
    pass !== undefined && (pass.state === 'running' || pass.state === 'waiting_for_slot')
  const probes = data.probes.filter(
    (probe) => probe.state === 'running' || probe.state === 'preparing',
  )
  return (
    <section aria-label="Planning" className="rounded-xl">
      <Frame header={<FrameHeader icon={<IconListCheck size="md" />} title="Planning" />}>
        <div className="flex min-w-0 items-start gap-3 px-4 py-3">
          <Face state={attention.face} size="md" legend />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p role="status" className="text-sm font-medium break-words">
              {attention.now}
            </p>
            {attention.next !== null && (
              <p className="text-xs break-words text-muted-foreground">
                Next: {attention.next.charAt(0).toLowerCase() + attention.next.slice(1)}
              </p>
            )}
            {(reading || probes.length > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {reading && (
                  <LiveChip
                    name={`Cold read ${pass.label}`}
                    icon={<IconEye size="sm" />}
                    state="running"
                    startedAt={pass.startedAt}
                    endedAt={null}
                    glance={{
                      kind: 'helper',
                      type: 'Cold read',
                      step:
                        pass.state === 'waiting_for_slot'
                          ? 'Waits for a free agent'
                          : 'A fresh reader goes through the Spec',
                    }}
                  />
                )}
                {probes.map((probe) => (
                  <ProbeChip key={probe.id} probe={probe} onOpen={onOpenProbe} />
                ))}
              </div>
            )}
          </div>
        </div>
        <ol
          aria-label="Where Planning stands"
          className="flex flex-col border-t border-border py-1"
        >
          {attention.steps.map((step) => (
            <li
              key={step.id}
              aria-label={step.title}
              className="flex min-h-control-sm min-w-0 items-center gap-2.5 px-4"
            >
              <StatusMark state={STEP_MARK[step.state]} size="sm" legend />
              <span
                className={cn(
                  'shrink-0 text-sm',
                  step.state === 'todo' ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                {step.title}
              </span>
              {(step.state !== 'todo' || step.id === 'spec') && step.detail !== null && (
                <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                  {step.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
      </Frame>
    </section>
  )
}

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

export interface QuestionsProps {
  data: PlanningData
  mentionables: readonly Mentionable[]
  handlers: RailHandlers
}

/**
 * The questions that wait, one open at a time and the others one line each, in the order they
 * were asked. Answered, a question folds to its line where it stands, and the next to answer opens
 * right under it with the focus: what the user looked at stays where it was, and nothing scrolls.
 */
export function QuestionsToAnswer({ data, mentionables, handlers }: QuestionsProps): ReactNode {
  const all = data.waves.flatMap((wave) => wave.questions)
  const byId = new Map(all.map((question) => [question.id, question]))
  // The questions listed are those that waited when the page was drawn: one answered stays in place.
  const [listed] = useState(() =>
    all
      .filter((question) => question.state === 'open' || question.state === 'waiting')
      .map((question) => question.id),
  )
  const [current, setCurrent] = useState<string | null>(
    () => all.find((question) => question.state === 'open')?.id ?? null,
  )
  const [answeredHere, setAnsweredHere] = useState<ReadonlySet<string>>(new Set())
  // The question an answer opened.
  const [brought, setBrought] = useState<string | null>(null)
  const folding = useTransition(fold)

  const toAnswer = (id: string): boolean => byId.get(id)?.state === 'open' && !answeredHere.has(id)

  const answer: RailHandlers['onAnswer'] = (id, given) => {
    const at = listed.indexOf(id)
    const next =
      [...listed.slice(at + 1), ...listed.slice(0, Math.max(at, 0))].find(
        (other) => other !== id && toAnswer(other),
      ) ?? null
    setAnsweredHere(new Set(answeredHere).add(id))
    setBrought(next)
    setCurrent(next)
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
      {listed.map((id) => {
        const question = byId.get(id)
        if (question === undefined) return null
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
              <QuestionLine question={question} onOpen={() => setCurrent(id)} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A finding summarised: its severity, its first line and where it is in the Spec. Unfolded, the
 * whole of it, and Dismiss.
 */
function FindingLine({
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

/** A permission summarised: who asks and the command; unfolded, its card with its choices. */
function PermissionLine({
  permission,
  onPermission,
}: {
  permission: PermissionAsk
  onPermission: RailHandlers['onPermission']
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${permission.who} asks to run ${permission.command}`}
        className={LINE}
        onClick={() => setOpen(!open)}
      >
        <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">
          {permission.who}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{permission.command}</span>
        <span className={QUIET}>{permission.when}</span>
      </button>
      <Unfolding open={open}>
        <div className="px-3 pb-3">
          <NeedCard
            ask={{
              kind: 'permission',
              command: permission.command,
              agentReason: permission.agentReason,
              hemeraReason: permission.hemeraReason,
              choices: ['allow-once', 'allow-for-mission', 'deny'],
            }}
            title={`${permission.who} asks to run a command`}
            when={permission.when}
            role={permission.who.startsWith('Probe') ? 'Probe' : 'Planner'}
            planning
            onPermission={(choice) => onPermission(permission.id, choice)}
          />
        </div>
      </Unfolding>
    </li>
  )
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** What waits for the user, in words: "5 to answer · 1 waits on someone". */
function questionsDetail(data: PlanningData): string {
  const all = data.waves.flatMap((wave) => wave.questions)
  const open = all.filter((question) => question.state === 'open').length
  const waiting = all.filter((question) => question.state === 'waiting').length
  return [
    ...(open > 0 ? [`${String(open)} to answer`] : []),
    ...(waiting > 0 ? [plural(waiting, 'waits on someone', 'wait on someone')] : []),
  ].join(' · ')
}

export interface ForYouProps extends QuestionsProps {
  attention: Attention
  permissions: readonly PermissionAsk[]
  /** Whether the questions stand open as the page is drawn; the other kinds are always folded. */
  questionsOpen?: boolean | undefined
}

/**
 * What waits for the user, the agents blocked first: the permissions, the questions, the findings
 * to settle. Each kind is one line until the user opens it; the questions stand open, one question
 * whole and the others one line each, because answering them is the work of the page.
 */
export function ForYou({
  attention,
  permissions,
  data,
  mentionables,
  handlers,
  questionsOpen = true,
}: ForYouProps): ReactNode {
  const findings = findingsToSettle(data)
  const asked = data.waves
    .flatMap((wave) => wave.questions)
    .some((question) => question.state === 'open' || question.state === 'waiting')
  const pass = data.passes.at(-1)
  const empty = permissions.length === 0 && !asked && findings.length === 0
  return (
    <section aria-label="For you" className="flex flex-col gap-3">
      <SectionHead
        title="For you"
        count={attention.waiting > 0 ? attention.waiting : undefined}
        calls
      />
      {empty ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCheck size="sm" />
          {attention.ready ? 'Only Freeze is left' : 'Nothing waits for you'}
        </p>
      ) : (
        <Frame>
          <div className="flex flex-col divide-y divide-border">
            {permissions.length > 0 && (
              <Fold
                glyph={<IconShieldLock size="sm" />}
                title="Permissions"
                detail={`${String(permissions.length)} · ${[...new Set(permissions.map((one) => one.who))].join(', ')}`}
              >
                <ul aria-label="Permissions" className="flex flex-col pb-1">
                  {permissions.map((permission) => (
                    <PermissionLine
                      key={permission.id}
                      permission={permission}
                      onPermission={handlers.onPermission}
                    />
                  ))}
                </ul>
              </Fold>
            )}
            {asked && (
              <Fold
                glyph={<IconHelpCircle size="sm" />}
                title="Questions"
                detail={questionsDetail(data)}
                initiallyOpen={questionsOpen}
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
          </div>
        </Frame>
      )}
    </section>
  )
}

export interface EverythingElseProps {
  data: PlanningData
  mentionables: readonly Mentionable[]
  handlers: RailHandlers
}

/**
 * What no longer waits, one quiet line each, every one folded: the questions answered, what the
 * cold read settled, the Probes that ended, the dependencies, and the vision, which the user may
 * give at any time.
 */
export function EverythingElse({ data, mentionables, handlers }: EverythingElseProps): ReactNode {
  const answered = data.waves
    .flatMap((wave) => wave.questions)
    .filter((question) => question.state === 'answered')
  const taking = answered.filter((question) => question.answers.at(-1)?.inputState !== 'integrated')
  const pass = data.passes.at(-1)
  const settled =
    pass?.state === 'done' ? pass.findings.filter((finding) => finding.fate !== 'open') : []
  const ended = data.probes.filter(
    (probe) => probe.state !== 'running' && probe.state !== 'preparing',
  )
  const dependencies = data.dependencies.filter((dependency) => dependency.state !== 'rejected')
  return (
    <section aria-label="Everything else" className="flex flex-col">
      {answered.length > 0 && (
        <Fold
          glyph={<IconCheck size="sm" />}
          title="Answered"
          detail={
            taking.length > 0
              ? `${String(answered.length)} · ${String(taking.length)} being taken into account`
              : String(answered.length)
          }
        >
          <ul aria-label="Answered questions" className="flex flex-col gap-1 pb-2">
            {answered.map((question) => (
              <li key={question.id}>
                <QuestionCard
                  question={question}
                  discussed={false}
                  mentionables={mentionables}
                  onAnswer={handlers.onAnswer}
                  onWaitOnSomeone={handlers.onWaitOnSomeone}
                  onCopyDraft={handlers.onCopyDraft}
                  onAcceptProposed={handlers.onAcceptProposed}
                  onDismissProposed={handlers.onDismissProposed}
                  onDiscuss={handlers.onDiscuss}
                />
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {settled.length > 0 && pass !== undefined && (
        <Fold
          glyph={<IconEye size="sm" />}
          title={`Cold read ${pass.label}`}
          detail={`${String(settled.length)} settled`}
        >
          <ul aria-label="Settled findings" className="flex flex-col pb-1">
            {settled.map((finding) => (
              <FindingLine key={finding.id} finding={finding} onDismiss={undefined} />
            ))}
          </ul>
        </Fold>
      )}
      {ended.length > 0 && (
        <Fold
          glyph={<IconTestPipe size="sm" />}
          title="Probes"
          detail={`${String(ended.length)} ended`}
        >
          <div className="flex flex-wrap gap-1.5 px-4 pb-2 pl-10">
            {ended.map((probe) => (
              <ProbeChip key={probe.id} probe={probe} onOpen={handlers.onOpenProbe} />
            ))}
          </div>
        </Fold>
      )}
      {dependencies.length > 0 && (
        <Fold
          glyph={<IconLink size="sm" />}
          title="Dependencies"
          detail={String(dependencies.length)}
        >
          <div className="pb-2">
            <DependenciesCard
              dependencies={dependencies}
              frozen={data.frozen}
              onDecide={handlers.onDecideDependency}
            />
          </div>
        </Fold>
      )}
      {!data.frozen && (
        <Fold
          glyph={<IconMessages size="sm" />}
          title="Your vision"
          detail={
            data.visions.length === 0 ? 'At any time' : `${String(data.visions.length)} given`
          }
        >
          <div className="pb-2">
            <VisionCard
              visions={data.visions}
              mentionables={mentionables}
              onGive={handlers.onGiveVision}
            />
          </div>
        </Fold>
      )}
    </section>
  )
}
