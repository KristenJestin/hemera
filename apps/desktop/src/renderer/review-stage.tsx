import {
  ErrorState,
  ReviewPage,
  type FeedbackHandlers,
  type RailHandlers,
  type Review,
} from '@hemera/ui'
import type { ReactNode } from 'react'

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

const noAnswer = (): Promise<void> => Promise.resolve()

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
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = useReview(link, engineReady, mission)
  const { moment } = view
  const rail: RailHandlers = {
    onService: (name, action) => void act.service(name, action),
    onVerify: (id, verdict) => void act.verify(id, verdict),
    onTeam: () => undefined,
    onPull: () => undefined,
    onOpenDiff: () => open('diff'),
    onOpenLink: openLink,
    onCopy: copy,
    question: {
      onAnswer: noAnswer,
      onWaitOnSomeone: noAnswer,
      onCopyDraft: copy,
      onAcceptProposed: noAnswer,
      onDismissProposed: noAnswer,
      onDiscuss: () => undefined,
    },
  }
  const feedback: FeedbackHandlers = {
    onAdd: () => undefined,
    onEdit: () => undefined,
    onWithdraw: () => undefined,
    onResolve: () => undefined,
    onFix: () => undefined,
    onOpenDiff: () => open('diff'),
    onOpenRound: (n) => open(`round:${String(n)}`),
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
      />
    )
  return frame({ base, ballFace: false, notice: view.refused })
}
