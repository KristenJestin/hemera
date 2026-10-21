import type { Mission } from '@hemera/ipc'

import type { Link } from './link.ts'
import { followReview, type ReviewFollowView, type ReviewFollowing } from './review-follow.ts'
import { followedOf, useFollower } from './use-building.ts'

const LOADING_REVIEW: ReviewFollowView = { moment: null }

/** A mission's Review page, and what the window does with it. */
export function useReview(
  link: Link,
  engineReady: boolean,
  mission: Pick<Mission, 'id' | 'projectId' | 'freeze'>,
): [ReviewFollowView, Omit<ReviewFollowing, 'stop'>] {
  const [view, sent, current] = useFollower(
    link,
    engineReady,
    followedOf(mission),
    LOADING_REVIEW,
    followReview,
  )
  return [
    view,
    {
      service: (name, action) => sent((following) => following.service(name, action)),
      verify: (scenarioId, verdict) => sent((following) => following.verify(scenarioId, verdict)),
      retry: () => current()?.retry(),
    },
  ]
}
