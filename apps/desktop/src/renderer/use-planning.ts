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
  return [
    view,
    {
      answer: (questionId, answer) => following.current?.answer(questionId, answer),
      waitOnSomeone: (questionId, note) => following.current?.waitOnSomeone(questionId, note),
      acceptProposed: (proposalId, text) => following.current?.acceptProposed(proposalId, text),
      dismissProposed: (proposalId) => following.current?.dismissProposed(proposalId),
      dismissFinding: (findingId) => following.current?.dismissFinding(findingId),
      runColdRead: () => following.current?.runColdRead(),
      decideDependency: (dependency, accept) =>
        following.current?.decideDependency(dependency, accept),
      giveVision: (text) => following.current?.giveVision(text),
      markRead: () => following.current?.markRead(),
      keepPlanning: () => following.current?.keepPlanning(),
      seenTicketChange: (eventId) => following.current?.seenTicketChange(eventId),
      openProbe: (probeId) => following.current?.openProbe(probeId),
      say: (item, text) => following.current?.say(item, text),
      accept: (item) => following.current?.accept(item),
      close: (item, decision) => following.current?.close(item, decision),
      retry: () => following.current?.retry(),
    },
  ]
}
