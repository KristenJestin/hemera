import {
  Button,
  ErrorState,
  ReviewPage,
  RoundView,
  ShipDialog,
  type FeedbackHandlers,
  type MissionView,
  type RailHandlers,
  type Review,
} from '@hemera/ui'
import { IconMessages } from '@hemera/ui/icons'
import { type ReactNode, useState } from 'react'

import type { StagePageProps } from './stage-pages.tsx'
import { useReview } from './use-review.ts'

/** What the page draws while its first read is on its way: rows of their shape, nothing else. */
const READING: Review.ReviewMoment = {
  face: 'loading',
  now: '',
  progress: { step: 'Review', detail: '' },
  round: 0,
  ball: { ball: 'you' },
  needs: [],
  remarks: [],
  fixable: false,
  rounds: [],
  team: [],
  pulls: [],
  forge: null,
  services: [],
  proofs: [],
  checks: [],
  findings: [],
  saw: '',
  after: [],
  changes: [],
  refusals: [],
  preview: { leaving: [], outside: [], redo: [], unvalidated: [], rules: [], ci: [] },
}

const copy = (text: string): void => {
  navigator.clipboard.writeText(text).catch(() => undefined)
}

const openLink = (url: string): void => {
  window.open(url, '_blank', 'noopener')
}

/** The id of a round's view over the Review page. */
export const roundViewId = (n: number): string => `round:${String(n)}`

/**
 * The page of a mission in Review (#254, #496): the feedback by round in the middle, the
 * composer under it; the rail with the stage card, what waits for the user (the proofs to verify
 * by hand, the round's questions, the team's comments) and the rest, folded: the services, the
 * pull requests, the proofs, the checks, the automatic review, the documentation, the changes.
 * What the page shows is the engine's word: Fix's presence, Ship's reasons.
 */
export function ReviewStage({
  link,
  engineReady,
  mission,
  open,
  startMission,
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = useReview(link, engineReady, mission)
  const [shipping, setShipping] = useState(false)
  const { moment } = view
  const rail: RailHandlers = {
    onService: (name, action) => void act.service(name, action),
    onVerify: (id, verdict) => void act.verify(id, verdict),
    onTeam: (label, action, take) => void act.team(label, action, take),
    onPull: (repository, action) => void act.pull(repository, action),
    onOpenDiff: () => open('diff'),
    onOpenLink: openLink,
    onCopy: copy,
    question: {
      onAnswer: act.answer,
      onWaitOnSomeone: act.waitOnSomeone,
      onCopyDraft: copy,
      onAcceptProposed: act.acceptProposed,
      onDismissProposed: act.dismissProposed,
      // A round's question is answered here, never discussed: in Review the user talks to the
      // agents through feedback and what waits for them.
    },
  }
  const feedback: FeedbackHandlers = {
    onAdd: (remark) => void act.add(remark),
    onAttach: act.attach,
    onStartMission: (label) => {
      void act.startMission(label).then((seed) => {
        if (seed !== null) startMission(seed)
      })
    },
    onEdit: (label, text) => void act.edit(label, text),
    onWithdraw: (label) => void act.withdraw(label),
    onResolve: (label) => void act.resolve(label),
    onFix: () => void act.fix(),
    onOpenDiff: () => open('diff'),
    onOpenRound: (n) => open(roundViewId(n)),
  }
  const base =
    moment === null && view.error !== undefined ? (
      <div className="px-8 py-6">
        <ErrorState
          title="The Review page could not be read"
          description={view.error}
          onRetry={act.retry}
        />
      </div>
    ) : (
      <ReviewPage
        moment={moment ?? READING}
        loading={moment === null}
        rail={rail}
        feedback={feedback}
        mentionables={view.mentionables}
      />
    )
  // A round's conflicts and new missions are the engine's questions, answered in its waves: a
  // point offers no way out of its own. Building · round N is the Building page, which the
  // mission shows by itself while a round builds: this view says it and opens nothing.
  const views: MissionView[] = (moment?.rounds ?? []).map((round) => ({
    id: roundViewId(round.n),
    title: `Round ${String(round.n)}`,
    icon: <IconMessages size="sm" />,
    width: 'wide',
    body: <RoundView round={round} question={rail.question} />,
  }))
  const local = moment?.forge === null
  const refusals = moment?.refusals ?? []
  const shown = moment ?? READING
  return frame({
    base: (
      <>
        {base}
        <ShipDialog
          missionKey={mission.key}
          preview={shown.preview}
          confirmable={view.confirmable}
          open={shipping}
          onOpenChange={setShipping}
          onConfirm={() => {
            setShipping(false)
            void act.ship()
          }}
        />
      </>
    ),
    views,
    ballFace: false,
    // Ship is there when the engine says it may be pressed; otherwise the line says its reasons.
    action: view.shippable ? (
      <Button
        variant="primary"
        onClick={() => {
          setShipping(true)
          void act.previewShip()
        }}
      >
        {local ? 'Mark as delivered' : 'Ship'}
      </Button>
    ) : undefined,
    actionNote:
      !view.shippable && refusals.length > 0 ? (
        <p className="max-w-view-narrow text-right text-xs break-words text-muted-foreground">
          {`${local ? 'Delivery' : 'Ship'} waits: ${refusals.join(' · ')}`}
        </p>
      ) : undefined,
    notice: view.refused,
  })
}
