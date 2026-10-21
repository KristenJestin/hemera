import type { Mission } from '@hemera/ipc'
import type { ModelChoice, ServiceAction } from '@hemera/ui'
import { useEffect, useRef, useState } from 'react'

import {
  followBuilding,
  followReady,
  type BuildingFollowView,
  type BuildingFollowing,
  type FollowedMission,
  type ReadyFollowView,
  type ReadyFollowing,
} from './building-follow.ts'
import type { Link } from './link.ts'

const LOADING_READY: ReadyFollowView = { moment: null, launchable: false }

const LOADING_BUILDING: BuildingFollowView = {
  moment: null,
  building: null,
  spec: null,
  percent: null,
}

export const followedOf = (
  mission: Pick<Mission, 'id' | 'projectId' | 'freeze'>,
): FollowedMission => ({
  id: mission.id,
  projectId: mission.projectId,
  frozenAt: mission.freeze?.frozenAt ?? null,
})

/**
 * Follows a mission with `follow` while the engine is there, and hands its gestures over: before
 * the engine follows the mission, a gesture has nowhere to go and is done with.
 */
export function useFollower<View, Following extends { readonly stop: () => void }>(
  link: Link,
  engineReady: boolean,
  mission: FollowedMission,
  loading: View,
  follow: (link: Link, mission: FollowedMission, onView: (view: View) => void) => Following,
): [View, (send: (current: Following) => Promise<void>) => Promise<void>, () => Following | null] {
  const [view, setView] = useState<View>(loading)
  const following = useRef<Following | null>(null)
  const { id, projectId, frozenAt } = mission
  useEffect(() => {
    if (!engineReady) return undefined
    const current = follow(link, { id, projectId, frozenAt }, setView)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setView(loading)
    }
  }, [link, engineReady, id, projectId, frozenAt, loading, follow])
  const sent = (send: (current: Following) => Promise<void>): Promise<void> =>
    following.current === null ? Promise.resolve() : send(following.current)
  return [view, sent, () => following.current]
}

/** A Ready mission's page, and what the window does with it. */
export function useReady(
  link: Link,
  engineReady: boolean,
  mission: Pick<Mission, 'id' | 'projectId' | 'freeze'>,
): [ReadyFollowView, Omit<ReadyFollowing, 'stop'>] {
  const [view, sent, current] = useFollower(
    link,
    engineReady,
    followedOf(mission),
    LOADING_READY,
    followReady,
  )
  return [
    view,
    {
      launch: () => sent((following) => following.launch()),
      launchAnyway: () => sent((following) => following.launchAnyway()),
      backToPlanning: () => sent((following) => following.backToPlanning()),
      chooseModel: (choice: ModelChoice | null) =>
        sent((following) => following.chooseModel(choice)),
      mark: (agent, model, change) => sent((following) => following.mark(agent, model, change)),
      revoke: (grantId: string) => sent((following) => following.revoke(grantId)),
      retry: () => current()?.retry(),
    },
  ]
}

/** A Building mission's page, and what the window does with it. */
export function useBuilding(
  link: Link,
  engineReady: boolean,
  mission: Pick<Mission, 'id' | 'projectId' | 'freeze'>,
): [BuildingFollowView, Omit<BuildingFollowing, 'stop'>] {
  const [view, sent, current] = useFollower(
    link,
    engineReady,
    followedOf(mission),
    LOADING_BUILDING,
    followBuilding,
  )
  return [
    view,
    {
      service: (id: string, action: ServiceAction) =>
        sent((following) => following.service(id, action)),
      journalMore: () => sent((following) => following.journalMore()),
      revoke: (grantId: string) => sent((following) => following.revoke(grantId)),
      retry: () => current()?.retry(),
    },
  ]
}
