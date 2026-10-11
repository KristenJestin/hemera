import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'

import { ColdReadReport } from '../../blocks/planning/cold-read.tsx'
import {
  DependenciesCard,
  TicketCard,
  TriageCard,
  VisionCard,
} from '../../blocks/planning/planning-cards.tsx'
import { ChangedMark } from '../../blocks/planning/planning-marks.tsx'
import {
  type Planner,
  type PlanningTarget,
  allAnswered,
  leftToAnswer,
  planningSteps,
  targetId,
} from '../../blocks/planning/planning-progress.ts'
import { PlanningSteps } from '../../blocks/planning/planning-steps.tsx'
import { SendButton } from '../../blocks/planning/sending.tsx'
import {
  type DiscussionItem,
  type PlanningData,
  type PlanningHandlers,
  type Wave,
  openBySection,
  unsettled,
} from '../../blocks/planning/planning-types.ts'
import { ProbesCard } from '../../blocks/planning/probes.tsx'
import { QuestionCard } from '../../blocks/planning/question-card.tsx'
import { SectionsNav, SpecRead } from '../../blocks/planning/spec-read.tsx'
import { Button } from '../../components/button/button.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { IconCheck, IconChevronRight } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { PageError } from '../page.tsx'

/**
 * The Planning page: the base of a mission's frame while the Planner writes the Spec with the
 * user (#100, reworked by #169 so that the user always knows what happens and what to do).
 *
 * The centre holds what matters to read, the Spec, at its measure, with its eight sections and
 * their state down the left — the green check only once no open question touches a section; what
 * changed since the last read is marked where it changed, with one line on top and Mark as read.
 * The right-hand rail holds, in an order that never changes: where Planning stands (the four steps,
 * the Planner's next step, the vision to give meanwhile); the Planner's triage answer and what
 * changed on the ticket, when they wait; the questions, the waves still open newest first and,
 * under them, each wave whose every question is settled folded to one line; the cold read; the
 * Probes; the dependencies; and the vision, a field always there while the Spec is written. A
 * question looks the same however the page was reached: it is drawn from its state alone.
 *
 * The head's Now line and the steps lead to what they name: `focusTarget` scrolls to it and gives
 * it the focus. Discuss and a Probe's report open as views over the page: their ids are below,
 * and the frame that holds the page holds them.
 */

/** The id of the view of a discussion over the page. */
export const discussionViewId = (item: DiscussionItem): string =>
  `discussion:${item.kind}:${item.id}`

/** The id of the view of a Probe's report over the page. */
export const probeViewId = (id: string): string => `probe:${id}`

/**
 * Brings the user to what a target names: scrolled into view and focused — a card or a section
 * itself, or the control inside it for Freeze and the vision.
 */
export function focusTarget(target: PlanningTarget): void {
  const element = document.getElementById(targetId(target))
  if (element === null) return
  const inside = element.hasAttribute('data-focus-inside')
    ? element.querySelector<HTMLElement>('button, [role="textbox"]')
    : null
  element.scrollIntoView({ block: 'nearest' })
  ;(inside ?? element).focus({ preventScroll: inside === null })
}

/** The Planner when the page is not told: between its turns. */
const BETWEEN_TURNS: Planner = { state: 'idle', doing: null, next: null, reason: null }

export interface PlanningPageProps extends PlanningHandlers {
  /** The page's data; null while the first read is on its way. */
  data: PlanningData | null
  /**
   * Why it could not be read, in words; once drawn, why it stopped following the engine, said
   * above the columns with Try again while what was read stays.
   */
  error?: string | undefined
  onRetry: () => void
  /** What the user's own words can mention. */
  mentionables: readonly Mentionable[]
  /** The Planner's session, for where Planning stands; between its turns when left out. */
  planner?: Planner | undefined
  /** Whether the Planner declared the Spec complete. */
  declaredComplete?: boolean | undefined
}

const COLUMNS = 'flex min-w-0 items-start gap-8 px-8 pt-2 pb-10'

const NAV = 'sticky top-2 w-settings-nav shrink-0 self-start'

const MIDDLE = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-view-narrow min-w-0 shrink-0 flex-col gap-6'

const STRIP =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md border border-border px-3 text-sm'

