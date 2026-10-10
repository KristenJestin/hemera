import { type ReactNode, useState } from 'react'

import { DiscussionThread } from '../../blocks/planning/discussion-thread.tsx'
import type {
  DiscussionHandlers,
  DiscussionItem,
  PlanningHandlers,
} from '../../blocks/planning/planning-types.ts'
import { ProbeReport } from '../../blocks/planning/probes.tsx'
import { Button } from '../../components/button/button.tsx'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { IconMessages, IconTestPipe } from '../../icons.ts'
import { MissionFrame, type MissionView } from '../mission/mission-frame.tsx'
import { AT_BASE, closeView, openView, showView } from '../mission/navigation.ts'
import * as moments from './planning-fixtures.ts'
import { PlanningPage, discussionViewId, probeViewId } from './planning-page.tsx'

/** The moments of the journey a story can show, by name. */
const MOMENTS = {
  writing: moments.writing,
  firstWave: moments.firstWave,
  wave: moments.wave,
  discussing: moments.discussing,
  probing: moments.probing,
  coldReadRunning: moments.coldReadRunning,
  findings: moments.findings,
  coldReadFailed: moments.coldReadFailed,
  dependencyProposed: moments.dependencyProposed,
  changed: moments.changed,
  vision: moments.vision,
  almostReady: moments.almostReady,
  readyToFreeze: moments.readyToFreeze,
  freezeRefused: moments.freezeRefused,
  frozen: moments.frozen,
  outdated: moments.outdated,
  triaged: moments.triaged,
  proposedAnswer: moments.proposedAnswer,
  restarted: moments.restarted,
  answerReceived: moments.answerReceived,
  answerDelivered: moments.answerDelivered,
  answerIntegrated: moments.answerIntegrated,
  long: moments.long,
} as const

export type MomentName = keyof typeof MOMENTS | 'loading' | 'error'

export interface PlanningScreenProps extends PlanningHandlers, DiscussionHandlers {
  moment: MomentName
  /** A view open over the page as the story starts. */
  opened?: string | undefined
  onFreeze: () => void
  onRetry: () => void
}

/**
 * The Planning page of ACME-12 in its mission frame, at one moment of the journey: the head the
 * renderer draws above it, the page as its base, and the views it opens over it — a discussion, a
 * Probe's report. What the window does with the page, played on the fixtures.
 */
export function PlanningScreen({
  moment,
  opened,
  onFreeze,
  onRetry,
  onSay,
  onAccept,
  onClose,
  ...handlers
}: PlanningScreenProps): ReactNode {
  const shown = moment === 'loading' || moment === 'error' ? null : MOMENTS[moment]()
  const [frame, setFrame] = useState(() =>
    opened === undefined ? AT_BASE : openView(AT_BASE, opened),
  )
  const [starting, setStarting] = useState<DiscussionItem | null>(null)
  const data = shown?.data ?? null
  const head = shown?.head ?? { now: null, ready: false, frozen: false }

  const discuss = (item: DiscussionItem): void => {
    handlers.onDiscuss(item)
    if (!data?.discussions.some((one) => one.item.kind === item.kind && one.item.id === item.id)) {
      setStarting(item)
    }
    setFrame((now) => openView(now, discussionViewId(item)))
  }
  const openProbe = (id: string): void => {
    handlers.onOpenProbe(id)
    setFrame((now) => openView(now, probeViewId(id)))
  }

  const discussions = [
    ...(data?.discussions ?? []).map((discussion) => ({ item: discussion.item, discussion })),
    ...(starting === null ? [] : [{ item: starting, discussion: null }]),
  ]
  const views: MissionView[] = [
    ...discussions.map(({ item, discussion }) => ({
      id: discussionViewId(item),
      title: discussion === null ? `Discuss ${item.id}` : `Discussion ${discussion.label} · ${item.id}`,
      icon: <IconMessages size="md" />,
      width: 'narrow' as const,
      body: (
        <div className="px-5 py-4">
          <DiscussionThread
            discussion={discussion}
            on={item.id}
            mentionables={MENTIONABLES}
            onSay={onSay}
            onAccept={onAccept}
            onClose={onClose}
          />
        </div>
      ),
    })),
    ...(data?.probes ?? []).map((probe) => ({
      id: probeViewId(probe.id),
      title: `Probe ${probe.label}`,
      icon: <IconTestPipe size="md" />,
      width: 'narrow' as const,
      body: <ProbeReport probe={moments.PROBES[probe.id] ?? null} />,
    })),
  ]

  return (
    <MissionFrame
      missionKey="ACME-12"
      title="Export notes as Markdown"
      stage={head.frozen ? 'Ready' : 'Planning'}
      frozen={head.frozen}
      type="feature"
      ball={head.now !== null ? 'agent' : head.frozen ? 'idle' : 'you'}
      now={head.now ?? head.silent}
      marks={head.outdated === true ? [{ kind: 'outdated' }] : []}
      ticket={{ key: 'acme/shop#41' }}
      action={
        head.ready ? (
          <Button variant="primary" size="sm" onClick={onFreeze}>
            Freeze
          </Button>
        ) : undefined
      }
      onCancel={head.frozen ? undefined : () => undefined}
      base={
        <PlanningPage
          data={data}
          error={moment === 'error' ? 'The engine did not answer in time.' : undefined}
          refused={head.refused}
          mentionables={MENTIONABLES}
          onRetry={onRetry}
          {...handlers}
          onDiscuss={discuss}
          onOpenProbe={openProbe}
        />
      }
      views={views}
      open={frame.open}
      shown={frame.shown}
      onShow={(id) => setFrame((now) => showView(now, id))}
      onClose={(id) => setFrame((now) => closeView(now, id))}
    />
  )
}
