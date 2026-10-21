import type { Mission } from '@hemera/ipc'

import type { Link } from './link.ts'
import { followReview, type ReviewFollowView, type ReviewFollowing } from './review-follow.ts'
import { followedOf, useFollower } from './use-building.ts'

const LOADING_REVIEW: ReviewFollowView = {
  moment: null,
  mentionables: [],
  shippable: false,
  confirmable: false,
}

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
      add: (remark) => sent((following) => following.add(remark)),
      attach: (file) =>
        current()?.attach(file) ?? Promise.resolve({ refused: 'Hemera is not there yet.' }),
      edit: (label, text) => sent((following) => following.edit(label, text)),
      withdraw: (label) => sent((following) => following.withdraw(label)),
      resolve: (label) => sent((following) => following.resolve(label)),
      fix: () => sent((following) => following.fix()),
      startMission: (label) => current()?.startMission(label) ?? Promise.resolve(null),
      answer: (questionId, answer) => sent((following) => following.answer(questionId, answer)),
      waitOnSomeone: (questionId, note) =>
        sent((following) => following.waitOnSomeone(questionId, note)),
      acceptProposed: (proposalId, text) =>
        sent((following) => following.acceptProposed(proposalId, text)),
      dismissProposed: (proposalId) => sent((following) => following.dismissProposed(proposalId)),
      pull: (repository, action) => sent((following) => following.pull(repository, action)),
      team: (label, action, take) => sent((following) => following.team(label, action, take)),
      previewShip: () => sent((following) => following.previewShip()),
      ship: () => current()?.ship() ?? Promise.resolve(false),
      retry: () => current()?.retry(),
    },
  ]
}
