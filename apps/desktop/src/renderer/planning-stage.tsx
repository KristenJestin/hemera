import {
  PlanningPage,
  discussionViewId,
  planningViews,
  probeViewId,
  type Planning,
} from '@hemera/ui'
import { useState, type ReactNode } from 'react'

import type { StagePageProps } from './stage-pages.tsx'
import { usePlanning } from './use-planning.ts'

const sameItem = (one: Planning.DiscussionItem, other: Planning.DiscussionItem): boolean =>
  one.kind === other.kind && one.id === other.id

/**
 * The page of a mission in Planning: the Spec in the centre, what calls for the user in the rail,
 * and the views it opens over itself — a discussion, a Probe's report. The head says what the
 * Planner does; the needs are not drawn above it, the rail holds the questions.
 */
export function PlanningStage({
  link,
  engineReady,
  mission,
  open,
  goMission,
  refused,
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = usePlanning(link, engineReady, mission)
  // A discussion opens with its first message: until then its view holds only the field.
  const [starting, setStarting] = useState<readonly Planning.DiscussionItem[]>([])
  const data = view.data

  const discuss = (item: Planning.DiscussionItem): void => {
    if (!starting.some((one) => sameItem(one, item))) setStarting([...starting, item])
    open(discussionViewId(item))
  }
  const openProbe = (id: string): void => {
    act.openProbe(id)
    open(probeViewId(id))
  }

  return frame({
    base: (
      <PlanningPage
        data={data}
        error={view.error}
        onRetry={act.retry}
        refused={refused}
        mentionables={view.mentionables}
        onAnswer={act.answer}
        onWaitOnSomeone={act.waitOnSomeone}
        onCopyDraft={(text) => {
          navigator.clipboard.writeText(text).catch(() => undefined)
        }}
        onAcceptProposed={act.acceptProposed}
        onDismissProposed={act.dismissProposed}
        onDiscuss={discuss}
        onOpenProbe={openProbe}
        onDismissFinding={act.dismissFinding}
        onRunColdRead={act.runColdRead}
        onDecideDependency={act.decideDependency}
        onGiveVision={act.giveVision}
        onMarkRead={act.markRead}
        onKeepPlanning={act.keepPlanning}
        onOpenMission={goMission}
        onSeenTicketChange={act.seenTicketChange}
      />
    ),
    views: planningViews({
      discussions: data?.discussions ?? [],
      starting,
      probes: data?.probes ?? [],
      reports: view.reports,
      mentionables: view.mentionables,
      onSay: act.say,
      onAccept: act.accept,
      onClose: act.close,
    }),
    now: view.now,
    notice: view.refused,
    needs: false,
  })
}
