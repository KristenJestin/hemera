import type { ReactNode } from 'react'

import { Feedback, type FeedbackHandlers } from './review-feedback.tsx'
import { ForYou, type RailHandlers, Reruns, ReviewCard, TheRest } from './review-rail.tsx'
import type { ReviewMoment } from './review-types.ts'

/**
 * The Review page as #254 proposes it, in the language of the Planning and Building pages: a rail
 * that says, top to bottom, what happens (the stage card, and Ship's re-runs while it goes), what
 * waits for the user (For you), and the rest, one quiet line each, folded; and in the middle, the
 * user's own work here — their feedback, by round.
 *
 * The rail comes first in reading and Tab order, and sits on the right from a laptop's width up.
 */

export interface ReviewPageProps {
  moment: ReviewMoment
  loading: boolean
  rail: RailHandlers
  feedback: FeedbackHandlers
}

const COLUMNS = 'flex min-w-0 flex-col gap-8 px-8 pt-2 pb-10 lg:flex-row-reverse lg:items-start'

const MAIN = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-full min-w-0 shrink-0 flex-col gap-6 lg:w-view-narrow'

export function ReviewPage({ moment, loading, rail, feedback }: ReviewPageProps): ReactNode {
  return (
    <div className={COLUMNS} data-stage="review">
      <aside aria-label="What happens" className={RAIL}>
        <ReviewCard moment={moment} loading={loading} />
        {!loading && (
          <>
            <Reruns moment={moment} />
            <ForYou moment={moment} handlers={rail} />
            <TheRest moment={moment} handlers={rail} />
          </>
        )}
      </aside>
      <div className={MAIN}>
        <Feedback
          remarks={moment.remarks}
          fixable={moment.fixable}
          rounds={moment.rounds}
          loading={loading}
          {...feedback}
        />
      </div>
    </div>
  )
}
