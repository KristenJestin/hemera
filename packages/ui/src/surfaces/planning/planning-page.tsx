import type { ReactNode } from 'react'

import type { NeedsYouListProps } from '../../blocks/need/needs-you-list.tsx'
import { attentionOf } from '../../blocks/planning/attention.ts'
import { EverythingElse } from '../../blocks/planning/everything-else.tsx'
import { ForYou } from '../../blocks/planning/for-you.tsx'
import { ChangedMark } from '../../blocks/planning/planning-marks.tsx'
import type { Planner } from '../../blocks/planning/planning-progress.ts'
import type { KeptAgentView } from '../../blocks/mission/kept-agent-chip.tsx'
import { PlanningStageCard } from '../../blocks/planning/planning-stage-card.tsx'
import { SendButton } from '../../blocks/planning/sending.tsx'
import {
  type DiscussionItem,
  type PlanningData,
  type PlanningHandlers,
  type PlanningNeed,
  openBySection,
} from '../../blocks/planning/planning-types.ts'
import { SectionsNav, SpecRead } from '../../blocks/planning/spec-read.tsx'
import { Button } from '../../components/button/button.tsx'
import { ErrorState } from '../../components/error-state/error-state.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { PageError } from '../page.tsx'

/**
 * The Planning page: the base of a mission's frame while the Planner writes the Spec with the
 * user (#100, reworked by #169, then by #193 so that it tells at a glance what waits, what
 * happens, and where the Spec stands).
 *
 * The centre holds what matters to read, the Spec, at its measure, with its eight sections and
 * their state down the left — the green check only once no open question touches a section; what
 * changed since the last read is marked where it changed, with one line on top and Mark as read.
 * The right-hand rail reads top to bottom, in an order that never changes: the stage card (what
 * happens: the face, one line, where Planning stands, the chips of what runs), For you (what
 * waits: the mission's needs, the questions — one list in the order they were asked, one open at a
 * time —, the findings to settle), and the rest, one quiet line each, folded. The head draws no
 * Now line: the card says it.
 *
 * Discuss and a Probe's report open as views over the page: their ids are below, and the frame
 * that holds the page holds them.
 */

/** The id of the view of a discussion over the page. */
export const discussionViewId = (item: DiscussionItem): string =>
  `discussion:${item.kind}:${item.id}`

/** The id of the view of a Probe's report over the page. */
export const probeViewId = (id: string): string => `probe:${id}`

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
  /** The mission's agents Hemera started before its last restart and could not stop: chips in the card. */
  kept?: readonly KeptAgentView[] | undefined
  /** The mission's needs that wait, For you's first line: most often its agents' permissions. */
  needs?: readonly PlanningNeed[] | undefined
  /** Every answer a need's card gives, with the need it answers. */
  onNeed?: NeedsYouListProps['on'] | undefined
}

const COLUMNS = 'flex min-w-0 items-start gap-8 px-8 pt-2 pb-10'

const NAV = 'sticky top-2 w-settings-nav shrink-0 self-start'

const MIDDLE = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-view-narrow min-w-0 shrink-0 flex-col gap-6'

const STRIP =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md border border-border px-3 text-sm'

const NO_NEEDS: readonly PlanningNeed[] = []

const unanswerable: NeedsYouListProps['on'] = () => ({})

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
  const { data, error, needs = NO_NEEDS } = props
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
  const open = openBySection(data.questions)
  const attention = attentionOf({
    data,
    planner: props.planner ?? BETWEEN_TURNS,
    declaredComplete: props.declaredComplete === true,
    needs,
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
          <PlanningStageCard
            attention={attention}
            data={data}
            onOpenProbe={props.onOpenProbe}
            kept={props.kept}
          />
          {!data.frozen && (
            <ForYou
              attention={attention}
              data={data}
              needs={needs}
              onNeed={props.onNeed ?? unanswerable}
              mentionables={props.mentionables}
              handlers={props}
            />
          )}
          <EverythingElse data={data} mentionables={props.mentionables} handlers={props} />
        </aside>
      </div>
    </div>
  )
}
