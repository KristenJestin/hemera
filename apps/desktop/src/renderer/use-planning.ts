import type { Mission } from '@hemera/ipc'
import { useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  LOADING_PLANNING,
  followPlanning,
  type PlanningFollowing,
  type PlanningView,
} from './planning-model.ts'

/** A mission's Planning once the engine has answered, and what the window does with it. */
export function usePlanning(
  link: Link,
  engineReady: boolean,
  mission: Pick<Mission, 'id' | 'projectId'>,
): [PlanningView, Omit<PlanningFollowing, 'stop'>] {
  const [view, setView] = useState<PlanningView>(LOADING_PLANNING)
  const following = useRef<PlanningFollowing | null>(null)
  const { id, projectId } = mission
  useEffect(() => {
    if (!engineReady) return undefined
    const current = followPlanning(link, { id, projectId }, setView)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setView(LOADING_PLANNING)
    }
  }, [link, engineReady, id, projectId])
  // Before the engine follows the mission, a gesture has nowhere to go: it is done with.
  const sent = (send: (current: PlanningFollowing) => Promise<void>): Promise<void> =>
    following.current === null ? Promise.resolve() : send(following.current)
  return [
    view,
    {
      answer: (questionId, answer) => sent((current) => current.answer(questionId, answer)),
      waitOnSomeone: (questionId, note) =>
        sent((current) => current.waitOnSomeone(questionId, note)),
      acceptProposed: (proposalId, text) =>
        sent((current) => current.acceptProposed(proposalId, text)),
      dismissProposed: (proposalId) => sent((current) => current.dismissProposed(proposalId)),
      dismissFinding: (findingId) => sent((current) => current.dismissFinding(findingId)),
      runColdRead: () => sent((current) => current.runColdRead()),
      decideDependency: (dependency, accept) =>
        sent((current) => current.decideDependency(dependency, accept)),
      giveVision: (text) => sent((current) => current.giveVision(text)),
      markRead: () => sent((current) => current.markRead()),
      keepPlanning: () => sent((current) => current.keepPlanning()),
      seenTicketChange: (eventId) => sent((current) => current.seenTicketChange(eventId)),
      openProbe: (probeId) => following.current?.openProbe(probeId),
      say: (item, text) => sent((current) => current.say(item, text)),
      accept: (item) => sent((current) => current.accept(item)),
      close: (item, decision) => sent((current) => current.close(item, decision)),
      retry: () => following.current?.retry(),
    },
  ]
}
