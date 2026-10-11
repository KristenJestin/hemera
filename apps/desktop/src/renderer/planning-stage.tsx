import {
  FreezeButton,
  FreezeNote,
  LiveChip,
  PlanningPage,
  discussionViewId,
  focusTarget,
  planningViews,
  probeViewId,
  type Planning,
} from '@hemera/ui'
import { IconEye } from '@hemera/ui/icons'
import { useState, type ReactNode } from 'react'

import { planningHeadOf } from './planning-model.ts'
import type { StagePageProps } from './stage-pages.tsx'
import { usePlanning } from './use-planning.ts'

const sameItem = (one: Planning.DiscussionItem, other: Planning.DiscussionItem): boolean =>
  one.kind === other.kind && one.id === other.id

/**
 * The page of a mission in Planning: the Spec in the centre, what calls for the user in the rail,
 * and the views it opens over itself — a discussion, a Probe's report. The head says what happens
 * and leads to it, and holds Freeze from the declaration of the Spec on, with what stands before
 * it or why it was refused. The Planner's questions are not needs: the needs above the page are the others
 * (a permission, something missing), drawn only when one waits.
 */
export function PlanningStage({
  link,
  engineReady,
  mission,
  open,
  goMission,
  readiness,
  refused,
  freeze,
  freezing,
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = usePlanning(link, engineReady, mission)
  // A discussion opens with its first message: until then its view holds only the field.
  const [starting, setStarting] = useState<readonly Planning.DiscussionItem[]>([])
  const data = view.data
  const head = planningHeadOf(view, readiness)
  const target = head.now?.target ?? null
  const reading = head.now?.coldRead ?? null

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
    now: head.now?.text,
    onNow:
      target === null
        ? undefined
        : () => {
            focusTarget(target)
          },
    nowChip:
      reading === null ? undefined : (
        <LiveChip
          name={`Cold read ${reading.label}`}
          icon={<IconEye size="sm" />}
          state="running"
          startedAt={reading.startedAt}
          endedAt={null}
          onPress={() => focusTarget({ kind: 'coldRead' })}
        />
      ),
    action: head.freeze.shown ? (
      <FreezeButton offer={head.freeze} refused={refused} freezing={freezing} onFreeze={freeze} />
    ) : undefined,
    actionNote: <FreezeNote offer={head.freeze} refused={refused} />,
    notice: view.refused,
  })
}