/** One wave, its questions in the order asked; appearing, it pushes the rail down smoothly. */
function WaveList({
  wave,
  data,
  props,
}: {
  wave: Wave
  data: PlanningData
  props: PlanningPageProps
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Wave {wave.number}
        <span className="font-normal text-muted-foreground">{wave.askedAt}</span>
      </h3>
      <Frame>
        <ul
          aria-label={`Wave ${String(wave.number)}`}
          className="flex flex-col divide-y divide-border"
        >
          {wave.questions.map((question) => (
            <li key={question.id}>
              <QuestionCard
                question={question}
                discussed={data.discussions.some(
                  (discussion) =>
                    discussion.item.kind === 'question' && discussion.item.id === question.id,
                )}
                mentionables={props.mentionables}
                onAnswer={props.onAnswer}
                onWaitOnSomeone={props.onWaitOnSomeone}
                onCopyDraft={props.onCopyDraft}
                onAcceptProposed={props.onAcceptProposed}
                onDismissProposed={props.onDismissProposed}
                onDiscuss={props.onDiscuss}
              />
            </li>
          ))}
        </ul>
      </Frame>
    </div>
  )
}

/**
 * The question to answer after this one, as the rail lists them — the waves still open newest
 * first — the one below first, else the first above; null when none is left.
 */
function nextToAnswer(data: PlanningData, answered: string): string | null {
  const order = [...data.waves]
    .reverse()
    .flatMap((wave) => wave.questions)
    .filter((question) => question.state === 'open')
    .map((question) => question.id)
  const at = order.indexOf(answered)
  const rest = [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))].filter(
    (id) => id !== answered,
  )
  return rest[0] ?? null
}

/** A wave whose every question is answered and taken into account, or retired. */
const settledWave = (wave: Wave): boolean =>
  wave.questions.every((question) => !unsettled(question))

