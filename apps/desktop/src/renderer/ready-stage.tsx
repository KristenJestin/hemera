import { Button, ErrorState, Loading, ReadyPage } from '@hemera/ui'
import type { ReactNode } from 'react'

import type { StagePageProps } from './stage-pages.tsx'
import { useReady } from './use-building.ts'

/**
 * The page of a Ready mission (#151): the frozen Spec in summary, the Ready card with the
 * pre-launch check, the model and the preparation, then the mission's own things. Launch is the
 * head's action while it can be pressed; the head draws the ball without the face, the page's
 * stage card drawing it. The mission's needs (a failed preparation step) stand above the page.
 */
export function ReadyStage({ link, engineReady, mission, frame }: StagePageProps): ReactNode {
  const [view, act] = useReady(link, engineReady, mission)
  const { moment } = view
  const base =
    moment === null ? (
      view.error === undefined ? (
        <div className="flex justify-center px-8 py-12">
          <Loading label="Reading the frozen Spec" />
        </div>
      ) : (
        <div className="px-8 py-6">
          <ErrorState
            title="The Ready page could not be read"
            description={view.error}
            onRetry={act.retry}
          />
        </div>
      )
    ) : (
      <ReadyPage
        moment={moment}
        onLaunchAnyway={() => void act.launchAnyway()}
        onBackToPlanning={() => void act.backToPlanning()}
        onCheckAgain={() => void act.launch()}
        onModel={(choice) => void act.chooseModel(choice)}
        onFavourite={(agent, model, favourite) => void act.mark(agent, model, { favourite })}
        onHide={(agent, model, hidden) => void act.mark(agent, model, { hidden })}
        onRevoke={(id) => void act.revoke(id)}
      />
    )
  return frame({
    base,
    ballFace: false,
    action: view.launchable ? (
      <Button variant="primary" onClick={() => void act.launch()}>
        Launch
      </Button>
    ) : undefined,
    notice: view.refused,
  })
}
