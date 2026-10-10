import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { ColdReadReport } from '../../blocks/planning/cold-read.tsx'
import {
  DependenciesCard,
  FreezeRefusal,
  TicketCard,
  TriageCard,
  VisionCard,
} from '../../blocks/planning/planning-cards.tsx'
import { ChangedMark } from '../../blocks/planning/planning-marks.tsx'
import {
  type DiscussionItem,
  type PlanningData,
  type PlanningHandlers,
  type Wave,
  waiting,
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
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * The Planning page: the base of a mission's frame while the Planner writes the Spec with the
 * user (#100, proposal A, with the Probes as a card of the rail).
 *
 * The centre holds what matters to read, the Spec, at its measure, with its eight sections and
 * their state down the left; what changed since the last read is marked where it changed, with
 * one line on top and Mark as read. The right-hand rail holds everything the user may have to act
 * on: the Planner's triage answer, what changed on the ticket, the questions (the newest wave
 * first, answered ones folded to a line with Change), the Probes, the cold read, the dependencies,
 * and the vision, a field always there while the Spec is written. Nothing else in the centre asks
 * for anything. A refused Freeze names what blocks it above both.
 *
 * Discuss and a Probe's report open as views over the page: their ids are below, and the frame
 * that holds the page holds them.
 */

/** The id of the view of a discussion over the page. */
export const discussionViewId = (item: DiscussionItem): string =>
  `discussion:${item.kind}:${item.id}`

/** The id of the view of a Probe's report over the page. */
export const probeViewId = (id: string): string => `probe:${id}`

export interface PlanningPageProps extends PlanningHandlers {
  /** The page's data; null while the first read is on its way. */
  data: PlanningData | null
  /** Why it could not be read, in words. */
  error?: string | undefined
  onRetry: () => void
  /** The reasons of a Freeze just refused, each naming what blocks it. */
  refused?: readonly string[] | undefined
  /** What the user's own words can mention. */
  mentionables: readonly Mentionable[]
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
                foldAnswered
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

function Questions({ data, props }: { data: PlanningData; props: PlanningPageProps }): ReactNode {
  const folding = useTransition(fold)
  if (data.frozen || data.waves.length === 0) return null
  const newestFirst = [...data.waves].reverse()
  return (
    <section aria-label="Questions" className="flex flex-col gap-3">
      <SectionHead title="Questions" count={waiting(data.waves).length} calls />
      <AnimatePresence initial={false}>
        {newestFirst.map((wave) => (
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
  const { data, error, refused } = props
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
  return (
    <div className="flex min-w-0 flex-col">
      {refused !== undefined && refused.length > 0 && (
        <div className="px-8 pb-3">
          <FreezeRefusal reasons={refused} />
        </div>
      )}
      <div className={COLUMNS}>
        <div className={NAV}>
          <SectionsNav
            sections={data.sections}
            requirementsState={data.requirementsState}
            changes={data.changes}
            tasks={data.tasks}
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
              <Button variant="link" size="sm" onClick={props.onMarkRead}>
                Mark as read
              </Button>
            </div>
          )}
          <SpecRead
            sections={data.sections}
            requirementsState={data.requirementsState}
            requirements={data.requirements}
            tasks={data.tasks}
            changes={data.changes}
          />
        </section>
        <aside aria-label="What calls for you" className={RAIL}>
          {data.triage !== null && (
            <TriageCard
              triage={data.triage}
              onKeepPlanning={props.onKeepPlanning}
              onOpenMission={props.onOpenMission}
            />
          )}
          {data.ticket !== null && (
            <TicketCard ticket={data.ticket} onSeen={props.onSeenTicketChange} />
          )}
          <Questions data={data} props={props} />
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
            <VisionCard
              visions={data.visions}
              mentionables={props.mentionables}
              onGive={props.onGiveVision}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
