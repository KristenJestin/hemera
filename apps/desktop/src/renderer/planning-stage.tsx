import {
  FreezeButton,
  FreezeNote,
  PlanningPage,
  discussionViewId,
  planningViews,
  probeViewId,
  type Planning,
} from '@hemera/ui'
import { useState, type ReactNode } from 'react'

import { planningHeadOf, planningNeedOf } from './planning-model.ts'
import { flight, startChat } from './chat-actions.ts'
import type { StagePageProps } from './stage-pages.tsx'
import { usePlanning } from './use-planning.ts'

const sameItem = (one: Planning.DiscussionItem, other: Planning.DiscussionItem): boolean =>
  one.kind === other.kind && one.id === other.id

/**
 * The page of a mission in Planning: the Spec in the centre, what calls for the user in the rail,
 * and the views it opens over itself — a discussion, a Probe's report. The head holds Freeze from
 * the declaration of the Spec on, with what stands before it or why it was refused; it draws the
 * ball without the face and no Now line, the page's stage card saying what happens. The mission's
 * needs (a permission, something missing) are not drawn above the page: they are For you's first
 * line, in the rail.
 */
export function PlanningStage({
  link,
  engineReady,
  mission,
  open,
  goMission,
  readiness,
  openChat,
  refused,
  freeze,
  freezing,
  needs,
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = usePlanning(link, engineReady, mission)
  const [creating] = useState(() => flight())
  const [chatRefused, setChatRefused] = useState<string | null>(null)
  // A discussion opens with its first message: until then its view holds only the field.
  const [starting, setStarting] = useState<readonly Planning.DiscussionItem[]>([])
  const data = view.data
  const head = planningHeadOf(view, readiness)

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
        planner={view.planner}
        declaredComplete={view.declaredComplete}
        needs={needs.rows.map(planningNeedOf)}
        onNeed={needs.on}
        error={view.error}
        onRetry={act.retry}
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
        onAskInChat={() => startChat(link, mission.projectId, creating, openChat, setChatRefused)}
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
    needs: [],
    ballFace: false,
    action: head.freeze.shown ? (
      <FreezeButton offer={head.freeze} refused={refused} freezing={freezing} onFreeze={freeze} />
    ) : undefined,
    actionNote: <FreezeNote offer={head.freeze} refused={refused} />,
    notice: chatRefused ?? view.refused,
  })
}