/** A settled wave as one line that opens its questions, each one line with Change. */
function SettledWave({
  wave,
  data,
  props,
}: {
  wave: Wave
  data: PlanningData
  props: PlanningPageProps
}): ReactNode {
  const [open, setOpen] = useState(false)
  const folding = useTransition(fold)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-fit items-center gap-1.5 rounded-sm text-sm outline-none focus-ring hover-motion hover:text-primary"
        onClick={() => setOpen(!open)}
      >
        <span className="flex chevron-motion" data-open={open ? '' : undefined}>
          <IconChevronRight size="sm" />
        </span>
        <span className="font-semibold">Wave {wave.number}</span>
        <span className="text-muted-foreground">· {wave.questions.length} settled</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="questions"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <WaveList wave={wave} data={data} props={props} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The questions: the waves still open, newest first, then the settled ones, each folded to a
 * line. A wave moves down once, as a whole, when its last question is taken into account.
 */
function Questions({ data, props }: { data: PlanningData; props: PlanningPageProps }): ReactNode {
  const folding = useTransition(fold)
  if (data.frozen || data.waves.length === 0) return null
  const newestFirst = [...data.waves].reverse()
  const open = newestFirst.filter((wave) => !settledWave(wave))
  const settled = newestFirst.filter(settledWave)
  const left = leftToAnswer(data)
  const done = allAnswered(data)
  return (
    <section aria-label="Questions" className="flex flex-col gap-3">
      <SectionHead
        title="Questions"
        actions={
          left === null ? undefined : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
              {left}
            </span>
          )
        }
      />
      {done !== null && (
        <p
          id={targetId({ kind: 'questions' })}
          tabIndex={-1}
          role="status"
          className="flex items-center gap-2 rounded-sm text-sm outline-none focus-ring"
        >
          <span className="flex text-success">
            <IconCheck size="sm" />
          </span>
          {done}
        </p>
      )}
      <AnimatePresence initial={false}>
        {open.map((wave) => (
          <motion.div
            key={wave.number}
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <WaveList wave={wave} data={data} props={props} />
          </motion.div>
        ))}
        {settled.map((wave) => (
          <motion.div
            key={`settled-${String(wave.number)}`}
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <SettledWave wave={wave} data={data} props={props} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  )
}

/** The page on its way: the rows of the sections and of the Spec, as skeletons. */
function Skeletons(): ReactNode {
  return (
    <div className={COLUMNS}>
      <div className={NAV} aria-hidden="true">
        <ul className="flex flex-col gap-3 px-2 pt-2">
          {['Why', 'Goals / Non-goals', 'Impact', 'Requirements', 'Decisions'].map((title) => (
            <li key={title} className="text-sm">
              <Skeleton>{title}</Skeleton>
            </li>
          ))}
        </ul>
      </div>
      <section aria-label="Spec" aria-busy="true" className={MIDDLE}>
        {['Why', 'Goals / Non-goals', 'Impact'].map((title) => (
          <div key={title} className="flex max-w-measure flex-col gap-3">
            <span className="text-base font-semibold">
              <Skeleton>{title}</Skeleton>
            </span>
            <span className="text-sm">
              <Skeleton>
                People keep their notes and want them elsewhere too, in a wiki or a repository.
              </Skeleton>
            </span>
          </div>
        ))}
      </section>
      <div className={RAIL} />
    </div>
  )
}

export function PlanningPage(props: PlanningPageProps): ReactNode {
  const { data, error } = props
  // The last answer sent: once it is read back, the line saying none is left takes the focus.
  const [lastSent, setLastSent] = useState(false)
  const said = data === null ? null : allAnswered(data)
  useEffect(() => {
    if (!lastSent || said === null) return
    setLastSent(false)
    focusTarget({ kind: 'questions' })
  }, [lastSent, said])
  if (data === null) {
    if (error !== undefined) {
      return (
        <div className="px-8 py-6">
          <ErrorState
            title="The Spec could not be read"
            description={error}
            onRetry={props.onRetry}
          />
        </div>
      )
    }
    return <Skeletons />
  }
  const open = openBySection(data.waves)
  // An answer folds its question at once; the next one to answer comes into view with the focus,
  // and once none is left, the line that says so.
  const answering: PlanningPageProps = {
    ...props,
    onAnswer: (questionId, answer) => {
      const next = nextToAnswer(data, questionId)
      if (next !== null) focusTarget({ kind: 'question', id: next })
      const sent = props.onAnswer(questionId, answer)
      // The line saying none is left is drawn once the answer is read back: it then takes the focus.
      if (next === null) {
        sent.then(
          () => setLastSent(true),
          () => undefined,
        )
      }
      return sent
    },
  }
  const steps = planningSteps({
    data,
    planner: props.planner ?? BETWEEN_TURNS,
    declaredComplete: props.declaredComplete === true,
  })
  return (
    <div className="flex min-w-0 flex-col">
      {error !== undefined && (
        <div className="px-8 pb-3">
          <PageError
            action={
              <Button variant="link" size="sm" onClick={props.onRetry}>
                Try again
              </Button>
            }
          >
            {`What is shown may be behind: ${error}`}
          </PageError>
        </div>
      )}
      <div className={COLUMNS}>
        <div className={NAV}>
          <SectionsNav
            sections={data.sections}
            requirementsState={data.requirementsState}
            changes={data.changes}
            tasks={data.tasks}
            open={open}
          />
        </div>
        <section aria-label="Spec" className={MIDDLE}>
          {data.changes.length > 0 && (
            <div className={STRIP}>
              <ChangedMark />
              <span className="min-w-0 flex-1 truncate">
                {data.changes.length === 1
                  ? '1 change since your last read, marked in the text'
                  : `${String(data.changes.length)} changes since your last read, marked in the text`}
              </span>
              <SendButton variant="link" size="sm" onSend={props.onMarkRead}>
                Mark as read
              </SendButton>
            </div>
          )}
          <SpecRead
            sections={data.sections}
            requirementsState={data.requirementsState}
            requirements={data.requirements}
            tasks={data.tasks}
            changes={data.changes}
            open={open}
          />
        </section>
        <aside aria-label="What calls for you" className={RAIL}>
          <PlanningSteps steps={steps} onGo={focusTarget} />
          {data.triage !== null && (
            <div id={targetId({ kind: 'triage' })} data-focus-inside="">
              <TriageCard
                triage={data.triage}
                onKeepPlanning={props.onKeepPlanning}
                onOpenMission={props.onOpenMission}
                onAskInChat={props.onAskInChat}
              />
            </div>
          )}
          {data.ticket !== null && (
            <TicketCard ticket={data.ticket} onSeen={props.onSeenTicketChange} />
          )}
          <Questions data={data} props={answering} />
          <ProbesCard probes={data.probes} onOpen={props.onOpenProbe} />
          <ColdReadReport
            passes={data.passes}
            freshness={data.freshness}
            onDismiss={data.frozen ? undefined : props.onDismissFinding}
            onRunAgain={data.frozen ? undefined : props.onRunColdRead}
          />
          <DependenciesCard
            dependencies={data.dependencies}
            frozen={data.frozen}
            onDecide={props.onDecideDependency}
          />
          {!data.frozen && (
            <div id={targetId({ kind: 'vision' })} data-focus-inside="">
              <VisionCard
                visions={data.visions}
                mentionables={props.mentionables}
                onGive={props.onGiveVision}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
